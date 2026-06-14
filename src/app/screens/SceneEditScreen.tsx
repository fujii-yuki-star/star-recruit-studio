import { useEffect, useState, type ChangeEvent } from "react";
import type { ScreenId } from "../data/mockData";
import type { Asset, Scene } from "../../domain/project/types";
import type { Layer } from "../../domain/template/types";
import { useProjectStore } from "../store/projectStore";
import { ScenePreview } from "../components/ScenePreview";
import { Switch } from "../components/ui";
import { EmptyState } from "../components/states";
import {
  SearchIcon,
  PhotoIcon,
  VideoIcon,
  MusicIcon,
  UploadIcon,
  PlusIcon,
  SaveIcon,
  ChevronRightIcon,
} from "../components/icons";

interface SceneEditProps {
  onNavigate: (screen: ScreenId) => void;
}

type AssetFilter = "all" | "image" | "video" | "bgm";

const sceneTypeLabel: Record<string, string> = {
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

// スロットのユーザー向けラベル（レイヤーid別。複数スロットでも区別できるよう id をキーにする）。
const slotLabel: Record<string, string> = {
  background: "背景",
  mainVisual: "メイン素材",
  logo: "ロゴ",
};

const narrationStatusLabel: Record<string, string> = {
  none: "未作成",
  pending: "作成中…",
  generated: "作成済み",
  failed: "失敗（もう一度お試しください）",
};

// スロットの slotType と素材の assetType の整合で、割り当て可能な素材を絞る（§5）。
function assignableFor(layer: Layer, assets: Asset[]): Asset[] {
  return assets.filter((a) => {
    if (layer.type === "logo") return a.assetType === "logo" || a.assetType === "image";
    if (layer.slotType === "image") return a.assetType === "image";
    if (layer.slotType === "video") return a.assetType === "video";
    // background / slot(image_or_video) / slotType未指定
    return a.assetType === "image" || a.assetType === "video";
  });
}

function assetThumbClass(type: Asset["assetType"]): string {
  if (type === "video") return "thumb-video";
  if (type === "bgm") return "thumb-audio";
  return "thumb-photo";
}

export function SceneEditScreen({ onNavigate }: SceneEditProps) {
  const {
    status, scenes, templates, assets, generate, updateScene, addAsset,
    generateNarration, generateAllNarrations, isGeneratingNarration, narrationAudioById, narrationError,
  } = useProjectStore();

  const [filter, setFilter] = useState<AssetFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  // こだわり編集（現状はUIのみ・後でドメインへ結線）
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (status === "idle") void generate();
  }, [status, generate]);

  const selected = scenes.find((s) => s.sceneId === selectedId) ?? scenes[0];
  const template = selected ? templates.find((t) => t.templateId === selected.templateId) : undefined;
  // assetRefs を割り当てられるスロット層（背景/メイン/ロゴ）と、割当可能な素材。
  const slotLayers =
    template?.layers.filter((l) => l.type === "background" || l.type === "slot" || l.type === "logo") ?? [];

  const visibleAssets = assets.filter((a) => {
    const matchType =
      filter === "all" ||
      (filter === "image" && a.assetType === "image") ||
      (filter === "video" && a.assetType === "video") ||
      (filter === "bgm" && a.assetType === "bgm");
    return matchType && a.displayName.includes(search);
  });

  if (!selected) {
    return (
      <div className="main-scroll">
        <EmptyState
          title={status === "generating" ? "動画案を作成中です…" : "編集する場面がありません"}
          message="「新しい動画を作る」から動画案を作成してください。"
          action={
            <button className="btn btn-primary" onClick={() => onNavigate("wizard")}>
              新しい動画を作る
            </button>
          }
        />
      </div>
    );
  }

  // 選択中シーンを更新するヘルパー
  const patch = (update: (s: Scene) => Scene) => updateScene(selected.sceneId, update);

  function onUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") void addAsset({ name: file.name, dataUrl: reader.result });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div className="topbar" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <div className="topbar-title">場面編集</div>
        <div className="topbar-actions">
          <button
            className="btn btn-ghost"
            onClick={() => void generateAllNarrations()}
            disabled={isGeneratingNarration}
          >
            {isGeneratingNarration ? "作成中…" : "全場面の声を作成"}
          </button>
          <button className="btn btn-secondary" onClick={() => onNavigate("draft")}>
            台本表に戻る
          </button>
          <button className="btn btn-primary" onClick={() => onNavigate("preview")}>
            仕上がり確認へ
            <ChevronRightIcon size={18} />
          </button>
        </div>
      </div>

      <div style={{ flex: 1, padding: "var(--gap)", overflow: "hidden" }}>
        <div className="editor-grid">
          {/* 左: 素材一覧 */}
          <div className="editor-col">
            <h2 className="field-label">素材一覧</h2>
            <div
              className="row gap-sm"
              style={{
                border: "1px solid var(--color-border-strong)",
                borderRadius: "var(--radius-sm)",
                padding: "6px 10px",
                marginBottom: 10,
              }}
            >
              <SearchIcon size={16} className="text-faint" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="素材を検索"
                style={{ border: "none", outline: "none", width: "100%", fontSize: 13, background: "transparent" }}
              />
            </div>

            <div className="segment mb" style={{ display: "flex" }}>
              {([
                ["all", "すべて"],
                ["image", "写真"],
                ["video", "動画"],
                ["bgm", "音"],
              ] as [AssetFilter, string][]).map(([id, label]) => (
                <button key={id} className={filter === id ? "active" : ""} onClick={() => setFilter(id)} style={{ flex: 1, padding: "7px 4px" }}>
                  {label}
                </button>
              ))}
            </div>

            <div className="col" style={{ gap: 2 }}>
              {visibleAssets.map((a) => (
                <div className="asset-tile" key={a.assetId}>
                  <div className={`asset-tile-thumb thumb ${assetThumbClass(a.assetType)}`} style={{ aspectRatio: "auto" }}>
                    {a.assetType === "video" ? (
                      <VideoIcon size={16} />
                    ) : a.assetType === "bgm" ? (
                      <MusicIcon size={16} />
                    ) : (
                      <PhotoIcon size={16} />
                    )}
                  </div>
                  <span className="text-sm">{a.displayName}</span>
                </div>
              ))}
            </div>

            <label className="btn btn-secondary btn-block mt" style={{ cursor: "pointer" }}>
              <UploadIcon size={16} />
              素材をアップロード
              <input type="file" accept="image/*,video/*" onChange={onUpload} style={{ display: "none" }} />
            </label>
          </div>

          {/* 中央: 仕上がり確認 + 場面カード */}
          <div className="col gap" style={{ overflow: "hidden" }}>
            <div className="editor-col grow" style={{ overflow: "auto" }}>
              <h2 className="field-label">仕上がり確認</h2>
              <ScenePreview scene={selected} template={template} />
              <p className="text-sm text-muted mt">
                選択中の場面「{sceneTypeLabel[selected.sceneType]}」の仕上がりです。右側を直すとここに反映されます。
              </p>
            </div>

            {/* 下: 場面カード一覧 */}
            <div className="editor-col" style={{ flexShrink: 0 }}>
              <div className="row-between mb">
                <h2 className="field-label" style={{ margin: 0 }}>
                  場面の並び
                </h2>
                <button className="btn btn-ghost btn-icon">
                  <PlusIcon size={16} />
                  場面を追加
                </button>
              </div>
              <div className="scene-strip">
                {scenes.map((s) => (
                  <button
                    key={s.sceneId}
                    className={`scene-card${selected.sceneId === s.sceneId ? " selected" : ""}`}
                    onClick={() => setSelectedId(s.sceneId)}
                  >
                    <div className="scene-card-thumb thumb thumb-photo">
                      <PhotoIcon size={18} />
                    </div>
                    <div className="text-sm">
                      <strong>
                        {s.order}. {sceneTypeLabel[s.sceneType]}
                      </strong>
                    </div>
                    <div className="text-faint" style={{ fontSize: 11 }}>
                      {templates.find((t) => t.templateId === s.templateId)?.name ?? ""}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 右: 選択中の場面を編集 */}
          <div className="editor-col">
            <h2 className="field-label">選択中の場面を編集</h2>

            <div className="field">
              <label className="field-label" htmlFor="title">タイトル</label>
              <input
                id="title"
                className="input"
                value={selected.texts.title ?? ""}
                onChange={(e) => patch((s) => ({ ...s, texts: { ...s.texts, title: e.target.value } }))}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="look">見た目パターン</label>
              <select
                id="look"
                className="select"
                value={selected.templateId}
                onChange={(e) => {
                  const newTemplateId = e.target.value;
                  const newSlotIds = new Set(
                    (templates.find((t) => t.templateId === newTemplateId)?.layers ?? [])
                      .filter((l) => l.type === "background" || l.type === "slot" || l.type === "logo")
                      .map((l) => l.id),
                  );
                  patch((s) => ({
                    ...s,
                    templateId: newTemplateId,
                    // 新テンプレに無いスロットの参照は捨てる（§5：assetRefsのキー ⊆ テンプレのスロットid）。
                    assetRefs: Object.fromEntries(
                      Object.entries(s.assetRefs).filter(([k]) => newSlotIds.has(k)),
                    ),
                  }));
                }}
              >
                {templates.map((t) => (
                  <option key={t.templateId} value={t.templateId}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="field-label">使用素材</label>
              {slotLayers.length === 0 ? (
                <p className="text-sm text-muted">この見た目パターンに画像のスロットはありません。</p>
              ) : (
                slotLayers.map((layer) => {
                  const assignedId = selected.assetRefs[layer.id];
                  const assignedIsVideo =
                    !!assignedId && assets.find((a) => a.assetId === assignedId)?.assetType === "video";
                  return (
                    <div className="field" key={layer.id} style={{ marginBottom: 8 }}>
                      <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>
                        {slotLabel[layer.id] ?? layer.id}
                      </label>
                      <select
                        className="select"
                        value={assignedId ?? ""}
                        onChange={(e) =>
                          patch((s) => ({
                            ...s,
                            assetRefs: { ...s.assetRefs, [layer.id]: e.target.value || null },
                          }))
                        }
                      >
                        <option value="">なし</option>
                        {assignableFor(layer, assets).map((a) => (
                          <option key={a.assetId} value={a.assetId}>
                            {a.displayName}
                          </option>
                        ))}
                      </select>
                      {assignedIsVideo && (
                        <p className="field-hint">
                          ▶ 動画素材です。この確認画面では枠が空に見えますが、書き出すと動画が入ります。
                        </p>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <div className="field">
              <label className="field-label" htmlFor="line">ゆうこのセリフ</label>
              <textarea
                id="line"
                className="textarea"
                value={selected.narration.text}
                onChange={(e) =>
                  patch((s) => ({
                    ...s,
                    // セリフ変更で音声は作り直しが必要なので status をリセット（古い音声との不整合防止）。
                    narration: { ...s.narration, text: e.target.value, status: "none" },
                  }))
                }
              />
              <div className="row-between" style={{ marginTop: 6 }}>
                <span className="text-sm text-muted">
                  音声：{narrationStatusLabel[selected.narration.status] ?? selected.narration.status}
                </span>
                <div className="row gap-sm">
                  {narrationAudioById[selected.sceneId] && (
                    <button
                      className="btn btn-ghost btn-icon text-sm"
                      onClick={() =>
                        void new Audio(narrationAudioById[selected.sceneId]).play().catch(() => {})
                      }
                    >
                      ▶ 再生
                    </button>
                  )}
                  <button
                    className="btn btn-secondary btn-icon text-sm"
                    onClick={() => void generateNarration(selected.sceneId)}
                    disabled={selected.narration.status === "pending" || selected.narration.text.trim().length === 0}
                  >
                    {selected.narration.status === "generated" ? "声を作り直す" : "声を作成"}
                  </button>
                </div>
              </div>
              <p className="field-hint">実際の音声には VOICEVOX の起動が必要です（未起動だと作成に失敗します）。</p>
              {selected.narration.status === "failed" && narrationError && (
                <div className="notice notice-warn" role="alert" style={{ marginTop: 6 }}>
                  <span>{narrationError}</span>
                </div>
              )}
            </div>

            <div className="field">
              <label className="field-label" htmlFor="subtitle">字幕</label>
              <textarea
                id="subtitle"
                className="textarea"
                value={selected.texts.subtitle ?? ""}
                onChange={(e) => patch((s) => ({ ...s, texts: { ...s.texts, subtitle: e.target.value } }))}
                style={{ minHeight: 60 }}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="duration">表示時間（秒）</label>
              <input
                id="duration"
                className="input"
                type="number"
                value={selected.durationSec}
                onChange={(e) => patch((s) => ({ ...s, durationSec: Number(e.target.value) }))}
              />
            </div>

            <div className="toggle-row">
              <span className="field-label" style={{ margin: 0 }}>ゆうこを表示する</span>
              <Switch
                on={selected.character.enabled}
                onChange={(v) => patch((s) => ({ ...s, character: { ...s.character, enabled: v } }))}
                label="ゆうこを表示する"
              />
            </div>

            {/* こだわり編集（現状はUIのみ） */}
            <button
              className="btn btn-ghost btn-block mt"
              onClick={() => setShowAdvanced(!showAdvanced)}
              aria-expanded={showAdvanced}
            >
              {showAdvanced ? "こだわり編集を閉じる" : "こだわり編集を開く"}
            </button>
            {showAdvanced && (
              <div className="card-tight" style={{ background: "var(--color-surface-alt)", marginTop: "var(--gap-sm)" }}>
                <div className="field">
                  <label className="field-label" htmlFor="transition">画面の切り替え</label>
                  <select
                    id="transition"
                    className="select"
                    value={selected.transition?.in ?? "fade"}
                    onChange={(e) =>
                      patch((s) => ({ ...s, transition: { ...s.transition, in: e.target.value as "none" | "fade", out: e.target.value as "none" | "fade" } }))
                    }
                  >
                    <option value="none">なし</option>
                    <option value="fade">フェード</option>
                  </select>
                </div>
                <p className="field-hint">音量や動画の開始・終了などの詳細設定は今後追加予定です。</p>
              </div>
            )}

            <button className="btn btn-primary btn-block mt">
              <SaveIcon size={18} />
              ここまで保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
