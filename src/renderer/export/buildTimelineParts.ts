// タイムライン形式の書き出しを**区間ごと**に組み立てる（#1203・ADR-0032 決定22 の再検討）。
//
// ⚠️ **新しい書き出し経路は作らない**（ADR-0007）＝場面形式が使っている
// 「静止PNG（下）→ 実動画 → 静止PNG（上）」の道（`ExportSceneInput.video`）へ渡すだけ。
// Rust 側は1行も変えない。
//
// ⚠️ **音は変えない**＝動画の元の音は**全体の音の並び**（`timelineBgmRunInputs`）で渡っているので、
// ここで `useOriginalAudio` を立てると**二重に鳴る**。必ず false で渡す。
//
// ⚠️ **絵の取り方は「実際に描いた結果」から採る**＝クリップの欄（`x`/`y`/`w`/`h`）を直に読むと、
// グループの移動などが乗った**描いた結果とずれる**（同じ絵にならない＝ADR-0001）。

import { isMixingBlend, type Fit } from '../../domain/enums';
import { timelineFramePlan } from '../../domain/timeline/export';
import { bakeFrameTotal, planTimelineExportSegments } from '../../domain/timeline/exportSegments';
import type { TimelineExportSegment } from '../../domain/timeline/exportSegments';
import type { TimelineProject } from '../../domain/timeline/types';
import { isItemOfClip, layoutTimelineAt } from '../timelineLayout';
import { isPassableSlot, slotRectToOutput, splitVideoSceneSvg } from './videoSceneSplit';
import { svgToPngDataUrl } from './rasterize';
import { buildTimelineFrames, stageTimelineVideos, TIMELINE_FRAMES_DIR } from './buildTimelineFrames';
import { ExportCancelledError } from './buildExportScenes';
import type { BuildTimelineFramesOptions, StagedVideoRef } from './buildTimelineFrames';
import { drawRangesInParallel, frameChunks, PARALLEL_MIN_FRAMES, type FrameDrawer } from './parallelFrames';

/** 書き出しへ渡す1区間。`frames`＝焼いたコマ列（`still` は1コマだけ＝区間の長さまで止めて流す）／`video`＝実動画をそのまま流す。 */
export interface TimelineExportPart {
  fps: number;
  durationSec: number;
  /** 焼いたコマの置き場（`frames` のとき）。 */
  framesDir?: string;
  /** 置き場に置いたはずのコマの数（ADR-0070＝FFmpeg の前に抜けが無いかを確かめる）。 */
  expectedFrames?: number;
  /** 実動画をそのまま流すときの指定（`video` のとき）。 */
  video?: {
    clipId: string;
    assetId: string;
    /** 下に敷く静止画（背景など＝この区間では動かない）。 */
    belowPngBase64: string;
    /** 上に重ねる静止画（透過＝いまの条件では中身が無い）。⚠️ **渡さないと Rust が断る**。 */
    abovePngBase64: string;
    slotX: number;
    slotY: number;
    slotW: number;
    slotH: number;
    fit: Fit;
    clipStartSec: number;
    clipEndSec: number;
    speed: number;
  };
}

/** 区間ごとの置き場の名前（`is_safe_stage_name` を通る＝英数字と `_` だけ）。 */
export function framesDirForSegment(index: number): string {
  return index === 0 ? TIMELINE_FRAMES_DIR : `${TIMELINE_FRAMES_DIR}_${index}`;
}

/**
 * その区間を「実動画をそのまま流す」形に組み立てる。**組めなければ `undefined`**
 *（＝呼ぶ側は焼く方へ倒す＝**黙って違う絵を出さない**）。
 */
