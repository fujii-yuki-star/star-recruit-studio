// 再生位置で**絵を止める**（#356 ②・フリーズフレーム）。
//
// ⚠️ **ファイルを作らない**（ADR-0065・2026-10-20）＝止めた絵は「分けた後ろ半分の動画を、最初のコマで止める」
// 部品の設定（`holdFrame`）。業界の型（Premiere Pro のフレーム保持）。以前は写真を切り出して置いていたので、
// 取り消すと写真のファイルが残り（ADR-0064 の発端）、切り出しの待ちと「待っている間に変わった」の断りが要った。
// ⚠️ **描き方は既存の「最後のコマで凍る」を共有する**（`videoPlacementsOfClip` が使える長さを 0 にする）＝
// プレビュー＝書き出し（ADR-0001）。
//
// ⚠️ **時間は増やさない**（ADR-0034 決定11）＝押しのけ（ripple）は**採らないと決めてある**
//（`11 §8` V24「同一列で時間の重なり禁止」と喧嘩するため）。だから「止めたぶん後ろへずらす」
// 形にはできない＝**切れ目から先が止まった絵になる**（そのクリップの残り時間ぶん）。
// 伸ばしたいときは、止めた絵の帯を**普通に引っぱる**（隣とぶつかれば、いつもの理由が出る）。
//
// ⚠️ **相手は「直接置いた動画」だけ**＝見た目パターンの差し込み口に入れた動画は、止めると
// **枠ごと写真に化ける**（文字も立ち絵も消える）＝押した結果と食い違う。断って理由を出す。
import { isDirectVideoClip, videoPlacementsOfClip, videoSourceSecAt } from './video';
import { ASSET_USE_KIND } from '../enums';
import { effectiveFps } from './playback';
import { frameTimeSec } from './persistence';
import { splitClip, splitClipIssue, SPLIT_BLOCKED_REASON } from './split';
import type { SplitBlockedReason } from './split';
import { asHeld, EDIT_BLOCKED } from './edit';
import type { EditBlockedReason } from './edit';
import type { TimelineClip, TimelineProject } from './types';
import type { Template } from '../template/types';

/** 止められない理由のうち、**分ける**側と共有しないもの。 */
export const FREEZE_BLOCKED = {
  /** 直接置いた動画ではない（写真・文字・見た目パターン・音など）。 */
  notVideo: 'notVideo',
} as const;

export type FreezeBlockedReason = SplitBlockedReason | (typeof FREEZE_BLOCKED)[keyof typeof FREEZE_BLOCKED];

/** 止める相手の探し方（画面と実行で同じものを通す）。 */
export function freezeTargetOf(doc: TimelineProject, clipId: string): TimelineClip | undefined {
  return doc.clips.find((c) => c.id === clipId);
}

/**
 * **そこで止められるか**（止められないなら理由）。
 *
 * ⚠️ **押す前と実行で同じものを通す**（`moveClipIssue` と同じ流儀）＝画面はこれを見て押せなくし、
 * `freezeFrameAt` も先頭でこれを通す（押せるのに何も起きない、を作らない＝§2-5）。
 */
export function freezeFrameIssue(
  doc: TimelineProject,
  clipId: string,
  atSec: number,
  opts: { templateOf?: (templateId: string) => Template | undefined } = {},
): FreezeBlockedReason | null {
  const clip = freezeTargetOf(doc, clipId);
  // ⚠️ **種類の判定を先に**＝「見つからない」は分ける側も返すので、そちらへ委ねる。
  if (clip && !isDirectVideoClip(doc, clip)) return FREEZE_BLOCKED.notVideo;
  // ⚠️ **分けられることが前提**＝止める形は「分けて、後半を止める」なので、
  // 分ける側が断る理由（固定・外・短すぎ・使い切った先）はそのまま止める側の理由になる。
  return splitClipIssue(doc, clipId, atSec, opts);
}

/**
 * 止めた絵が映す**素材の時刻**（＝押した時に見えていたコマ）。`null` ＝その時刻に映っていない。
 *
 * ⚠️ **プレビュー＝書き出しの正準をそのまま呼ぶ**（ADR-0001・#1147）＝
 * `videoSourceSecAt` は**コマ番号から**素材の秒を導く。以前はここだけ
 * `sourceStartSec + (t − startSec) × speed` と**秒の引き算で写して**いたが、
 * `videoSourceSecAt` の説明が名指しで言うとおり、**置いた位置が格子（1/fps）に乗っていないと
 * 別のコマになる**（実測で最大1.5コマ×速さ）。そして**置いた位置は格子に乗らない**＝
 * 置くのも分けるのも生の秒（`edit.ts` に量子化は1か所も無い）。
 * ⚠️ **速さの既定も正準へ**＝写していた側は `speed ?? 1`、正準は `effectiveSpeed`（`speed > 0` を見る）。
 * ⚠️ **時刻もコマの格子へ落としてから渡す**（`frameTimeSec`）＝キャンバスが映しているのがその時刻。
 * ⚠️ **相手は「直接置いた動画」だけ**（#1157 レビュー由来 🟡・ℹ️）＝最初は
 * `p.clip.id === clip.id` で選んでいたが、`videoPlacementsOfClip` が返す置き場所は**どれも同じ帯**を
 * 持つので**恒真**だった。見た目パターンの帯を渡すと、差し込み口や立ち絵の置き場所を掴みうる
 *（＝止める相手が違う）。
 *
 * ⚠️ **根から断つ**＝**見た目パターンを引く道具（`templateOf`）を受け取らない**。
 * `videoPlacementsOfClip` は直接置きなら入口で早期に返り、そうでなければ**見た目が解けないので `[]`**。
 * つまりここへ届く置き場所は**直接置きの1つか、無いか**の2通りしかない。
 * ⚠️ **だから下の `find` の条件は、いまは何を書いても同じ**（変異チェックで生き残る＝等価）。
 * それでも**使い方で書く**のは、`templateOf` を足した瞬間に恒真へ戻る側だから
 *（条件が「意図」を持っていれば、足した人がそこで気づく）。
 */
