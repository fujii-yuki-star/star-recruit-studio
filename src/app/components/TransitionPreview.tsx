// 切替効果（トランジション）のプレビュー合成（#408 Part 2）。ScenePreview の fit 箱に children として重ね、
// A（前場面・settled）→ B（当該場面・settled）を progress 0→1 で描く。停止中は描画側で非表示にし、下の
// ScenePreview が B を表示する（最終フレーム＝B と一致してカクつかない）。
// - fade＝B を上に重ねて opacity 0→1（下に A・クロスフェード）。
// - slide＝押し出し：A が direction へ抜け、B が反対端から入る（FFmpeg xfade slide と同じ見え方）。
// 使う値（type/direction/clamp後 D）は resolveBoundaryTransition＝書き出しと同一＝プレビュー=書き出しパリティ（ADR-0001/0026）。
// SVG は responsive:true で 100% 充填＝親（fit 箱）にそのまま重なる（ScenePreview と同じ layoutScene→layoutToSvg）。
import type { CSSProperties } from "react";
import type { Scene } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";
import type { BoundaryTransition } from "../../domain/project/sceneTransitions";
import { TRANSITION_DIRECTION, TRANSITION_TYPE } from "../../domain/enums";
import { layoutScene } from "../../renderer/layout";
import { layoutToSvg } from "../../renderer/sceneSvg";
import { firstFrameLineIndex, lastFrameLineIndex, resolveLineSubtitle } from "../../domain/project/lineTimeline";
import { creditForLine, creditForSpeaker } from "../../domain/voice/narratorCredit";
import { fontFamilyForId, resolveFontId } from "../../domain/font/fontCatalog";
import { getVoicevoxSpeaker } from "../../infrastructure/appSettings";
import { useProjectStore } from "../store/projectStore";

/**
 * progress 0→1 での A/B レイヤの見た目（fade=opacity・slide=translate%）を返す純粋関数。export＝スクリーンショットに
 * 頼らず補間ロジックを単体テストするため（#408 Part 2）。fade は B を上に opacity 0→1、slide は押し出し。
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

export function TransitionPreview({
  prevScene,
  prevTemplate,
  scene,
  template,
  boundary,
  progress,
}: {
  prevScene: Scene;
  prevTemplate: Template;
  scene: Scene;
  template: Template;
  boundary: BoundaryTransition;
  progress: number;
}) {
  const assetSrcById = useProjectStore((s) => s.assetSrcById);
  const templateAssetSrcById = useProjectStore((s) => s.templateAssetSrcById);
  const fontId = useProjectStore((s) => s.meta.videoSettings.fontId);
  const assetSrc = (id: string | null): string | undefined =>
    id ? (assetSrcById[id] ?? templateAssetSrcById[id]) : undefined;
  const baseCredit = creditForSpeaker(getVoicevoxSpeaker());
  // 境界フレームを ScenePreview と同一ロジック（inGap/activeLine/applyLineSub）で焼く（#408 レビュー P1 パリティ）。
  // activeLineIndex：B（この場面）＝先頭フレーム（頭に間があれば -1＝字幕なし・既定クレジット＝書き出しの headGap と一致・
  // かつ場面編集の下地 ScenePreview と同値＝停止フラッシュなし）／A（前場面）＝末尾行。非掛け合いは undefined でテンプレ既定。
  const svgFor = (sc: Scene, tpl: Template, activeLineIndex: number | undefined): string => {
    const hasLines = !!(sc.lines && sc.lines.length > 0);
    const inGap = hasLines && activeLineIndex !== undefined && activeLineIndex < 0;
    const activeLine = hasLines && !inGap ? (sc.lines![activeLineIndex ?? 0] ?? sc.lines![0]) : undefined;
    const lineSub = activeLine ? resolveLineSubtitle(activeLine, sc) : undefined;
    const applyLineSub = inGap || !!lineSub;
    const layoutOpts = applyLineSub
      ? { subtitleText: inGap ? null : lineSub && lineSub.enabled ? lineSub.text : null }
      : undefined;
    const credit = activeLine ? creditForLine(activeLine, baseCredit) : baseCredit;
    return layoutToSvg(layoutScene(sc, tpl, layoutOpts), {
      assetSrc,
      responsive: true,
      credit,
      fontFamily: fontFamilyForId(resolveFontId(sc.fontId, fontId)),
    });
  };
  const { a, b } = layerStyles(boundary, progress);
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", borderRadius: "var(--radius)" }} aria-hidden>
      <div style={a} dangerouslySetInnerHTML={{ __html: svgFor(prevScene, prevTemplate, lastFrameLineIndex(prevScene)) }} />
      <div style={b} dangerouslySetInnerHTML={{ __html: svgFor(scene, template, firstFrameLineIndex(scene)) }} />
    </div>
  );
}
