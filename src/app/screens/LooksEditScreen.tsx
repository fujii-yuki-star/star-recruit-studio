import { useRef, useState, type ChangeEvent } from "react";
import type { ScreenId } from "../data/mockData";
import type { Layer, Template } from "../../domain/template/types";
import { FIT, FITS, FONT_WEIGHT, FONT_WEIGHTS, LAYER_SHAPE_TYPE, LAYER_SHAPE_TYPES, SLOT_TYPE, SLOT_TYPES, TEXT_KEY, TEXT_KEYS, type Fit, type FontWeight, type LayerShapeType, type LayerType, type SlotType, type TextKey } from "../../domain/enums";
import { addLayer, removeLayer, TEMPLATE_ADDABLE_LAYER_TYPES, updateLayer } from "../../domain/template/layerOps";
import { isUserTemplate } from "../../domain/template/userTemplate";
import { effectiveLayerZ, moveLayerZ } from "../../domain/template/layerOrder";
import { buildYukoPoseTags } from "../../domain/ai/videoPlanInput";
import { exceedsInlineAssetLimit } from "../../domain/asset/assetFile";
import { MAX_INLINE_ASSET_BYTES, STROKE_WIDTH_MAX } from "../../domain/constants";
// 文字の既定値は domain（template/textStyle）が正典＝描画・場面編集の体裁欄・通常→FREE 変換と同じ値を使う（§2-7・#555）。
import { DEFAULT_FONT_SIZE, DEFAULT_STROKE_COLOR, DEFAULT_TEXT_COLOR } from "../../domain/template/textStyle";
import { isExportBusy, useProjectStore } from "../store/projectStore";
import { useDraftHistory } from "../hooks/useDraftHistory";
import { isTextEntryTarget, useUndoRedoShortcuts } from "../hooks/useUndoRedoShortcuts";
import { ExportLockBanner } from "../components/ExportLockBanner";
import { ScenePreview } from "../components/ScenePreview";
import { TemplateLayerOverlay } from "../components/TemplateLayerOverlay";
import type { FreeElementMove } from "../../domain/project/freeLayoutOps";
import { createGroupFromSelection, groupElementIds, removeGroupWithMembers, removeMembersFromGroups, reorderGroupZ, toggleGroupFlag, topGroupOfMember, ungroupGroup, updateGroupMeta, updateGroupTransform } from "../../domain/project/groupOps";
import { GroupList } from "../components/GroupList";
import { GroupTransformFields } from "../components/GroupTransformFields";
import { ColorPicker } from "../components/ColorPicker";
import type { GroupTransform } from "../../domain/group/types";
import { Switch } from "../components/ui";
import { NumberField } from "../components/NumberField";
import { DeleteConfirm } from "../components/DeleteConfirm";
import { UnsavedMark } from "../components/SaveStatusBadge";
import { UndoRedoButtons } from "../components/UndoRedoButtons";
import { ArrowLeftIcon } from "../components/icons";
import { opacityToPercent, percentToOpacity } from "../../domain/format/opacity";
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

