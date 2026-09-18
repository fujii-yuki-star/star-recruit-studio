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

import type { Fit } from '../../domain/enums';
import { timelineFramePlan } from '../../domain/timeline/export';
import { bakeFrameTotal, planTimelineExportSegments } from '../../domain/timeline/exportSegments';
import type { TimelineExportSegment } from '../../domain/timeline/exportSegments';
import type { TimelineProject } from '../../domain/timeline/types';
import { isItemOfClip, layoutTimelineAt } from '../timelineLayout';
import { splitVideoSceneSvg } from './videoSceneSplit';
import { svgToPngDataUrl } from './rasterize';
import { buildTimelineFrames, TIMELINE_FRAMES_DIR } from './buildTimelineFrames';
import { ExportCancelledError } from './buildExportScenes';
import type { BuildTimelineFramesOptions } from './buildTimelineFrames';

/** 書き出しへ渡す1区間。`frames`＝焼いたコマ列／`video`＝実動画をそのまま流す。 */
export interface TimelineExportPart {
  fps: number;
  durationSec: number;
  /** 焼いたコマの置き場（`frames` のとき）。 */
  framesDir?: string;
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
    || (item.blendMode != null && item.blendMode !== 'normal');
  if (drawnExtras) return undefined;
  // ⚠️ **分け方は場面形式と同じ部品を使う**（`splitVideoSceneSvg`）＝手で書き直すと、
  // 「下は不透明・上は透過」「境目はその絵の重ね順」といった決まりが**2か所に分かれて**ずれる。
  // ⚠️ **上の層も必ず出す**＝渡さないと Rust が断る（実機で `scene 2 video without above png`）。
  const split = splitVideoSceneSvg(layout, item.id, opts.assetSrc, undefined, opts.fontFamily, undefined);
  if (!split) return undefined;
  const width = opts.outputSize?.width ?? layout.width;
  const height = opts.outputSize?.height ?? layout.height;
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
      slotX: split.slot.x,
      slotY: split.slot.y,
      slotW: split.slot.w,
      slotH: split.slot.h,
      fit: item.fit,
      clipStartSec,
      clipEndSec: clipStartSec + (seg.endSec - seg.startSec) * speed,
      speed,
    },
  };
}

/**
 * 書き出しの区間を順に組み立てる（#1203）。
 *
 * ⚠️ **組めなかった区間は焼く方へ倒す**＝「倒せるはずだったのに組めなかった」を**黙って通さない**。
 */
export async function buildTimelineParts(
  doc: TimelineProject,
  opts: BuildTimelineFramesOptions,
): Promise<TimelineExportPart[]> {
  const plan = timelineFramePlan(doc);
  // ⚠️ **見た目パターンの解決を渡す**＝中に動画の差し込み口がある部品を
  // 「動かない上乗せ」と取り違えないため（渡さないと、動く絵を静止画に写してしまう）。
  const segments = planTimelineExportSegments(doc, opts.templateOf);
  const parts: TimelineExportPart[] = [];
  // ⚠️ **進み具合は「全部で何枚焼くか」で数える**＝区間ごとに 0 から数え直すと、
  // バーが**区間の数だけ行ったり来たり**する（倒せた区間は1枚も焼かないので、なおさら飛ぶ）。
  // ⚠️ **数え方は domain の1つを通す**（#1211）＝空きの見張りと同じ数を見る。
  const bakeTotal = bakeFrameTotal(segments, plan.fps);
  let baked = 0;

  // ⚠️ **1枚も焼かない回でも進み具合を出す**（同レビュー ℹ️）＝出さないと**0% のまま止まって見える**。
  const reportSegment = (done: number): void => { if (bakeTotal === 0) opts.onProgress?.(done, segments.length); };
  for (let i = 0; i < segments.length; i += 1) {
    // ⚠️ **区間ごとに中止を見る**（PR #1207 レビュー 🟡）＝倒した区間は1枚も焼かないので、
    // `buildTimelineFrames` の中の見張り（コマごと）に**一度も入らない**ことがある。
    // そのとき中止を押しても、**残り全部の下敷き・上敷きを焼き終わるまで**効かない。
    if (opts.shouldCancel?.()) throw new ExportCancelledError();
    const seg = segments[i];
    if (seg.kind === 'video') {
      const part = await buildVideoPart(doc, seg, opts);
      // ⚠️ **いまは通常この分岐で落ちない**＝割る側（`planTimelineExportSegments`）と組む側が
      // **同じ条件**を見ているので、割る側が「倒せる」と言った区間は必ず組めます。
      // **どちらかを緩めたときの受け皿として残します**（消すと、そのとき黙って穴が開く＝
      // 組めなかった区間が**空のまま**出力へ流れる）。`timelineStore` の締めの取り合いにも同じ形の備えがあります。
      if (part) {
        parts.push(part);
        reportSegment(i + 1);
        continue;
      }
    }
    const bakedBefore = baked;
    const frames = await buildTimelineFrames(doc, {
      ...opts,
      onProgress: (done) => {
        baked = bakedBefore + done;
        opts.onProgress?.(baked, bakeTotal);
      },
      framesDirName: framesDirForSegment(i),
      window: {
        fromFrame: Math.round(seg.startSec * plan.fps),
        toFrame: Math.round(seg.endSec * plan.fps),
      },
    });
    baked = bakedBefore + Math.round(frames.durationSec * frames.fps);
    parts.push({
      fps: frames.fps,
      durationSec: frames.durationSec,
      ...(frames.framesDir ? { framesDir: frames.framesDir } : {}),
    });
  }
  return parts;
}
