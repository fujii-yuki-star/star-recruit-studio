import { useEffect, useState, type ChangeEvent } from "react";
import type { Asset, AssetRefs, FreeElement, Scene, Texts } from "../../domain/project/types";
import type { Layer, Template } from "../../domain/template/types";
import { ASSET_TYPE, FIT, FITS, FONT_WEIGHT, FONT_WEIGHTS, FREE_CATEGORY, FREE_SHAPE_TYPE, LAYER_SHAPE_TYPE, LAYER_SHAPE_TYPES, NARRATION_STATUS, SLOT_TYPE, SLOT_TYPES, TEXT_KEY, TEXT_KEYS, type Fit, type FontWeight, type LayerShapeType, type LayerType, type SceneCategory, type SlotType, type TextKey } from "../../domain/enums";
import { DEFAULT_CHARACTER_ID } from "../../domain/constants";
import { isUserTemplate } from "../../domain/template/userTemplate";
import { addLayer, removeLayer, TEMPLATE_ADDABLE_LAYER_TYPES, updateLayer } from "../../domain/template/layerOps";
import { useProjectStore } from "../store/projectStore";
import { parseTemplateFiles } from "../../infrastructure/templateFs";
import { ScenePreview } from "../components/ScenePreview";
import { TemplateLayerOverlay } from "../components/TemplateLayerOverlay";
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

// 型別コントロールのユーザー向けラベル（#214 ④・§2-3）。全値必須＝enum 追加漏れをコンパイルで検知。
const textKeyLabel: Record<TextKey, string> = {
  title: "見出し",
  main: "本文",
  subtitle: "字幕",
  caption: "キャプション",
  url: "URL",
};
const layerShapeLabel: Record<LayerShapeType, string> = {
  rect: "四角",
  ellipse: "丸",
  line: "線",
};
const fontWeightLabel: Record<FontWeight, string> = {
  normal: "標準",
  bold: "太字",
};
const slotTypeLabel: Record<SlotType, string> = {
  image_or_video: "写真・動画",
  image: "写真",
  video: "動画",
};
const fitLabel: Record<Fit, string> = {
  cover: "切り取って合わせる",
  contain: "全体を収める",
  stretch: "引き伸ばす",
};

/** テンプレを編集ドラフト用にコピー（レイヤーも個別コピー＝編集が元（store の current）を壊さない）。 */
function cloneTemplate(t: Template): Template {
  return { ...t, layers: t.layers.map((l) => ({ ...l })) };
}

