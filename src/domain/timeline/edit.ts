// タイムライン形式（ADR-0032）の編集操作（#629）。純粋関数（副作用なし・§7 テスト対象）。
//
// **置けない操作は黙って別の結果にしない**（§2-5・ADR-0026④）＝重なる位置へ動かそうとしたら、勝手に
// 近くへ寄せたり上書きしたりせず「置けなかった理由」を返す。理由の文言は `15 §6`、出すのは呼び出し側。
import {
  AUDIO_PLACEHOLDER_SEC, CLIP_SPEED_MAX, CLIP_SPEED_MIN, CROP_MAX, PLACED_BOX_RATIO,
  TIMELINE_MIN_CLIP_SEC, VISUAL_PLACEHOLDER_SEC, VOLUME_MAX, WIDTH,
  VOICE_PLACEHOLDER_SEC, dimsForOrientation, MIN_BOX_SIZE_PX, normalizeDeg } from '../constants';
import { FREE_ELEMENT_KIND, FREE_SHAPE_TYPE, NARRATION_STATUS, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import { DEFAULT_SHAPE_COLOR, DEFAULT_TEXT, DEFAULT_TEXT_FONT_SIZE } from '../project/freeLayoutOps';
import { DEFAULT_TEXT_COLOR } from '../template/textStyle';
import { CROP_ALIGN_DEFAULT_X, CROP_ALIGN_DEFAULT_Y, CROP_MODE_DEFAULT } from '../enums';
import type { CropAlignX, CropAlignY, CropMode, TextKey, TrackKind } from '../enums';
import type { Group } from '../group/types';
import { groupElementIds, removeMembersFromGroups } from '../project/groupOps';
import { applyClipEdge } from './clipEdge';
import { createFreeElement } from '../project/freeLayoutOps';
import { createAnimationId, createClipId, createGroupId, createTrackId } from '../project/persistence';
import { subtitleTextOf, subtitlesBoundTo } from './subtitleLink';
import { clipEndSec, spansOverlap, trackKindForClip } from './validateTimelineDoc';
import type { ClipAnimation, TimelineClip, TimelineProject, Track } from './types';
import type { Texts } from '../project/types';
import type { BundledBgmId } from '../bgm/bgmCatalog';
import { defaultDurationForTemplate } from '../template/layerOps';
import type { Template } from '../template/types';
import { canHaveBox, resolveClipBox } from './box';

/** 置けなかった理由（`15 §6` の `TIMELINE_EDIT_*`）。永続データではないので schema には持ち込まない。 */
export const EDIT_BLOCKED = {
  /** 同じ列で時間が重なる（11 §8 V24）。重ねたいなら列を足す。 */
  overlap: 'TIMELINE_EDIT_OVERLAP',
  /** 音の部品を映像の列へ（逆も）＝置いても鳴らない/映らない（V23）。 */
  trackKind: 'TIMELINE_EDIT_TRACK_KIND',
  /** 列が固定されている（`track.locked`）。 */
  locked: 'TIMELINE_EDIT_LOCKED',
  /**
   * **選んだものの中に**固定された列の部品がある（#752-3）。`locked` と分けるのは、次の行動が
   * 違うから＝こちらは「固定を外す」だけでなく「選び直す」でも進める。まとめて消す・まとめて
   * 動かすときに出る。
   */
  lockedSelection: 'TIMELINE_EDIT_LOCKED_SELECTION',
  /**
   * 列を複製しようとしたが、その列の部品が**ほかの列の部品とまとまりになっている**（#767）。
   * まとまりは変形を持つので、片側だけ複製すると**複製した方だけ見た目が変わる**
   *（複製をまとまりへ入れれば、今度は元の絵まで動く）。黙って違う絵を作らない（ADR-0026④）。
   */
  groupAcrossTracks: 'TIMELINE_EDIT_GROUP_ACROSS_TRACKS',
  /** 対象が見つからない（消された直後の操作など）。 */
  notFound: 'TIMELINE_EDIT_NOT_FOUND',
  /**
   * その部品は分けられない（#686 段階4・決定16）。読み上げは**文と音がずれる**／連動している
   * 字幕は**時間を読み上げが決めている**ので、切ると持ち主のいない区間ができる。
   */
  unsplittable: 'TIMELINE_EDIT_UNSPLITTABLE',
  /** 切れ目が帯の外／どちらかが短くなりすぎる（#686 段階4）。 */
  splitOutside: 'TIMELINE_EDIT_SPLIT_OUTSIDE',
  /**
   * 再生中（ADR-0032 決定21）。**位置を使う操作**は再生ヘッドの値を掴むので、走っている最中は
   * 同じ操作の結果が毎回変わる。ボタンは押せなくできるが、**キーには押せない見た目が無い**ので
   * 理由をここから出す（§2-5）。
   */
  playing: 'TIMELINE_EDIT_PLAYING',
  /**
   * 書き出し中で**再生**できない（#752-6）。`exporting` と分けるのは、次の行動が「編集」ではなく
   * 「再生」だから＝流用すると押せない理由が噛み合わない（§2-5）。
   */
  playExporting: 'TIMELINE_PLAY_EXPORTING',
  /** 直線でない動きの区間の途中では分けられない（#686 段階4＝カーブの形を持ち越せない・#753）。 */
  curvedEasing: 'TIMELINE_EDIT_CURVED_EASING',
  /**
   * 書き出し中（#631）。書き出しは**始めた時点の文書**を焼くので、途中の編集は動画に入らない。
   * 入らない編集を受け付けると「直したのに反映されていない動画」が成功として出る（ADR-0026①）。
   */
  exporting: 'TIMELINE_EDIT_EXPORTING',
  /**
   * 向き（横型/縦型）が動画と違う見た目パターン（#632）。置くと層の座標がそのままなので**画面から
   * はみ出した絵**になり、検証にも書き出しにも引っかからないまま出てしまう。置く前に断る。
   */
  orientation: 'TIMELINE_EDIT_ORIENTATION',
  /**
   * 拡大・回転の動きが付いた部品を、中身が枠からはみ出した状態でバラそうとした（#632）。
   * 動きの支点が変わって**絵がずれる**ので、先に動きを外してもらう。
   */
  explodeAnchor: 'TIMELINE_EDIT_EXPLODE_ANCHOR',
  /** 連動している字幕を置ける場所が無い（読み上げを動かせない理由・#633）。 */
  linkedSubtitle: 'TIMELINE_EDIT_LINKED_SUBTITLE',
  /** 連動している字幕の時間を直接変えようとした（時間は読み上げが決める・#633）。 */
  linkedSubtitleTime: 'TIMELINE_EDIT_LINKED_SUBTITLE_TIME',
  /**
   * 音量の変化の点が上限（`VOLUME_POINTS_MAX`）に達している（#512）。**書き出せる範囲でしか置かせない**
   * ＝置けたのに書き出しで断られる、を作らない（`11 §7.6.5`）。
   */
  volumePointsFull: 'TIMELINE_EDIT_VOLUME_POINTS_FULL',
  /** 音量の変化を、鳴る音を持たない部品へ置こうとした（#512）。 */
  volumePointsKind: 'TIMELINE_EDIT_VOLUME_POINTS_KIND',
  /**
   * 出さない設定の列へ置こうとした（#684）。置けても**動画に出ない部品**が黙って生まれる。
   * 列の固定（`locked`）とは別＝「動かせない」ではなく「映らない」。
   */
  hiddenTrack: 'TIMELINE_EDIT_HIDDEN_TRACK',
  /**
   * その部品が持たない中身の項目を直そうとした（#684 レビュー）。**列の種別違い（V23）とは別**
   * ＝「列に置き直してください」は無関係な案内になる（§2-5）。`volumePointsKind` と同じ流儀で、
   * **その項目を持たない部品に意味の無いデータを書かない**。
   */
  contentField: 'TIMELINE_EDIT_CONTENT_FIELD',
} as const;

export type EditBlockedReason = (typeof EDIT_BLOCKED)[keyof typeof EDIT_BLOCKED];

/** 編集の結果。**置けないときは文書を返さない**＝呼び出し側が「変わらなかった」と取り違えない。 */
export type EditResult = { ok: true; doc: TimelineProject } | { ok: false; reason: EditBlockedReason };

const ok = (doc: TimelineProject): EditResult => ({ ok: true, doc });
const blocked = (reason: EditBlockedReason): EditResult => ({ ok: false, reason });

/**
 * その列のその時間帯が空いているか（11 §8 V24）。**端が接するのは可**（前の終わり＝次の始まり）。
 * 重なりの述語そのものは `spansOverlap`（検証と共有）＝半開区間の境界の扱いを2か所に書かない。
 * `exceptClipId` は自分自身を数えないため（動かす当人と重なると判定しない）。
 */
export function isFreeSpan(
  clips: readonly TimelineClip[],
  trackId: string,
  startSec: number,
  durationSec: number,
  exceptClipId?: string,
): boolean {
  return !clips.some(
    (c) =>
      c.trackId === trackId &&
      c.id !== exceptClipId &&
      spansOverlap(c.startSec, clipEndSec(c), startSec, startSec + durationSec),
  );
}

/** 置いた部品の仮の長さ（#684）。**下限を割らない**＝置ける長さと探す長さを別々に書かない（§2-7）。 */
export const VISUAL_CLIP_DURATION_SEC = Math.max(TIMELINE_MIN_CLIP_SEC, VISUAL_PLACEHOLDER_SEC);

/**
 * その列で、`fromSec` 以降に **`durationSec` がまるごと収まる最初の時刻**（#684 レビュー）。
 *
 * 「いちばん後ろの部品の終わり」ではない＝**間の空きを飛び越さない**。
 * 例：`[0,3)` と `[10,15)` があるとき、5秒ぶんは `[3,10)` の空きに収まるので 3 を返す（15 ではない）。
 * 置き場所をアプリが決める経路（ボタンで置く）で、見えている空きを使わずに最後尾へ飛ばさないための規則。
 *
 * **「空いている」の判定は `isFreeSpan` に委ねる**（ここで重なりを数え直さない）＝探した結果が
 * 置ける条件（V24）と食い違わない。候補は **`fromSec` と、各部品の終わり**だけでよい
 * （最初に収まる時刻は必ずそのどれか）。いちばん後ろの終わりは必ず空くので、答えは必ず返る。
 */
export function firstFreeStart(
  clips: readonly TimelineClip[],
  trackId: string,
  fromSec: number,
  durationSec: number,
): number {
  const candidates = [fromSec, ...clips
    .filter((c) => c.trackId === trackId && clipEndSec(c) > fromSec)
    .map((c) => clipEndSec(c))]
    .sort((a, b) => a - b);
  const found = candidates.find((t) => isFreeSpan(clips, trackId, t, durationSec));
  // いちばん後ろの候補は必ず空くのでここは通らないが、通っても**空いている時刻**を返す
  // （`fromSec` に落とすと塞がった時刻を返し、呼び出し側が置けずに終わる）。
  return found ?? candidates[candidates.length - 1];
}

/** 置き先として成り立つか（列の実在・種別の一致・固定・隠し・重なり）を1か所で見る。 */
function placementIssue(
  doc: TimelineProject,
  clip: TimelineClip,
  trackId: string,
  startSec: number,
  durationSec: number,
): EditBlockedReason | null {
  // 列そのものの事情は **`trackPlacementIssue`**（置く側と同じ規則・#714-3）。
  // ⚠️ ここに条件を書き写していたので**隠した列だけ抜けて**いた＝置くときは断るのに、
  // 既にある帯は**隠した列へ黙って移せた**（動画に出ない部品を作らない、を置くときだけ守っていた）。
  const issue = trackPlacementIssue(doc, trackId, trackKindForClip(clip.kind));
  // ただし**隠した列は「新しく入れる」ときだけ**断る。もともとその列にある帯を動かす・縮めるのは通す
  // ＝見えないものが増えるわけではないし、断ると**隠した列の中身が二度と動かせない**（行き止まり・決定5）。
  if (issue && !(issue === EDIT_BLOCKED.hiddenTrack && trackId === clip.trackId)) return issue;
  if (!isFreeSpan(doc.clips, trackId, startSec, durationSec, clip.id)) return EDIT_BLOCKED.overlap;
  return null;
}

/** クリップを差し替えた文書（他は素通し）。 */
function withClip(doc: TimelineProject, next: TimelineClip): TimelineProject {
  return { ...doc, clips: doc.clips.map((c) => (c.id === next.id ? next : c)) };
}

/**
 * **その場所へ動かせるか**（動かせないなら理由・`null`＝動かせる・#686）。
 *
 * ⚠️ **`moveClip` を実際に走らせて結果だけ見る**（判定を書き写さない）。
 * 最初は同じ条件を並べ直していたが、`moveClip` だけが通る `withBoundSubtitles`
 * （連動する字幕の置き場が無ければ全体を断る）が**こちらに無く**、読み上げの帯では
 * **ゴーストが「置ける」色のまま離した瞬間に断られた**（#742→#686 レビュー）。
 * 「同じ規則を見る」と書いても、2つ書けばいつか割れる。**走らせれば割れようがない**。
 * 捨てる文書を1つ作るが、作るのは配列の浅い複製だけ（指を動かすたびに走らせても軽い）。
 */
export function moveClipIssue(
  doc: TimelineProject,
  clipId: string,
  to: { trackId?: string; startSec?: number },
): EditBlockedReason | null {
  const r = moveClip(doc, clipId, to);
  return r.ok ? null : r.reason;
}

/**
 * **その端まで縮められるか**（縮められないなら理由・`null`＝できる・#686）。
 * `moveClipIssue` と同じ理由で **`trimClip` を走らせて結果だけ見る**（上の ⚠️ を参照）。
 */
export function trimClipIssue(
  doc: TimelineProject,
  clipId: string,
  edge: 'start' | 'end',
  sec: number,
): EditBlockedReason | null {
  const r = trimClip(doc, clipId, edge, sec);
  return r.ok ? null : r.reason;
}

/**
 * クリップを動かす（列を替える／時間をずらす）。**開始は 0 より前に出さない**（時間の外へ置かない）。
 * 元の列が固定されているときも動かさない＝「固定」が見た目だけにならない（ADR-0026④）。
 */
export function moveClip(
  doc: TimelineProject,
  clipId: string,
  to: { trackId?: string; startSec?: number },
): EditResult {
  const clip = doc.clips.find((c) => c.id === clipId);
  if (!clip) return blocked(EDIT_BLOCKED.notFound);
  if (doc.tracks.find((t) => t.id === clip.trackId)?.locked) return blocked(EDIT_BLOCKED.locked);
  // 連動している字幕の**時間**は読み上げが決める。ここで動かせると「連動していると出ているのに
  // 区間が合っていない」を作れてしまう（列の移動だけは許す）。
  if (clip.voiceClipId != null && to.startSec != null && to.startSec !== clip.startSec) {
    return blocked(EDIT_BLOCKED.linkedSubtitleTime);
  }
  const trackId = to.trackId ?? clip.trackId;
  const startSec = Math.max(0, to.startSec ?? clip.startSec);
  // 何も変わらないなら文書をそのまま返す＝取り消しが空振りする履歴を積ませない（呼び出し側は同一参照で判定する）。
  if (trackId === clip.trackId && startSec === clip.startSec) return ok(doc);
  const issue = placementIssue(doc, clip, trackId, startSec, clip.durationSec);
  if (issue) return blocked(issue);
  // 連動している字幕は**同じ区間になる**（ADR-0032 決定24）。動かすときとトリムするときで意味を変えない
  // ＝「連動している＝区間が一致している」を保つ（ずれたまま連動していると表示される状態を作らない）。
  return withBoundSubtitles(withClip(doc, { ...clip, trackId, startSec }), doc, clip, {
    startSec,
    durationSec: clip.durationSec,
  });
}

/**
 * **まとめて動かす**（#686 段階4・ADR-0034 決定15＝「1つでも置けなければ全体を断る」）。
 *
 * ⚠️ **全部動かした後の並びで見る**（1件ずつ `moveClip` を通さない）。順に適用すると、
 * 入れ替え（A を B の場所へ・B を A の場所へ）が**途中で重なって**断られる＝まとめて動かせば
 * 収まる形を、順番のせいで拒む。まず全部動かしてから、動かした帯だけを最後の並びで確かめる。
 *
 * ⚠️ **連動している字幕の時間は動かさない**（読み上げが決める）＝まとめて動かす対象からも外す。
 * 外さずに断ると、選択に字幕が1つ混ざっただけで**全体が動かせなくなる**（決定15 の「全か無か」は
 * *置けるかどうか*の話であって、そもそも時間を持たない相手まで巻き込む意味ではない）。
 */
export function moveClips(
  doc: TimelineProject,
  updates: readonly { id: string; startSec?: number; trackId?: string }[],
): EditResult {
  if (updates.length === 0) return ok(doc);
  /** 動かす先（直接動かす帯＋連動で付いてくる字幕）。**1枚の地図にしてから**一度だけ確かめる。 */
  const to = new Map<string, { startSec: number; trackId: string }>();
  for (const u of updates) {
    const clip = doc.clips.find((c) => c.id === u.id);
    if (!clip) return blocked(EDIT_BLOCKED.notFound);
    // ⚠️ **まとめて動かすときは「選んだ中に固定がある」と言う**（#773・ADR-0034 未解決7 の決着）。
    // `locked`（「**この**列は固定されています」）だと、まとめて動かしている場面で**指す先が外れる**
    // ＝どの列の話か分からない。次の行動も「固定を外す」だけでなく「選び直す」で進める。
    if (doc.tracks.find((t) => t.id === clip.trackId)?.locked) {
      return blocked(updates.length > 1 ? EDIT_BLOCKED.lockedSelection : EDIT_BLOCKED.locked);
    }
    // ⚠️ **連動している字幕は時間だけ据え置く**（読み上げが決める）。**列は動かせる**
    // ＝単体で動かすとき（`moveClip`）は列だけ許すので、まとめたときだけ落とすと
    // 選択の件数で同じ操作の意味が変わる（ADR-0026②）。
    to.set(u.id, {
      startSec: clip.voiceClipId != null ? clip.startSec : Math.max(0, u.startSec ?? clip.startSec),
      trackId: u.trackId ?? clip.trackId,
    });
  }
  // ⚠️ **連動で付いてくる字幕も同じ地図へ畳む**（#686 段階4・`/canon-check`）。
  // ここを畳まずに後から1件ずつ当てると、**まだ動いていない別の字幕の旧位置**と衝突して
  // 断られる＝「全部動かした後の並びで見る」が半分しか成立せず、**選択の順で結果が変わる**。
  for (const [id, m] of [...to]) {
    const clip = doc.clips.find((c) => c.id === id) as TimelineClip;
    if (clip.kind !== TIMELINE_CLIP_KIND.voice) continue;
    for (const sub of subtitlesBoundTo(doc, id)) {
      // 字幕は**読み上げと同じ区間**へ。⚠️ **列は上書きしない**（#754 再レビュー 🔴）＝
      // その字幕自身も選ばれていて**列を変えようとしている**とき、ここで元の列へ戻すと
      // 「置ける色のまま離せるのに何も起きず、理由も出ない」になる（§2-5）。
      // 時間は読み上げが決める／列は利用者が決める、を混ぜない。
      to.set(sub.id, { startSec: m.startSec, trackId: to.get(sub.id)?.trackId ?? sub.trackId });
    }
  }
  const nextClips = doc.clips.map((c) => {
    const m = to.get(c.id);
    // ⚠️ **変わらないなら同じものを返す**（作り直すと「何も変わらない」の判定が効かず、
    // 空振りの取り消しを積む）。連動する字幕は長さも読み上げに合わせる。
    if (!m) return c;
    const durationSec = c.voiceClipId != null
      ? (doc.clips.find((v) => v.id === c.voiceClipId)?.durationSec ?? c.durationSec)
      : c.durationSec;
    if (m.startSec === c.startSec && m.trackId === c.trackId && durationSec === c.durationSec) return c;
    return { ...c, startSec: m.startSec, trackId: m.trackId, durationSec };
  });
  if (nextClips.every((c, i) => c === doc.clips[i])) return ok(doc);
  const next: TimelineProject = { ...doc, clips: nextClips };
  // **最後の並びで、動いた帯それぞれを確かめる**。列の事情も重なりも `placementIssue` が1か所で見る
  // （⚠️ 隠した列の免除を書き写さない＝`placementIssue` の ⚠️ が記録している再発をしない）。
  for (const [id] of to) {
    const before = doc.clips.find((c) => c.id === id) as TimelineClip;
    const after = nextClips.find((c) => c.id === id) as TimelineClip;
    if (after === before) continue;
    const issue = placementIssue(next, before, after.trackId, after.startSec, after.durationSec);
    if (!issue) continue;
    // 置けない理由は**字幕側**のもの＝連動のせいで置けないと分かる形にまとめる（`withBoundSubtitles` と同じ）。
    return blocked(before.voiceClipId != null ? EDIT_BLOCKED.linkedSubtitle : issue);
  }
  return ok(next);
}

/**
 * クリップの端を動かす（トリム）。`edge='start'` は開始を、`'end'` は終わりを動かす。
 * **反対側の端は動かさない**＝片端を縮めるともう片端が付いてくる、を起こさない。
 *
 * クランプは **`applyClipEdge`（端の編集の単一の参照元・#561）へ委譲**する。自前で
 * 「長さを引き算してから `Math.max`」と書くと、同じ入力を2度通したときに下限をわずかに割る
 * （そこで潰した不具合を書き戻さない）。最小の長さは `TIMELINE_MIN_CLIP_SEC`（§2-7）。
 */
export function trimClip(doc: TimelineProject, clipId: string, edge: 'start' | 'end', sec: number): EditResult {
  const clip = doc.clips.find((c) => c.id === clipId);
  if (!clip) return blocked(EDIT_BLOCKED.notFound);
  if (doc.tracks.find((t) => t.id === clip.trackId)?.locked) return blocked(EDIT_BLOCKED.locked);
  // 連動している字幕の長さも読み上げが決める（上と同じ理由）。
  if (clip.voiceClipId != null) return blocked(EDIT_BLOCKED.linkedSubtitleTime);
  const span = applyClipEdge(clip, edge === 'start' ? 'trim-start' : 'trim-end', sec, 0, TIMELINE_MIN_CLIP_SEC);
  // 何も変わらないなら文書をそのまま返す＝取り消しが空振りする履歴を積ませない（呼び出し側は同一参照で判定する）。
  if (span.startSec === clip.startSec && span.durationSec === clip.durationSec) return ok(doc);
  const next = { ...clip, ...span };
  const issue = placementIssue(doc, next, next.trackId, next.startSec, next.durationSec);
  if (issue) return blocked(issue);
  // 連動している字幕も同じ区間になる（声を作り直して長さが変わるときも、この関数を通す約束＝#633 の残り）。
  return withBoundSubtitles(withClip(doc, next), doc, clip, span);
}

/**
 * グループのメンバーから消えた id を落とす（空になったグループも畳む＝中身の無い入れ物を残さない・V26）。
 * 1段ぶんの除去は場面形式と同じ `removeMembersFromGroups` を使い、**入れ子は収束するまで繰り返す**
 * （消えたグループを入れ子に持つ側からも落とす）。
 */
function pruneGroups(groups: readonly Group[], removed: ReadonlySet<string>): Group[] {
  const next = removeMembersFromGroups([...groups], [...removed]);
  const goneIds = new Set(groups.filter((g) => !next.some((n) => n.id === g.id)).map((g) => g.id));
  return goneIds.size === 0 ? next : pruneGroups(next, goneIds);
}

/**
 * クリップを消す。**参照も一緒に片づける**＝グループのメンバーとキーフレームの対象から落とす
 * （残すと「消したのに動きだけ残る」参照切れになる・11 §8 V26）。
 */
/**
 * 選んだ部品を消す（**固定した列のものが混ざっていたら断る**・#701 レビュー）。
 *
 * `removeClips` は列ごと消すとき（`removeTrack`）にも使う内部の道具で、そちらは列そのものを消すので
 * 固定の判定を通してはいけない。**利用者が「消す」を押す入口はこちら**＝ほかの編集（動かす・複製する）が
 * 固定列を断るのと同じ扱いにする（`Ctrl+A` で全部選んでから消す、で固定が意味を失わない）。
 */
export function removeSelectedClipsChecked(doc: TimelineProject, clipIds: readonly string[]): EditResult {
  const lockedTrackIds = new Set(doc.tracks.filter((t) => t.locked).map((t) => t.id));
  const targets = doc.clips.filter((c) => clipIds.includes(c.id));
  if (targets.length === 0) return blocked(EDIT_BLOCKED.notFound);
  // ⚠️ 断る語彙は**画面と同じもの**（#752 レビュー）＝同じ述語（選んだ中に固定列のものが混ざる）に
  // 2つの言い方を持たない。次の行動も「固定を外す」だけでなく「選び直す」で進める。
  if (targets.some((c) => lockedTrackIds.has(c.trackId))) return blocked(EDIT_BLOCKED.lockedSelection);
  return { ok: true, doc: removeClips(doc, clipIds) };
}

export function removeClips(doc: TimelineProject, clipIds: readonly string[]): TimelineProject {
  const removed = new Set(clipIds);
  const clips = doc.clips.filter((c) => !removed.has(c.id));
  const groups = pruneGroups(doc.groups ?? [], removed);
  // 落とすのは**今回消したもの**への参照と、**畳んだグループ**への参照だけ。元から参照切れだったものは
  // 触らない（V26 は「描画で無視」＝掃除は `danglingTimelineRefs` を使う側の役割で、削除のついでにやらない）。
  const goneGroupIds = new Set((doc.groups ?? []).filter((g) => !groups.some((n) => n.id === g.id)).map((g) => g.id));
  const animations = (doc.animations ?? []).filter((a) => !removed.has(a.targetId) && !goneGroupIds.has(a.targetId));
  // **条件付きスプレッドでは消せない**（`...doc` が元の groups/animations を残すので、
  // 空になったときに古い値が生き残る）。無くなったキーは明示的に落とす。
  const next: TimelineProject = { ...doc, clips };
  if (groups.length > 0) next.groups = groups;
  else delete next.groups;
  if (animations.length > 0) next.animations = animations;
  else delete next.animations;
  return next;
}

/**
 * 列を足す。**いちばん手前（配列の末尾）に足す**＝足した列がすぐ見える（重ね順は配列の並びだけ・11 §7.6）。
 * 音の列は重ね順に関係しないが、同じ規則で末尾に足す（並びの意味を種別で変えない）。
 */
export function addTrack(doc: TimelineProject, kind: TrackKind): TimelineProject {
  const track: Track = { id: createTrackId(doc.tracks.map((t) => t.id)), kind };
  return { ...doc, tracks: [...doc.tracks, track] };
}

/**
 * 列を消す。**その列に載っているクリップも一緒に消える**（行き場が無くなるため）。
 * 何が消えるかは呼び出し側が数えて確認を出す＝黙って消さない（§2-5）。
 * **固定した列は消せない**＝「動かせないのに消せる」という非対称を作らない（ADR-0026②）。
 */
export function removeTrack(doc: TimelineProject, trackId: string): EditResult {
  const track = doc.tracks.find((t) => t.id === trackId);
  if (!track) return blocked(EDIT_BLOCKED.notFound);
  if (track.locked) return blocked(EDIT_BLOCKED.locked);
  const ids = doc.clips.filter((c) => c.trackId === trackId).map((c) => c.id);
  const withoutClips = removeClips(doc, ids);
  return ok({ ...withoutClips, tracks: withoutClips.tracks.filter((t) => t.id !== trackId) });
}

/** その列に載っているクリップの数（列を消す前の確認に使う）。 */
export function clipCountOnTrack(doc: TimelineProject, trackId: string): number {
  return doc.clips.filter((c) => c.trackId === trackId).length;
}

/**
 * 列の重ね順を1つ動かす（`direction='front'` で手前＝配列の後ろへ）。端では何も起きない。
 * **重ね順は配列の並びだけで決まる**（11 §7.6）ので、並べ替えがそのまま前後関係になる。
 */
export function moveTrackOrder(doc: TimelineProject, trackId: string, direction: 'front' | 'back'): EditResult {
  const i = doc.tracks.findIndex((t) => t.id === trackId);
  if (i < 0) return blocked(EDIT_BLOCKED.notFound);
  const j = direction === 'front' ? i + 1 : i - 1;
  if (j < 0 || j >= doc.tracks.length) return ok(doc); // 端では何も起きない（寄せない）
  // ⚠️ **落とし先へ動かすのと同じ関数**を通す（#767）＝1段ずつと掴んで運ぶで規則を2つ持たない
  //（固定した列を断るのも、この1か所で決まる）。
  return moveTrackTo(doc, trackId, j);
}

/**
 * 列を**中身ごと**複製して、元の**すぐ手前**へ入れる（#767・利用者決定）。
 * 空の列だけ増やすなら「列を足す」と同じなので、**中の部品も一緒に**運ぶ。
 *
 * - 読み上げは**作成済みの音声を引き継がない**（部品ひとつの複製と**同じ規則**＝作成済みに見えるのに
 *   別の部品の音声を指す、を作らない）
 * - 連動している字幕は、**元の読み上げを指したまま**運ぶ（#787）。⚠️ 以前は「連動先も一緒に複製される
 *   ときだけ結び直す」と書いていたが、**編集操作からはそういう文書を作れない**（`trackPlacementIssue` が
 *   `trackKindForClip` で断る＝字幕は映像の列・読み上げは音の列）＝その分岐は一度も通らず、実際には**連動が必ず落ちて**
 *   「文も連動先も無い＝何も出ない字幕」ができていた。元の読み上げは複製しても必ず残るので、指したままで
 *   時間も文言も追従する。**別の列・同じ区間**なので重なり（V24）にも当たらない
 *   （⚠️ 部品ひとつの複製は落とす＝あちらは**同じ列の直後**に置くので区間が合わず、必ず重なるため）
 * - まとまり・動きは**複製した部品を指すように張り替える**（⚠️ こちらも列ごとの複製だけの規則＝
 *   部品ひとつの複製は引き継がない。参照切れは作らない・11 §8 V26）
 *
 * ⚠️ **まとまりが列をまたぐときは断る**＝片側だけ複製すると、まとまりの変形が乗らない複製が
 * **元と違う絵**になる（まとまりへ入れれば元の絵まで動く）。次の行動は「まとまりを外す」。
 * 名前は引き継がない＝同じ名前の列が2つ並ぶと区別できない（自動名は種別ごとの連番）。
 * ⚠️ **「出さない」は引き継ぐ**（`duplicateClip` は隠した列へ**新しく作る**のを断るが、こちらは
 * その列そのものを写す操作＝行に「出さない」と出るので黙って増やしたことにならない）。
 */
export function duplicateTrack(doc: TimelineProject, trackId: string): EditResult {
  const track = doc.tracks.find((t) => t.id === trackId);
  if (!track) return blocked(EDIT_BLOCKED.notFound);
  const sources = doc.clips.filter((c) => c.trackId === trackId);
  const sourceIds = new Set(sources.map((c) => c.id));
  const groups = doc.groups ?? [];
  // まとまりは「全部この列の中」か「1つも入っていない」かのどちらかでないと運べない。
  // ⚠️ **葉の部品まで展開して数える**（レビュー）＝`members` には**入れ子のまとまり id** が入りうるので、
  // そのまま数えると (a) 子だけ複製されて**親の変形が乗らない**（この関門が防ぐはずの絵の違い）
  // (b) 列をまたいでいないのに「またいでいる」と断る、のどちらも起きる。
  const leavesOf = (g: Group): string[] => groupElementIds(groups, g.id);
  const partial = groups.filter((g) => {
    const leaves = leavesOf(g);
    const inside = leaves.filter((m) => sourceIds.has(m)).length;
    return inside > 0 && inside < leaves.length;
  });
  if (partial.length > 0) return blocked(EDIT_BLOCKED.groupAcrossTracks);

  // id は**全部まとめて**先に採る（1つずつ採ると、同じ番号を2度出す）。
  const newTrack: Track = { ...track, id: createTrackId(doc.tracks.map((t) => t.id)) };
  delete newTrack.name;
  const clipIds = doc.clips.map((c) => c.id);
  const idOf = new Map<string, string>();
  for (const c of sources) idOf.set(c.id, createClipId([...clipIds, ...idOf.values()]));
  const clips: TimelineClip[] = sources.map((c) => {
    const next: TimelineClip = { ...c, id: idOf.get(c.id)!, trackId: newTrack.id };
    if (next.voice) next.voice = { ...next.voice, voicePath: null, status: NARRATION_STATUS.none };
    // 連動（`voiceClipId`）は**そのまま**＝元の読み上げを指し続ける（上記のとおり相手はこの列に居ない）。
    return next;
  });

  // まとまり（この列で完結しているものだけ）を複製し、メンバーを複製した部品へ張り替える。
  const groupIds = groups.map((g) => g.id);
  const groupIdOf = new Map<string, string>();
  const newGroups: Group[] = [];
  for (const g of groups) {
    if (!leavesOf(g).some((m) => sourceIds.has(m))) continue; // 葉で見る（入れ子の親も拾う）
    groupIdOf.set(g.id, createGroupId([...groupIds, ...groupIdOf.values()]));
  }
  for (const g of groups) {
    const id = groupIdOf.get(g.id);
    if (!id) continue;
    // メンバーは部品・入れ子のまとまりの**どちらも**複製先へ張り替える（参照切れを作らない・V26）。
    newGroups.push({ ...g, id, members: g.members.map((m) => idOf.get(m) ?? groupIdOf.get(m) ?? m) });
  }

  // 動き（キーフレーム）も、複製した部品・まとまりを指すものだけ張り替えて足す。
  const animations = doc.animations ?? [];
  const animIds = animations.map((a) => a.id);
  const newAnimations: ClipAnimation[] = [];
  for (const a of animations) {
    const target = idOf.get(a.targetId) ?? groupIdOf.get(a.targetId);
    if (!target) continue;
    newAnimations.push({
      ...a,
      id: createAnimationId([...animIds, ...newAnimations.map((n) => n.id)]),
      targetId: target,
    });
  }

  const i = doc.tracks.findIndex((t) => t.id === trackId);
  const tracks = [...doc.tracks];
  tracks.splice(i + 1, 0, newTrack); // 元の**すぐ手前**（配列の後ろほど手前・11 §7.6）
  const next: TimelineProject = { ...doc, tracks, clips: [...doc.clips, ...clips] };
  if (newGroups.length > 0) next.groups = [...groups, ...newGroups];
  if (newAnimations.length > 0) next.animations = [...animations, ...newAnimations];
  return ok(next);
}

/**
 * 列を**指した位置へ**動かす（#767・掴んで並べ替える）。`toIndex` は**動かす前の並び**での落とし先。
 * 端を越える指定は端で止める（寄せない・置けないを作らない＝並べ替えは必ずどこかへ着く）。
 *
 * ⚠️ **重ね順は配列の並びだけ**（11 §7.6）＝並べ替えると**絵の重なりがその場で変わる**。
 * 1段ずつの「手前へ／奥へ」（`moveTrackOrder`）と**同じ関数**を通す（規則を2つ持たない）。
 */
export function moveTrackTo(doc: TimelineProject, trackId: string, toIndex: number): EditResult {
  const from = doc.tracks.findIndex((t) => t.id === trackId);
  if (from < 0) return blocked(EDIT_BLOCKED.notFound);
  // ⚠️ **固定した列は並べ替えない**（レビュー）＝並べ替えは**重ね順＝絵そのもの**を変える操作。
  // 「動かせないように固定する」と言いながら絵が変わる、を作らない（消せないのと同じ扱い・ADR-0026②）。
  if (doc.tracks[from].locked) return blocked(EDIT_BLOCKED.locked);
  const to = Math.max(0, Math.min(doc.tracks.length - 1, toIndex));
  if (to === from) return ok(doc); // 変わらないなら**同じ文書を返す**（空振りの取り消しを積まない）
  const tracks = [...doc.tracks];
  const [moved] = tracks.splice(from, 1);
  tracks.splice(to, 0, moved);
  return ok({ ...doc, tracks });
}

/** 列の表示/非表示・固定を切り替える（描画・書き出しから外す／移動とトリムを禁じる）。 */
export function setTrackFlag(doc: TimelineProject, trackId: string, flag: 'hidden' | 'locked', value: boolean): TimelineProject {
  return {
    ...doc,
    tracks: doc.tracks.map((t) => (t.id === trackId ? { ...t, [flag]: value } : t)),
  };
}

/**
 * クリップを複製して、**同じ列の空いている直後**へ置く（空いていなければ置けない＝理由を返す）。
 * 「置く」の最短経路（まず複製して動かす）として用意する。
 */
export function duplicateClip(doc: TimelineProject, clipId: string): EditResult {
  const clip = doc.clips.find((c) => c.id === clipId);
  if (!clip) return blocked(EDIT_BLOCKED.notFound);
  const startSec = clipEndSec(clip);
  // 列の事情は `trackPlacementIssue`（**新しく作る側**なので隠しも断る・#744 レビュー）。
  // ⚠️ 最初は `placementIssue` を通していたが、あれの隠し免除は「渡された行き先が元の列と同じ」だけを
  // 見るので、**複製は必ず免除されて隠した列に増えて**いた＝自分で書いた「見えないものが増える
  // わけではない」と矛盾する。**既にあるものを動かす・縮める＝通す／新しく作る＝断る**が規則。
  const trackIssue = trackPlacementIssue(doc, clip.trackId, trackKindForClip(clip.kind));
  if (trackIssue) return blocked(trackIssue);
  if (!isFreeSpan(doc.clips, clip.trackId, startSec, clip.durationSec)) return blocked(EDIT_BLOCKED.overlap);
  const next: TimelineClip = { ...clip, id: createClipId(doc.clips.map((c) => c.id)), startSec };
  // 読み上げは**作成済みの音声を引き継がない**（場面形式の場面複製と同じ＝「作成済みに見えるのに
  // 別の部品の音声を指す」を作らない）。文と話者は残るので作り直せる。
  if (next.voice) next.voice = { ...next.voice, voicePath: null, status: NARRATION_STATUS.none };
  // **連動は引き継がない**（読み上げと同じ区間になるので、複製した瞬間に必ず重なる＝以後その読み上げを
  // 動かすたびに断られる）。連動したい場合は複製後に選び直す。
  // ⚠️ **落とす前に、いま出ている文を焼き付ける**（#787）＝自分の文を持たない連動字幕をそのまま落とすと
  // **文も連動先も無い＝何も出ない帯**になる（黙って中身が消えたのと同じ・§2-5／ADR-0026④）。
  // 焼き付けたあとは普通の字幕なので、書き換えも消すこともできる。
  if (next.voiceClipId) {
    const baked = subtitleTextOf(doc, clip);
    if (baked) next.text = baked;
    delete next.voiceClipId;
  }
  return ok({ ...doc, clips: [...doc.clips, next] });
}

/**
 * 見た目パターンのクリップの**差し込み口に素材を入れる／外す**（ADR-0032 決定5＝差し込み口は生きている）。
 *
 * 固定した列（`locked`）の部品は中身も変えない＝「動かせないのに中身は変えられる」という非対称を作らない
 * （ADR-0026②・画面は欄自体を押せなくして理由を出す）。
 *
 * **「なし」はキーごと落とす**。`null` と未指定は解決が同じ（どちらもテンプレ既定素材へ落ちる＝`11 §5`）
 * なので、`null` を残すと**絵は変わらないのに文書だけ変わる**＝取り消しが1段空振りする。
 * （テンプレ既定素材を「なし」で消せないのは場面形式と同じ挙動＝ADR-0026②。）
 */
export function setClipAssetRef(
  doc: TimelineProject,
  clipId: string,
  layerId: string,
  assetId: string | null,
): EditResult {
  const clip = doc.clips.find((c) => c.id === clipId);
  if (!clip) return blocked(EDIT_BLOCKED.notFound);
  if (doc.tracks.find((t) => t.id === clip.trackId)?.locked) return blocked(EDIT_BLOCKED.locked);
  // 何も変わらないなら文書をそのまま返す＝取り消しが空振りする履歴を積ませない。
  // 比べるのは**解決した値**（`null` と未指定は同じ意味）。
  if ((clip.assetRefs?.[layerId] ?? null) === assetId) return ok(doc);
  const assetRefs = { ...clip.assetRefs };
  if (assetId === null) delete assetRefs[layerId];
  else assetRefs[layerId] = assetId;
  return ok(withClip(doc, { ...clip, assetRefs }));
}

/**
 * 見た目パターンのクリップの**文字を書き換える**（差し込み口は生きている）。
 * 空にしたときはキーごと落とす＝「空文字を入れた」と「入れていない」を別扱いにしない
 * （場面形式の `texts` と同じ解決＝空は描かれない）。
 */
export function setClipText(doc: TimelineProject, clipId: string, textKey: TextKey, text: string): EditResult {
  const clip = doc.clips.find((c) => c.id === clipId);
  if (!clip) return blocked(EDIT_BLOCKED.notFound);
  if (doc.tracks.find((t) => t.id === clip.trackId)?.locked) return blocked(EDIT_BLOCKED.locked);
  if ((clip.texts?.[textKey] ?? '') === text) return ok(doc);
  const texts: Texts = { ...clip.texts };
  if (text === '') delete texts[textKey];
  else texts[textKey] = text;
  return ok(withClip(doc, { ...clip, texts }));
}

/**
 * 見た目パターンを**素材として置く**（ADR-0032 決定6＝テンプレは「楽をするための素材」）。
 * 置き先は指定の列の指定の時刻。空いていなければ置かない（寄せない・上書きしない＝理由を返す）。
 *
 * 長さは**テンプレを受け取って domain で決める**（`defaultDurationForTemplate`＝場面形式の「新しい場面」と
 * 同じ関数）＝同じテンプレが形式や呼び出し口によって違う長さで出てこない（ADR-0026②）。
 */
export function addTemplateClip(
  doc: TimelineProject,
  input: { template: Pick<Template, 'templateId' | 'defaults' | 'aspectRatio'>; trackId: string; startSec: number },
): EditResult {
  // 向きが違うテンプレは層の座標がそのまま使われる（箱＝画面いっぱいなので縮まない）＝画面外へ出る。
  // 画面が一覧を絞っていても、ここで断る＝別の導線からも同じ壊れ方を作れないようにする（ADR-0026④）。
  if (input.template.aspectRatio !== doc.videoSettings.aspectRatio) return blocked(EDIT_BLOCKED.orientation);
  // 列の事情は `trackPlacementIssue`（置く側は**隠した列も断る**＝動画に出ない部品を新しく作らない）。
  // 手書きで並べていたので `hidden` だけ抜けていた（画面が一覧を絞るので届いていなかっただけ・#714 レビュー）。
  const trackIssue = trackPlacementIssue(doc, input.trackId, trackKindForClip(TIMELINE_CLIP_KIND.template));
  if (trackIssue) return blocked(trackIssue);
  const startSec = Math.max(0, input.startSec);
  const durationSec = Math.max(TIMELINE_MIN_CLIP_SEC, defaultDurationForTemplate(input.template));
  if (!isFreeSpan(doc.clips, input.trackId, startSec, durationSec)) return blocked(EDIT_BLOCKED.overlap);
  // **箱は持たない**＝未指定は画面いっぱい（`clipBox`）。焼き出し（`bake.ts`）も同じく持たないので、
  // 見た目パターンのクリップの箱の持ち方が2通りにならない（向きを変えたときに片方だけ古い大きさで残る）。
  const clip: TimelineClip = {
    id: createClipId(doc.clips.map((c) => c.id)),
    kind: TIMELINE_CLIP_KIND.template,
    trackId: input.trackId,
    startSec,
    durationSec,
    templateId: input.template.templateId,
  };
  return ok({ ...doc, clips: [...doc.clips, clip] });
}

/**
 * 連動している字幕クリップも一緒に動かす（ADR-0032 決定24）。読み上げ以外は何もしない。
 *
 * **置けないときは全体を断る**（字幕だけ置き去りにしない）＝「連動している」と言った以上、片方だけ
 * 動いた結果を黙って作らない（§2-5・ADR-0026④）。理由は置けなかった字幕のもの。
 */
function withBoundSubtitles(
  next: TimelineProject,
  before: TimelineProject,
  moved: TimelineClip,
  span: { startSec: number; durationSec: number },
): EditResult {
  if (moved.kind !== TIMELINE_CLIP_KIND.voice) return ok(next);
  let doc = next;
  for (const sub of subtitlesBoundTo(before, moved.id)) {
    if (span.startSec === sub.startSec && span.durationSec === sub.durationSec) continue;
    const moving = { ...sub, ...span };
    // 置けない理由は**字幕側**のもの。そのまま返すと「触ってもいない列が固定されています」に見えるので、
    // 連動のせいで置けないと分かる理由にまとめる（§2-5＝次の行動へ導く）。
    if (placementIssue(doc, moving, moving.trackId, moving.startSec, moving.durationSec)) {
      return blocked(EDIT_BLOCKED.linkedSubtitle);
    }
    doc = withClip(doc, moving);
  }
  return ok(doc);
}

/**
 * 字幕クリップの**連動先**を決める／やめる（ADR-0032 決定24）。`null` で連動をやめる。
 *
 * 連動を始めたら**その場で時間も合わせる**＝「連動する」と言ったのに位置がずれたまま、を作らない。
 * 置けないときは断る（黙って別の場所に置かない）。
 */
export function setSubtitleVoiceLink(doc: TimelineProject, clipId: string, voiceClipId: string | null): EditResult {
  const clip = doc.clips.find((c) => c.id === clipId);
  if (!clip || clip.kind !== TIMELINE_CLIP_KIND.subtitle) return blocked(EDIT_BLOCKED.notFound);
  if (doc.tracks.find((t) => t.id === clip.trackId)?.locked) return blocked(EDIT_BLOCKED.locked);
  if (voiceClipId === null) {
    if (clip.voiceClipId == null) return ok(doc);
    const next = { ...clip };
    delete next.voiceClipId;
    return ok(withClip(doc, next));
  }
  const voice = doc.clips.find((c) => c.id === voiceClipId);
  if (!voice || voice.kind !== TIMELINE_CLIP_KIND.voice) return blocked(EDIT_BLOCKED.notFound);
  const moved = { ...clip, voiceClipId, startSec: voice.startSec, durationSec: voice.durationSec };
  const issue = placementIssue(doc, moved, moved.trackId, moved.startSec, moved.durationSec);
  return issue ? blocked(issue) : ok(withClip(doc, moved));
}

/**
 * 字幕クリップ自身の文（`text`）を書き換える（#633）。**空にすると連動先の読み上げ文に戻る**
 * （`subtitleTextOf` の解決＝自分の文が優先）。空文字は持たない（未入力と別扱いにしない）。
 */
export function setSubtitleText(doc: TimelineProject, clipId: string, text: string): EditResult {
  const clip = doc.clips.find((c) => c.id === clipId);
  if (!clip || clip.kind !== TIMELINE_CLIP_KIND.subtitle) return blocked(EDIT_BLOCKED.notFound);
  if (doc.tracks.find((t) => t.id === clip.trackId)?.locked) return blocked(EDIT_BLOCKED.locked);
  if ((clip.text ?? '') === text) return ok(doc);
  const next = { ...clip };
  if (text === '') delete next.text;
  else next.text = text;
  return ok(withClip(doc, next));
}

/**
 * **読み上げを置く**（ADR-0032 決定7＝タイムライン側でも声を作れる・#633）。
 *
 * 置いた時点では**まだ声を作っていない**（`status='none'`）ので、長さは仮の既定。声を作ると実際の尺へ
 * 合わせ直す（`trimClip` を通す＝連動している字幕も一緒に動く）。
 */
export function addVoiceClip(
  doc: TimelineProject,
  input: { text: string; trackId: string; startSec: number; durationSec?: number },
): EditResult {
  // 列そのものの事情は `trackPlacementIssue`（「置ける列」を数える側と同じ規則・#724 レビュー）。
  // 手書きだと**隠した列を見落とす**（実際に落ちていた＝置けても動画に出ない部品が黙って生まれる）。
  const trackIssue = trackPlacementIssue(doc, input.trackId, trackKindForClip(TIMELINE_CLIP_KIND.voice));
  if (trackIssue) return blocked(trackIssue);
  const startSec = Math.max(0, input.startSec);
  const durationSec = Math.max(TIMELINE_MIN_CLIP_SEC, input.durationSec ?? VOICE_PLACEHOLDER_SEC);
  if (!isFreeSpan(doc.clips, input.trackId, startSec, durationSec)) return blocked(EDIT_BLOCKED.overlap);
  const clip: TimelineClip = {
    id: createClipId(doc.clips.map((c) => c.id)),
    kind: TIMELINE_CLIP_KIND.voice,
    trackId: input.trackId,
    startSec,
    durationSec,
    voice: { text: input.text, status: NARRATION_STATUS.none },
  };
  return ok({ ...doc, clips: [...doc.clips, clip] });
}

/** 読み上げクリップの文を書き換える。**声は作り直しになる**ので、作成済みの音声は外す（別の文の声を指さない）。 */
export function setVoiceText(doc: TimelineProject, clipId: string, text: string): EditResult {
  const clip = doc.clips.find((c) => c.id === clipId);
  if (!clip || clip.kind !== TIMELINE_CLIP_KIND.voice || !clip.voice) return blocked(EDIT_BLOCKED.notFound);
  if (doc.tracks.find((t) => t.id === clip.trackId)?.locked) return blocked(EDIT_BLOCKED.locked);
  if (clip.voice.text === text) return ok(doc);
  return ok(
    withClip(doc, {
      ...clip,
      voice: { ...clip.voice, text, voicePath: null, status: NARRATION_STATUS.none },
    }),
  );
}

/** 読み上げクリップの話者を変える（`null`＝動画全体の声を継承）。文と同じく作成済みの音声は外す。 */
export function setVoiceSpeaker(doc: TimelineProject, clipId: string, speaker: number | null): EditResult {
  const clip = doc.clips.find((c) => c.id === clipId);
  if (!clip || clip.kind !== TIMELINE_CLIP_KIND.voice || !clip.voice) return blocked(EDIT_BLOCKED.notFound);
  if (doc.tracks.find((t) => t.id === clip.trackId)?.locked) return blocked(EDIT_BLOCKED.locked);
  if ((clip.voice.speaker ?? null) === speaker) return ok(doc);
  const voice = { ...clip.voice, voicePath: null, status: NARRATION_STATUS.none };
  if (speaker === null) delete voice.speaker;
  else voice.speaker = speaker;
  return ok(withClip(doc, { ...clip, voice }));
}

/**
 * **その読み上げの字幕を置く**（#633＝「声を作る → 字幕が連動して出る」の入口）。
 *
 * 置き場所は**同じ時間が空いている映像の列**を探し、無ければ**列を足す**（置けないと言って終わらせない）。
 * 見た目の既定（画面下の字幕バー）は自由配置の字幕要素と**同じ関数**から採る＝形式で見た目が割れない。
 */
export function addLinkedSubtitleClip(doc: TimelineProject, voiceClipId: string): EditResult {
  const voice = doc.clips.find((c) => c.id === voiceClipId);
  if (!voice || voice.kind !== TIMELINE_CLIP_KIND.voice) return blocked(EDIT_BLOCKED.notFound);
  const canvas = dimsForOrientation(doc.videoSettings.aspectRatio);
  const el = createFreeElement([], FREE_ELEMENT_KIND.subtitle, canvas.width, canvas.height);
  const { id: _elId, kind: _kind, zIndex: _z, subtitleSource: _src, ...spatial } = el;
  void _elId;
  void _kind;
  void _z;
  void _src;

  // 置ける映像の列を探す（同じ時間が空いていて固定されていないもの）。無ければ足す。
  // **隠した列は選ばない**＝置けても動画に出ない字幕が黙って生まれる（自分で列を選ぶ操作と違い、
  // 置き場所を任せているので気づけない）。該当が無ければ列を足す。
  const free = doc.tracks.find(
    (t) =>
      t.kind === TRACK_KIND.visual &&
      !t.locked &&
      !t.hidden &&
      isFreeSpan(doc.clips, t.id, voice.startSec, voice.durationSec),
  );
  const trackId = free?.id ?? createTrackId(doc.tracks.map((t) => t.id));
  const tracks = free ? doc.tracks : [...doc.tracks, { id: trackId, kind: TRACK_KIND.visual }];
  const clip: TimelineClip = {
    ...spatial,
    id: createClipId(doc.clips.map((c) => c.id)),
    kind: TIMELINE_CLIP_KIND.subtitle,
    trackId,
    startSec: voice.startSec,
    durationSec: voice.durationSec,
    voiceClipId,
  };
  return ok({ ...doc, tracks, clips: [...doc.clips, clip] });
}

/**
 * **音を置く**（#634）＝同梱BGM または持ち込んだ音の素材を音の列へ。
 *
 * 長さは指定（無ければ仮の既定）。素材より長い置き場所は**繰り返して埋まる**（BGM の流儀＝`11 §7.6.5`）ので、
 * 尺が分からなくても置ける。トリム（`sourceStartSec`）と速さ（`speed`）は置いたあとに変えられる。
 */
/**
 * **絵のもの（写真・文字・図形）を置く**（#684・ADR-0034 段階1）。`addAudioClip` と同じ流儀＝
 * 置けない場所は理由を返し、黙って別の場所へ寄せない。
 *
 * - **箱は真ん中に置く**（`PLACED_BOX_RATIO`）＝置いた瞬間に画面で見える。座標を指定されたら
 *   そこを**箱の中心**として置く（キャンバスへ落としたとき＝落とした場所に置く）。画面外へは出さない。
 * - 長さは仮（`VISUAL_CLIP_DURATION_SEC`＝`VISUAL_PLACEHOLDER_SEC` を下限で丸めたもの）＝掴んで伸ばせる程度。
 * - 素材は**この動画が持っているものだけ**（`doc.assets`）＝存在しない素材の枠を作らない。
 */
/** 置く先の指定（置けるかどうかを見るのに要る分だけ）。 */
export type VisualPlacement = {
  kind: typeof TIMELINE_CLIP_KIND.slot | typeof TIMELINE_CLIP_KIND.text | typeof TIMELINE_CLIP_KIND.shape;
  trackId: string;
  startSec: number;
  /** kind='slot' のとき入れる素材。 */
  assetId?: string;
};

/**
 * **その列が部品を受けられるか**（受けられないなら理由・`null`＝受けられる・#722）。
 *
 * 見るのは**列そのものの事情だけ**（実在する・固定していない・出す設定・種別が合う）。
 * 時刻の重なりと素材の実在は**置く場所ごとの話**なので `visualPlacementIssue` の担当。
 *
 * ⚠️ **ここが「置ける列」の単一の参照元**（#722 レビュー）。同じ条件が
 * `placeableVisualTracks`（候補を数える側）と `visualPlacementIssue`（1か所を断る側）に
 * **別々に書かれていた**＝条件を1つ足すと片方だけ直す事故が起きる。両方をここから導く。
 *
 * **真偽値ではなく理由を返す**のは、`locked`／`hiddenTrack`／`trackKind` で**次の行動が違う**ため
 * （固定を外す／表示に戻す／別の列へ置き直す＝§2-5）。ここを boolean に畳むと案内が痩せる。
 */
export function trackPlacementIssue(
  doc: TimelineProject,
  trackId: string,
  wantKind: TrackKind,
): EditBlockedReason | null {
  const track = doc.tracks.find((t) => t.id === trackId);
  if (!track) return EDIT_BLOCKED.notFound;
  if (track.locked) return EDIT_BLOCKED.locked;
  if (track.hidden) return EDIT_BLOCKED.hiddenTrack;
  if (track.kind !== wantKind) return EDIT_BLOCKED.trackKind;
  return null;
}

/**
 * **絵の部品を置ける列**を「手前が先」の順で返す（#722）。
 *
 * 条件は `trackPlacementIssue` から導く＝候補を数える側と1か所を断る側で規則が割れない。
 *
 * **順は手前から**（配列の末尾が手前＝`11 §7.6` の重ね順）。ボタンで置くときは**先頭を使う**ので、
 * 新しく置いた部品が既にあるものの後ろに隠れない（`06 §12.1`「必ず仕上がり確認に現れる」）。
 */
export function placeableVisualTracks(doc: TimelineProject): Track[] {
  return placeableTracksOfKind(doc, TRACK_KIND.visual);
}

/** **音の部品を置ける列**（#724）。映像側と**同じ規則・同じ向き**で返す（片方だけ奥から、を作らない）。 */
export function placeableAudioTracks(doc: TimelineProject): Track[] {
  return placeableTracksOfKind(doc, TRACK_KIND.audio);
}

function placeableTracksOfKind(doc: TimelineProject, kind: TrackKind): Track[] {
  return doc.tracks.filter((t) => trackPlacementIssue(doc, t.id, kind) == null).reverse();
}

/**
 * その場所へ置けるか（置けないなら理由・#684）。
 *
 * **ドラッグ中のゴーストと、実際に置く判定が同じものを見る**ための単一の参照元＝
 * 「置けそうに見えたのに離したら断られる」「置けないはずの所へ置けた」を作らない（ADR-0034 決定10）。
 * **出さない設定の列も断る**＝置けても動画に出ない部品が黙って生まれる（ボタンで置くときも避けている）。
 */
export function visualPlacementIssue(doc: TimelineProject, input: VisualPlacement): EditBlockedReason | null {
  // 列そのものの事情は `trackPlacementIssue`（「置ける列」を数える側と同じ規則・#722 レビュー）。
  const trackIssue = trackPlacementIssue(doc, input.trackId, trackKindForClip(input.kind));
  if (trackIssue) return trackIssue;
  if (input.kind === TIMELINE_CLIP_KIND.slot) {
    if (input.assetId == null || !doc.assets.some((a) => a.assetId === input.assetId)) {
      return EDIT_BLOCKED.notFound;
    }
  }
  if (!isFreeSpan(doc.clips, input.trackId, Math.max(0, input.startSec), VISUAL_CLIP_DURATION_SEC)) {
    return EDIT_BLOCKED.overlap;
  }
  return null;
}

export function addVisualClip(
  doc: TimelineProject,
  input: VisualPlacement & {
    /** 箱の中心（未指定＝画面の真ん中）。キャンバスへ落としたときに使う。 */
    center?: { x: number; y: number };
  },
): EditResult {
  const issue = visualPlacementIssue(doc, input);
  if (issue) return blocked(issue);
  const startSec = Math.max(0, input.startSec);
  const durationSec = VISUAL_CLIP_DURATION_SEC;
  const canvas = dimsForOrientation(doc.videoSettings.aspectRatio);
  const ratio = PLACED_BOX_RATIO[input.kind];
  const w = Math.round(canvas.width * ratio.w);
  const h = Math.round(canvas.height * ratio.h);
  const center = input.center ?? { x: canvas.width / 2, y: canvas.height / 2 };
  // **画面の外へは置かない**（落とした先が端でも、箱ごと見える位置へ収める）。
  const x = Math.round(Math.min(Math.max(0, center.x - w / 2), Math.max(0, canvas.width - w)));
  const y = Math.round(Math.min(Math.max(0, center.y - h / 2), Math.max(0, canvas.height - h)));
  const clip: TimelineClip = {
    id: createClipId(doc.clips.map((c) => c.id)),
    kind: input.kind,
    trackId: input.trackId,
    startSec,
    durationSec,
    x, y, w, h,
    ...(input.kind === TIMELINE_CLIP_KIND.slot ? { assetId: input.assetId } : {}),
    // 置いた直後から**見えて・直せる**ように、初期値を入れておく（#684）。
    // **文字は空にしない**＝空文字は描かれず「置いたのに見えない」になる。既定は場面形式の「文字を足す」と同じ
    // （同じ物を足すのに形式で見た目が違う、を作らない・ADR-0026②）。大きさは画面の広さに合わせて伸ばす。
    ...(input.kind === TIMELINE_CLIP_KIND.text
      ? {
        text: DEFAULT_TEXT,
        fontSize: Math.round(DEFAULT_TEXT_FONT_SIZE * (canvas.width / WIDTH)),
        color: DEFAULT_TEXT_COLOR,
      }
      : {}),
    // 図形の既定は**場面形式の「図形を足す」と同じ**（同じ物を足すのに別の色が出ない・ADR-0026②）。
    ...(input.kind === TIMELINE_CLIP_KIND.shape
      ? { shapeType: FREE_SHAPE_TYPE.rect, fillColor: DEFAULT_SHAPE_COLOR, opacity: 1 }
      : {}),
  };
  return ok({ ...doc, clips: [...doc.clips, clip] });
}

/**
 * **置いた部品の中身を直す**（#684）＝写真の差し替え・文字・図形の色や形。
 * 「置けるのに直せない」を作らないための入口で、幾何（場所・大きさ）は別の操作（#685）。
 *
 * 渡された分だけを変える（未指定は触らない）。**その種類が持たない項目は断る**。
 */
/**
 * 種類ごとに直せる項目（#684）。`TimelineClip` は全種別の項目を任意で持つ平らな形なので、
 * **どの種類が何を持つか**はここが単一の参照元（型では縛れない）。
 */
const VISUAL_CONTENT_KEYS = {
  [TIMELINE_CLIP_KIND.slot]: ['assetId', 'fit'],
  [TIMELINE_CLIP_KIND.text]: ['text', 'fontSize', 'color', 'fontId', 'fontWeight', 'textAlign'],
  [TIMELINE_CLIP_KIND.shape]: ['shapeType', 'fillColor'],
} as const;

export function setVisualClipContent(
  doc: TimelineProject,
  clipId: string,
  patch: Partial<Pick<TimelineClip,
    'text' | 'fontSize' | 'color' | 'fontId' | 'fontWeight' | 'textAlign' | 'shapeType' | 'fillColor' | 'assetId' | 'fit'>>,
): EditResult {
  const clip = doc.clips.find((c) => c.id === clipId);
  if (!clip) return blocked(EDIT_BLOCKED.notFound);
  // **その種類が持つ項目だけを受ける**（`TimelineClip` は全種別の項目を任意で持つ平らな形なので、
  // 型では縛れない＝ここで断る）。音の部品に図形の色を書く、のような意味の無いデータを作らない
  // （`11 §7.6.3.2` の「鳴る音を持たない部品には置けない」と同じ流儀）。
  // **列の種別違い（V23）と混ぜない**＝「列に置き直してください」は項目違いには当たらない案内になる（§2-5）。
  const allowed = VISUAL_CONTENT_KEYS[clip.kind as keyof typeof VISUAL_CONTENT_KEYS];
  if (!allowed) return blocked(EDIT_BLOCKED.contentField);
  if (!Object.keys(patch).every((k) => (allowed as readonly string[]).includes(k))) {
    return blocked(EDIT_BLOCKED.contentField);
  }
  const track = doc.tracks.find((t) => t.id === clip.trackId);
  if (track?.locked) return blocked(EDIT_BLOCKED.locked);
  // 素材は**この動画が持っているものだけ**（存在しない素材を指させない）。
  if (patch.assetId != null && !doc.assets.some((a) => a.assetId === patch.assetId)) {
    return blocked(EDIT_BLOCKED.notFound);
  }
  // **何も変わらないなら同じ文書を返す**（空振りの取り消しを積まない・`11 §7.6.3`）。
  // ⚠️ 比べるのは**解決した値**（#731）＝`null` と未指定は解決が同じ（どちらも継承／「なし」）。
  // 素の `===` だと `undefined === null` が false になり、**絵は変わらないのに文書だけ変わる**
  // ＝取り消しが1段空振りする。`setClipAssetRef` が既にこの流儀（`11 §7.6.3`）。
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (keys.every((k) => (clip[k] ?? null) === (patch[k] ?? null))) return ok(doc);
  const next = { ...clip, ...patch };
  // **`null` はキーごと落とす**（同上）＝未指定との違いを文書に残さない。残すと、同じ絵の文書が
  // 2通りできて「取り消しても見た目が変わらない」段が生まれる。
  for (const k of keys) if (patch[k] === null) delete next[k];
  return ok(withClip(doc, next));
}

export function addAudioClip(
  doc: TimelineProject,
  input: { bundledBgmId?: BundledBgmId; assetId?: string; trackId: string; startSec: number; durationSec?: number },
): EditResult {
  // 列そのものの事情は `trackPlacementIssue`（「置ける列」を数える側と同じ規則・#724 レビュー）。
  // 手書きだと**隠した列を見落とす**（実際に落ちていた＝置けても動画に出ない部品が黙って生まれる）。
  const trackIssue = trackPlacementIssue(doc, input.trackId, trackKindForClip(TIMELINE_CLIP_KIND.audio));
  if (trackIssue) return blocked(trackIssue);
  // 音の出どころは高々1つ（`11 §8` V25）＝どちらも渡されたら置かない（黙って一方を選ばない）。
  if ((input.bundledBgmId == null) === (input.assetId == null)) return blocked(EDIT_BLOCKED.notFound);
  if (input.assetId != null && !doc.assets.some((a) => a.assetId === input.assetId)) {
    return blocked(EDIT_BLOCKED.notFound);
  }
  const startSec = Math.max(0, input.startSec);
  const durationSec = Math.max(TIMELINE_MIN_CLIP_SEC, input.durationSec ?? AUDIO_PLACEHOLDER_SEC);
  if (!isFreeSpan(doc.clips, input.trackId, startSec, durationSec)) return blocked(EDIT_BLOCKED.overlap);
  const clip: TimelineClip = {
    id: createClipId(doc.clips.map((c) => c.id)),
    kind: TIMELINE_CLIP_KIND.audio,
    trackId: input.trackId,
    startSec,
    durationSec,
    ...(input.bundledBgmId != null ? { bundledBgmId: input.bundledBgmId } : { assetId: input.assetId }),
  };
  return ok({ ...doc, clips: [...doc.clips, clip] });
}

/**
 * 音・動画の素材の**再生速度**（#634・`11 §7.6.5`）。1＝そのまま。
 *
 * **クリップの長さは変えない**＝速さは「置き場所ぶんの時間に、素材のどれだけを流すか」を決める
 * （2倍速なら倍の長さぶんの素材が入る）。再生（`audioCuesAt`）と書き出し（`timelineAudioRuns`）は
 * どちらもこの値を読むので、聞いた音と書き出した音が一致する。
 */
/**
 * **置いた部品の位置・大きさ・向きを決める**（#685・`11 §7.6.3`）。
 *
 * ⚠️ **触った時点で箱ぜんぶを書き込む**（渡された項目だけを足さない）。箱は**未指定＝画面いっぱい**
 * なので、`x` だけ書くと幅は画面いっぱいのままで**そこから右へはみ出す**＝画面に出ている数値
 * （解決した箱）と保存する値が食い違う。**見えている値を編集している**状態を保つ。
 *
 * 向きは schema が 0〜360 未満（`ROTATION_DEG_MAX`）しか受けないので、**回り込ませて**収める
 * （はみ出した値で保存できない＝自動保存が黙って止まる、を作らない）。大きさは 0 より大きい。
 */
export function setClipBox(
  doc: TimelineProject,
  clipId: string,
  canvas: { width: number; height: number },
  patch: { x?: number; y?: number; w?: number; h?: number; rotation?: number },
): EditResult {
  const clip = doc.clips.find((c) => c.id === clipId);
  if (!clip) return blocked(EDIT_BLOCKED.notFound);
  // **箱を持てる部品だけ**（音・読み上げに位置は無い／見た目パターンのクリップは枠そのもの＝
  // 幾何を持たない・`11 §7.6.3`）。列の種別違い（V23）とは別の話なので `contentField` で断る。
  if (!canHaveBox(clip.kind)) return blocked(EDIT_BLOCKED.contentField);
  const track = doc.tracks.find((t) => t.id === clip.trackId);
  if (track?.locked) return blocked(EDIT_BLOCKED.locked);
  const from = resolveClipBox(clip, canvas);
  const rot = patch.rotation ?? from.rotation ?? 0;
  const next = {
    x: patch.x ?? from.x,
    y: patch.y ?? from.y,
    w: Math.max(MIN_BOX_SIZE_PX, patch.w ?? from.w),
    h: Math.max(MIN_BOX_SIZE_PX, patch.h ?? from.h),
    // 負の角も 360 以上も**回り込ませる**（共有の `normalizeDeg`）。
    // ⚠️ **数値の欄は先に 0〜359 へ丸める**ので、いま到達するのは後半（#685 のキャンバス回転）だけ。
    // それでもここで受けるのは、指で回すと 360 を跨ぐのが普通だから（保存できない値で止めない）。
    rotation: normalizeDeg(rot),
  };
  // **何も変わらないなら同じ文書を返す**（空振りの取り消しを積まない・`11 §7.6.3`）。
  if (clip.x === next.x && clip.y === next.y && clip.w === next.w && clip.h === next.h
    && (clip.rotation ?? 0) === next.rotation) return ok(doc);
  return ok(withClip(doc, { ...clip, ...next }));
}

/**
 * **まとめて箱を変える**（#685 レビュー）。ADR-0034 決定15 の「**1つでも置けなければ全体を断る**」。
 *
 * ⚠️ 1件ずつ `setClipBox` を呼ぶと、**固定した列の部品だけ黙って取り残される**（群の形が崩れる）。
 * しかも理由は最後の1件ぶんしか残らない。**全部通るか、何もしないか**にする（`removeClipsByIds` と同じ流儀）。
 */
export function setClipBoxes(
  doc: TimelineProject,
  canvas: { width: number; height: number },
  updates: readonly { id: string; patch: { x?: number; y?: number; w?: number; h?: number; rotation?: number } }[],
): EditResult {
  let next = doc;
  for (const u of updates) {
    const r = setClipBox(next, u.id, canvas, u.patch);
    if (!r.ok) return r; // 1つでも駄目なら**何もしない**（途中まで動いた文書を返さない）
    next = r.doc;
  }
  return ok(next);
}

export function setClipSpeed(doc: TimelineProject, clipId: string, speed: number): EditResult {
  const clip = doc.clips.find((c) => c.id === clipId);
  if (!clip) return blocked(EDIT_BLOCKED.notFound);
  if (doc.tracks.find((t) => t.id === clip.trackId)?.locked) return blocked(EDIT_BLOCKED.locked);
  // schema は `exclusiveMinimum: 0`＝0 以下は保存できない文書になる。範囲へ収める（§2-7 の下限を共有）。
  const next = Math.min(Math.max(CLIP_SPEED_MIN, speed), CLIP_SPEED_MAX);
  if ((clip.speed ?? 1) === next) return ok(doc);
  const patched = { ...clip };
  if (next === 1) delete patched.speed; // 等速は持たない（既定と同じ値を書かない）
  else patched.speed = next;
  return ok(withClip(doc, patched));
}

/** 素材の**どこから使うか**（秒・0＝頭から）。負にはしない（素材の外は読めない）。 */
export function setClipSourceStart(doc: TimelineProject, clipId: string, sec: number): EditResult {
  const clip = doc.clips.find((c) => c.id === clipId);
  if (!clip) return blocked(EDIT_BLOCKED.notFound);
  if (doc.tracks.find((t) => t.id === clip.trackId)?.locked) return blocked(EDIT_BLOCKED.locked);
  const next = Math.max(0, sec);
  if ((clip.sourceStartSec ?? 0) === next) return ok(doc);
  const patched = { ...clip };
  if (next === 0) delete patched.sourceStartSec;
  else patched.sourceStartSec = next;
  return ok(withClip(doc, patched));
}

/**
 * **音の部品の音源を選び直す**（#695・#723）。同梱BGM か、持ち込んだ音の素材のどちらか。
 *
 * これが無いと、素材が見つからない部品に対して「音を選び直してください」と案内しながら**選び直す手段が
 * 無い**＝行き止まり（ADR-0034 決定5）。読み上げは「声を作る」で作り直せるので非対称でもあった。
 * 消して置き直す道はあるが、それだと**速さ・音量・フェード・音量の変化がすべて消える**。
 *
 * **音の出どころは高々1つ**（`§8` V25）＝入れ替えるときは**もう一方を必ず落とす**（両方持つ部品を作らない）。
 * 素材は**この動画が持っているもの**だけ（存在しない参照を作らない）。
 */
export function setClipAudioSource(
  doc: TimelineProject,
  clipId: string,
  source: { bundledBgmId: BundledBgmId } | { assetId: string },
): EditResult {
  const clip = doc.clips.find((c) => c.id === clipId);
  if (!clip) return blocked(EDIT_BLOCKED.notFound);
  // **種別を先に見る**（#734 レビュー）＝そもそも音を持たない部品に対して「固定を外してください」と
  // 返すと、外しても直らない案内になる（§2-5）。兄弟の `setVisualClipContent` も項目違いが先。
  if (clip.kind !== TIMELINE_CLIP_KIND.audio) return blocked(EDIT_BLOCKED.contentField);
  if (doc.tracks.find((t) => t.id === clip.trackId)?.locked) return blocked(EDIT_BLOCKED.locked);
  const next = { ...clip };
  if ('bundledBgmId' in source) {
    if (clip.bundledBgmId === source.bundledBgmId) return ok(doc); // 何も変わらない＝取り消しが空振りしない
    next.bundledBgmId = source.bundledBgmId;
    delete next.assetId; // V25＝両方は持たせない
  } else {
    if (!doc.assets.some((a) => a.assetId === source.assetId)) return blocked(EDIT_BLOCKED.notFound);
    if (clip.assetId === source.assetId) return ok(doc);
    next.assetId = source.assetId;
    delete next.bundledBgmId;
  }
  return ok(withClip(doc, next));
}

/** 音量（0〜1.5・`null` で「動画全体に合わせる」＝継承へ戻す・`11 §6`）。 */
export function setClipVolume(doc: TimelineProject, clipId: string, volume: number | null): EditResult {
  const clip = doc.clips.find((c) => c.id === clipId);
  if (!clip) return blocked(EDIT_BLOCKED.notFound);
  if (doc.tracks.find((t) => t.id === clip.trackId)?.locked) return blocked(EDIT_BLOCKED.locked);
  const next = volume == null ? null : Math.min(Math.max(0, volume), VOLUME_MAX);
  if ((clip.volume ?? null) === next) return ok(doc);
  const patched = { ...clip };
  if (next == null) delete patched.volume;
  else patched.volume = next;
  return ok(withClip(doc, patched));
}

/** 前後のフェード（秒・0 で無し）。**尺の半分までに切り詰めるのは再生・書き出し側**（`clipFadeSec`）。 */
export function setClipFade(doc: TimelineProject, clipId: string, edge: 'in' | 'out', sec: number): EditResult {
  const clip = doc.clips.find((c) => c.id === clipId);
  if (!clip) return blocked(EDIT_BLOCKED.notFound);
  if (doc.tracks.find((t) => t.id === clip.trackId)?.locked) return blocked(EDIT_BLOCKED.locked);
  const key = edge === 'in' ? 'fadeInSec' : 'fadeOutSec';
  const next = Math.max(0, sec);
  if ((clip[key] ?? 0) === next) return ok(doc);
  const patched = { ...clip };
  if (next === 0) delete patched[key];
  else patched[key] = next;
  return ok(withClip(doc, patched));
}

/**
 * **切り抜き**（#634）＝クリップの箱の各辺を「箱の大きさに対する割合」で隠す。中身は動かない。
 *
 * 各辺は 0〜1 未満へ収め、**同じ軸の合計も 1 未満**に保つ（`11 §8` V30＝丸ごと消える設定を作らない。
 * 足し合わせが 1 を超える指定は、**いま動かした側を優先して反対側を詰める**＝入力を黙って捨てない）。
 * すべて 0 になったらキーごと落とす（既定と同じ値を書かない）。
 */
export function setClipCrop(
  doc: TimelineProject,
  clipId: string,
  edge: 'top' | 'right' | 'bottom' | 'left',
  value: number,
): EditResult {
  const clip = doc.clips.find((c) => c.id === clipId);
  if (!clip) return blocked(EDIT_BLOCKED.notFound);
  if (doc.tracks.find((t) => t.id === clip.trackId)?.locked) return blocked(EDIT_BLOCKED.locked);
  const current = clip.crop ?? {};
  const next: NonNullable<TimelineClip['crop']> = { ...current };
  const opposite = edge === 'top' ? 'bottom' : edge === 'bottom' ? 'top' : edge === 'left' ? 'right' : 'left';
  const moved = Math.min(Math.max(0, value), CROP_MAX);
  next[edge] = moved;
  // 反対側と合わせて 1 を超えるなら、反対側を詰める（動かした側の指定は残す）。
  const room = CROP_MAX - moved;
  if ((next[opposite] ?? 0) > room) next[opposite] = Math.max(0, room);
  for (const k of ['top', 'right', 'bottom', 'left'] as const) if (!next[k]) delete next[k];
  const patched = { ...clip };
  if (Object.keys(next).length === 0) delete patched.crop;
  else patched.crop = next;
  if (JSON.stringify(patched.crop ?? null) === JSON.stringify(clip.crop ?? null)) return ok(doc);
  return ok(withClip(doc, patched));
}

/**
 * **素材の寄せ**（#634・`05 §8`）＝`fit:'cover'` で枠に収まらない側をどこで切るか。
 * `null` を渡した軸は「中央（既定）」へ戻す＝既定と同じ値を書かない。
 */
export function setClipCropAlign(
  doc: TimelineProject,
  clipId: string,
  // **軸と値を1つの形で受ける**＝`{x:'top'}` のような食い違いが型で止まる（キャストが要らない）。
  patch: { x: CropAlignX | null } | { y: CropAlignY | null },
): EditResult {
  const clip = doc.clips.find((c) => c.id === clipId);
  if (!clip) return blocked(EDIT_BLOCKED.notFound);
  if (doc.tracks.find((t) => t.id === clip.trackId)?.locked) return blocked(EDIT_BLOCKED.locked);
  const next: NonNullable<TimelineClip['cropAlign']> = { ...clip.cropAlign };
  if ('x' in patch) {
    if (patch.x == null) delete next.x;
    else next.x = patch.x;
  } else if (patch.y == null) delete next.y;
  else next.y = patch.y;
  // 既定（中央）はキーごと落とす＝既定と同じ値を書かない（既定の正典は `domain/enums`）。
  if (next.x === CROP_ALIGN_DEFAULT_X) delete next.x;
  if (next.y === CROP_ALIGN_DEFAULT_Y) delete next.y;
  const patched = { ...clip };
  if (Object.keys(next).length === 0) delete patched.cropAlign;
  else patched.cropAlign = next;
  if (JSON.stringify(patched.cropAlign ?? null) === JSON.stringify(clip.cropAlign ?? null)) return ok(doc);
  return ok(withClip(doc, patched));
}

/**
 * **切り抜きの効かせ方**（#634）。`fill` で「残った素材を枠いっぱいに映し直す」。
 * `null`／既定（`mask`）はキーごと落とす＝既定と同じ値を書かない。
 */
export function setClipCropMode(doc: TimelineProject, clipId: string, mode: CropMode | null): EditResult {
  const clip = doc.clips.find((c) => c.id === clipId);
  if (!clip) return blocked(EDIT_BLOCKED.notFound);
  if (doc.tracks.find((t) => t.id === clip.trackId)?.locked) return blocked(EDIT_BLOCKED.locked);
  const next = mode == null || mode === CROP_MODE_DEFAULT ? undefined : mode;
  if ((clip.cropMode ?? undefined) === next) return ok(doc);
  const patched = { ...clip };
  if (next == null) delete patched.cropMode;
  else patched.cropMode = next;
  return ok(withClip(doc, patched));
}
