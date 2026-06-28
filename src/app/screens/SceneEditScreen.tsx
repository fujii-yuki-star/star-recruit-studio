import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { ScreenId } from "../data/mockData";
import type { Asset, FreeElement, Scene } from "../../domain/project/types";
import type { Layer } from "../../domain/template/types";
import { usedTextKeys } from "../../domain/template/layerOps";
import { ASSET_TYPE, FONT_WEIGHT, FREE_CATEGORY, FREE_ELEMENT_KIND, FREE_SHAPE_TYPE, NARRATION_STATUS, SLOT_TYPE, TEXT_ALIGN, TEXT_KEY, TRANSITION_DIRECTION, TRANSITION_TYPE, type FontWeight, type FreeElementKind, type FreeShapeType, type TextAlign, type TextKey, type TransitionDirection, type TransitionType } from "../../domain/enums";
import { SCENE_MIN_DURATION_SEC, VOLUME_MAX, VOLUME_MIN, VOLUME_STEP } from "../../domain/constants";
import { addFreeElement, applyFreeElementPositions, bringFreeElementToFront, duplicateFreeElement, FREE_GRID_SIZE, moveFreeElementZ, pasteFreeElement, removeFreeElement, removeFreeElements, sendFreeElementToBack, updateFreeElement } from "../../domain/project/freeLayoutOps";
import { alignFreeElements, distributeFreeElements, FREE_ALIGN, FREE_DISTRIBUTE, type FreeAlign, type FreeDistribute } from "../../domain/project/freeAlign";
import { addFreeComponentGroup, FREE_COMPONENTS } from "../../domain/project/freeComponents";
import { deriveTransitionSelectValue } from "../../domain/project/sceneTransitions";
import { switchSceneTemplate } from "../../domain/project/sceneOps";
import { resolveNarrationVolume } from "../../domain/voice/audioMix";
import { narrationProgress } from "../../domain/voice/narrationProgress";
import { lineAudioKey, validateSceneLines } from "../../domain/project/narrationLines";
import { addLine, demoteFromLines, moveLine, promoteToLines, removeLine, updateLine } from "../../domain/project/lineEditOps";
import { VOICE_CATALOG } from "../../domain/voice/voiceCatalog";
import { SPEED_RANGE, PITCH_RANGE, INTONATION_RANGE, sliderToValue, valueToSlider, type ParamRange } from "../../domain/voice/voiceParams";
import { useProjectStore } from "../store/projectStore";
import { isTauri } from "../../infrastructure/assetFs";
import { showOpenAssetDialog } from "../../infrastructure/dialog";
import { ScenePreview } from "../components/ScenePreview";
import { FontPicker } from "../components/FontPicker";
import { textKeyLabel } from "../uiLabels";
import type { FontId } from "../../domain/font/fontCatalog";
import { FreeLayoutOverlay } from "../components/FreeLayoutOverlay";
import { ClipDetailControls } from "../components/ClipDetailControls";
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
// 既定 step=1＝座標/サイズ/重なり順は整数 px（非整数を renderer に渡さない）。
function NumberField({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void }) {
  return (
    <div className="field" style={{ flex: 1, margin: 0 }}>
      <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>{label}</label>
      <input
        className="input"
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

// 掛け合いの行ごとの声パラメータ（話す速さ/声の高さ/抑揚）。設定画面と同じ voiceParams スライダーを流用（#242）。
// value=null/未指定＝場面/動画の既定を継承（スライダーは既定位置を淡色表示）。動かすと固有値、「全体に合わせる」で継承へ戻す。
function LineVoiceParam({ label, range, value, lowLabel, highLabel, onChange, onReset }: { label: string; range: ParamRange; value: number | null | undefined; lowLabel: string; highLabel: string; onChange: (v: number) => void; onReset: () => void }) {
  const isSet = value != null;
  return (
    <div className="field" style={{ margin: "8px 0 0" }}>
      <div className="row-between" style={{ alignItems: "center" }}>
        <label className="field-label text-sm" style={{ margin: 0 }}>{label}</label>
        {isSet ? (
          <button type="button" className="btn btn-ghost text-sm" style={{ padding: "0 6px", height: 22 }} onClick={onReset}>全体に合わせる</button>
        ) : (
          <span className="text-faint text-sm">全体に合わせる</span>
        )}
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={valueToSlider(value ?? range.def, range)}
        onChange={(e) => onChange(sliderToValue(Number(e.target.value), range))}
        style={{ width: "100%", accentColor: isSet ? "var(--color-primary)" : "var(--color-border)" }}
      />
      <div className="row-between text-faint text-sm">
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
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
    undo, redo, beginHistoryGroup, endHistoryGroup,
  } = useProjectStore();
  const voiceSettings = useProjectStore((s) => s.meta.voiceSettings);
  const fontId = useProjectStore((s) => s.meta.videoSettings.fontId);
  const setFontId = useProjectStore((s) => s.setFontId);
  // Undo/Redo の可否（#211・ADR-0020）。past/future の有無から導出（派生＝余分な state を持たない）。
  const canUndo = useProjectStore((s) => s.past.length > 0);
  const canRedo = useProjectStore((s) => s.future.length > 0);

  const [filter, setFilter] = useState<AssetFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  // セリフ入力欄の参照（分割のカーソル位置を読む）。
  const lineRef = useRef<HTMLTextAreaElement>(null);
  // こだわり編集（現状はUIのみ・後でドメインへ結線）
  const [showAdvanced, setShowAdvanced] = useState(false);
  // 場面削除の二段確認（誤操作防止）。選択場面が変わったら解除。
  const [confirmDelete, setConfirmDelete] = useState(false);
  // 掛け合い解除（複数行が消える）の確認をインライン表示するか（window.confirm を使わずデザイン統一）。
  const [confirmDialogueOff, setConfirmDialogueOff] = useState(false);
  // 自由配置で選択中の要素（オーバーレイのハンドル表示・編集カードの強調に使う）。
  // 複数選択（#206）。配列が真＝選択集合、末尾が「主」。単一要素編集（カード/詳細モード/ポップオーバー）は主を対象にする。
  const [selectedFreeIds, setSelectedFreeIds] = useState<string[]>([]);
  const selectedFreeId = selectedFreeIds.length > 0 ? selectedFreeIds[selectedFreeIds.length - 1] : null;
  // 一括削除の確認中フラグ（複数まとめ削除は破壊的なので誤操作防止の1段確認を挟む・#206。Undo でも戻せるが確認は維持）。
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  // 選択変更：additive（Shift+クリック）で選択トグル、通常はその要素だけ、null で全解除。選択が変われば一括削除の確認は取り消す。
  const selectFree = (id: string | null, additive = false) => {
    setConfirmBulkDelete(false);
    if (id == null) { setSelectedFreeIds([]); return; }
    setSelectedFreeIds((cur) =>
      additive ? (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]) : [id],
    );
  };
  // FREE 要素のコピー&ペースト用クリップボード。SceneEditScreen は場面切替で再マウントしないため場面をまたいで貼れる（#207）。
  const [freeClipboard, setFreeClipboard] = useState<FreeElement | null>(null);
  // 右クリック「編集」で開く kind 別エディタのポップオーバー（対象 id とビューポート座標）。
  const [editPopover, setEditPopover] = useState<{ id: string; x: number; y: number } | null>(null);
  // 自由配置：グリッドに合わせる（ドラッグ/リサイズの吸着＋グリッド表示）。表示設定・非永続。
  const [gridSnap, setGridSnap] = useState(false);
  // 自由配置：詳細編集モード（選択した要素だけを編集面に出す＝長いスクロールを避ける・#179）。表示設定・非永続。
  const [focusSelectedFree, setFocusSelectedFree] = useState(false);
  // ナレーションの▶再生に失敗したとき通知（§2-5・設定の試聴と扱いを統一）。
  const [narrationPlayError, setNarrationPlayError] = useState(false);

  useEffect(() => {
    if (status === "idle") void generate();
  }, [status, generate]);

  // Escape で kind 別エディタのポップオーバーを閉じる。
  useEffect(() => {
    if (!editPopover) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setEditPopover(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editPopover]);

  // 取り消し/やり直し（#211・ADR-0020）。Ctrl/⌘+Z＝取り消し・Ctrl/⌘+Shift+Z／Ctrl+Y＝やり直し。
  // テキスト入力中（input/textarea/contentEditable）は標準の文字 Undo に任せ、ここでは奪わない。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      if (key === "y" || e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);


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
  // テキスト種別ごとのフォント上書き（#178）。null＝継承（その種別のキーを外す＝動画全体/場面に従う）。
  const setSceneTextFont = (textKey: TextKey, id: FontId | null) =>
    patch((s) => {
      const next = { ...(s.textFontIds ?? {}) };
      if (id) next[textKey] = id;
      else delete next[textKey];
      // 全種別を継承に戻したら空オブジェクトを残さず未設定へ（意味のない {} を永続化しない）。
      return { ...s, textFontIds: Object.keys(next).length ? next : undefined };
    });
  // FREE 場面（自由配置）か。FREE のときだけ自由配置エディタを主編集面として出す（ADR-0008・§2-4）。
  const isFree = template?.category === FREE_CATEGORY;
  // 非FREE場面のテキスト入力欄は、選択テンプレのテキスト層が使う textKey から生成する（#214 ④b・全5キー対応）。
  const sceneTextKeys = template ? usedTextKeys(template.layers) : [];
  const freeLayout = selected.freeLayout ?? [];
  // 自由配置 slot に割り当て可能な素材（画像・動画）。
  const freeSlotAssets = assets.filter((a) => a.assetType === ASSET_TYPE.image || a.assetType === ASSET_TYPE.video);
  // 追加：新要素を末尾に積み、追加直後のその要素を選択状態にする（詳細モードでも即表示・#179）。
  // duplicateFreeEl と同様に updater 内の最新 s.freeLayout から計算（同期実行で newId は下の前に確定）。
  const addFreeEl = (kind: FreeElementKind) => {
    let newId: string | null = null;
    patch((s) => {
      const result = addFreeElement(s.freeLayout ?? [], kind);
      newId = result.newId;
      return { ...s, freeLayout: result.freeLayout };
    });
    if (newId) setSelectedFreeIds([newId]);
  };
  const patchFreeEl = (id: string, p: Partial<Omit<FreeElement, "id" | "kind">>) =>
    patch((s) => ({ ...s, freeLayout: updateFreeElement(s.freeLayout ?? [], id, p) }));
  const removeFreeEl = (id: string) => {
    patch((s) => ({ ...s, freeLayout: removeFreeElement(s.freeLayout ?? [], id) }));
    setSelectedFreeIds((cur) => cur.filter((x) => x !== id)); // 選択中を消したら選択から外す（詳細モードは案内へ）
  };
  // 一括移動：複数選択の全要素の位置を1回の更新でまとめて反映（オーバーレイのドラッグから・#206）。
  const moveFreeMany = (moves: { id: string; x: number; y: number }[]) =>
    patch((s) => ({ ...s, freeLayout: applyFreeElementPositions(s.freeLayout ?? [], moves) }));
  // 一括削除：選択中の全要素を削除し選択を解除（#206）。開いている編集ポップオーバーも閉じる（削除済み要素に残らないように）。
  const removeFreeMany = (ids: string[]) => {
    patch((s) => ({ ...s, freeLayout: removeFreeElements(s.freeLayout ?? [], ids) }));
    setSelectedFreeIds([]);
    setEditPopover(null);
  };
  // 整列・等間隔分布（#205）：選択要素の外接矩形を基準に位置を計算し、一括移動で反映。
  const alignFree = (mode: FreeAlign) =>
    patch((s) => ({ ...s, freeLayout: applyFreeElementPositions(s.freeLayout ?? [], alignFreeElements(s.freeLayout ?? [], selectedFreeIds, mode)) }));
  const distributeFree = (axis: FreeDistribute) =>
    patch((s) => ({ ...s, freeLayout: applyFreeElementPositions(s.freeLayout ?? [], distributeFreeElements(s.freeLayout ?? [], selectedFreeIds, axis)) }));
  // 複製：コピーを最前面に追加し、複製直後のコピーを選択状態にする（newId）。
  // 他ヘルパーと同様に updater 内の最新 s.freeLayout から計算する（前回レンダーの snapshot 参照を避ける）。
  // updateScene→set は同期実行のため、newId は下の setSelectedFreeIds より前に確実に代入される。
  const duplicateFreeEl = (id: string) => {
    let newId: string | null = null;
    patch((s) => {
      const result = duplicateFreeElement(s.freeLayout ?? [], id);
      newId = result.newId;
      return { ...s, freeLayout: result.freeLayout };
    });
    if (newId) setSelectedFreeIds([newId]);
  };
  // コピー：選んだ要素をクリップボードへ（場面をまたいで貼れる・#207）。
  const copyFreeEl = (id: string) => {
    const el = (selected.freeLayout ?? []).find((e) => e.id === id);
    if (el) setFreeClipboard(el);
  };
  // 貼り付け：クリップボードの要素を現在の場面へ（新 id 採番＝場面間も可）。貼付直後を選択。
  const pasteFreeEl = () => {
    if (!freeClipboard) return;
    let newId: string | null = null;
    patch((s) => {
      const result = pasteFreeElement(s.freeLayout ?? [], freeClipboard);
      newId = result.newId;
      return { ...s, freeLayout: result.freeLayout };
    });
    if (newId) setSelectedFreeIds([newId]);
  };
  const bringFreeElForward = (id: string) =>
    patch((s) => ({ ...s, freeLayout: bringFreeElementToFront(s.freeLayout ?? [], id) }));
  const sendFreeElBackward = (id: string) =>
    patch((s) => ({ ...s, freeLayout: sendFreeElementToBack(s.freeLayout ?? [], id) }));
  // レイヤー一覧（#210）：重ね順を1段移動・表示/ロックの切替（最新 s から計算）。
  const moveFreeElZ = (id: string, dir: "up" | "down") =>
    patch((s) => ({ ...s, freeLayout: moveFreeElementZ(s.freeLayout ?? [], id, dir) }));
  const toggleFreeHidden = (id: string) =>
    patch((s) => ({ ...s, freeLayout: (s.freeLayout ?? []).map((e) => (e.id === id ? { ...e, hidden: !e.hidden } : e)) }));
  const toggleFreeLocked = (id: string) =>
    patch((s) => ({ ...s, freeLayout: (s.freeLayout ?? []).map((e) => (e.id === id ? { ...e, locked: !e.locked } : e)) }));
  // 見た目パーツを一括展開し、追加した先頭要素を選択（所在を明示＝利便性・#175）。
  // updater 内で最新 s.freeLayout から計算（updateScene→set は同期実行で newIds は下の前に確定）。
  const addFreeComponent = (componentId: string) => {
    let newIds: string[] = [];
    patch((s) => {
      const result = addFreeComponentGroup(s.freeLayout ?? [], componentId);
      newIds = result.newIds;
      return { ...s, freeLayout: result.freeLayout };
    });
    if (newIds[0]) setSelectedFreeIds([newIds[0]]);
  };
  // 素材(Asset 単位)のクリップ設定を部分更新（FREE slot 動画の調整に使う。通常スロットと同じ Asset.clip）。
  const patchAssetClip = (assetId: string, p: Partial<NonNullable<Asset["clip"]>>) =>
    updateAsset(assetId, (a) => ({ ...a, clip: { ...a.clip, ...p } }));

  // FREE 要素の種別ごとの編集コントロール。右パネルのカードと、右クリック「編集」ポップオーバーで共用（DRY）。
  // 角の丸み（radius）は廃止（#185・図形種類を増やすため不要）。位置/サイズはカードのフッタとドラッグで扱う。
  const renderFreeKindControls = (el: FreeElement) => {
    if (el.kind === FREE_ELEMENT_KIND.slot) {
      const a = el.assetId ? assets.find((x) => x.assetId === el.assetId) : undefined;
      return (
        <div className="field" style={{ marginBottom: 6 }}>
          <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>素材</label>
          <select className="select" value={el.assetId ?? ""} onChange={(e) => patchFreeEl(el.id, { assetId: e.target.value || null })}>
            <option value="">なし（空の枠）</option>
            {freeSlotAssets.map((x) => (<option key={x.assetId} value={x.assetId}>{x.displayName}</option>))}
          </select>
          {a?.assetType === ASSET_TYPE.video && (
            <ClipDetailControls asset={a} patchClip={(p) => patchAssetClip(a.assetId, p)} />
          )}
        </div>
      );
    }
    if (el.kind === FREE_ELEMENT_KIND.text) {
      return (
        <>
          <div className="field" style={{ marginBottom: 6 }}>
            <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>文字</label>
            <input className="input" value={el.text ?? ""} onChange={(e) => patchFreeEl(el.id, { text: e.target.value })} />
          </div>
          <div className="row gap-sm" style={{ marginBottom: 6 }}>
            <NumberField label="文字の大きさ" value={el.fontSize ?? 48} min={1} onChange={(v) => patchFreeEl(el.id, { fontSize: v })} />
            <div className="field" style={{ margin: 0 }}>
              <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>色</label>
              <input type="color" value={el.color ?? "#222222"} onChange={(e) => patchFreeEl(el.id, { color: e.target.value })} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>太さ</label>
              <select className="select" value={el.fontWeight ?? FONT_WEIGHT.normal} onChange={(e) => patchFreeEl(el.id, { fontWeight: e.target.value as FontWeight })}>
                <option value={FONT_WEIGHT.normal}>標準</option>
                <option value={FONT_WEIGHT.bold}>太字</option>
              </select>
            </div>
          </div>
          <div className="field" style={{ marginBottom: 6 }}>
            <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>フォント</label>
            <FontPicker value={el.fontId} onChange={(id) => patchFreeEl(el.id, { fontId: id })} allowInherit />
          </div>
          {/* 体裁拡充（#209）：行間（倍率）・揃え・縁取り（縁取りは strokeColor/strokeWidth を text に流用）。 */}
          <div className="row gap-sm" style={{ marginBottom: 6, alignItems: "flex-end" }}>
            <NumberField label="行間" value={el.lineHeight ?? 1.3} min={0.5} max={3} step={0.1} onChange={(v) => patchFreeEl(el.id, { lineHeight: v })} />
            <div className="field" style={{ margin: 0 }}>
              <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>揃え</label>
              <select className="select" value={el.textAlign ?? TEXT_ALIGN.left} onChange={(e) => patchFreeEl(el.id, { textAlign: e.target.value as TextAlign })}>
                <option value={TEXT_ALIGN.left}>左</option>
                <option value={TEXT_ALIGN.center}>中央</option>
                <option value={TEXT_ALIGN.right}>右</option>
              </select>
            </div>
          </div>
          <div className="row gap-sm" style={{ marginBottom: 6, alignItems: "flex-end" }}>
            <NumberField label="縁取りの太さ" value={el.strokeWidth ?? 0} min={0} max={100} onChange={(v) => patchFreeEl(el.id, { strokeWidth: v })} />
            <div className="field" style={{ margin: 0 }}>
              <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>縁取りの色</label>
              <input type="color" value={el.strokeColor ?? "#000000"} onChange={(e) => patchFreeEl(el.id, { strokeColor: e.target.value })} />
            </div>
          </div>
        </>
      );
    }
    if (el.kind === FREE_ELEMENT_KIND.shape) {
      return (
        <>
          <div className="row gap-sm" style={{ marginBottom: 6 }}>
            <div className="field" style={{ flex: 1, margin: 0 }}>
              <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>形</label>
              <select className="select" value={el.shapeType ?? FREE_SHAPE_TYPE.rect} onChange={(e) => patchFreeEl(el.id, { shapeType: e.target.value as FreeShapeType })}>
                <option value={FREE_SHAPE_TYPE.rect}>四角</option>
                <option value={FREE_SHAPE_TYPE.rounded_rect}>角丸四角</option>
                <option value={FREE_SHAPE_TYPE.ellipse}>丸</option>
                <option value={FREE_SHAPE_TYPE.triangle}>三角</option>
                <option value={FREE_SHAPE_TYPE.star}>星</option>
                <option value={FREE_SHAPE_TYPE.arrow}>矢印</option>
                <option value={FREE_SHAPE_TYPE.speech_bubble}>吹き出し</option>
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>色</label>
              <input type="color" value={el.fillColor ?? "#cccccc"} onChange={(e) => patchFreeEl(el.id, { fillColor: e.target.value })} />
            </div>
          </div>
          <div className="field" style={{ marginBottom: 6 }}>
            <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>透明度</label>
            <input
              type="range" min={0} max={1} step={0.1} value={el.opacity ?? 1}
              onChange={(e) => patchFreeEl(el.id, { opacity: Number(e.target.value) })}
              // 注: スライダーは range のため pointerup を取りこぼすと履歴グループが開きっぱなしになりうる。
              // ドラッグ合成は確実な FREE オーバーレイ（pointer capture 有）に限定し、スライダーは各変更=1ステップとする（ADR-0020 未解決2・後続）。
              style={{ width: "100%", accentColor: "var(--color-primary)" }}
            />
          </div>
          <div className="row gap-sm" style={{ marginBottom: 6, alignItems: "flex-end" }}>
            <NumberField label="枠線の太さ" value={el.strokeWidth ?? 0} min={0} max={100} onChange={(v) => patchFreeEl(el.id, { strokeWidth: v })} />
            <div className="field" style={{ margin: 0 }}>
              <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>枠線の色</label>
              <input type="color" value={el.strokeColor ?? "#000000"} onChange={(e) => patchFreeEl(el.id, { strokeColor: e.target.value })} />
            </div>
          </div>
        </>
      );
    }
    return null;
  };
  // 右クリック「編集」：その要素の kind 別エディタをカーソル位置付近に開く（画面端でクランプ）。
  const openFreeEditPopover = (id: string, x: number, y: number) => {
    selectFree(id);
    setEditPopover({
      id,
      x: Math.max(8, Math.min(x, window.innerWidth - 300)),
      y: Math.max(8, Math.min(y, window.innerHeight - 320)),
    });
  };
  const editPopoverEl = editPopover ? freeLayout.find((e) => e.id === editPopover.id) ?? null : null;
  // 場面間トランジション（ADR-0009・T1）。境界 A→B は B（この場面）の transition.in が司る。
  // 先頭場面は切り替え元が無いので設定を出さない。書き出しへの反映は T2。
  const isFirstScene = scenes[0]?.sceneId === selected.sceneId;
  // select 値の導出は domain に集約（wipe/zoom→fade を resolveTransition と一致させる・観点4対応）。
  const transitionValue = deriveTransitionSelectValue(selected.transition);
  const onTransitionChange = (val: string) =>
    patch((s) => {
      if (val.startsWith("slide:")) {
        const direction = val.slice("slide:".length) as TransitionDirection;
        return { ...s, transition: { ...s.transition, in: TRANSITION_TYPE.slide, out: TRANSITION_TYPE.slide, direction } };
      }
      const type = val as TransitionType; // none | fade
      return { ...s, transition: { ...s.transition, in: type, out: type, direction: undefined } };
    });
  // 掛け合い（複数のセリフ）モードか。明示 lines があるとき＝ON（ADR-0015・#180）。
  const isDialogue = (selected.lines?.length ?? 0) > 0;
  // セリフ列の検証（V16-19）。開始秒の範囲/順序・話者の実在などをユーザー向け文言で案内（重複文言は1つに）。
  const lineWarningMessages = isDialogue
    ? [...new Set(validateSceneLines(selected.lines, selected.durationSec).map((w) => w.message))]
    : [];
  // 場面ごとの声の大きさ（null/未設定＝全体設定を継承 §6/§2.2、値＝この場面だけ上書き）。
  const sceneNarrationVolume = selected.audioMix?.narrationVolume ?? null;
  // 書き出しと同一ロジックで「全体設定の実効値」を出す（clamp 込み・ドメイン関数を単一の参照元に）。
  const projectNarrationVolume = resolveNarrationVolume(undefined, voiceSettings);
  // 場面の選択を切り替える（前の場面の削除確認は解除して持ち越さない）。
  const selectScene = (id: string) => {
    setSelectedId(id);
    setConfirmDelete(false);
    setConfirmDialogueOff(false); // 掛け合い解除の確認も場面ごとに持ち越さない
    setSelectedFreeIds([]); // 場面が変わったら自由配置の選択は持ち越さない
    setEditPopover(null); // 開いていた kind 別エディタも閉じる（旧場面の要素 id を指したまま残さない）
    setNarrationPlayError(false); // 前の場面の再生失敗表示を持ち越さない
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

  // セリフ音声の進捗（生成済み/対象）。全部できて生成中でなければ出さない（#176）。
  const { done: narrDone, total: narrTotal } = narrationProgress(scenes);
  const showNarrProgress = narrTotal > 0 && !(narrDone === narrTotal && !isGeneratingNarration);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div className="topbar" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <div className="topbar-title">場面編集</div>
        <div className="topbar-actions">
          {showNarrProgress && (
            <span className="text-sm text-muted" style={{ marginRight: 4 }}>
              声 {narrDone}/{narrTotal}{isGeneratingNarration ? "（準備中…）" : ""}
            </span>
          )}
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
              素材を追加
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
              <div style={{ position: "relative" }}>
                <ScenePreview scene={selected} template={template} />
                {/* FREE 場面：プレビュー上でドラッグ移動・角リサイズできる操作レイヤ（Phase 4b）。 */}
                {isFree && template && (
                  <FreeLayoutOverlay
                    freeLayout={freeLayout}
                    canvasW={template.canvas.width}
                    canvasH={template.canvas.height}
                    selectedIds={selectedFreeIds}
                    onSelect={selectFree}
                    onChange={(id, g) => patchFreeEl(id, g)}
                    onMoveMany={moveFreeMany}
                    gridSize={gridSnap ? FREE_GRID_SIZE : 0}
                    onDuplicate={duplicateFreeEl}
                    onBringToFront={bringFreeElForward}
                    onSendToBack={sendFreeElBackward}
                    onDelete={removeFreeEl}
                    onChangeText={(id, text) => patchFreeEl(id, { text })}
                    onRequestEdit={openFreeEditPopover}
                    onInteractionStart={beginHistoryGroup}
                    onInteractionEnd={endHistoryGroup}
                  />
                )}
                {editPopover && editPopoverEl && (
                  <>
                    {/* 外側クリックで閉じる透明バックドロップ。 */}
                    <div
                      style={{ position: "fixed", inset: 0, zIndex: 60 }}
                      onPointerDown={() => setEditPopover(null)}
                      onContextMenu={(e) => { e.preventDefault(); setEditPopover(null); }}
                    />
                    <div
                      role="dialog"
                      aria-label={`${freeKindLabel[editPopoverEl.kind]}を編集`}
                      style={{
                        position: "fixed", left: editPopover.x, top: editPopover.y, zIndex: 61,
                        width: 280, maxHeight: "70vh", overflow: "auto",
                        background: "#fff", color: "#222", border: "1px solid rgba(0,0,0,0.15)",
                        borderRadius: 10, boxShadow: "0 8px 28px rgba(0,0,0,0.2)", padding: 12,
                      }}
                    >
                      <div className="row-between" style={{ marginBottom: 8 }}>
                        <strong className="text-sm">{freeKindLabel[editPopoverEl.kind]}を編集</strong>
                        <button
                          className="btn btn-ghost text-sm"
                          onClick={() => setEditPopover(null)}
                          aria-label="編集を閉じる"
                        >
                          閉じる
                        </button>
                      </div>
                      {renderFreeKindControls(editPopoverEl)}
                    </div>
                  </>
                )}
              </div>
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
            <div className="row-between" style={{ alignItems: "center" }}>
              <h2 className="field-label" style={{ margin: 0 }}>選択中の場面を編集</h2>
              {/* 取り消し/やり直し（#211・ADR-0020）。Ctrl/⌘+Z・Ctrl+Y でも操作可。 */}
              <div className="row gap-sm">
                <button className="btn btn-ghost btn-icon text-sm" onClick={undo} disabled={!canUndo} aria-label="取り消す" title="取り消す（Ctrl+Z）">↶ 取り消す</button>
                <button className="btn btn-ghost btn-icon text-sm" onClick={redo} disabled={!canRedo} aria-label="やり直す" title="やり直す（Ctrl+Y）">↷ やり直す</button>
              </div>
            </div>

            {/* 簡易/詳細トグル（ADR-0007 M-A：同一画面・同一データ）。オンで細かい調整を表示。 */}
            <div className="toggle-row">
              <span className="field-label" style={{ margin: 0 }}>詳細編集</span>
              <Switch on={showAdvanced} onChange={setShowAdvanced} label="詳細編集" />
            </div>
            <p className="field-hint" style={{ marginTop: 0 }}>
              {isFree
                ? "オンにすると、画面の切り替えなどを表示します。（自由配置の調整は下の「自由配置」で行えます）"
                : "オンにすると、動画素材の細かい調整や画面の切り替えなどを表示します。"}
            </p>

            {/* FREE 場面は文字を「自由配置」で置くため、ここのテキスト欄は出さない（§2-4）。 */}
            {/* 非FREEのテキスト欄は、選択テンプレが実際に使うテキスト種別だけ生成する（#214 ④b）。 */}
            {/* 文字レイヤーを持たないテンプレ（画像・動画中心など）では欄ゼロになるため、その旨を明示する（ℹ️ PR#235）。 */}
            {!isFree && sceneTextKeys.length === 0 && (
              <p className="field-hint" style={{ marginTop: 0 }}>このテンプレートは文字を表示しません。</p>
            )}
            {!isFree &&
              sceneTextKeys.map((key) => {
                // 見出し・URL は1行、本文・字幕・キャプションは複数行で編集する。
                const multiline = key !== TEXT_KEY.title && key !== TEXT_KEY.url;
                return (
                  <div className="field" key={key}>
                    <label className="field-label" htmlFor={`text-${key}`}>{textKeyLabel[key]}</label>
                    {multiline ? (
                      <textarea
                        id={`text-${key}`}
                        className="textarea"
                        value={selected.texts[key] ?? ""}
                        onChange={(e) => patch((s) => ({ ...s, texts: { ...s.texts, [key]: e.target.value } }))}
                        style={{ minHeight: 60 }}
                      />
                    ) : (
                      <input
                        id={`text-${key}`}
                        className="input"
                        value={selected.texts[key] ?? ""}
                        onChange={(e) => patch((s) => ({ ...s, texts: { ...s.texts, [key]: e.target.value } }))}
                      />
                    )}
                    <div className="field" style={{ marginTop: 6 }}>
                      <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>{textKeyLabel[key]}のフォント</label>
                      <FontPicker value={selected.textFontIds?.[key]} onChange={(id) => setSceneTextFont(key, id)} allowInherit />
                    </div>
                  </div>
                );
              })}

            <div className="field">
              <label className="field-label" htmlFor="look">見た目パターン</label>
              <select
                id="look"
                className="select"
                value={selected.templateId}
                onChange={(e) => {
                  const newTemplateId = e.target.value;
                  // 切替時：assetRefs は新テンプレのスロットへ清算／texts・textFontIds は保持（#236・switchSceneTemplate 参照）。
                  const newLayers = templates.find((t) => t.templateId === newTemplateId)?.layers ?? [];
                  patch((s) => switchSceneTemplate(s, newTemplateId, newLayers));
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
              <label className="field-label">フォント（動画全体）</label>
              <FontPicker value={fontId} onChange={(id) => id && setFontId(id)} />
              <p className="field-hint" style={{ marginTop: 4 }}>動画全体の文字に使うフォントです（個別に設定していない場面に反映されます）。</p>
            </div>

            <div className="field">
              <label className="field-label">この場面のフォント</label>
              <FontPicker value={selected.fontId} onChange={(id) => patch((s) => ({ ...s, fontId: id }))} allowInherit />
              <p className="field-hint" style={{ marginTop: 4 }}>この場面だけ別のフォントにできます（「動画全体に合わせる」で全体の設定を使います）。</p>
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
                  // クリップ設定（asset.clip）を部分更新する。clip は Asset 単位（正典 11/$defs/Clip）。詳細UIは ClipDetailControls。
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
                        <ClipDetailControls asset={assignedAsset} patchClip={patchClip} />
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
                  素材・文字・図形を追加し、プレビュー上でドラッグして動かす・角をつまんで大きさを変える、または数字で調整できます。
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
                  <button
                    className="btn btn-ghost btn-icon text-sm"
                    onClick={pasteFreeEl}
                    disabled={!freeClipboard}
                    title={freeClipboard
                      ? `「${freeKindLabel[freeClipboard.kind]}」を貼り付け（別の場面からでも貼れます）`
                      : "先に配置を「コピー」すると貼り付けられます"}
                  >
                    {freeClipboard ? `貼り付け（${freeKindLabel[freeClipboard.kind]}）` : "貼り付け"}
                  </button>
                </div>
                <div className="field" style={{ marginBottom: 8 }}>
                  <label className="field-label text-sm" style={{ margin: "0 0 4px" }}>見た目パーツ</label>
                  <div className="row gap-sm" style={{ flexWrap: "wrap" }}>
                    {FREE_COMPONENTS.map((c) => (
                      <button
                        key={c.id}
                        className="btn btn-secondary btn-icon text-sm"
                        onClick={() => addFreeComponent(c.id)}
                      >
                        <PlusIcon size={14} />{c.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="toggle-row">
                  <span className="field-label text-sm" style={{ margin: 0 }}>グリッドに合わせる</span>
                  <Switch on={gridSnap} onChange={setGridSnap} label="グリッドに合わせる" />
                </div>
                <div className="toggle-row">
                  <span className="field-label text-sm" style={{ margin: 0 }}>選択した要素だけ編集</span>
                  <Switch on={focusSelectedFree} onChange={setFocusSelectedFree} label="選択した要素だけ編集" />
                </div>
                {freeLayout.length === 0 ? (
                  <p className="text-sm text-muted">まだ何も配置されていません。上のボタンで追加してください。</p>
                ) : (
                  <div className="col gap-sm">
                    {/* レイヤー一覧（#210）：重ね順（上が手前）で並べ、選択・前面/背面・表示/隠す・ロックを操作。 */}
                    <div className="field" style={{ marginBottom: 4 }}>
                      <label className="field-label text-sm" style={{ margin: "0 0 4px" }}>重ね順（上が手前）</label>
                      <div className="col" style={{ gap: 2 }}>
                        {[...freeLayout].sort((a, b) => (b.zIndex ?? 1) - (a.zIndex ?? 1)).map((el) => {
                          const isSel = selectedFreeIds.includes(el.id);
                          const hint = el.kind === FREE_ELEMENT_KIND.text && el.text ? `「${el.text.slice(0, 8)}」` : "";
                          return (
                            <div
                              key={el.id}
                              className="row-between"
                              style={{ padding: "2px 6px", borderRadius: 4, background: isSel ? "rgba(80,130,255,0.12)" : "var(--color-surface-alt)", opacity: el.hidden ? 0.55 : 1 }}
                            >
                              <button
                                className="btn btn-ghost text-sm"
                                style={{ flex: 1, textAlign: "left", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                                onClick={(e) => selectFree(el.id, e.shiftKey)}
                                title="クリックで選択（Shift＋クリックで複数選択）"
                              >
                                {freeKindLabel[el.kind]}{hint}{el.locked ? "（ロック）" : ""}
                              </button>
                              <div className="row" style={{ gap: 2 }}>
                                <button className="btn btn-ghost btn-icon text-sm" title="前面へ" aria-label="前面へ" onClick={() => moveFreeElZ(el.id, "up")}>↑</button>
                                <button className="btn btn-ghost btn-icon text-sm" title="背面へ" aria-label="背面へ" onClick={() => moveFreeElZ(el.id, "down")}>↓</button>
                                <button className="btn btn-ghost btn-icon text-sm" title={el.hidden ? "表示する" : "隠す"} onClick={() => toggleFreeHidden(el.id)}>{el.hidden ? "表示" : "隠す"}</button>
                                <button className="btn btn-ghost btn-icon text-sm" title={el.locked ? "ロックを解除" : "ロックして固定"} onClick={() => toggleFreeLocked(el.id)}>{el.locked ? "解除" : "固定"}</button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    {/* 複数選択（#206）：2件以上選んだら一括操作バーを出す（Shift＋クリックで増減）。 */}
                    {selectedFreeIds.length >= 2 && (
                      <div className="col gap-sm" style={{ padding: "4px 8px", background: "var(--color-surface-alt)", borderRadius: 6 }}>
                        <div className="row-between">
                          {confirmBulkDelete ? (
                            <>
                              <span className="text-sm">{selectedFreeIds.length}件をまとめて削除しますか？</span>
                              <div className="row gap-sm">
                                <button className="btn btn-ghost text-sm" onClick={() => setConfirmBulkDelete(false)}>やめる</button>
                                <button
                                  className="btn btn-ghost text-sm"
                                  style={{ color: "var(--color-danger)" }}
                                  onClick={() => { removeFreeMany(selectedFreeIds); setConfirmBulkDelete(false); }}
                                >
                                  削除する
                                </button>
                              </div>
                            </>
                          ) : (
                            <>
                              <span className="text-sm">{selectedFreeIds.length}件を選択中（Shift＋クリックで増減）</span>
                              <div className="row gap-sm">
                                <button className="btn btn-ghost text-sm" onClick={() => { setSelectedFreeIds([]); setEditPopover(null); }}>選択解除</button>
                                <button
                                  className="btn btn-ghost text-sm"
                                  style={{ color: "var(--color-danger)" }}
                                  onClick={() => setConfirmBulkDelete(true)}
                                >
                                  選択をまとめて削除
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                        {/* 整列・等間隔分布（#205）。選択した要素の外接矩形を基準にそろえる。等間隔は3件以上で有効。 */}
                        {!confirmBulkDelete && (
                          <div className="row gap-sm" style={{ flexWrap: "wrap", alignItems: "center" }}>
                            <span className="text-sm text-muted">左右:</span>
                            <button className="btn btn-ghost text-sm" onClick={() => alignFree(FREE_ALIGN.left)}>左</button>
                            <button className="btn btn-ghost text-sm" onClick={() => alignFree(FREE_ALIGN.centerX)}>中央</button>
                            <button className="btn btn-ghost text-sm" onClick={() => alignFree(FREE_ALIGN.right)}>右</button>
                            <span className="text-sm text-muted" style={{ marginLeft: 6 }}>上下:</span>
                            <button className="btn btn-ghost text-sm" onClick={() => alignFree(FREE_ALIGN.top)}>上</button>
                            <button className="btn btn-ghost text-sm" onClick={() => alignFree(FREE_ALIGN.centerY)}>中央</button>
                            <button className="btn btn-ghost text-sm" onClick={() => alignFree(FREE_ALIGN.bottom)}>下</button>
                            <span className="text-sm text-muted" style={{ marginLeft: 6 }}>等間隔:</span>
                            <button
                              className="btn btn-ghost text-sm"
                              disabled={selectedFreeIds.length < 3}
                              title={selectedFreeIds.length < 3 ? "3つ以上選ぶと等間隔に並べられます" : "横に等間隔で並べる"}
                              onClick={() => distributeFree(FREE_DISTRIBUTE.horizontal)}
                            >
                              横
                            </button>
                            <button
                              className="btn btn-ghost text-sm"
                              disabled={selectedFreeIds.length < 3}
                              title={selectedFreeIds.length < 3 ? "3つ以上選ぶと等間隔に並べられます" : "縦に等間隔で並べる"}
                              onClick={() => distributeFree(FREE_DISTRIBUTE.vertical)}
                            >
                              縦
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    {/* 詳細編集モード：選択要素を切り替えるチップ（カード一覧を長くスクロールせず選べる・#179）。 */}
                    {focusSelectedFree && (
                      <div className="row gap-sm" style={{ flexWrap: "wrap" }}>
                        {freeLayout.map((el, i) => (
                          <button
                            key={el.id}
                            className="btn btn-ghost text-sm"
                            style={{ outline: el.id === selectedFreeId ? "2px solid var(--color-primary)" : undefined }}
                            onClick={() => selectFree(el.id)}
                            aria-pressed={el.id === selectedFreeId}
                          >
                            {freeKindLabel[el.kind]}{i + 1}
                          </button>
                        ))}
                      </div>
                    )}
                    {focusSelectedFree && !freeLayout.some((el) => el.id === selectedFreeId) && (
                      <p className="text-sm text-muted">編集する要素を、上のボタンかプレビューで選んでください。</p>
                    )}
                    {/* 各フィールドの ?? 既定値は型安全のための保険（FreeElement の各フィールドは optional）。
                        正式な既定は domain の createFreeElement が必ず埋めるため通常は発動しない。 */}
                    {(focusSelectedFree
                      ? freeLayout.filter((el) => el.id === selectedFreeId)
                      : freeLayout
                    ).map((el) => (
                      <div
                        key={el.id}
                        className="card-tight"
                        onClick={(e) => {
                          // フォーム要素（数値入力の Shift 範囲選択など）では Shift トグルを発火させない（誤って選択が増減しないように）。
                          const tag = (e.target as HTMLElement).tagName;
                          const isField = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
                          selectFree(el.id, e.shiftKey && !isField);
                        }}
                        style={{
                          background: "var(--color-surface-alt)",
                          outline: el.id === selectedFreeId ? "2px solid var(--color-primary)" : undefined,
                          opacity: el.hidden ? 0.6 : 1, // 非表示要素は淡色（重ね順パネルと一貫＝プレビューに出ていないと分かる）
                        }}
                      >
                        <div className="row-between" style={{ marginBottom: 4 }}>
                          <strong className="text-sm">{freeKindLabel[el.kind]}{el.hidden ? "（非表示）" : ""}</strong>
                          <div className="row gap-sm">
                            <button
                              className="btn btn-ghost text-sm"
                              onClick={(e) => { e.stopPropagation(); copyFreeEl(el.id); }}
                              aria-label="この配置をコピー"
                            >
                              コピー
                            </button>
                            <button
                              className="btn btn-ghost text-sm"
                              onClick={(e) => { e.stopPropagation(); duplicateFreeEl(el.id); }}
                              aria-label="この配置を複製"
                            >
                              複製
                            </button>
                            <button
                              className="btn btn-ghost text-sm"
                              onClick={(e) => { e.stopPropagation(); bringFreeElForward(el.id); }}
                              aria-label="前面へ移動"
                            >
                              前面
                            </button>
                            <button
                              className="btn btn-ghost text-sm"
                              onClick={(e) => { e.stopPropagation(); sendFreeElBackward(el.id); }}
                              aria-label="背面へ移動"
                            >
                              背面
                            </button>
                            <button
                              className="btn btn-ghost btn-icon text-sm"
                              style={{ color: "var(--color-danger)" }}
                              onClick={(e) => { e.stopPropagation(); removeFreeEl(el.id); }}
                              aria-label="この配置を削除"
                            >
                              <TrashIcon size={14} />
                            </button>
                          </div>
                        </div>

                        {renderFreeKindControls(el)}

                        <div className="row gap-sm" style={{ marginBottom: 4 }}>
                          <NumberField label="横位置" value={el.x} onChange={(v) => patchFreeEl(el.id, { x: v })} />
                          <NumberField label="縦位置" value={el.y} onChange={(v) => patchFreeEl(el.id, { y: v })} />
                        </div>
                        <div className="row gap-sm">
                          <NumberField label="幅" value={el.w} min={1} onChange={(v) => patchFreeEl(el.id, { w: v })} />
                          <NumberField label="高さ" value={el.h} min={1} onChange={(v) => patchFreeEl(el.id, { h: v })} />
                          <NumberField label="重なり順" value={el.zIndex ?? 1} min={0} onChange={(v) => patchFreeEl(el.id, { zIndex: v })} />
                          {/* 角度（回転・度）。0〜359（360=0 は重複ゆえ schema で除外）。回転中は角つまみでの拡大縮小が止まるため、大きさはこの数値で調整する（#208）。 */}
                          <NumberField label="角度" value={el.rotation ?? 0} min={0} max={359} onChange={(v) => patchFreeEl(el.id, { rotation: v })} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="field">
              <div className="toggle-row">
                <span className="field-label" style={{ margin: 0 }}>掛け合い（複数のセリフ）</span>
                <Switch
                  on={isDialogue}
                  onChange={(on) => {
                    // 掛け合いをやめる時に2つ目以降のセリフが消えるので、複数あるときはインライン確認を出す（誤操作防止）。
                    if (!on && (selected.lines?.length ?? 0) > 1) { setConfirmDialogueOff(true); return; }
                    patch(on ? promoteToLines : demoteFromLines);
                  }}
                  label="掛け合い（複数のセリフ）"
                />
              </div>
              {confirmDialogueOff && (
                <div className="notice notice-warn" role="alert" style={{ marginTop: 6 }}>
                  <span>掛け合いをやめると、2つ目以降のセリフは消えます。</span>
                  <div className="row gap-sm" style={{ marginTop: 6 }}>
                    <button
                      className="btn btn-danger text-sm"
                      onClick={() => { patch(demoteFromLines); setConfirmDialogueOff(false); }}
                    >
                      掛け合いをやめる
                    </button>
                    <button className="btn btn-ghost text-sm" onClick={() => setConfirmDialogueOff(false)}>
                      キャンセル
                    </button>
                  </div>
                </div>
              )}
              {isDialogue ? (
                <div className="col gap-sm" style={{ marginTop: 8 }}>
                  {(selected.lines ?? []).map((line, i) => {
                    const lineAudio = narrationAudioById[lineAudioKey(selected.sceneId, line.lineId)];
                    const lastIdx = (selected.lines?.length ?? 1) - 1;
                    return (
                      <div key={line.lineId} className="card-tight col gap-sm">
                        <div className="row-between">
                          <span className="text-sm" style={{ fontWeight: 600 }}>セリフ {i + 1}</span>
                          <div className="row gap-sm">
                            <button className="btn btn-ghost btn-icon text-sm" title="上へ" disabled={i === 0} onClick={() => patch((s) => moveLine(s, line.lineId, -1))}>↑</button>
                            <button className="btn btn-ghost btn-icon text-sm" title="下へ" disabled={i === lastIdx} onClick={() => patch((s) => moveLine(s, line.lineId, 1))}>↓</button>
                            <button className="btn btn-ghost btn-icon text-sm" title="このセリフを削除" onClick={() => patch((s) => removeLine(s, line.lineId))}>削除</button>
                          </div>
                        </div>
                        <textarea
                          className="textarea"
                          rows={2}
                          placeholder="セリフを入力"
                          value={line.text}
                          onChange={(e) => patch((s) => updateLine(s, line.lineId, { text: e.target.value }))}
                        />
                        <div className="row gap-sm" style={{ alignItems: "center", flexWrap: "wrap" }}>
                          <span className="text-sm text-muted">声</span>
                          <select
                            className="select text-sm"
                            value={line.speaker ?? ""}
                            onChange={(e) => patch((s) => updateLine(s, line.lineId, { speaker: e.target.value ? Number(e.target.value) : null }))}
                          >
                            <option value="">動画全体の声に合わせる</option>
                            {VOICE_CATALOG.map((c) => (
                              <optgroup key={c.character} label={c.character}>
                                {c.styles.map((st) => (
                                  <option key={st.speaker} value={st.speaker}>{c.character}（{st.label}）</option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        </div>
                        <details>
                          <summary className="text-sm text-muted" style={{ cursor: "pointer", padding: "2px 0" }}>声の調整（速さ・高さ・抑揚）</summary>
                          <LineVoiceParam
                            label="話す速さ" range={SPEED_RANGE} value={line.speed} lowLabel="ゆっくり" highLabel="はやい"
                            onChange={(v) => patch((s) => updateLine(s, line.lineId, { speed: v }))}
                            onReset={() => patch((s) => updateLine(s, line.lineId, { speed: null }))}
                          />
                          <LineVoiceParam
                            label="声の高さ" range={PITCH_RANGE} value={line.pitch} lowLabel="ひくい" highLabel="たかい"
                            onChange={(v) => patch((s) => updateLine(s, line.lineId, { pitch: v }))}
                            onReset={() => patch((s) => updateLine(s, line.lineId, { pitch: null }))}
                          />
                          <LineVoiceParam
                            label="抑揚" range={INTONATION_RANGE} value={line.intonation} lowLabel="おだやか" highLabel="ゆたか"
                            onChange={(v) => patch((s) => updateLine(s, line.lineId, { intonation: v }))}
                            onReset={() => patch((s) => updateLine(s, line.lineId, { intonation: null }))}
                          />
                        </details>
                        <div className="toggle-row">
                          <span className="text-sm text-muted">字幕を表示する</span>
                          <Switch
                            on={line.subtitleEnabled ?? selected.subtitleEnabledDefault ?? true}
                            onChange={(on) => patch((s) => updateLine(s, line.lineId, { subtitleEnabled: on }))}
                            label="字幕を表示する"
                          />
                        </div>
                        <input
                          className="input text-sm"
                          placeholder="字幕（未入力ならセリフをそのまま表示）"
                          value={line.subtitleText ?? ""}
                          onChange={(e) => patch((s) => updateLine(s, line.lineId, { subtitleText: e.target.value ? e.target.value : null }))}
                        />
                        <div className="row gap-sm" style={{ alignItems: "center", flexWrap: "wrap" }}>
                          <span className="text-sm text-muted">開始</span>
                          <input
                            className="input text-sm"
                            type="number"
                            min={0}
                            max={selected.durationSec}
                            step={0.1}
                            style={{ width: 90 }}
                            placeholder="自動"
                            value={line.startSec ?? ""}
                            // 空欄＝自動（undefined）。値ありは [0, 場面尺] にクランプして保存（範囲外を残さない＝V17 を満たす）。
                            onChange={(e) => patch((s) => updateLine(s, line.lineId, { startSec: e.target.value === "" ? undefined : Math.min(selected.durationSec, Math.max(0, Number(e.target.value))) }))}
                          />
                          <span className="text-sm text-muted">秒（空欄＝順番に自動）</span>
                        </div>
                        <div className="row-between">
                          <span className="text-sm text-muted">音声：{narrationStatusLabel[line.status] ?? line.status}</span>
                          {lineAudio && (
                            <button
                              className="btn btn-ghost btn-icon text-sm"
                              onClick={() => { setNarrationPlayError(false); void new Audio(lineAudio).play().catch(() => setNarrationPlayError(true)); }}
                            >
                              ▶ 再生
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <button className="btn btn-ghost text-sm" onClick={() => patch(addLine)}>＋ セリフを追加</button>
                  {lineWarningMessages.length > 0 && (
                    <div className="notice notice-warn" role="alert">
                      {lineWarningMessages.map((m) => <div key={m} className="text-sm">{m}</div>)}
                    </div>
                  )}
                  <div className="row-between" style={{ marginTop: 4 }}>
                    <span className="text-sm" style={{ color: "var(--color-danger)" }}>
                      {narrationPlayError ? "再生できませんでした。声を作り直してお試しください" : ""}
                    </span>
                    <button
                      className="btn btn-secondary btn-icon text-sm"
                      onClick={() => { setNarrationPlayError(false); void generateNarration(selected.sceneId); }}
                      disabled={isGeneratingNarration || (selected.lines ?? []).every((l) => l.text.trim().length === 0)}
                    >
                      全部のセリフの声を作成
                    </button>
                  </div>
                  {narrationError && (
                    <div className="notice notice-warn" role="alert"><span>{narrationError}</span></div>
                  )}
                  <p className="field-hint">セリフごとに声（キャラクター）を変えて掛け合いにできます。字幕は経過に合わせて切り替わります。</p>
                </div>
              ) : (<>
              <label className="field-label" htmlFor="line">セリフ</label>
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
                  {narrationPlayError && (
                    <span style={{ color: "var(--color-danger)" }}> ／ 再生できませんでした。声を作り直してお試しください</span>
                  )}
                </span>
                <div className="row gap-sm">
                  {narrationAudioById[selected.sceneId] && (
                    <button
                      className="btn btn-ghost btn-icon text-sm"
                      onClick={() => {
                        setNarrationPlayError(false);
                        void new Audio(narrationAudioById[selected.sceneId])
                          .play()
                          .catch(() => setNarrationPlayError(true));
                      }}
                    >
                      ▶ 再生
                    </button>
                  )}
                  <button
                    className="btn btn-secondary btn-icon text-sm"
                    onClick={() => { setNarrationPlayError(false); void generateNarration(selected.sceneId); }}
                    disabled={selected.narration.status === NARRATION_STATUS.pending || selected.narration.text.trim().length === 0 || isGeneratingNarration}
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
              <p className="field-hint">起動直後は読み上げ音声の準備に少し時間がかかることがあります。うまくいかないときは、少し待ってからもう一度お試しください。</p>
              {selected.narration.status === NARRATION_STATUS.failed && narrationError && (
                <div className="notice notice-warn" role="alert" style={{ marginTop: 6 }}>
                  <span>{narrationError}</span>
                </div>
              )}
              </>)}
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

            {/* 画面の切り替えなどの詳細は、上の「詳細編集」トグル（showAdvanced）で表示する。 */}
            {showAdvanced && (
              <div className="card-tight" style={{ background: "var(--color-surface-alt)", marginTop: "var(--gap-sm)" }}>
                <div className="field">
                  <label className="field-label" htmlFor="transition">画面の切り替え</label>
                  {isFirstScene ? (
                    <p className="field-hint" style={{ marginTop: 0 }}>
                      最初の場面のため、前からの切り替えはありません。
                    </p>
                  ) : (
                    <>
                      <select
                        id="transition"
                        className="select"
                        value={transitionValue}
                        onChange={(e) => onTransitionChange(e.target.value)}
                      >
                        <option value={TRANSITION_TYPE.none}>なし</option>
                        <option value={TRANSITION_TYPE.fade}>フェード</option>
                        <option value={`slide:${TRANSITION_DIRECTION.left}`}>スライド（左へ）</option>
                        <option value={`slide:${TRANSITION_DIRECTION.right}`}>スライド（右へ）</option>
                        <option value={`slide:${TRANSITION_DIRECTION.up}`}>スライド（上へ）</option>
                        <option value={`slide:${TRANSITION_DIRECTION.down}`}>スライド（下へ）</option>
                      </select>
                      <p className="field-hint">
                        ※ 仕上がり確認では動きませんが、書き出すと切り替わります。
                      </p>
                    </>
                  )}
                </div>
                <p className="field-hint">
                  動画の収め方・使う範囲・元の音声は、上の「使用素材」で動画を選ぶと設定できます。声の大きさは「セリフ」で場面ごとに変えられます。
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