// レイヤーの座標/サイズ/濃さ用の数値入力は共有 NumberField（#459）＝入力途中の NaN/空は無視、blur で min/max クランプ。
// flex: "1 0 40%" で従来どおり2列で折り返す。呼び出しを短くするための薄いラッパ。
function numField(label: string, value: number, onChange: (v: number) => void, min?: number, max?: number) {
  return <NumberField label={label} value={value} onChange={onChange} min={min} max={max} style={{ flex: "1 0 40%" }} />;
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
  const isExporting = useProjectStore((s) => isExportBusy(s.exportRun.phase)); // 書き出し中は見た目の保存/削除を止める（#570 P1 レビュー）

  const editing = templates.find((t) => t.templateId === editingTemplateId) ?? null;
  const yukoPoseTags = buildYukoPoseTags(assets);
  // レイヤーごとの既定素材 file input（レイヤー単位で複数あるため id 単一の useRef でなく id→要素のマップ・#412）。
  const defaultAssetInputs = useRef<Record<string, HTMLInputElement | null>>({});

  // 下書きは画面ローカル（store 履歴の対象外＝#547 P1-1）。そのため取り消し/やり直しも専用の局所履歴で用意する
  // （#547 P2-3）。これが無いと復旧手段が「破棄して戻る」だけになり、1回の誤ドラッグで全編集の破棄を迫られる。
  const {
    value: draft,
    set: setDraft,
    undo: undoDraft,
    redo: redoDraft,
    canUndo,
    canRedo,
    beginGroup,
    endGroup,
    textGroup,
  } = useDraftHistory<Template | null>(() => (editing ? cloneTemplate(editing) : null));
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  // 主＝末尾選択（種別別エディタ・削除はこれを基準）。複数選択は一括移動／④[#307] グループ化の土台。
  const selectedLayerId = selectedLayerIds.length > 0 ? selectedLayerIds[selectedLayerIds.length - 1] : null;
  const [addType, setAddType] = useState<LayerType>("text");
  // 実行中の操作（#410 sub4 レビュー）。押した操作だけラベルを「保存中…／削除中…」にし、
  // どれか実行中は保存/削除/素材を disabled にして連打・多重実行を防ぐ。
  const [busyAction, setBusyAction] = useState<"save" | "delete" | "asset" | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // グループを中身ごと削除する確認（#551）。id で持つ＝選ぶグループが変わると確認が自動で解除される（#410 の流儀）。
  const [confirmDeleteGroupId, setConfirmDeleteGroupId] = useState<string | null>(null);
  const [assetError, setAssetError] = useState<{ layerId: string; msg: string } | null>(null);
  // キーボード入口は全画面共通の判定（修飾キー・入力欄では奪わない）を共有し、実体だけ局所履歴に差し替える。
  // App の全体登録は UNDO_REDO_SCREENS で looks-edit を除外済み＝二重登録・二重 Undo にならない（#547 P1-1）。
  // 有効条件は**ボタンと同じ**（保存/削除の実行中は止める）＝「押せないのにキーだけ効く」不整合を作らない（ADR-0026②/④）。
  // 書き出し中は止めない：ADR-0020 の「書き出し中は undo/redo を止める」は**文書 slice**を守るためのガードで、
  // この下書きは書き出しのスナップショットに入らない＝MP4 に影響しない（この画面が書き出し中に止めるのは保存/削除だけ・#570）。
  useUndoRedoShortcuts(busyAction === null, { undo: undoDraft, redo: redoDraft });

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
    setSelectedLayerIds([next[next.length - 1].id]);
  }
  function onRemoveLayer(id: string) {
    if (draft!.layers.length <= 1) return; // 最低1枚は残す（schema layers≥1）
    // groups からも除去し空グループは落とす（orphan 防止・#308）。
    setDraft({ ...draft!, layers: removeLayer(draft!.layers, id), groups: removeMembersFromGroups(draft!.groups ?? [], [id]) });
    setSelectedLayerIds((cur) => cur.filter((x) => x !== id));
  }
  // 一覧の行名（#547 P2-4）。同じ種別が複数あると「文字」が2行並んで見分けられないので、
  // テキスト層は差し込み先（見出し／本文…）を併記する。場面編集の FREE 一覧が名前＋中身で区別できるのと揃える。
  const layerRowName = (l: Layer): string => {
    const base = layerLabel[l.type];
    const key = l.textKey ? textKeyLabel[l.textKey] : "";
    return key && key !== base ? `${base}（${key}）` : base; // 「字幕（字幕）」のような重複は付けない
  };

  // 重ね順を1段動かす（#547 P2-4）。場面編集（FREE）の↑↓と同じ操作＝数値欄に頼らず並べ替えられる。
  // 基準は実効 z（effectiveLayerZ）＝一覧の並び・実際の描画と一致する。
  function onMoveLayerZ(id: string, dir: "up" | "down") {
    setDraft((d) => {
      if (!d) return d;
      const layers = moveLayerZ(d.layers, id, dir);
      return layers === d.layers ? d : { ...d, layers }; // 端＝変化なしなら下書きも据え置き＝空の取り消しを作らない
    });
  }

  // 複数選択（#306）：Shift+クリックでトグル・マーキーで集合置換・一括移動。
  function selectLayer(id: string | null, additive?: boolean) {
    setActiveGroupId(null); // レイヤー選択はグループ選択を解除（排他）
    if (id == null) { setSelectedLayerIds([]); return; }
    setSelectedLayerIds((cur) => (additive ? (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]) : [id]));
  }
  function selectLayerMany(ids: string[]) {
    setActiveGroupId(null);
    setSelectedLayerIds(ids);
  }
  function onMoveLayers(moves: FreeElementMove[]) {
    setDraft((d) => {
      if (!d) return d;
      const byId = new Map(moves.map((m) => [m.id, m] as const));
      return { ...d, layers: d.layers.map((l) => { const m = byId.get(l.id); return m ? { ...l, x: m.x, y: m.y } : l; }) };
    });
  }
  // グループ（ADR-0022・#307）。tplGroups は draft 由来（早期 return 後＝非 null）。stale な activeGroup は描画に出さない。
  const tplGroups = draft.groups ?? [];
  const activeGroupStillExists = activeGroupId != null && tplGroups.some((g) => g.id === activeGroupId);
  const effectiveActiveGroupId = activeGroupStillExists ? activeGroupId : null;
  const activeGroup = tplGroups.find((g) => g.id === effectiveActiveGroupId) ?? null;
  // グループ削除の確認を出すか（#551 レビュー P2）。**削除できる状態のときだけ**出す＝確認を開いたまま
  // 別の場所でロック/レイヤー削除が起きたら確認を引っ込め、理由つきの無効ボタンへ戻す（サイレント失敗を作らない）。
  const showGroupDeleteConfirm =
    !!effectiveActiveGroupId &&
    confirmDeleteGroupId === effectiveActiveGroupId &&
    !groupDeleteBlockedReason(effectiveActiveGroupId);
  // グループ化できる件数（既に別グループのものは除外）。ボタンの活性判定に使う（サイレント no-op を防ぐ）。
  const groupableCount = selectedLayerIds.filter((id) => topGroupOfMember(tplGroups, id) == null).length;
  function selectGroup(groupId: string | null) {
    setSelectedLayerIds([]);
    setActiveGroupId(groupId);
  }
  function groupSelected() {
    const eligible = selectedLayerIds.filter((id) => topGroupOfMember(tplGroups, id) == null); // 既所属は除外
    if (eligible.length < 2) return;
    const { groups, groupId } = createGroupFromSelection(tplGroups, eligible);
    setDraft((d) => (d ? { ...d, groups } : d));
    setSelectedLayerIds([]);
    setActiveGroupId(groupId);
  }
  function ungroupActive() {
    if (!effectiveActiveGroupId) return;
    if (activeGroup?.locked) return; // ロック中は解除も抑止（UI disabled に加えた多重防御・#319 レビュー）
    const memberIds = groupElementIds(tplGroups, effectiveActiveGroupId);
    setDraft((d) => {
      if (!d) return d;
      const r = ungroupGroup(d.groups ?? [], d.layers, effectiveActiveGroupId);
      return { ...d, groups: r.groups, layers: r.elements };
    });
    setActiveGroupId(null);
    setSelectedLayerIds(memberIds);
  }
  /**
   * グループを中身ごと削除（#551）。解除して1枚ずつ消す手間をなくす。
   * **テンプレは最低1枚のレイヤーが要る**（`template.schema` の `layers.minItems:1`＝`onRemoveLayer` と同じ制約）ので、
   * 全レイヤーが1つのグループに入っている場合は消せない。その場合はボタンを出さず理由を示す（黙って無視しない・§2-5）。
   */
  function deleteGroupWithMembers(groupId: string) {
    if (tplGroups.find((g) => g.id === groupId)?.locked) return; // ロック中は抑止（解除・重ね順と同じ多重防御・#319）
    const { elementIds, groups } = removeGroupWithMembers(tplGroups, groupId);
    if (elementIds.length === 0 || draft!.layers.length - elementIds.length < 1) return;
    const removed = new Set(elementIds);
    setDraft((d) => (d ? { ...d, layers: d.layers.filter((l) => !removed.has(l.id)), groups } : d));
    setActiveGroupId(null);
    setSelectedLayerIds((cur) => cur.filter((x) => !removed.has(x)));
  }
  /** そのグループを中身ごと消すと最低1枚を割るか（`template.schema` の `layers.minItems:1`）。 */
  function wouldEmptyTemplate(groupId: string): boolean {
    return draft!.layers.length - groupElementIds(tplGroups, groupId).length < 1;
  }
  /**
   * グループを中身ごと削除できない理由（無ければ undefined）。**ボタンの無効化・確認の自動解除・`GroupList` への
   * 受け渡しで同じ関数を使う**＝どこから来ても判定が一致する（§2-7）。
   * 確認中にこれが立ったら確認を引っ込める＝内側のガードが無言 return して「消えたはずが消えていない」に
   * ならないようにする（#551 レビュー P2）。
   */
  function groupDeleteBlockedReason(groupId: string): string | undefined {
    if (tplGroups.find((g) => g.id === groupId)?.locked) return "ロック中は削除できません（先にロックを解除してください）";
    if (wouldEmptyTemplate(groupId)) return "この見た目パターンから全部が消えてしまうため削除できません（先に別の要素を足してください）";
    return undefined;
  }
  function transformGroup(groupId: string, patch: Partial<GroupTransform>) {
    if (tplGroups.find((g) => g.id === groupId)?.locked) return; // ロック中は移動/拡縮/回転も抑止（多重防御・#319 レビュー／#554 レビュー）
    setDraft((d) => (d ? { ...d, groups: updateGroupTransform(d.groups ?? [], groupId, patch) } : d));
  }
  // グループの非表示/ロック切替・重ね順（#307 part2b）。
  function toggleGroupHidden(groupId: string) {
    setDraft((d) => (d ? { ...d, groups: toggleGroupFlag(d.groups ?? [], groupId, "hidden") } : d));
  }
  function toggleGroupLocked(groupId: string) {
    setDraft((d) => (d ? { ...d, groups: toggleGroupFlag(d.groups ?? [], groupId, "locked") } : d));
  }
  // グループの改名（#525-9・任意 name）。空文字は自動名（グループN）へフォールバック表示。
  function renameGroup(groupId: string, name: string) {
    setDraft((d) => (d ? { ...d, groups: updateGroupMeta(d.groups ?? [], groupId, { name }) } : d));
  }
  function bringGroupFront(groupId: string) {
    if (tplGroups.find((g) => g.id === groupId)?.locked) return; // ロック中は重ね順も抑止（多重防御・#319 レビュー）
    setDraft((d) => (d ? { ...d, layers: reorderGroupZ(d.layers, groupElementIds(d.groups ?? [], groupId), "front", effectiveLayerZ) } : d));
  }
  function sendGroupBack(groupId: string) {
    if (tplGroups.find((g) => g.id === groupId)?.locked) return;
    setDraft((d) => (d ? { ...d, layers: reorderGroupZ(d.layers, groupElementIds(d.groups ?? [], groupId), "back", effectiveLayerZ) } : d));
  }
  async function onSave() {
    if (busyAction) return;
    // 名前は前後空白を除去し、空なら元の名前にフォールバック。
    const normalized = { ...draft!, name: draft!.name.trim() || editing!.name };
    setBusyAction("save");
    try {
      await saveUserTemplate(normalized);
    } finally {
      setBusyAction(null);
    }
    // 保存成功（失敗文言が無い）なら一覧へ戻る。失敗時は templateError が出るので留まる。
    if (!useProjectStore.getState().templateError) backToList();
  }
  async function onDelete() {
    if (busyAction) return;
    setBusyAction("delete");
    try {
      const ok = await deleteUserTemplate(editing!.templateId);
      setConfirmDelete(false);
      if (ok) backToList(); // 削除成功で一覧へ（参照中プロジェクトは §9 補正）。
    } finally {
      setBusyAction(null);
    }
  }
  function onBack() {
    if (dirty) setConfirmDiscard(true);
    else backToList();
  }
  // テンプレ既定素材の取り込み（ADR-0021）：選んだ画像をグローバル保存し、layer.assetId に束縛する。
  async function onPickDefaultAsset(layerId: string, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || busyAction) return;
    // プロジェクト素材と同じ上限で弾く（data URL を表示用 src に常駐させるためメモリ逼迫を防ぐ・PR#295 レビュー🔴1）。
    if (exceedsInlineAssetLimit(file.size)) {
      const limitMb = Math.round(MAX_INLINE_ASSET_BYTES / (1024 * 1024));
      setAssetError({ layerId, msg: `この画像は大きすぎます（上限${limitMb}MB）。別の小さい画像を選び直してください。` });
      return;
    }
    setBusyAction("asset");
    setAssetError(null);
    try {
      const assetId = await registerTemplateAsset(file);
      if (assetId) onUpdateLayer(layerId, { assetId });
      else setAssetError({ layerId, msg: "素材を登録できませんでした。もう一度お試しください。" });
    } finally {
      setBusyAction(null);
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
            {/* label htmlFor でなく button＝Tab フォーカス・:disabled の共通見た目が効く（#412）。
                レイヤーごとに input があるため ref マップ（id→要素）で click（他2画面の useRef と同じ ref 経由に統一）。 */}
            <input
              ref={(el) => { defaultAssetInputs.current[l.id] = el; }}
              type="file"
              accept="image/*"
              hidden
              disabled={busyAction !== null}
              onChange={(e) => void onPickDefaultAsset(l.id, e)}
            />
            <button
              type="button"
              className="btn btn-secondary text-sm"
              style={{ alignSelf: "flex-start" }}
              disabled={busyAction !== null}
              onClick={() => defaultAssetInputs.current[l.id]?.click()}
            >
              素材を選ぶ
            </button>
            <p className="field-hint" style={{ marginTop: 2 }}>この見た目パターンを使うと、場面に素材が無いときこの画像が入ります。</p>
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
            {numField("文字の大きさ", l.fontSize ?? DEFAULT_FONT_SIZE, (v) => onUpdateLayer(l.id, { fontSize: v }), 1)}
            <div className="field" style={{ margin: 0 }}>
              <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>色</label>
              <ColorPicker value={l.color ?? DEFAULT_TEXT_COLOR} onChange={(v) => onUpdateLayer(l.id, { color: v })} ariaLabel="文字の色を選ぶ" onDragStart={beginGroup} onDragEnd={endGroup} />
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
            {/* 上限は FREE 側と同じ共有定数（#554）。以前はここだけ 20 で、同じ「縁取りの太さ」が編集画面で別上限だった。 */}
            {numField("縁取りの太さ", l.strokeWidth ?? 0, (v) => onUpdateLayer(l.id, { strokeWidth: v, ...(v > 0 && l.strokeColor == null ? { strokeColor: DEFAULT_STROKE_COLOR } : {}) }), 0, STROKE_WIDTH_MAX)}
            {(l.strokeWidth ?? 0) > 0 && (
              <div className="field" style={{ margin: 0 }}>
                <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>縁取りの色</label>
                <ColorPicker value={l.strokeColor ?? DEFAULT_STROKE_COLOR} onChange={(v) => onUpdateLayer(l.id, { strokeColor: v })} ariaLabel="縁取りの色を選ぶ" onDragStart={beginGroup} onDragEnd={endGroup} />
              </div>
            )}
          </div>
          {/* 字幕は背景帯（黒固定で実用性が低い＝#275）。付ける/色/濃さ/角丸を編集できるよう開放（描画は既存の layer.background を使用）。
              角丸は FREE 帯 UI（SceneEditScreen）と揃える＝同概念「字幕の背景帯」を編集画面で同じ編集性に（ADR-0026 観点6・#544 P3）。 */}
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
                    <ColorPicker value={l.background?.color ?? "#000000"} onChange={(v) => onUpdateLayer(l.id, { background: { ...l.background, color: v } })} ariaLabel="背景色を選ぶ" onDragStart={beginGroup} onDragEnd={endGroup} />
                  </div>
                  {numField("濃さ(%)", opacityToPercent(l.background?.opacity ?? 0.55), (v) => onUpdateLayer(l.id, { background: { ...l.background, opacity: percentToOpacity(v) } }), 0, 100)}
                  {numField("角丸", l.background?.radius ?? 16, (v) => onUpdateLayer(l.id, { background: { ...l.background, radius: v } }), 0)}
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
            <ColorPicker value={l.fillColor ?? "#cccccc"} onChange={(v) => onUpdateLayer(l.id, { fillColor: v })} ariaLabel="色を選ぶ" onDragStart={beginGroup} onDragEnd={endGroup} />
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
            <ColorPicker value={l.fillColor ?? "#ffffff"} onChange={(v) => onUpdateLayer(l.id, { fillColor: v })} ariaLabel="背景色を選ぶ" onDragStart={beginGroup} onDragEnd={endGroup} />
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
      <ExportLockBanner />
      {/* ヘッダ：戻る・タイトル・保存（共通トップバーは App.tsx で非表示にしている＝保存ボタンの混同を防ぐ） */}
      <div className="row-between" style={{ alignItems: "center", marginBottom: "var(--gap)" }}>
        <div className="row gap-sm" style={{ alignItems: "center" }}>
          <button className="btn btn-ghost btn-icon" disabled={busyAction !== null} onClick={onBack}><ArrowLeftIcon size={16} />一覧へ戻る</button>
          <span className="topbar-title">見た目パターンを編集</span>
        </div>
        <div className="row gap-sm" style={{ alignItems: "center" }}>
          {/* 取り消す/やり直す（#547 P2-3）。見た目・語彙は共有コンポーネントで他画面と一致（ADR-0026②）。
              対象は**この画面の下書き**＝保存前の編集だけを戻す（store の履歴には触れない・#547 P1-1）。
              保存/削除の実行中は他の操作と揃えて止める。 */}
          <UndoRedoButtons canUndo={canUndo} canRedo={canRedo} onUndo={undoDraft} onRedo={redoDraft} disabled={busyAction !== null} />
          {dirty && <UnsavedMark />}
          <button className="btn btn-primary" disabled={!dirty || busyAction !== null || isExporting} onClick={() => void onSave()}>
            {busyAction === "save" ? "保存中…" : "保存"}
          </button>
        </div>
      </div>

      {confirmDiscard && (
        <div className="notice notice-warn mb" role="alert">
          <span>編集中の変更を保存せずに一覧へ戻りますか？</span>
          {/* 確認は「やめる（左）／実行（右）」で統一（#410 sub2）。キャンセル語は「やめる」に揃える。 */}
          <div className="row gap-sm">
            <button className="btn btn-ghost btn-icon" onClick={() => setConfirmDiscard(false)}>やめる</button>
            <button className="btn btn-primary btn-icon" onClick={backToList}>戻る（破棄）</button>
          </div>
        </div>
      )}
      {templateError && (
        <div className="notice notice-warn mb" role="alert"><span>{templateError}</span></div>
      )}

      {/* 本体：左＝キャンバス（広く）／右＝編集パネル */}
      {/* フォーカス中の連続入力を1つの取り消しに合成する（#547 P2-3）。onFocus/onBlur は子孫から伝播するので、
          数値欄・名前欄・色欄をここ1か所で束ねる（欄ごとに書き分けない）。未変更のフォーカスは記録しない（遅延記録）。 */}
      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: "var(--gap-lg)", alignItems: "start" }}
        onFocus={(e) => { if (isTextEntryTarget(e.target)) textGroup.onFocus(); }}
        onBlur={(e) => { if (isTextEntryTarget(e.target)) textGroup.onBlur(); }}
      >
        {/* 左：プレビュー＋レイヤー操作オーバーレイ（ドラッグ/リサイズ/吸着・③c） */}
        <div className="card">
          <h2 className="section-title">プレビュー</h2>
          <ScenePreview scene={sampleScene} template={draft}>
            <TemplateLayerOverlay
              layers={draft.layers}
              canvasW={draft.canvas.width}
              canvasH={draft.canvas.height}
              selectedIds={selectedLayerIds}
              onSelect={selectLayer}
              onSelectMany={selectLayerMany}
              onChange={(id, g) => onUpdateLayer(id, g)}
              onMoveMany={onMoveLayers}
              onRotate={(id, rotation) => onUpdateLayer(id, { rotation })}
              groups={tplGroups}
              activeGroupId={effectiveActiveGroupId}
              onSelectGroup={selectGroup}
              onGroupTransform={transformGroup}
              label={layerRowName} // 一覧と同じ行名＝キャンバス上でも「文字（見出し）/文字（本文）」を見分けられる
              // 1回のドラッグ/リサイズ/回転＝1回の取り消し（#547 P2-3）。レイヤーの onPointerDown は stopPropagation
              // するため祖先では拾えず、オーバーレイからの明示通知で境界を取る（場面編集の FREE と同じ結線）。
              onInteractionStart={beginGroup}
              onInteractionEnd={endGroup}
            />
          </ScenePreview>
          <p className="text-sm text-muted mt">プレビュー上で要素をドラッグ・拡大縮小・回転できます（写真・文字は例として表示）。</p>
          {/* グループ一覧（#525-9）：全グループを選択・再表示（隠したものを戻す）・改名できる。隠したグループを選び直せる導線。 */}
          <GroupList
            groups={tplGroups}
            activeGroupId={effectiveActiveGroupId}
            onSelect={(id) => selectGroup(id)}
            onToggleHidden={toggleGroupHidden}
            onRename={renameGroup}
            onDelete={deleteGroupWithMembers}
            memberCount={(id) => groupElementIds(tplGroups, id).length}
            deleteDisabledReason={groupDeleteBlockedReason}
          />
          {/* グループを中身ごと削除の確認（#551）。id 比較なので選ぶグループが変わると自動で解除される。
              確認中は下の操作列を隠す（SceneEditScreen と同じ＝確認中にロックできてしまう窓を塞ぐ・レビュー P2）。 */}
          {showGroupDeleteConfirm && effectiveActiveGroupId && (
            <DeleteConfirm
              className="mt"
              message={`このグループを中身ごと削除しますか？中の${groupElementIds(tplGroups, effectiveActiveGroupId).length}個の要素も一緒に消えます。`}
              onCancel={() => setConfirmDeleteGroupId(null)}
              onConfirm={() => { deleteGroupWithMembers(effectiveActiveGroupId); setConfirmDeleteGroupId(null); }}
            />
          )}
          {/* グループ（ADR-0022・#307）：2つ以上選択でグループ化／選択中グループは解除。拡縮・回転・非表示等は part2b。 */}
          {(selectedLayerIds.length >= 2 || effectiveActiveGroupId) && !showGroupDeleteConfirm && (
            <div className="row gap-sm mt" style={{ alignItems: "center", flexWrap: "wrap" }}>
              {selectedLayerIds.length >= 2 && (
                <button
                  className="btn btn-ghost text-sm"
                  disabled={groupableCount < 2}
                  title={groupableCount < 2 ? "選択中の要素はすでにグループに含まれています" : undefined}
                  onClick={groupSelected}
                >選択をグループ化</button>
              )}
              {effectiveActiveGroupId && (
                <>
                  <span className="text-sm">グループを選択中{activeGroup?.locked ? "（ロック中）" : "（移動・拡縮・回転）"}</span>
                  <button className="btn btn-ghost text-sm" title="グループを最前面へ" disabled={!!activeGroup?.locked} onClick={() => bringGroupFront(effectiveActiveGroupId)}>前面</button>
                  <button className="btn btn-ghost text-sm" title="グループを最背面へ" disabled={!!activeGroup?.locked} onClick={() => sendGroupBack(effectiveActiveGroupId)}>背面</button>
                  <button className="btn btn-ghost text-sm" title={activeGroup?.hidden ? "表示する" : "隠す"} onClick={() => toggleGroupHidden(effectiveActiveGroupId)}>{activeGroup?.hidden ? "表示" : "隠す"}</button>
                  <button className="btn btn-ghost text-sm" title={activeGroup?.locked ? "ロックを解除" : "ロックして固定"} onClick={() => toggleGroupLocked(effectiveActiveGroupId)}>{activeGroup?.locked ? "ロック解除" : "ロック"}</button>
                  <button className="btn btn-ghost text-sm" title="グループを解除して要素をばらす（要素は残る）" disabled={!!activeGroup?.locked} onClick={ungroupActive}>解除</button>
                  {/* 中身ごと削除（#551）。「解除」（要素は残る）との違いを説明で明示。最低1枚は残す制約に触れるときは出さない。 */}
                  <button
                    className="btn btn-ghost text-sm"
                    title={groupDeleteBlockedReason(effectiveActiveGroupId) ?? "グループを中身ごと削除（中の要素も消えます）"}
                    disabled={!!groupDeleteBlockedReason(effectiveActiveGroupId)}
                    onClick={() => setConfirmDeleteGroupId(effectiveActiveGroupId)}
                  >削除</button>
                </>
              )}
            </div>
          )}
          {/* 位置・大きさ・角度の数値入力（#554）。場面編集（FREE）と同じ共有欄＝同概念同挙動（ADR-0026②）。
              ロック中はボタン群と揃えて fieldset で無効化。 */}
          {effectiveActiveGroupId && activeGroup && (
            <fieldset
              disabled={!!activeGroup.locked}
              className="mt"
              style={{ border: "none", padding: 0, margin: 0, minInlineSize: "auto", opacity: activeGroup.locked ? 0.5 : 1 }}
            >
              <GroupTransformFields
                transform={activeGroup.transform}
                onChange={(p) => transformGroup(effectiveActiveGroupId, p)}
              />
            </fieldset>
          )}
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
            <label className="field-label text-sm" style={{ margin: "0 0 4px" }}>重ね順（上が手前）</label>
            <div className="col" style={{ gap: 2 }}>
              {/* 並びは**描画順の反転**（上＝手前）。昇順で安定ソートしてから reverse する＝描画（renderer/layout の
                  昇順・安定ソート＝同 z は配列後方が手前）と同 z でも一致する。降順ソートだと同 z のとき前後が逆に出て、
                  ↑↓ が1段にならない（moveByZ 内部の昇順とも食い違う）。 */}
              {[...draft.layers].sort((a, b) => effectiveLayerZ(a) - effectiveLayerZ(b)).reverse().map((l) => (
                <div
                  key={l.id}
                  className="row-between"
                  style={{ padding: "2px 6px", borderRadius: 4, background: selectedLayerIds.includes(l.id) ? "rgba(80,130,255,0.12)" : "var(--color-surface-alt)" }}
                >
                  <button className="btn btn-ghost text-sm" style={{ flex: 1, textAlign: "left", minWidth: 0 }} onClick={(e) => selectLayer(l.id, e.shiftKey)}>
                    {layerRowName(l)}
                  </button>
                  <button className="btn btn-ghost btn-icon text-sm" title="前面へ" aria-label={`${layerRowName(l)}を前面へ`} onClick={() => onMoveLayerZ(l.id, "up")}>↑</button>
                  <button className="btn btn-ghost btn-icon text-sm" title="背面へ" aria-label={`${layerRowName(l)}を背面へ`} onClick={() => onMoveLayerZ(l.id, "down")}>↓</button>
                  <button
                    className="btn btn-ghost btn-icon text-sm"
                    style={{ color: "var(--color-danger)" }}
                    disabled={draft.layers.length <= 1}
                    title={draft.layers.length <= 1 ? "最後の1つは消せません" : "この要素を削除"}
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
              <button className="btn btn-secondary" onClick={onAddLayer}>要素を追加</button>
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
                  {/* 表示は実効 z（一覧・描画と同じ基準）。zIndex 未指定でも「一覧で上なら大きい数」になり、↑↓ と値が食い違わない。 */}
                  {numField("重なり順", effectiveLayerZ(selectedLayer), (v) => onUpdateLayer(selectedLayer.id, { zIndex: v }), 0)}
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
                <DeleteConfirm
                  busy={busyAction === "delete"}
                  message="この見た目パターンを削除しますか？元に戻せません。"
                  onCancel={() => setConfirmDelete(false)}
                  onConfirm={() => void onDelete()}
                />
              ) : (
                <button className="btn btn-ghost text-sm" style={{ color: "var(--color-danger)", alignSelf: "flex-start" }} disabled={isExporting} onClick={() => setConfirmDelete(true)}>
                  この見た目パターンを削除
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
