// ドメイン（Scene/Part/Asset/Warning）→ 画面用UIモデル への変換。
// UIは見た目に専念し、ドメインを正とする（CLAUDE.md §4）。表示語は非技術語。
import type { SceneCategory } from "../domain/enums";
import type { Asset, Part, Scene, Warning } from "../domain/project/types";
import type { Template } from "../domain/template/types";
import type { DraftRow, DraftWarning, PrecheckItem } from "./data/mockData";

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

/** 公開前チェックの結果を、実際のシーン/素材から算出する（一部は自動チェック未対応の定型）。 */
export function buildPrecheckItems(scenes: Scene[], assets: Asset[], templates: Template[]): PrecheckItem[] {
  const items: PrecheckItem[] = [];

  const noVoice = scenes.filter((s) => s.narration.status !== "generated").length;
  items.push(
    noVoice > 0
      ? { id: "voice", label: "ゆうこの声", detail: `${noVoice}つの場面で声がまだ作成されていません。書き出し前に作成してください。`, severity: "action", action: "声を作成" }
      : { id: "voice", label: "ゆうこの声", detail: "すべての場面で声が作成済みです。", severity: "ok" },
  );

  const longSubtitle = scenes.filter((s) => {
    const template = templates.find((t) => t.templateId === s.templateId);
    const max = template?.aiHint?.maxSubtitleLength ?? 60;
    return (s.texts.subtitle?.length ?? 0) > max;
  }).length;
  items.push(
    longSubtitle > 0
      ? { id: "subtitle", label: "字幕の長さ", detail: `字幕が長い場面が${longSubtitle}つあります。短くすると読みやすくなります。`, severity: "action", action: "短くする" }
      : { id: "subtitle", label: "字幕の長さ", detail: "字幕の長さは読みやすい範囲です。", severity: "ok" },
  );

  const longLine = scenes.filter((s) => {
    const template = templates.find((t) => t.templateId === s.templateId);
    const max = template?.aiHint?.maxNarrationLength ?? 120;
    return s.narration.text.length > max;
  }).length;
  items.push(
    longLine > 0
      ? { id: "line", label: "セリフの長さ", detail: `セリフが長い場面が${longLine}つあります。`, severity: "warning" }
      : { id: "line", label: "セリフの長さ", detail: "セリフの長さは適切です。", severity: "ok" },
  );

  const used = new Set<string>();
  for (const s of scenes) {
    for (const value of Object.values(s.assetRefs)) if (value) used.add(value);
    if (s.character.poseAssetId) used.add(s.character.poseAssetId);
  }
  const unused = assets.filter((a) => !used.has(a.assetId)).length;
  items.push(
    unused > 0
      ? { id: "unused", label: "使っていない素材", detail: `使われていない素材が${unused}つあります。`, severity: "warning" }
      : { id: "unused", label: "使っていない素材", detail: "すべての素材が使われています。", severity: "ok" },
  );

  // 誤字脱字・誇大表現・個人情報の写り込みは自動チェック未対応のため、人の目での確認を促す
  items.push({
    id: "content",
    label: "文章・写り込みの確認",
    detail: "誤字脱字・誇大表現・個人情報の写り込みは、書き出し前に人の目でご確認ください（自動チェックは今後対応）。",
    severity: "warning",
  });

  return items;
}
