import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { ScreenId } from "../data/mockData";
import type { Asset, FreeElement, Scene } from "../../domain/project/types";
import type { Layer } from "../../domain/template/types";
import { ASSET_TYPE, FONT_WEIGHT, FREE_CATEGORY, FREE_ELEMENT_KIND, FREE_SHAPE_TYPE, NARRATION_STATUS, SLOT_TYPE, type Fit, type FontWeight, type FreeElementKind, type FreeShapeType } from "../../domain/enums";
import { ORIGINAL_AUDIO_VOLUME, SCENE_MIN_DURATION_SEC, SPEED_DEFAULT, SPEED_MAX, SPEED_MIN, SPEED_STEP, VOLUME_MAX, VOLUME_MIN, VOLUME_STEP } from "../../domain/constants";
import { clampClipTime } from "../../domain/asset/clip";
import { addFreeElement, removeFreeElement, updateFreeElement } from "../../domain/project/freeLayoutOps";
import { resolveNarrationVolume } from "../../domain/voice/audioMix";
import { useProjectStore } from "../store/projectStore";
import { isTauri } from "../../infrastructure/assetFs";
import { showOpenAssetDialog } from "../../infrastructure/dialog";
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
  TrashIcon,
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
  free: "自由配置",
};

// 自由配置要素のユーザー向けラベル（§2-3：技術語を出さない）。全 kind 必須＝追加時にコンパイル検知。
const freeKindLabel: Record<FreeElementKind, string> = {
  slot: "素材",
  text: "文字",
  shape: "図形",
};

