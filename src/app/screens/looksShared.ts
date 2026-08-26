// 見た目パターンの一覧（LooksScreen）と編集画面（LooksEditScreen）で共有する小物（§6＝文言/ロジックは1か所）。
// コンポーネントを export しないファイルに分けることで Fast Refresh の警告も避ける。
import type { Asset, AssetRefs, FreeElement, Scene, Texts } from "../../domain/project/types";
import { defaultDurationForTemplate } from "../../domain/template/layerOps";
import type { Template } from "../../domain/template/types";
import { ASSET_TYPE, FREE_CATEGORY, FREE_SHAPE_TYPE, LAYER_TYPE, NARRATION_STATUS, type LayerType } from "../../domain/enums";
import { DEFAULT_CHARACTER_ID } from "../../domain/constants";

// レイヤー種別 → 「使用している要素」のユーザー向けラベル（全値必須＝enum 追加時に漏れをコンパイルエラーで検知。§2-3）。
export const layerLabel: Record<LayerType, string> = {
  background: "背景",
  slot: "メイン素材",
  text: "文字",
  subtitle: "字幕",
  logo: "ロゴ",
  character: "ゆうこ",
  decor: "装飾",
  shape: "図形",
};

// テンプレの見た目を確認するためのサンプル場面（実素材が無くても配置＋見本テキストで見せる）。
export function buildSampleScene(template: Template, assets: Asset[]): Scene {
  const yuko = assets.find((a) => a.assetType === ASSET_TYPE.yuko);
  // 見本にはプロジェクトの素材を自動で流し込まない（ADR-0021 ①）。背景/メイン素材/ロゴはテンプレ既定素材
  // （layer.assetId・描画フォールバック）があれば表示、無ければプレースホルダ枠。ゆうこ（立ち絵）は持ち主の写真ではなく
  // 演者なので、character レイヤーがあれば既定ポーズで見せる。
  const assetRefs: AssetRefs = {};
  const hasCharacter = template.layers.some((l) => l.type === LAYER_TYPE.character);
  const texts: Texts = {};
  for (const layer of template.layers) {
    if (layer.textKey === "title") texts.title = "見出しの例";
    else if (layer.textKey === "subtitle") texts.subtitle = "字幕の例文がここに入ります";
    else if (layer.textKey === "main") texts.main = "本文の例";
    else if (layer.textKey === "caption") texts.caption = "キャプションの例";
    else if (layer.textKey === "url") texts.url = "example.com";
  }
  // FREE テンプレは自由配置のサンプルを見せる（実演用・ADR-0008）。スロットは空＝持ち主の写真を勝手に出さない（ADR-0021 ①）。
  const freeLayout: FreeElement[] | undefined =
    template.category === FREE_CATEGORY
      ? [
          { id: "free_001", kind: "shape", x: 120, y: 130, w: 880, h: 820, zIndex: 5, shapeType: FREE_SHAPE_TYPE.rect, fillColor: "#e6f0ff", opacity: 1, radius: 24 },
          { id: "free_002", kind: "slot", x: 160, y: 170, w: 800, h: 540, zIndex: 10, assetId: null, fit: "cover" },
          { id: "free_003", kind: "text", x: 1080, y: 230, w: 720, h: 260, zIndex: 20, text: "自由に置いた見出し", fontSize: 64, color: "#222222", fontWeight: "bold" },
        ]
      : undefined;
  return {
    sceneId: "looks-preview",
    partId: "",
    order: 1,
    sceneType: template.category,
    templateId: template.templateId,
    durationSec: defaultDurationForTemplate(template),
    assetRefs,
    character: {
      enabled: hasCharacter,
      characterId: DEFAULT_CHARACTER_ID,
      poseAssetId: yuko?.assetId ?? null,
    },
    texts,
    narration: { text: "", status: NARRATION_STATUS.none },
    warnings: [],
    freeLayout,
  };
}
