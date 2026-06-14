import { useState } from "react";
import type { Asset, AssetRefs, Scene, Texts } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";
import { ASSET_TYPE } from "../../domain/enums";
import { DEFAULT_CHARACTER_ID } from "../../domain/constants";
import { useProjectStore } from "../store/projectStore";
import { ScenePreview } from "../components/ScenePreview";
import { PageHead } from "../components/ui";
import { EmptyState } from "../components/states";

// SceneCategory のユーザー向けラベル。
const categoryLabel: Record<string, string> = {
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

// レイヤー種別 → 「使用している要素」のユーザー向けラベル。
const layerLabel: Record<string, string> = {
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
    narration: { text: "", status: "none" },
    warnings: [],
  };
}

// テンプレが使う要素（レイヤー種別）を重複なく日本語ラベルで返す。
function usedElements(template: Template): string[] {
  const out: string[] = [];
  for (const layer of template.layers) {
    const label = layerLabel[layer.type];
    if (label && !out.includes(label)) out.push(label);
  }
  return out;
}

export function LooksScreen() {
  const templates = useProjectStore((s) => s.templates);
  const assets = useProjectStore((s) => s.assets);
  const [selectedId, setSelectedId] = useState(templates[0]?.templateId ?? "");
  const current = templates.find((t) => t.templateId === selectedId) ?? templates[0];

  if (!current) {
    return (
      <div className="main-scroll">
        <PageHead title="見た目パターンを管理" desc="動画の見た目のパターンを確認できます。" />
        <EmptyState
          title="見た目パターンがありません"
          message="標準の見た目パターンが読み込まれていません。"
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
              <span className="action-card-desc">{categoryLabel[t.category] ?? t.category}</span>
            </button>
          ))}
        </div>

        {/* 右: 選択中の見た目のプレビュー＋情報 */}
        <div className="card">
          <h2 className="section-title">プレビュー</h2>
          <ScenePreview scene={sampleScene} template={current} />
          <p className="text-sm text-muted mt">
            選択中の見た目「{current.name}」の見本です（写真・文字は例として表示しています）。
          </p>

          <hr className="divider" />
          <div className="col gap-sm">
            <div className="row-between">
              <span className="text-muted">名前</span>
              <strong>{current.name}</strong>
            </div>
            <div className="row-between">
              <span className="text-muted">カテゴリ</span>
              <span className="badge badge-teal">
                {categoryLabel[current.category] ?? current.category}
              </span>
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

          <p className="field-hint mt">見た目パターンの追加・編集は今後のバージョンで対応予定です。</p>
        </div>
      </div>
    </div>
  );
}