export async function buildVideoPart(
  doc: TimelineProject,
  seg: Extract<TimelineExportSegment, { kind: 'video' }>,
  opts: Pick<BuildTimelineFramesOptions, 'templateOf' | 'assetSrc' | 'assetSizeOf' | 'outputSize' | 'fontFamily'>,
): Promise<TimelineExportPart | undefined> {
  const clip = doc.clips.find((c) => c.id === seg.clipId);
  if (!clip || !clip.assetId) return undefined;
  const plan = timelineFramePlan(doc);
  // 区間の**真ん中**で描く＝端は半開区間の境目なので、出入りの判定がぶれる。
  const midSec = (seg.startSec + seg.endSec) / 2;
  const layout = layoutTimelineAt(doc, midSec, { templateOf: opts.templateOf, assetSizeOf: opts.assetSizeOf });
  const own = layout.items.filter((i) => isItemOfClip(i.id, seg.clipId));
  // ⚠️ **「絵1枚だけで描かれている部品」だけ倒す**＝見た目パターンのように中身が複数層あるものは、
  // 1枚の矩形へ写せない（写すと、文字や飾りが消えた動画が出る）。
  // ⚠️ **枚数と種類を1つの規則として書く**＝別々の行にすると「検査しているつもり」になる。
  // 見た目パターンの中身は**先頭が必ず下地（`fill`）**なので、枚数の条件だけを外しても
  // 種類の条件に隠れて結果が変わらない＝**片方だけを壊す変異が生き残る**（実際に生き残った）。
  const image = own.length === 1 && own[0].kind === 'image' ? own[0] : undefined;
  if (!image) return undefined;
  const item = image;
  // ⚠️ **描いた結果そのものを見る**（PR #1207 レビュー 🔴）＝倒すかどうかを
  // **クリップの欄だけ**で決めると、**グループに付いた静的な回転**が漏れる
  //（`applySimilarity` が `item.rotation` へ合流させるので、プレビューは回っているのに
  // 書き出しは回らない＝ADR-0026④「黙って別の絵を出さない」に反する）。
  // ⚠️ **出どころを数え上げない**＝ここで「実際に描かれる値」を見れば、
  // **将来どこから来た変形でも**取りこぼさない（グループの入れ子・新しい語彙など）。
  // ⚠️ **重ねる側（FFmpeg）に渡せるのは矩形と収め方だけ**＝それ以外が付いていたら焼く方へ倒す。
  // ⚠️ **1つの規則として書く**＝別々の行にすると「検査しているつもり」になる。
  // いま**外から到達できるのは回転だけ**（残りはクリップの欄を見る側で先に弾いている）ので、
  // 1行ずつにすると**残りの行を消しても緑のまま**＝嘘の安心になる。
  // ⚠️ **それでも残りを書く**＝どれが先に到達可能になっても、この1つの規則が受け止める。
  const drawnExtras =
    (item.rotation ?? 0) !== 0
    || (item.opacity != null && item.opacity < 1)
    || item.clipRect != null
    || item.colorAdjust != null
    || isMixingBlend(item.blendMode)
    // 反転（ADR-0059）＝FFmpeg の重ね合わせは矩形しか受けない＝焼く方へ倒す（SVG がゆがみごと描く）。
    || item.warp != null;
  if (drawnExtras) return undefined;
  // ⚠️ **分け方は場面形式と同じ部品を使う**（`splitVideoSceneSvg`）＝手で書き直すと、
  // 「下は不透明・上は透過」「境目はその絵の重ね順」といった決まりが**2か所に分かれて**ずれる。
  // ⚠️ **上の層も必ず出す**＝渡さないと Rust が断る（実機で `scene 2 video without above png`）。
  const split = splitVideoSceneSvg(layout, item.id, opts.assetSrc, undefined, opts.fontFamily, undefined);
  if (!split) return undefined;
  const width = opts.outputSize?.width ?? layout.width;
  const height = opts.outputSize?.height ?? layout.height;
  // ⚠️ **動画の枠も、下敷き・上敷きと同じ大きさの座標へ写す**（#1255 レビュー 🔴）＝
  // 写さないと「軽い（720）」で**動画だけが 1.5 倍・ずれた位置**に重なる（場面形式と同じ関数を通す）。
  const rect = slotRectToOutput(split.slot, layout, { width, height });
  // ⚠️ **渡せない枠（画面の左や上へはみ出した配置）は焼く方へ倒す**＝Rust は `u32` で受けるので、
  // 負の座標は受け取りに失敗して書き出しごと止まる。焼けば絵は正しく出る（遅くなるだけ）。
  if (!isPassableSlot(rect)) return undefined;
  const belowPngBase64 = await svgToPngDataUrl(split.belowSvg, width, height);
  const abovePngBase64 = await svgToPngDataUrl(split.aboveSvg, width, height);
  const speed = clip.speed ?? 1;
  // 素材のどこを使うか＝**この区間ぶんだけ**（区間はクリップの途中で切れることがある）。
  const intoClipSec = seg.startSec - clip.startSec;
  const clipStartSec = (clip.sourceStartSec ?? 0) + intoClipSec * speed;
  return {
    fps: plan.fps,
    durationSec: seg.endSec - seg.startSec,
    video: {
      clipId: clip.id,
      assetId: clip.assetId,
      belowPngBase64,
      abovePngBase64,
      ...rect,
      fit: item.fit,
      clipStartSec,
      clipEndSec: clipStartSec + (seg.endSec - seg.startSec) * speed,
      speed,
    },
  };
}

