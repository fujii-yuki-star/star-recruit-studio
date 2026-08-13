import { useEffect, useRef, useState } from "react";
import { ContextMenu } from "./ContextMenu";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { FreeElement } from "../../domain/project/types";
import { FREE_ELEMENT_KIND } from "../../domain/enums";
import { elementAtPoint, freeElementsInRect, FREE_MIN_SIZE, groupBBox, moveFreeElement, resizeFreeElement, resizeGroup, resizeRotatedFreeElement, rotationFromPointer, snapAngle, type FreeElementGeom, type ResizeCorner } from "../../domain/project/freeLayoutOps";
import { edgesOf, snapToTargets, SNAP_THRESHOLD_PX, type SnapEdges } from "../../domain/project/freeSnap";
import { GROUP_MIN_SCALE } from "../../domain/constants";
import { composeGroupGeometry, isGroupHidden, isHiddenByGroup, orientedGroupFrame } from "../../domain/group/compose";
import type { Group, GroupTransform } from "../../domain/group/types";
import { groupElementIds, topGroupOfMember } from "../../domain/project/groupOps";
// インライン編集（#549）を実描画に合わせるため、描画側の既定値/帯解決/フォント解決を共有する（体裁のドリフト防止）。
import { bandBackground, DEFAULT_FONT_SIZE, DEFAULT_LINE_HEIGHT, DEFAULT_TEXT_COLOR } from "../../renderer/layout";
import { fontFamilyForId, isKnownFontId } from "../../domain/font/fontCatalog";
import { hexToRgb } from "../../domain/format/color";
import { FONT_WEIGHT, TEXT_ALIGN } from "../../domain/enums";
import { claimEscape } from "../hooks/escapeOwners";
import { DRAG_START_PX, registerExternalDrag } from "../hooks/usePointerDrag";

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
  /**
   * 右クリックメニューの操作（いずれも対象 id を渡す）。
   *
   * ⚠️ **省いた項目はメニューに出さない**（#685 後半）。タイムライン形式は**重ね順を列の並びだけ**で
   * 決めるので「前面／背面」を出すと嘘になる（ADR-0034 決定17）。**渡していないのに出す**と
   * 押しても何も起きない項目が並ぶので、`undefined` は「その形式には無い操作」として扱う。
   * すべて省くとメニュー自体を出さない（空のメニューを開かない）。
   */
  onDuplicate?: (id: string) => void;
  onBringToFront?: (id: string) => void;
  onSendToBack?: (id: string) => void;
  onDelete?: (id: string) => void;
  /**
   * メニューの項目ごとの**押せない理由**（#746-1）。渡さなければ押せる。
   * ⚠️ 押せないときも**項目は出す**（消すと「同じ操作が場所によって在ったり無かったり」になる）。
   */
  menuGuards?: { duplicate?: { disabled?: boolean; disabledHint?: string }; delete?: { disabled?: boolean; disabledHint?: string } };
  /** テキストのインライン編集の確定（patch 相当）。**省くとインライン編集に入らない**。 */
  onChangeText?: (id: string, text: string) => void;
  /** 右クリック「編集」：その要素の kind 別エディタを開く（id とビューポート座標を渡す）。 */
  onRequestEdit?: (id: string, x: number, y: number) => void;
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
  /**
   * まとめて動かすときに**固定を除外した**ことを知らせる（#773・ADR-0034 未解決7 の決着 (a)）。
   * 空間の移動は「除外して動かす」＝黙って一部だけ動かさないよう、**画面側が一言出す**
   *（文言と出し方は画面が決める＝共有部品が2つの画面へ同じ文言を押し付けない）。
   */
  onSkippedLocked?: (count: number) => void;
}

