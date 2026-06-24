import { useState, type ChangeEvent } from "react";
import type { Asset } from "../../domain/project/types";
import { ASSET_TYPE } from "../../domain/enums";
import { useProjectStore } from "../store/projectStore";
import { isTauri } from "../../infrastructure/assetFs";
import { showOpenAssetDialog } from "../../infrastructure/dialog";
import { PageHead, Switch } from "../components/ui";
import { EmptyState } from "../components/states";
import {
  PhotoIcon,
  VideoIcon,
  MusicIcon,
  UploadIcon,
  PlusIcon,
  TrashIcon,
  CheckIcon,
} from "../components/icons";

type Filter = "all" | "image" | "video" | "yuko";

// 音声系（BGM/ナレーション）は素材一覧に出さない（BGMは書き出し画面で管理）ため、音タブも持たない。
const filters: [Filter, string][] = [
  ["all", "すべて"],
  ["image", "写真"],
  ["video", "動画"],
  ["yuko", "ゆうこ"],
];

const VISUAL_TYPES: Asset["assetType"][] = [
  ASSET_TYPE.image,
  ASSET_TYPE.logo,
  ASSET_TYPE.yuko,
  ASSET_TYPE.qr,
  ASSET_TYPE.decor,
];
const isVisual = (type: Asset["assetType"]) => VISUAL_TYPES.includes(type);

function AssetThumb({ type, src, size = 20 }: { type: Asset["assetType"]; src?: string; size?: number }) {
  const cls =
    type === ASSET_TYPE.video ? "thumb-video" : type === ASSET_TYPE.bgm ? "thumb-audio" : "thumb-photo";
  return (
    <div className={`thumb ${cls}`} style={{ aspectRatio: "auto", width: "100%", overflow: "hidden" }}>
      {src ? (
        <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <>
          {type === ASSET_TYPE.video && <VideoIcon size={size} />}
          {type === ASSET_TYPE.bgm && <MusicIcon size={size} />}
          {type === ASSET_TYPE.yuko && <span style={{ fontWeight: 700 }}>ゆ</span>}
          {(type === ASSET_TYPE.image ||
            type === ASSET_TYPE.logo ||
            type === ASSET_TYPE.qr ||
            type === ASSET_TYPE.voice) && <PhotoIcon size={size} />}
        </>
      )}
    </div>
  );
}

