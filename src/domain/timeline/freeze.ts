// 再生位置で**絵を止める**（#356 ②・フリーズフレーム）。
//
// ⚠️ **新しい概念を足さない**＝止めた絵は「切り出した写真を置いたクリップ」で、
// **分ける（#333）＋この瞬間を写真にする（#349）**を1手にまとめただけ。
// データの形は増やさないので、あとから触るのも普通の写真クリップと同じ（ADR-0032「テンプレは素材」）。
//
// ⚠️ **時間は増やさない**（ADR-0034 決定11）＝押しのけ（ripple）は**採らないと決めてある**
//（`11 §8` V24「同一列で時間の重なり禁止」と喧嘩するため）。だから「止めたぶん後ろへずらす」
// 形にはできない＝**切れ目から先が止まった絵になる**（そのクリップの残り時間ぶん）。
// 伸ばしたいときは、止めた絵の帯を**普通に引っぱる**（隣とぶつかれば、いつもの理由が出る）。
//
// ⚠️ **相手は「直接置いた動画」だけ**＝見た目パターンの差し込み口に入れた動画は、止めると
// **枠ごと写真に化ける**（文字も立ち絵も消える）＝押した結果と食い違う。断って理由を出す。
import { advancedSourceStart } from './sourceTime';
import { isDirectVideoClip } from './video';
import { splitClip, splitClipIssue, SPLIT_BLOCKED_REASON } from './split';
import type { SplitBlockedReason } from './split';
import { EDIT_BLOCKED } from './edit';
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
  // ⚠️ **分けられることが前提**＝止める形は「分けて、後半を写真に替える」なので、
  // 分ける側が断る理由（固定・外・短すぎ・使い切った先）はそのまま止める側の理由になる。
  return splitClipIssue(doc, clipId, atSec, opts);
}

/**
 * 止めた絵にする**素材の時刻**（＝切り出す位置）。
 *
 * ⚠️ **速さのぶんも進む**＝規則は `advancedSourceStart` に1つ（写すと片方だけ直る＝§6）。
 */
export function freezeSourceSec(clip: TimelineClip, atSec: number): number {
  return advancedSourceStart(clip, atSec - clip.startSec).sourceStartSec ?? 0;
}

/**
 * 再生位置で分けて、**後半を止めた絵に替える**。
 *
 * @param stillAssetId 切り出した写真の素材 id（呼ぶ側が先に作る＝ここは純粋関数のまま）。
 *
 * ⚠️ **音は連れていかない**＝止めた絵は写真なので、元の音・音量の変化・速さ・頭出しは**落とす**
 *（持たせても効かない項目が残るだけ＝置いた覚えのない値を作らない＝#1019 ⑦と同じ理由）。
 * ⚠️ **動き（キーフレーム）は分ける側が再基準化したものをそのまま使う**＝止めても動かし続けられる
 *（寄る・回す演出は絵が止まってからが本番）。
 */
export function freezeFrameAt(
  doc: TimelineProject,
  clipId: string,
  atSec: number,
  stillAssetId: string,
  volumeAt: (points: readonly { timeSec: number; volume: number }[] | undefined, localSec: number) => number | undefined,
  opts: { templateOf?: (templateId: string) => Template | undefined } = {},
): { ok: true; doc: TimelineProject } | { ok: false; reason: FreezeBlockedReason } {
  const issue = freezeFrameIssue(doc, clipId, atSec, opts);
  if (issue) return { ok: false, reason: issue };
  const split = splitClip(doc, clipId, atSec, volumeAt, opts);
  // ⚠️ **ここへは来ない想定**＝上で同じ関門を通している。それでも握りつぶさない（理由を返す）。
  if (!split.ok) return { ok: false, reason: split.reason };
  const clips = split.doc.clips.map((c) => (c.id === split.newClipId ? asStill(c, stillAssetId) : c));
  return { ok: true, doc: { ...split.doc, clips } };
}

/** 動画のクリップを、止めた絵（写真）のクリップに替える。 */
function asStill(clip: TimelineClip, stillAssetId: string): TimelineClip {
  const {
    sourceStartSec: _sourceStartSec,
    speed: _speed,
    useOriginalAudio: _useOriginalAudio,
    originalAudioVolume: _originalAudioVolume,
    volumePoints: _volumePoints,
    ...rest
  } = clip;
  return { ...rest, assetId: stillAssetId };
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
