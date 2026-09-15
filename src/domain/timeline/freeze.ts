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
import { isDirectVideoClip, videoPlacementsOfClip, videoSourceSecAt } from './video';
import { effectiveFps } from './playback';
import { frameTimeSec } from './persistence';
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
  /**
   * 切り出している間に**その帯が変わった**（#1136 レビュー由来 🟡）。
   * そのまま貼ると**切れ目と止めた絵が別の瞬間**になる（素材ごと替わっていれば別の動画のコマ）。
   */
  changed: 'changed',
} as const;

export type FreezeBlockedReason = SplitBlockedReason | (typeof FREEZE_BLOCKED)[keyof typeof FREEZE_BLOCKED];

/**
 * **切り出す前の帯の姿**（待っている間に変わっていないかを見るための控え）。
 *
 * ⚠️ **切り出すのは待つ前の帯、分けるのは待った後の帯**（#1136 レビュー由来 🟡）＝
 * 取り込み中でも編集は止まらない（押せなくなるのはボタンだけ）ので、待っている間に
 * **動かす／左端を詰める／速さを変える／素材を選び直す**と、**切れ目と止めた絵が別の瞬間**になる。
 * 素材を別の動画に差し替えられた場合は、**別の動画のコマ**が貼り付く。
 * `freezeFrameIssue` は固定・帯の外・短すぎ・使い切りしか見ないので、ここは素通りする。
 */
export interface FreezeSnapshot {
  assetId: string | null | undefined;
  startSec: number;
  sourceStartSec: number | undefined;
  speed: number | undefined;
}

export function freezeSnapshotOf(clip: TimelineClip): FreezeSnapshot {
  return { assetId: clip.assetId, startSec: clip.startSec, sourceStartSec: clip.sourceStartSec, speed: clip.speed };
}

/** 切り出す前と同じ姿か（違えば、止めた絵は別の瞬間になる）。 */
export function sameFreezeSnapshot(a: FreezeSnapshot, b: FreezeSnapshot): boolean {
  return a.assetId === b.assetId && a.startSec === b.startSec
    && a.sourceStartSec === b.sourceStartSec && a.speed === b.speed;
}

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
 * 止めた絵にする**素材の時刻**（＝切り出す位置）。`null` ＝その時刻に映っていない。
 *
 * ⚠️ **プレビュー＝書き出しの正準をそのまま呼ぶ**（ADR-0001・#1147）＝
 * `videoSourceSecAt` は**コマ番号から**素材の秒を導く。以前はここだけ
 * `sourceStartSec + (t − startSec) × speed` と**秒の引き算で写して**いたが、
 * `videoSourceSecAt` の説明が名指しで言うとおり、**置いた位置が格子（1/fps）に乗っていないと
 * 別のコマになる**（実測で最大1.5コマ×速さ）。そして**置いた位置は格子に乗らない**＝
 * 置くのも分けるのも生の秒（`edit.ts` に量子化は1か所も無い）。
 * ⚠️ **速さの既定も正準へ**＝写していた側は `speed ?? 1`、正準は `effectiveSpeed`（`speed > 0` を見る）。
 * ⚠️ **時刻もコマの格子へ落としてから渡す**（`frameTimeSec`）＝キャンバスが映しているのがその時刻。
 */
export function freezeSourceSec(
  doc: TimelineProject,
  clip: TimelineClip,
  atSec: number,
  opts: { templateOf?: (templateId: string) => Template | undefined } = {},
): number | null {
  const place = videoPlacementsOfClip(doc, clip, opts).find((p) => p.clip.id === clip.id);
  if (!place) return null;
  return videoSourceSecAt(place, frameTimeSec(doc, atSec), effectiveFps(doc));
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
  opts: { templateOf?: (templateId: string) => Template | undefined; was?: FreezeSnapshot } = {},
): { ok: true; doc: TimelineProject; newClipId: string } | { ok: false; reason: FreezeBlockedReason } {
  const issue = freezeFrameIssue(doc, clipId, atSec, opts);
  if (issue) return { ok: false, reason: issue };
  // ⚠️ **切り出す前と同じ姿か**（レビュー由来 🟡）＝違えば、止めた絵は別の瞬間（別の動画）になる。
  const now = doc.clips.find((c) => c.id === clipId);
  if (opts.was && now && !sameFreezeSnapshot(opts.was, freezeSnapshotOf(now))) {
    return { ok: false, reason: FREEZE_BLOCKED.changed };
  }
  const split = splitClip(doc, clipId, atSec, volumeAt, opts);
  // ⚠️ **ここへは来ない想定**＝上で同じ関門を通している。それでも握りつぶさない（理由を返す）。
  if (!split.ok) return { ok: false, reason: split.reason };
  const clips = split.doc.clips.map((c) => (c.id === split.newClipId ? asStill(c, stillAssetId) : c));
  return { ok: true, doc: { ...split.doc, clips }, newClipId: split.newClipId };
}

/**
 * **止めると元の音が止まるか**（#1136 レビュー由来 🟡）。
 *
 * ⚠️ **黙って捨てない**＝止めた絵は写真なので、その動画の**元の音は鳴らせない**。
 * 他社の同じ操作は「絵だけ止まって音は流れ続ける」ので、**何も言わないと設定を黙って捨てたことになる**
 *（ADR-0026①）。画面はこれを見て**押す前に知らせる**。
 * ⚠️ **鳴らす設定のときだけ**＝既定（鳴らさない）なら失うものが無い。
 */
export function freezeStopsOriginalAudio(clip: TimelineClip): boolean {
  return clip.useOriginalAudio === true;
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
  [FREEZE_BLOCKED.changed]: EDIT_BLOCKED.freezeChanged,
};
