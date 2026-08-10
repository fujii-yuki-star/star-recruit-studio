// 帯を再生位置で分ける（#686 段階4・ADR-0034 決定16）。
//
// **kind で意味が違う**のが要点：
// - 絵（見た目パターン・素材・文字・図形・字幕）＝**時間を切るだけ**。
//   ⚠️ ただし**動き（キーフレーム）は再基準化し、分割点の値を両端に焼く**
//   （後半の時刻は自分の先頭からの秒なので、そのまま持ち越すと動きが飛ぶ）。
//   ⚠️ **焼けるのは「そのときの値」だけで、カーブの形は持ち越せない**ので、**直線でない動きの
//   区間の中では分けない**（断る）。値だけ合っていて軌跡が別物、を黙って作らない（#753 で本筋を実装）。
// - 音＝**`sourceStartSec` を進める**（素材のどこから鳴らすかが後半でずれる）。
//   **フェードは前後に残す**（入りは前半・抜けは後半＝真ん中に切れ目の音を作らない）。
// - **読み上げは切れない**（文と音がずれる）。**連動している字幕も切れない**（読み上げが時間を決める）。
//
// 全列いっせいのブレード分割は**入れない**（決定16）＝対象は「選んでいる1つ」だけ。
import { createAnimationId, createClipId } from '../project/persistence';
import { easingCurveOf, interpolateKeyframes } from '../project/keyframes';
import { TIMELINE_CLIP_KIND } from '../enums';
import { TIMELINE_MIN_CLIP_SEC, VOLUME_POINTS_MAX } from '../constants';
import type { Keyframe } from '../project/types';
import type { ClipAnimation, TimelineClip, TimelineProject } from './types';
import { EDIT_BLOCKED } from './edit';
import type { EditBlockedReason } from './edit';

/**
 * **素材の時間を持つ種類**（分けたら頭出しを進める相手）。文字・図形・字幕・見た目パターンは
 * 素材の時間を持たないので進めない（意味の無い項目を書かない）。
 */
const USES_SOURCE_TIME = new Set<string>([TIMELINE_CLIP_KIND.audio, TIMELINE_CLIP_KIND.slot]);

/** 分けられない理由（`null`＝分けられる）。 */
export const SPLIT_BLOCKED = {
  /** 対象が見つからない。 */
  notFound: 'notFound',
  /** 列が固定されている。 */
  locked: 'locked',
  /** 読み上げ・連動している字幕は切れない（文と音・時間の持ち主がずれる）。 */
  unsplittable: 'unsplittable',
  /** 切れ目が帯の外／どちらかが短くなりすぎる。 */
  outside: 'outside',
  /** 音量の変化の点が上限に達している（境界の点を焼くと超える）。 */
  volumePointsFull: 'volumePointsFull',
  /** 直線でない動きの**区間の途中**（カーブの形を持ち越せない）。 */
  curvedEasing: 'curvedEasing',
} as const;
export type SplitBlockedReason = (typeof SPLIT_BLOCKED)[keyof typeof SPLIT_BLOCKED];

/**
 * **そこで分けられるか**（分けられないなら理由）。ドラッグの `moveClipIssue` と同じ流儀＝
 * 画面は押す前にこれを見て、`splitClip` も同じものを通す（押せるのに何も起きない、を作らない）。
 */
export function splitClipIssue(doc: TimelineProject, clipId: string, atSec: number): SplitBlockedReason | null {
  const clip = doc.clips.find((c) => c.id === clipId);
  if (!clip) return SPLIT_BLOCKED.notFound;
  if (doc.tracks.find((t) => t.id === clip.trackId)?.locked) return SPLIT_BLOCKED.locked;
  // 読み上げ＝文と音がずれる／連動している字幕＝時間は読み上げが決める（ADR-0032 決定24）。
  if (clip.kind === TIMELINE_CLIP_KIND.voice || clip.voiceClipId != null) return SPLIT_BLOCKED.unsplittable;
  const head = atSec - clip.startSec;
  const tail = clip.startSec + clip.durationSec - atSec;
  // **どちらも最小の長さを満たすときだけ**（片方が潰れる切り方をさせない）。
  if (head < TIMELINE_MIN_CLIP_SEC || tail < TIMELINE_MIN_CLIP_SEC) return SPLIT_BLOCKED.outside;
  // ⚠️ **音量の点は上限を超えない**（#750 レビュー）＝境界の点を両端に焼くので、上限まで置いた帯を
  // 分けると片側が1つ超える。編集の入口（`volumePointEdit`）は「置けたのに書き出しで断られる」を
  // 作らないよう上限で断っているので、**分けるときだけ破らない**。
  const pts = clip.volumePoints ?? [];
  if (pts.length > 0) {
    const before = pts.filter((p) => p.timeSec < head).length + 1;
    const after = pts.filter((p) => p.timeSec > head).length + 1;
    if (before > VOLUME_POINTS_MAX || after > VOLUME_POINTS_MAX) return SPLIT_BLOCKED.volumePointsFull;
  }
  // ⚠️ **直線でない動きの途中では分けない**（#750 レビュー）。境界に焼くのは「そのときの値」だけで、
  // **カーブの形は持ち越せない**（部分曲線を焼き直す必要がある＝#753）。断らずに切ると
  // **速さの変わり方が黙って変わる**（値だけ合っていて軌跡が別物）。直線の区間・キーフレームの上は通す。
  const own = (doc.animations ?? []).find((a) => a.targetId === clipId);
  if (own && crossesCurvedSegment(own.keyframes, head)) return SPLIT_BLOCKED.curvedEasing;
  return null;
}

