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
): { sourceStartSec: number; durationSec: number; speed: number } {
  const speed = clip.speed != null && clip.speed > 0 ? clip.speed : 1;
  return {
    sourceStartSec: clip.sourceStartSec ?? 0,
    durationSec: clip.durationSec,
    speed,
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
  const local = stagedFrameIndexAt(clip, frameIndex, fps);
  if (local == null) return null;
  return Math.min(stagedCount - 1, local);
}

/**
 * その出力フレームが、その部品の**何コマ目**か（`null`＝映っていない）。
 * ⚠️ **プレビューと書き出しはここだけを見る**（#512 段1 レビュー 🔴）＝別々に時刻を出すとずれる。
 */
function stagedFrameIndexAt(clip: TimelineClip, frameIndex: number, fps: number): number | null {
  const t = frameIndex / fps;
  // 生きている区間は半開（`11 §7.6.4`＝終わりの瞬間はもう映らない）＝描く側と同じ規則。
  if (t < clip.startSec || t >= clip.startSec + clip.durationSec) return null;
  // ⚠️ **コマ数の引き算で出す**（秒へ直して掛け戻さない）＝掛け算の誤差で1つ手前へ落ちない
  // （`11 §7.6.5` の「格子点をもう一度量子化しない」と同じ理由）。
  // ⚠️ **トリムと速さはここで掛けない**＝焼いたコマ自体が織り込み済み（`stage_clip_frames` が
  // `sourceStartSec` から `setpts=PTS/speed` で並べる）。二重に掛けると倍速が二乗になる。
  const local = frameIndex - Math.round(clip.startSec * fps);
  return local < 0 ? null : local;
}

/**
 * その時刻に映すべき**素材の中の秒**（`null`＝映っていない・#512 段1）。
 * プレビューはこれを `video.currentTime` に入れる。
 *
 * ⚠️ **書き出しと同じコマ番号から導く**＝別々の式で出すと、置いた位置が格子（1/fps）に乗っていないとき
 * プレビューと書き出しで**別のコマ**になる（実測で最大1.5コマ×速さのずれ）。ここで
 * 「何コマ目か」を先に決め、そのコマが指す素材の秒へ直す（トリム＋速さはこの1回だけ掛ける）。
 */
export function videoSourceSecAt(clip: TimelineClip, timeSec: number, fps: number): number | null {
  const local = stagedFrameIndexAt(clip, Math.round(timeSec * fps), fps);
  if (local == null) return null;
  const speed = clip.speed != null && clip.speed > 0 ? clip.speed : 1;
  return (clip.sourceStartSec ?? 0) + (local / fps) * speed;
}

/**
 * その部品の**合成の単位**が、ほかの部品にも跨っているか（#512 段1・`11 §7.6.4`）。
 *
 * ⚠️ **跨っているときは実映像を出さない**＝プレビューは帯（zIndex）で層に割って `video` を挟むので、
 * 層ごとに薄さを掛けることになり、**重なった所で下が透ける**（書き出しは1枚にしてから掛ける＝決定19）。
 * 正典は「per-frame の全描画へ倒すか、**跨ぐときは分割を拒否して理由を返すこと**」としているので、
 * 断る側に倒し、画面が理由を出す。
 */
export function compositeSpansOthers(
  items: readonly { id: string; composite?: { key: string; opacity: number } }[],
  itemId: string,
): boolean {
  const key = items.find((it) => it.id === itemId)?.composite?.key;
  if (key == null) return false;
  return items.some((it) => it.id !== itemId && it.composite?.key === key);
}
