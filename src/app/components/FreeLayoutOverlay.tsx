import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { FreeElement } from "../../domain/project/types";
import { FREE_ELEMENT_KIND } from "../../domain/enums";
import { freeElementsInRect, FREE_MIN_SIZE, groupBBox, moveFreeElement, resizeFreeElement, resizeGroup, resizeRotatedFreeElement, rotationFromPointer, snapAngle, type FreeElementGeom, type ResizeCorner } from "../../domain/project/freeLayoutOps";
import { edgesOf, snapToTargets, SNAP_THRESHOLD_PX, type SnapEdges } from "../../domain/project/freeSnap";
import { GROUP_MIN_SCALE } from "../../domain/constants";
import { composeGroupGeometry, isGroupHidden, isHiddenByGroup, orientedGroupFrame } from "../../domain/group/compose";
import type { Group, GroupTransform } from "../../domain/group/types";
import { topGroupOfMember } from "../../domain/project/groupOps";
// インライン編集（#549）を実描画に合わせるため、描画側の既定値/帯解決/フォント解決を共有する（体裁のドリフト防止）。
import { bandBackground, DEFAULT_FONT_SIZE, DEFAULT_LINE_HEIGHT, DEFAULT_TEXT_COLOR } from "../../renderer/layout";
import { fontFamilyForId, isKnownFontId } from "../../domain/font/fontCatalog";
import { hexToRgb } from "../../domain/format/color";
import { FONT_WEIGHT, TEXT_ALIGN } from "../../domain/enums";

// 仕上がり確認（ScenePreview）に重ねる自由配置の操作レイヤ（Phase 4b / 直接編集 #174）。
// ScenePreview は width:100% / aspect-ratio をテンプレ canvas（向き）に合わせて SVG を充填するため
// レターボックスが無く、要素の矩形は %（canvasW/canvasH 基準）でプレビューに正確に重なる。
// ドラッグ/リサイズはルートで pointer capture し、マウス座標 px をドラッグ開始時の縮尺で canvas 座標へ換算する。
// 右クリックで操作メニュー、テキストはダブルクリックでインライン編集できる（#174）。

interface DragState {
  id: string; // 主＝リサイズ対象・移動の基準
  mode: "move" | "resize" | "group-resize" | "rotate" | "group-move" | "group-scale" | "group-rotate";
  /** group-move/scale/rotate 時：対象グループ id と開始時の transform（ドラッグ中の累積を開始基準に固定）。 */
  groupId?: string;
  startTransform?: GroupTransform;
  /** group-scale/rotate 時：グループ枠の中心（canvas 座標）。scale 時は開始距離も保持。 */
  groupCenter?: { x: number; y: number };
  startDist?: number;
  corner?: ResizeCorner;
  /** resize 時：開始時の回転角（度）。回転考慮リサイズの基準を開始時点に固定（ドラッグ中に rotation が変わっても一貫・hot path の find も避ける）。 */
  rotation?: number;
  /** group-resize 時：開始時の選択要素（bbox 内の相対位置・大きさを保ってスケールする・#274）。start＝開始時の bbox。 */
  groupStarts?: FreeElement[];
  startClientX: number;
  startClientY: number;
  start: { x: number; y: number; w: number; h: number };
  /** move 時：一括移動する全要素の開始位置（複数選択。単一なら主のみ）。 */
  starts?: { id: string; x: number; y: number }[];
  /** move 時：吸着先＝移動しない他要素の辺・中心（ドラッグ開始時に確定）。 */
  otherEdges?: SnapEdges[];
  scale: number; // 表示px / canvas（= overlay幅 / canvas幅）
}

// 角ハンドルの位置（％）とカーソル。
const HANDLES: { corner: ResizeCorner; left: string; top: string; cursor: string }[] = [
  { corner: "nw", left: "0%", top: "0%", cursor: "nwse-resize" },
  { corner: "ne", left: "100%", top: "0%", cursor: "nesw-resize" },
  { corner: "sw", left: "0%", top: "100%", cursor: "nesw-resize" },
  { corner: "se", left: "100%", top: "100%", cursor: "nwse-resize" },
];

// 回転を考慮したリサイズカーソル：要素ローカルの対角軸角度（nwse=45°/nesw=135°）に回転を足し、
// 45°単位で 4種（ew/nwse/ns/nesw）へ丸めて画面の実方向に合わせる（#279後継。回転時にカーソルが逆向きになるのを防ぐ）。
const RESIZE_CURSORS = ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"];
function resizeCursor(corner: ResizeCorner, rotationDeg: number): string {
  const base = corner === "nw" || corner === "se" ? 45 : 135; // nwse=45°, nesw=135°
  const a = (((base + rotationDeg) % 180) + 180) % 180;
  return RESIZE_CURSORS[Math.round(a / 45) % 4];
}


// 選択中グループの「向き付き枠」は domain/group/compose の orientedGroupFrame を共有する（#525-10）。
// composeGroupGeometry と同じ anchor（メンバー回転後 AABB 基準）を使うため、回転メンバーを含むグループでも
// 枠中心＝拡縮/回転 pivot が実描画と一致する（旧実装の素 bbox ずれ＝#312 既知制限を解消）。

// 吸着ガイド線の色（選択枠＝primary と区別できるよう、整列ガイドは別アクセント色にする）。
const SNAP_GUIDE_COLOR = "#ff3d8b";

// 右クリックメニューの推定サイズ（画面端からはみ出さないようクランプするため）。
const MENU_W = 160;
const MENU_H = 220;

// ダブルタップ（テキスト編集へ入る）と見なす2回の pointerdown の間隔（ms）と近接（画面px）。実機ではドラッグ開始の
// preventDefault が互換 dblclick を潰すため、pointerdown 自体で二度押しを検出する（#525-4）。距離も見るのは
// ブラウザの dblclick 判定と同様＝間にドラッグを挟んだ離れた二度押しを編集と誤認しないため。
/** インライン編集の背景帯（#549）。実描画（layout.bandBackground → sceneSvg の rect）と同じ既定・同じ見え方を
 *  textarea へ再現する。帯は同じ TextItem 内なので親の hideItemIds で消える＝ここで敷かないと下地を失う。 */
