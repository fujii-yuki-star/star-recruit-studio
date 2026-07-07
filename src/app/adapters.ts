// ドメイン（Scene/Part/Asset/Warning）→ 画面用UIモデル への変換。
// UIは見た目に専念し、ドメインを正とする（CLAUDE.md §4）。表示語は非技術語。
import { ASSET_TYPE, type SceneCategory } from "../domain/enums";
import { HEIGHT, WIDTH } from "../domain/constants";
import { validateFreeLayout } from "../domain/project/freeLayout";
import { sceneLines, sceneNeedsVoice } from "../domain/project/narrationLines";
import { unplaceableVideoSceneNumbers } from "../renderer/export/videoSlotPlacement";
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
  free: "自由配置",
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
    asset?.assetType === ASSET_TYPE.video ? "video" : asset ? "photo" : "none";

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
  const templateOf = (s: Scene): Template | undefined => templates.find((t) => t.templateId === s.templateId);
  // 場面に紐づく項目は「どの場面か」を番号で列挙し（#403・どの場面が問題か示す）、action がある項目は最初の該当場面へ
  // 飛べるよう sceneId を持たせる（#400）。番号は scenes の位置（1始まり）＝利用者が見る場面番号。多いと先頭8件＋「ほか N 件」。
  const fmtScenes = (nums: number[]): string =>
    nums.length <= 8 ? `場面${nums.join("・")}` : `場面${nums.slice(0, 8).join("・")} ほか${nums.length - 8}件`;
  const offending = (pred: (s: Scene) => boolean): { nums: number[]; firstId?: string } => {
    const hits: { id: string; n: number }[] = [];
    scenes.forEach((s, i) => { if (pred(s)) hits.push({ id: s.sceneId, n: i + 1 }); });
    return { nums: hits.map((h) => h.n), firstId: hits[0]?.id };
  };

  // 掛け合い・単一 narration を統一して見る（sceneNeedsVoice＝実効行の未生成・#403 P1）。scene.narration.status は直接見ない
  // ＝掛け合いは全行生成済みでも narration.status が更新されないため「要対応」に残り、「声を作成」が no-op に見えるバグを防ぐ。
  const voice = offending(sceneNeedsVoice);
  items.push(
    voice.nums.length > 0
      ? { id: "voice", label: "読み上げの声", detail: `${fmtScenes(voice.nums)}で声がまだ作成されていません。書き出し前に作成してください。`, severity: "action", action: "声を作成", sceneId: voice.firstId }
      : { id: "voice", label: "読み上げの声", detail: "すべての場面で声が作成済みです。", severity: "ok" },
  );

  const subtitle = offending((s) => (s.texts.subtitle?.length ?? 0) > (templateOf(s)?.aiHint?.maxSubtitleLength ?? 60));
  items.push(
    subtitle.nums.length > 0
      ? { id: "subtitle", label: "字幕の長さ", detail: `${fmtScenes(subtitle.nums)}の字幕が長いです。短くすると読みやすくなります。`, severity: "action", action: "短くする", sceneId: subtitle.firstId }
      : { id: "subtitle", label: "字幕の長さ", detail: "字幕の長さは読みやすい範囲です。", severity: "ok" },
  );

  // セリフの長さ／自由配置は warning のみで action ボタンが無いため sceneId は持たせない（場面番号は内容に列挙する）。
  // 掛け合いは本文が lines[].text 側にあるため、実効行（sceneLines）で各行の長さを見る（scene.narration.text 直参照は
  // 掛け合いで空＝未検出になる・ADR-0015）。単一 narration は sceneLines が1行に写すので従来と同一。
  const line = offending((s) => sceneLines(s).some((l) => l.text.length > (templateOf(s)?.aiHint?.maxNarrationLength ?? 120)));
  items.push(
    line.nums.length > 0
      ? { id: "line", label: "セリフの長さ", detail: `${fmtScenes(line.nums)}のセリフが長いです。短くすると聞き取りやすくなります。`, severity: "warning" }
      : { id: "line", label: "セリフの長さ", detail: "セリフの長さは適切です。", severity: "ok" },
  );

  const used = new Set<string>();
  for (const s of scenes) {
    for (const value of Object.values(s.assetRefs)) if (value) used.add(value);
    if (s.character.poseAssetId) used.add(s.character.poseAssetId);
    // FREE 場面の素材は assetRefs ではなく freeLayout[].assetId 経由で使われる（ADR-0008）。
    for (const el of s.freeLayout ?? []) if (el.assetId) used.add(el.assetId);
  }
  const unused = assets.filter((a) => !used.has(a.assetId)).length;
  items.push(
    unused > 0
      ? { id: "unused", label: "使っていない素材", detail: `使われていない素材が${unused}つあります。動画には入らないので、そのままでも問題ありません。`, severity: "warning" }
      : { id: "unused", label: "使っていない素材", detail: "すべての素材が使われています。", severity: "ok" },
  );

  // 自由配置（FREE 場面）の確認：要素が画面外・素材未解決・サイズ不正などがないか（ADR-0008 §8）。
  // FREE 場面が無いプロジェクトでは項目を出さない（通常プロジェクトのノイズを避ける）。
  const freeScenes = scenes.filter((s) => (s.freeLayout?.length ?? 0) > 0);
  if (freeScenes.length > 0) {
    const badFree = offending((s) => {
      if ((s.freeLayout?.length ?? 0) === 0) return false;
      const cv = templateOf(s)?.canvas ?? { width: WIDTH, height: HEIGHT };
      return validateFreeLayout(s.freeLayout ?? [], assets, cv).length > 0;
    });
    items.push(
      badFree.nums.length > 0
        ? { id: "freeLayout", label: "自由配置の確認", detail: `${fmtScenes(badFree.nums)}が、見直したほうがよい状態です（画面の外・素材の未設定など）。`, severity: "warning" }
        : { id: "freeLayout", label: "自由配置の確認", detail: "自由配置の場面は問題ありません。", severity: "ok" },
    );
  }

  // 動画の配置（#434・ADR-0026）：動画スロットがあるのにレイアウトへ配置できない場面（分割失敗＝内部不整合や
  // スロット/グループの非表示など）を**場面つきで**警告する。これを見逃すと書き出しが停止する（黙って静止画化しない）。
  // 問題がある場面が無ければ項目自体を出さない（通常プロジェクトのノイズを避ける・freeLayout チェックと同方針）。
  const templateById = new Map(templates.map((t) => [t.templateId, t] as const));
  const unplaceable = unplaceableVideoSceneNumbers(scenes, templateById, (id) => assets.find((a) => a.assetId === id));
  if (unplaceable.length > 0) {
    items.push({
      id: "videoPlacement",
      label: "動画の配置",
      detail: `${fmtScenes(unplaceable)}で動画を配置できません。場面編集で動画を置き直してから書き出してください。`,
      severity: "action",
      action: "直す",
      // 最初の該当場面（unplaceable は 1始まりの位置）へ飛ぶ。
      sceneId: scenes[unplaceable[0] - 1]?.sceneId,
    });
  }

  // 誤字脱字・誇大表現・個人情報の写り込みは自動チェック未対応のため、人の目での確認を促す
  items.push({
    id: "content",
    label: "文章・写り込みの確認",
    detail: "誤字脱字・誇大表現・個人情報の写り込みは、書き出し前に人の目でご確認ください（自動チェックは今後対応）。",
    severity: "warning",
  });

  return items;
}
