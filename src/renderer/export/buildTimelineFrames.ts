// タイムライン形式（ADR-0032）の書き出し：**全フレームを描いて PNG にする**（決定22・#631）。
//
// 場面形式の `buildExportScenes` と違い、場面の区切りが無いので**動画まるごとが1本のフレーム列**になる。
// 描くのは `layoutTimelineAt`＝**プレビューと同じ関数**（ADR-0001 パリティ）。ここは
// 「どの時刻を何枚描くか」を `timelineFramePlan`/`frameTimeAt` に委ね、SVG→PNG→ステージングを回すだけ。
import { frameTimeAt, timelineFramePlan } from '../../domain/timeline/export';
import { creditSpeakerAt } from '../../domain/timeline/credit';
import { creditForLine } from '../../domain/voice/narratorCredit';
import type { TimelineProject } from '../../domain/timeline/types';
import type { Template } from '../../domain/template/types';
import type { SourceSize } from '../../domain/timeline/cropFill';
import { layoutTimelineAt } from '../timelineLayout';
import { layoutToSvg } from '../sceneSvg';
import { svgToPngDataUrl } from './rasterize';
import { ExportCancelledError } from './buildExportScenes';

/** ステージ先のディレクトリ名（`stage_export_frame` の検証を通る名前）。 */
export const TIMELINE_FRAMES_DIR = 'timeline_frames';

export interface BuildTimelineFramesOptions {
  /** 見た目パターンの解決（未解決のクリップは描かれない＝画面が先に知らせる）。 */
  templateOf: (templateId: string) => Template | undefined;
  /**
   * 素材の絵。**書き出しで描ける形（data URL）に解いたものを渡す**（`11 §7.6.5`・#716）。
   * ⚠️ プレビューが使う**表示用の URL（`asset://`）を渡してはいけない**＝ここは SVG を Blob → `<img>` →
   * canvas で焼くので外部参照は**取りに行かずに黙って落ちる**（`rasterize.ts` の前提）。
   * プレビューと同じ絵になる根拠は「同じ id 集合・同じ元ファイル」であって、同じ URL ではない。
   */
  assetSrc: (assetId: string | null) => string | undefined;
  /** 素材の実寸（#634）。プレビューと同じものを渡す＝「枠いっぱいに映す」が書き出しでも同じ絵になる。 */
  assetSizeOf?: (assetId: string) => SourceSize | undefined;
  /** 出力の実寸（省略時はレイアウトの寸法＝キャンバス実寸）。 */
  outputSize?: { width: number; height: number };
  /** 誰もしゃべっていない時刻に出すクレジット（動画の既定の声）。 */
  fallbackCredit: string;
  /** 動画全体のフォント（部品ごとの指定が無いときの受け皿＝11 §6 継承）。 */
  fontFamily?: string;
  /** 1フレームをディスクへ逃がす（数千フレームの base64 を配列に溜めない）。 */
  stageFrame?: (dirName: string, frameIndex: number, dataBase64: string) => Promise<void>;
  /** 進捗（描いた枚数 / 総数）。 */
  onProgress?: (done: number, total: number) => void;
  /** 中止要求。フレームごとに見る＝長い動画でも押した中止がすぐ効く。 */
  shouldCancel?: () => boolean;
}

/** 書き出しに渡す1本ぶん（`ExportSceneInput` と同じ形）。 */
export interface TimelineFramesResult {
  framesDir?: string;
  framesBase64?: string[];
  fps: number;
  durationSec: number;
}

/**
 * 全フレームを描いて PNG にする。**プレビューと同じ `layoutTimelineAt(doc, t)`** を通すので、
 * 見えているものがそのまま出る（ADR-0001）。
 *
 * クレジット（ADR-0003・`13 §4`）は**その時刻にしゃべっている声のキャラ**を焼き込む＝場面形式の
 * 掛け合い（`creditForLine`）と同じ挙動（ADR-0026②）。
 */
export async function buildTimelineFrames(
  doc: TimelineProject,
  opts: BuildTimelineFramesOptions,
): Promise<TimelineFramesResult> {
  const plan = timelineFramePlan(doc);
  const bail = (): void => {
    if (opts.shouldCancel?.()) throw new ExportCancelledError();
  };
  const framesBase64: string[] = [];
  const framesDir = opts.stageFrame ? TIMELINE_FRAMES_DIR : undefined;
  for (let f = 0; f < plan.frameCount; f += 1) {
    bail();
    const timeSec = frameTimeAt(f, plan.fps);
    const layout = layoutTimelineAt(doc, timeSec, { templateOf: opts.templateOf, assetSizeOf: opts.assetSizeOf });
    const svg = layoutToSvg(layout, {
      assetSrc: opts.assetSrc,
      credit: creditForLine({ speaker: creditSpeakerAt(doc, timeSec) }, opts.fallbackCredit),
      ...(opts.fontFamily ? { fontFamily: opts.fontFamily } : {}),
    });
    const dataUrl = await svgToPngDataUrl(
      svg,
      opts.outputSize?.width ?? layout.width,
      opts.outputSize?.height ?? layout.height,
    );
    if (framesDir && opts.stageFrame) await opts.stageFrame(framesDir, f, dataUrl);
    else framesBase64.push(dataUrl);
    // 4枚おき＋最後＝進捗が動きつつ通知で埋もれない（場面形式のフレームループと同じ間引き）。
    if (f % 4 === 0 || f === plan.frameCount - 1) opts.onProgress?.(f + 1, plan.frameCount);
  }
  return {
    ...(framesDir ? { framesDir } : { framesBase64 }),
    fps: plan.fps,
    durationSec: plan.durationSec,
  };
}
