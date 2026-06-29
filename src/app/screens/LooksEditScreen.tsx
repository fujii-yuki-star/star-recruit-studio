import { useState, type ChangeEvent } from "react";
import type { ScreenId } from "../data/mockData";
import type { Layer, Template } from "../../domain/template/types";
import { FIT, FITS, FONT_WEIGHT, FONT_WEIGHTS, LAYER_SHAPE_TYPE, LAYER_SHAPE_TYPES, SLOT_TYPE, SLOT_TYPES, TEXT_KEY, TEXT_KEYS, type Fit, type FontWeight, type LayerShapeType, type LayerType, type SlotType, type TextKey } from "../../domain/enums";
import { addLayer, removeLayer, TEMPLATE_ADDABLE_LAYER_TYPES, updateLayer } from "../../domain/template/layerOps";
import { isUserTemplate } from "../../domain/template/userTemplate";
import { buildYukoPoseTags } from "../../domain/ai/videoPlanInput";
import { exceedsInlineAssetLimit } from "../../domain/asset/assetFile";
import { MAX_INLINE_ASSET_BYTES } from "../../domain/constants";
import { useProjectStore } from "../store/projectStore";
import { ScenePreview } from "../components/ScenePreview";
import { TemplateLayerOverlay } from "../components/TemplateLayerOverlay";
import { Switch } from "../components/ui";
import { textKeyLabel } from "../uiLabels";
import { layerLabel, buildSampleScene } from "./looksShared";

// 型別コントロールのユーザー向けラベル（#214 ④・§2-3）。全値必須＝enum 追加漏れをコンパイルで検知。
const layerShapeLabel: Record<LayerShapeType, string> = { rect: "四角", ellipse: "丸", line: "線" };
const fontWeightLabel: Record<FontWeight, string> = { normal: "標準", bold: "太字" };
const slotTypeLabel: Record<SlotType, string> = { image_or_video: "写真・動画", image: "写真", video: "動画" };
const fitLabel: Record<Fit, string> = { cover: "切り取って合わせる", contain: "全体を収める", stretch: "引き伸ばす" };

/** テンプレを編集ドラフト用にコピー（レイヤーも個別コピー＝編集が元（store の current）を壊さない）。 */
function cloneTemplate(t: Template): Template {
  return { ...t, layers: t.layers.map((l) => ({ ...l })) };
}

/** レイヤーの座標/サイズ用の小さな数値入力（整数 px。入力途中の NaN/空は無視、min 指定（幅/高さ）は下限クランプ）。 */
function numField(label: string, value: number, onChange: (v: number) => void, min?: number, max?: number) {
  return (
    <label className="text-sm" style={{ display: "flex", flexDirection: "column", flex: "1 0 40%" }}>
      {label}
      <input
        className="input"
        type="number"
        step={1}
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const v = parseInt(e.target.value, 10);
          if (Number.isNaN(v)) return;
          let clamped = v;
          if (min != null) clamped = Math.max(min, clamped);
          if (max != null) clamped = Math.min(max, clamped);
          onChange(clamped);
        }}
      />
    </label>
  );
}

