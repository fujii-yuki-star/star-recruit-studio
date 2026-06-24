import { useState, type ChangeEvent } from "react";
import type { Asset, AssetRefs, FreeElement, Scene, Texts } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";
import { ASSET_TYPE, FREE_CATEGORY, FREE_SHAPE_TYPE, NARRATION_STATUS, type LayerType, type SceneCategory } from "../../domain/enums";
import { DEFAULT_CHARACTER_ID } from "../../domain/constants";
import { useProjectStore } from "../store/projectStore";
import { parseTemplateFiles } from "../../infrastructure/templateFs";
import { ScenePreview } from "../components/ScenePreview";
import { PageHead } from "../components/ui";
import { EmptyState } from "../components/states";

// SceneCategory のユーザー向けラベル（全値必須＝enum 追加時に漏れをコンパイルエラーで検知。§2-3）。
const categoryLabel: Record<SceneCategory, string> = {
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

// レイヤー種別 → 「使用している要素」のユーザー向けラベル（全値必須）。
const layerLabel: Record<LayerType, string> = {
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
function buildSampleScene(template: Template, assets: Asset[]): Scene {
  const firstImage = assets.find((a) => a.assetType === ASSET_TYPE.image);
  const logo = assets.find((a) => a.assetType === ASSET_TYPE.logo);
  const yuko = assets.find((a) => a.assetType === ASSET_TYPE.yuko);
  const assetRefs: AssetRefs = {};
  let hasCharacter = false;
  for (const layer of template.layers) {
    if (layer.type === "background" || layer.type === "slot") {
      assetRefs[layer.id] = firstImage?.assetId ?? null;
    } else if (layer.type === "logo") {
      assetRefs[layer.id] = logo?.assetId ?? null;
    } else if (layer.type === "character") {
      hasCharacter = true;
    }
  }
  const texts: Texts = {};
  for (const layer of template.layers) {
    if (layer.textKey === "title") texts.title = "見出しの例";
    else if (layer.textKey === "subtitle") texts.subtitle = "字幕の例文がここに入ります";
    else if (layer.textKey === "main") texts.main = "本文の例";
    else if (layer.textKey === "caption") texts.caption = "キャプションの例";
    else if (layer.textKey === "url") texts.url = "example.com";
  }
  // FREE テンプレは自由配置のサンプルを見せる（実演用・ADR-0008）。
  const freeLayout: FreeElement[] | undefined =
    template.category === FREE_CATEGORY
      ? [
          { id: "free_001", kind: "shape", x: 120, y: 130, w: 880, h: 820, zIndex: 5, shapeType: FREE_SHAPE_TYPE.rect, fillColor: "#e6f0ff", opacity: 1, radius: 24 },
          { id: "free_002", kind: "slot", x: 160, y: 170, w: 800, h: 540, zIndex: 10, assetId: firstImage?.assetId ?? null, fit: "cover" },
          { id: "free_003", kind: "text", x: 1080, y: 230, w: 720, h: 260, zIndex: 20, text: "自由に置いた見出し", fontSize: 64, color: "#222222", fontWeight: "bold" },
        ]
      : undefined;
  return {
    sceneId: "looks-preview",
    partId: "",
    order: 1,
    sceneType: template.category,
    templateId: template.templateId,
    durationSec: template.defaults?.durationSec ?? 8,
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

// FREE（自由配置）で「置けるもの」のラベル。FREE はテンプレ層でなく freeLayout に内容を持つため、
// レイヤー種別ではなく配置できる要素（素材/文字/図形）を示す（ADR-0008・#5）。
const FREE_PLACEABLE_LABELS = ["素材", "文字", "図形"];

// テンプレが使う要素を重複なく日本語ラベルで返す。FREE は「自由に置ける要素」を返す。
function usedElements(template: Template): string[] {
  if (template.category === FREE_CATEGORY) return FREE_PLACEABLE_LABELS;
  const out: string[] = [];
  for (const layer of template.layers) {
    const label = layerLabel[layer.type];
    if (!out.includes(label)) out.push(label);
  }
  return out;
}

export function LooksScreen() {
  const templates = useProjectStore((s) => s.templates);
  const assets = useProjectStore((s) => s.assets);
  const addTemplatePack = useProjectStore((s) => s.addTemplatePack);
  const [selectedId, setSelectedId] = useState(templates[0]?.templateId ?? "");
  const [loadMsg, setLoadMsg] = useState("");
  const [loadOk, setLoadOk] = useState(true);
  const current = templates.find((t) => t.templateId === selectedId) ?? templates[0];

  // 用意した見た目パターンのファイルを取り込む（検証は templateFs＝§2-2）。件数のみ提示（§2-3）。
  async function onLoadPack(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";
    if (files.length === 0) return;
    const { templates: loaded, rejected } = await parseTemplateFiles(files);
    const first = loaded[0];
    if (first) {
      addTemplatePack(loaded);
      setSelectedId(first.templateId);
    }
    setLoadOk(!!first);
    setLoadMsg(
      first
        ? `${loaded.length}件の見た目パターンを読み込みました。${rejected.length > 0 ? `（${rejected.length}件は内容が合わず取り込めませんでした）` : ""}`
        : "読み込める見た目パターンがありませんでした。ファイルの内容をご確認ください。",
    );
  }

  if (!current) {
    return (
      <div className="main-scroll">
        <PageHead title="見た目パターンを管理" desc="動画の見た目のパターンを確認できます。" />
        <EmptyState
          title="見た目パターンがありません"
          message="標準の見た目パターンが読み込まれていません。アプリを再起動してください。改善しない場合は、お手数ですがご連絡ください。"
        />
      </div>
    );
  }

  const sampleScene = buildSampleScene(current, assets);

  return (
    <div className="main-scroll">
      <PageHead
        title="見た目パターンを管理"
        desc="動画の見た目のパターンを確認できます。各場面に当てる見た目は「場面編集」で選べます。"
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 360px",
          gap: "var(--gap-lg)",
          alignItems: "start",
        }}
      >
        {/* 左: 見た目パターン一覧 */}
        <div className="card-grid cols-2">
          {templates.map((t) => (
            <button
              key={t.templateId}
              className="action-card"
              style={{
                borderColor: current.templateId === t.templateId ? "var(--color-primary)" : undefined,
                background: current.templateId === t.templateId ? "var(--color-primary-soft)" : undefined,
              }}
              onClick={() => setSelectedId(t.templateId)}
            >
              <span className="action-card-title">{t.name}</span>
              <span className="action-card-desc">{categoryLabel[t.category]}</span>
            </button>
          ))}
        </div>

        {/* 右: 選択中の見た目のプレビュー＋情報 */}
        <div className="card">
          <h2 className="section-title">見本</h2>
          <ScenePreview scene={sampleScene} template={current} />
          <p className="text-sm text-muted mt">
            {current.category === FREE_CATEGORY
              ? "「自由配置」は素材・文字・図形を好きな位置に置ける見た目です。これは配置例で、場面編集で自由に動かせます。"
              : `選択中の見た目「${current.name}」の見本です（写真・文字は例として表示しています）。`}
          </p>

          <hr className="divider" />
          <div className="col gap-sm">
            <div className="row-between">
              <span className="text-muted">名前</span>
              <strong>{current.name}</strong>
            </div>
            <div className="row-between">
              <span className="text-muted">カテゴリ</span>
              <span className="badge badge-teal">{categoryLabel[current.category]}</span>
            </div>
          </div>

          <hr className="divider" />
          <h3 className="field-label">使用している要素</h3>
          <div className="row gap-sm row-wrap">
            {usedElements(current).map((e) => (
              <span className="badge badge-gray" key={e}>
                {e}
              </span>
            ))}
          </div>

          <hr className="divider" />
          <input
            id="tmplPack"
            type="file"
            accept=".json,application/json"
            multiple
            hidden
            onChange={(e) => void onLoadPack(e)}
          />
          <label htmlFor="tmplPack" className="btn btn-secondary" style={{ cursor: "pointer" }}>
            見た目パターンを読み込む
          </label>
          <p className="field-hint mt">用意した見た目パターンのファイルを追加できます（編集は今後のバージョンで対応予定）。</p>
          {loadMsg && (
            <div className={`notice ${loadOk ? "notice-info" : "notice-warn"} mt`} role={loadOk ? "status" : "alert"}>
              <span>{loadMsg}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
