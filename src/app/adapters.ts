// ドメイン（Scene/Part/Asset/Warning）→ 画面用UIモデル への変換。
// UIは見た目に専念し、ドメインを正とする（CLAUDE.md §4）。表示語は非技術語。
import type { SceneCategory } from "../domain/enums";
import type { Asset, Part, Scene, Warning } from "../domain/project/types";
import type { Template } from "../domain/template/types";
import type { DraftRow, DraftWarning } from "./data/mockData";

const sceneTypeLabel: Record<SceneCategory, string> = {
  opening: "オープニング",
  closing: "クロージング",
  photo_intro: "写真紹介",
  video_intro: "動画紹介",
  point_list: "ポイント紹介",
  message: "メッセージ",
  full_visual: "全画面",
  chapter: "区切り",
  no_yuko: "ゆうこなし",
};

/** シーンの主役素材（mainVisual→background→最初の非null）を返す。 */
function mainAsset(scene: Scene, assets: Asset[]): Asset | undefined {
  const preferredKeys = ["mainVisual", "background"];
  for (const key of preferredKeys) {
    const id = scene.assetRefs[key];
    if (id) {
      const found = assets.find((a) => a.assetId === id);
      if (found) return found;
    }
  }
  for (const id of Object.values(scene.assetRefs)) {
    if (id) {
      const found = assets.find((a) => a.assetId === id);
      if (found) return found;
    }
  }
  return undefined;
}

/** 内部 Scene → 台本表の1行。 */
export function sceneToDraftRow(
  scene: Scene,
  parts: Part[],
  templates: Template[],
  assets: Asset[],
): DraftRow {
  const part = parts.find((p) => p.partId === scene.partId);
  const template = templates.find((t) => t.templateId === scene.templateId);
  const asset = mainAsset(scene, assets);
  const materialType: DraftRow["materialType"] =
    asset?.assetType === "video" ? "video" : asset ? "photo" : "none";

  return {
    id: scene.sceneId,
    order: scene.order,
    part: part?.title ?? "",
    scene: sceneTypeLabel[scene.sceneType],
    material: asset?.displayName ?? "（未設定）",
    line: scene.narration.text,
    look: template?.name ?? scene.templateId,
    materialType,
    // NarrationStatus と VoiceStatus は同一の値集合
    voiceStatus: scene.narration.status,
  };
}

/** 検証/補正の Warning → 画面表示用。 */
export function warningsToDraftWarnings(warnings: Warning[]): DraftWarning[] {
  return warnings.map((w) => ({
    message: w.message,
    severity: w.severity === "info" ? "info" : "warning",
  }));
}
