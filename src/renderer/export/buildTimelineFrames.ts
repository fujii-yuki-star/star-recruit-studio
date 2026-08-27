// タイムライン形式（ADR-0032）の書き出し：**全フレームを描いて PNG にする**（決定22・#631）。
//
// 場面形式の `buildExportScenes` と違い、場面の区切りが無いので**動画まるごとが1本のフレーム列**になる。
// 描くのは `layoutTimelineAt`＝**プレビューと同じ関数**（ADR-0001 パリティ）。ここは
// 「どの時刻を何枚描くか」を `timelineFramePlan`/`frameTimeAt` に委ね、SVG→PNG→ステージングを回すだけ。
import { frameTimeAt, timelineFramePlan } from '../../domain/timeline/export';
import { isItemOfPlacement } from '../timelineLayout';
import { videoPlacementsOf, videoFrameIndexAt, videoStagePlan } from '../../domain/timeline/video';
import type { VideoPlacement } from '../../domain/timeline/video';
import { creditSpeakerAt } from '../../domain/timeline/credit';
import { creditForLine } from '../../domain/voice/narratorCredit';
import { creditVisibleAt } from '../../domain/voice/creditDisplay';
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
  /**
   * 動画の部品を**コマへ焼き出す**（#512 段1）。返すのは実際に焼けた枚数。
   * ⚠️ **渡さないと灰色の枠が焼き込まれる**（#512 段1）＝直接置いた動画は静止画（代表フレーム）を
   * 要求しないので、`assetSrc` でも解けない。書き出しの入口は必ず両方を渡すこと（片方だけでも同じ）。
   */
  stageVideo?: (input: {
    clipId: string;
    assetId: string;
    dirName: string;
    sourceStartSec: number;
    durationSec: number;
    speed: number;
    fps: number;
  }) => Promise<number>;
  /** 焼き出したコマを1枚読む（data URL）。`stageVideo` と対で渡す。 */
  readVideoFrame?: (dirName: string, frameIndex: number) => Promise<string>;
}

/** その部品のコマを置く場所（部品ごとに分ける＝同じ動画を2つ置いても混ざらない）。 */
export function videoFramesDirOf(clipId: string, layerId: string | null = null): string {
  // ⚠️ **置き場所ごとに別のフォルダ**（#512 段3）＝1つの部品に差し込み口ぶんの動画がありうるので、
  // 部品 id だけで名づけると**後の1つが前の1つを上書きする**（別の絵が同じコマで出る）。
  return layerId == null
    ? `${TIMELINE_FRAMES_DIR}_v_${clipId}`
    : `${TIMELINE_FRAMES_DIR}_v_${clipId}_${layerId}`;
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

  // **動画は先にコマへ焼き出す**（#512 段1）＝1フレームずつ切り出すと同じ素材を何度も開くことになる。
  // 焼けた枚数を覚えておき、置いた長さより素材が短いときは**最後のコマで止める**（無い番号を読まない）。
  const staged: { placement: VideoPlacement; dirName: string; count: number }[] = [];
  if (opts.stageVideo && opts.readVideoFrame) {
    for (const placement of videoPlacementsOf(doc, opts.templateOf)) {
      bail();
      const spec = videoStagePlan(placement);
      const dirName = videoFramesDirOf(placement.clip.id, placement.layerId);
      const count = await opts.stageVideo({
        clipId: placement.clip.id,
        assetId: placement.assetId,
        dirName,
        sourceStartSec: spec.sourceStartSec,
        durationSec: spec.durationSec,
        speed: spec.speed,
        fps: plan.fps,
      });
      staged.push({ placement, dirName, count });
    }
  }

  for (let f = 0; f < plan.frameCount; f += 1) {
    bail();
    const timeSec = frameTimeAt(f, plan.fps);
    const layout = layoutTimelineAt(doc, timeSec, { templateOf: opts.templateOf, assetSizeOf: opts.assetSizeOf });
    // そのフレームで映る動画のコマを読み、**その部品のアイテムだけ**差し替える
    // （素材 id で引くと、同じ動画を別の時刻に置いた2つが同じコマになる）。
    const frameSrc: { placement: VideoPlacement; src: string }[] = [];
    for (const s of staged) {
      const idx = videoFrameIndexAt(s.placement, f, plan.fps, s.count);
      if (idx == null) continue;
      frameSrc.push({ placement: s.placement, src: await opts.readVideoFrame!(s.dirName, idx) });
    }
    const svg = layoutToSvg(layout, {
      assetSrc: opts.assetSrc,
      ...(frameSrc.length > 0
        ? {
            itemSrc: (item) => {
              for (const { placement, src } of frameSrc) if (isItemOfPlacement(item.id, placement)) return src;
              return undefined;
            },
          }
        : {}),
      // ⚠️ **見せ方の区間はプレビューと同じ関数で決める**（`creditVisibleAt`・ADR-0025・#359）＝
      // 別々に書くと「プレビューでは出ているのに動画に入っていない」が起きる（ADR-0001）。
      // 出さない時刻は `credit` を渡さない（`layoutToSvg` は未指定なら描かない）。
      ...(creditVisibleAt(doc.videoSettings.creditDisplay, plan.durationSec, timeSec)
        ? { credit: creditForLine({ speaker: creditSpeakerAt(doc, timeSec) }, opts.fallbackCredit) }
        : {}),
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