function bandStyle(el: FreeElement): { background: string; borderRadius?: number } {
  const bg = bandBackground(el.background);
  const rgb = bg ? hexToRgb(bg.color) : null;
  if (!bg || !rgb) return { background: "transparent" };
  return { background: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${bg.opacity})`, borderRadius: bg.radius };
}

const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_DIST = 12;

interface OverlayProps {
  freeLayout: FreeElement[];
  canvasW: number;
  canvasH: number;
  /** 選択中の要素 id（複数選択・末尾が主＝リサイズ対象）。 */
  selectedIds: string[];
  /** 選択変更。additive=true（Shift+クリック）で選択トグル、false/未指定でその要素だけを選択。null で全解除。 */
  onSelect: (id: string | null, additive?: boolean) => void;
  /** 範囲選択（マーキー）の結果＝選択集合をまとめて置き換える（#274）。 */
  onSelectMany: (ids: string[]) => void;
  /** リサイズ中、主の新しい位置・大きさ（canvas 座標）を返す。 */
  onChange: (id: string, geom: { x: number; y: number; w?: number; h?: number }) => void;
  /** 移動中、対象（複数選択なら全選択）の新しい位置をまとめて返す（一括移動・1回の更新）。 */
  onMoveMany: (moves: { id: string; x: number; y: number }[]) => void;
  /** 複数同時リサイズ（#274）：選択集合の新しい位置・大きさをまとめて返す（1回の更新）。 */
  onResizeMany: (updates: FreeElementGeom[]) => void;
  /** 回転ハンドルのドラッグ中、要素の新しい角度（度・0≤r<360）を返す（#279）。 */
  onRotate: (id: string, rotation: number) => void;
  /** グリッド吸着サイズ（canvas px・0=吸着なし）。 */
  gridSize?: number;
  /** 右クリックメニューの操作（いずれも対象 id を渡す）。 */
  onDuplicate: (id: string) => void;
  onBringToFront: (id: string) => void;
  onSendToBack: (id: string) => void;
  onDelete: (id: string) => void;
  /** テキストのインライン編集の確定（patch 相当）。 */
  onChangeText: (id: string, text: string) => void;
  /** 右クリック「編集」：その要素の kind 別エディタを開く（id とビューポート座標を渡す）。 */
  onRequestEdit: (id: string, x: number, y: number) => void;
  /** ドラッグ移動/リサイズの開始/終了。連続編集を Undo の1ステップに合成するための境界（#211）。 */
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
  /** 永続グループ（ADR-0022）。未指定＝[]。表示はグループ transform を合成した位置になる。 */
  groups?: Group[];
  /** 選択中のグループ id（FREE のグループ編集対象）。未指定/null＝グループ非選択。 */
  activeGroupId?: string | null;
  /** メンバー要素クリックでグループを選択（null で解除）。 */
  onSelectGroup?: (groupId: string | null) => void;
  /** インライン編集中の要素 id を親へ通知（#549）。親は ScenePreview の hideItemIds に渡してSVG側の二重表示を消す。
   *  setState 等の**参照が安定した関数**を渡すこと（effect の依存に入るため）。 */
  onEditingIdChange?: (id: string | null) => void;
  /** 場面で解決済みの描画用 font-family（`fontFamilyForId` の戻り値＝sans-serif フォールバック込み・場面→動画全体→既定）。
   *  インライン編集の見た目を実描画に合わせる（#549）。要素自身が既知の fontId を持つ場合はそちらを優先＝
   *  sceneSvg の textToSvg と同じ解決順。 */
  textFontFamily?: string;
  /** グループの transform を更新（移動/拡縮/回転＝中心まわり）。 */
  onGroupTransform?: (groupId: string, patch: Partial<GroupTransform>) => void;
}

export function FreeLayoutOverlay({
  freeLayout, canvasW, canvasH, selectedIds, onSelect, onSelectMany, onChange, onMoveMany, onResizeMany, onRotate, gridSize = 0,
  onDuplicate, onBringToFront, onSendToBack, onDelete, onChangeText, onRequestEdit,
  onInteractionStart, onInteractionEnd,
  groups = [], activeGroupId = null, onSelectGroup, onGroupTransform, onEditingIdChange, textFontFamily,
}: OverlayProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  // drag の最新値を ref に保持し、ドラッグ中にアンマウントされたら履歴グループを閉じる（深さリーク防止＝以後 Undo が無音で効かなくなるのを防ぐ・#211）。
  // ref 更新は effect 内（render 中の ref 書き込みは禁止）。閉じる effect は unmount 時のみ＝通常の endDrag と二重に閉じない。
  const dragRef = useRef<DragState | null>(null);
  useEffect(() => { dragRef.current = drag; }, [drag]);
  // 直前に押したテキスト要素・時刻・画面座標（ダブルタップ検出用・#525-4）。実機は pointerdown の preventDefault で
  // 互換 dblclick が来ないため、同一テキストを DOUBLE_TAP_MS 内かつ近接（DOUBLE_TAP_DIST 内）で二度押ししたら
  // 編集へ入る。座標も見るのはブラウザの dblclick 同様（間にドラッグを挟んだ二度押しを編集と誤認しない）。
  const lastTapRef = useRef<{ id: string; t: number; x: number; y: number } | null>(null);
  useEffect(() => () => { if (dragRef.current) onInteractionEnd?.(); }, [onInteractionEnd]);
  // 主＝最後に選択した要素（リサイズハンドルはこれだけに出す。複数同時リサイズは曖昧なので非対応）。
  const primaryId = selectedIds.length > 0 ? selectedIds[selectedIds.length - 1] : null;
  // 複数同時リサイズ（#274）：選択中の非ロック・非表示要素のグループ bbox を出し、その角ハンドルで一括拡縮する。
  // グループ枠は各要素の**見た目（回転後）の AABB** で囲むため（groupBBox→elementVisualBBox）、回転要素も含められる（#300(a)）。
  // 各要素は中心を枠に合わせてスケールし w/h を掛ける（回転は保持）。非等比では回転要素にせん断近似が入るが自然な範囲（#300）。
  const groupEls = freeLayout.filter((el) => selectedIds.includes(el.id) && !el.locked && !el.hidden);
  const isGroupResize = selectedIds.length > 1 && groupEls.length > 0;
  const groupBox = isGroupResize ? groupBBox(groupEls) : null;
  // 永続グループ（ADR-0022）：表示はグループ transform を合成した位置にする（preview/export と一致）。
  const composed = composeGroupGeometry(freeLayout, groups);
  // 各要素の所属グループ（最上位）。メンバークリックで「グループごと選択」する。
  const topGroupByEl = new Map<string, Group>();
  if (groups.length > 0) for (const el of freeLayout) { const tg = topGroupOfMember(groups, el.id); if (tg) topGroupByEl.set(el.id, tg); }
  // 選択中グループ＝編集対象。枠はメンバー合成位置の外接矩形（#305-1 は移動のみ）。
  const activeGroup = activeGroupId ? groups.find((g) => g.id === activeGroupId) ?? null : null;
  const activeGroupFrame = activeGroup ? orientedGroupFrame(activeGroup, freeLayout, groups) : null;
  // 右クリックメニュー（対象 id とビューポート座標）。
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  // インライン編集中のテキスト要素 id。
  const [editingId, setEditingId] = useState<string | null>(null);
  // 編集中の要素を親へ通知＝親が ScenePreview の hideItemIds に渡し、SVG 側の同じ文字を伏せる（二重表示回避・#549）。
  useEffect(() => { onEditingIdChange?.(editingId); }, [editingId, onEditingIdChange]);
  // アンマウント時は必ず「編集していない」へ戻す（#549 レビュー ℹ️）。free_NNN は**場面内一意**なので、伏せたまま
  // 残すと別 FREE 場面で同名 id の別要素を伏せ、プレビューだけ消えて書き出しには出る（無言のパリティ乖離）。
  const editingNotifyRef = useRef(onEditingIdChange);
  useEffect(() => { editingNotifyRef.current = onEditingIdChange; }, [onEditingIdChange]);
  useEffect(() => () => editingNotifyRef.current?.(null), []);
  // 表示px→canvas の縮尺（#549）。オーバーレイは fit 箱の子＝幅が canvas 実寸に対応する（#273）。インライン編集の
  // textarea を実描画と同じ大きさで出すために必要（canvas 単位の fontSize を表示pxへ換算する）。
  // 0＝未計測（描画前）。ResizeObserver で追従＝ウィンドウ/パネル幅の変化にも合う。
  const [viewScale, setViewScale] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const next = w > 0 ? w / canvasW : 0;
      setViewScale((prev) => (Math.abs(prev - next) < 0.0001 ? prev : next)); // 同値なら更新しない（無限ループ防止）
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [canvasW]);
  // 吸着ガイド（ドラッグ中に他要素の辺/中心へそろったとき表示する縦/横の線・canvas 座標。#205 後半）。
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  // 範囲選択（マーキー・#274）の矩形（canvas 座標・null=非アクティブ）。空白ドラッグで矩形を引き交差要素を選択。
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  // ポインタの画面座標→canvas 座標（オーバーレイは fit 箱内＝実寸一致・#273）。描画前(0幅)は原点に潰す。
  const toCanvas = (clientX: number, clientY: number): { x: number; y: number } => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return { x: 0, y: 0 };
    const scale = r.width / canvasW;
    return { x: (clientX - r.left) / scale, y: (clientY - r.top) / scale };
  };

  // Escape で右クリックメニューを閉じる（role="menu" の期待動作・フォーカス位置に依らず効く）。
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  // ルートで pointer capture することで、要素/ハンドルの押下後はドラッグがプレビュー外に出ても追従する。
  const beginDrag = (
    e: ReactPointerEvent, el: FreeElement, mode: "move" | "resize", corner?: ResizeCorner,
  ) => {
    lastTapRef.current = null; // 別操作の押下（非左ボタン含む）で二度押し履歴を無効化＝ボタン判定より前に実行（#525-4 レビュー）
    if (e.button !== 0) return; // 左ボタンのみドラッグ（右クリックはメニュー・中クリックは無視）
    e.preventDefault();
    e.stopPropagation(); // 角ハンドルのドラッグが本体の移動を兼ねないように
    setMenu(null);
    setEditingId(null); // ドラッグ開始でインライン編集を抜ける
    // Shift+クリック（移動操作）＝選択トグル。ドラッグは始めない（複数選択を作る/外すための操作）。
    if (mode === "move" && e.shiftKey) { onSelect(el.id, true); return; }
    // ロック中は選択だけ行い、移動/拡縮はしない（レイヤー一覧で解除できる・#210）。
    if (el.locked) { onSelect(el.id); return; }
    // 通常クリック：未選択ならその要素だけを選択。選択済みをドラッグなら選択を保つ（複数なら一括移動）。
    const alreadySelected = selectedIds.includes(el.id);
    if (!alreadySelected) onSelect(el.id);
    // 一括移動の対象：選択済み要素のドラッグ＝全選択を動かす／未選択のドラッグ＝その要素だけ（リサイズも単独）。
    const moveTargets = mode === "move" && alreadySelected ? selectedIds : [el.id];
    const starts = moveTargets
      .map((id) => freeLayout.find((m) => m.id === id))
      .filter((m): m is FreeElement => m != null)
      .map((m) => ({ id: m.id, x: m.x, y: m.y }));
    // 吸着先＝移動しない他要素の辺・中心。ドラッグ中は他要素が動かないのでここで一度だけ確定する。
    // 吸着は move のときだけ使う（resize では参照しないので計算もしない）。
    const otherEdges = mode === "move"
      ? freeLayout.filter((m) => !moveTargets.includes(m.id)).map((m) => edgesOf(m))
      : [];
    const width = ref.current?.clientWidth ?? canvasW;
    // capture は best-effort（環境により失敗しうる）。失敗してもルートの onPointerMove で追従する。
    try { ref.current?.setPointerCapture(e.pointerId); } catch { /* noop */ }
    onInteractionStart?.(); // 連続移動/リサイズを Undo の1ステップに合成する境界（開始・#211）
    setDrag({
      id: el.id, mode, corner,
      rotation: el.rotation, // 回転考慮リサイズの基準（開始時点に固定）。move では未使用。
      startClientX: e.clientX, startClientY: e.clientY,
      start: { x: el.x, y: el.y, w: el.w, h: el.h },
      starts,
      otherEdges,
      // 表示px→canvas の縮尺。プレビューは canvas と同比（向きに追従・レターボックス無し）ゆえ scaleX===scaleY なので
      // 幅基準（width/canvasW）で算出すれば縦も一致する（canvasH は %配置に使用）。
      scale: width / canvasW,
    });
  };

  // 複数同時リサイズ（#274）のグループ角ハンドル押下：bbox を基準に選択要素をまとめてスケールする。
  const beginGroupResize = (e: ReactPointerEvent, corner: ResizeCorner) => {
    lastTapRef.current = null; // 別操作の押下（非左ボタン含む）で二度押し履歴を無効化＝ボタン判定より前（#525-4 レビュー）
    if (e.button !== 0 || !groupBox) return;
    e.preventDefault();
    e.stopPropagation(); // ルートのマーキー開始を兼ねない
    setMenu(null);
    setEditingId(null);
    const width = ref.current?.clientWidth ?? canvasW;
    try { ref.current?.setPointerCapture(e.pointerId); } catch { /* noop */ }
    onInteractionStart?.(); // 連続リサイズを Undo の1ステップに合成（#211）
    setDrag({
      id: "__group__", mode: "group-resize", corner,
      startClientX: e.clientX, startClientY: e.clientY,
      start: groupBox, // 開始時の bbox（resizeFreeElement で新 bbox を求める基準）
      groupStarts: groupEls.map((el) => ({ ...el })),
      scale: width / canvasW,
    });
  };

  // 回転ハンドル押下（#279）：要素中心からポインタへの角度で rotation を更新する。
  const beginRotate = (e: ReactPointerEvent, el: FreeElement) => {
    lastTapRef.current = null; // 別操作の押下（非左ボタン含む）で二度押し履歴を無効化＝ボタン判定より前（#525-4 レビュー）
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation(); // ルートのマーキー開始を兼ねない
    setMenu(null);
    setEditingId(null);
    try { ref.current?.setPointerCapture(e.pointerId); } catch { /* noop */ }
    onInteractionStart?.(); // 連続回転を Undo の1ステップに合成（#211）
    setDrag({
      id: el.id, mode: "rotate",
      startClientX: e.clientX, startClientY: e.clientY,
      start: { x: el.x, y: el.y, w: el.w, h: el.h },
      scale: (ref.current?.clientWidth ?? canvasW) / canvasW,
    });
  };

  // グループのメンバー押下（ADR-0022・#305-1）：グループを選択し、グループ移動（transform.x/y）を開始する。
  const beginGroupDrag = (e: ReactPointerEvent, group: Group) => {
    lastTapRef.current = null; // 別操作の押下（非左ボタン含む）で二度押し履歴を無効化＝ボタン判定より前（#525-4 レビュー）
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setMenu(null);
    setEditingId(null);
    onSelectGroup?.(group.id); // メンバー個別ではなくグループ単位で選択
    if (group.locked) return; // ロック中は選択のみ
    const width = ref.current?.clientWidth ?? canvasW;
    try { ref.current?.setPointerCapture(e.pointerId); } catch { /* noop */ }
    onInteractionStart?.();
    setDrag({
      id: "__group__", mode: "group-move", groupId: group.id,
      startTransform: { ...group.transform },
      startClientX: e.clientX, startClientY: e.clientY,
      start: { x: 0, y: 0, w: 0, h: 0 }, // group-move では未使用
      scale: width / canvasW,
    });
  };

  // グループ枠の角ハンドル押下（ADR-0022・#305-2）：中心からの距離比で transform.scale を更新（中心固定の一様拡縮）。
  // ※ 名前は既存 #274 の一時グループリサイズ（beginGroupResize）と区別するため beginGroupScale。
  const beginGroupScale = (e: ReactPointerEvent, group: Group, frame: { cx: number; cy: number }) => {
    lastTapRef.current = null; // 別操作の押下（非左ボタン含む）で二度押し履歴を無効化＝ボタン判定より前（#525-4 レビュー）
    if (e.button !== 0 || group.locked) return;
    e.preventDefault();
    e.stopPropagation();
    setMenu(null);
    setEditingId(null);
    try { ref.current?.setPointerCapture(e.pointerId); } catch { /* noop */ }
    onInteractionStart?.();
    const p = toCanvas(e.clientX, e.clientY);
    const dist = Math.hypot(p.x - frame.cx, p.y - frame.cy) || 1; // 0 除算防止
    setDrag({
      id: "__group__", mode: "group-scale", groupId: group.id,
      startTransform: { ...group.transform }, groupCenter: { x: frame.cx, y: frame.cy }, startDist: dist,
      startClientX: e.clientX, startClientY: e.clientY, start: { x: 0, y: 0, w: 0, h: 0 },
      scale: (ref.current?.clientWidth ?? canvasW) / canvasW,
    });
  };

  // グループ枠の回転ハンドル押下（ADR-0022・#305-2）：中心→ポインタ角で transform.rotation を更新（Shift で15°）。
  const beginGroupRotate = (e: ReactPointerEvent, group: Group, frame: { cx: number; cy: number }) => {
    lastTapRef.current = null; // 別操作の押下（非左ボタン含む）で二度押し履歴を無効化＝ボタン判定より前（#525-4 レビュー）
    if (e.button !== 0 || group.locked) return;
    e.preventDefault();
    e.stopPropagation();
    setMenu(null);
    setEditingId(null);
    try { ref.current?.setPointerCapture(e.pointerId); } catch { /* noop */ }
    onInteractionStart?.();
    setDrag({
      id: "__group__", mode: "group-rotate", groupId: group.id, groupCenter: { x: frame.cx, y: frame.cy },
      startClientX: e.clientX, startClientY: e.clientY, start: { x: 0, y: 0, w: 0, h: 0 },
      scale: (ref.current?.clientWidth ?? canvasW) / canvasW,
    });
  };

  const handleMove = (e: ReactPointerEvent) => {
    // 範囲選択（マーキー）中：矩形を広げ、交差する要素を選択集合に反映（#274）。
    if (marquee) {
      e.preventDefault();
      const p = toCanvas(e.clientX, e.clientY);
      const next = { ...marquee, x1: p.x, y1: p.y };
      setMarquee(next);
      onSelectMany(freeElementsInRect(freeLayout, next));
      return;
    }
    if (!drag) return;
    // 回転は drag.scale（移動/リサイズ用）ではなく中心とポインタの角度で決まるので、scale 防御の前に処理する（#279）。
    if (drag.mode === "rotate") {
      e.preventDefault();
      const center = { x: drag.start.x + drag.start.w / 2, y: drag.start.y + drag.start.h / 2 };
      const deg = rotationFromPointer(center, toCanvas(e.clientX, e.clientY));
      onRotate(drag.id, e.shiftKey ? snapAngle(deg, 15) : deg);
      return;
    }
    if (drag.mode === "group-rotate" && drag.groupId && drag.groupCenter) {
      e.preventDefault();
      const deg = rotationFromPointer(drag.groupCenter, toCanvas(e.clientX, e.clientY));
      onGroupTransform?.(drag.groupId, { rotation: e.shiftKey ? snapAngle(deg, 15) : deg });
      return;
    }
    if (drag.mode === "group-scale" && drag.groupId && drag.groupCenter && drag.startTransform && drag.startDist) {
      e.preventDefault();
      const p = toCanvas(e.clientX, e.clientY);
      const dist = Math.hypot(p.x - drag.groupCenter.x, p.y - drag.groupCenter.y);
      const scale = Math.max(GROUP_MIN_SCALE, (drag.startTransform.scale * dist) / drag.startDist);
      onGroupTransform?.(drag.groupId, { scale });
      return;
    }
    if (drag.scale <= 0) return; // 縮尺不正（描画前で clientWidth=0 等）のときは NaN/Infinity を書き込まない（防御）
    e.preventDefault(); // ドラッグ中のテキスト選択等の既定動作を抑制（beginDrag と一貫）
    const dx = (e.clientX - drag.startClientX) / drag.scale;
    const dy = (e.clientY - drag.startClientY) / drag.scale;
    if (drag.mode === "move") {
      // 主の位置をグリッド吸着で確定し、さらに他要素の辺/中心へ吸着（要素スナップが近ければ優先）。
      const moved = moveFreeElement(drag.start, dx, dy, gridSize);
      const others = drag.otherEdges ?? [];
      const snap = snapToTargets(
        { x: moved.x, y: moved.y, w: drag.start.w, h: drag.start.h },
        others,
        SNAP_THRESHOLD_PX / drag.scale, // 画面px→canvas px
      );
      // その差分を選択中の全要素へ同じだけ適用（群を崩さず一括移動）。
      const ddx = snap.x - drag.start.x;
      const ddy = snap.y - drag.start.y;
      const starts = drag.starts ?? [{ id: drag.id, x: drag.start.x, y: drag.start.y }];
      onMoveMany(starts.map((s) => ({ id: s.id, x: s.x + ddx, y: s.y + ddy })));
      setGuides({ x: snap.guideX, y: snap.guideY });
    } else if (drag.mode === "group-move" && drag.groupId && drag.startTransform) {
      // グループ移動：開始 transform に画面ドラッグ量を足して transform.x/y を更新（合成で全メンバーが動く）。
      onGroupTransform?.(drag.groupId, {
        x: Math.round(drag.startTransform.x + dx),
        y: Math.round(drag.startTransform.y + dy),
      });
    } else if (drag.mode === "group-resize" && drag.corner && drag.groupStarts) {
      // グループ bbox を resizeFreeElement で新サイズにし、各要素を相対位置・大きさを保ってスケール（#274）。
      const newBox = resizeFreeElement(drag.start, drag.corner, dx, dy, FREE_MIN_SIZE, gridSize, e.shiftKey);
      onResizeMany(resizeGroup(drag.groupStarts, drag.start, newBox));
    } else if (drag.corner) {
      // Shift 押下中は縦横比を維持（e.shiftKey は move のたびに評価＝ドラッグ途中の押し直しにも追従）。
      // 回転要素は対角を canvas 上で固定する回転考慮リサイズ（#279 後継）。回転なしは従来どおり。基準角は開始時に固定。
      const rot = drag.rotation ?? 0;
      onChange(
        drag.id,
        rot === 0
          ? resizeFreeElement(drag.start, drag.corner, dx, dy, FREE_MIN_SIZE, gridSize, e.shiftKey)
          : resizeRotatedFreeElement(drag.start, drag.corner, dx, dy, rot, FREE_MIN_SIZE, gridSize, e.shiftKey),
      );
    }
  };

  const endDrag = (e: ReactPointerEvent) => {
    // 範囲選択（マーキー）の終了：矩形を消す（選択は move 中に確定済み・#274）。
    if (marquee) {
      setMarquee(null);
      try { ref.current?.releasePointerCapture(e.pointerId); } catch { /* noop */ }
      return;
    }
    if (!drag) return;
    try { ref.current?.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    setDrag(null);
    setGuides({ x: null, y: null }); // ドラッグ終了でガイド線を消す
    onInteractionEnd?.(); // 連続移動/リサイズの合成境界（終了・#211）
  };

  // 右クリック：対象を選択しカーソル位置にメニューを開く（画面端でクランプ）。
  const openMenu = (e: ReactMouseEvent, el: FreeElement) => {
    e.preventDefault();
    e.stopPropagation();
    setEditingId(null);
    // 複数選択中の要素を右クリックしたら選択は保つ（メニューは主の単独操作・一括削除はツールバー）。
    if (!selectedIds.includes(el.id)) onSelect(el.id);
    const x = Math.max(0, Math.min(e.clientX, window.innerWidth - MENU_W));
    const y = Math.max(0, Math.min(e.clientY, window.innerHeight - MENU_H));
    setMenu({ id: el.id, x, y });
  };

  const menuEl = menu ? freeLayout.find((e) => e.id === menu.id) ?? null : null;
  // メニュー項目。「編集」は全 kind で kind 別エディタ（onRequestEdit）を開く＝素材選択/文字書式/図形書式。
  // テキストはダブルクリックでもインライン編集できる（別経路）。複製/前面/背面/削除は #172 のハンドラ。
  const menuItems: { label: string; danger?: boolean; run: (id: string) => void }[] = menu && menuEl
    ? [
        { label: "編集", run: (id) => onRequestEdit(id, menu.x, menu.y) },
        { label: "複製", run: onDuplicate },
        { label: "前面", run: onBringToFront },
        { label: "背面", run: onSendToBack },
        { label: "削除", danger: true, run: onDelete },
      ]
    : [];

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        inset: 0,
        touchAction: "none",
        // グリッド吸着 ON のとき薄いグリッド線を表示（canvas px → % で線を引く）。
        ...(gridSize > 0
          ? {
              backgroundImage:
                "linear-gradient(to right, rgba(0,0,0,0.10) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.10) 1px, transparent 1px)",
              backgroundSize: `${(gridSize / canvasW) * 100}% ${(gridSize / canvasH) * 100}%`,
            }
          : {}),
      }}
      onPointerMove={handleMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      // 何もない所を押したら選択解除＋編集/メニューを閉じ、範囲選択（マーキー）を開始（要素/ハンドルの onPointerDown は stopPropagation 済み）。
      onPointerDown={(e) => {
        if (e.target !== e.currentTarget) return;
        onSelect(null); setEditingId(null); setMenu(null); // 空白クリック＝選択解除（ドラッグせず離せば解除のまま）
        lastTapRef.current = null; // 空白操作を挟んだら二度押し履歴を切る（#525-4 レビュー）
        if (e.button !== 0) return; // 左ボタンのみマーキー
        // 範囲選択（マーキー）開始：空白ドラッグで矩形を引き交差要素を選択（#274）。
        const p = toCanvas(e.clientX, e.clientY);
        try { ref.current?.setPointerCapture(e.pointerId); } catch { /* noop */ }
        setMarquee({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      }}
      // 空白部分の右クリックはブラウザ既定メニューだけ抑止する。
      onContextMenu={(e) => { e.preventDefault(); }}
    >
      {freeLayout.map((el) => {
        if (el.hidden || isHiddenByGroup(el.id, groups)) return null; // 非表示（要素 or 所属グループ）は箱を出さない＝描画（layout.ts）と一致・操作枠だけ残さない（#525-9a）
        const cg = composed.get(el.id) ?? { x: el.x, y: el.y, w: el.w, h: el.h, rotation: el.rotation }; // グループ合成後の位置
        const elGroup = topGroupByEl.get(el.id) ?? null; // 所属グループ（最上位）／未所属は null
        // ドリルイン（#525-5）：グループのメンバーをダブルクリックすると、そのメンバーだけを個別選択して直接編集できる。
        // canvas 直接編集（個別ドラッグ/ハンドル）が正しいのは、合成後（cg）が base（el）と**並進差のみ**のとき＝純並進で
        // 個別 delta が画面上 1:1 に効く（∂composed/∂base=1）。w/h/rotation が変わる＝チェーンのどこか（ネスト内側含む）に
        // 拡縮/回転がある場合はずれるので canvas 直接編集は無効（選択＋詳細パネルで編集）。**最外だけでなく合成後を直接見る**
        // ことでネスト深さに依らず厳密に正しい（#525-5 レビュー P2）。マーキーはメンバーを選ばない。
        const drilledIn = elGroup != null && selectedIds.includes(el.id); // このメンバーを個別選択中
        const groupPlain = elGroup != null && cg.w === el.w && cg.h === el.h && (cg.rotation ?? 0) === (el.rotation ?? 0);
        const drilledEditable = drilledIn && groupPlain; // canvas 上で直接編集可能なドリルインメンバー（純並進グループ）
        const grouped = elGroup != null && !drilledEditable; // 実質グループ扱い（ドリルイン編集中は非グループとして扱う）
        const inActiveGroup = elGroup != null && elGroup.id === activeGroupId; // 選択中グループのメンバー
        const selected = inActiveGroup || selectedIds.includes(el.id); // 枠を強調（ドリルインしたメンバーも含む）
        const isPrimary = el.id === primaryId; // 主＝リサイズハンドルを出す対象（未所属 or ドリルイン編集中）
        const rotated = (cg.rotation ?? 0) !== 0; // 回転あり（合成後・中心軸）
        const locked = el.locked === true; // ロック中＝移動/拡縮しない・ハンドルも出さない（#210）
        const editing = el.id === editingId && el.kind === FREE_ELEMENT_KIND.text;
        return (
          <div
            key={el.id}
            data-free-id={el.id}
            onPointerDown={(e) => {
              // 二度押し候補（実機はドラッグ開始の preventDefault が互換 dblclick を潰すので pointerdown で検出・#525-4）：
              //  ・非グループのテキスト＝インライン編集（#525-4）
              //  ・グループのメンバー（まだ個別選択していない）＝そのメンバーへドリルイン選択（#525-5）
              const button0 = e.button === 0 && !e.shiftKey;
              const dtEdit = button0 && el.kind === FREE_ELEMENT_KIND.text && elGroup == null;
              const dtDrill = button0 && elGroup != null && !selectedIds.includes(el.id);
              if (dtEdit || dtDrill) {
                const prev = lastTapRef.current;
                const near = prev != null && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < DOUBLE_TAP_DIST;
                if (prev && prev.id === el.id && e.timeStamp - prev.t < DOUBLE_TAP_MS && near) {
                  e.preventDefault();
                  e.stopPropagation();
                  lastTapRef.current = null;
                  setMenu(null);
                  onSelect(el.id); // 要素選択＝selectFree がグループ選択を解除しこの要素だけ選ぶ
                  if (dtEdit) setEditingId(el.id); // テキストはそのままインライン編集へ
                  return;
                }
              }
              // 通常のクリック/ドラッグ開始。ドリルイン状態で分岐する（#525-5 レビュー P2）：
              //  ・グループ未ドリルインのメンバー初回クリック＝まとまり選択（beginGroupDrag）
              //  ・純並進グループのドリルインメンバー＝個別ドラッグ（beginDrag／drilledEditable）
              //  ・変形グループのドリルインメンバー＝canvas 直接編集はずれるので**選択を維持のみ**（グループへ戻さない・動かさない）。
              //    ＝ドリルイン後の再クリックで無言にグループ全体を選択/移動してしまう「壊れて見える操作」を防ぐ。
              // begin* が二度押し履歴を解除するので、候補の記録はこの後に行う（#525-4 レビュー）。
              if (elGroup && !drilledIn) {
                beginGroupDrag(e, elGroup);
              } else if (elGroup && !drilledEditable) {
                e.preventDefault();
                e.stopPropagation(); // グループへ戻さず・ドラッグも始めない（変形グループは詳細パネルで編集）
              } else {
                beginDrag(e, el, "move");
              }
              if (dtEdit || dtDrill) lastTapRef.current = { id: el.id, t: e.timeStamp, x: e.clientX, y: e.clientY };
            }}
            onContextMenu={(e) => openMenu(e, el)}
            onDoubleClick={(e) => {
              // jsdom / 互換 dblclick 用フォールバック（実機は上の pointerdown 検出が主経路）。グループのメンバー＝ドリルイン、
              // 非グループのテキスト＝インライン編集。
              if (elGroup != null && !selectedIds.includes(el.id)) {
                e.preventDefault();
                e.stopPropagation();
                setMenu(null);
                onSelect(el.id);
                return;
              }
              if (el.kind !== FREE_ELEMENT_KIND.text || elGroup != null) return;
              e.preventDefault();
              e.stopPropagation();
              setMenu(null);
              onSelect(el.id);
              setEditingId(el.id);
            }}
            style={{
              position: "absolute",
              left: `${(cg.x / canvasW) * 100}%`,
              top: `${(cg.y / canvasH) * 100}%`,
              width: `${(cg.w / canvasW) * 100}%`,
              height: `${(cg.h / canvasH) * 100}%`,
              boxSizing: "border-box",
              border: selected ? "2px solid var(--color-primary)" : "1px dashed rgba(0,0,0,0.4)",
              background: selected ? "rgba(80,130,255,0.08)" : "transparent",
              cursor: locked ? "default" : editing ? "text" : "move", // ロック中はドラッグ不可を示す

              // 回転（#208）：中心を軸に回す（既定の transform-origin=中心）。出力 SVG の rotate と一致。合成後の角度を使う。
              transform: rotated ? `rotate(${cg.rotation}deg)` : undefined,
            }}
          >
            {editing ? (
              <textarea
                autoFocus
                value={el.text ?? ""}
                onChange={(e) => onChangeText(el.id, e.target.value)}
                onPointerDown={(e) => e.stopPropagation()} // textarea 内の操作でドラッグを始めない
                onDoubleClick={(e) => e.stopPropagation()}
                onContextMenu={(e) => e.stopPropagation()} // 編集中はブラウザ標準の右クリックを使う
                onBlur={() => setEditingId(null)}
                onKeyDown={(e) => {
                  // 日本語IMEの変換中（isComposing）は Enter=変換確定 / Esc=変換取消 を IME に委ね、編集を抜けない。
                  if (e.nativeEvent.isComposing) return;
                  // Enter（Shift 無し）/Esc で確定して抜ける。改行は Shift+Enter。
                  if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey)) {
                    e.preventDefault();
                    setEditingId(null);
                  }
                }}
                // その場（WYSIWYG）編集（#549）：実描画（sceneSvg の textToSvg）と同じ体裁で重ねる。
                //  ・fontSize は canvas 単位 → 表示px へ換算（viewScale）＝見た目の大きさが一致。
                //  ・font-family は要素の fontId 優先→場面既定（textToSvg と同じ解決順）。色/揃え/太さ/行間も要素から。
                //  ・line-height は無単位＝SVG の行間（fontSize × lineHeight）と一致。padding:0 で1行目のベースラインが
                //    SVG の baseY（＝要素上端 + fontSize）にほぼ揃う（差は fontSize の数%）。
                //  ・背景は透明。下の SVG 側は親が hideItemIds で伏せる＝二重表示にならない。
                style={{
                  width: "100%", height: "100%", boxSizing: "border-box", resize: "none",
                  border: "none", outline: "none", padding: 0, margin: 0,
                  // 背景帯（#529）は実描画では同じ TextItem の中に入る＝親が hideItemIds で伏せると帯ごと消える。
                  // 帯を敷いた文字（例：白文字＋黒帯）が編集中だけ下地を失って読めなくなるため、ここでも同じ帯を再現する
                  //（既定値は描画側の bandBackground を共有＝ドリフトしない）。帯が無ければ透明。
                  ...bandStyle(el),
                  color: el.color ?? DEFAULT_TEXT_COLOR,
                  // 実描画（sceneSvg.textToSvg）と同じ解決順＝要素の既知 fontId 優先→場面既定。**fontFamilyForId**（sans-serif
                  // フォールバック込み＝描画側と同じ関数）を使う。cssFamilyForId は bare 名でフォント未ロード時に
                  // textarea 既定（monospace）へ落ちて実描画と乖離する。
                  fontFamily: isKnownFontId(el.fontId) ? fontFamilyForId(el.fontId) : textFontFamily,
                  fontSize: viewScale > 0 ? (el.fontSize ?? DEFAULT_FONT_SIZE) * viewScale : undefined,
                  fontWeight: el.fontWeight ?? FONT_WEIGHT.normal,
                  textAlign: el.textAlign ?? TEXT_ALIGN.left,
                  lineHeight: el.lineHeight ?? DEFAULT_LINE_HEIGHT,
                  // 縁取り（#209）も同じ TextItem 内＝伏せると消えるので近似再現（paint-order で塗りの下に敷く）。
                  ...(el.strokeColor && (el.strokeWidth ?? 0) > 0 && viewScale > 0
                    ? { WebkitTextStroke: `${(el.strokeWidth ?? 0) * viewScale}px ${el.strokeColor}`, paintOrder: "stroke" as const }
                    : {}),
                  overflow: "hidden", // はみ出しはSVG側の maxLines と揃えて見せない（実描画に寄せる）
                }}
              />
            ) : (
              <>
                {/* リサイズハンドル：ロック中・複数選択中は出さない。回転要素も対応（対角を canvas 固定＝resizeRotatedFreeElement・#279後継）。 */}
                {isPrimary && !locked && !isGroupResize && !grouped &&
                  HANDLES.map((hd) => (
                    <div
                      key={hd.corner}
                      onPointerDown={(e) => beginDrag(e, el, "resize", hd.corner)}
                      style={{
                        position: "absolute",
                        left: hd.left,
                        top: hd.top,
                        width: 12,
                        height: 12,
                        transform: "translate(-50%, -50%)",
                        background: "#fff",
                        border: "2px solid var(--color-primary)",
                        borderRadius: 2,
                        cursor: rotated ? resizeCursor(hd.corner, el.rotation ?? 0) : hd.cursor,
                      }}
                    />
                  ))}
                {/* 回転ハンドル（#279）：単一選択・非ロックで表示（回転中も操作できるよう !rotated は付けない）。複数選択中は非表示。 */}
                {isPrimary && !locked && !isGroupResize && !grouped && (
                  <>
                    <div style={{ position: "absolute", left: "50%", top: -22, width: 1, height: 22, background: "var(--color-primary)", transform: "translateX(-50%)", pointerEvents: "none" }} />
                    <div
                      data-testid="rotate-handle"
                      onPointerDown={(e) => beginRotate(e, el)}
                      title="ドラッグで回転（Shift で15°ずつ）"
                      style={{
                        position: "absolute", left: "50%", top: -22, width: 12, height: 12,
                        transform: "translate(-50%, -50%)", background: "#fff",
                        border: "2px solid var(--color-primary)", borderRadius: "50%", cursor: "grab",
                      }}
                    />
                  </>
                )}
              </>
            )}
          </div>
        );
      })}

      {/* 吸着ガイド（#205 後半）：他要素の辺/中心にそろった位置へ縦/横の線を出す（ドラッグ中のみ）。 */}
      {guides.x != null && (
        <div data-testid="snap-guide-x" style={{ position: "absolute", left: `${(guides.x / canvasW) * 100}%`, top: 0, bottom: 0, width: 1, background: SNAP_GUIDE_COLOR, pointerEvents: "none", zIndex: 40 }} />
      )}
      {guides.y != null && (
        <div data-testid="snap-guide-y" style={{ position: "absolute", top: `${(guides.y / canvasH) * 100}%`, left: 0, right: 0, height: 1, background: SNAP_GUIDE_COLOR, pointerEvents: "none", zIndex: 40 }} />
      )}

      {/* 範囲選択（マーキー）の矩形（ドラッグ中のみ・canvas 座標→%）。#274 */}
      {marquee && (
        <div
          data-testid="marquee"
          style={{
            position: "absolute",
            left: `${(Math.min(marquee.x0, marquee.x1) / canvasW) * 100}%`,
            top: `${(Math.min(marquee.y0, marquee.y1) / canvasH) * 100}%`,
            width: `${(Math.abs(marquee.x1 - marquee.x0) / canvasW) * 100}%`,
            height: `${(Math.abs(marquee.y1 - marquee.y0) / canvasH) * 100}%`,
            border: "1px dashed var(--color-primary)",
            background: "rgba(80,130,255,0.10)",
            pointerEvents: "none",
            zIndex: 35,
          }}
        />
      )}

      {/* 選択中グループの向き付き枠（ADR-0022・#305-2）：ドラッグで移動、角で拡縮、上ハンドルで回転（transform を更新）。
          非表示グループ（自身/祖先）は枠も出さない＝描画されないものを操作可能にしない（選択状態は保持・一覧で再表示・#525-9 レビュー）。 */}
      {activeGroupFrame && activeGroup && !isGroupHidden(activeGroup.id, groups) && (
        <div
          data-testid="group-frame"
          onPointerDown={(e) => beginGroupDrag(e, activeGroup)}
          style={{
            position: "absolute",
            left: `${((activeGroupFrame.cx - activeGroupFrame.w / 2) / canvasW) * 100}%`,
            top: `${((activeGroupFrame.cy - activeGroupFrame.h / 2) / canvasH) * 100}%`,
            width: `${(activeGroupFrame.w / canvasW) * 100}%`,
            height: `${(activeGroupFrame.h / canvasH) * 100}%`,
            border: "2px solid var(--color-primary)",
            background: "rgba(80,130,255,0.06)",
            boxSizing: "border-box",
            cursor: activeGroup.locked ? "default" : "move",
            transform: activeGroupFrame.rotation ? `rotate(${activeGroupFrame.rotation}deg)` : undefined,
            zIndex: 34,
          }}
        >
          {!activeGroup.locked && (
            <>
              {/* 角＝中心固定の一様拡縮（transform.scale）。 */}
              {HANDLES.map((hd) => (
                <div
                  key={hd.corner}
                  data-testid={`group-scale-${hd.corner}`}
                  onPointerDown={(e) => beginGroupScale(e, activeGroup, activeGroupFrame)}
                  style={{
                    position: "absolute", left: hd.left, top: hd.top, width: 12, height: 12,
                    transform: "translate(-50%, -50%)", background: "#fff",
                    border: "2px solid var(--color-primary)", borderRadius: 2,
                    cursor: resizeCursor(hd.corner, activeGroupFrame.rotation),
                  }}
                />
              ))}
              {/* 上＝回転（transform.rotation）。 */}
              <div style={{ position: "absolute", left: "50%", top: -22, width: 1, height: 22, background: "var(--color-primary)", transform: "translateX(-50%)", pointerEvents: "none" }} />
              <div
                data-testid="group-rotate-handle"
                onPointerDown={(e) => beginGroupRotate(e, activeGroup, activeGroupFrame)}
                title="ドラッグでグループを回転（Shift で15°ずつ）"
                style={{
                  position: "absolute", left: "50%", top: -22, width: 12, height: 12,
                  transform: "translate(-50%, -50%)", background: "#fff",
                  border: "2px solid var(--color-primary)", borderRadius: "50%", cursor: "grab",
                }}
              />
            </>
          )}
        </div>
      )}

      {/* 複数同時リサイズ（#274）：選択集合のグループ bbox と角ハンドル（個別ハンドルの代わりに一括拡縮）。 */}
      {groupBox && (
        <div
          data-testid="group-bbox"
          style={{
            position: "absolute",
            left: `${(groupBox.x / canvasW) * 100}%`,
            top: `${(groupBox.y / canvasH) * 100}%`,
            width: `${(groupBox.w / canvasW) * 100}%`,
            height: `${(groupBox.h / canvasH) * 100}%`,
            border: "1px solid var(--color-primary)",
            boxSizing: "border-box",
            pointerEvents: "none",
            zIndex: 36,
          }}
        >
          {HANDLES.map((hd) => (
            <div
              key={hd.corner}
              data-testid={`group-handle-${hd.corner}`}
              onPointerDown={(e) => beginGroupResize(e, hd.corner)}
              style={{
                position: "absolute", left: hd.left, top: hd.top, width: 12, height: 12,
                transform: "translate(-50%, -50%)", background: "#fff",
                border: "2px solid var(--color-primary)", borderRadius: 2, cursor: hd.cursor,
                pointerEvents: "auto",
              }}
            />
          ))}
        </div>
      )}

      {menu && menuEl && (
        <>
          {/* 外側のクリック/右クリックで閉じる透明バックドロップ。 */}
          <div
            style={{ position: "fixed", inset: 0, zIndex: 50 }}
            onPointerDown={() => setMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setMenu(null); }}
          />
          <div
            role="menu"
            style={{
              position: "fixed", left: menu.x, top: menu.y, zIndex: 51,
              background: "#fff", border: "1px solid rgba(0,0,0,0.15)", borderRadius: 8,
              boxShadow: "0 6px 24px rgba(0,0,0,0.18)", padding: 4, minWidth: 140,
            }}
          >
            {menuItems.map((it) => (
              <button
                key={it.label}
                role="menuitem"
                className="btn btn-ghost text-sm"
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  color: it.danger ? "var(--color-danger)" : undefined,
                }}
                onClick={() => { it.run(menu.id); setMenu(null); }}
              >
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