export function MaterialsScreen() {
  const { assets, updateAsset, removeAsset, assetSrcById, setAssetImage, addAsset, addAssetByPath, importError, clearImportError, isImporting } = useProjectStore();
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState("");
  const [newTag, setNewTag] = useState("");

  // 音声系（BGM/ナレーション）は「素材」一覧に出さない（BGMは書き出し画面で管理）。
  const materials = assets.filter(
    (a) => a.assetType !== ASSET_TYPE.bgm && a.assetType !== ASSET_TYPE.voice,
  );
  const visible = materials.filter((a) => filter === "all" || a.assetType === filter);
  const selected = materials.find((a) => a.assetId === selectedId) ?? visible[0] ?? materials[0];

  function addTag() {
    const v = newTag.trim();
    if (!v || !selected) return;
    const tags = selected.tags ?? [];
    if (!tags.includes(v)) updateAsset(selected.assetId, (a) => ({ ...a, tags: [...(a.tags ?? []), v] }));
    setNewTag("");
  }

  function onPickImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !selected) return;
    void setAssetImage(selected.assetId, file);
    // 同じファイルを選び直しても change が発火するよう値をクリアする。
    e.target.value = "";
  }

  function onAddAsset(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    void addAsset(file);
    e.target.value = "";
  }

  // Tauri ではネイティブの「開く」ダイアログでパスを取り込む（JSが素材バイトを読まない）。ブラウザは下の input にフォールバック。
  async function onPickAsset() {
    const path = await showOpenAssetDialog();
    if (path) await addAssetByPath(path);
  }

  return (
    <div className="main-scroll">
      <PageHead
        title="素材を管理"
        desc="動画に使う写真・動画・音・ゆうこの素材を管理します。説明やタグを付けると、ゆうこが使いどころを判断しやすくなります。"
        actions={
          <label
            className="btn btn-primary"
            style={{ cursor: isImporting ? "default" : "pointer", opacity: isImporting ? 0.6 : 1 }}
            role="button"
            tabIndex={0}
            aria-disabled={isImporting}
            onClick={(e) => {
              if (isImporting) { e.preventDefault(); return; }
              if (isTauri()) {
                e.preventDefault();
                void onPickAsset();
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (isImporting) return;
                if (isTauri()) {
                  void onPickAsset();
                } else {
                  e.currentTarget.querySelector("input")?.click();
                }
              }
            }}
          >
            <UploadIcon size={18} />
            {isImporting ? "取り込み中…" : "素材を追加"}
            <input type="file" accept="image/*,video/*" onChange={onAddAsset} disabled={isImporting} style={{ display: "none" }} />
          </label>
        }
      />

      {importError && (
        <div className="notice notice-warn row-between mb" role="alert">
          <span>{importError}</span>
          <button className="btn btn-ghost text-sm" onClick={clearImportError}>閉じる</button>
        </div>
      )}

      <div className="segment mb" style={{ display: "inline-flex" }}>
        {filters.map(([id, label]) => (
          <button key={id} className={filter === id ? "active" : ""} onClick={() => setFilter(id)}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "var(--gap-lg)", alignItems: "start" }}>
        {/* 左: 素材グリッド */}
        {visible.length > 0 ? (
          <div className="card-grid cols-3">
            {visible.map((a) => (
              <button
                key={a.assetId}
                className="action-card"
                style={{
                  borderColor: selected?.assetId === a.assetId ? "var(--color-primary)" : undefined,
                  background: selected?.assetId === a.assetId ? "var(--color-primary-soft)" : undefined,
                }}
                onClick={() => setSelectedId(a.assetId)}
              >
                <AssetThumb type={a.assetType} src={assetSrcById[a.assetId]} />
                <span className="action-card-title" style={{ marginTop: 6 }}>
                  {a.displayName}
                </span>
                <div className="row gap-sm row-wrap" style={{ justifyContent: "center" }}>
                  {a.isPublicChecked ? (
                    <span className="badge badge-teal">
                      <CheckIcon size={12} /> 確認済み
                    </span>
                  ) : (
                    <span className="badge badge-gray">未確認</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            title="この種類の素材はまだありません"
            message="「素材を追加」から、写真・動画・BGM・ゆうこの素材を登録できます。"
          />
        )}

        {/* 右: 選択中の素材の情報 */}
        {selected && (
          <div className="card">
            <h2 className="section-title">素材の情報</h2>
            <div style={{ maxWidth: 160, margin: "0 auto var(--gap)" }}>
              <AssetThumb type={selected.assetType} src={assetSrcById[selected.assetId]} size={28} />
            </div>

            {isVisual(selected.assetType) && (
              <div className="field">
                <label className="field-label">画像</label>
                {/* ネイティブの「ファイル未選択」表示を避け、設定済みかどうかが分かるボタンにする */}
                <label
                  className="btn btn-secondary"
                  style={{ cursor: isImporting ? "default" : "pointer", opacity: isImporting ? 0.6 : 1 }}
                  aria-disabled={isImporting}
                >
                  <UploadIcon size={16} />
                  {assetSrcById[selected.assetId] ? "画像を変更する" : "画像を選ぶ"}
                  <input
                    key={selected.assetId}
                    type="file"
                    accept="image/*"
                    onChange={onPickImage}
                    disabled={isImporting}
                    style={{ display: "none" }}
                  />
                </label>
                <p className="text-sm text-muted" style={{ marginTop: 4 }}>
                  {assetSrcById[selected.assetId]
                    ? "この素材に画像を設定済みです（仕上がり確認の枠に表示）。差し替えるには「画像を変更する」から選び直してください。"
                    : "画像を選ぶと、仕上がり確認のこの素材の枠に表示されます。"}
                </p>
              </div>
            )}

            <div className="field">
              <label className="field-label" htmlFor="mat-name">名前</label>
              <input
                id="mat-name"
                className="input"
                value={selected.displayName}
                onChange={(e) => updateAsset(selected.assetId, (a) => ({ ...a, displayName: e.target.value }))}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="mat-desc">説明</label>
              <textarea
                id="mat-desc"
                className="textarea"
                value={selected.description ?? ""}
                placeholder="例：若手社員が作業しているオフィス写真"
                onChange={(e) => updateAsset(selected.assetId, (a) => ({ ...a, description: e.target.value }))}
              />
            </div>

            <div className="field">
              <label className="field-label">タグ</label>
              <div className="chip-input-row">
                {(selected.tags ?? []).map((t) => (
                  <span className="chip" key={t}>
                    {t}
                    <button
                      aria-label={`${t}を削除`}
                      onClick={() =>
                        updateAsset(selected.assetId, (a) => ({ ...a, tags: (a.tags ?? []).filter((x) => x !== t) }))
                      }
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="row gap-sm">
                <input
                  className="input"
                  value={newTag}
                  placeholder="タグを追加"
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addTag()}
                />
                <button className="btn btn-secondary" onClick={addTag}>
                  <PlusIcon size={16} />
                  追加
                </button>
              </div>
            </div>

            <div className="toggle-row">
              <span className="field-label" style={{ margin: 0 }}>公開チェック済み</span>
              <Switch
                on={selected.isPublicChecked ?? false}
                onChange={(v) => updateAsset(selected.assetId, (a) => ({ ...a, isPublicChecked: v }))}
                label="公開チェック済み"
              />
            </div>

            <button className="btn btn-danger btn-block mt" onClick={() => removeAsset(selected.assetId)}>
              <TrashIcon size={16} />
              この素材を削除
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
