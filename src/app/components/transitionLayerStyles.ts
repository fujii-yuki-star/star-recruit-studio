// 切替効果プレビューの A/B レイヤの見た目（fade=opacity・slide=translate%）を返す純粋関数（#408 Part 2）。
// TransitionPreview からコンポーネント外へ切り出して単体テスト可能にする（Fast Refresh 警告の解消も兼ねる＝
// コンポーネントファイルはコンポーネントのみ export）。補間ロジックは export＝スクリーンショットに頼らず固定できる。
import type { CSSProperties } from "react";
import type { BoundaryTransition } from "../../domain/project/sceneTransitions";
import { TRANSITION_DIRECTION, TRANSITION_TYPE } from "../../domain/enums";

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
