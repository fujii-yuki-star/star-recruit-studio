// 窓の外から落としたファイルを**並びへ置く**（ADR-0049）。純粋関数（§4・§7）。
//
// ⚠️ **置き方の規則は増やさない**＝1件ずつ、アプリの中から運んで落としたときと**同じ関数**
// （`addVisualClip`／`addAudioClip`）を通す。ここが持つのは「複数をどう並べるか」と
// 「種類の合わない列へ落としたときの行き先」だけ。
import { ASSET_TYPE, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import type { AssetType, TrackKind } from '../enums';
import { TIMELINE_MIN_CLIP_SEC } from '../constants';
import { addAudioClip, addTrack, addVisualClip, EDIT_BLOCKED, isFreeSpan, trackPlacementIssue } from './edit';
import type { EditBlockedReason } from './edit';
import type { TimelineProject } from './types';

/** 素材の種類 → 置く列の種類。**音は音の列、それ以外（写真・動画など）は映像の列**。 */
export function trackKindForAssetType(t: AssetType): TrackKind {
  return t === ASSET_TYPE.bgm || t === ASSET_TYPE.voice ? TRACK_KIND.audio : TRACK_KIND.visual;
}

export interface FileDropPlacementInput {
  /** 置く素材（**取り込んだ順**＝並べる順）。 */
  assetIds: readonly string[];
  /**
   * 落とした列。`null`＝**列の無い所（いちばん下の列より下）**に落とした＝その種類の列を新しく作る。
   */
  trackId: string | null;
  /** 落とした時刻（秒）。1件目はここから、2件目以降は**前の部品の終わり**から並べる。 */
  startSec: number;
  /** 素材の実寸（分かっているもの）。無ければ切らない側へ倒す（`addVisualClip` と同じ）。 */
  assetSizeOf?: (assetId: string) => { w: number; h: number } | undefined;
}

export type FileDropPlacementResult =
  | { ok: true; doc: TimelineProject; placedIds: string[] }
  | { ok: false; reason: EditBlockedReason };

/**
 * 落としたファイル（取り込み済みの素材）を並びへ置く。
 *
 * 規則（ADR-0049）：
 * - **落とした列の種類に合う素材**は、その列に落とした時刻から**前から順に隙間なく**並べる。
 * - **種類の合わない素材**（映像の列へ落とした音など）と、**列の無い所へ落とした素材**は、
 *   その種類の**新しい列**へ、同じ時刻から並べる（種類ごとに1本）。
 *   ⚠️ 勝手に別の既存の列へ入れない（ADR-0034 決定10＝指した場所から動かさない）。新しい列は
 *   「その時刻にまっさらな場所」なので、指した時刻は守られる。
 * - **全か無か**（ADR-0034 決定15）＝1件でも置けなければ**何も置かない**（理由を返す）。
 *   取り込みは済んでいるので、素材は一覧に残る（そこから置き直せる）。
 */
export function placeDroppedAssets(doc: TimelineProject, input: FileDropPlacementInput): FileDropPlacementResult {
  if (input.assetIds.length === 0) return { ok: false, reason: EDIT_BLOCKED.notFound };
  let working = doc;
  const dropTrack = input.trackId ? doc.tracks.find((t) => t.id === input.trackId) : undefined;
  if (input.trackId && !dropTrack) return { ok: false, reason: EDIT_BLOCKED.notFound };
  /** 種類ごとの置き先の列（落とした列か、新しく作った列）。 */
  const trackFor = new Map<TrackKind, string>();
  if (dropTrack) trackFor.set(dropTrack.kind, dropTrack.id);
  /** 列ごとの「次に置く時刻」。 */
  const cursor = new Map<string, number>();
  const placedIds: string[] = [];
  const startSec = Math.max(0, input.startSec);

  for (const assetId of input.assetIds) {
    const asset = working.assets.find((a) => a.assetId === assetId);
    if (!asset) return { ok: false, reason: EDIT_BLOCKED.notFound };
    const kind = trackKindForAssetType(asset.assetType);
    let trackId = trackFor.get(kind);
    if (!trackId) {
      const before = new Set(working.tracks.map((t) => t.id));
      working = addTrack(working, kind);
      const added = working.tracks.find((t) => !before.has(t.id));
      if (!added) return { ok: false, reason: EDIT_BLOCKED.notFound };
      trackId = added.id;
      trackFor.set(kind, trackId);
    }
    const at = cursor.get(trackId) ?? startSec;
    const r = kind === TRACK_KIND.audio
      ? addAudioClip(working, { assetId, trackId, startSec: at, durationSec: asset.metadata?.durationSec ?? undefined })
      : addVisualClip(working, {
        kind: TIMELINE_CLIP_KIND.slot, assetId, trackId, startSec: at, assetSize: input.assetSizeOf?.(assetId),
      });
    if (!r.ok) return { ok: false, reason: r.reason };
    const before = new Set(working.clips.map((c) => c.id));
    working = r.doc;
    const placed = working.clips.find((c) => !before.has(c.id));
    if (!placed) return { ok: false, reason: EDIT_BLOCKED.notFound };
    placedIds.push(placed.id);
    cursor.set(trackId, placed.startSec + placed.durationSec);
  }
  return { ok: true, doc: working, placedIds };
}

/**
 * **窓の外から運んでいる間**に「ここには置けない」と分かるか（#1272・ADR-0049 の残り）。`null`＝置けそう。
 *
 * ⚠️ **運んでいる間は素材がまだ無い**＝分かるのはファイル名から出した**種類だけ**（長さも絵もまだ）。
 * だから**必ず断られる時だけ**断りを返す（「置けそうに見えたのに断られる」は残りうるが、
 * 「断られる色なのに置けてしまう」は作らない＝`placeDroppedAssets` と逆向きに食い違わない）：
 * - 種類の合う素材が1つも無い＝全部が新しい列へ行く（上の規則）＝ここでは断らない。
 * - 列の事情（固定・出さない）は `trackPlacementIssue`＝置く関数（`addVisualClip`／`addAudioClip`）と同じ。
 * - 重なりは**いちばん短い部品**（`TIMELINE_MIN_CLIP_SEC`）でも当たるか＝それで当たれば、どの長さでも当たる。
 */
export function fileDropHoverIssue(
  doc: TimelineProject,
  input: { trackId: string | null; startSec: number; assetTypes: readonly AssetType[] },
): EditBlockedReason | null {
  if (input.trackId == null) return null;
  const track = doc.tracks.find((t) => t.id === input.trackId);
  if (!track) return null;
  if (!input.assetTypes.some((t) => trackKindForAssetType(t) === track.kind)) return null;
  const trackIssue = trackPlacementIssue(doc, track.id, track.kind);
  if (trackIssue) return trackIssue;
  if (!isFreeSpan(doc.clips, track.id, Math.max(0, input.startSec), TIMELINE_MIN_CLIP_SEC)) return EDIT_BLOCKED.overlap;
  return null;
}