export function FreeLayoutOverlay({
  freeLayout, canvasW, canvasH, selectedIds, onSelect, onSelectMany, onChange, onMoveMany, onResizeMany, onRotate, gridSize = 0,
  onDuplicate, onBringToFront, onSendToBack, onDelete, menuGuards, onChangeText, onRequestEdit,
  onInteractionStart, onInteractionEnd,
  groups = [], activeGroupId = null, onSelectGroup, onGroupTransform, onSkippedLocked, onEditingIdChange, textFontFamily,
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
  const claimRef = useRef<(() => void)[]>([]);
  /**
   * **しきい値を越えたか**（#752-8）＝越えるまでは「押しただけ」で、まだ何も動かさない。
   * 掴んだ位置は押した点（`begin*` と範囲選択の両方が入れる）。
   */
  const startedRef = useRef(false);
  const startPointRef = useRef({ x: 0, y: 0 });
  /**
   * **掴んだ指**（#752-8）。別の指の動き・離しをこの掴みに混ぜない
   *（混ぜると、2本目の指を離した所へ落ちる＝正典が名指しで禁じている挙動）。
   */
  const pointerIdRef = useRef<number | null>(null);
  /** その催しが**掴んだ指のもの**か（掴んでいなければ素通しでよい）。 */
  const minePointer = (e: { pointerId: number }): boolean =>
    pointerIdRef.current == null || e.pointerId === pointerIdRef.current;
  /** 掴んでいる最中か（`claimDrag`〜`releaseDrag`）。**同じ後始末を二度走らせない**ための印。 */
  const activeRef = useRef(false);
  const claimDrag = (e: { clientX: number; clientY: number; pointerId: number }): void => {
    // ⚠️ **前の掴みが残っていたら先に閉じる**（`usePointerDrag` の「走っているものがあればやめる」と同じ・
    // #752-8）。離したのを取り逃がした直後にもう一度掴むと、名乗りを**外さずに上書き**していた
    // ＝`Escape` と取り消しが以後ずっと効かなくなり、履歴のまとめも開いたままになる
    //（以後の編集が全部ひとつながりになり、取り消しが1回で全部戻る）。
    if (activeRef.current) cancelDrag(); // 「掴んでいるか」を聞く相手は1つ（`activeRef`）
    startedRef.current = false;
    startPointRef.current = { x: e.clientX, y: e.clientY };
    pointerIdRef.current = e.pointerId;
    activeRef.current = true;
    // ⚠️ **`Escape` の受け持ちも「掴んでいる」も、押した時点から**（#752 レビュー）。
    // `usePointerDrag` は数に入れるのをしきい値の後にしているが、こちらは **`begin*` が押した時点で
    // 履歴のまとめ（`onInteractionStart`）を開ける**ので、そこをずらすと**まとめが開いている間だけ
    // `Ctrl+Z` が通る**穴になる＝戻した文書の上に、押した時点（戻す前）の控えを起点にした位置が
    // 書き戻る（しかも `future` を捨てるので「やり直す」でも戻せない）。
    // **しきい値の役目は「まだ位置を書かない」ことだけ**（`handleMove` 側で足りる）。
    claimRef.current = [claimEscape(), registerExternalDrag()];
  };
  /** **少し動かした＝ここから実際に動かす**（#752-8）。名乗りは押した時点で済んでいる。 */
  const markStarted = (): void => {
    startedRef.current = true;
  };
  /**
   * 名乗りを**すべて外す**（#685 レビュー）。外し忘れると `Escape` も取り消しも効かなくなるので、
   * **やめる・離す・画面を離れる**のすべてで通す。
   */
  const releaseDrag = (): void => {
    claimRef.current.forEach((r) => r());
    claimRef.current = [];
    startedRef.current = false;
    pointerIdRef.current = null;
    activeRef.current = false;
  };
  // ⚠️ **後始末は画面を離れるときだけ**（#752-8）。`onInteractionEnd` を依存に書くと、**渡された関数の
  // 中身が変わるたび**に後始末が走る＝掴んでいる最中に走れば名乗りが落ち、`Escape` も取り消しの停止も
  // 効かなくなる。いまの呼び出し3か所は安定した関数を渡しているので起きていないが、**それは呼ぶ側の
  // 都合**（1か所がインラインに変わるだけで黙って壊れる）＝この効果が言いたいのは「画面を離れるとき」
  // なので、依存でそう書く。鮮度は latest-ref で保つ（この file の `editingNotifyRef` と同じ形）。
  // `releaseDrag` は ref しか触らないので、初回の実体を掴んだままで正しく動く。
  const interactionEndRef = useRef(onInteractionEnd);
  useEffect(() => { interactionEndRef.current = onInteractionEnd; });
  useEffect(() => () => { if (dragRef.current) interactionEndRef.current?.(); releaseDrag(); }, []);
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
  /**
   * 文字を直している間の**取り消しのまとめ**（#746 レビュー）。打鍵ごとに積むと、履歴の上限を
   * 文字入力で食い潰し、それ以前の編集（**取り消しでしか戻らない操作**）が戻せなくなる。
   *
   * ⚠️ 開け閉めは**編集中かどうか**に結ぶ（`focus`/`blur` に結ばない）＝欄がフォーカス中に消えると
   * `blur` は来ない（開けっぱなし＝以後の取り消しが積まれない）。効果の後始末なら、画面を離れても
   * 相手が変わっても必ず閉じる。鮮度は latest-ref で保つ（この file の他の受け口と同じ形）。
   */
  const interactionStartRef = useRef(onInteractionStart);
  const textGroupOpenRef = useRef(false);
  useEffect(() => { interactionStartRef.current = onInteractionStart; });
  useEffect(() => {
    if (editingId == null) return;
    return () => {
      if (!textGroupOpenRef.current) return;
      textGroupOpenRef.current = false;
      interactionEndRef.current?.();
    };
  }, [editingId]);
  /**
   * まとめを開く（**最初の1打で**）。⚠️ 編集に入った時点では開けない＝二度押しは**選び直しでもある**ので、
   * 呼び出し側が「選ぶ相手が変わったらまとめを畳む」を持っていると、開けた直後に畳まれる（実測）。
   * 打ち始めてからなら選択はもう動かない。
   */
  const openTextGroup = (): void => {
    if (textGroupOpenRef.current) return;
    textGroupOpenRef.current = true;
    interactionStartRef.current?.();
  };
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
    const found = moveTargets
      .map((id) => freeLayout.find((m) => m.id === id))
      .filter((m): m is FreeElement => m != null);
    // **除外した数**を知らせる（黙って一部だけ動かさない・#773）。掴んだ時点で1度だけ。
    const skipped = found.filter((m) => m.locked).length;
    if (skipped > 0) onSkippedLocked?.(skipped);
    const starts = found
      // ⚠️ **固定したものは一緒に動かさない**（#746 レビュー 🔴）＝掴み始めるのは塞いであっても、
      // **まとめて選んで別の1つを動かす**と混ざって動いていた（固定が意味を失う）。
      // タイムライン形式では枠を「描かれている場所」に出しているので、混ざると**その場所が素の箱として
      // 保存され、動きのぶんだけ絵が飛ぶ**（`Escape` の戻しも同じ値を書く）。
      .filter((m) => !m.locked)
      .map((m) => ({ id: m.id, x: m.x, y: m.y }));
    // 吸着先＝移動しない他要素の辺・中心。ドラッグ中は他要素が動かないのでここで一度だけ確定する。
    // 吸着は move のときだけ使う（resize では参照しないので計算もしない）。
    const otherEdges = mode === "move"
      ? freeLayout.filter((m) => !moveTargets.includes(m.id)).map((m) => edgesOf(m))
      : [];
    const width = ref.current?.clientWidth ?? canvasW;
    // capture は best-effort（環境により失敗しうる）。失敗してもルートの onPointerMove で追従する。
    try { ref.current?.setPointerCapture(e.pointerId); } catch { /* noop */ }
    claimDrag(e);
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
    claimDrag(e);
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
    claimDrag(e);
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
    claimDrag(e);
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
    claimDrag(e);
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
    claimDrag(e);
    onInteractionStart?.();
    setDrag({
      id: "__group__", mode: "group-rotate", groupId: group.id, groupCenter: { x: frame.cx, y: frame.cy },
      startClientX: e.clientX, startClientY: e.clientY, start: { x: 0, y: 0, w: 0, h: 0 },
      scale: (ref.current?.clientWidth ?? canvasW) / canvasW,
    });
  };

  const handleMove = (e: ReactPointerEvent) => {
    if (!drag && !marquee) return; // 掴んでいないときの素通り（この関数はただの移動でも呼ばれる）
    if (!minePointer(e)) return; // **掴んだ指だけ見る**（別の指の動きで一緒に動かさない）
    // ⚠️ **押していないのに動いている**＝どこかで `pointerup` を取り逃がした（画面の外で離した・
    // 別の操作に取られた）。放っておくと影が指に付いたままになり、**次に無関係な所で離した瞬間**に
    // そこへ置かれる。画面ぜんぶで共通の作法（`usePointerDrag`）と同じ救済を入れる（#752-8）。
    if (e.buttons === 0) { cancelDrag(); return; }
    // ⚠️ **少し動かすまで掴まない**（同・`DRAG_START_PX`）＝押しただけ・手の震えの1px で
    // 位置を書き換えて取り消しを積まない。越えるまでは何もしない（選択は `pointerdown` で済んでいる）。
    if (!startedRef.current) {
      if (Math.hypot(e.clientX - startPointRef.current.x, e.clientY - startPointRef.current.y) < DRAG_START_PX) return;
      markStarted();
    }
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
      // ⚠️ **`Ctrl` を押している間は吸着を切る**（ADR-0034 決定12・Canva の型／#746-3）。
      // 切れないと「あと少しだけずらす」ができない＝寄せたくない所でも寄ってしまう。
      // しきい値を 0 にして**同じ関数を通す**＝切ったときだけ別の道を作らない（ガイド線も自然に消える）。
      const snap = snapToTargets(
        { x: moved.x, y: moved.y, w: drag.start.w, h: drag.start.h },
        others,
        e.ctrlKey || e.metaKey ? 0 : SNAP_THRESHOLD_PX / drag.scale, // 画面px→canvas px
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

  /**
   * 掴むのを**やめる**（`Escape`／`pointercancel`）＝**開始時の形へ戻す**（決定10・`usePointerDrag` の作法）。
   * 戻す先はドラッグ開始時に控えた値そのもの（`start`／`starts`／`groupStarts`／`startTransform`）。
   */
  const cancelDrag = (): void => {
    if (!activeRef.current) return; // 同じやめるを二度走らせない（root と window の両方から来る）
    const d = dragRef.current;
    // ⚠️ **掴む前にやめたときは書き戻さない**（#752-8）＝しきい値を越えていない＝まだ1度も
    // 動かしていないので、戻すと「何も変わらない更新」を1件流すだけになる（`releaseDrag` が
    // 下でこの印を落とすので**先に読む**）。合成境界の終わり（`onInteractionEnd`）は越え方に
    // 依らず必ず呼ぶ＝`begin*` が押した時点で開けているので、閉じないと以後の編集が全部つながる。
    const started = startedRef.current;
    setMarquee(null);
    if (d) {
      if (!started) { setDrag(null); setGuides({ x: null, y: null }); onInteractionEnd?.(); releaseDrag(); return; }
      if (d.mode === 'move') onMoveMany((d.starts ?? [{ id: d.id, x: d.start.x, y: d.start.y }]).map((s) => ({ ...s })));
      else if (d.mode === 'group-move' || d.mode === 'group-scale' || d.mode === 'group-rotate') {
        if (d.groupId && d.startTransform) onGroupTransform?.(d.groupId, d.startTransform);
      } else if (d.mode === 'group-resize' && d.groupStarts) {
        onResizeMany(d.groupStarts.map((m) => ({ id: m.id, x: m.x, y: m.y, w: m.w, h: m.h })));
      } else if (d.mode === 'rotate') onRotate(d.id, d.rotation ?? 0);
      else onChange(d.id, { x: d.start.x, y: d.start.y, w: d.start.w, h: d.start.h });
      setDrag(null);
      setGuides({ x: null, y: null });
      onInteractionEnd?.();
    }
    releaseDrag();
  };

  // `Escape` と `pointercancel` でやめる（作法は画面ぜんぶで同じ・`usePointerDrag` の ⚠️ を参照）。
  //
  // ⚠️ **張るのは掴んでいる間に1度だけ**（#747 レビュー）。依存を書かないと `pointermove` のたびに
  // 外して張り直す。かといって `drag` を依存に入れても**毎回変わる**ので同じこと。
  // 「掴んでいるか」の真偽だけを依存にし、**中身は ref 越しに最新を読む**（この file の `dragRef` と同じ形）。
  // ⚠️ ref を挟まず closure を固定すると、掴んでいる最中に親が渡し直した `onMoveMany` 等を**古いまま**
  // 呼ぶ（呼び出し側はインラインの関数を渡している）。速さのために鮮度を落とさない。
  const dragging = drag != null || marquee != null;
  // ⚠️ 初期値に関数そのものを入れない＝`endDrag` はこの下で定義するので、参照すると読み込めない。
  // 中身は下の効果で毎レンダー入れ替える（鮮度は落とさない）。
  const cancelRef = useRef<() => void>(() => {});
  const endRef = useRef<(e: { pointerId: number }) => void>(() => {});
  const mineRef = useRef<(e: { pointerId: number }) => boolean>(() => true);
  useEffect(() => {
    if (!dragging) return;
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.stopPropagation(); cancelRef.current(); } };
    const onCancel = (ev: PointerEvent): void => { if (mineRef.current(ev)) cancelRef.current(); };
    // ⚠️ **離しは window でも拾う**（#752 レビュー）＝指を捕まえる仕掛け（`setPointerCapture`）は
    // 落ちることがあり、その回に枠の外で離すと `pointerup` がこの枠へ来ない。放っておくと名乗りが
    // **次に掴むまで残り**、`Escape`・取り消し・倍率の変更が黙って効かなくなる。
    // 枠の上で離した回は先に枠の受け口が閉じるので、こちらは何もしない（掴んでいる印で二度走らない）。
    const onUp = (ev: PointerEvent): void => { if (mineRef.current(ev)) endRef.current(ev); };
    window.addEventListener('keydown', onKey, true); // 外側の `Escape` より先に受ける
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging]);

  const endDrag = (e: { pointerId: number }) => {
    if (!activeRef.current || !minePointer(e)) return; // 掴んだ指の1回だけ（別の指でそこへ落とさない）
    // 範囲選択（マーキー）の終了：矩形を消す（選択は move 中に確定済み・#274）。
    if (marquee) {
      setMarquee(null);
      try { ref.current?.releasePointerCapture(e.pointerId); } catch { /* noop */ }
      releaseDrag(); // 名乗り（`Escape`・掴んでいる数）を必ず外す＝外し忘れると以後ずっと効かない
      return;
    }
    // ⚠️ ここも名乗りを外して抜ける＝**外さずに戻る出口を作らない**（#752 レビュー）。
    if (!drag) { releaseDrag(); return; }
    try { ref.current?.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    setDrag(null);
    setGuides({ x: null, y: null }); // ドラッグ終了でガイド線を消す
    releaseDrag();
    onInteractionEnd?.(); // 連続移動/リサイズの合成境界（終了・#211）
  };

  // 上の window 側の受け口が呼ぶ中身を毎レンダー入れ替える（`endDrag` を定義した後に置く）。
  useEffect(() => { cancelRef.current = cancelDrag; endRef.current = endDrag; mineRef.current = minePointer; });

  // 右クリック：対象を選択しカーソル位置にメニューを開く（画面端でクランプ）。
  // 要素押下のルーティング（#525-4 二度押し編集／#525-5 ドリルイン／通常ドラッグ）。要素 div と**グループ枠**
  // （#548/#552）の両方から呼ぶ＝枠の上を押しても「その要素を直接押したとき」と同じ挙動になる。枠は不透明で
  // グループ全域を覆うため、枠がそのまま beginGroupDrag していた頃はドリルインが発火せず（#548）、枠内に重なる
  // グループ外の要素も選べなかった（#552）。分岐条件は要素ごとに再計算する（描画側の導出と同じ式）。
  const routeElementPointerDown = (e: ReactPointerEvent, el: FreeElement) => {
    const elGroup = topGroupByEl.get(el.id) ?? null;
    const cg = composed.get(el.id) ?? { x: el.x, y: el.y, w: el.w, h: el.h, rotation: el.rotation };
    const drilledIn = elGroup != null && selectedIds.includes(el.id); // このメンバーを個別選択中
    // 合成後が base と並進差のみ＝純並進なら canvas 直接編集が 1:1 で効く（#525-5 レビュー P2・ネスト深さに依らず厳密）。
    const groupPlain = elGroup != null && cg.w === el.w && cg.h === el.h && (cg.rotation ?? 0) === (el.rotation ?? 0);
    const drilledEditable = drilledIn && groupPlain;
    // 二度押し候補（実機はドラッグ開始の preventDefault が互換 dblclick を潰すので pointerdown で検出・#525-4）：
    //  ・非グループのテキスト＝インライン編集（#525-4）
    //  ・グループのメンバー（まだ個別選択していない）＝そのメンバーへドリルイン選択（#525-5）
    const button0 = e.button === 0 && !e.shiftKey;
    // ⚠️ 文字の直接編集は **`onChangeText` を渡したときだけ**（渡さない形式では二度押しで編集に入らない）。
    // ⚠️ **固定したものは編集欄に入れない**（#746 レビュー）＝入れても domain が打鍵ごとに断るので、
    // **文字が入らない欄**と断り文の連発になる（「中身」の欄は最初から押せない＝場所で割れる）。
    const dtEdit = button0 && onChangeText != null && !el.locked && el.kind === FREE_ELEMENT_KIND.text && elGroup == null;
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
  };

  // グループ枠の押下（#548/#552）：枠は不透明でグループの外接矩形**全域**を覆うので、そのまま beginGroupDrag すると
  // 内部クリックを貪欲に食う。ポインタの下を**実ヒットテスト**して分岐する：
  //  ・要素（メンバー/グループ外を問わず）＝その要素を押したのと同じ経路へ委譲（ドリルインも非メンバー選択も成立）
  //  ・空白＝従来どおりグループ移動
  const beginFrameDrag = (e: ReactPointerEvent, group: Group) => {
    const p = toCanvas(e.clientX, e.clientY);
    // 委譲するのは「**枠が実際に覆って触れなくしていたもの**」だけに絞る（レビュー🔴）：
    //  ・グループのメンバー（＝ドリルイン・#548）
    //  ・メンバーより**手前**の非メンバー（＝枠内に重なって選べなかった・#552）
    // メンバーより奥のもの（全面の背景／背面バックドロップ等）は委譲しない＝**枠の内部ドラッグ＝グループ移動**
    // （#307・ADR-0022）を保つ。全面背景は常に当たるため、これが無いとフォールバックが到達不能になり、
    // 枠内の空白ドラッグが背景を掴んで動かす（グループは動かず選択も無言解除）。
    const memberIds = new Set(groupElementIds(groups, group.id)); // 推移的メンバー
    const zOf = (el: FreeElement) => el.zIndex ?? 1; // 未指定=1（layout.ts と同じ）
    const memberMaxZ = Math.max(...freeLayout.filter((el) => memberIds.has(el.id)).map(zOf), Number.NEGATIVE_INFINITY);
    // 描画順（zIndex 昇順・同値は配列順＝layout.ts と同じ）に並べ、非表示を除き合成後の座標で当てる。
    const hitId = elementAtPoint(
      freeLayout
        .filter((el) => !el.hidden && !isHiddenByGroup(el.id, groups))
        .filter((el) => memberIds.has(el.id) || zOf(el) > memberMaxZ)
        .slice()
        .sort((a, b) => (a.zIndex ?? 1) - (b.zIndex ?? 1))
        .map((el) => {
          const cg = composed.get(el.id) ?? { x: el.x, y: el.y, w: el.w, h: el.h, rotation: el.rotation };
          return { id: el.id, x: cg.x, y: cg.y, w: cg.w, h: cg.h, rotation: cg.rotation };
        }),
      p,
    );
    const hitEl = hitId != null ? freeLayout.find((el) => el.id === hitId) : undefined;
    if (hitEl) { routeElementPointerDown(e, hitEl); return; }
    beginGroupDrag(e, group);
  };

  const openMenu = (e: ReactMouseEvent, el: FreeElement) => {
    e.preventDefault();
    e.stopPropagation();
    setEditingId(null);
    // 複数選択中の要素を右クリックしたら選択は保つ（メニューは主の単独操作・一括削除はツールバー）。
    if (!selectedIds.includes(el.id)) onSelect(el.id);
    // 画面の外へ出さないための寄せは `ContextMenu` に任せる（見込みサイズを2か所に持たない・§6）。
    const x = e.clientX;
    const y = e.clientY;
    setMenu({ id: el.id, x, y });
  };

  const menuEl = menu ? freeLayout.find((e) => e.id === menu.id) ?? null : null;
  // メニュー項目。「編集」は全 kind で kind 別エディタ（onRequestEdit）を開く＝素材選択/文字書式/図形書式。
  // テキストはダブルクリックでもインライン編集できる（別経路）。複製/前面/背面/削除は #172 のハンドラ。
  // ⚠️ **渡された操作だけ**を並べる（省いた＝その形式には無い操作）。押しても何も起きない項目を作らない。
  const menuItems: { label: string; danger?: boolean; disabled?: boolean; disabledHint?: string; run: (id: string) => void }[] = menu && menuEl
    ? [
        ...(onRequestEdit ? [{ label: "編集", run: (id: string) => onRequestEdit(id, menu.x, menu.y) }] : []),
        ...(onDuplicate ? [{ label: "複製", run: onDuplicate, ...menuGuards?.duplicate }] : []),
        ...(onBringToFront ? [{ label: "前面", run: onBringToFront }] : []),
        ...(onSendToBack ? [{ label: "背面", run: onSendToBack }] : []),
        ...(onDelete ? [{ label: "削除", danger: true, run: onDelete, ...menuGuards?.delete }] : []),
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
      // ⚠️ **`pointercancel` は「やめる」**＝元の形へ戻す（#752 レビュー）。確定（`endDrag`）へ繋ぐと、
      // 「やめた」のに掴んだ所へ置かれる（この関数の doc と決定10 に反する）。
      onPointerCancel={(e) => { if (minePointer(e)) cancelDrag(); }}
      // 何もない所を押したら選択解除＋編集/メニューを閉じ、範囲選択（マーキー）を開始（要素/ハンドルの onPointerDown は stopPropagation 済み）。
      onPointerDown={(e) => {
        if (e.target !== e.currentTarget) return;
        onSelect(null); setEditingId(null); setMenu(null); // 空白クリック＝選択解除（ドラッグせず離せば解除のまま）
        lastTapRef.current = null; // 空白操作を挟んだら二度押し履歴を切る（#525-4 レビュー）
        if (e.button !== 0) return; // 左ボタンのみマーキー
        // 範囲選択（マーキー）開始：空白ドラッグで矩形を引き交差要素を選択（#274）。
        const p = toCanvas(e.clientX, e.clientY);
        try { ref.current?.setPointerCapture(e.pointerId); } catch { /* noop */ }
        claimDrag(e); // 範囲選択も**同じ作法**（しきい値・取り逃がしの救済・`Escape` の受け持ち）
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
            onPointerDown={(e) => routeElementPointerDown(e, el)}
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
              // ⚠️ **押下の経路と同じ関門**（#746-2）＝`onChangeText` を渡さない形式では編集に入らない。
              // ここが抜けていると、互換 `dblclick` が来る環境で**打てない編集欄**に入る。
              if (onChangeText == null || el.locked || el.kind !== FREE_ELEMENT_KIND.text || elGroup != null) return;
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
              background: selected ? "rgba(var(--color-primary-rgb), 0.08)" : "transparent",
              cursor: locked ? "default" : editing ? "text" : "move", // ロック中はドラッグ不可を示す

              // 回転（#208）：中心を軸に回す（既定の transform-origin=中心）。出力 SVG の rotate と一致。合成後の角度を使う。
              transform: rotated ? `rotate(${cg.rotation}deg)` : undefined,
            }}
          >
            {editing ? (
              <textarea
                autoFocus
                value={el.text ?? ""}
                onChange={(e) => { openTextGroup(); onChangeText?.(el.id, e.target.value); }}
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
            background: "rgba(var(--color-primary-rgb), 0.10)",
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
          onPointerDown={(e) => beginFrameDrag(e, activeGroup)}
          style={{
            position: "absolute",
            left: `${((activeGroupFrame.cx - activeGroupFrame.w / 2) / canvasW) * 100}%`,
            top: `${((activeGroupFrame.cy - activeGroupFrame.h / 2) / canvasH) * 100}%`,
            width: `${(activeGroupFrame.w / canvasW) * 100}%`,
            height: `${(activeGroupFrame.h / canvasH) * 100}%`,
            border: "2px solid var(--color-primary)",
            background: "rgba(var(--color-primary-rgb), 0.06)",
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

      {/* メニューの見た目・閉じ方は共有部品（`ContextMenu`）＝画面ごとに作り方が割れない（§6・ADR-0033）。 */}
      {menu && menuEl && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems.map((it) => ({
            label: it.label, danger: it.danger,
            // 押せない理由は**項目に添える**（消さずに理由を出す・#746-1）。
            disabled: it.disabled, disabledHint: it.disabledHint,
            onSelect: () => it.run(menu.id),
          }))}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
