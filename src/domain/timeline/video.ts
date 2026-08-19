// タイムライン形式の**動画素材**（#512 段1＝絵）。純粋・副作用なし。
//
// ⚠️ **段1 は絵だけ**＝元の音はまだ流れない（画面がその場で断る＝§2-5）。音は段2（`useOriginalAudio`）。
//
// 絵の作り方は場面形式（#442）と同じ道具立て：素材の区間を**出力 fps・速度込み**でコマへ焼き出し
// （Rust `stage_clip_frames`）、フレームごとにその1枚を差し込む。ここが決めるのは
// **どの部品が動画か／どの区間を焼くか／出力フレーム f でどのコマを出すか**の3つだけ。
import { ASSET_TYPE, TIMELINE_CLIP_KIND } from '../enums';
import type { TimelineClip, TimelineProject } from './types';

/** その部品が映す動画の素材 id（`null`＝動画ではない）。 */
export function videoAssetIdOfClip(clip: TimelineClip, videoAssetIds: ReadonlySet<string>): string | null {
  // 段1 の対象は**直接置いた素材**だけ（差し込み口＝`assetRefs` は段3）。
  if (clip.kind !== TIMELINE_CLIP_KIND.slot) return null;
  return clip.assetId != null && videoAssetIds.has(clip.assetId) ? clip.assetId : null;
}

/** 文書が持つ動画素材の id（`assetType` で見分ける＝画面の一覧と同じ規則）。 */
export function videoAssetIds(doc: TimelineProject): Set<string> {
  return new Set(doc.assets.filter((a) => a.assetType === ASSET_TYPE.video).map((a) => a.assetId));
}

/** 動画を映す部品（描く順は問わない＝呼び出し側が並べる）。 */
export function videoClipsOf(doc: TimelineProject): TimelineClip[] {
  const ids = videoAssetIds(doc);
  return doc.clips.filter((c) => videoAssetIdOfClip(c, ids) != null);
}

/**
 * その部品のコマを焼き出す仕様（#512 段1）。
 *
 * ⚠️ **置いた長さぶんの素材**を焼く＝速さが掛かっているぶんだけ素材を多く使う
 * （`11 §7.6.3.2`＝置いた長さは速さで変わらない）。トリム（`sourceStartSec`）から始める。
 */
export function videoStagePlan(
  clip: TimelineClip,
  fps: number,
): { sourceStartSec: number; durationSec: number; speed: number; frameCount: number } {
  const speed = clip.speed != null && clip.speed > 0 ? clip.speed : 1;
  return {
    sourceStartSec: clip.sourceStartSec ?? 0,
    durationSec: clip.durationSec,
    speed,
    // 端数は切り上げ（`timelineFramePlan` と同じ＝末尾のコマが黙って落ちない）。
    frameCount: Math.max(1, Math.ceil(clip.durationSec * fps)),
  };
}

/**
 * 出力フレーム `f` で、その部品が出すコマの番号（`null`＝その時刻には映っていない）。
 *
 * ⚠️ **焼けた枚数で頭打ちにする**（`stagedCount`）＝素材が置いた長さより短いときに
 * **無い番号を読みに行かない**（場面形式の `min(f, count-1)` と同じ・#442）。最後のコマで止まる。
 */
export function videoFrameIndexAt(
  clip: TimelineClip,
  frameIndex: number,
  fps: number,
  stagedCount: number,
): number | null {
  if (stagedCount <= 0) return null;
  const t = frameIndex / fps;
  // 生きている区間は半開（`11 §7.6.4`＝終わりの瞬間はもう映らない）＝描く側と同じ規則。
  if (t < clip.startSec || t >= clip.startSec + clip.durationSec) return null;
  // ⚠️ **コマ数の引き算で出す**（秒へ直して掛け戻さない）＝掛け算の誤差で1つ手前へ落ちない
  // （`11 §7.6.5` の「格子点をもう一度量子化しない」と同じ理由）。
  // ⚠️ **トリムと速さはここで掛けない**＝焼いたコマ自体が織り込み済み（`stage_clip_frames` が
  // `sourceStartSec` から `setpts=PTS/speed` で並べる）。二重に掛けると倍速が二乗になる。
  const local = frameIndex - Math.round(clip.startSec * fps);
  if (local < 0) return null;
  return Math.min(stagedCount - 1, local);
}