// 自由配置の位置・サイズ等の数値入力（キーボードで調整＝a11y。ドラッグ操作は Phase 4b）。
function NumberField({ label, value, min, onChange }: { label: string; value: number; min?: number; onChange: (v: number) => void }) {
  return (
    <div className="field" style={{ flex: 1, margin: 0 }}>
      <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>{label}</label>
      <input
        className="input"
        type="number"
        min={min}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

// スロットのユーザー向けラベル（レイヤーid別。複数スロットでも区別できるよう id をキーにする）。
const slotLabel: Record<string, string> = {
  background: "背景",
  mainVisual: "メイン素材",
  logo: "ロゴ",
};

// スロットの表示名。未登録 id は layer.type から日本語化し、layer.id の生表示（技術用語漏れ §2-3）を防ぐ。
function slotLabelFor(layer: Layer): string {
  if (slotLabel[layer.id]) return slotLabel[layer.id];
  if (layer.type === "background") return "背景";
  if (layer.type === "logo") return "ロゴ";
  return "素材";
}

const narrationStatusLabel: Record<string, string> = {
  none: "未作成",
  pending: "作成中…",
  generated: "作成済み",
  failed: "失敗（もう一度お試しください）",
};

// スロットの slotType と素材の assetType の整合で、割り当て可能な素材を絞る（§5）。
function assignableFor(layer: Layer, assets: Asset[]): Asset[] {
  return assets.filter((a) => {
    if (layer.type === "logo") return a.assetType === ASSET_TYPE.logo || a.assetType === ASSET_TYPE.image;
    if (layer.slotType === SLOT_TYPE.image) return a.assetType === ASSET_TYPE.image;
    if (layer.slotType === SLOT_TYPE.video) return a.assetType === ASSET_TYPE.video;
    // background / slot(image_or_video) / slotType未指定
    return a.assetType === ASSET_TYPE.image || a.assetType === ASSET_TYPE.video;
  });
}

function assetThumbClass(type: Asset["assetType"]): string {
  if (type === ASSET_TYPE.video) return "thumb-video";
  if (type === ASSET_TYPE.bgm) return "thumb-audio";
  return "thumb-photo";
}

export function SceneEditScreen({ onNavigate }: SceneEditProps) {
  const {
    status, scenes, templates, assets, generate, updateScene, updateAsset, addAsset, addAssetByPath, importError, clearImportError,
    addScene, removeScene, splitScene, saveProject, saveStatus,
    generateNarration, generateAllNarrations, isGeneratingNarration, narrationAudioById, narrationError,
  } = useProjectStore();
  const voiceSettings = useProjectStore((s) => s.meta.voiceSettings);

  const [filter, setFilter] = useState<AssetFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  // セリフ入力欄の参照（分割のカーソル位置を読む）。
  const lineRef = useRef<HTMLTextAreaElement>(null);
  // こだわり編集（現状はUIのみ・後でドメインへ結線）
  const [showAdvanced, setShowAdvanced] = useState(false);
  // 場面削除の二段確認（誤操作防止）。選択場面が変わったら解除。
  const [confirmDelete, setConfirmDelete] = useState(false);

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
      (filter === "image" && a.assetType === ASSET_TYPE.image) ||
      (filter === "video" && a.assetType === ASSET_TYPE.video) ||
      (filter === "bgm" && a.assetType === ASSET_TYPE.bgm);
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
  // FREE 場面（自由配置）か。FREE のときだけ自由配置エディタを主編集面として出す（ADR-0008・§2-4）。
  const isFree = template?.category === FREE_CATEGORY;
  const freeLayout = selected.freeLayout ?? [];
  // 自由配置 slot に割り当て可能な素材（画像・動画）。
  const freeSlotAssets = assets.filter((a) => a.assetType === ASSET_TYPE.image || a.assetType === ASSET_TYPE.video);
  const addFreeEl = (kind: FreeElementKind) =>
    patch((s) => ({ ...s, freeLayout: addFreeElement(s.freeLayout ?? [], kind) }));
  const patchFreeEl = (id: string, p: Partial<Omit<FreeElement, "id" | "kind">>) =>
    patch((s) => ({ ...s, freeLayout: updateFreeElement(s.freeLayout ?? [], id, p) }));
  const removeFreeEl = (id: string) =>
    patch((s) => ({ ...s, freeLayout: removeFreeElement(s.freeLayout ?? [], id) }));
  // 場面ごとの声の大きさ（null/未設定＝全体設定を継承 §6/§2.2、値＝この場面だけ上書き）。
  const sceneNarrationVolume = selected.audioMix?.narrationVolume ?? null;
  // 書き出しと同一ロジックで「全体設定の実効値」を出す（clamp 込み・ドメイン関数を単一の参照元に）。
  const projectNarrationVolume = resolveNarrationVolume(undefined, voiceSettings);
  // 場面の選択を切り替える（前の場面の削除確認は解除して持ち越さない）。
  const selectScene = (id: string) => {
    setSelectedId(id);
    setConfirmDelete(false);
  };

  function onUpload(e: ChangeEvent<HTMLInputElement>) {
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
                    {a.assetType === ASSET_TYPE.video ? (
                      <VideoIcon size={16} />
                    ) : a.assetType === ASSET_TYPE.bgm ? (
                      <MusicIcon size={16} />
                    ) : (
                      <PhotoIcon size={16} />
                    )}
                  </div>
                  <span className="text-sm">{a.displayName}</span>
                </div>
              ))}
            </div>

            <label
              className="btn btn-secondary btn-block mt"
              style={{ cursor: "pointer" }}
              role="button"
              tabIndex={0}
              onClick={(e) => {
                if (isTauri()) {
                  e.preventDefault();
                  void onPickAsset();
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  if (isTauri()) {
                    void onPickAsset();
                  } else {
                    e.currentTarget.querySelector("input")?.click();
                  }
                }
              }}
            >
              <UploadIcon size={16} />
              素材をアップロード
              <input type="file" accept="image/*,video/*" onChange={onUpload} style={{ display: "none" }} />
            </label>

            {importError && (
              <div className="notice notice-warn row-between mt" role="alert">
                <span>{importError}</span>
                <button className="btn btn-ghost text-sm" onClick={clearImportError}>閉じる</button>
              </div>
            )}
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
                <button className="btn btn-ghost btn-icon" onClick={() => selectScene(addScene())}>
                  <PlusIcon size={16} />
                  場面を追加
                </button>
              </div>
              <div className="scene-strip">
                {scenes.map((s) => (
                  <button
                    key={s.sceneId}
                    className={`scene-card${selected.sceneId === s.sceneId ? " selected" : ""}`}
                    onClick={() => selectScene(s.sceneId)}
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

            {/* 簡易/詳細トグル（ADR-0007 M-A：同一画面・同一データ）。オンで細かい調整を表示。 */}
            <div className="toggle-row">
              <span className="field-label" style={{ margin: 0 }}>詳細編集</span>
              <Switch on={showAdvanced} onChange={setShowAdvanced} label="詳細編集" />
            </div>
            <p className="field-hint" style={{ marginTop: 0 }}>
              オンにすると、動画素材の細かい調整や画面の切り替えなどを表示します。
            </p>

            {/* FREE 場面は文字を「自由配置」で置くため、効かないタイトル欄は出さない（§2-4）。 */}
            {!isFree && (
              <div className="field">
                <label className="field-label" htmlFor="title">タイトル</label>
                <input
                  id="title"
                  className="input"
                  value={selected.texts.title ?? ""}
                  onChange={(e) => patch((s) => ({ ...s, texts: { ...s.texts, title: e.target.value } }))}
                />
              </div>
            )}

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
                <p className="text-sm text-muted">この見た目パターンに素材を入れる場所はありません。</p>
              ) : (
                slotLayers.map((layer) => {
                  const assignedId = selected.assetRefs[layer.id];
                  const assignedAsset = assignedId
                    ? assets.find((a) => a.assetId === assignedId)
                    : undefined;
                  const isVideo = assignedAsset?.assetType === ASSET_TYPE.video;
                  const clip = assignedAsset?.clip;
                  const dur = assignedAsset?.metadata?.durationSec ?? null;
                  const hasAudio = assignedAsset?.metadata?.hasAudio === true;
                  const useOriginal = hasAudio && (clip?.useOriginalAudio ?? false);
                  // クリップ設定（asset.clip）を部分更新する。clip は Asset 単位（正典 11/$defs/Clip）。
                  const patchClip = (p: Partial<NonNullable<Asset["clip"]>>) => {
                    if (assignedAsset) {
                      updateAsset(assignedAsset.assetId, (a) => ({ ...a, clip: { ...a.clip, ...p } }));
                    }
                  };
                  return (
                    <div className="field" key={layer.id} style={{ marginBottom: 8 }}>
                      <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>
                        {slotLabelFor(layer)}
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

                      {isVideo && assignedAsset && showAdvanced && (
                        <div
                          className="card-tight"
                          style={{ background: "var(--color-surface-alt)", marginTop: 6 }}
                        >
                          <p className="text-sm text-muted" style={{ margin: "0 0 6px" }}>
                            ▶ 動画素材です。確認画面では枠が空に見えますが、書き出すと動画が入ります。
                            {dur != null && `（長さ：約${dur.toFixed(1)}秒）`}
                          </p>

                          {/* 枠への収め方 */}
                          <div className="field" style={{ marginBottom: 6 }}>
                            <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>
                              枠への収め方
                            </label>
                            <select
                              className="select"
                              value={clip?.fit ?? "cover"}
                              onChange={(e) => patchClip({ fit: e.target.value as Fit })}
                            >
                              <option value="cover">枠いっぱいに表示（はみ出しは切り取り）</option>
                              <option value="contain">全体を表示（余白が入る）</option>
                              <option value="stretch">枠に合わせて伸縮</option>
                            </select>
                          </div>

                          {/* 使う範囲 */}
                          <div className="field" style={{ marginBottom: 6 }}>
                            <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>
                              使う範囲（秒）
                            </label>
                            <div className="row gap-sm" style={{ alignItems: "center" }}>
                              <input
                                className="input"
                                type="number"
                                min={0}
                                max={dur ?? undefined}
                                step={0.1}
                                value={clip?.startSec ?? 0}
                                onChange={(e) => {
                                  const start = clampClipTime(Number(e.target.value), dur);
                                  // 開始が終了を超えたら終了をクリア（=最後まで）して無効状態を防ぐ。
                                  const p: Partial<NonNullable<Asset["clip"]>> = { startSec: start };
                                  if (clip?.endSec != null && start > clip.endSec) p.endSec = undefined;
                                  patchClip(p);
                                }}
                              />
                              <span className="text-sm text-muted">〜</span>
                              <input
                                className="input"
                                type="number"
                                min={0}
                                max={dur ?? undefined}
                                step={0.1}
                                placeholder="最後まで"
                                value={clip?.endSec ?? ""}
                                onChange={(e) =>
                                  patchClip({
                                    endSec:
                                      e.target.value === ""
                                        ? undefined
                                        : clampClipTime(Number(e.target.value), dur, clip?.startSec ?? 0),
                                  })
                                }
                              />
                            </div>
                            <p className="field-hint">終了を空にすると最後まで使います。</p>
                          </div>

                          {/* 再生速度（A=尺独立：表示時間は変えず、クリップの再生速度だけ変える） */}
                          <div className="field" style={{ marginBottom: 6 }}>
                            <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>
                              再生速度
                            </label>
                            <input
                              type="range"
                              min={SPEED_MIN}
                              max={SPEED_MAX}
                              step={SPEED_STEP}
                              value={clip?.speed ?? SPEED_DEFAULT}
                              onChange={(e) => patchClip({ speed: Number(e.target.value) })}
                              style={{ width: "100%", accentColor: "var(--color-primary)" }}
                            />
                            <div className="row-between text-faint text-sm">
                              <span>ゆっくり</span>
                              <span>{clip?.speed ?? SPEED_DEFAULT}倍</span>
                              <span>はやく</span>
                            </div>
                          </div>

                          {/* 元の音声 */}
                          <div className="toggle-row">
                            <span className="field-label text-sm" style={{ margin: 0 }}>
                              元の音声を使う
                            </span>
                            <Switch
                              on={useOriginal}
                              disabled={!hasAudio}
                              onChange={(v) => patchClip({ useOriginalAudio: v })}
                              label="元の音声を使う"
                            />
                          </div>
                          {!hasAudio && (
                            <p className="field-hint">
                              {assignedAsset.metadata?.hasAudio === false
                                ? "この動画には音声がありません。"
                                : "音声を確認できないため、元の音声は使えません。"}
                            </p>
                          )}

                          {/* 元音声の音量 */}
                          {useOriginal && (
                            <div className="field" style={{ marginTop: 6 }}>
                              <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>
                                元の音声の大きさ
                              </label>
                              <input
                                type="range"
                                min={VOLUME_MIN}
                                max={VOLUME_MAX}
                                step={VOLUME_STEP}
                                value={clip?.originalAudioVolume ?? ORIGINAL_AUDIO_VOLUME}
                                onChange={(e) =>
                                  patchClip({ originalAudioVolume: Number(e.target.value) })
                                }
                                style={{ width: "100%", accentColor: "var(--color-primary)" }}
                              />
                              <div className="row-between text-faint text-sm">
                                <span>小さい</span>
                                <span>
                                  {Math.round(
                                    (clip?.originalAudioVolume ?? ORIGINAL_AUDIO_VOLUME) * 100,
                                  )}
                                  %（標準{Math.round(ORIGINAL_AUDIO_VOLUME * 100)}%）
                                </span>
                                <span>大きい</span>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* FREE 場面：自由配置エディタ（素材/文字/図形を追加・数値で位置/大きさ・重なり順・削除）。Phase 4a-3b。 */}
            {isFree && (
              <div className="field">
                <label className="field-label">自由配置</label>
                <p className="field-hint" style={{ marginTop: 0 }}>
                  素材・文字・図形を追加して、位置や大きさを数字で調整できます。
                </p>
                <div className="row gap-sm" style={{ marginBottom: 8, flexWrap: "wrap" }}>
                  <button className="btn btn-secondary btn-icon text-sm" onClick={() => addFreeEl(FREE_ELEMENT_KIND.slot)}>
                    <PlusIcon size={14} />素材
                  </button>
                  <button className="btn btn-secondary btn-icon text-sm" onClick={() => addFreeEl(FREE_ELEMENT_KIND.text)}>
                    <PlusIcon size={14} />文字
                  </button>
                  <button className="btn btn-secondary btn-icon text-sm" onClick={() => addFreeEl(FREE_ELEMENT_KIND.shape)}>
                    <PlusIcon size={14} />図形
                  </button>
                </div>
                {freeLayout.length === 0 ? (
                  <p className="text-sm text-muted">まだ何も配置されていません。上のボタンで追加してください。</p>
                ) : (
                  <div className="col gap-sm">
                    {freeLayout.map((el) => (
                      <div key={el.id} className="card-tight" style={{ background: "var(--color-surface-alt)" }}>
                        <div className="row-between" style={{ marginBottom: 4 }}>
                          <strong className="text-sm">{freeKindLabel[el.kind]}</strong>
                          <button
                            className="btn btn-ghost btn-icon text-sm"
                            style={{ color: "var(--color-danger)" }}
                            onClick={() => removeFreeEl(el.id)}
                            aria-label="この配置を削除"
                          >
                            <TrashIcon size={14} />
                          </button>
                        </div>

                        {el.kind === FREE_ELEMENT_KIND.slot && (
                          <div className="field" style={{ marginBottom: 6 }}>
                            <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>素材</label>
                            <select
                              className="select"
                              value={el.assetId ?? ""}
                              onChange={(e) => patchFreeEl(el.id, { assetId: e.target.value || null })}
                            >
                              <option value="">なし（空の枠）</option>
                              {freeSlotAssets.map((a) => (
                                <option key={a.assetId} value={a.assetId}>{a.displayName}</option>
                              ))}
                            </select>
                          </div>
                        )}

                        {el.kind === FREE_ELEMENT_KIND.text && (
                          <>
                            <div className="field" style={{ marginBottom: 6 }}>
                              <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>文字</label>
                              <input
                                className="input"
                                value={el.text ?? ""}
                                onChange={(e) => patchFreeEl(el.id, { text: e.target.value })}
                              />
                            </div>
                            <div className="row gap-sm" style={{ marginBottom: 6 }}>
                              <NumberField label="文字の大きさ" value={el.fontSize ?? 48} min={1} onChange={(v) => patchFreeEl(el.id, { fontSize: v })} />
                              <div className="field" style={{ margin: 0 }}>
                                <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>色</label>
                                <input type="color" value={el.color ?? "#222222"} onChange={(e) => patchFreeEl(el.id, { color: e.target.value })} />
                              </div>
                              <div className="field" style={{ margin: 0 }}>
                                <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>太さ</label>
                                <select
                                  className="select"
                                  value={el.fontWeight ?? FONT_WEIGHT.normal}
                                  onChange={(e) => patchFreeEl(el.id, { fontWeight: e.target.value as FontWeight })}
                                >
                                  <option value={FONT_WEIGHT.normal}>標準</option>
                                  <option value={FONT_WEIGHT.bold}>太字</option>
                                </select>
                              </div>
                            </div>
                          </>
                        )}

                        {el.kind === FREE_ELEMENT_KIND.shape && (
                          <div className="row gap-sm" style={{ marginBottom: 6 }}>
                            <div className="field" style={{ flex: 1, margin: 0 }}>
                              <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>形</label>
                              <select
                                className="select"
                                value={el.shapeType ?? FREE_SHAPE_TYPE.rect}
                                onChange={(e) => patchFreeEl(el.id, { shapeType: e.target.value as FreeShapeType })}
                              >
                                <option value={FREE_SHAPE_TYPE.rect}>四角</option>
                                <option value={FREE_SHAPE_TYPE.ellipse}>丸</option>
                              </select>
                            </div>
                            <div className="field" style={{ margin: 0 }}>
                              <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>色</label>
                              <input type="color" value={el.fillColor ?? "#cccccc"} onChange={(e) => patchFreeEl(el.id, { fillColor: e.target.value })} />
                            </div>
                          </div>
                        )}

                        <div className="row gap-sm" style={{ marginBottom: 4 }}>
                          <NumberField label="横位置" value={el.x} onChange={(v) => patchFreeEl(el.id, { x: v })} />
                          <NumberField label="縦位置" value={el.y} onChange={(v) => patchFreeEl(el.id, { y: v })} />
                        </div>
                        <div className="row gap-sm">
                          <NumberField label="幅" value={el.w} min={1} onChange={(v) => patchFreeEl(el.id, { w: v })} />
                          <NumberField label="高さ" value={el.h} min={1} onChange={(v) => patchFreeEl(el.id, { h: v })} />
                          <NumberField label="重なり順" value={el.zIndex ?? 1} onChange={(v) => patchFreeEl(el.id, { zIndex: v })} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="field">
              <label className="field-label" htmlFor="line">ゆうこのセリフ</label>
              <textarea
                id="line"
                ref={lineRef}
                className="textarea"
                value={selected.narration.text}
                onChange={(e) =>
                  patch((s) => ({
                    ...s,
                    // セリフ変更で音声は作り直しが必要なので status をリセット（古い音声との不整合防止）。
                    narration: { ...s.narration, text: e.target.value, status: NARRATION_STATUS.none },
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
                    disabled={selected.narration.status === NARRATION_STATUS.pending || selected.narration.text.trim().length === 0}
                  >
                    {selected.narration.status === NARRATION_STATUS.generated ? "声を作り直す" : "声を作成"}
                  </button>
                </div>
              </div>
              <div className="row gap-sm" style={{ marginTop: 6 }}>
                <button
                  className="btn btn-ghost btn-icon text-sm"
                  title="カーソル位置でこの場面を2つに分ける"
                  disabled={
                    selected.narration.text.trim().length < 2 ||
                    selected.durationSec < 2 * SCENE_MIN_DURATION_SEC
                  }
                  onClick={() => splitScene(selected.sceneId, lineRef.current?.selectionStart ?? 0)}
                >
                  ここで2つに分ける
                </button>
              </div>
              <p className="field-hint">実際の音声には VOICEVOX の起動が必要です（未起動だと作成に失敗します）。</p>
              {selected.narration.status === NARRATION_STATUS.failed && narrationError && (
                <div className="notice notice-warn" role="alert" style={{ marginTop: 6 }}>
                  <span>{narrationError}</span>
                </div>
              )}
            </div>

            {/* 場面ごとの声の大きさ（全体設定を継承 or この場面だけ上書き。§6/§2.2） */}
            <div className="field">
              <div className="toggle-row">
                <span className="field-label" style={{ margin: 0 }}>この場面だけ声の大きさを変える</span>
                <Switch
                  on={sceneNarrationVolume != null}
                  onChange={(on) =>
                    patch((s) => ({
                      ...s,
                      audioMix: {
                        ...s.audioMix,
                        // オン＝現在の実効値で上書き開始 / オフ＝null で全体設定を継承
                        narrationVolume: on
                          ? (s.audioMix?.narrationVolume ?? projectNarrationVolume)
                          : null,
                      },
                    }))
                  }
                  label="この場面だけ声の大きさを変える"
                />
              </div>
              {sceneNarrationVolume != null ? (
                <>
                  <input
                    type="range"
                    min={VOLUME_MIN}
                    max={VOLUME_MAX}
                    step={VOLUME_STEP}
                    value={sceneNarrationVolume}
                    onChange={(e) =>
                      patch((s) => ({
                        ...s,
                        audioMix: { ...s.audioMix, narrationVolume: Number(e.target.value) },
                      }))
                    }
                    style={{ width: "100%", accentColor: "var(--color-primary)" }}
                  />
                  <div className="row-between text-faint text-sm">
                    <span>小さい</span>
                    <span>{Math.round(sceneNarrationVolume * 100)}%</span>
                    <span>大きい</span>
                  </div>
                </>
              ) : (
                <p className="field-hint">
                  全体の設定（{Math.round(projectNarrationVolume * 100)}%）を使います。場面ごとに変えたいときだけオンにします。
                </p>
              )}
            </div>

            {/* FREE 場面の字幕も「自由配置」の文字で代替するため出さない（§2-4）。 */}
            {!isFree && (
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
            )}

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

            {/* 画面の切り替えなどの詳細は、上の「詳細編集」トグル（showAdvanced）で表示する。 */}
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
                <p className="field-hint">
                  動画の収め方・使う範囲・元の音声は、上の「使用素材」で動画を選ぶと設定できます。声の大きさは「ゆうこのセリフ」で場面ごとに変えられます。
                </p>
              </div>
            )}

            {confirmDelete ? (
              <div className="row gap-sm mt">
                <button
                  className="btn btn-danger"
                  style={{ flex: 1 }}
                  onClick={() => {
                    removeScene(selected.sceneId);
                    selectScene(""); // 選択リセット＋削除確認も解除
                  }}
                >
                  <TrashIcon size={16} />
                  削除する
                </button>
                <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
                  やめる
                </button>
              </div>
            ) : (
              <button
                className="btn btn-ghost btn-block mt"
                style={{ color: "var(--color-danger)" }}
                onClick={() => setConfirmDelete(true)}
              >
                <TrashIcon size={16} />
                この場面を削除
              </button>
            )}

            <button
              className="btn btn-primary btn-block mt"
              onClick={() => void saveProject()}
              disabled={saveStatus === "saving"}
            >
              <SaveIcon size={18} />
              {saveStatus === "saving"
                ? "保存中…"
                : saveStatus === "saved"
                  ? "保存しました"
                  : saveStatus === "error"
                    ? "保存に失敗（もう一度押す）"
                    : "ここまで保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
