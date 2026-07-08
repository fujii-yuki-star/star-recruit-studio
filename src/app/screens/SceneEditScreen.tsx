import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { ScreenId } from "../data/mockData";
import type { Asset, FreeElement, Scene } from "../../domain/project/types";
import type { Layer } from "../../domain/template/types";
import { usedTextKeys } from "../../domain/template/layerOps";
import { ASSET_TYPE, EASING, FIT, FONT_WEIGHT, FREE_CATEGORY, FREE_ELEMENT_KIND, FREE_SHAPE_TYPE, NARRATION_STATUS, SLOT_TYPE, TEXT_ALIGN, TEXT_KEY, TRANSITION_DIRECTION, TRANSITION_TYPE, type Easing, type FontWeight, type FreeElementKind, type FreeShapeType, type TextAlign, type TextKey, type TransitionDirection, type TransitionType } from "../../domain/enums";
import { BGM_VOLUME, SCENE_MAX_DURATION_SEC, SCENE_MIN_DURATION_SEC, VOLUME_MAX, VOLUME_MIN, VOLUME_STEP } from "../../domain/constants";
import { BGM_CATALOG } from "../../domain/bgm/bgmCatalog";
import type { BundledBgmId } from "../../domain/bgm/bgmCatalog";
import { addFreeElement, applyFreeElementGeoms, applyFreeElementPositions, bringFreeElementToFront, duplicateFreeElement, type FreeElementGeom, FREE_GRID_SIZE, moveFreeElementZ, pasteFreeElement, removeFreeElement, removeFreeElements, sendFreeElementToBack, updateFreeElement } from "../../domain/project/freeLayoutOps";
import { alignFreeElements, distributeFreeElements, FREE_ALIGN, FREE_DISTRIBUTE, type FreeAlign, type FreeDistribute } from "../../domain/project/freeAlign";
import { createGroupFromSelection, groupElementIds, removeMembersFromGroups, reorderGroupZ, toggleGroupFlag, topGroupOfMember, ungroupGroup, updateGroupTransform } from "../../domain/project/groupOps";
import type { GroupTransform } from "../../domain/group/types";
import { addFreeComponentGroup, FREE_COMPONENTS } from "../../domain/project/freeComponents";
import { presetKeyframes, describeAnimation, withEndOpacity, PRESET_KINDS, SLIDE_DIRECTIONS, PRESET_DEFAULT_SEC, PRESET_MIN_SEC, PRESET_MAX_SEC, type PresetKind, type SlideDirection } from "../../domain/project/animationPresets";
import { deriveTransitionSelectValue } from "../../domain/project/sceneTransitions";
import { switchSceneTemplate } from "../../domain/project/sceneOps";
import { clampSceneDuration } from "../../domain/project/sceneDuration";
import { pickableTemplatesForScene } from "../../domain/template/templateSelection";
import { resolveNarrationVolume } from "../../domain/voice/audioMix";
import { narrationProgress } from "../../domain/voice/narrationProgress";
import { lineAudioKey, validateSceneLines } from "../../domain/project/narrationLines";
import { addLine, demoteFromLines, moveLine, promoteToLines, removeLine, updateLine } from "../../domain/project/lineEditOps";
import { VOICE_CATALOG } from "../../domain/voice/voiceCatalog";
import { SPEED_RANGE, PITCH_RANGE, INTONATION_RANGE, sliderToValue, valueToSlider, type ParamRange } from "../../domain/voice/voiceParams";
import { useProjectStore } from "../store/projectStore";
import { useUndoRedoShortcuts } from "../hooks/useUndoRedoShortcuts";
import { useAudioPreview } from "../hooks/useAudioPreview";
import { useSceneMotionPreview } from "../hooks/useSceneMotionPreview";
import { useDragReorder } from "../hooks/useDragReorder";
import { ProjectNameField } from "../components/ProjectNameField";
import { isTauri } from "../../infrastructure/assetFs";
import { showOpenAssetDialog } from "../../infrastructure/dialog";
import { ScenePreview } from "../components/ScenePreview";
import { SaveStatusBadge } from "../components/SaveStatusBadge";
import { FontPicker } from "../components/FontPicker";
import { textKeyLabel } from "../uiLabels";
import type { FontId } from "../../domain/font/fontCatalog";
import { FreeLayoutOverlay } from "../components/FreeLayoutOverlay";
import { ClipDetailControls } from "../components/ClipDetailControls";
import { FitSelect } from "../components/FitSelect";
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
  PlayIcon,
  StopIcon,
} from "../components/icons";

interface SceneEditProps {
  onNavigate: (screen: ScreenId) => void;
}

type AssetFilter = "all" | "image" | "video" | "bgm";

// 場面編集パネルのレイアウト設定（#276）。左パネルは折りたたみ、右パネルは横幅をドラッグで調整（localStorage に保存）。
const RIGHT_MIN_WIDTH = 260;
const RIGHT_MAX_WIDTH = 560;
const LEFT_WIDTH = 240;
const LEFT_COLLAPSED_WIDTH = 44;
const LS_RIGHT_WIDTH = "sceneEdit.rightWidth";
const LS_LEFT_COLLAPSED = "sceneEdit.leftCollapsed";
function loadRightWidth(): number {
  try {
    const v = Number(localStorage.getItem(LS_RIGHT_WIDTH));
    return v >= RIGHT_MIN_WIDTH && v <= RIGHT_MAX_WIDTH ? v : 300;
  } catch { return 300; }
}
function loadLeftCollapsed(): boolean {
  try { return localStorage.getItem(LS_LEFT_COLLAPSED) === "1"; } catch { return false; }
}

// 場面編集の右欄の節を開閉できるアコーディオン（#276）。details/summary ベース。
// 内部 state を持つので親（SceneEditScreen）の再描画でも開閉が保たれる（モジュール定義＝再マウントしない）。
function CollapsibleSection({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details className="accordion" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="accordion-summary">{title}</summary>
      <div className="accordion-body">{children}</div>
    </details>
  );
}

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