export function freezeSourceSec(
  doc: TimelineProject,
  clip: TimelineClip,
  atSec: number,
): number | null {
  const place = videoPlacementsOfClip(doc, clip).find((p) => p.use === ASSET_USE_KIND.direct);
  if (!place) return null;
  return videoSourceSecAt(place, frameTimeSec(doc, atSec), effectiveFps(doc));
}

/**
 * 再生位置で分けて、**後半をそのコマで止める**（ADR-0065）。
 *
 * ⚠️ **ファイルを作らない**＝後半の部品に `holdFrame` を立てるだけ（純粋・同期）。止まるのは後半の
 * **使い始めのコマ**＝押した時に見えていたコマ（`freezeSourceSec` で出して入れ直す）。
 * ⚠️ **音は連れていかない**＝止めた絵は音を鳴らさないので、元の音・音量の変化は**落とす**
 *（持たせても効かない項目が残るだけ＝#1019 ⑦と同じ理由）。使い始めと速さは**残す**
 *（止めるのをやめたとき、そこから同じ速さで流れる）。
 * ⚠️ **動き（キーフレーム）は分ける側が再基準化したものをそのまま使う**＝止めても動かし続けられる。
 */
export function freezeFrameAt(
  doc: TimelineProject,
  clipId: string,
  atSec: number,
  volumeAt: (points: readonly { timeSec: number; volume: number }[] | undefined, localSec: number) => number | undefined,
  opts: { templateOf?: (templateId: string) => Template | undefined } = {},
): { ok: true; doc: TimelineProject; newClipId: string } | { ok: false; reason: FreezeBlockedReason } {
  const issue = freezeFrameIssue(doc, clipId, atSec, opts);
  if (issue) return { ok: false, reason: issue };
  const split = splitClip(doc, clipId, atSec, volumeAt, opts);
  // ⚠️ **ここへは来ない想定**＝上で同じ関門を通している。それでも握りつぶさない（理由を返す）。
  if (!split.ok) return { ok: false, reason: split.reason };
  // ⚠️ **見えていたコマで止める**＝分ける側は使い始めを**生の秒**で進めるので、置いた位置が格子に
  //   乗っていないと**隣のコマ**になる（#1147 と同じ理由）。押した時に映っていたコマの秒を正準で出して入れる。
  const sourceSec = freezeSourceSec(doc, doc.clips.find((c) => c.id === clipId) as TimelineClip, atSec);
  if (sourceSec == null) return { ok: false, reason: FREEZE_BLOCKED.notVideo };
  const clips = split.doc.clips.map((c) =>
    c.id === split.newClipId ? { ...asHeld(c), sourceStartSec: sourceSec } : c,
  );
  return { ok: true, doc: { ...split.doc, clips }, newClipId: split.newClipId };
}

/**
 * **止めると元の音が止まるか**（#1136 レビュー由来 🟡）。
 *
 * ⚠️ **黙って捨てない**＝止めている間は、その動画の**元の音を鳴らさない**（ADR-0065）。
 * 他社の同じ操作は「絵だけ止まって音は流れ続ける」ので、**何も言わないと設定を黙って捨てたことになる**
 *（ADR-0026①）。画面はこれを見て**押す前に知らせる**。
 * ⚠️ **鳴らす設定のときだけ**＝既定（鳴らさない）なら失うものが無い。
 */
export function freezeStopsOriginalAudio(clip: TimelineClip): boolean {
  return clip.useOriginalAudio === true;
}

/**
 * 断る理由 → 画面の語彙（`splitClip` の `SPLIT_BLOCKED_REASON` と同じ流儀）。
 *
 * ⚠️ **分ける側の対応表を取り込む**＝写すと、片方の理由だけ文言が変わる（§6）。
 */
export const FREEZE_BLOCKED_REASON: Record<FreezeBlockedReason, EditBlockedReason> = {
  ...SPLIT_BLOCKED_REASON,
  [FREEZE_BLOCKED.notVideo]: EDIT_BLOCKED.freezeNotVideo,
};