// 見た目パターンの作成・編集の専用画面（ADR-0017 当初設計＝新規画面・#271）。
// 一覧（LooksScreen）から store の editingTemplateId 経由で対象を受け取り、広い画面で編集する。
// 編集ロジック（ドラフト・layerOps・オーバーレイ・型別コントロール）は #214 のものを流用（移設）。
export function LooksEditScreen({ onNavigate }: { onNavigate: (s: ScreenId) => void }) {
  const templates = useProjectStore((s) => s.templates);
  const assets = useProjectStore((s) => s.assets);
  const editingTemplateId = useProjectStore((s) => s.editingTemplateId);
  const setEditingTemplateId = useProjectStore((s) => s.setEditingTemplateId);
  const saveUserTemplate = useProjectStore((s) => s.saveUserTemplate);
  const deleteUserTemplate = useProjectStore((s) => s.deleteUserTemplate);
  const templateError = useProjectStore((s) => s.templateError);
  const registerTemplateAsset = useProjectStore((s) => s.registerTemplateAsset);
  const templateAssetSrcById = useProjectStore((s) => s.templateAssetSrcById);

  const editing = templates.find((t) => t.templateId === editingTemplateId) ?? null;
  const yukoPoseTags = buildYukoPoseTags(assets);

  const [draft, setDraft] = useState<Template | null>(() => (editing ? cloneTemplate(editing) : null));
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [addType, setAddType] = useState<LayerType>("text");
  const [busy, setBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [assetError, setAssetError] = useState<{ layerId: string; msg: string } | null>(null);

  function backToList() {
    setEditingTemplateId(null);
    onNavigate("looks");
  }

  // 編集対象が無い（直接遷移／削除直後など）＝一覧へ戻す導線だけ出す。
  if (!editing || !draft) {
    return (
      <div className="main-scroll">
        <div className="notice notice-warn" role="alert">
          <span>編集する見た目パターンが選ばれていません。一覧から選んでください。</span>
          <button className="btn btn-primary btn-icon" onClick={backToList}>一覧へ戻る</button>
        </div>
      </div>
    );
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(editing);
  const selectedLayer = draft.layers.find((l) => l.id === selectedLayerId) ?? null;
  const sampleScene = buildSampleScene(draft, assets);

  function onUpdateLayer(id: string, patch: Partial<Omit<Layer, "id" | "type">>) {
    setDraft((d) => (d ? { ...d, layers: updateLayer(d.layers, id, patch) } : d));
  }
  function onAddLayer() {
    const next = addLayer(draft!.layers, addType, draft!.canvas);
    setDraft({ ...draft!, layers: next });
    setSelectedLayerId(next[next.length - 1].id);
  }
  function onRemoveLayer(id: string) {
    if (draft!.layers.length <= 1) return; // 最低1枚は残す（schema layers≥1）
    setDraft({ ...draft!, layers: removeLayer(draft!.layers, id) });
    if (selectedLayerId === id) setSelectedLayerId(null);
  }
  async function onSave() {
    if (busy) return;
    // 名前は前後空白を除去し、空なら元の名前にフォールバック。
    const normalized = { ...draft!, name: draft!.name.trim() || editing!.name };
    setBusy(true);
    try {
      await saveUserTemplate(normalized);
    } finally {
      setBusy(false);
    }
    // 保存成功（失敗文言が無い）なら一覧へ戻る。失敗時は templateError が出るので留まる。
    if (!useProjectStore.getState().templateError) backToList();
  }
  async function onDelete() {
    const ok = await deleteUserTemplate(editing!.templateId);
    setConfirmDelete(false);
    if (ok) backToList(); // 削除成功で一覧へ（参照中プロジェクトは §9 補正）。
  }
  function onBack() {
    if (dirty) setConfirmDiscard(true);
    else backToList();
  }
  // テンプレ既定素材の取り込み（ADR-0021）：選んだ画像をグローバル保存し、layer.assetId に束縛する。
  async function onPickDefaultAsset(layerId: string, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || busy) return;
    // プロジェクト素材と同じ上限で弾く（data URL を表示用 src に常駐させるためメモリ逼迫を防ぐ・PR#295 レビュー🔴1）。
    if (exceedsInlineAssetLimit(file.size)) {
      const limitMb = Math.round(MAX_INLINE_ASSET_BYTES / (1024 * 1024));
      setAssetError({ layerId, msg: `この画像は大きすぎます（上限${limitMb}MB）。別の小さい画像を選び直してください。` });
      return;
    }
    setBusy(true);
    setAssetError(null);
    try {
      const assetId = await registerTemplateAsset(file);
      if (assetId) onUpdateLayer(layerId, { assetId });
      else setAssetError({ layerId, msg: "素材を登録できませんでした。もう一度お試しください。" });
    } finally {
      setBusy(false);
    }
  }
  // 既定素材の登録/プレビュー/解除（background/slot/logo で共用）。場面に素材が無いとき使われる既定（ADR-0021）。
  function renderDefaultAssetControl(l: Layer) {
    const url = l.assetId ? templateAssetSrcById[l.assetId] : undefined;
    return (
      <div className="field" style={{ margin: "8px 0 0" }}>
        <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>既定の素材（写真）</label>
        {l.assetId ? (
          <div className="row gap-sm" style={{ alignItems: "center" }}>
            {url ? (
              <img src={url} alt="" style={{ width: 64, height: 40, objectFit: "cover", borderRadius: 4, border: "1px solid var(--color-border)" }} />
            ) : (
              <span className="text-sm text-muted">設定済み</span>
            )}
            <button className="btn btn-ghost text-sm" onClick={() => onUpdateLayer(l.id, { assetId: undefined })}>外す</button>
          </div>
        ) : (
          <>
            <input id={`tmplAsset_${l.id}`} type="file" accept="image/*" hidden disabled={busy} onChange={(e) => void onPickDefaultAsset(l.id, e)} />
            <label htmlFor={`tmplAsset_${l.id}`} className="btn btn-secondary text-sm" style={{ cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.5 : 1, alignSelf: "flex-start" }}>素材を選ぶ</label>
            <p className="field-hint" style={{ marginTop: 2 }}>このテンプレを使うと、場面に素材が無いときこの画像が入ります。</p>
          </>
        )}
        {assetError?.layerId === l.id && (
          <div className="notice notice-warn mt" role="alert"><span>{assetError.msg}</span></div>
        )}
      </div>
    );
  }

  // 型別コントロール（#214 ④）：文字＝内容/大きさ/色/太さ、図形＝形/色、素材＝種類/収め方、立ち絵＝収め方/ポーズ 等。
  function renderLayerControls(l: Layer) {
    if (l.type === "text" || l.type === "subtitle") {
      return (
        <>
          <div className="field" style={{ margin: 0 }}>
            <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>表示するテキスト</label>
            <select className="select" value={l.textKey ?? (l.type === "subtitle" ? TEXT_KEY.subtitle : TEXT_KEY.title)} onChange={(e) => onUpdateLayer(l.id, { textKey: e.target.value as TextKey })}>
              {TEXT_KEYS.map((k) => (<option key={k} value={k}>{textKeyLabel[k]}</option>))}
            </select>
          </div>
          <div className="row gap-sm" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
            {numField("文字の大きさ", l.fontSize ?? 40, (v) => onUpdateLayer(l.id, { fontSize: v }), 1)}
            <div className="field" style={{ margin: 0 }}>
              <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>色</label>
              <input className="input" type="color" value={l.color ?? "#222222"} onChange={(e) => onUpdateLayer(l.id, { color: e.target.value })} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>太さ</label>
              <select className="select" value={l.fontWeight ?? FONT_WEIGHT.normal} onChange={(e) => onUpdateLayer(l.id, { fontWeight: e.target.value as FontWeight })}>
                {FONT_WEIGHTS.map((w) => (<option key={w} value={w}>{fontWeightLabel[w]}</option>))}
              </select>
            </div>
          </div>
          {/* 縁取り（#275）：太さ>0 で文字（字幕含む）に縁取りを敷く。描画は既存（FREE の #209）と同じ仕組み。 */}
          <div className="row gap-sm" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
            {numField("縁取りの太さ", l.strokeWidth ?? 0, (v) => onUpdateLayer(l.id, { strokeWidth: v, ...(v > 0 && l.strokeColor == null ? { strokeColor: "#ffffff" } : {}) }), 0, 20)}
            {(l.strokeWidth ?? 0) > 0 && (
              <div className="field" style={{ margin: 0 }}>
                <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>縁取りの色</label>
                <input className="input" type="color" value={l.strokeColor ?? "#ffffff"} onChange={(e) => onUpdateLayer(l.id, { strokeColor: e.target.value })} />
              </div>
            )}
          </div>
          {/* 字幕は背景帯（黒固定で実用性が低い＝#275）。付ける/色/濃さを編集できるよう開放（描画は既存の layer.background を使用）。 */}
          {l.type === "subtitle" && (
            <div className="col gap-sm" style={{ marginTop: 4 }}>
              <div className="toggle-row">
                <label className="field-label text-sm" style={{ margin: 0 }}>字幕の背景帯を付ける</label>
                <Switch on={l.background?.enabled ?? false} onChange={(on) => onUpdateLayer(l.id, { background: { ...l.background, enabled: on } })} label="字幕の背景帯を付ける" />
              </div>
              {l.background?.enabled && (
                <div className="row gap-sm" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>背景色</label>
                    <input className="input" type="color" value={l.background?.color ?? "#000000"} onChange={(e) => onUpdateLayer(l.id, { background: { ...l.background, color: e.target.value } })} />
                  </div>
                  {numField("濃さ(%)", Math.round((l.background?.opacity ?? 0.55) * 100), (v) => onUpdateLayer(l.id, { background: { ...l.background, opacity: v / 100 } }), 0, 100)}
                </div>
              )}
            </div>
          )}
        </>
      );
    }
    if (l.type === "shape") {
      return (
        <div className="row gap-sm" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="field" style={{ margin: 0 }}>
            <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>形</label>
            <select className="select" value={l.shapeType ?? LAYER_SHAPE_TYPE.rect} onChange={(e) => onUpdateLayer(l.id, { shapeType: e.target.value as LayerShapeType })}>
              {LAYER_SHAPE_TYPES.map((s) => (<option key={s} value={s}>{layerShapeLabel[s]}</option>))}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>色</label>
            <input className="input" type="color" value={l.fillColor ?? "#cccccc"} onChange={(e) => onUpdateLayer(l.id, { fillColor: e.target.value })} />
          </div>
        </div>
      );
    }
    if (l.type === "slot") {
      return (
        <>
          <div className="row gap-sm" style={{ flexWrap: "wrap" }}>
            <div className="field" style={{ margin: 0 }}>
              <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>入れるもの</label>
              <select className="select" value={l.slotType ?? SLOT_TYPE.image_or_video} onChange={(e) => onUpdateLayer(l.id, { slotType: e.target.value as SlotType })}>
                {SLOT_TYPES.map((s) => (<option key={s} value={s}>{slotTypeLabel[s]}</option>))}
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>収め方</label>
              <select className="select" value={l.fit ?? FIT.cover} onChange={(e) => onUpdateLayer(l.id, { fit: e.target.value as Fit })}>
                {FITS.map((f) => (<option key={f} value={f}>{fitLabel[f]}</option>))}
              </select>
            </div>
          </div>
          {renderDefaultAssetControl(l)}
        </>
      );
    }
    if (l.type === "background") {
      return (
        <>
          {renderDefaultAssetControl(l)}
          <div className="field" style={{ margin: "8px 0 0" }}>
            <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>背景色（写真を入れないとき）</label>
            <input className="input" type="color" value={l.fillColor ?? "#ffffff"} onChange={(e) => onUpdateLayer(l.id, { fillColor: e.target.value })} />
          </div>
        </>
      );
    }
    if (l.type === "logo" || l.type === "character") {
      return (
        <>
          <div className="field" style={{ margin: 0 }}>
            <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>収め方</label>
            <select className="select" value={l.fit ?? FIT.contain} onChange={(e) => onUpdateLayer(l.id, { fit: e.target.value as Fit })}>
              {FITS.map((f) => (<option key={f} value={f}>{fitLabel[f]}</option>))}
            </select>
          </div>
          {l.type === "logo" && renderDefaultAssetControl(l)}
          {l.type === "character" && (
            <div className="field" style={{ margin: "8px 0 0" }}>
              <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>ポーズ（既定）</label>
              <select className="select" value={l.defaultPoseTag ?? ""} onChange={(e) => onUpdateLayer(l.id, { defaultPoseTag: e.target.value || undefined })}>
                <option value="">指定なし（場面で選ぶ）</option>
                {yukoPoseTags.map((t) => (<option key={t} value={t}>{t}</option>))}
              </select>
              {yukoPoseTags.length === 0 && (
                <p className="field-hint" style={{ marginTop: 2 }}>選べるポーズは、素材に追加したゆうこ画像から増えます。</p>
              )}
            </div>
          )}
        </>
      );
    }
    // 装飾（decor）はテンプレからは内容非開放（ADR-0017）。選択時にパネルが空にならないよう理由を示す（位置・大きさは上の数値で調整可）。
    if (l.type === "decor") {
      return (
        <p className="field-hint" style={{ margin: 0 }}>装飾の見た目はここでは変更できません（位置・大きさは調整できます）。</p>
      );
    }
    return null;
  }

  return (
    <div className="main-scroll">
      {/* ヘッダ：戻る・タイトル・保存（共通トップバーは App.tsx で非表示にしている＝保存ボタンの混同を防ぐ） */}
      <div className="row-between" style={{ alignItems: "center", marginBottom: "var(--gap)" }}>
        <div className="row gap-sm" style={{ alignItems: "center" }}>
          <button className="btn btn-ghost btn-icon" onClick={onBack}>← 一覧へ戻る</button>
          <span className="topbar-title">見た目パターンを編集</span>
        </div>
        <div className="row gap-sm" style={{ alignItems: "center" }}>
          {dirty && <span className="text-sm text-muted">未保存の変更があります</span>}
          <button className="btn btn-primary" disabled={!dirty || busy} onClick={() => void onSave()}>
            {busy ? "保存中…" : "変更を保存"}
          </button>
        </div>
      </div>

      {confirmDiscard && (
        <div className="notice notice-warn mb" role="alert">
          <span>編集中の変更を保存せずに一覧へ戻りますか？</span>
          <div className="row gap-sm">
            <button className="btn btn-primary btn-icon" onClick={backToList}>戻る（破棄）</button>
            <button className="btn btn-ghost btn-icon" onClick={() => setConfirmDiscard(false)}>編集を続ける</button>
          </div>
        </div>
      )}
      {templateError && (
        <div className="notice notice-warn mb" role="alert"><span>{templateError}</span></div>
      )}

      {/* 本体：左＝キャンバス（広く）／右＝編集パネル */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: "var(--gap-lg)", alignItems: "start" }}>
        {/* 左：プレビュー＋レイヤー操作オーバーレイ（ドラッグ/リサイズ/吸着・③c） */}
        <div className="card">
          <h2 className="section-title">プレビュー</h2>
          <ScenePreview scene={sampleScene} template={draft}>
            <TemplateLayerOverlay
              layers={draft.layers}
              canvasW={draft.canvas.width}
              canvasH={draft.canvas.height}
              selectedId={selectedLayerId}
              onSelect={setSelectedLayerId}
              onChange={(id, g) => onUpdateLayer(id, g)}
              label={(l) => layerLabel[l.type]}
            />
          </ScenePreview>
          <p className="text-sm text-muted mt">プレビュー上で要素をドラッグ・拡大縮小できます（写真・文字は例として表示）。</p>
        </div>

        {/* 右：編集パネル */}
        <div className="card col gap-sm">
          {/* 名前 */}
          <div className="field" style={{ margin: 0 }}>
            <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>名前</label>
            <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>

          {/* レイヤー一覧（重ね順・上が手前）＋追加 */}
          <div className="field" style={{ margin: 0 }}>
            <label className="field-label text-sm" style={{ margin: "0 0 4px" }}>レイヤー（上が手前）</label>
            <div className="col" style={{ gap: 2 }}>
              {[...draft.layers].sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0)).map((l) => (
                <div
                  key={l.id}
                  className="row-between"
                  style={{ padding: "2px 6px", borderRadius: 4, background: l.id === selectedLayerId ? "rgba(80,130,255,0.12)" : "var(--color-surface-alt)" }}
                >
                  <button className="btn btn-ghost text-sm" style={{ flex: 1, textAlign: "left", minWidth: 0 }} onClick={() => setSelectedLayerId(l.id)}>
                    {layerLabel[l.type]}
                  </button>
                  <button
                    className="btn btn-ghost btn-icon text-sm"
                    style={{ color: "var(--color-danger)" }}
                    disabled={draft.layers.length <= 1}
                    title={draft.layers.length <= 1 ? "最後の1枚は消せません" : "このレイヤーを削除"}
                    onClick={() => onRemoveLayer(l.id)}
                  >
                    削除
                  </button>
                </div>
              ))}
            </div>
            <div className="row gap-sm mt">
              <select className="select" value={addType} onChange={(e) => setAddType(e.target.value as LayerType)}>
                {TEMPLATE_ADDABLE_LAYER_TYPES.map((t) => (<option key={t} value={t}>{layerLabel[t]}</option>))}
              </select>
              <button className="btn btn-secondary" onClick={onAddLayer}>レイヤーを追加</button>
            </div>
          </div>

          {/* 選択レイヤーの位置・サイズ（数値）＋型別の内容・見た目 */}
          {selectedLayer && (
            <div className="col gap-sm">
              <div className="field" style={{ margin: 0 }}>
                <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>「{layerLabel[selectedLayer.type]}」の位置・サイズ</label>
                <div className="row gap-sm" style={{ flexWrap: "wrap" }}>
                  {numField("横位置", selectedLayer.x, (v) => onUpdateLayer(selectedLayer.id, { x: v }))}
                  {numField("縦位置", selectedLayer.y, (v) => onUpdateLayer(selectedLayer.id, { y: v }))}
                  {numField("幅", selectedLayer.w, (v) => onUpdateLayer(selectedLayer.id, { w: v }), 1)}
                  {numField("高さ", selectedLayer.h, (v) => onUpdateLayer(selectedLayer.id, { h: v }), 1)}
                  {numField("重なり順", selectedLayer.zIndex ?? 0, (v) => onUpdateLayer(selectedLayer.id, { zIndex: v }))}
                </div>
              </div>
              {renderLayerControls(selectedLayer)}
            </div>
          )}

          {/* 削除（マイテンプレのみ。同梱テンプレ ID では store の削除がガードされ静かに失敗するため、ボタン自体を出さない＝§2-5） */}
          {isUserTemplate(editing.templateId) && (
            <>
              <hr className="divider" />
              {confirmDelete ? (
                <div className="row gap-sm" style={{ alignItems: "center" }}>
                  <span className="text-sm">このマイテンプレを削除しますか？</span>
                  <button className="btn btn-ghost text-sm" onClick={() => setConfirmDelete(false)}>やめる</button>
                  <button className="btn btn-ghost text-sm" style={{ color: "var(--color-danger)" }} onClick={() => void onDelete()}>削除する</button>
                </div>
              ) : (
                <button className="btn btn-ghost text-sm" style={{ color: "var(--color-danger)", alignSelf: "flex-start" }} onClick={() => setConfirmDelete(true)}>
                  このマイテンプレを削除
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