/** 音声状態の表示文言。未知値（将来値・壊れた保存データ・移行漏れ）は生の英語 enum を出さず「不明」に落とす（§2-3・#387）。 */
function narrationStatusText(status: string): string {
  return narrationStatusLabel[status] ?? "不明";
}

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
    status, scenes, templates, assets, autoGenerateIfSafe, updateScene, updateAsset, addAsset, addAssetByPath, importError, clearImportError,
    addScene, removeScene, duplicateScene, splitScene, splitSceneAtLine, moveSceneToIndex, saveProject, saveStatus,
    generateNarration, generateAllNarrations, isGeneratingNarration, narrationAudioById, narrationError,
    undo, redo, beginHistoryGroup, endHistoryGroup,
    addAnimation, updateAnimation, removeAnimation, removeAnimationsForElements,
  } = useProjectStore();
  // 要素アニメーション（④・ADR-0019）：この場面の FREE 要素に付いた簡易アニメ（timelineOverlay.animations）。
  const timelineOverlay = useProjectStore((s) => s.meta.timelineOverlay);
  const voiceSettings = useProjectStore((s) => s.meta.voiceSettings);
  const fontId = useProjectStore((s) => s.meta.videoSettings.fontId);
  const setFontId = useProjectStore((s) => s.setFontId);
  // プロジェクトの向き（ADR-0012）。見た目ピッカーを場面カテゴリ＋この向きに絞る（#415）。
  const aspectRatio = useProjectStore((s) => s.meta.videoSettings.aspectRatio);
  const projectBgm = useProjectStore((s) => s.meta.bgmSettings);
  // 場面カード列のドラッグ&ドロップ並び替え（#398）。カード自身を持ち手＋落下先にする（クリックで選択・ドラッグで並び替え）。
  const sceneDnd = useDragReorder(moveSceneToIndex);
  // Undo/Redo の可否（#211・ADR-0020）。past/future の有無から導出（派生＝余分な state を持たない）。
  const canUndo = useProjectStore((s) => s.past.length > 0);
  const canRedo = useProjectStore((s) => s.future.length > 0);

  const [filter, setFilter] = useState<AssetFilter>("all");
  const [search, setSearch] = useState("");
  // 遷移元（たたき台の行・仕上がり確認等）が指定した場面で開く（#400・onNavigate はペイロードを運べないため store 経由）。
  // 「一度きりのペイロード」：初期化子で読み（render 中＝下の破棄 effect より前に評価されるので必ず値を捕捉）、
  // マウント直後に破棄する。破棄しないと、この後 editingSceneId を set しない別導線（たたき台の主要CTA・
  // タイムライン/公開前チェックの「場面を直す」）で残留値が誤採用される（#400 レビュー）。null/不在は先頭場面へ。
  // subscribe せず getState で読む＝破棄時の再描画を避ける（selectedId は state 保持されるので消えない）。
  const [selectedId, setSelectedId] = useState(() => useProjectStore.getState().editingSceneId ?? "");
  // 表示時間は編集中だけローカルドラフト（どの場面のか＝sceneId 付き）で持ち、store には blur で clamp 済みの有効値だけ commit する。
  // ＝入力途中の範囲外値（1/2/16 等）が自動保存（useAutoSave）や書き出し前保存で保存されるのを防ぐ（#411 P1）。
  // sceneId を持つことで、場面を切り替えたら（sceneId 不一致で）自動的にドラフトが無効化される（effect 不要・別場面の値を見せない）。
  const [durationDraft, setDurationDraft] = useState<{ sceneId: string; value: string } | null>(null);
  // セリフ入力欄の参照（分割のカーソル位置を読む）。
  const lineRef = useRef<HTMLTextAreaElement>(null);
  // 場面編集レイアウト（#276）：左パネル折りたたみ・右パネル横幅。localStorage に保存して再訪時も維持。
  const [leftCollapsed, setLeftCollapsed] = useState(loadLeftCollapsed);
  const [rightWidth, setRightWidth] = useState(loadRightWidth);
  const resizeRef = useRef<{ startX: number; startW: number; latest: number } | null>(null);
  useEffect(() => { try { localStorage.setItem(LS_LEFT_COLLAPSED, leftCollapsed ? "1" : "0"); } catch { /* noop */ } }, [leftCollapsed]);
  // 右幅はドラッグ終了時にだけ保存する（毎フレーム書き込みを避けるため effect 依存にはしない・下の onResizeEnd）。
  // 右パネルの境界をドラッグして幅を変える（左へドラッグ＝広がる）。pointer capture で枠外まで追従。
  const onResizeDown = (e: ReactPointerEvent) => {
    e.preventDefault();
    resizeRef.current = { startX: e.clientX, startW: rightWidth, latest: rightWidth };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* noop */ }
  };
  const onResizeMove = (e: ReactPointerEvent) => {
    if (!resizeRef.current) return;
    const delta = resizeRef.current.startX - e.clientX;
    const w = Math.min(RIGHT_MAX_WIDTH, Math.max(RIGHT_MIN_WIDTH, resizeRef.current.startW + delta));
    resizeRef.current.latest = w; // 最新値を ref に保持（保存は終了時・closure の遅延に依存しない）
    setRightWidth(w);
  };
  const onResizeEnd = () => {
    const w = resizeRef.current?.latest;
    resizeRef.current = null;
    if (w == null) return; // ドラッグしていない/キャンセルでは保存しない
    // 幅は終了時にだけ保存（ドラッグ中の毎フレーム localStorage 書き込み＝メインスレッド I/O を避ける・PR#285レビュー）。
    try { localStorage.setItem(LS_RIGHT_WIDTH, String(w)); } catch { /* noop */ }
  };
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
  // 選択中のグループ id（ADR-0022・#305）。要素選択とは排他＝片方を選ぶともう片方は解除する。
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  // 選択変更：additive（Shift+クリック）で選択トグル、通常はその要素だけ、null で全解除。選択が変われば一括削除の確認は取り消す。
  const selectFree = (id: string | null, additive = false) => {
    setConfirmBulkDelete(false);
    setActiveGroupId(null); // 要素選択はグループ選択を解除
    if (id == null) { setSelectedFreeIds([]); return; }
    setSelectedFreeIds((cur) =>
      additive ? (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]) : [id],
    );
  };
  // 範囲選択（マーキー・#274）：交差した要素集合をまとめて選択にする。
  const selectFreeMany = (ids: string[]) => {
    setConfirmBulkDelete(false);
    setActiveGroupId(null);
    setSelectedFreeIds(ids);
  };
  // グループ選択（メンバークリック・#305）：要素選択をクリアしてグループをアクティブにする。
  const selectGroup = (groupId: string | null) => {
    setConfirmBulkDelete(false);
    setSelectedFreeIds([]);
    setActiveGroupId(groupId);
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
  // 試し聞きの再生制御（#388）：投げっぱなしにせず、画面遷移で停止・連打で重ならない・再生中は「停止」表示。
  const audioPreview = useAudioPreview();

  useEffect(() => {
    void autoGenerateIfSafe(); // 自動生成は Mock（外部送信なし）のときだけ（#384・§2-6）。
  }, [status, autoGenerateIfSafe]);

  // Escape で kind 別エディタのポップオーバーを閉じる。
  useEffect(() => {
    if (!editPopover) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setEditPopover(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editPopover]);

  // 取り消し/やり直し（#211・ADR-0020）のキーボード入口はタイムライン編集と共有のフックへ集約（挙動を揃える・#255 レビュー対応）。
  useUndoRedoShortcuts();

  // 場面編集を開く「一度きりのペイロード」editingSceneId を消費後に破棄する（#400 レビュー）。
  // 初期化子（上）が捕捉した後にマウント直後で null へ戻す＝editingTemplateId が backToList で戻すのと同じ規律。
  // これで editingSceneId を set しない他導線は「未指定＝先頭場面」の決定的挙動に戻る。getState 経由で依存なし・1回のみ。
  useEffect(() => {
    useProjectStore.getState().setEditingSceneId(null);
  }, []);


  const selected = scenes.find((s) => s.sceneId === selectedId) ?? scenes[0];
  const template = selected ? templates.find((t) => t.templateId === selected.templateId) : undefined;
  // 「動き」（簡易アニメ・ADR-0019）をこの場で再生確認する（#408 Part 1・仕上がり確認への往復をなくす）。
  // フックは guard より前で無条件に呼ぶ（Hooks ルール）。scene 未定なら animActive=false で何も再生しない。
  const motionPreview = useSceneMotionPreview(selected, template, assets, timelineOverlay?.animations);
  // 見た目ピッカーの選択肢：同じ場面カテゴリ＋同じ向きに絞る（ADR-0012・#415）。不一致の現行テンプレ（旧データ等）は
  // 有効な選択肢（options）と分け、mismatchedCurrent として選択不可で表示＝整合済みに見せない（#415 P2）。
  const { options: pickableOptions, mismatchedCurrent } = selected
    ? pickableTemplatesForScene(templates, selected.sceneType, aspectRatio, template)
    : { options: [], mismatchedCurrent: undefined };
  // 参照先テンプレが存在しない（グローバル削除等で見つからない）現行＝未解決。mismatchedCurrent（Template あり）とは別に扱う（#415 レビュー）。
  const unresolvedCurrent = !!selected && !template;
  // アクティブグループが消えたら（メンバー削除で空に・場面切替）描画上は非選択扱い＝stale な state を描画に出さない（effect 不要・#311 レビュー）。
  const activeGroupStillExists = activeGroupId != null && (selected?.groups ?? []).some((g) => g.id === activeGroupId);
  const effectiveActiveGroupId = activeGroupStillExists ? activeGroupId : null;
  // assetRefs を割り当てられるスロット層（背景/メイン/ロゴ）と、割当可能な素材。
  const slotLayers =
    template?.layers.filter((l) => l.type === "background" || l.type === "slot" || l.type === "logo") ?? [];
  // 同じラベル（例「素材」）が複数あるスロットは連番で区別する（使用素材UIの区別性・実機FB）。
  const slotLabels = (() => {
    const total = new Map<string, number>();
    for (const l of slotLayers) {
      const key = slotLabelFor(l);
      total.set(key, (total.get(key) ?? 0) + 1);
    }
    const seen = new Map<string, number>();
    return slotLayers.map((l) => {
      const base = slotLabelFor(l);
      if ((total.get(base) ?? 0) <= 1) return base;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      return `${base}${n}`;
    });
  })();

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
  const sceneGroups = selected.groups ?? [];
  const activeGroup = sceneGroups.find((g) => g.id === effectiveActiveGroupId) ?? null;
  // 自由配置 slot に割り当て可能な素材（画像・動画）。
  const freeSlotAssets = assets.filter((a) => a.assetType === ASSET_TYPE.image || a.assetType === ASSET_TYPE.video);
  // 追加：新要素を末尾に積み、追加直後のその要素を選択状態にする（詳細モードでも即表示・#179）。
  // duplicateFreeEl と同様に updater 内の最新 s.freeLayout から計算（同期実行で newId は下の前に確定）。
  const addFreeEl = (kind: FreeElementKind) => {
    let newId: string | null = null;
    patch((s) => {
      const result = addFreeElement(s.freeLayout ?? [], kind, template?.canvas.width, template?.canvas.height);
      newId = result.newId;
      return { ...s, freeLayout: result.freeLayout };
    });
    if (newId) setSelectedFreeIds([newId]);
  };
  const patchFreeEl = (id: string, p: Partial<Omit<FreeElement, "id" | "kind">>) =>
    patch((s) => ({ ...s, freeLayout: updateFreeElement(s.freeLayout ?? [], id, p) }));
  // 図形の「透明度」変更（④・ADR-0019 (1c)）：既存のフェードイン（動き）があれば終端の濃さも合わせて更新し、
  // 「編集中に見えている濃さ＝再生/書き出しの到達点」をそろえる（レビュー対応）。scene＋meta を履歴グループで1手に。
  const setFreeElementOpacity = (el: FreeElement, opacity: number) => {
    const anim = (timelineOverlay?.animations ?? []).find((a) => a.sceneId === selected.sceneId && a.targetId === el.id);
    if (!anim) { patchFreeEl(el.id, { opacity }); return; }
    beginHistoryGroup();
    patchFreeEl(el.id, { opacity });
    // 動きの種類（フェード/スライド/ポップ/回転）は変えず、終点の濃さだけ合わせる。
    updateAnimation(anim.id, withEndOpacity(anim.keyframes, opacity));
    endHistoryGroup();
  };
  const removeFreeEl = (id: string) => {
    // freeLayout から消すと同時に groups からも除去し、空グループは落とす（orphan 参照防止・#311 レビュー）。
    // 要素アニメ（④）も孤児にならないよう掃除する。scene（freeLayout/groups）＋meta（animations）の2更新を
    // 履歴グループで1手にまとめる（Undo は1回で両方戻る）。
    beginHistoryGroup();
    patch((s) => ({ ...s, freeLayout: removeFreeElement(s.freeLayout ?? [], id), groups: removeMembersFromGroups(s.groups ?? [], [id]) }));
    removeAnimationsForElements(selected.sceneId, [id]);
    endHistoryGroup();
    setSelectedFreeIds((cur) => cur.filter((x) => x !== id)); // 選択中を消したら選択から外す（詳細モードは案内へ）
  };
  // 一括移動：複数選択の全要素の位置を1回の更新でまとめて反映（オーバーレイのドラッグから・#206）。
  const moveFreeMany = (moves: { id: string; x: number; y: number }[]) =>
    patch((s) => ({ ...s, freeLayout: applyFreeElementPositions(s.freeLayout ?? [], moves) }));
  // 複数同時リサイズ（#274）：グループ拡縮の結果（id ごとの x,y,w,h）をまとめて適用。
  const resizeFreeMany = (updates: FreeElementGeom[]) =>
    patch((s) => ({ ...s, freeLayout: applyFreeElementGeoms(s.freeLayout ?? [], updates) }));
  // 一括削除：選択中の全要素を削除し選択を解除（#206）。開いている編集ポップオーバーも閉じる（削除済み要素に残らないように）。
  const removeFreeMany = (ids: string[]) => {
    // 一括削除でも要素アニメ（④）を孤児にしないよう掃除する（scene＋meta を履歴グループで1手に）。
    beginHistoryGroup();
    patch((s) => ({ ...s, freeLayout: removeFreeElements(s.freeLayout ?? [], ids), groups: removeMembersFromGroups(s.groups ?? [], ids) }));
    removeAnimationsForElements(selected.sceneId, ids);
    endHistoryGroup();
    setSelectedFreeIds([]);
    setEditPopover(null);
  };
  // 整列・等間隔分布（#205）：選択要素の外接矩形を基準に位置を計算し、一括移動で反映。
  const alignFree = (mode: FreeAlign) =>
    patch((s) => ({ ...s, freeLayout: applyFreeElementPositions(s.freeLayout ?? [], alignFreeElements(s.freeLayout ?? [], selectedFreeIds, mode)) }));
  const distributeFree = (axis: FreeDistribute) =>
    patch((s) => ({ ...s, freeLayout: applyFreeElementPositions(s.freeLayout ?? [], distributeFreeElements(s.freeLayout ?? [], selectedFreeIds, axis)) }));
  // グループ化（ADR-0022・#305）：選択中の要素を1つのグループに束ね、それをアクティブにする。
  const groupSelected = () => {
    // 既に別グループに属す要素は除外（1要素が複数グループに入る不整合を防ぐ）。
    const eligible = selectedFreeIds.filter((id) => topGroupOfMember(sceneGroups, id) == null);
    if (eligible.length < 2) return;
    const { groups, groupId } = createGroupFromSelection(sceneGroups, eligible);
    patch((s) => ({ ...s, groups }));
    setSelectedFreeIds([]);
    setActiveGroupId(groupId);
  };
  // グループ解除：アクティブグループを解除し transform をメンバーへ焼き込む。解除後は元メンバーを選択。
  const ungroupActive = () => {
    if (!activeGroupId) return;
    if (activeGroup?.locked) return; // ロック中は解除も抑止（UI disabled に加えた多重防御・#319 レビュー）
    const memberIds = groupElementIds(sceneGroups, activeGroupId);
    patch((s) => {
      const r = ungroupGroup(s.groups ?? [], s.freeLayout ?? [], activeGroupId);
      return { ...s, groups: r.groups, freeLayout: r.elements };
    });
    setActiveGroupId(null);
    setSelectedFreeIds(memberIds);
  };
  // グループの transform 更新（移動・#305-1。拡縮/回転は #305-2）。
  const transformGroup = (groupId: string, p: Partial<GroupTransform>) =>
    patch((s) => ({ ...s, groups: updateGroupTransform(s.groups ?? [], groupId, p) }));
  // グループの非表示/ロック切替（#305-2）。hidden は描画抑止（isHiddenByGroup）、locked は枠操作を抑止。
  const toggleGroupHidden = (groupId: string) =>
    patch((s) => ({ ...s, groups: toggleGroupFlag(s.groups ?? [], groupId, "hidden") }));
  const toggleGroupLocked = (groupId: string) =>
    patch((s) => ({ ...s, groups: toggleGroupFlag(s.groups ?? [], groupId, "locked") }));
  // グループの重ね順（#305）：メンバー全体を最前面/最背面へ（相対順は保つ）。
  const bringGroupFront = (groupId: string) => {
    if (sceneGroups.find((g) => g.id === groupId)?.locked) return; // ロック中は重ね順も抑止（多重防御・#319 レビュー）
    patch((s) => ({ ...s, freeLayout: reorderGroupZ(s.freeLayout ?? [], groupElementIds(s.groups ?? [], groupId), "front") }));
  };
  const sendGroupBack = (groupId: string) => {
    if (sceneGroups.find((g) => g.id === groupId)?.locked) return;
    patch((s) => ({ ...s, freeLayout: reorderGroupZ(s.freeLayout ?? [], groupElementIds(s.groups ?? [], groupId), "back") }));
  };
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
      const result = addFreeComponentGroup(s.freeLayout ?? [], componentId, template?.canvas.width, template?.canvas.height);
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
          {a?.assetType === ASSET_TYPE.video ? (
            <ClipDetailControls asset={a} patchClip={(p) => patchAssetClip(a.assetId, p)} />
          ) : a ? (
            <div className="field" style={{ marginTop: 6, marginBottom: 0 }}>
              <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>枠への収め方</label>
              {/* FREE 要素の収め方は要素ごと（継承概念なし）＝常に値を持たせる。inheritLabel 未指定の FitSelect は
                  undefined を返さないが、型上の undefined は既定 cover で明示的に受ける。 */}
              <FitSelect
                value={el.fit ?? FIT.cover}
                onChange={(fit) => patchFreeEl(el.id, { fit: fit ?? FIT.cover })}
              />
            </div>
          ) : null}
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
              onChange={(e) => setFreeElementOpacity(el, Number(e.target.value))}
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
  // 「動き」＝簡易アニメのプリセット（④・ADR-0019 (1c)/(2)/(3)）。登場のしかた（ふわっと/すべって/ぽん/くるっと）。
  // FREE 要素とグループの両方に付けられる（target＝要素id or group_NNN）。詳細な手動KF編集は将来タイムライン（ADR-0023）へ。
  const ANIM_KIND_LABEL: Record<PresetKind, string> = { fade: "ふわっと", slide: "すべって", pop: "ぽんっと", spin: "くるっと" };
  const ANIM_DIR_LABEL: Record<SlideDirection, string> = { left: "左から", right: "右から", up: "上から", down: "下から" };
  // endOpacity＝要素なら本来の不透明度（el.opacity ?? 1）／グループなら 1。
  const renderAnimationControls = (targetId: string, endOpacity: number) => {
    const anim = (timelineOverlay?.animations ?? []).find((a) => a.sceneId === selected.sceneId && a.targetId === targetId);
    const desc = anim ? describeAnimation(anim.keyframes) : null;
    const kind = desc?.kind ?? null;
    const durationSec = desc?.durationSec ?? PRESET_DEFAULT_SEC;
    const easing = desc?.easing ?? EASING.easeInOut;
    const direction = desc?.direction ?? "left";
    // 種類・秒・感じ・向きのどれかを変えたら作り直す（x/y/rotation は相対＝位置編集には layout 側が自動追従）。
    const apply = (over: { kind?: PresetKind | "none"; durationSec?: number; easing?: Easing; direction?: SlideDirection }) => {
      const k = over.kind ?? kind ?? "none";
      if (k === "none") { if (anim) removeAnimation(anim.id); return; }
      const kfs = presetKeyframes(k, {
        durationSec: over.durationSec ?? durationSec,
        easing: over.easing ?? easing,
        direction: over.direction ?? direction,
        endOpacity,
      });
      if (anim) updateAnimation(anim.id, kfs); else addAnimation(selected.sceneId, targetId, kfs);
    };
    return (
      <div className="field" style={{ marginBottom: 6 }}>
        <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>動き（登場のしかた）</label>
        <select className="select" value={kind ?? "none"} onChange={(e) => apply({ kind: e.target.value as PresetKind | "none" })}>
          <option value="none">なし</option>
          {PRESET_KINDS.map((k) => (<option key={k} value={k}>{ANIM_KIND_LABEL[k]}</option>))}
        </select>
        {anim && kind && (
          <div className="col gap-sm" style={{ marginTop: 6 }}>
            <div className="row gap-sm" style={{ alignItems: "flex-end" }}>
              <NumberField label="かける時間（秒）" value={durationSec} min={PRESET_MIN_SEC} max={PRESET_MAX_SEC} step={0.1} onChange={(v) => apply({ durationSec: v })} />
              <div className="field" style={{ margin: 0 }}>
                <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>動きの感じ</label>
                <select className="select" value={easing} onChange={(e) => apply({ easing: e.target.value as Easing })}>
                  <option value={EASING.easeInOut}>なめらか</option>
                  <option value={EASING.linear}>一定</option>
                </select>
              </div>
              {kind === "slide" && (
                <div className="field" style={{ margin: 0 }}>
                  <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>どこから</label>
                  <select className="select" value={direction} onChange={(e) => apply({ direction: e.target.value as SlideDirection })}>
                    {SLIDE_DIRECTIONS.map((d) => (<option key={d} value={d}>{ANIM_DIR_LABEL[d]}</option>))}
                  </select>
                </div>
              )}
            </div>
            <button className="btn btn-ghost text-sm" style={{ alignSelf: "flex-start" }} onClick={() => removeAnimation(anim.id)}>動きをやめる</button>
          </div>
        )}
      </div>
    );
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
        {/* プロジェクト名をその場で表示・変更（#252）。右の「場面編集」は現在地の目印。 */}
        <div className="topbar-title" style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <ProjectNameField />
          <span className="text-sm text-muted" style={{ flexShrink: 0 }}>場面編集</span>
        </div>
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
        <div
          className="editor-grid"
          style={{ position: "relative", gridTemplateColumns: `${leftCollapsed ? LEFT_COLLAPSED_WIDTH : LEFT_WIDTH}px 1fr ${rightWidth}px` }}
        >
          {/* 右パネルの幅をドラッグで変える境界ハンドル（#276・絶対配置でグリッド項目にはならない）。 */}
          <div
            onPointerDown={onResizeDown}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeEnd}
            onPointerCancel={onResizeEnd}
            title="ドラッグで編集欄の幅を変える"
            style={{
              position: "absolute", top: 0, bottom: 0,
              right: `calc(${rightWidth}px + (var(--gap) / 2) - 3px)`,
              width: 6, cursor: "col-resize", background: "var(--color-border-strong)",
              borderRadius: 3, opacity: 0.5, zIndex: 5, touchAction: "none",
            }}
          />
          {/* 左: 素材一覧 */}
          <div className="editor-col">
            {/* 左パネルの折りたたみ（#276）：見出し＋トグル。畳むと本体は display:none（列幅も縮む）。 */}
            <div className="row-between" style={{ alignItems: "center", marginBottom: leftCollapsed ? 0 : "var(--gap-sm)" }}>
              {!leftCollapsed && <h2 className="field-label" style={{ margin: 0 }}>素材一覧</h2>}
              <button
                className="btn btn-ghost btn-icon text-sm"
                title={leftCollapsed ? "素材一覧をひらく" : "素材一覧をとじる"}
                aria-label={leftCollapsed ? "素材一覧をひらく" : "素材一覧をとじる"}
                onClick={() => setLeftCollapsed((v) => !v)}
              >
                {leftCollapsed ? "▶" : "◀"}
              </button>
            </div>
            <div style={{ display: leftCollapsed ? "none" : "contents" }}>
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
          </div>

          {/* 中央: 仕上がり確認 + 場面カード */}
          <div className="col gap" style={{ overflow: "hidden" }}>
            <div className="editor-col grow" style={{ overflow: "auto" }}>
              <div className="row-between" style={{ alignItems: "center" }}>
                <h2 className="field-label" style={{ margin: 0 }}>仕上がり確認</h2>
                {/* この場面に「動き」があるときだけ再生ボタンを出す（無ければ何も再生できないので出さない・#408 Part 1）。 */}
                {motionPreview.animActive && (
                  <button
                    className="btn btn-ghost text-sm btn-icon"
                    onClick={() => (motionPreview.playing ? motionPreview.stop() : motionPreview.play())}
                  >
                    {motionPreview.playing ? <StopIcon size={16} /> : <PlayIcon size={16} />}
                    {motionPreview.playing ? "停止" : "動きを再生"}
                  </button>
                )}
              </div>
              {/* オーバーレイは ScenePreview の fit 箱内に重なる（#273）。editPopover は position:fixed のため外側 relative は不要。 */}
              {/* 動き再生中は timeSec/animations を渡して layoutScene(t) で毎フレーム描く（停止中は静止＝settled・#408 Part 1）。 */}
              <ScenePreview scene={selected} template={template} timeSec={motionPreview.timeSec} animations={motionPreview.previewAnimations}>
                {/* FREE 場面：プレビュー（fit箱）の子に重ねる＝縦型でも実寸一致でドラッグ移動・角リサイズが追従（#273・Phase 4b）。 */}
                {/* 再生中は編集用オーバーレイ（選択枠・ハンドル）を隠す＝動く要素と設計位置のハンドルがズレて見えるのを避ける。 */}
                {isFree && template && !motionPreview.playing && (
                  <FreeLayoutOverlay
                    freeLayout={freeLayout}
                    canvasW={template.canvas.width}
                    canvasH={template.canvas.height}
                    selectedIds={selectedFreeIds}
                    onSelect={selectFree}
                    onSelectMany={selectFreeMany}
                    onChange={(id, g) => patchFreeEl(id, g)}
                    onResizeMany={resizeFreeMany}
                    onRotate={(id, rotation) => patchFreeEl(id, { rotation })}
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
                    groups={sceneGroups}
                    activeGroupId={effectiveActiveGroupId}
                    onSelectGroup={selectGroup}
                    onGroupTransform={transformGroup}
                  />
                )}
              </ScenePreview>
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
                {scenes.map((s, i) => (
                  <button
                    key={s.sceneId}
                    className={`scene-card${selected.sceneId === s.sceneId ? " selected" : ""}`}
                    onClick={() => selectScene(s.sceneId)}
                    {...sceneDnd.handleProps(s.sceneId)}
                    {...sceneDnd.dropProps(i)}
                    title="ドラッグで並び替え・クリックで選択"
                    style={{
                      opacity: sceneDnd.draggingId === s.sceneId ? 0.4 : undefined,
                      outline:
                        sceneDnd.overIndex === i && sceneDnd.draggingId && sceneDnd.draggingId !== s.sceneId
                          ? "2px solid var(--color-primary)"
                          : undefined,
                    }}
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

            {/* FREE 場面は文字を「自由配置」で置くため、ここのテキスト欄は出さない（§2-4）。 */}
            {/* 非FREEのテキスト欄は、選択テンプレが実際に使うテキスト種別だけ生成する（#214 ④b）。 */}
            {/* 文字レイヤーを持たないテンプレ（画像・動画中心など）では欄ゼロになるため、その旨を明示する（ℹ️ PR#235）。 */}
            {!isFree && (
              <CollapsibleSection title="文字">
              {sceneTextKeys.length === 0 && (
                <p className="field-hint" style={{ marginTop: 0 }}>この見た目パターンは文字を表示しません。</p>
              )}
              {sceneTextKeys.map((key) => {
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
              </CollapsibleSection>
            )}

            <CollapsibleSection title="見た目・フォント">
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
                {/* 不一致の現行テンプレは選択値として表示しつつ選択不可＝「合っていない」を明示（#415 P2）。 */}
                {mismatchedCurrent && (
                  <option value={mismatchedCurrent.templateId} disabled>
                    {mismatchedCurrent.name}（今の動画に合いません）
                  </option>
                )}
                {/* 現行が見つからない（未解決）ときも選択不可の目印を出し、選択値が消えて空 select にならないようにする（#415 レビュー）。 */}
                {unresolvedCurrent && selected && (
                  <option value={selected.templateId} disabled>
                    （今の見た目が見つかりません）
                  </option>
                )}
                {pickableOptions.map((t) => (
                  <option key={t.templateId} value={t.templateId}>
                    {t.name}
                  </option>
                ))}
              </select>
              {mismatchedCurrent || unresolvedCurrent ? (
                <p className="field-hint" style={{ marginTop: 4, color: "var(--color-danger)" }}>
                  {unresolvedCurrent ? "今の見た目が見つかりません。" : "今の見た目は動画の向き・場面に合っていません。"}
                  {pickableOptions.length > 0 ? "下から選び直してください。" : "この向き・場面に合う見た目パターンがまだありません。"}
                </p>
              ) : pickableOptions.length <= 1 ? (
                <p className="field-hint" style={{ marginTop: 4 }}>
                  この向き・場面に合う見た目パターンは、今はこれだけです。
                </p>
              ) : null}
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
              <label className="field-label">この場面のBGM</label>
              <select
                className="select"
                value={
                  selected.bgmSettings === undefined
                    ? ""
                    : selected.bgmSettings.enabled === false
                      ? "__off__"
                      : selected.bgmSettings.bundledBgmId ?? ""
                }
                onChange={(e) => {
                  const v = e.target.value;
                  patch((s) => ({
                    ...s,
                    // 継承＝undefined（動画全体を使う）／無音＝enabled:false／曲＝この場面専用のBGM（音量・フェードは全体から引き継ぐ）。
                    bgmSettings:
                      v === ""
                        ? undefined
                        : v === "__off__"
                          ? { enabled: false }
                          : {
                              enabled: true,
                              bundledBgmId: v as BundledBgmId,
                              volume: projectBgm?.volume ?? BGM_VOLUME,
                              loop: projectBgm?.loop ?? true,
                              fadeInSec: projectBgm?.fadeInSec,
                              fadeOutSec: projectBgm?.fadeOutSec,
                            },
                  }));
                }}
              >
                <option value="">動画全体に合わせる</option>
                <option value="__off__">この場面は無音</option>
                {BGM_CATALOG.map((b) => (
                  <option key={b.id} value={b.id}>{b.label}</option>
                ))}
              </select>
              <p className="field-hint" style={{ marginTop: 4 }}>この場面だけ違うBGMや無音にできます（「動画全体に合わせる」で全体の設定を使います）。連続する同じ曲は途切れません。</p>
            </div>
            </CollapsibleSection>

            <CollapsibleSection title="使用素材">
            <div className="field">
              {slotLayers.length === 0 ? (
                <p className="text-sm text-muted">この見た目パターンに素材を入れる場所はありません。</p>
              ) : (
                slotLayers.map((layer, i) => {
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
                    <div key={layer.id} style={{ marginBottom: 10, padding: "8px 10px", border: "1px solid var(--color-border)", borderRadius: "var(--radius)" }}>
                      <label className="field-label text-sm" style={{ margin: "0 0 4px", fontWeight: 600 }}>{slotLabels[i]}</label>
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

                      {isVideo && assignedAsset && (
                        <ClipDetailControls asset={assignedAsset} patchClip={patchClip} />
                      )}
                      {!isVideo && assignedAsset && (
                        <div className="field" style={{ marginTop: 6 }}>
                          <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>枠への収め方</label>
                          <FitSelect
                            inheritLabel="見た目の既定に合わせる"
                            value={selected.slotFits?.[layer.id]}
                            onChange={(fit) =>
                              patch((s) => {
                                const next = { ...s.slotFits };
                                if (fit) next[layer.id] = fit;
                                else delete next[layer.id];
                                return { ...s, slotFits: Object.keys(next).length ? next : undefined };
                              })
                            }
                          />
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
            </CollapsibleSection>

            {/* FREE 場面：自由配置エディタ（素材/文字/図形を追加・数値で位置/大きさ・重なり順・削除）。Phase 4a-3b。 */}
            {isFree && (
              <CollapsibleSection title="自由配置">
              <div className="field">
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
                    {/* 選択中グループ（ADR-0022・#305）：解除でばらす（transform をメンバーへ焼き込み）。動き（④(3)）はグループ全体に付く。 */}
                    {effectiveActiveGroupId && (
                      <div className="col gap-sm" style={{ padding: "4px 8px", background: "rgba(80,130,255,0.12)", borderRadius: 6 }}>
                        <div className="row-between">
                          <span className="text-sm">グループを選択中{activeGroup?.locked ? "（ロック中）" : "（まとめて移動・拡縮・回転）"}</span>
                          <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                            <button className="btn btn-ghost text-sm" title="グループを最前面へ" disabled={!!activeGroup?.locked} onClick={() => bringGroupFront(effectiveActiveGroupId)}>前面</button>
                            <button className="btn btn-ghost text-sm" title="グループを最背面へ" disabled={!!activeGroup?.locked} onClick={() => sendGroupBack(effectiveActiveGroupId)}>背面</button>
                            <button className="btn btn-ghost text-sm" title={activeGroup?.hidden ? "表示する" : "隠す"} onClick={() => toggleGroupHidden(effectiveActiveGroupId)}>{activeGroup?.hidden ? "表示" : "隠す"}</button>
                            <button className="btn btn-ghost text-sm" title={activeGroup?.locked ? "ロックを解除" : "ロックして固定"} onClick={() => toggleGroupLocked(effectiveActiveGroupId)}>{activeGroup?.locked ? "ロック解除" : "ロック"}</button>
                            <button className="btn btn-ghost text-sm" disabled={!!activeGroup?.locked} onClick={ungroupActive}>解除</button>
                          </div>
                        </div>
                        {/* グループ全体に登場の動きをつける（④(3)・ADR-0019）。メンバーをまとめて動かす。
                            ロック中は「まとめて移動・拡縮・回転」の抑止と揃えて操作不可（fieldset で中の入力を一括無効化）。 */}
                        <fieldset
                          disabled={!!activeGroup?.locked}
                          style={{ border: "none", padding: 0, margin: 0, minInlineSize: "auto", opacity: activeGroup?.locked ? 0.5 : 1 }}
                        >
                          {renderAnimationControls(effectiveActiveGroupId, 1)}
                        </fieldset>
                      </div>
                    )}
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
                        {/* グループ化（ADR-0022・#305）：選択をひとまとめにして一緒に動かせる。 */}
                        {!confirmBulkDelete && (
                          <div className="row gap-sm" style={{ alignItems: "center" }}>
                            <button className="btn btn-ghost text-sm" onClick={groupSelected}>選択をグループ化</button>
                          </div>
                        )}
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

                        {renderAnimationControls(el.id, el.opacity ?? 1)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              </CollapsibleSection>
            )}

            <CollapsibleSection title="掛け合い・セリフ">
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
                            {/* 掛け合いでも分割できる（この行から後ろを別の場面へ・#405）。先頭行や短い場面（両側が最小尺を割る）では不可。 */}
                            <button
                              className="btn btn-ghost btn-icon text-sm"
                              title="この行から後ろを別の場面に分ける"
                              disabled={i === 0 || selected.durationSec < 2 * SCENE_MIN_DURATION_SEC}
                              onClick={() => splitSceneAtLine(selected.sceneId, i)}
                            >
                              分ける
                            </button>
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
                          <span className="text-sm text-muted">開始（場面の頭から）</span>
                          <input
                            className="input text-sm"
                            type="number"
                            min={0}
                            max={selected.durationSec}
                            step={0.1}
                            style={{ width: 90 }}
                            placeholder="自動"
                            title="このセリフが始まるタイミング（場面の頭からの秒数）。空欄にすると前のセリフの後に自動で続きます。"
                            value={line.startSec ?? ""}
                            // 空欄＝自動（undefined）。値ありは [0, 場面尺] にクランプして保存（範囲外を残さない＝V17 を満たす）。
                            onChange={(e) => patch((s) => updateLine(s, line.lineId, { startSec: e.target.value === "" ? undefined : Math.min(selected.durationSec, Math.max(0, Number(e.target.value))) }))}
                          />
                          <span className="text-sm text-muted">秒（空欄＝前のセリフの後に自動）</span>
                        </div>
                        <div className="row-between">
                          <span className="text-sm text-muted">音声：{narrationStatusText(line.status)}</span>
                          {lineAudio && (
                            <button
                              className="btn btn-ghost btn-icon text-sm"
                              onClick={() => { setNarrationPlayError(false); audioPreview.play(`line:${line.lineId}`, lineAudio, () => setNarrationPlayError(true)); }}
                            >
                              {audioPreview.playingKey === `line:${line.lineId}` ? "■ 停止" : "▶ 再生"}
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
                  音声：{narrationStatusText(selected.narration.status)}
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
                        audioPreview.play("scene", narrationAudioById[selected.sceneId], () => setNarrationPlayError(true));
                      }}
                    >
                      {audioPreview.playingKey === "scene" ? "■ 停止" : "▶ 再生"}
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
              <details>
                <summary className="text-sm text-muted" style={{ cursor: "pointer", padding: "2px 0" }}>声の調整（速さ・高さ・抑揚）</summary>
                {/* この場面のナレーションの声を場面ごとに上書き。null=動画全体（設定画面）を継承。変更で status をリセット＝作り直し（#249）。 */}
                <LineVoiceParam
                  label="話す速さ" range={SPEED_RANGE} value={selected.narration.speed} lowLabel="ゆっくり" highLabel="はやい"
                  onChange={(v) => patch((s) => ({ ...s, narration: { ...s.narration, speed: v, status: NARRATION_STATUS.none } }))}
                  onReset={() => patch((s) => ({ ...s, narration: { ...s.narration, speed: null, status: NARRATION_STATUS.none } }))}
                />
                <LineVoiceParam
                  label="声の高さ" range={PITCH_RANGE} value={selected.narration.pitch} lowLabel="ひくい" highLabel="たかい"
                  onChange={(v) => patch((s) => ({ ...s, narration: { ...s.narration, pitch: v, status: NARRATION_STATUS.none } }))}
                  onReset={() => patch((s) => ({ ...s, narration: { ...s.narration, pitch: null, status: NARRATION_STATUS.none } }))}
                />
                <LineVoiceParam
                  label="抑揚" range={INTONATION_RANGE} value={selected.narration.intonation} lowLabel="おだやか" highLabel="ゆたか"
                  onChange={(v) => patch((s) => ({ ...s, narration: { ...s.narration, intonation: v, status: NARRATION_STATUS.none } }))}
                  onReset={() => patch((s) => ({ ...s, narration: { ...s.narration, intonation: null, status: NARRATION_STATUS.none } }))}
                />
              </details>
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
            </CollapsibleSection>

            {/* 場面ごとの声の大きさ（全体設定を継承 or この場面だけ上書き。§6/§2.2） */}
            {/* 既定は畳む。ただし「この場面で上書き設定済み」なら開く＝設定を見失わない（PR#286レビュー）。
                key を場面 id にして場面切替ごとに評価し直す（SceneEditScreen は場面切替で再マウントしないため）。 */}
            <CollapsibleSection key={selected.sceneId} title="この場面だけ声の大きさ" defaultOpen={sceneNarrationVolume != null}>
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
            </CollapsibleSection>


            <CollapsibleSection title="表示時間">
            <div className="field">
              <label className="field-label" htmlFor="duration">表示時間（秒）</label>
              <input
                id="duration"
                className="input"
                type="number"
                min={SCENE_MIN_DURATION_SEC}
                max={SCENE_MAX_DURATION_SEC}
                step={1}
                value={durationDraft?.sceneId === selected.sceneId ? durationDraft.value : selected.durationSec}
                onFocus={() => setDurationDraft({ sceneId: selected.sceneId, value: String(selected.durationSec) })}
                onChange={(e) => setDurationDraft({ sceneId: selected.sceneId, value: e.target.value })} // 途中値は store に入れない＝範囲外値を自動保存しない（#411 P1）
                onBlur={() => {
                  // 確定時のみ範囲クランプ（clampSceneDuration＝§7 テスト済み純粋関数）して commit。空/不正は元の値を保持（変更しない）。
                  const raw = durationDraft?.sceneId === selected.sceneId ? durationDraft.value : "";
                  const clamped = raw.trim() === "" || Number.isNaN(Number(raw)) ? selected.durationSec : clampSceneDuration(Number(raw));
                  if (clamped !== selected.durationSec) patch((s) => ({ ...s, durationSec: clamped }));
                  setDurationDraft(null);
                }}
              />
            </div>
            </CollapsibleSection>

            {/* 画面の切り替え（トランジション）は常時表示（「詳細編集」トグル撤廃・#278）。 */}
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

            {/* 場面編集から離れずに複製できる（台本表への往復・選択リセットを避ける・#405）。複製直後のコピーを選択する。 */}
            <button
              className="btn btn-ghost btn-block mt"
              onClick={() => { const id = duplicateScene(selected.sceneId); if (id) selectScene(id); }}
              title="この場面をもう1枚コピーします"
            >
              <PlusIcon size={16} />
              この場面を複製
            </button>

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

            <div className="mt" style={{ textAlign: "center" }}>
              <SaveStatusBadge />
            </div>
            <button
              className="btn btn-primary btn-block"
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