/**
 * その時刻が**直線でない動きの区間の中**を通るか（#750 レビュー）。
 * 区間の境目（キーフレームちょうど）や、直線の区間なら `false`＝分けても軌跡が変わらない。
 */
export function crossesCurvedSegment(keyframes: readonly Keyframe[], atSec: number): boolean {
  const sorted = [...keyframes].sort((a, b) => a.timeSec - b.timeSec);
  for (let i = 0; i < sorted.length - 1; i++) {
    const from = sorted[i];
    const to = sorted[i + 1];
    if (!(atSec > from.timeSec && atSec < to.timeSec)) continue;
    const curve = easingCurveOf(from.easing);
    // `null`＝3次ベジェで表せない（`ease-in-out`）／直線 `[0,0,1,1]` 以外＝カーブ。
    return curve == null || !(curve[0] === 0 && curve[1] === 0 && curve[2] === 1 && curve[3] === 1);
  }
  return false;
}

/**
 * 動きを前半・後半へ分ける（#686 段階4）。
 *
 * ⚠️ **分割点の値を両端に焼く**。前半の最後・後半の最初に「そのときの見た目」を置かないと、
 * 前半は最後のキーフレーム以降が止まり、後半は**自分の先頭から次のキーフレームまで一気に動く**
 * ＝切っただけなのに**絵が飛ぶ**。焼いておけば見た目は切る前と同じまま。
 *
 * 後半の時刻は**自分の先頭からの秒**へ直す（`11 §7.6.3.1`＝対象の先頭が起点）。
 */
export function splitKeyframes(
  keyframes: readonly Keyframe[],
  headSec: number,
): { head: Keyframe[]; tail: Keyframe[] } {
  if (keyframes.length === 0) return { head: [], tail: [] };
  const at = interpolateKeyframes(keyframes, headSec);
  // 補間は「指定の無いプロパティ」を返さない＝**元の並びが持っている項目だけ**を焼く
  // （持っていない項目を足すと、切っただけで動きの対象が増える）。
  const boundary: Keyframe = { timeSec: 0, ...at };
  const head = keyframes.filter((k) => k.timeSec < headSec).map((k) => ({ ...k }));
  head.push({ ...boundary, timeSec: headSec });
  const tail: Keyframe[] = [{ ...boundary }];
  for (const k of keyframes) {
    if (k.timeSec <= headSec) continue;
    tail.push({ ...k, timeSec: k.timeSec - headSec });
  }
  return { head, tail };
}

/** 音量の変化の点も同じ考え方で分ける（切れ目の音量を両端に焼く）。 */
export function splitVolumePoints(
  points: readonly { timeSec: number; volume: number }[] | undefined,
  headSec: number,
  volumeAtSplit: number | undefined,
): { head?: { timeSec: number; volume: number }[]; tail?: { timeSec: number; volume: number }[] } {
  if (!points || points.length === 0 || volumeAtSplit == null) return {};
  const head = points.filter((p) => p.timeSec < headSec).map((p) => ({ ...p }));
  head.push({ timeSec: headSec, volume: volumeAtSplit });
  const tail = [{ timeSec: 0, volume: volumeAtSplit }];
  for (const p of points) {
    if (p.timeSec <= headSec) continue;
    tail.push({ timeSec: p.timeSec - headSec, volume: p.volume });
  }
  return { head, tail };
}

/**
 * 帯を `atSec` で2つに分ける。**前半は同じ id のまま**（選択・動き・連動の参照が切れない）、
 * 後半を新しい id で足す。分けられないときは理由を返す。
 *
 * `volumeAt` は音量の変化を解く関数（`domain/timeline/audio` の `volumeAt`）。**再生・書き出しと
 * 同じもの**を渡す＝切れ目の音量が画面と出力で食い違わない。
 */
