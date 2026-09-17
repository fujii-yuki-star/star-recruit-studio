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
import { planTimelineExportSegments } from '../../domain/timeline/exportSegments';
import type { TimelineExportSegment } from '../../domain/timeline/exportSegments';
import type { TimelineProject } from '../../domain/timeline/types';
import { isItemOfClip, layoutTimelineAt } from '../timelineLayout';
import { layoutToSvg } from '../sceneSvg';
import { svgToPngDataUrl } from './rasterize';
import { buildTimelineFrames, TIMELINE_FRAMES_DIR } from './buildTimelineFrames';
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
  // 下に敷く絵＝**その部品だけを外した**同じ描き方（背景や余白がそのまま出る）。
  const below = { ...layout, items: layout.items.filter((i) => !isItemOfClip(i.id, seg.clipId)) };
  const belowSvg = layoutToSvg(below, {
    assetSrc: opts.assetSrc,
    ...(opts.fontFamily ? { fontFamily: opts.fontFamily } : {}),
  });
  const belowPngBase64 = await svgToPngDataUrl(
    belowSvg,
    opts.outputSize?.width ?? layout.width,
    opts.outputSize?.height ?? layout.height,
  );
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
      slotX: item.x,
      slotY: item.y,
      slotW: item.w,
      slotH: item.h,
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
  const segments = planTimelineExportSegments(doc);
  const parts: TimelineExportPart[] = [];
  // ⚠️ **進み具合は「全部で何枚焼くか」で数える**＝区間ごとに 0 から数え直すと、
  // バーが**区間の数だけ行ったり来たり**する（倒せた区間は1枚も焼かないので、なおさら飛ぶ）。
  const bakeTotal = segments
    .filter((s) => s.kind === 'frames')
    .reduce((a2, s) => a2 + Math.round((s.endSec - s.startSec) * plan.fps), 0);
  let baked = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    if (seg.kind === 'video') {
      const part = await buildVideoPart(doc, seg, opts);
      // ⚠️ **いまは通常この分岐で落ちない**＝割る側（`planTimelineExportSegments`）と組む側が
      // **同じ条件**を見ているので、割る側が「倒せる」と言った区間は必ず組めます。
      // **どちらかを緩めたときの受け皿として残します**（消すと、そのとき黙って穴が開く＝
      // 組めなかった区間が**空のまま**出力へ流れる）。`timelineStore` の締めの取り合いにも同じ形の備えがあります。
      if (part) {
        parts.push(part);
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