/** レイヤーの座標/サイズ用の小さな数値入力（整数 px。入力途中の NaN/空は無視、min 指定（幅/高さ）は下限クランプ）。 */
function numField(label: string, value: number, onChange: (v: number) => void, min?: number) {
  return (
    <label className="text-sm" style={{ display: "flex", flexDirection: "column", flex: "1 0 40%" }}>
      {label}
      <input
        className="input"
        type="number"
        step={1}
        min={min}
        value={value}
        onChange={(e) => {
          // type=number は入力途中（"" や "-"）でも発火。NaN を描画/保存へ流さない。幅/高さは min 未満にしない。
          const v = parseInt(e.target.value, 10);
          if (!Number.isNaN(v)) onChange(min != null ? Math.max(min, v) : v);
        }}
      />
    </label>
  );
}

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
  const duplicateAsUserTemplate = useProjectStore((s) => s.duplicateAsUserTemplate);
  const deleteUserTemplate = useProjectStore((s) => s.deleteUserTemplate);
  const saveUserTemplate = useProjectStore((s) => s.saveUserTemplate);
  const templateError = useProjectStore((s) => s.templateError);
  const clearTemplateError = useProjectStore((s) => s.clearTemplateError);
  const [selectedId, setSelectedId] = useState(templates[0]?.templateId ?? "");
  const [loadMsg, setLoadMsg] = useState("");
  const [loadOk, setLoadOk] = useState(true);
  // マイテンプレの編集ドラフト（名前＋レイヤー）・選択レイヤー・追加種別・削除確認・操作中（連打防止）（#214 ③a/③b）。
  const [draft, setDraft] = useState<Template | null>(null);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [addType, setAddType] = useState<LayerType>("text");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const current = templates.find((t) => t.templateId === selectedId) ?? templates[0];

  // 選択が変わったら編集ドラフトをその内容に同期（マイテンプレのみ・同梱は null=編集不可）。削除確認は閉じる。
  // syncedId は undefined 始まり＝初回描画でも必ず同期。描画中リセット＝effect 内 setState を避ける React 推奨パターン。
  const [syncedId, setSyncedId] = useState<string | undefined>(undefined);
  if (current && current.templateId !== syncedId) {
    setSyncedId(current.templateId);
    setDraft(isUserTemplate(current.templateId) ? cloneTemplate(current) : null);
    setSelectedLayerId(null);
    setConfirmDelete(false);
  }
  // 選択を変えたら前の操作のエラーは消す（無関係なエラーを別テンプレのパネルに残さない）。
  useEffect(() => {
    clearTemplateError();
  }, [current?.templateId, clearTemplateError]);

  const isUserCurrent = current ? isUserTemplate(current.templateId) : false;
  // プレビューは編集中ドラフトを優先＝レイヤー編集が即プレビューに反映される。
  const previewTemplate = draft ?? current;
  const dirty = !!(draft && current && JSON.stringify(draft) !== JSON.stringify(current));
  const selectedLayer = draft?.layers.find((l) => l.id === selectedLayerId) ?? null;

  // この見た目を複製してマイテンプレにする（複製後はそれを選択）。連打は busy で防ぐ（採番の余分な前進を避ける）。
  async function onDuplicate() {
    if (!current || busy) return;
    setBusy(true);
    try {
      const newId = await duplicateAsUserTemplate(current.templateId);
      if (newId) setSelectedId(newId);
    } finally {
      setBusy(false);
    }
  }
  // 編集ドラフト（名前・レイヤー）を保存する。連打は busy で防ぐ。
  async function onSave() {
    if (!draft || !isUserCurrent || busy) return;
    // 名前は前後空白を除去し、空なら現在名にフォールバック。保存後はドラフトを正規化値で作り直す＝
    // 成功時は current と一致して未保存表示が消え、失敗時は current（旧）と差があるので未保存のまま残る。
    const normalized = { ...draft, name: draft.name.trim() || current.name };
    setBusy(true);
    try {
      await saveUserTemplate(normalized);
    } finally {
      setBusy(false);
    }
    setDraft(cloneTemplate(normalized));
  }
  // ドラフトのレイヤー操作（純粋 layerOps＝§4）。追加したレイヤーは選択状態にする。
  function onAddLayer() {
    if (!draft) return;
    const next = addLayer(draft.layers, addType, draft.canvas);
    setDraft({ ...draft, layers: next });
    setSelectedLayerId(next[next.length - 1].id);
  }
  function onRemoveLayer(id: string) {
    if (!draft || draft.layers.length <= 1) return; // 最低1枚は残す（schema layers≥1）
    setDraft({ ...draft, layers: removeLayer(draft.layers, id) });
    if (selectedLayerId === id) setSelectedLayerId(null);
  }
  function onUpdateLayer(id: string, patch: Partial<Omit<Layer, "id" | "type">>) {
    if (!draft) return;
    setDraft({ ...draft, layers: updateLayer(draft.layers, id, patch) });
  }
  // 選択レイヤーの型別コントロール（#214 ④）。onUpdateLayer でドラフトへ反映＝ライブプレビュー。
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
      );
    }
    if (l.type === "background") {
      return (
        <div className="field" style={{ margin: 0 }}>
          <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>背景色（写真を入れないとき）</label>
          <input className="input" type="color" value={l.fillColor ?? "#ffffff"} onChange={(e) => onUpdateLayer(l.id, { fillColor: e.target.value })} />
        </div>
      );
    }
    if (l.type === "logo" || l.type === "character") {
      return (
        <div className="field" style={{ margin: 0 }}>
          <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>収め方</label>
          <select className="select" value={l.fit ?? FIT.contain} onChange={(e) => onUpdateLayer(l.id, { fit: e.target.value as Fit })}>
            {FITS.map((f) => (<option key={f} value={f}>{fitLabel[f]}</option>))}
          </select>
        </div>
      );
    }
    return null;
  }
  // マイテンプレを削除し、別の見た目を選択する。削除が成功したときだけ選択を移す（失敗時は対象が残るので留まる）。
  async function onDelete() {
    if (!current || !isUserCurrent) return;
    const targetId = current.templateId;
    const fallback = templates.find((t) => t.templateId !== targetId)?.templateId ?? "";
    const ok = await deleteUserTemplate(targetId);
    setConfirmDelete(false);
    if (ok) setSelectedId(fallback);
  }

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

  const sampleScene = buildSampleScene(previewTemplate, assets);

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
              <span className="action-card-desc">{categoryLabel[t.category]}{isUserTemplate(t.templateId) ? "・マイテンプレ" : ""}</span>
            </button>
          ))}
        </div>

        {/* 右: 選択中の見た目のプレビュー＋情報 */}
        <div className="card">
          <h2 className="section-title">見本</h2>
          {/* マイテンプレ編集中はプレビューにレイヤー操作オーバーレイを重ねる（ドラッグ/リサイズ/吸着・③c）。 */}
          <div style={{ position: "relative" }}>
            <ScenePreview scene={sampleScene} template={previewTemplate} />
            {draft && (
              <TemplateLayerOverlay
                layers={draft.layers}
                canvasW={draft.canvas.width}
                canvasH={draft.canvas.height}
                selectedId={selectedLayerId}
                onSelect={setSelectedLayerId}
                onChange={(id, g) => onUpdateLayer(id, g)}
                label={(l) => layerLabel[l.type]}
              />
            )}
          </div>
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
          {/* マイテンプレ（ユーザーテンプレ）の作成・編集（#214 ③a・ADR-0017）。レイヤーの配置編集は順次対応。 */}
          <h3 className="field-label">この見た目を編集</h3>
          <span className={`badge ${isUserCurrent ? "badge-teal" : "badge-gray"}`}>
            {isUserCurrent ? "マイテンプレ" : "標準（編集するには複製します）"}
          </span>
          <div className="col gap-sm mt">
            <button className="btn btn-secondary" disabled={busy} onClick={() => void onDuplicate()}>
              この見た目を複製してマイテンプレにする
            </button>
            {isUserCurrent && draft && (
              <>
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

                {/* 選択レイヤーの位置・サイズ（数値。プレビュー上のドラッグ＝③c）＋型別の内容・見た目（④）。 */}
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
                    {/* 型別コントロール（#214 ④）：文字＝内容/大きさ/色/太さ、図形＝形/色、素材＝種類/収め方 等。 */}
                    {renderLayerControls(selectedLayer)}
                  </div>
                )}

                {/* 保存 */}
                <div className="row gap-sm" style={{ alignItems: "center" }}>
                  <button className="btn btn-primary" disabled={!dirty || busy} onClick={() => void onSave()}>変更を保存</button>
                  {dirty && <span className="text-sm text-muted">未保存の変更があります</span>}
                </div>

                {/* 削除 */}
                {confirmDelete ? (
                  <div className="row gap-sm" style={{ alignItems: "center" }}>
                    <span className="text-sm">このマイテンプレを削除しますか？</span>
                    <button className="btn btn-ghost text-sm" onClick={() => setConfirmDelete(false)}>やめる</button>
                    <button className="btn btn-ghost text-sm" style={{ color: "var(--color-danger)" }} onClick={() => void onDelete()}>削除する</button>
                  </div>
                ) : (
                  <button
                    className="btn btn-ghost text-sm"
                    style={{ color: "var(--color-danger)", alignSelf: "flex-start" }}
                    onClick={() => setConfirmDelete(true)}
                  >
                    このマイテンプレを削除
                  </button>
                )}
              </>
            )}
          </div>
          {templateError && (
            <div className="notice notice-warn mt" role="alert">
              <span>{templateError}</span>
            </div>
          )}

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
          <p className="field-hint mt">用意した見た目パターンのファイルを追加できます。</p>
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
