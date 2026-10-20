// 切替効果プレビューの A/B レイヤの見た目（fade=opacity・slide=translate%・wipe=clip-path・zoom=scale＋opacity）を返す純粋関数（#408 Part 2・ADR-0066）。
// TransitionPreview からコンポーネント外へ切り出して単体テスト可能にする（Fast Refresh 警告の解消も兼ねる＝
// コンポーネントファイルはコンポーネントのみ export）。補間ロジックは export＝スクリーンショットに頼らず固定できる。
import type { CSSProperties } from "react";
import { wipeHiddenEdges, zoomInState } from "../../domain/project/sceneTransitions";
import type { BoundaryTransition } from "../../domain/project/sceneTransitions";
import { TRANSITION_DIRECTION, TRANSITION_TYPE } from "../../domain/enums";

/** 寄り切った後に使う倍率（中心の1画素が画面を埋める大きさ＝これ以上は見え方が変わらない）。 */
const ZOOM_SCALE_CAP = 4096;

/**
 * progress 0→1 での A/B レイヤの見た目を返す純粋関数。fade は B を上に opacity 0→1、slide は押し出し
 * （A が direction へ 0→±100%、B が反対端 ∓100%→0）。left/up=負方向。TransitionPreview が重ね合わせに使う。
 */
export function layerStyles(boundary: BoundaryTransition, progress: number): { a: CSSProperties; b: CSSProperties } {
  const base: CSSProperties = { position: "absolute", inset: 0 };
  if (boundary.type === TRANSITION_TYPE.fade) {
    // B を上に重ねてフェードイン（下に A）。progress 1 で B が完全表示。
    return { a: { ...base, opacity: 1 }, b: { ...base, opacity: progress } };
  }
  if (boundary.type === TRANSITION_TYPE.wipe) {
    // ワイプ（ADR-0066 決定1）＝B を上に重ね、見えている範囲を `clip-path` で切る（境目は一定の速さ＝xfade と同じ）。
    const e = wipeHiddenEdges(boundary.direction, progress);
    const pct = (v: number): string => `${v * 100}%`;
    return {
      a: { ...base },
      b: { ...base, clipPath: `inset(${pct(e.top)} ${pct(e.right)} ${pct(e.bottom)} ${pct(e.left)})` },
    };
  }
  if (boundary.type === TRANSITION_TYPE.zoom) {
    // ズーム（ADR-0066 決定2）＝**A を上に**重ね、中心まわりに寄せながら不透明度を下げる（下の B が見えてくる）。
    // ⚠️ 寄り切った後（倍率 ∞）は大きな倍率で代える＝書き出しは中心の1画素の色で、画面上は同じ見え方。
    const z = zoomInState(progress);
    const scale = Number.isFinite(z.zoom) ? Math.min(z.zoom, ZOOM_SCALE_CAP) : ZOOM_SCALE_CAP;
    return {
      a: { ...base, zIndex: 1, transform: `scale(${scale})`, transformOrigin: "50% 50%", opacity: z.outgoingWeight, willChange: "transform" },
      b: { ...base },
    };
  }
  // slide 押し出し：A は direction へ 0→±100%、B は反対端 ∓100%→0。left/up=負方向。
  const horizontal =
    boundary.direction === TRANSITION_DIRECTION.left || boundary.direction === TRANSITION_DIRECTION.right;
  const axis = horizontal ? "X" : "Y";
  const sign =
    boundary.direction === TRANSITION_DIRECTION.left || boundary.direction === TRANSITION_DIRECTION.up ? -1 : 1;
  const aOff = sign * progress * 100;
  const bOff = sign * (progress - 1) * 100;
  return {
    a: { ...base, transform: `translate${axis}(${aOff}%)` },
    b: { ...base, transform: `translate${axis}(${bOff}%)` },
  };
}