/**
 * 区間のコマを**隠した別の窓でも描く**ための口（ADR-0070）。区間ごとに、その区間を描く窓の描き手を返す
 * （使える窓が無ければ空＝本体だけで描く）。窓のつなぎ方は呼ぶ側（app 層）が持つ。
 */
export type ParallelDrawersFor = (seg: { framesDirName: string; stageIndexBase: number; stagedVideos: StagedVideoRef[] }) => FrameDrawer[];

/** 区間の割り方を先に決めた結果（ADR-0072）。`parts` を書き出しへ先に渡し、`draw` でコマを描いて置く。 */
export interface PlannedTimelineParts {
  /** 書き出しへ渡す区間（コマの区間は置き場の名前と、置くはずのコマの数が**描く前から**決まっている）。 */
  parts: TimelineExportPart[];
  /** コマを描いて置く（区間の順に）。割り方を決めただけでは1コマも描いていない。 */
  draw: () => Promise<void>;
}

/**
 * 書き出しの区間を**先に全部決め**、コマは後から描く（ADR-0072＝描きながら圧縮する）。
 *
 * ⚠️ **区間の中身（置き場・コマの数・長さ）は描く前に決まる**＝書き出しを先に頼み、描けたコマから順に圧縮させるため。
 * 描いた結果から数え直さない（数は割り方から出る＝`buildTimelineFrames` が返す数と同じ式）。
 * ⚠️ **組めなかった区間は焼く方へ倒す**（#1203）＝「倒せるはずだったのに組めなかった」を**黙って通さない**。
 */
