import { useRef, useState, type ChangeEvent } from "react";
import type { Asset } from "../../domain/project/types";
import type { ScreenId } from "../data/mockData";
import { ASSET_TYPE } from "../../domain/enums";
import { pickPanelAsset } from "./materialsSelection";
import { scenesUsingAsset } from "../../domain/project/assetUsage";
import { isExportBusy, useProjectStore } from "../store/projectStore";
import { PageHead, Switch } from "../components/ui";
import { AssetImportButton } from "../components/AssetImportButton";
import { ExportLockBanner } from "../components/ExportLockBanner";
import { EmptyState } from "../components/states";
import { ClipDetailControls } from "../components/ClipDetailControls";
import { UsedScenesRow } from "../components/UsedScenesRow";
import { DeleteConfirm } from "../components/DeleteConfirm";
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

// 音声系（BGM/ナレーション）は素材一覧に出さない（BGMは仕上がり確認で選ぶ）ため、音タブも持たない。
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

export function MaterialsScreen({ onNavigate }: { onNavigate: (s: ScreenId) => void }) {
  const { assets, scenes, templates, updateAsset, removeAsset, assetSrcById, setAssetImage, addAsset, addAssetByPath, importError, clearImportError, isImporting, setEditingSceneId } = useProjectStore();
  // 書き出し中は素材の追加/削除/編集を止める（store 側も #547 P2-1 でガード＝ここは無言 no-op を避ける表示側・ADR-0026④）。
  // 進行中の書き出しが読むファイル/データと競合するため（プロジェクト切替 loadProject 等は #379 で既にガード済み）。
  const isExporting = useProjectStore((s) => isExportBusy(s.exportRun.phase));
  const addDisabled = isImporting || isExporting; // 「素材を追加」は取り込み中・書き出し中は押せない
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState("");
  const [newTag, setNewTag] = useState("");
  // 素材名は編集中だけドラフトで持ち、確定は blur。空/未変更は破棄して元の名前へ戻す＝素材名を空にできないようにする（#411 item7・ProjectNameField と同型）。
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  // 素材削除は取り消せない（assets は Undo 対象外＝ADR-0020）ので、他の削除と同様にインライン確認を挟む（#383）。
  // id で持つ＝別の素材を選び直したら確認は自動的に解除される。
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // 画像差し替えの file input（label ラップでなく button+ref.click()＝キーボードで押せる・BgmPicker と同方式・#412）
  const imageInputRef = useRef<HTMLInputElement>(null);

  // 音声系（BGM/ナレーション）は「素材」一覧に出さない（BGMは仕上がり確認で選ぶ）。
  const materials = assets.filter(
    (a) => a.assetType !== ASSET_TYPE.bgm && a.assetType !== ASSET_TYPE.voice,
  );
  const visible = materials.filter((a) => filter === "all" || a.assetType === filter);
  // 右パネルは「表示中（フィルタ後）」の中からだけ選ぶ＝フィルタ0件のとき別フィルタの素材を出さない（#413）。
  const selected = pickPanelAsset(visible, selectedId);
  // この素材を使っている場面（逆引き・#406）。削除確認の件数（#383）と「使用場面」バッジで共有する。
  // 実効テンプレでゲート＝FREE→通常で休眠した素材を「使用場面」に出さない・事前確認と同一規則（ADR-0030）。
  const usedScenes = selected ? scenesUsingAsset(scenes, selected.assetId, (s) => templates.find((t) => t.templateId === s.templateId)) : [];
  const usedSceneCount = usedScenes.length;
  // 使用場面バッジを押したら、その場面の編集を開く（editingSceneId 機構＝#400・DraftScreen と同方式）。
  const jumpToScene = (sceneId: string) => { setEditingSceneId(sceneId); onNavigate("scene-edit"); };

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

  return (
    <div className="main-scroll">
      <PageHead
        title="素材を管理"
        desc="動画に使う写真・動画・音・ゆうこの素材を管理します。説明やタグを付けると、ゆうこが使いどころを判断しやすくなります。"
        actions={
          <AssetImportButton
            onFile={addAsset}
            onPath={addAssetByPath}
            isImporting={isImporting}
            disabledReason={addDisabled ? (isExporting ? "書き出しが終わるまでお待ちください" : "いま取り込んでいます") : null}
          />
        }
      />

      {importError && (
        <div className="notice notice-warn row-between mb" role="alert">
          <span>{importError}</span>
          <button className="btn btn-ghost text-sm" onClick={clearImportError}>閉じる</button>
        </div>
      )}

      {/* 書き出し中の案内は共通バナーに寄せる（#547 P2-1）。以前はこの画面だけ独自文言で、進捗も戻る導線も無かった
          ＝同じ状況なのに画面ごとに見え方が違う（§2-7・ADR-0026②）。素材操作を実際に試したときの個別案内は
          store の `EXPORT_BUSY_ASSET_MSG`（importError）が出す。 */}
      <ExportLockBanner onNavigate={onNavigate} />

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
            message="「素材を追加」から、写真・動画・ゆうこの素材を登録できます。BGMは仕上がり確認で選べます。"
          />
        )}

        {/* 右: 選択中の素材の情報 */}
        {selected && (
          <div className="card">
            <h2 className="section-title">素材の情報</h2>
            <div style={{ maxWidth: 160, margin: "0 auto var(--gap)" }}>
              <AssetThumb type={selected.assetType} src={assetSrcById[selected.assetId]} size={28} />
            </div>

            {isExporting && (
              <p className="text-sm text-muted" style={{ margin: "0 0 var(--gap)" }}>
                {/* 上のバナーと同じ文を繰り返さない（同じ画面に同じ案内を二度出さない・§6）。ここは編集欄が消えた理由だけ。 */}
                書き出しが終わると、ここで編集できます。
              </p>
            )}
            {/* 書き出し中は編集控えを丸ごと隠す（無言 no-op を避ける＝ADR-0026④・store も #547 P2-1 でガード）。使用場面は下で常に表示。 */}
            {!isExporting && (
            <>
            {/* 動画クリップの「素材の既定」を編集（使う範囲・速度・元音声）。ここは asset.clip＝全場面の既定・Undo 対象外（ADR-0028 D3）。
                場面ごとの調整は場面編集の per-use（scene.slotClips）で（そちらは Undo 可）。 */}
            {selected.assetType === ASSET_TYPE.video && (
              <ClipDetailControls
                asset={selected}
                clip={selected.clip}
                scope="material"
                patchClip={(p) => updateAsset(selected.assetId, (a) => ({ ...a, clip: { ...a.clip, ...p } }))}
              />
            )}

            {isVisual(selected.assetType) && (
              <div className="field">
                <label className="field-label">画像</label>
                {/* ネイティブの「ファイル未選択」表示を避けたボタン。label ラップでなく button+ref.click()
                    ＝Tab フォーカス・:disabled 見た目が効く（BgmPicker と同方式・#412） */}
                <input
                  ref={imageInputRef}
                  key={selected.assetId}
                  type="file"
                  accept="image/*"
                  onChange={onPickImage}
                  disabled={isImporting}
                  hidden
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={isImporting}
                  onClick={() => imageInputRef.current?.click()}
                >
                  <UploadIcon size={16} />
                  {assetSrcById[selected.assetId] ? "画像を変更する" : "画像を選ぶ"}
                </button>
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
                value={nameDraft ?? selected.displayName}
                onFocus={() => setNameDraft(selected.displayName)}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={() => {
                  const name = (nameDraft ?? "").trim();
                  if (name && name !== selected.displayName) updateAsset(selected.assetId, (a) => ({ ...a, displayName: name }));
                  setNameDraft(null); // 空・未変更は破棄＝元の名前に戻す（素材名を空にできない・#411）
                }}
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
                  onKeyDown={(e) => { if (!e.nativeEvent.isComposing && e.key === "Enter") addTag(); }}
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
            </>
            )}

            {/* 使用場面の逆引き（#406）：この素材を使っている場面へ1クリックで飛べる。削除の前に影響範囲も分かる。 */}
            <hr className="divider" />
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="field-label">使用場面</label>
              <UsedScenesRow scenes={usedScenes} onJump={jumpToScene} emptyText="まだどの場面でも使われていません。" />
            </div>

            {!isExporting && (confirmDeleteId === selected.assetId ? (
              <DeleteConfirm
                className="mt"
                message={
                  <>
                    「{selected.displayName || "この素材"}」を削除しますか？元に戻せません。
                    {usedSceneCount > 0
                      ? `使っている${usedSceneCount}つの場面は、この素材が空欄になります。`
                      : "この素材はどの場面でも使われていません。"}
                  </>
                }
                onCancel={() => setConfirmDeleteId(null)}
                onConfirm={() => {
                  removeAsset(selected.assetId);
                  setConfirmDeleteId(null);
                }}
              />
            ) : (
              <button className="btn btn-danger btn-block mt" onClick={() => setConfirmDeleteId(selected.assetId)}>
                <TrashIcon size={16} />
                この素材を削除
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