export function splitClip(
  doc: TimelineProject,
  clipId: string,
  atSec: number,
  volumeAt: (points: readonly { timeSec: number; volume: number }[] | undefined, localSec: number) => number | undefined,
): { ok: true; doc: TimelineProject; newClipId: string } | { ok: false; reason: SplitBlockedReason } {
  const issue = splitClipIssue(doc, clipId, atSec);
  if (issue) return { ok: false, reason: issue };
  const clip = doc.clips.find((c) => c.id === clipId) as TimelineClip;
  const headSec = atSec - clip.startSec;
  const newId = createClipId(doc.clips.map((c) => c.id));

  const vol = splitVolumePoints(clip.volumePoints, headSec, volumeAt(clip.volumePoints, headSec));
  const head: TimelineClip = {
    ...clip,
    durationSec: headSec,
    // 入りのフェードは前半に残し、**抜けは後半へ渡す**（真ん中に切れ目の音を作らない）。
    ...(clip.fadeOutSec != null ? { fadeOutSec: undefined } : {}),
    ...(vol.head ? { volumePoints: vol.head } : {}),
  };
  const tail: TimelineClip = {
    ...clip,
    id: newId,
    startSec: atSec,
    durationSec: clip.startSec + clip.durationSec - atSec,
    ...(clip.fadeInSec != null ? { fadeInSec: undefined } : {}),
    ...(vol.tail ? { volumePoints: vol.tail } : {}),
    // **素材のどこから鳴らすか／映すか**を進める。速度が掛かっているぶんも進む
    // （置いた長さ × 速度 ＝ 使う素材の長さ・`11 §7.6.3.2`）。
    // ⚠️ **持っているかどうかで決めない**（#750 レビュー 🔴）＝置いたばかりの音は両方とも持たないので、
    // 条件にすると**後半が曲の頭から鳴り直す**。素材の時間を持つ種類なら**必ず書く**。
    ...(USES_SOURCE_TIME.has(clip.kind)
      ? { sourceStartSec: (clip.sourceStartSec ?? 0) + headSec * (clip.speed ?? 1) }
      : {}),
  };
  // 連動している字幕は切れない（上で断っている）ので、`voiceClipId` を持つ後半は生まれない。

  const clips = doc.clips.flatMap((c) => (c.id === clipId ? [stripUndefined(head), stripUndefined(tail)] : [c]));

  const anims = doc.animations ?? [];
  const own = anims.find((a) => a.targetId === clipId);
  let animations: ClipAnimation[] | undefined = doc.animations;
  if (own) {
    const { head: kfHead, tail: kfTail } = splitKeyframes(own.keyframes, headSec);
    const nextAnims = anims.map((a) => (a.id === own.id ? { ...a, keyframes: kfHead } : a));
    nextAnims.push({ id: createAnimationId(anims.map((a) => a.id)), targetId: newId, keyframes: kfTail });
    animations = nextAnims;
  }

  // ⚠️ **後半もまとまりに入れる**（#750 レビュー・3観点が独立に指摘）。描画はメンバーの id で
  // グループの変形・不透明度・**合成の単位**を解くので、入れないと**分割点から先だけ**
  // フェードや変形が外れる＝「切っただけで絵が変わる」（決定16 の核心）。
  // 消す側（`removeClips`）は参照を片づけるのに、分ける側が足さないのは非対称でもあった。
  const groups = doc.groups?.map((g) =>
    g.members.includes(clipId) ? { ...g, members: [...g.members, newId] } : g,
  );

  return {
    ok: true,
    doc: { ...doc, clips, ...(groups ? { groups } : {}), ...(animations ? { animations } : {}) },
    newClipId: newId,
  };
}

/** `undefined` の項目を落とす（schema は `additionalProperties:false`＝未定義の項目を書かない）。 */
function stripUndefined(clip: TimelineClip): TimelineClip {
  const out = { ...clip } as Record<string, unknown>;
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out as unknown as TimelineClip;
}

/**
 * 分けられない理由 → 画面に出す断り（`EDIT_BLOCKED`）へ写す。
 * ⚠️ **写す表を1か所に置く**＝画面ごとに違う文言へ振り分けない（同じ状況で言うことが変わらない）。
 */
export const SPLIT_BLOCKED_REASON: Record<SplitBlockedReason, EditBlockedReason> = {
  [SPLIT_BLOCKED.notFound]: EDIT_BLOCKED.notFound,
  [SPLIT_BLOCKED.locked]: EDIT_BLOCKED.locked,
  [SPLIT_BLOCKED.unsplittable]: EDIT_BLOCKED.unsplittable,
  [SPLIT_BLOCKED.outside]: EDIT_BLOCKED.splitOutside,
  [SPLIT_BLOCKED.volumePointsFull]: EDIT_BLOCKED.volumePointsFull,
  [SPLIT_BLOCKED.curvedEasing]: EDIT_BLOCKED.curvedEasing,
};