export async function planTimelineParts(
  doc: TimelineProject,
  opts: BuildTimelineFramesOptions & { parallelDrawersFor?: ParallelDrawersFor },
): Promise<PlannedTimelineParts> {
  const plan = timelineFramePlan(doc);
  // ⚠️ **見た目パターンの解決を渡す**＝中に動画の差し込み口がある部品を
  // 「動かない上乗せ」と取り違えないため（渡さないと、動く絵を静止画に写してしまう）。
  const segments = planTimelineExportSegments(doc, opts.templateOf);
  const parts: TimelineExportPart[] = [];
  const drawSteps: (() => Promise<void>)[] = [];
  // ⚠️ **進み具合は「全部で何枚焼くか」で数える**＝区間ごとに 0 から数え直すと、
  // バーが**区間の数だけ行ったり来たり**する（倒せた区間は1枚も焼かないので、なおさら飛ぶ）。
  // ⚠️ **数え方は domain の1つを通す**（#1211）＝空きの見張りと同じ数を見る。
  const bakeTotal = bakeFrameTotal(segments, plan.fps);
  let baked = 0;
  // 置き場を使うか（使わない＝コマを文字のまま返す古い口・検査用）。
  const staged = Boolean(opts.stageFrame || opts.stageFramePng);

  // ⚠️ **1枚も焼かない回でも進み具合を出す**（同レビュー ℹ️）＝出さないと**0% のまま止まって見える**。
  const reportSegment = (done: number): void => { if (bakeTotal === 0) opts.onProgress?.(done, segments.length); };
  for (let i = 0; i < segments.length; i += 1) {
    // ⚠️ **区間ごとに中止を見る**（PR #1207 レビュー 🟡）＝倒した区間は1枚も焼かないので、
    // `buildTimelineFrames` の中の見張り（コマごと）に**一度も入らない**ことがある。
    if (opts.shouldCancel?.()) throw new ExportCancelledError();
    const seg = segments[i];
    if (seg.kind === 'video') {
      const part = await buildVideoPart(doc, seg, opts);
      // ⚠️ **いまは通常この分岐で落ちない**＝割る側（`planTimelineExportSegments`）と組む側が
      // **同じ条件**を見ているので、割る側が「倒せる」と言った区間は必ず組めます。
      // **どちらかを緩めたときの受け皿として残します**（消すと、そのとき黙って穴が開く）。
      if (part) {
        parts.push(part);
        reportSegment(i + 1);
        continue;
      }
    }
    const framesDirName = framesDirForSegment(i);
    if (seg.kind === 'still') {
      // ⚠️ **何も時間で変わらない区間は1コマだけ描く**（ADR-0032 決定22-2 追補3・#1376）＝描くのは毎コマの区間と
      // **同じ関数**（1コマぶん）。区間の長さは Rust が最後のコマを引き伸ばして満たす（`tpad=stop_mode=clone`）。
      const fromFrame = Math.round(seg.startSec * plan.fps);
      parts.push({
        fps: plan.fps,
        durationSec: seg.endSec - seg.startSec,
        ...(staged ? { framesDir: framesDirName, expectedFrames: 1 } : {}),
      });
      drawSteps.push(async () => {
        const bakedBefore = baked;
        await buildTimelineFrames(doc, {
          ...opts,
          onProgress: undefined,
          framesDirName,
          window: { fromFrame, toFrame: fromFrame + 1 },
        });
        baked = bakedBefore + 1;
        opts.onProgress?.(baked, bakeTotal);
      });
      continue;
    }
    const fromFrame = Math.round(seg.startSec * plan.fps);
    // ⚠️ **動画の長さで頭打ち**（`buildTimelineFrames` と同じ）＝区間の終わりが最後のコマを越えても、置くのはそこまで。
    const toFrame = Math.min(plan.frameCount, Math.round(seg.endSec * plan.fps));
    const count = Math.max(0, toFrame - fromFrame);
    parts.push({
      fps: plan.fps,
      // `buildTimelineFrames` が返す長さと同じ式（コマの数 ÷ fps）。
      durationSec: count / plan.fps,
      ...(staged ? { framesDir: framesDirName, expectedFrames: count } : {}),
    });
    drawSteps.push(async () => {
      const bakedBefore = baked;
      // **隠した別の窓でも描く**（ADR-0070）＝区間の中のコマの範囲を小分けにして、本体と窓で取り合う。
      // ⚠️ 置き場は区間ごとに1つのまま・番号は区間の頭から＝FFmpeg への渡し方は1窓のときと同じ（動画のバイトが変わらない）。
      // ⚠️ 動画の部品のコマは本体が先に1回だけ焼き出す＝窓どうしが同じ置き場を取り合わない。
      const helpers = opts.parallelDrawersFor && count >= PARALLEL_MIN_FRAMES && staged ? opts.parallelDrawersFor : undefined;
      if (helpers) {
        const stagedVideos = opts.readVideoFrame ? await stageTimelineVideos(doc, fromFrame, toFrame, opts) : [];
        const drawers = helpers({ framesDirName, stageIndexBase: fromFrame, stagedVideos });
        if (drawers.length > 0) {
          const main: FrameDrawer = {
            draw: async (range, onDone) => {
              await buildTimelineFrames(doc, {
                ...opts,
                onProgress: (done) => onDone(done),
                framesDirName,
                window: range,
                stageIndexBase: fromFrame,
                stagedVideos,
              });
            },
          };
          await drawRangesInParallel(frameChunks(fromFrame, toFrame), [main, ...drawers], {
            onProgress: (done) => {
              baked = bakedBefore + done;
              opts.onProgress?.(baked, bakeTotal);
            },
            ...(opts.shouldCancel ? { shouldCancel: opts.shouldCancel } : {}),
          });
          baked = bakedBefore + count;
          return;
        }
      }
      await buildTimelineFrames(doc, {
        ...opts,
        onProgress: (done) => {
          baked = bakedBefore + done;
          opts.onProgress?.(baked, bakeTotal);
        },
        framesDirName,
        window: { fromFrame, toFrame },
      });
      baked = bakedBefore + count;
    });
  }
  return {
    parts,
    draw: async () => {
      for (const step of drawSteps) {
        if (opts.shouldCancel?.()) throw new ExportCancelledError();
        await step();
      }
    },
  };
}

/**
 * 書き出しの区間を順に組み立てる（#1203）＝割り方を決めて（`planTimelineParts`）、そのまま描く。
 * 描き終えてから書き出しを頼む形（描きながら圧縮しない呼び手・検査）のための口。
 */
export async function buildTimelineParts(
  doc: TimelineProject,
  opts: BuildTimelineFramesOptions & { parallelDrawersFor?: ParallelDrawersFor },
): Promise<TimelineExportPart[]> {
  const planned = await planTimelineParts(doc, opts);
  await planned.draw();
  return planned.parts;
}
