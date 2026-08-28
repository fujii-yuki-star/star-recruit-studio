// 切替効果（トランジション）のプレビュー合成（#408 Part 2）。ScenePreview の fit 箱に children として重ね、
// A（前場面・settled）→ B（当該場面・settled）を progress 0→1 で描く。停止中は描画側で非表示にし、下の
// ScenePreview が B を表示する（最終フレーム＝B と一致してカクつかない）。
// - fade＝B を上に重ねて opacity 0→1（下に A・クロスフェード）。
// - slide＝押し出し：A が direction へ抜け、B が反対端から入る（FFmpeg xfade slide と同じ見え方）。
// 使う値（type/direction/clamp後 D）は resolveBoundaryTransition＝書き出しと同一＝プレビュー=書き出しパリティ（ADR-0001/0026）。
// SVG は responsive:true で 100% 充填＝親（fit 箱）にそのまま重なる（ScenePreview と同じ layoutScene→layoutToSvg）。
import type { Scene } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";
import type { BoundaryTransition } from "../../domain/project/sceneTransitions";
import { layoutScene } from "../../renderer/layout";
import { layoutToSvg } from "../../renderer/sceneSvg";
import { firstFrameBoundary, lastFrameBoundary, type BoundaryFrame } from "../../domain/project/lineTimeline";
import { lineDurationsFromAudio } from "../../domain/project/narrationLines";
import { creditForLine, creditForSpeaker } from "../../domain/voice/narratorCredit";
import { fontFamilyForId, resolveFontId } from "../../domain/font/fontCatalog";
import { getVoicevoxSpeaker } from "../../infrastructure/appSettings";
import { useProjectStore } from "../store/projectStore";
import { sceneCreditVisibility } from "../../domain/project/sceneCredit";
import { layerStyles } from "./transitionLayerStyles";

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
  const narrationAudioById = useProjectStore((s) => s.narrationAudioById);
  const fontId = useProjectStore((s) => s.meta.videoSettings.fontId);
  // クレジットの見せ方（ADR-0025・#359）。**下に敷いてある ScenePreview と同じ判定を通す**＝
  // 通さないと、同じ画面の同じ瞬間に「下（出さない）と上（出す）」が食い違う（PR #881 レビュー）。
  const creditDisplay = useProjectStore((s) => s.meta.videoSettings.creditDisplay);
  const projectScenes = useProjectStore((s) => s.scenes);
  const creditVisible = sceneCreditVisibility(projectScenes, creditDisplay);
  const assetSrc = (id: string | null): string | undefined =>
    id ? (assetSrcById[id] ?? templateAssetSrcById[id]) : undefined;
  const baseCredit = creditForSpeaker(getVoicevoxSpeaker());
  // 端フレームの字幕/クレジットは firstFrameBoundary/lastFrameBoundary（sceneSegmentSpecs 準拠）で解決＝
  // 0 秒行除外・頭の間・全 0 秒フォールバックまで書き出しと一致（#408 レビュー P1）。B（この場面）＝先頭フレーム
  // （場面編集の下地 ScenePreview と同値＝停止フラッシュなし）／A（前場面）＝最終フレーム。
  const svgFor = (sc: Scene, tpl: Template, boundaryFrame: BoundaryFrame): string => {
    const applyLineSub = boundaryFrame.subtitleText !== undefined;
    const layoutOpts = applyLineSub ? { subtitleText: boundaryFrame.subtitleText } : undefined;
    const creditText = boundaryFrame.creditLine ? creditForLine(boundaryFrame.creditLine, baseCredit) : baseCredit;
    // 見本の場面（動画の場面ではない）は index が無い＝従来どおり出す（ScenePreview と同じ規則）。
    const index = projectScenes.findIndex((s) => s.sceneId === sc.sceneId);
    const credit = index < 0 || creditVisible[index] ? creditText : undefined;
    return layoutToSvg(layoutScene(sc, tpl, layoutOpts), {
      assetSrc,
      responsive: true,
      ...(credit != null ? { credit } : {}),
      fontFamily: fontFamilyForId(resolveFontId(sc.fontId, fontId)),
    });
  };
  const { a, b } = layerStyles(boundary, progress);
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", borderRadius: "var(--radius)" }} aria-hidden>
      <div
        style={a}
        dangerouslySetInnerHTML={{
          __html: svgFor(prevScene, prevTemplate, lastFrameBoundary(prevScene, lineDurationsFromAudio(prevScene, narrationAudioById))),
        }}
      />
      <div
        style={b}
        dangerouslySetInnerHTML={{
          __html: svgFor(scene, template, firstFrameBoundary(scene, lineDurationsFromAudio(scene, narrationAudioById))),
        }}
      />
    </div>
  );
}
