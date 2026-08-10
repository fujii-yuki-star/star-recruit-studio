import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useEdgeAutoScroll } from "../hooks/useEdgeAutoScroll";
import { isKeyboardActivation, usePointerDrag } from "../hooks/usePointerDrag";
import { canvasPointAt, laneTimeAt, pointInRect, visibleRectOf } from "../timelineDrop";
import type { ScreenId } from "../data/mockData";
import { EXPORT_BLOCK_SOURCE, EXPORT_OWNER, exportStartBlock, isTimelineExportBusy, useTimelineStore } from "../store/timelineStore";
import { useExportLockStore } from "../store/exportLock";
import { canExport } from "../../infrastructure/ffmpegExport";
import { useNavigationGuard } from "../hooks/navigationGuard";
import { useProjectStore } from "../store/projectStore";
import { frameTimeSec, timelineDurationSec } from "../../domain/timeline/persistence";
import { effectiveFps, seekByFrames } from "../../domain/timeline/playback";
import { DEFAULT_ZOOM_INDEX, ZOOM_LEVELS, fitZoomIndex, stepZoomIndex, tickStepSec, zoomScrollLeft } from "../../domain/timeline/zoom";
import { CROP_MODE, CROP_MODE_DEFAULT, EASING, TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import type { Easing, EasingSpec } from "../../domain/enums";
import { EASE_IN_OUT_APPROX_CURVE, easingCurveOf } from "../../domain/project/keyframes";
import { EDIT_BLOCKED, VISUAL_CLIP_DURATION_SEC, clipCountOnTrack, moveClipIssue, placeableAudioTracks, placeableVisualTracks, trimClipIssue, visualPlacementIssue } from "../../domain/timeline/edit";
import { clipImageAssetIds, timelineImageAssetIds } from "../../domain/timeline/export";
import type { EditBlockedReason } from "../../domain/timeline/edit";
import { dimsForOrientation, MIN_BOX_SIZE_PX, ROTATION_DEG_MIN, ROTATION_DEG_MAX } from "../../domain/constants";
import { audioSourceKeyOfClip, isAudioClip, normalizedVolumePoints } from "../../domain/timeline/audio";
import { volumePointTimeAt } from "../../domain/timeline/volumePointEdit";
import { useUndoRedoShortcuts } from "../hooks/useUndoRedoShortcuts";
import { useTimelineHistoryGroup } from "../hooks/useHistoryGroup";
import { activatesOnSpace, shouldIgnoreShortcut, usesArrowKeys } from "../hooks/keyboardShortcut";
import { hasEscapeOwner, useEscapeOwner } from "../hooks/escapeOwners";
import type { Template } from "../../domain/template/types";
import { useTimelinePlayback } from "../hooks/useTimelinePlayback";
import { useTimelineAudio } from "../hooks/useTimelineAudio";
import type { CropMode, TimelineClipKind } from "../../domain/enums";
import type { TimelineClip } from "../../domain/timeline/types";
import "../components/timeline.css";
import { clipEndSec, validateTimelineDoc } from "../../domain/timeline/validateTimelineDoc";
import { layoutTimelineAt } from "../../renderer/timelineLayout";
import { timelineExportBlockers } from "../../domain/timeline/export";
import { danglingSubtitleLinks, subtitleTextOf } from "../../domain/timeline/subtitleLink";
import { animationOriginSec, keyframeTimeAt } from "../../domain/timeline/keyframeEdit";
import type { KeyframeInput, KeyframeProp } from "../../domain/timeline/keyframeEdit";
import { groupElementIds } from "../../domain/project/groupOps";
import type { Keyframe } from "../../domain/project/types";
import { VOICE_CATALOG } from "../../domain/voice/voiceCatalog";
import { BGM_CATALOG } from "../../domain/bgm/bgmCatalog";
import type { BundledBgmId } from "../../domain/bgm/bgmCatalog";
import { CLIP_SPEED_MAX, CLIP_SPEED_MIN, FPS, TIMELINE_LABEL_W_PX, TIMELINE_MIN_CLIP_SEC, VOLUME_MAX, VOLUME_MIN, VOLUME_POINTS_MAX, VOLUME_STEP } from "../../domain/constants";
import { NARRATION_STATUS } from "../../domain/enums";
import { EXPORT_RUN_PHASE } from "../../domain/export/exportProgress";
import { creditSpeakerAt } from "../../domain/timeline/credit";
import { creditForLine, creditForSpeaker } from "../../domain/voice/narratorCredit";
import { fontFamilyForId } from "../../domain/font/fontCatalog";
import { getVoicevoxSpeaker } from "../../infrastructure/appSettings";
import { layoutToSvg } from "../../renderer/sceneSvg";
import { PageHead } from "../components/ui";
import { DeleteConfirm } from "../components/DeleteConfirm";
import { ContextMenu } from "../components/ContextMenu";
import { UndoRedoButtons } from "../components/UndoRedoButtons";
import { isTargetLocked } from "../../domain/timeline/keyframeEdit";
import { NumberField } from "../components/NumberField";
import { CollapsibleSection } from "../components/CollapsibleSection";
import { SECTION_SCOPE } from "../components/sectionOpen";
import type { ContextMenuItem } from "../components/ContextMenu";
import { AssetImportButton } from "../components/AssetImportButton";
import { PickerList } from "../components/PickerList";
import { PanelLayoutView } from "../components/layout/PanelLayoutView";
import type { PanelSpec } from "../components/layout/PanelLayoutView";
import { usePanelLayout } from "../components/layout/usePanelLayout";
import { PANEL_REGION, PANEL_SCREEN, SPLIT_DIR, addPanelToRegion, emptyLayout } from "../../domain/layout/panelLayout";

/**
 * この画面が持つ欄（配置に出てくる id の集合＝知らない欄を落とす基準）。**値集合にする**＝
 * 綴り違いで `normalizeLayout` に落とされ、**欄が黙って消える**のを防ぐ（§2-7）。
 */
/** 置ける部品の種類（素材・文字・図形）。 */
type VisualKind = typeof TIMELINE_CLIP_KIND.slot | typeof TIMELINE_CLIP_KIND.text | typeof TIMELINE_CLIP_KIND.shape;

/** つかんで運んでいる最中の状態（#684）。`drop` が null＝落とし先の外。 */
type DragPlace = {
  kind: VisualKind;
  assetId?: string;
  /** いまのポインタ位置（ゴーストを出す場所）。 */
  x: number;
  y: number;
  drop: {
    /** 列へ落としたとき（時刻と列を指した）。 */
    at?: { trackId: string; startSec: number };
    /** 仕上がり確認へ落としたとき（動画の中の場所を指した）。 */
    center?: { x: number; y: number };
    /** 置けない理由（null＝置ける）。**ゴーストの色に使う**＝離したときの結果と同じ判定から採る。 */
    issue: EditBlockedReason | null;
  } | null;
};

const PANEL_ID = {
  preview: "preview",
  arrange: "arrange",
  selected: "selected",
  templates: "templates",
  place: "place",
  audio: "audio",
  voice: "voice",
} as const;
const PANEL_IDS = Object.values(PANEL_ID);
import { ArrowLeftIcon } from "../components/icons";
import { LEAVE_BLOCKED_EXPORTING_MESSAGE, clipLabel, clipRangeTitle, editBlockedMessage, freeShapeLabel, exportBlockedMessage, slotLabelsFor, SUBTITLE_TEXT_FIELD_LABEL, textKeyLabel, TIMELINE_SAVE_FAILED_MESSAGE, timelineSaveStatusLabel, trackLabel, VOLUME_POINTS_OVERRIDE_HINT } from "../uiLabels";
import { templateSlotIds, usedTextKeys } from "../../domain/template/layerOps";
import { templatesForOrientation } from "../../infrastructure/templateFs";
import { ASSET_TYPE, CROP_ALIGN_X, CROP_ALIGN_Y, FREE_SHAPE_TYPE, FREE_SHAPE_TYPES, SLOT_TYPE } from "../../domain/enums";
import type { FreeShapeType } from "../../domain/enums";
import { DEFAULT_FIT } from "../../domain/constants";
import { FONT_WEIGHT, TEXT_ALIGN } from "../../domain/enums";
import type { FontWeight, TextAlign } from "../../domain/enums";
import { FontPicker } from "../components/FontPicker";
import { DEFAULT_SHAPE_COLOR } from "../../domain/project/freeLayoutOps";
import { DEFAULT_FONT_SIZE, DEFAULT_TEXT_COLOR } from "../../domain/template/textStyle";
import { isFreeSlotAssetType } from "../../domain/enums";
import { ColorPicker } from "../components/ColorPicker";
import { FitSelect } from "../components/FitSelect";
import type { CropAlignX, CropAlignY } from "../../domain/enums";
import type { Asset } from "../../domain/project/types";
import type { Layer } from "../../domain/template/types";
import { canHaveBox, resolveClipBox } from "../../domain/timeline/box";
import { FreeLayoutOverlay } from "../components/FreeLayoutOverlay";
import type { FreeElement } from "../../domain/project/types";
import type { FreeElementKind } from "../../domain/enums";
import { clipIsLiveAt } from "../../renderer/timelineLayout";

interface TimelineProjectScreenProps {
  onNavigate: (screen: ScreenId) => void;
}

/** 編集してから自動保存するまでの待ち（ms）。連続操作のたびに書かないための間。 */
const AUTOSAVE_DELAY_MS = 800;

/** 「前へ／後ろへ」1回で動かす秒。細かすぎず粗すぎない刻み（再生位置へ寄せる操作と併用する前提）。 */
const NUDGE_SEC = 0.5;

/** 1秒あたりの表示幅（px）と、レーンの最小幅。読み取り専用タイムラインと同じ見え方に寄せる。 */
const MIN_LANE_WIDTH_PX = 640;
/**
 * 取っ手を出す最小の帯の幅（px・#686 レビュー）。左右の取っ手（7px×2）と「⋮」（14px）で 28px を食うので、
 * 短い帯／低い倍率では**本体を掴む所が無くなる**（動かせなくなる）。狭いときは取っ手を出さず、
 * 長さは数値の欄で変えてもらう＝**ドラッグ専用の操作を作らない**（決定19）ので行き止まりにならない。
 */
const CLIP_HANDLE_W_PX = 7;
const CLIP_MENU_W_PX = 14;
/**
 * 取っ手を出す最小の帯の幅（px）。左右の取っ手と「⋮」が食うぶん＋本体を掴む余地。
 * ⚠️ **幅は TS 側が単一の参照元**（`--timeline-label-w` と同じ流儀＝CSS へ流し込む）。
 * CSS にだけ書くと、値を変えたときにこの下限が黙って合わなくなる（計算と描画が食い違う）。
 */
const CLIP_HANDLES_MIN_W_PX = CLIP_HANDLE_W_PX * 2 + CLIP_MENU_W_PX + 16;

/** 列の名前の欄の幅。**単一の参照元は `TIMELINE_LABEL_W_PX`**（見わたす画面も同じ値を読む・#742 レビュー）。 */
const LANE_LABEL_PX = TIMELINE_LABEL_W_PX;

/** 列の種別ごとの色分け（読み取り専用タイムラインの既存クラスを使い回す＝見え方を揃える）。 */
/**
 * 帯の色（#701）。**部品の種類ごと**に分ける＝列の種類（映像／音）の2色だけだと、
 * 見た目パターン・写真・文字・図形・字幕が全部同じ色になり、並びを見ても何が置いてあるか読めない。
 *
 * ⚠️ **網羅で書く**（`satisfies` ＋ 添字）＝種類が増えたときに**コンパイルで気づく**。
 * 既定へ落とすと、新しい種類が黙って別の何かと同じ色になる（`resolveTransition` の
 * 「網羅 switch で書く」＝ADR-0032 決定19 と同じ流儀）。CSS の階級は既に用意されている。
 */
const CLIP_KIND_CLASS = {
  [TIMELINE_CLIP_KIND.template]: "timeline-clip--video",
  [TIMELINE_CLIP_KIND.slot]: "timeline-clip--video",
  [TIMELINE_CLIP_KIND.text]: "timeline-clip--telop",
  [TIMELINE_CLIP_KIND.subtitle]: "timeline-clip--telop",
  [TIMELINE_CLIP_KIND.shape]: "timeline-clip--shape",
  [TIMELINE_CLIP_KIND.audio]: "timeline-clip--bgm",
  [TIMELINE_CLIP_KIND.voice]: "timeline-clip--audio",
} as const satisfies Record<TimelineClipKind, string>;


/**
 * その差し込み口に入れられる素材（場面編集の `assignableFor` と同じ規則）。
 * **動画は出さない**＝タイムライン形式では動かず音も鳴らないので（書き出しも断る・#631）、
 * 選べるのに使えない選択肢を並べない（§2-5）。すでに入っている動画は「なし」で外せる。
 */
/**
 * いま入っているのに選択肢に出せない素材（＝動画）。`<select className="select">` の value に合う option が無いと**空欄**になり
 * 「なし」と見分けが付かないので、名前だけ出す（選び直しはできない＝`disabled`）。
 */
function unselectableCurrent(assets: readonly Asset[], assetId: string | null | undefined, layer: Layer): Asset | undefined {
  if (!assetId) return undefined;
  if (assignableAssets(assets, layer).some((a) => a.assetId === assetId)) return undefined;
  return assets.find((a) => a.assetId === assetId);
}

function assignableAssets(assets: readonly Asset[], layer: Layer): Asset[] {
  return assets.filter((a) => {
    if (a.assetType === ASSET_TYPE.video) return false;
    if (layer.type === "logo") return a.assetType === ASSET_TYPE.logo || a.assetType === ASSET_TYPE.image;
    if (layer.slotType === SLOT_TYPE.video) return false;
    return a.assetType === ASSET_TYPE.image;
  });
}

/** 切り抜きの4辺（#634）。%で入れる（保存は割合＝0〜1未満）。 */
const CROP_EDGES: { edge: 'top' | 'right' | 'bottom' | 'left'; label: string }[] = [
  { edge: 'top', label: '上を隠す（%）' },
  { edge: 'bottom', label: '下を隠す（%）' },
  { edge: 'left', label: '左を隠す（%）' },
  { edge: 'right', label: '右を隠す（%）' },
];

/**
 * 「動き」の入力欄（#634）。**値は「本来の見た目からのずれ」**（絶対値ではない＝`Keyframe` の意味）。
 * `neutral` は「動かさない」ときの値で、欄の**プレースホルダ**に出す（勝手に入れない＝空欄は触らない）。
 */
const KEYFRAME_FIELDS: { prop: KeyframeProp; label: string; neutral: number; step: number }[] = [
  { prop: 'x', label: '横のずれ（px）', neutral: 0, step: 10 },
  { prop: 'y', label: '縦のずれ（px）', neutral: 0, step: 10 },
  { prop: 'scale', label: '大きさ（倍）', neutral: 1, step: 0.1 },
  { prop: 'rotation', label: '傾き（度）', neutral: 0, step: 5 },
  { prop: 'opacity', label: '濃さ（0〜1）', neutral: 1, step: 0.1 },
];

/** 入力欄 → 置く値。**空欄は触らない**（`undefined`）・値が入っていればその数だけずらす。 */
function keyframeInputFromDraft(draft: Partial<Record<KeyframeProp, string>>): KeyframeInput {
  const out: KeyframeInput = {};
  for (const f of KEYFRAME_FIELDS) {
    const raw = draft[f.prop];
    if (raw == null || raw.trim() === '') continue;
    const v = Number(raw);
    if (Number.isFinite(v)) out[f.prop] = v;
  }
  return out;
}

/** 置いてあるキーフレーム → 入力欄（「この位置の値を読み込む」）。 */
function draftFromKeyframe(k: Keyframe | undefined): Partial<Record<KeyframeProp, string>> {
  if (!k) return {};
  const out: Partial<Record<KeyframeProp, string>> = {};
  for (const f of KEYFRAME_FIELDS) {
    const v = k[f.prop];
    if (v != null) out[f.prop] = String(v);
  }
  return out;
}

/** 「自由なカーブ」を表す選択肢の値（保存する値ではなく画面の選択肢＝制御点は別に持つ）。 */
const CURVE_CHOICE = 'curve';

/** カーブの制御点の入力欄。x は 0〜1（時間が戻らない）・y は範囲外も可（行き過ぎて戻る動き）。 */
const CURVE_FIELDS: { label: string; clamped: boolean }[] = [
  { label: '始めの強さ', clamped: true },
  { label: '始めの向き', clamped: false },
  { label: '終わりの強さ', clamped: true },
  { label: '終わりの向き', clamped: false },
];

/** 「自由なカーブ」にするときの初期値＝いまの動き方と同じ形（表せないものは近い形＝画面が断る）。 */
function curveSeedOf(easing: EasingSpec | undefined): [number, number, number, number] {
  return easingCurveOf(easing) ?? EASE_IN_OUT_APPROX_CURVE;
}

/** 制御点の1つを読む／差し替える（`easing` がカーブでないときは初期値から作る）。 */
function curveValue(easing: EasingSpec | undefined, i: number): number {
  return curveSeedOf(easing)[i];
}

function withCurveValue(easing: EasingSpec | undefined, i: number, v: number): EasingSpec {
  const b = [...curveSeedOf(easing)] as [number, number, number, number];
  b[i] = Number.isFinite(v) ? v : 0;
  return { bezier: b };
}

/** 動き方（イージング）の選び方。**自由なカーブ**は制御点を直接入れる（#262）。 */
const EASING_CHOICES: { value: string; label: string }[] = [
  { value: EASING.linear, label: '一定' },
  { value: EASING.easeIn, label: 'ゆっくり始まる' },
  { value: EASING.easeOut, label: 'ゆっくり終わる' },
  { value: EASING.easeInOut, label: '両端ゆっくり' },
  { value: CURVE_CHOICE, label: '自由なカーブ' },
];

/** その動き方が「自由なカーブ」かどうか（選択肢の値へ）。 */
function easingChoiceOf(easing: EasingSpec | undefined): string {
  if (easing == null) return EASING.linear;
  return typeof easing === 'string' ? easing : CURVE_CHOICE;
}

/** キーフレーム1つの中身を一行で（§2-3：技術用語を出さない）。 */
function keyframeSummary(k: Keyframe): string {
  const parts = KEYFRAME_FIELDS.filter((f) => k[f.prop] != null).map((f) => `${f.label} ${k[f.prop]}`);
  return parts.length > 0 ? parts.join('・') : '（値なし）';
}

/**
 * タイムライン編集プロジェクトの画面（ADR-0032・#629 骨格）。
 *
 * 見て確かめる（その瞬間の仕上がり・列と部品の並び）と、置く・動かす・重ねる・消すができる。
 * 描画は `layoutTimelineAt`（場面形式と核を共有）を通すので、ここで見えているものが書き出しの土台と
 * 同じ（ADR-0001）。編集は少し待って自動保存する（閉じても消えない）。
 */
export function TimelineProjectScreen({ onNavigate }: TimelineProjectScreenProps) {
  const {
    doc, loadError, isLoading, playheadSec, selectedClipIds, assetSrcById, audioSrcByKey, assetSizes, setAssetSize, editBlocked, history, exportRun,
    setPlayhead, selectClip, selectClips, clearSelection, moveSelectedClip, trimSelectedClip, moveClipById, trimClipById, setEditBlocked, setSelectedClipBox, setClipBoxFor, setClipBoxesFor, duplicateSelectedClip, removeSelectedClips, removeClipsByIds,
    addTrack, removeTrack, moveTrackOrder, setTrackFlag, undo, redo, saveTimelineProject, saveStatus,
    isPlaying, play, pause, exportTimelineVideo, cancelTimelineExport, dismissTimelineExport,
    setSelectedClipAssetRef, setSelectedClipText, addTemplateClip, explodeClip, setSelectedSubtitleVoiceLink, setSelectedSubtitleText,
    addVoiceClip, setSelectedVoiceText, setSelectedVoiceSpeaker, generateSelectedVoice, addLinkedSubtitleClip, voiceError, generatingVoiceClipId,
    setSelectedKeyframeAt, removeSelectedKeyframe, clearSelectedKeyframes, clearKeyframesOf,
    addAudioClip, addVisualClip, setSelectedVisualContent, setSelectedClipSpeed, setSelectedClipSourceStart, setSelectedClipVolume, setSelectedClipAudioSource, setSelectedClipFade,
    setSelectedClipCrop, setSelectedClipCropAlign, setSelectedClipCropMode,
    setSelectedVolumePoint, removeSelectedVolumePoint, clearSelectedVolumePoints,
    addAsset, addAssetByPath, importError, clearImportError, isImporting,
  } = useTimelineStore();

  // 連続再生の時計（再生中だけ回る）。見せる時刻の決め方は domain（`playbackTick`）に委ねる。
  useTimelinePlayback();
  // 音は「その瞬間に鳴っているもの」を時刻から決めて鳴らす（絵と同じ時刻を見る＝ずれない）。
  useTimelineAudio();

  // 取り消し/やり直しのキー操作は**この画面の store** へ繋ぐ（既定は場面形式を巻き戻すので渡さない＝
  // 見えていない文書を戻して自動保存が永続化する事故を作らない・#547 P1-1 と同じ筋）。
  useUndoRedoShortcuts(true, { undo, redo });

  // **文字を打っている間は1つの取り消しにまとめる**（#708）。1文字ごとに積むと、上限まで文字入力で
  // 埋まり、それ以前の編集（バラすなど）が取り消せなくなる。場面形式と同じ仕組み（ADR-0026②）。
  // 文字欄（`textGroup`）と、**面をドラッグする色選び**（`beginHistoryGroup`/`endHistoryGroup`）。
  // 色の面は `pointermove` ごとに値を返すので、区切りが無いと**ひと撫でで数十〜百件**の履歴が積まれ、
  // この形式は**文書まるごとのスナップショット**なので上限（50）を一撫でで食い潰す（#720）。
  const { textGroup } = useTimelineHistoryGroup();
  const beginHistoryGroup = useTimelineStore((s) => s.beginHistoryGroup);
  const endHistoryGroup = useTimelineStore((s) => s.endHistoryGroup);


  // 編集したら少し待って自動保存する（場面形式と同じ「閉じても消えない」＝ADR-0026②）。
  // 連続操作のたびに書かないよう間を置く。保存中の再編集は `saveTimelineProject` 側で見る。
  // **失敗（`error`）のときは自動で繰り返さない**＝同じ理由で失敗し続ける間ディスクを叩き続けても直らないので、
  // 画面に理由と「保存し直す」を出して利用者に返す（#693・§2-5）。次の編集で `idle` に戻れば自動保存も再開する。
  const saveTimer = useRef<number | null>(null);
  const historyDepth = useTimelineStore((s) => s._historyGroupDepth);
  useEffect(() => {
    // **連続入力の最中は保留する**（#708 レビュー・場面形式の `useAutoSave` と同じ）。
    // 打っている間は1文字ごとに未保存へ戻るので、これが無いと**打っている間ずっと**全文書を
    // 書き直し続ける（デバウンスのつもりが約800msごとの繰り返しになる）。
    if (saveStatus !== "idle" || historyDepth > 0) return;
    if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void saveTimelineProject(), AUTOSAVE_DELAY_MS);
    return () => {
      if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
    };
  }, [saveStatus, historyDepth, saveTimelineProject]);
  // **画面を離れるときは、待っている保存を書き切る**（#693）。自動保存のタイマはこの画面のものなので、
  // 書くより前に離れると上の後始末でタイマごと消え、直前の編集が**無言で**失われていた（サイドバーからの
  // 移動も同じ）。場面形式は自動保存が常時ある層に載っていてこの穴が無い＝形式で挙動を割らない（ADR-0026②）。
  // 依存を持たない effect にして**アンマウントのときだけ**走らせる（張り直しのたびに保存しない）。
  useEffect(() => () => {
    // 画面を離れるときも畳む（開いたまま離れると、次に開いた文書で取り消しが積まれない）。
    useTimelineStore.getState().resetHistoryGroup();
    if (useTimelineStore.getState().saveStatus === "idle") void useTimelineStore.getState().saveTimelineProject();
  }, []);
  const templates = useProjectStore((s) => s.templates);
  // テンプレが持つ既定素材（ADR-0021）は全プロジェクト共通の置き場にある＝場面形式のプレビュー・書き出しと
  // 同じフォールバック（素材 → テンプレ既定素材）を通す。無いと同じ見た目が場面形式と違う絵になる（ADR-0026②）。
  const templateAssetSrcById = useProjectStore((s) => s.templateAssetSrcById);

  const [removingTrackId, setRemovingTrackId] = useState<string | null>(null);
  // **まとめて消すときの確認**（`06 §2` 統一規約1・ADR-0034 決定20）。**聞いた時点の相手を持つ**
  // （#721 レビュー）＝この確認は覆いではなく知らせの段なので、出したまま帯を押したり `Ctrl+A` したりできる。
  // 数だけ持つと「3個消しますか」と聞いて1個だけ消える／全部消える、が起きる（`exploding` と同じ流儀）。
  const [confirmRemove, setConfirmRemove] = useState<string[] | null>(null);
  // 保存できていないまま一覧へ戻ろうとしているか（#693）。戻ると変更は失われるので、黙って捨てずに聞く。
  /**
   * 離れてよいか聞いている最中の**行き先**（`null`＝聞いていない・#719）。
   * 行き先を持たないと、サイドバーから離れようとしたときに「一覧へ」しか戻れない。
   */
  const [confirmLeave, setConfirmLeave] = useState<ScreenId | null>(null);
  // 戻る前の保存を待っているか（#693 レビュー）。待っている間は二重に押せないようにする。
  const [leaving, setLeaving] = useState(false);
  /**
   * 一覧へ戻る（#693）。**保存が済むまで待ってから**離れる＝書いている途中（`saving`）に離れると、
   * そのあと失敗しても利用者はもう別の画面にいて気づけない（確認も出ない）。
   * 失敗していたら離れずに確認を出す＝「保存し直す」を押しに戻れる。
   */
  // 確認に「はい」と答えた1回だけ通す目印（答えた直後もまだ保存は失敗のままなので、
  // これが無いと同じ確認が出続けて**永久に離れられない**）。
  const leaveConfirmedRef = useRef(false);
  // 走っている「離れる流れ」の行き先（`null`＝走っていない）。押し直されたら**行き先だけ**差し替える。
  const leavingToRef = useRef<ScreenId | null>(null);
  // 離れられない理由（書き出し中）。**黙って止めない**＝押しても何も起きない画面にしない（§2-5）。
  const [leaveBlocked, setLeaveBlocked] = useState<string | null>(null);
  // 画面を離れた後に、終わった保存が遷移を撃たないようにする（行き先が勝手にすり替わる・#719 レビュー）。
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  /**
   * **画面を離れる（どの入口からでも同じ流れ）**（#693・#719）。
   *
   * `leaveToHome` と関門で規則が割れていたのが #719 の穴だった＝画面内ボタンは「書き切ってから離れる／
   * 失敗したら聞く」なのに、サイドバーは `error` のときしか止まらず、**保存待ち・保存中は素通し**していた。
   * 抜けた後はアンマウントの投げっぱなし保存だけが頼りで、それが失敗しても告知の担い手が居ない
   * （この画面は自動保存＋共通トップバーの保存ボタンを出さない＝ADR-0032）。**規則をここ1か所から配る**。
   */
  const requestLeave = useCallback(async (to: ScreenId) => {
    // 書き出し中は離れない（進捗も中止も画面の中にしかない）。確認ではなく**理由**で断る。
    if (isTimelineExportBusy(useTimelineStore.getState().exportRun.phase)) {
      setLeaveBlocked(LEAVE_BLOCKED_EXPORTING_MESSAGE);
      return;
    }
    // **離れる流れは同時に1つだけ**（#729 レビュー）。保存を待っている間（~1秒）に別の行き先を押すと、
    // 待ちが明けたとき2つの流れが**それぞれ `onNavigate` を撃つ**＝一瞬だけ先の行き先を描いてから
    // 次へ飛ぶ（確認が要る場合は行き先だけが後から上書きされる）。走っている流れがあれば
    // **行き先を最後に押したものへ差し替えて託す**＝遷移は1回、着地は最後に押した所（§2-5）。
    const running = leavingToRef.current != null;
    leavingToRef.current = to;
    // ⚠️ この `return` を外しても着地は変わらない（先に着いた流れが下で目印を落とすので、後続は
    // 行き先が `null` になって黙って降りる）。**外さない**のは、2つ目の流れが走っている保存へ
    // 合流しようとして**もう一度書きに行く**のと、「保存しています」の立て下げが二重になるため。
    // ＝不変条件（離れる流れは同時に1つ）を**暗黙の後片づけ任せにせず、ここで明示する**。
    if (running) return;
    try {
      const status = useTimelineStore.getState().saveStatus;
      // 待つのは**まだ書けていないとき**だけ（`saved` は書き終わっている＝待つと無駄に書き直す）。
      if (status === "idle" || status === "saving") {
        setLeaving(true);
        // `idle`＝待っている保存を今書く／`saving`＝走っている保存に合流する（どちらも同じ入口）。
        try {
          await useTimelineStore.getState().saveTimelineProject();
        } finally {
          setLeaving(false);
        }
      }
      if (!aliveRef.current) return; // 待っている間に画面を離れていたら、勝手に行き先を変えない
      const dest = leavingToRef.current; // 待っている間に押し直された行き先を採る
      if (dest == null) return;
      if (useTimelineStore.getState().saveStatus === "error") {
        setConfirmLeave(dest);
        return;
      }
      leaveConfirmedRef.current = true;
      onNavigate(dest);
    } finally {
      // 断られて画面に残るとき（保存失敗の確認）に次の操作を塞がない＝押しても何も起きない画面にしない。
      leavingToRef.current = null;
    }
  }, [onNavigate]);

  /**
   * **どの入口から離れようとしても、同じ関門を通す**（#719）。
   *
   * 名乗りは**常に**出す（`error` のときだけにすると、保存待ち・保存中の離脱が素通しになる＝#719 レビュー）。
   * 通してよいかは `requestLeave` が決め、通すときだけ目印を立てて自分で遷移する。
   */
  useNavigationGuard((to) => {
    if (leaveConfirmedRef.current) {
      leaveConfirmedRef.current = false;
      return true;
    }
    void requestLeave(to);
    return false;
  });

  /** 「動画の一覧へ」。入口が違うだけで**規則は関門と同じ**（`requestLeave`）。 */
  const leaveToHome = useCallback(() => { void requestLeave("home"); }, [requestLeave]);
  // 見た目パターンを置く先の列（消された/固定されたときは置くときに実在するものへ落とす）。
  const [placeTrackId, setPlaceTrackId] = useState<string>("");
  // 音・読み上げの置く先（見た目パターンと同じ流儀＝#724。空＝いちばん手前の置ける列）。
  const [placeAudioTrackId, setPlaceAudioTrackId] = useState<string>("");
  // 「動き」の入力欄（文字列で持つ＝空欄＝その項目は動かさない）。
  const [kfDraft, setKfDraft] = useState<Partial<Record<KeyframeProp, string>>>({});
  // 音量の変化（#512 段4）の入力欄。**空欄のままでは置かない**（0 と空欄を取り違えない）。
  const [volumeDraft, setVolumeDraft] = useState("");
  // **選ぶ部品が変わったら下書きを片づける**（#701・監査 §2.2-9）＝別の部品に前の入力が残っていると、
  // 「置く」を押した瞬間に**打った覚えのない値**が入る。選択の id そのものを見る（並び替えでは消さない）。
  const selectedKey = selectedClipIds.join(",");
  const lastSelectedKey = useRef(selectedKey);
  useEffect(() => {
    if (lastSelectedKey.current === selectedKey) return;
    lastSelectedKey.current = selectedKey;
    setKfDraft({});
    setVolumeDraft("");
    // 文字欄はフォーカス中に消えると `blur` が来ない＝まとめが開きっぱなしになる（#708 レビュー）。
    // 欄が入れ替わるここで必ず畳む（ドラッグが `window` で終了を拾うのと同じ役割）。
    useTimelineStore.getState().resetHistoryGroup();
  }, [selectedKey]);
  // 右クリック（または「⋮」）で開く列の操作メニュー（ADR-0033）。
  const [trackMenu, setTrackMenu] = useState<{ trackId: string; x: number; y: number } | null>(null);
  // 帯の右クリックメニュー（#701）。列の行と**同じ作法**（右クリック＋「⋮」の逃げ道）。
  const [clipMenu, setClipMenu] = useState<{ clipId: string; x: number; y: number } | null>(null);

  // 欄の配置（ADR-0033 段階2）。**既定は「再生位置と『選んだ部品』が同時に見える」形**にする
  // ＝#512 の実機確認で露呈した「1点置くごとに上下スクロール」を、設定を変えないままでも起こさない。
  const defaultLayout = useMemo(() => {
    const l = emptyLayout();
    l.nodes.center = { panelId: PANEL_ID.preview };
    l.nodes.right = { panelId: PANEL_ID.selected };
    l.nodes.bottom = { panelId: PANEL_ID.arrange };
    l.nodes.left = {
      dir: SPLIT_DIR.column,
      sizes: [1 / 4, 1 / 4, 1 / 4, 1 / 4],
      // **置くものは上から**（写真・文字・図形 → 見た目パターン → 音 → 読み上げ）＝#684。
      // 素材を置くのがいちばん多い操作なので先頭に出す（他社も素材の欄が最上位＝#683 の調査）。
      children: [
        { panelId: PANEL_ID.place },
        { panelId: PANEL_ID.templates },
        { panelId: PANEL_ID.audio },
        { panelId: PANEL_ID.voice },
      ],
    };
    return l;
  }, []);
  // 既存の `layout`（仕上がり確認の並べ方）と名前がぶつからないよう、欄の配置は `panelLayout` と呼ぶ。
  // 出し入れは**共通のフック**（画面ごとに書き写さない・§6）。
  const { layout: panelLayout, change: changeLayout, reset: resetLayout, closed } =
    usePanelLayout(PANEL_SCREEN.timeline, defaultLayout, PANEL_IDS);

  // 「バラす」は戻せない（取り消しでだけ戻る）＝押す前に断る（ADR-0032 未解決6 の決着・§2-5）。
  // **聞いた時点の相手を組で持つ**（#701 レビュー）。id だけだと、確認の表示条件が「いま選んでいる部品」に
  // 依存してしまい、選択が変わると**確認が消えたように見えて状態だけ残る**。同じ見た目パターンの別の部品を
  // 選ぶと確認が復活し、押すと**画面で選んでいない方**がバラされる（バラすは取り消しでしか戻らない）。
  const [exploding, setExploding] = useState<{ clipId: string; template: Template } | null>(null);
  // `Escape` の順番を決める材料（#701 レビュー）。**答えを求める確認とメニュー**が開いている間は選択を解かない。
  // 答えを求める確認は**自分では `Escape` を処理しない**（答えるまで残す）ので、ここで名乗る側に回る。
  // ⚠️ **確認を足したらここへ必ず並べる**（#721 の実機確認で漏れが出た）＝入れ忘れると、確認を出したまま
  // `Escape` で**背後の選択だけが解け**、そのまま「削除する」を押しても何も起きない（§2-5）。
  // `Space`・`Delete`・矢印もこの値で塞いでいるので、漏れると**答えを求めている最中に別の操作が通る**。
  const overlayOpen =
    exploding !== null || removingTrackId !== null || confirmLeave !== null || confirmRemove !== null;
  useEscapeOwner(overlayOpen);

  // 選択のキー操作（ADR-0034 決定15/18）。**入力欄と日本語の変換中は奪わない**（共有の判定を通す）。
  /**
   * キー操作が見る**いまの値**（#721）。依存に足すと、再生位置が1フレーム進むたびに `keydown` を
   * 登録し直すことになる（毎フレームの付け外し）。閉じ込めた古い値を見ないよう、下の効果で入れ替える。
   */
  const playRef = useRef({ playing: false, total: 0, fps: FPS, play, pause, seekFrames: (_frames: number) => {} });
  const removeRef = useRef<() => void>(() => {});

  // `Escape`＝選択を解く／`Ctrl+A`＝全部選ぶ／`Space`・`Delete`・`←→`（#721・決定18）。
  // **ドラッグ専用の操作を作らない**（決定19）ための土台でもある。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shouldIgnoreShortcut(e)) return;
      if (e.key === "Escape") {
        // **手前のものから1段ずつはがす**（#701 レビュー）＝`Escape` を自分で受け持っているものがある間は、
        // いちばん外側の後始末（選択を解く）を走らせない。一緒に解くと、メニューを閉じただけで
        // **打ちかけの値が消える**（選択が変わると下書きを片づけるため）。
        // 受け手は**自分で名乗る**（`escapeOwners`）＝画面が数え上げると、受け手が増えるたびに数え漏れる。
        if (overlayOpen || hasEscapeOwner()) return;
        clearSelection();
        return;
      }
      // **答えを求める確認・メニュー・ポップアップが出ている間は、ここから先を通さない**（#721 レビュー）。
      // `Ctrl+A` より**前**に置く＝「3個消しますか」の表示中に全選択できると、聞いた数と消える数がずれる。
      // 見る材料は `Escape` と同じ（`overlayOpen` だけだと、名乗っているだけのメニュー・色の面を素通りする）。
      if (overlayOpen || hasEscapeOwner()) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        // 対象が無くても**既定の全選択には落とさない**（同じキーの結果が2通りになる＝画面の文字が反転する）。
        e.preventDefault();
        const ids = useTimelineStore.getState().doc?.clips.map((c) => c.id) ?? [];
        if (ids.length > 0) selectClips(ids);
        return;
      }
      // ここから下は**修飾キーの付いていない単独キー**だけ（`Ctrl+←` 等は OS/ブラウザのものを奪わない）。
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === " ") {
        // **押した要素が `Space` で反応するなら、そちらに譲る**（消すボタンを押したら消えたうえに再生が
        // 始まる、を作らない）。一律で奪うと画面じゅうのボタンがキーボードで押せなくなる。
        if (activatesOnSpace(e.target)) return;
        e.preventDefault(); // 既定の「画面を下へ送る」を止める
        if (playRef.current.total <= 0) return; // 置いていないときは再生できない（ボタンと同じ条件）
        if (playRef.current.playing) playRef.current.pause();
        else playRef.current.play();
        return;
      }
      if (e.key === "Delete") {
        e.preventDefault();
        removeRef.current(); // 押せる条件・確認の有無はボタンと同じ入口が決める
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        // **矢印を使う要素に手がかかっているなら譲る**（`Space` と同じ理由・同じ形＝ADR-0026②）。
        // 譲らないと、セレクトやスライダーにフォーカスしたまま押したとき**その欄の値が変わらず
        // 再生位置だけ動く**（この画面はセレクトが多い）。
        if (usesArrowKeys(e.target)) return;
        // **1フレームずつ・`Shift` で1秒**（決定18）。⚠️ 部品を選んでいる間のナッジはキャンバス操作
        // （#685）が入ってから＝いま足すと、動かす手段が無いのに矢印だけ意味を変えることになる。
        e.preventDefault();
        const p = playRef.current;
        if (p.total <= 0) return;
        // **フレーム番号で動かす**（秒を足し込むと誤差が積もって同じ絵に留まる／飛ぶ・#721 レビュー）。
        // `Shift` の「1秒」も同じ格子の上で数える（1秒 = fps フレーム）。
        const frames = (e.shiftKey ? p.fps : 1) * (e.key === "ArrowLeft" ? -1 : 1);
        p.seekFrames(frames);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clearSelection, selectClips, overlayOpen]);
  const totalSec = doc ? timelineDurationSec(doc) : 0;
  // 数値欄の刻み＝**1フレーム**（出力の格子と同じ・#721）。⚠️ **丸めない**＝`0.033` にすると格子から外れ、
  // 30回刻んで 0.99 秒にしかならない（「格子と同じ」という約束が嘘になる・#721 レビュー）。
  const frameStepSec = 1 / (doc ? effectiveFps(doc) : FPS);
  // 1つだけ選んでいるときが「動かせる」状態（複数選択はまとめて消すだけ＝対象が決まらない）。
  const selected = doc && selectedClipIds.length === 1 ? doc.clips.find((c) => c.id === selectedClipIds[0]) : undefined;
  const layout = useMemo(() => {
    if (!doc) return null;
    const byId = new Map(templates.map((t) => [t.templateId, t]));
    // 末尾ちょうどは1フレーム手前へ寄せる（半開区間で画面が真っ白になるのを防ぐ・`frameTimeSec`）。
    return layoutTimelineAt(doc, frameTimeSec(doc, playheadSec), { templateOf: (id) => byId.get(id), assetSizeOf: (id) => assetSizes[id] });
  }, [doc, playheadSec, templates, assetSizes]);

  /**
   * **いま測っている最中**の素材（#724）。**依存から `assetSizes` を外すため**に持つ。
   *
   * ⚠️ 以前は `assetSizes` を依存に入れており、この効果は**自分の出力**を依存にしていた＝1件測れるたびに
   * 後片づけが走って進行中の計測を全部無効化し、**未計測の素材ぶん `new Image()` を作り直していた**
   * （素材 N 件で最悪 O(N²)。実測＝4件で10回）。
   *
   * 持つのは「始めた」ではなく**「測っている最中」**（着地したら必ず外す）。「始めた」を残す形にすると、
   * **同じ動画を開き直したとき**（`assetSizes` は空へ戻るのに印は残る）**二度と測らず**、
   * 「枠いっぱいに映す」が黙って効かなくなる。済みかどうかは `assetSizes` が持ち、ここは重複起動だけを防ぐ
   * ＝2つの記録が食い違わない。
   */
  const measuringRef = useRef<Set<string>>(new Set());

  // 素材の**実寸**を測る（#634）。「枠いっぱいに映す」は素材の縦横比が要るが、保存データには
  // 絵の大きさが無い（動画だけ持っている）ので、表示に使っている src をブラウザで測って store へ入れる。
  // 測れたら描き直す＝プレビューと書き出しが同じ値を見る（ADR-0001）。
  useEffect(() => {
    const docId = doc?.projectId;
    if (!docId) return;
    const measuring = measuringRef.current;
    for (const [assetId, src] of Object.entries(assetSrcById)) {
      if (!src || measuring.has(assetId)) continue;
      // 済みの判定は**依存に足さずに今の値を見る**（上の ⚠️ の理由）。
      if (useTimelineStore.getState().assetSizes[assetId]) continue;
      measuring.add(assetId);
      const img = new Image();
      // **着地したら必ず外す**（成否によらず）＝残すと開き直しても測り直せない。
      img.onload = () => {
        measuring.delete(assetId);
        // 待っている間に別の動画になっていたら書かない（そちらの素材に古い大きさが混ざる）。
        if (useTimelineStore.getState().doc?.projectId !== docId) return;
        // 読めたのに大きさが取れなかった（0×0）ときは入れない＝失敗と同じ扱い。
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          setAssetSize(assetId, { w: img.naturalWidth, h: img.naturalHeight });
        }
      };
      // 測れないもの（動画など）は入れない＝そのクリップは「辺を隠す」表示のまま（画面が理由を出す）。
      // 外しておけば、この効果が次に走ったとき（別の素材が増えた・画面へ戻った）もう一度試す
      // ＝一度の失敗を永久に固定しない。
      img.onerror = () => { measuring.delete(assetId); };
      img.src = src;
    }
  }, [assetSrcById, doc?.projectId, setAssetSize]);

  // 見た目が見つからないクリップは**描かれない**（`layoutTimelineAt`）。黙って絵だけ消さずに知らせる（§2-5・#547 と同じ筋）。
  const missingTemplateCount = useMemo(() => {
    if (!doc) return 0;
    const known = new Set(templates.map((t) => t.templateId));
    return doc.clips.filter((c) => c.kind === TIMELINE_CLIP_KIND.template && !known.has(c.templateId ?? "")).length;
  }, [doc, templates]);
  // 選んだ部品が見た目パターンなら、その差し込み口と文字を編集できる（ADR-0032 決定5）。
  // 層の並び・種別は**描画と同じテンプレ**から採る＝画面に出ている枠と編集欄が食い違わない。
  const selectedTemplate = selected?.kind === TIMELINE_CLIP_KIND.template
    ? templates.find((t) => t.templateId === selected.templateId)
    : undefined;
  const slotLayers = selectedTemplate?.layers.filter((l) => templateSlotIds(selectedTemplate.layers).has(l.id)) ?? [];
  const slotNames = slotLabelsFor(slotLayers);
  // 固定した列の部品は中身も変えられない（domain 側で止まる）＝欄を押せなくして理由を出す
  // ＝入力しても黙って元へ戻る、を作らない（§2-5）。
  // 選んでいる部品の素材の実寸（#634）。分からないと「枠いっぱい」は効かせられない（画面が理由を出す）。
  const selectedSourceSize =
    selected?.kind === TIMELINE_CLIP_KIND.slot && selected.assetId ? assetSizes[selected.assetId] : undefined;
  const selectedLocked = !!selected && !!doc?.tracks.find((t) => t.id === selected.trackId)?.locked;
  /**
   * **選んでいるものの中に、固定した列のものがあるか**（#709 レビュー）。`selectedLocked` は
   * 「1つだけ選んでいるとき」しか立たないので、**まとめて消す**にはこちらを見る＝`Ctrl+A` で全部選んでから
   * 押すと、固定列の部品が混ざっていても押せてしまい「押してから断られる」に戻る。
   */
  const selectionHasLocked = selectedClipIds.some((id) => {
    const c = doc?.clips.find((x) => x.id === id);
    return !!c && !!doc?.tracks.find((t) => t.id === c.trackId)?.locked;
  });
  const lockedSelectionHint = "固定された列の部品が選ばれています。固定を外すか、選び直してください";
  const lockedHint = selectedLocked ? "この列は固定されています。変えるには固定を外してください" : undefined;
  const textKeys = selectedTemplate ? usedTextKeys(selectedTemplate.layers) : [];
  // 選んだ部品に付いている動き（キーフレーム）。時刻は対象の先頭からの秒なので、表示は起点を足す。
  const selectedOrigin = doc && selected ? animationOriginSec(doc, selected.id) ?? 0 : 0;
  const selectedKeyframes =
    doc && selected ? doc.animations?.find((a) => a.targetId === selected.id)?.keyframes ?? [] : [];
  // 再生位置が部品の中にあるか＋その時刻に置いてあるキーフレーム（あれば値を読み込める）。
  // 置ける位置か＝**終わりちょうどを含む**（`keyframeTimeAt`＝domain と同じ規則）。音量の変化と同じ扱いに
  // そろえる（ADR-0026②＝同じ概念は同じ挙動。描画の生存判定＝半開を流用すると終端に置けない）。
  const keyframeLocalSec = doc && selected ? keyframeTimeAt(doc, selected.id, playheadSec) : null;
  const keyframeAtPlayhead = {
    live: keyframeLocalSec != null,
    keyframe: selectedKeyframes.find((k) => k.timeSec === keyframeLocalSec),
  };
  // 選んだ部品の音量の変化（#512 段4）。時刻は部品の先頭からの秒なので、表示は開始秒を足す。
  // 読むときも保存と同じ正規化を通す＝並び・重複・値域が画面と鳴る音で食い違わない。
  const selectedVolumePoints = selected ? normalizedVolumePoints(selected.volumePoints) : [];
  // 切り抜きが入っているか（節を開いて出すかの判断に使う）。0 は「隠していない」＝入っていない扱い。
  const cropIsSet = !!selected?.crop && Object.values(selected.crop).some((v) => typeof v === "number" && v > 0);
  // 点があるときは**一定の音量（この部品の「音量」欄）は使われない**（`volumeAt(points) ?? clipBaseVolume`）。
  // 欄を触れるままにすると「設定したのに音が変わらない」になる（ADR-0026①＝設定した意味どおり）。
  const hasVolumePoints = selectedVolumePoints.length > 0;
  const volumePointsHint = hasVolumePoints ? VOLUME_POINTS_OVERRIDE_HINT : undefined;
  // 置ける位置か＝**終わりちょうどを含む**（`volumePointTimeAt`＝domain と同じ規則）。描画の生存判定
  // （`clipIsLiveAt`＝半開）を使うと、**「だんだん大きく」の到達点**を終端に置けない（#512 実機確認）。
  const volumePointLocalSec = selected ? volumePointTimeAt(selected, playheadSec) : null;
  const volumePointAtPlayhead = {
    live: volumePointLocalSec != null,
    point: selectedVolumePoints.find((p) => p.timeSec === volumePointLocalSec),
  };
  // この部品が入っている「まとまり」に付いた動き（画面では動いているのに「無い」と言わない）。
  const groupKeyframes =
    doc && selected
      ? (doc.groups ?? [])
          .filter((g) => groupElementIds(doc.groups ?? [], g.id).includes(selected.id))
          .map((g) => ({ groupId: g.id, keyframes: doc.animations?.find((a) => a.targetId === g.id)?.keyframes ?? [] }))
          .filter((g) => g.keyframes.length > 0)
      : [];
  // 連動先が見つからない字幕（V29）。自分の文へ落ちて描かれ続けるので、黙って連動が切れたことに
  // 気づけない＝知らせる（§2-5）。
  const danglingLinkCount = useMemo(() => (doc ? danglingSubtitleLinks(doc).length : 0), [doc]);
  // 連動先の候補（この動画にある読み上げの部品）。
  const voiceClips = useMemo(() => (doc ? doc.clips.filter((c) => c.kind === TIMELINE_CLIP_KIND.voice) : []), [doc]);
  // 素材が入っていない差し込み口は、灰色の「（未設定）」の枠がそのまま動画に焼き込まれる（`sceneSvg`）。
  // 黙ってそのまま出さずに知らせる（§2-5・場面形式の公開前チェックと同じ扱い＝ADR-0026②）。
  const emptySlotCount = useMemo(() => {
    if (!doc) return 0;
    const byId = new Map(templates.map((t) => [t.templateId, t]));
    let n = 0;
    for (const clip of doc.clips) {
      if (clip.kind !== TIMELINE_CLIP_KIND.template) continue;
      const tmpl = byId.get(clip.templateId ?? "");
      if (!tmpl) continue; // 見た目が見つからない部品は別の案内が出る
      for (const layer of tmpl.layers) {
        if (!templateSlotIds(tmpl.layers).has(layer.id)) continue;
        if (!(clip.assetRefs?.[layer.id] ?? layer.assetId)) n += 1;
      }
    }
    return n;
  }, [doc, templates]);
  // 置ける見た目パターンは**この動画と同じ向き**だけ（向き違いは置いても画面外へ出る＝domain も断る）。
  const placeableTemplates = doc ? templatesForOrientation(templates, doc.videoSettings.aspectRatio) : [];
  // 置ける列（映像の列だけ・固定した列は除く）＝押せるのに置けない選択肢を出さない（§2-5）。
  // 置ける列（映像・固定していない・出す設定）は **domain の1つ**を見る（#722）＝画面・store・
  // 置ける判定で条件を書き分けない。**並びは手前が先**なので、欄の一覧は元の並び順へ戻して出す。
  const placeableTracks = doc ? [...placeableVisualTracks(doc)].reverse() : [];
  // 読み上げを置ける列（音の列）。
  // この動画が持っている音の素材（焼き出しで運ばれたものなど）。
  const audioAssets = doc?.assets.filter((a) => a.assetType === ASSET_TYPE.bgm) ?? [];
  /**
   * 「鳴らす音」の欄が指す値と、それが**候補に無い**か（#734 レビュー）。
   *
   * 候補に無い値をそのまま `<select value>` へ渡すと、ブラウザは**先頭の候補を選択済みに見せる**＝
   * 「音が見つかりません」と警告しているのに、欄では別の曲が入っているように読める。
   * 素材の差し込み口の `unselectableCurrent` と同じ扱い（名前だけ出して選び直せる）。
   */
  const audioSourceValue = selected?.bundledBgmId
    ? `bgm:${selected.bundledBgmId}`
    : selected?.assetId
      ? `asset:${selected.assetId}`
      : "";
  const audioSourceMissing =
    audioSourceValue !== "" &&
    !BGM_CATALOG.some((b) => `bgm:${b.id}` === audioSourceValue) &&
    !audioAssets.some((a) => `asset:${a.assetId}` === audioSourceValue);
  // 置ける絵の素材（#684）。判定は**自由配置の差し込み口と同じ関数**（ADR-0030 追補＝一本化）。
  // **動画は出さない**＝置けても書き出しの手前で断られる（選べるのに使えない選択肢を並べない・`06 §12.1`）。
  const visualAssets = doc?.assets.filter((a) => isFreeSlotAssetType(a.assetType) && a.assetType !== ASSET_TYPE.video) ?? [];
  // 隠した列は動画に出ない／鳴らないので、置き先の候補に出さない（置けるのに出ない、を作らない）。
  // 音・読み上げを置ける列（#724）。**映像側と同じ規則・同じ向き**（`placeableAudioTracks`）＝
  // 以前はここだけ絞り込みを手書きし、しかも並びを**戻していなかった**ので、映像は手前・音は奥、と
  // 同じ「置く先」の概念が向きごと割れていた。欄の一覧は元の並び順へ戻して出す（映像側と同じ扱い）。
  const voiceTracks = doc ? [...placeableAudioTracks(doc)].reverse() : [];
  /**
   * 置く先の列（既定＝**いちばん手前の置ける列**・#724）。**どこへ入るかを見せる**。
   *
   * ⚠️ 既定を手前にするのは #722 と同じ理由＝奥へ入れると、手前に画面いっぱいの部品があるとき
   * **その裏に隠れて見えない**（`06 §12.1`「押して置いたときも必ず仕上がり確認に現れる」）。
   * 音は重ね順に意味が無いが、**同じ概念を種別で割らない**（ADR-0026②）。
   * 選んでいた列が消えた／固定された／隠されたときは既定へ戻す＝**表示と実際の置き先が必ず一致する**
   * （黙って別の列へ置かない）。
   */
  const audioTrackId = voiceTracks.some((t) => t.id === placeAudioTrackId)
    ? placeAudioTrackId
    : (doc ? (placeableAudioTracks(doc)[0]?.id ?? "") : "");
  const visualTrackId = placeableTracks.some((t) => t.id === placeTrackId)
    ? placeTrackId
    : (doc ? (placeableVisualTracks(doc)[0]?.id ?? "") : "");
  // 置き場所や音の出どころの取り違え（11 §8 V22–V28）。描画から外れるものもあるので必ず見せる。
  const warnings = useMemo(() => (doc ? validateTimelineDoc(doc) : []), [doc]);
  // 書き出せない理由（`timelineExportBlockers`）は**押す前に**見せる＝押しても断られるだけ、を作らない（§2-5）。
  // 別形式の書き出しが走っていないか（締めの持ち主）。store の開始チェックと同じものを見る。
  const exportLockOwner = useExportLockStore((s) => s.owner);
  const exportBlockers = useMemo(
    // 見た目の未解決も理由になる（描かれないものを黙って落とした動画を成功にしない・ADR-0026④）。
    // 一覧で並べるのは**文書の中身の理由**だけ（下の `exportBlocked` は「いま始められない事情」も含む）。
    () => (doc ? timelineExportBlockers(doc, { knownTemplateIds: new Set(templates.map((t) => t.templateId)) }) : []),
    [doc, templates],
  );
  /**
   * **押す前に断る理由**（#718）。store の開始チェックと**同じ述語**を通す＝画面が塞いでいない理由で
   * 押せてしまい、押してから断られる（打った操作が消えて理由だけ出る）を作らない。
   */
  const exportBlocked = useMemo(
    () =>
      exportStartBlock({
        doc,
        isImporting,
        generatingVoiceClipId,
        knownTemplateIds: new Set(templates.map((t) => t.templateId)),
        otherExportRunning: exportLockOwner != null && exportLockOwner !== EXPORT_OWNER,
        canExportHere: canExport(),
      }),
    [doc, isImporting, generatingVoiceClipId, templates, exportLockOwner],
  );
  const exporting = isTimelineExportBusy(exportRun.phase);
  // 書き出しが終わったら「離れられない」理由も出しっぱなしにしない（出ている条件から導く）。
  const leaveBlockedMessage = exporting ? leaveBlocked : null;
  /**
   * **保存が直ったら、離脱の確認は行き先ごと忘れる**（#719 レビュー）。
   *
   * 出したまま「保存し直す」が成功すると、確認は消えるのに**行き先が残る**。あとで別の保存が失敗した
   * 瞬間に、押していない確認が**古い行き先で蘇る**（押すとそこへ移ってしまう）。
   * 表示条件で隠すだけでは忘れないので、**保存の状態が変わったところで落とす**。
   */
  useEffect(
    () =>
      useTimelineStore.subscribe((now, prev) => {
        if (prev.saveStatus === "error" && now.saveStatus !== "error") setConfirmLeave(null);
      }),
    [],
  );
  // 音が見つからない部品は**鳴らない**（読み上げ未作成・音源の読み込み失敗）。黙って無音にしない（§2-5）。
  const missingAudioCount = useMemo(() => {
    if (!doc) return 0;
    return doc.clips.filter((c) => {
      if (c.kind !== TIMELINE_CLIP_KIND.voice && c.kind !== TIMELINE_CLIP_KIND.audio) return false;
      const key = audioSourceKeyOfClip(c);
      return !key || !audioSrcByKey[key];
    }).length;
  }, [doc, audioSrcByKey]);
  /**
   * **絵が出せない素材を使っている部品**の数（#726 レビュー・監査）。音（`missingAudioCount`）と同じ形で
   * 知らせる＝同じ状況なのに絵だけ無言、を作らない（ADR-0026②）。
   * 開いたときに表示先を用意できなかった素材＝ファイルが読めない見込みなので、書き出しでも同じ理由で断られる
   * （断りそのものは書き出しの入口が出す＝`TIMELINE_EXPORT_ASSET_UNREADABLE`。ここは**押す前の知らせ**）。
   */
  const missingImageCount = useMemo(() => {
    if (!doc) return 0;
    const unresolved = new Set(
      timelineImageAssetIds(doc).filter((id) => !assetSrcById[id] && !templateAssetSrcById[id]),
    );
    if (unresolved.size === 0) return 0;
    return doc.clips.filter((c) => clipImageAssetIds(c).some((id) => unresolved.has(id))).length;
  }, [doc, assetSrcById, templateAssetSrcById]);

  /**
   * 表示倍率（#686・ADR-0034 決定13）。段は場面形式の見わたす画面と**同じ型**（`ZOOM_LEVELS`）。
   *
   * ⚠️ **覚えない**（決定14＝文書の中身に依存する状態は覚えない）＝開くたびに「全体表示」から始める。
   * 以前は尺から自動で決めていた（`max(640/尺, 40)`）ので、長い動画ほど潰れて手が出せなかった。
   */
  const [zoomIndex, setZoomIndex] = useState<number | null>(null); // null＝まだ全体表示を決めていない
  /**
   * **利用者が倍率を変える唯一の入口**（#743 レビュー）。ホイールにだけ関門を置いていたので、
   * `−`／`＋`／`全体を表示` は掴んでいる間も効いた（別のポインタや画面なら届く）＝秒は掴んだ時点の
   * 倍率で出しているので、**帯が指から離れる**。入口を1つにして、関門も1つにする。
   */
  const changeZoomRef = useRef<(next: number | ((i: number | null) => number)) => boolean>(() => false);
  const changeZoom = (next: number | ((i: number | null) => number)): boolean => {
    if (clipDragRef.current) return false;
    zoomTouchedRef.current = true; // 明示的に合わせた＝以後は勝手に動かさない
    setZoomIndex((i) => (typeof next === "function" ? next(i) : next));
    return true;
  };
  const scrollRef = useRef<HTMLDivElement>(null);
  /**
   * **開いた直後は全体表示**（決定13）。列の幅を実測してから決めるので効果でやる。
   * 文書が変わったら決め直す＝別の動画を開いたときに前の倍率が残らない（覚えない・決定14）。
   */
  const fitDocIdRef = useRef<string | undefined>(undefined);
  /** `Ctrl`+ホイールで掴んだ錨点（倍率を変えた**後**に位置を合わせるために持ち越す）。 */
  const pendingZoomRef = useRef<{ scrollLeft: number; anchorPx: number; fromPxPerSec: number } | null>(null);
  /** 利用者が自分で倍率を触ったか（触ったら**自動の合わせをやめる**＝勝手に戻さない）。 */
  const zoomTouchedRef = useRef(false);
  /** ホイールの実リスナーから読む今の段（リスナーは張り直さないので ref で渡す）。 */
  const zoomIndexRef = useRef<number | null>(null);
  useEffect(() => {
    zoomIndexRef.current = zoomIndex;
    const docId = doc?.projectId;
    if (!docId) return;
    if (fitDocIdRef.current !== docId) { fitDocIdRef.current = docId; zoomTouchedRef.current = false; } // 別の動画＝やり直す
    // ⚠️ **利用者が触ったらもう合わせない**（#686 レビュー）＝以前は「一度でも合わせたか」で見ていたので、
    // まだ幅を測れていない間（部品が無い・欄を閉じている）に倍率を変えると、最初の部品を置いた瞬間に
    // 全体表示へ飛んで**自分で決めた倍率を奪われた**。
    if (zoomTouchedRef.current || totalSec <= 0) return;
    const px = scrollRef.current?.clientWidth ?? 0;
    if (px <= 0) return; // まだ測れない（次に尺か文書が変わったときに試す）
    setZoomIndex(fitZoomIndex(totalSec, px - LANE_LABEL_PX));
    // 依存は「どの動画か」と「尺」だけ＝**あとで欄の幅が変わっても合わせ直さない**
    // （利用者が自分で広げた倍率を、欄をドラッグしただけで奪わない）。
  }, [doc?.projectId, totalSec, zoomIndex]);

  /**
   * `Ctrl`+ホイールで段を動かす（決定13）。
   *
   * ⚠️ **React の `onWheel` では既定を止められない**（#686 レビュー）＝React は root の `wheel` を
   * `passive: true` で登録するので `preventDefault()` が無効になり、画面ごと拡大される端末では
   * **二重に効く**。自分で `{ passive: false }` の実リスナーを張る。
   */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return; // 素のホイールは横スクロールのまま＝奪わない
      e.preventDefault();
      const from = ZOOM_LEVELS[zoomIndexRef.current ?? DEFAULT_ZOOM_INDEX];
      const nextIndex = stepZoomIndex(zoomIndexRef.current ?? DEFAULT_ZOOM_INDEX, e.deltaY < 0 ? 1 : -1);
      if (ZOOM_LEVELS[nextIndex] === from) return;
      // 位置合わせは**描き直した後**（下の効果）。ここで合わせるとまだ古い幅なのでスクロールの
      // 上限で切り詰められ、錨点が流れる（実機で確認）。
      // ⚠️ **効いたときだけ**錨点を控える（断られたのに控えると、次の1回が古い錨点で流れる）。
      const anchor = { scrollLeft: el.scrollLeft, anchorPx: e.clientX - el.getBoundingClientRect().left, fromPxPerSec: from };
      if (changeZoomRef.current(nextIndex)) pendingZoomRef.current = anchor;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  /** 倍率が変わったら、掴んだ錨点が同じ場所に来るようスクロール位置を合わせる（決定13）。 */
  useEffect(() => {
    const p = pendingZoomRef.current;
    if (!p) return;
    pendingZoomRef.current = null;
    const el = scrollRef.current;
    if (el) el.scrollLeft = zoomScrollLeft({ ...p, labelPx: LANE_LABEL_PX, toPxPerSec: ZOOM_LEVELS[zoomIndex ?? DEFAULT_ZOOM_INDEX] });
  }, [zoomIndex]);

  // ⚠️ ここから下のフックは**早期 return より前**で呼ぶ（下の「読み込み中」「開けない」で抜ける回と
  // 抜けない回で呼ぶ数が変わると、React が状態を取り違える）。
  // 書き出し中の編集は store が断る（`TIMELINE_EDIT_EXPORTING`）。**押してから断るのではなく、押す前に理由を出す**
  // （#694・監査 §2.2-11＝事前 disabled の流儀に統一）。押せてしまうと、断られた入力を消さない配慮も要らぬ手戻りになる。
  const exportingHint = exporting ? "書き出しが終わってから編集できます" : undefined;
  /**
   * **消せない理由**（`null`＝消せる・#721）。1つのときのボタン・まとめて消すボタン・`Delete` キーが
   * **同じものを見る**＝入口ごとに条件を書き分けると、キーだけ固定した列の部品を消せる、が起きる
   * （`exportStartBlock` と同じ流儀）。`selectionHasLocked` は選んでいる全部を見るので、
   * 1つだけのときも `selectedLocked` と同じ答えになる（片方だけ直す事故を作らないよう、こちらに寄せる）。
   */
  const removeBlocked = useMemo<{ disabled: boolean; title: string | undefined } | null>(
    () =>
      selectedClipIds.length === 0
        ? { disabled: true, title: undefined } // 選んでいなければ、そもそも消す対象が無い
        : selectionHasLocked
          ? { disabled: true, title: lockedSelectionHint }
          : exporting
            ? { disabled: true, title: exportingHint }
            : null,
    [selectedClipIds.length, selectionHasLocked, exporting, exportingHint],
  );
  /**
   * **消す（どの入口からでも同じ流れ）**（#721）。単体は**即時＋取り消し**、**まとめては確認**
   * ＝`06 §2` 統一規約1／ADR-0034 決定20。ここを通さずに `removeSelectedClips` を直に呼ぶと、
   * まとめて消すのが確認なしになる（キーからも同じ道を使うので、片方だけ確認、も作らない）。
   * ⚠️ **early return より前**に置く（抜ける回と抜けない回でフックの数が変わらない＝下の土台と同じ理由）。
   */
  const requestRemoveSelected = useCallback(() => {
    if (removeBlocked) return;
    if (selectedClipIds.length > 1) setConfirmRemove(selectedClipIds);
    else removeSelectedClips();
  }, [removeBlocked, selectedClipIds, removeSelectedClips]);
  // キー操作の入れ物を毎レンダー最新にする（描き終わってから差し替える＝レンダー中に ref を書かない）。
  useEffect(() => {
    playRef.current = {
      playing: isPlaying, total: totalSec,
      fps: doc ? Math.round(effectiveFps(doc)) : FPS,
      play, pause,
      seekFrames: (frames) => { if (doc) setPlayhead(seekByFrames(doc, playheadSec, frames)); },
    };
    removeRef.current = requestRemoveSelected;
    changeZoomRef.current = changeZoom; // ホイールの実リスナーは張り替えないので写し越しに呼ぶ
  });
  /**
   * **帯を掴んでいる間**（#686・ADR-0034 決定9/10）。作法は欄のドラッグ（ADR-0033 段階3）と同じ。
   *
   * 置けない所では**寄せない**＝ゴーストの色で知らせ、離したら**元の位置へ戻す**（決定10）。
   * 判定は domain の `moveClipIssue`／`trimClipIssue`＝**ゴーストの色と離した結果が同じ規則**。
   */
  /** 実リスナー（`wheel`）から掴んでいる最中かを見るための写し（張り替えないので ref 越し）。 */
  const clipDragRef = useRef(false);
  const [clipDrag, setClipDrag] = useState<
    { clipId: string; mode: "move" | "trim-start" | "trim-end"; sec: number; issue: EditBlockedReason | null } | null
  >(null);

  /**
   * 掴んだ直後の `click` を1回だけ捨てる（#686 レビュー）。`pointerdown` の `preventDefault` は
   * `click` を止めないので、離した後に選び直しが走り**断り文がその場で消える**／`Shift` を押していた
   * ときは**動かした帯の選択が外れる**（取っ手も消える）。
   */
  const skipClickRef = useRef(false);
  /**
   * 何もない所を押して選択を解く（#701）。**掴んだ直後の `click` では解かない**（#743 レビュー）＝
   * 帯の外で離すと `click` の相手はこの余白になるので、ここが印を見ないと**断ったそばから
   * 選択が丸ごと消える**（帯の上で離したときだけ守られる、という当たり外れを作らない）。
   */
  const clearSelectionByClick = (): void => {
    if (skipClickRef.current) { skipClickRef.current = false; return; }
    clearSelection();
  };

  // **つかんで置く**（#684）の道具。使うのは下の `resolveDrop` ほか。
  // ドラッグの作法は共有（掴む場所ごとに書き分けない・ADR-0034 決定9）。
  const beginDrag = usePointerDrag();
  // 掴んだまま端まで来たら送る（#714-1）＝**置く側と帯側で同じ部品**（送り方を2つ作らない）。
  // 左の送る帯は**列の名前の欄の内側**から測る（欄の下に隠れると、どこへ入るか見ながら送れない）。
  const autoScroll = useEdgeAutoScroll(LANE_LABEL_PX);
  const stageRef = useRef<HTMLDivElement>(null);
  const laneRefs = useRef(new Map<string, HTMLElement>());
  const [drag, setDrag] = useState<DragPlace | null>(null);

  if (isLoading) {
    return (
      <div className="main-scroll">
        <PageHead title="タイムライン編集" desc="動画を開いています…" />
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="main-scroll">
        <PageHead title="タイムライン編集" desc="時間の流れを自由に組み替えて動画を作ります。" />
        <p className="notice notice-warn" role="alert">
          {loadError ?? "開いている動画がありません。一覧から選んでください。"}
        </p>
        <button className="btn btn-ghost btn-icon" onClick={() => onNavigate("home")}>
          <ArrowLeftIcon size={16} />
          動画の一覧へ
        </button>
      </div>
    );
  }

  // 再生中に押せない操作の理由（§2-5：押せない理由を無言にしない）。
  const playingHint = isPlaying ? "再生を止めてから使えます" : undefined;

  /**
   * **編集の入口の「押せない」と理由を1か所から配る**（#703・監査 §2.2-11）。
   *
   * 以前は入口ごとに条件を書き並べていたので、`selectedLocked` は塞いであるのに `exporting` は塞いでいない、
   * という取りこぼしが大量に残っていた（押してから `commit` が断る＝**打った文字が消えて理由だけ出る**）。
   * 数え上げをやめ、**入口はこれを展開するだけ**にする＝新しい入口を足しても条件を書き忘れない。
   *
   * `extra` はその入口だけの追加条件（再生中・値が空・作成中など）。理由の優先順は
   * 固定 → 書き出し中 → その入口の事情（先に直せるものから出す）。
   */
  const editGuard = (extra?: { disabled?: boolean; hint?: string }): { disabled: boolean; title: string | undefined } => ({
    disabled: selectedLocked || exporting || !!extra?.disabled,
    title: selectedLocked ? lockedHint : exporting ? exportingHint : extra?.hint,
  });
  /**
   * **選んだ部品に関わらない編集の入口**（置く・列を足す・取り消す…）。`editGuard` は「選んだ部品が固定か」を
   * 含むので、選択に依らない入口では使えず、条件の手書きへ戻ってしまう（＝#703 が消したかった数え上げの再発）。
   * 2段に割って、どちらの入口も**同じ仕組み**で塞ぐ。
   */
  const busyGuard = (extra?: { disabled?: boolean; hint?: string }): { disabled: boolean; title: string | undefined } => ({
    disabled: exporting || !!extra?.disabled,
    title: exporting ? exportingHint : extra?.hint,
  });
  /**
   * **つかんで置く**（#684・ADR-0034 決定2）。ボタンで置く道は残したまま、**運んで落とす**道を足す。
   *
   * 落とし先は2つ＝**仕上がり確認**（動画の中の場所を決める）と**列**（時刻と列を決める）。
   * 置けるかどうかは domain の `visualPlacementIssue` で見る＝**ゴーストの色と、離したときの結果が同じ判定**
   * （置けそうに見えたのに断られる、を作らない）。置けないまま離したら**元へ戻す**＝寄せない（決定10）。
   */

  const trackOf = (trackId: string) => doc?.tracks.find((t) => t.id === trackId);
  /**
   * 選んだ部品の**箱**（#685）。**箱を持てる部品だけ**（音・読み上げに位置は無い／見た目パターンの
   * クリップは枠そのもの＝幾何を持たない）＝出す条件は domain の `setClipBox` が断る条件と同じもの。
   */
  /**
   * **キャンバスで触れる部品**（#685 後半）＝いま画面に出ていて、箱を自分で持てるもの。
   *
   * 空間の語彙は同じもの（`ClipSpatial`＝`FreeElement` から時間を除いたもの・`11 §7.6`）なので、
   * **箱を解決して id と種類を付け直すだけ**で場面編集の部品へ渡せる。
   * ⚠️ **見た目パターンのクリップは渡さない**＝枠そのもの（決定8）。渡すと画面いっぱいの箱が
   * 全面を覆い、その下の部品を掴めなくなる（掴めるのに掴めない、を作る）。
   */
  const canvasDims = doc ? dimsForOrientation(doc.videoSettings.aspectRatio) : { width: 0, height: 0 };
  const canvasEls: FreeElement[] = doc
    ? doc.clips
        .filter((c) => canHaveBox(c.kind) && clipIsLiveAt(c, frameTimeSec(doc, playheadSec)) && !trackOf(c.trackId)?.hidden)
        .map((c) => ({
          ...resolveClipBox(c, canvasDims),
          id: c.id,
          kind: c.kind as FreeElementKind,
          // 固定した列の部品は**掴めない**（帯と同じ＝同じ状態を場所で変えない・ADR-0026②）。
          ...(trackOf(c.trackId)?.locked ? { locked: true } : {}),
        }))
    : [];
  /** キャンバスからの編集は **`setClipBox` と同じ入口**（数値欄と置けない条件を割らない）。 */
  const setClipBoxById = (clipId: string, patch: { x?: number; y?: number; w?: number; h?: number; rotation?: number }): void => {
    if (!doc) return;
    setClipBoxFor(clipId, patch);
  };

  const selectedBox = selected && canHaveBox(selected.kind) && doc
    ? resolveClipBox(selected, dimsForOrientation(doc.videoSettings.aspectRatio))
    : null;
  /** 掴めるか（#686 レビュー）。**見た目（`cursor`）と、掴む処理を始めるかが同じものを見る**。 */
  const grabbableClip = (c: TimelineClip): boolean => !exporting && !trackOf(c.trackId)?.locked;
  /**
   * 端の取っ手を出すか。**細い帯では出さない**＝左右の取っ手と「⋮」で**本体を掴む所が無くなる**。
   * 長さは数値の欄で変えられる（ドラッグ専用の操作を作らない・決定19）ので行き止まりにならない。
   */
  const showHandles = (c: TimelineClip): boolean =>
    grabbableClip(c) && pxPerSec * c.durationSec >= CLIP_HANDLES_MIN_W_PX;
  /**
   * 掴んでいる間の帯の位置と長さ（#686）。**離すまで文書は変えない**ので、見せかけだけを動かす。
   * 端の縮めは `applyClipEdge` と同じ下限に当たるので、見た目も同じ所で止まる。
   */
  const dragSpanOf = (c: TimelineClip): { startSec: number; endSec: number } => {
    const d = clipDrag?.clipId === c.id ? clipDrag : null;
    let startSec = c.startSec;
    let endSec = clipEndSec(c);
    if (d?.mode === "move") { const len = endSec - startSec; startSec = d.sec; endSec = d.sec + len; }
    else if (d?.mode === "trim-start") startSec = Math.min(d.sec, endSec - TIMELINE_MIN_CLIP_SEC);
    else if (d?.mode === "trim-end") endSec = Math.max(d.sec, startSec + TIMELINE_MIN_CLIP_SEC);
    return { startSec, endSec };
  };
  const dragStyleOf = (c: TimelineClip): { left: string; width: string } => {
    const { startSec, endSec } = dragSpanOf(c);
    return { left: `${pxPerSec * startSec}px`, width: `${pxPerSec * (endSec - startSec)}px` };
  };

  /**
   * 掴んでいる間に**別の所から文書が変わった**か（#686 レビュー）。
   *
   * 掴んだ時点の帯を起点に秒を出しているので、途中で当人が動くと**起点だけ古い**まま離すことになる
   * （例：取り消しで開始が戻った後に離すと、戻る前の起点から作った時刻で上書きする）。
   * 変わっていたら**掴み直してもらう**＝掴んだときに見ていたものと違う結果を出さない。
   * `Ctrl+Z` は下の名乗りで塞いだので、ここに来るのは声の完成のように**自分では押していない**変化。
   */
  const clipChanged = (before: TimelineClip): boolean => {
    const now = useTimelineStore.getState().doc?.clips.find((c) => c.id === before.id);
    return !now || now.trackId !== before.trackId || now.startSec !== before.startSec
      || now.durationSec !== before.durationSec;
  };

  /**
   * 帯を掴む（#686）。`mode` で本体（動かす）と端（縮める）を分ける。
   *
   * ⚠️ **掴む前に断る**（`editGuard` と同じ流儀）＝固定した列・書き出し中は掴む処理そのものを始めない。
   * 押せてしまうと、離してから `commit` が断る＝**押してから断る**になる（#703 で消した形の再発）。
   */
  const beginClipDrag = (e: ReactPointerEvent, clipId: string, mode: "move" | "trim-start" | "trim-end"): void => {
    // ⚠️ 前の `click` の取りこぼしをここで捨てる（#743 レビュー）。下の断る道は `usePointerDrag` に
    // 乗らないので、離した先が帯の外だと `click` が来ず印が残り、**次の無関係な1回を飲み込む**。
    // 新しく掴み始めた時点で流す＝残っても「次の pointerdown まで」に必ず縮む。
    skipClickRef.current = false;
    const doc0 = useTimelineStore.getState().doc;
    const clip0 = doc0?.clips.find((c) => c.id === clipId);
    if (!doc0 || !clip0) return;
    // 掴めるかは **`grabbableClip` だけが決める**（見た目の `cursor` と同じものを見る・#743 レビュー）。
    // 条件を書き写すと、片方だけ増えたときに「掴めそうなのに掴めない」の非対称が戻る。
    if (!grabbableClip(clip0)) return;
    // 複数選んでいるうちの1つを掴んだ＝まとめて動かすのは段階4。**選択を黙って潰さない**（決定15）。
    if (selectedClipIds.length > 1 && selectedClipIds.includes(clipId)) {
      setEditBlocked(EDIT_BLOCKED.multiSelection);
      // ⚠️ **断って戻る道でも `click` を捨てる**（#686 レビュー）。捨てないと離した後の `click` が
      // 素通しで走り、①帯の上なら `selectClip` で**選択が1つへ潰れて理由も消える**
      // ②列の余白なら `clearSelection` で**選択が丸ごと消える**＝断った意味が無くなる。
      skipClickRef.current = true;
      return;
    }
    const startX = e.clientX;
    const startScroll = scrollRef.current?.scrollLeft ?? 0;
    const origin = mode === "trim-end" ? clipEndSec(clip0) : clip0.startSec;
    // ⚠️ **`pxPerSec` は掴んだ時点の値**（下で倍率の変更を止めているので、途中で変わらない）。
    // ⚠️ **端送り（#714）の分も足す**＝指が止まっていても枠が動けば指の下の時刻は変わる。
    // 足さないと「送られてはいるが、離すと送る前の時刻に落ちる」＝見えているものと結果が食い違う。
    const at = (ev: PointerEvent): number => {
      const scrolled = (scrollRef.current?.scrollLeft ?? startScroll) - startScroll;
      return Math.max(0, origin + (ev.clientX - startX + scrolled) / pxPerSec);
    };
    // 判定は**今の文書**で引く（掴んだ時点の写しで見ると、途中で変わったとき色と結果が食い違う）。
    const issueOf = (sec: number): EditBlockedReason | null => {
      const now = useTimelineStore.getState().doc ?? doc0;
      return mode === "move"
        ? moveClipIssue(now, clipId, { startSec: sec })
        : trimClipIssue(now, clipId, mode === "trim-start" ? "start" : "end", sec);
    };
    beginDrag(e, {
      onStart: () => selectClip(clipId), // 掴んだ相手を選ぶ＝「選んだ部品」の欄と一致する
      onMove: (ev) => {
        // ⚠️ 掴み直してもらう道でも**送りを止める**（#714 レビュー）。止めないと rAF が回り続け、
        // 毎フレーム下の `replay` が走って**消したはずのゴーストが復活**し、枠も流れ続ける。
        if (clipChanged(clip0)) { clipDragRef.current = false; autoScroll.stop(); setClipDrag(null); return; }
        const sec = at(ev);
        setClipDrag({ clipId, mode, sec, issue: issueOf(sec) });
        clipDragRef.current = true;
        // 端まで来たら送る。送った各フレームで**この処理をやり直す**（上の `at` が枠の動きも見る）。
        autoScroll.track(scrollRef.current, ev, (last: PointerEvent) => {
          const s2 = at(last);
          setClipDrag({ clipId, mode, sec: s2, issue: issueOf(s2) });
        });
      },
      onEnd: (ev, started) => {
        clipDragRef.current = false;
        autoScroll.stop();
        if (!started) return; // 動かしていない＝ただのクリック（選択は `onClick` が受ける）
        setClipDrag(null);
        // 離した後に来る `click` を捨てる＝**選び直しで理由が消える**のと、`Shift` を押していたときに
        // 動かした帯の選択が外れるのを防ぐ（`pointerdown` の `preventDefault` は `click` を止めない）。
        skipClickRef.current = true;
        if (clipChanged(clip0)) return;
        const sec = at(ev);
        // ⚠️ **ここで置けるかを見ない**＝`moveClipById` が同じ `moveClip` を走らせ、置けなければ
        // **文書を変えずに理由だけ立てる**（＝寄せない＋離したときに出す・決定10）。
        // 手前で1回断る形にしていたが、結果は同じで**判定する場所が2つ**になるだけだった
        // （ゴーストの色も同じ関数を見ている＝決めるのは1か所）。
        // 掴んだ相手は `clipId`。**選択に効かせない**＝掴んでいる間に選択が変わっても（左ドラッグ中の
        // 右クリック・取り消しで対象が消える等）**掴んでいない帯**が動く、を作らない。
        if (mode === "move") moveClipById(clipId, { startSec: sec });
        else trimClipById(clipId, mode === "trim-start" ? "start" : "end", sec);
      },
      onCancel: (started) => { clipDragRef.current = false; autoScroll.stop(); setClipDrag(null); if (started) skipClickRef.current = true; },
    });
  };

  /** 落とした点から「どこへ置くか」を決める。**列が先**（下の並びは仕上がり確認に重ならない）。 */
  const resolveDrop = (kind: VisualKind, assetId: string | undefined, x: number, y: number): DragPlace["drop"] => {
    if (!doc) return null;
    for (const [trackId, el] of laneRefs.current) {
      // **見えている分だけ**を落とし先にする（スクロールで欄の外へ出ている列へ落とさない）。
      // 時刻は**列そのものの左端**から測る（切った矩形の左端は列の 0 秒ではない）。
      if (!pointInRect(visibleRectOf(el) ?? { left: 0, top: 0, right: -1, bottom: -1 }, x, y)) continue;
      const startSec = laneTimeAt(el.getBoundingClientRect(), pxPerSec, x);
      return { at: { trackId, startSec }, issue: visualPlacementIssue(doc, { kind, assetId, trackId, startSec }) };
    }
    const stage = stageRef.current?.getBoundingClientRect();
    const stageVisible = stageRef.current ? visibleRectOf(stageRef.current) : null;
    if (stage && stageVisible && pointInRect(stageVisible, x, y)) {
      // 仕上がり確認は**動画の中の場所**だけを決める。列と時刻はボタンと同じ規則でアプリが選ぶ
      // （決定10 の「寄せない」は**利用者が指した軸**＝ここでは位置の話。時間は指していない）。
      const center = canvasPointAt(stage, dimsForOrientation(doc.videoSettings.aspectRatio), x, y);
      return { center, issue: placeableTracks.length === 0 ? EDIT_BLOCKED.notFound : null };
    }
    return null;
  };

  /** 一覧・ボタンから掴む。**動かさずに離したときは何もしない**（そのまま `click` が走って再生位置へ置く）。 */
  const grabToPlace = (e: ReactPointerEvent, kind: VisualKind, assetId?: string): void => {
    if (exporting || isPlaying) return; // 押せない状況では掴ませない（押してから断らない）
    beginDrag(e, {
      onStart: (ev) => setDrag({ kind, assetId, x: ev.clientX, y: ev.clientY, drop: resolveDrop(kind, assetId, ev.clientX, ev.clientY) }),
      onMove: (ev) => {
        const show = (e2: PointerEvent): void =>
          setDrag({ kind, assetId, x: e2.clientX, y: e2.clientY, drop: resolveDrop(kind, assetId, e2.clientX, e2.clientY) });
        show(ev);
        // 端まで運んだら送る（#714）。落とし先は列の位置から測り直すので、送った分だけ時刻も動く。
        autoScroll.track(scrollRef.current, ev, show);
      },
      onEnd: (ev, started) => {
        setDrag(null);
        autoScroll.stop();
        // **動かさずに離した＝押しただけ**。ここで置く（`click` を待たない＝指の経路はここで完結する）。
        if (!started) { addVisualClip({ kind, assetId }); return; }
        const drop = resolveDrop(kind, assetId, ev.clientX, ev.clientY);
        // 落とし先の外・置けない所で離したら**何も置かない**（寄せない）。理由は離したときだけ出す（決定10）。
        if (!drop) return;
        // 置けないときも**同じ入口**へ渡す＝断る理由は store（domain）が出す（判定を2か所に持たない）。
        addVisualClip({ kind, assetId, center: drop.center, at: drop.at });
      },
      onCancel: () => { autoScroll.stop(); setDrag(null); },
    });
  };

  /** キーボードで実行したときだけ走らせる（指の経路は `onEnd` で完結・`isKeyboardActivation`）。 */
  const onKeyActivate = (e: ReactMouseEvent, run: () => void): void => {
    if (isKeyboardActivation(e)) run();
  };

  // 列の操作（順番・出す出さない・固定・消す）は**右クリックのメニュー**へ畳む（ADR-0033・利用者指摘 2026-08-03）。
  // 行にボタンを並べると帯より文字のほうが目立ち、並びが読めなくなる。項目名は**いまの状態で意味が通る言い方**にする。
  const openTrackMenu = (e: ReactMouseEvent, trackId: string): void => {
    e.preventDefault();
    setTrackMenu({ trackId, x: e.clientX, y: e.clientY });
  };
  /**
   * 帯の操作（#701・ADR-0034 決定19「ドラッグ専用の操作を作らない」）。
   *
   * **右クリックで開いたときは、その帯を選ぶ**＝メニューの項目は「選んでいる部品」に効くので、
   * 選ばずに開くと**別の部品が消える**。既に選んでいる中の1つなら選択を保つ（まとめて消せる）。
   */
  const openClipMenu = (e: ReactMouseEvent, clipId: string): void => {
    e.preventDefault();
    // ⚠️ いまはレーン自身に右クリックが無いので伝播先は無い（列のメニューは兄弟の行ラベルに付いている）。
    // 将来レーンへ右クリックを足したときに食い合わないための保険として残す。
    e.stopPropagation();
    if (!selectedClipIds.includes(clipId)) selectClip(clipId);
    setClipMenu({ clipId, x: e.clientX, y: e.clientY });
  };
  const menuClip = clipMenu ? doc?.clips.find((c) => c.id === clipMenu.clipId) : undefined;
  const menuClipTemplate = menuClip?.kind === TIMELINE_CLIP_KIND.template
    ? templates.find((t) => t.templateId === menuClip.templateId)
    : undefined;
  /** 1つの帯にだけ効く項目の関門（複製・バラす）。まとめて選んでいるときは押せなくして理由を出す。 */
  /**
   * **複製だけ**の追加条件（#744 レビュー）＝隠した列では新しく作れない。
   * ⚠️ `editGuard` に入れてはいけない＝動かす・縮めるは隠した列でも通る規則なので、
   * まとめて塞ぐと**その列の中身が二度と動かせなく**なる（行き止まり・決定5）。
   */
  const duplicateExtra = (): { disabled?: boolean; hint?: string } =>
    selected && trackOf(selected.trackId)?.hidden
      ? { disabled: true, hint: "動画に出さない列では増やせません。列の「⋮」から「動画に出す」を選んでください" }
      : {};

  const singleClipMenuGuard: { disabled?: boolean; disabledHint?: string } =
    selectedClipIds.length > 1
      ? { disabled: true, disabledHint: "1つだけ選ぶと使えます" }
      : editGuard().disabled
        ? { disabled: true, disabledHint: editGuard().title }
        : {};
  const clipMenuItems: ContextMenuItem[] = menuClip
    ? [
        // ⚠️ **1つのときだけ**（#701 レビュー）＝複製は store が「選択がちょうど1件」でないと**何もせず
        // 理由も持たない**ので、押せる状態で出すと**押しても無反応**になる。理由の言い方は
        // 「選んだ部品」の欄と同じ（`editGuard`）＝同じ状態を画面の場所で別の言い方にしない（ADR-0026②）。
        {
          label: "同じものを足す",
          ...singleClipMenuGuard,
          ...(duplicateExtra().disabled ? { disabled: true, disabledHint: duplicateExtra().hint } : {}),
          onSelect: duplicateSelectedClip,
        },
        ...(menuClipTemplate
          ? [{
              label: "中身をバラす",
              ...singleClipMenuGuard,
              // 戻せないので**押す前に断る**（ADR-0032 決定23）＝確認は共有の `DeleteConfirm`。
              onSelect: () => setExploding({ clipId: menuClip.id, template: menuClipTemplate }),
            }]
          : []),
        {
          label: selectedClipIds.length > 1 ? `選んだ${selectedClipIds.length}個を消す` : "消す",
          danger: true,
          ...(removeBlocked ? { disabled: true, disabledHint: removeBlocked.title } : {}),
          onSelect: requestRemoveSelected,
        },
      ]
    : [];
  const menuTrack = trackMenu ? doc?.tracks.find((t) => t.id === trackMenu.trackId) : undefined;
  // 列の操作も編集＝**書き出し中は押す前に断る**（#703 レビュー）。項目ごとに書かず、組み立てで一括して配る。
  const trackMenuGuard = exporting ? { disabled: true, disabledHint: exportingHint } : {};
  const trackMenuItems: ContextMenuItem[] = menuTrack
    ? [
        { label: "手前へ", ...trackMenuGuard, onSelect: () => moveTrackOrder(menuTrack.id, "front") },
        { label: "奥へ", ...trackMenuGuard, onSelect: () => moveTrackOrder(menuTrack.id, "back") },
        {
          label: menuTrack.hidden ? "動画に出す" : "動画に出さない",
          ...trackMenuGuard,
          onSelect: () => setTrackFlag(menuTrack.id, "hidden", !menuTrack.hidden),
        },
        {
          label: menuTrack.locked ? "固定を外す" : "動かせないように固定する",
          ...trackMenuGuard,
          onSelect: () => setTrackFlag(menuTrack.id, "locked", !menuTrack.locked),
        },
        {
          label: "この列を消す",
          danger: true,
          // 固定した列は消せない（`removeTrack` が断る＝ADR-0032）。押してから断られるのではなく、
          // **押す前に理由を出す**（長い画面では上部の知らせを見落とす・§2-5）。
          // 書き出し中も**開く前に**断る（答えてから断ると、取り返しのつかなさを聞いた意味が無くなる・#703）。
          disabled: menuTrack.locked || exporting,
          disabledHint: menuTrack.locked ? "この列は固定されています。消すには固定を外してください" : exportingHint,
          onSelect: () => setRemovingTrackId(menuTrack.id),
        },
      ]
    : [];
  const svg = layout
    ? layoutToSvg(layout, {
        assetSrc: (id) => (id ? assetSrcById[id] ?? templateAssetSrcById[id] : undefined),
        // クレジット（ADR-0003）は書き出しで**焼き込まれる**ので、プレビューにも同じものを出す
        // ＝見えていたものと違う動画が出てこない（ADR-0001）。その時刻にしゃべっている声のキャラ。
        // 動画全体のフォント（`videoSettings.fontId`）＝部品ごとの指定が無いときの受け皿。書き出しにも
        // 同じものを渡している（渡さないとプレビューだけ既定の字体になり、焼いた動画と字が変わる）。
        fontFamily: fontFamilyForId(doc.videoSettings.fontId),
        credit: creditForLine(
          { speaker: creditSpeakerAt(doc, frameTimeSec(doc, playheadSec)) },
          creditForSpeaker(getVoicevoxSpeaker()),
        ),
        responsive: true,
      })
    : "";
  // 時間 → 画面上の長さ。短い動画でも列が潰れないよう下限を置く（横スクロールは既存 CSS が持つ）。
  // ⚠️ まだ全体表示を決めていない間も**段の上の値**を使う（段に無い値を混ぜると、そこから
  // 段を動かしたときに飛ぶ）。幅が測れない環境（テスト）でもここに落ち着く。
  const pxPerSec = ZOOM_LEVELS[zoomIndex ?? DEFAULT_ZOOM_INDEX];
  const laneWidthPx = Math.max(totalSec * pxPerSec, MIN_LANE_WIDTH_PX);
  const step = tickStepSec(pxPerSec); // 目盛りは**倍率**で決める（共有関数・#686 レビュー）
  const ticks = Array.from({ length: Math.floor(totalSec / step) + 1 }, (_, i) => i * step);

  // 欄（ADR-0033 段階2）＝いまのカードをそのまま欄にする。**中身は変えない**（配置の仕組みだけを外から被せる）。
  const panels: PanelSpec[] = [
    { id: PANEL_ID.preview, title: '仕上がり確認', content: (
      <>
        <div className="preview-stage-wrap">
          {/* ⚠️ **比を動画の向きに合わせる**（#685 レビュー 🔴）。CSS の既定は 16:9 固定なので、縦型では
              SVG が中で letterbox され、上に重ねる操作レイヤ（`inset: 0`）と**実際に描かれている矩形が
              ずれる**（枠が約3倍の幅になり、動かす量も同じだけずれる）。場面形式のプレビューも
              「比をキャンバスに合わせて SVG を充填する＝余白を作らない」で同じ問題を解いている。 */}
          <div
            ref={stageRef}
            className={`preview-stage${drag?.drop?.center ? (drag.drop.issue ? " drop-target--blocked" : " drop-target") : ""}`}
            style={{ aspectRatio: `${canvasDims.width} / ${canvasDims.height}` }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          {/* **キャンバスで掴んで動かす**（#685 後半・ADR-0034 決定6）＝場面編集の自由配置と**同じ部品**
              （`FreeLayoutOverlay`）を流用する＝2つの画面で操作感を割らない。ハンドルは**選んだら常に**（決定7）。
              ⚠️ **再生中・書き出し中は出さない**＝動いている絵と設計位置のハンドルがずれて見える／
              書き出し中の編集は動画に入らない（決定22・`TIMELINE_EDIT_EXPORTING` と同じ理由）。 */}
          {!isPlaying && !exporting && canvasEls.length > 0 && (
            <FreeLayoutOverlay
              key={doc.projectId}
              freeLayout={canvasEls}
              canvasW={canvasDims.width}
              canvasH={canvasDims.height}
              selectedIds={selectedClipIds}
              // 空白を押したら解除（決定15＝選択モデルは1つ）。
              onSelect={(id: string | null, additive?: boolean) => (id == null ? clearSelection() : selectClip(id, additive))}
              onSelectMany={(ids: string[]) => selectClips(ids)}
              onChange={(id: string, g: { x: number; y: number; w?: number; h?: number }) => setClipBoxById(id, g)}
              onRotate={(id: string, rotation: number) => setClipBoxById(id, { rotation })}
              // ⚠️ **まとめては全か無か**（決定15）＝1件ずつ流すと固定した列の部品だけ黙って取り残される。
              onMoveMany={(moves: { id: string; x: number; y: number }[]) => setClipBoxesFor(moves.map((m) => ({ id: m.id, patch: { x: m.x, y: m.y } })))}
              onResizeMany={(geoms: { id: string; x: number; y: number; w: number; h: number }[]) => setClipBoxesFor(geoms.map((g) => ({ id: g.id, patch: { x: g.x, y: g.y, w: g.w, h: g.h } })))}
              // **1回のドラッグ＝1回の取り消し**（決定20）。動かすたびに履歴を積まない。
              onInteractionStart={beginHistoryGroup}
              onInteractionEnd={endHistoryGroup}
            />
          )}
        </div>
        <div className="row gap-sm">
          <button
            className="btn btn-primary"
            onClick={isPlaying ? pause : play}
            disabled={totalSec <= 0}
            title={totalSec <= 0 ? "まだ何も置かれていません。部品を置くと再生できます" : undefined}
          >
            {isPlaying ? "停止" : "再生"}
          </button>
          <button className="btn btn-ghost" onClick={() => setPlayhead(0)} disabled={playheadSec === 0}>
            先頭へ
          </button>
          {exporting ? (
            <button className="btn btn-ghost" onClick={cancelTimelineExport} disabled={exportRun.cancelling}>
              {exportRun.cancelling ? "中止しています…" : "書き出しを中止"}
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={() => {
                // **答えを求める確認は閉じてから始める**（#703 レビュー）。開いたまま走らせると、答えたのに
                // 断られる＝取り返しのつかなさを聞いた意味が無くなる（黙って何もしない、も作らない）。
                setExploding(null);
                setRemovingTrackId(null);
                void exportTimelineVideo({ templates, templateAssetSrcById });
              }}
              disabled={exportBlocked != null || isPlaying}
              title={exportBlocked?.message ?? playingHint}
            >
              動画を書き出す
            </button>
          )}
        </div>
        {exportBlocked && exportBlocked.source === EXPORT_BLOCK_SOURCE.situation && !exporting && (
          // 無効にしたボタンの `title` はホバーで出ないことがあるので、**知らせの段にも出す**（#719 レビュー）。
          // 出すのは**いまの事情だけ**（#729 レビュー）＝中身の理由は下の一覧が全件並べるので、
          // ここにも出すと**同じ文が2つの知らせとして続き**、読み上げも2回になる。
          <p className="notice notice-warn" role="alert">{exportBlocked.message}</p>
        )}
        {exportBlockers.length > 0 && !exporting && (
          <ul className="notice notice-warn" role="alert">
            {exportBlockers.map((b) => (
              <li key={b.code}>{exportBlockedMessage[b.code]}</li>
            ))}
          </ul>
        )}
        {exporting && exportRun.phase !== EXPORT_RUN_PHASE.preparing && (
          <div className="field" aria-live="polite">
            <progress value={exportRun.percent} max={100} />
            <span>動画を書き出しています（{exportRun.percent}%）。そのままお待ちください。</span>
          </div>
        )}
        {exportRun.message && (
          <p className={exportRun.phase === EXPORT_RUN_PHASE.done ? "notice" : "notice notice-warn"} role="status">
            {exportRun.message}
            <button className="btn btn-ghost" onClick={dismissTimelineExport}>
              閉じる
            </button>
          </p>
        )}
        <label className="field">
          <span>再生位置</span>
          <input
            type="range"
            min={0}
            max={Math.max(totalSec, 0.1)}
            step={0.1}
            value={playheadSec}
            onChange={(e) => setPlayhead(Number(e.target.value))}
          />
        </label>
        <p className="text-muted">
          {playheadSec.toFixed(1)} 秒 / 全体 {totalSec.toFixed(1)} 秒
        </p>
      </>
    ) },
    { id: PANEL_ID.arrange, title: '並び', content: (
      <>
        {/* **部品が無くても列は描く**（#684 レビュー）。新しい動画は最初から映像と音の列を1本ずつ持っているのに、
            空のときだけ列を消していたので**最初の1個をここへ運べなかった**（3手順の1歩目がドラッグで通らない）。
            空のときは「次の一歩」を添える＝置き方が2通りあることを、置く前に知らせる（§2-5・ADR-0034 決定22）。 */}
        {doc.clips.length === 0 && (
          <p className="text-muted">
            まだ何も置かれていません。「素材・文字・図形を置く」の欄から運んでくるか、「文字を置く」を押すと再生位置へ置けます。
          </p>
        )}
        {doc.tracks.length === 0 ? (
          <p className="text-muted">列がありません。「映像の列を足す」で作ってください。</p>
        ) : (
          // 見た目は読み取り専用タイムライン（ADR-0018 ③(2)）と同じ CSS を使う＝2つの一覧で見え方が割れない（§6）。
          <div
            className="timeline"
            // 幅は**TS が単一の参照元**（下限の計算がこの値を引くので、CSS の既定に頼ると黙ってずれる）。
            style={{
              ["--timeline-label-w" as string]: `${LANE_LABEL_PX}px`,
              ["--clip-handle-w" as string]: `${CLIP_HANDLE_W_PX}px`,
              ["--clip-menu-w" as string]: `${CLIP_MENU_W_PX}px`,
            }}
          >
            {/* 表示倍率（#686・決定13）＝**全体を表示**から始め、段で広げ縮めできる。
                `Ctrl`+ホイールでも同じ段を動かし、**錨点はマウスの位置**（見ていた所が流れない）。 */}
            <div className="timeline-toolbar">
              <span className="text-sm text-muted">表示倍率</span>
              <button
                className="btn btn-ghost btn-icon"
                aria-label="表示を縮める"
                disabled={(zoomIndex ?? DEFAULT_ZOOM_INDEX) <= 0}
                onClick={() => changeZoom((i) => stepZoomIndex(i ?? DEFAULT_ZOOM_INDEX, -1))}
              >
                −
              </button>
              <button
                className="btn btn-ghost btn-icon"
                aria-label="表示を広げる"
                disabled={(zoomIndex ?? DEFAULT_ZOOM_INDEX) >= ZOOM_LEVELS.length - 1}
                onClick={() => changeZoom((i) => stepZoomIndex(i ?? DEFAULT_ZOOM_INDEX, 1))}
              >
                ＋
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => changeZoom(fitZoomIndex(totalSec, (scrollRef.current?.clientWidth ?? 0) - LANE_LABEL_PX))}
              >
                全体を表示
              </button>
            </div>
            <div className="timeline-scroll" ref={scrollRef}>
              <div className="timeline-inner">
                <div className="timeline-row">
                  <div className="timeline-row-label" />
                  {/* シークは**ルーラーが受ける**（ADR-0023 段階(1)・読み取り専用の見わたす画面と同じ流儀）。
                      列で受けると帯の選択・ドラッグと取り合いになる。役割は button ではなく **slider**＝
                      位置を持つ操作なので読み上げに現在位置が伝わり、矢印キーで動かせる。 */}
                  <div
                    className="timeline-track timeline-ruler timeline-ruler--seekable"
                    style={{ width: laneWidthPx }}
                    role="slider"
                    tabIndex={0}
                    // 名前は下の「再生位置」の欄と**分ける**＝同じ名前の操作が2つあると、読み上げでも
                    // テストでもどちらを指しているか決まらない。役割（何を触る所か）で呼び分ける。
                    aria-label="時間の目盛り"
                    aria-valuemin={0}
                    aria-valuemax={totalSec}
                    aria-valuenow={playheadSec}
                    aria-valuetext={`${playheadSec.toFixed(1)}秒`}
                    onClick={(e) => {
                      // 押した所に線が来る（ヘッドの位置＝秒×倍率 の逆）。範囲へ収めるのは store。
                      const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
                      setPlayhead(x / pxPerSec);
                    }}
                    onKeyDown={(e) => {
                      // ⚠️ **←→ はここで受ける**（#686 レビュー）。画面のキー操作は「矢印を使う要素」
                      // （`role="slider"` を含む）に譲るので、ここで受けないと**両方が手を引いて何も起きず**、
                      // 既定の横スクロールだけが起きる。動かす量は画面と**同じ入口**（フレーム送り・#721）。
                      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                        e.preventDefault();
                        playRef.current.seekFrames((e.shiftKey ? playRef.current.fps : 1) * (e.key === "ArrowLeft" ? -1 : 1));
                        return;
                      }
                      // Home/End で先頭・末尾へ。画面が横スクロールしてヘッドを見失わないよう既定を止める。
                      if (e.key === "Home") { e.preventDefault(); setPlayhead(0); return; }
                      if (e.key === "End") { e.preventDefault(); setPlayhead(totalSec); return; }
                    }}
                  >
                    {ticks.map((t) => (
                      <span key={t} className="timeline-tick" style={{ left: `${pxPerSec * t}px` }}>
                        {t}秒
                      </span>
                    ))}
                  </div>
                </div>
                {/* 再生位置の線（#686）＝**いま何が出ているか**を並びの上で見せる。読み取り専用の
                    見わたす画面と同じ CSS（`timeline-playhead`）＝2つの一覧で見え方が割れない。
                    押せる相手ではないので `pointer-events` は CSS で切る（帯やルーラーを覆わない）。 */}
                {totalSec > 0 && (
                  <div
                    className="timeline-playhead"
                    style={{ left: `calc(var(--timeline-label-w) + ${pxPerSec * playheadSec}px)` }}
                    aria-hidden
                  />
                )}
                {/* 表示は**手前が上**（配列は後ろほど手前なので逆順に並べる）＝重なりの見え方と一致させる。
                    行にも解除を付けるのは、列の幅より画面が広いとき**右側にできる余白**を押しても解けるようにするため
                    ＝「何もない所を押すと解ける」の当たり判定を見た目どおりにする（#701 レビュー）。 */}
                {[...doc.tracks].reverse().map((track) => (
                  <div
                    className="timeline-row"
                    key={track.id}
                    onClick={(e) => { if (e.target === e.currentTarget) clearSelectionByClick(); }}
                  >
                    {/* 操作は右クリックのメニューへ畳む＝行に文字を並べない（帯が読めなくなる・利用者指摘 2026-08-03）。
                        行に残すのは**名前と状態**だけ。右クリックできると分かるよう、同じメニューを開く小さなボタンも置く
                        （右クリックを知らない・使えない場合の逃げ道＝§2-5）。 */}
                    <div className="timeline-row-label" onContextMenu={(e) => openTrackMenu(e, track.id)}>
                      <span>{trackLabel(doc.tracks, track.id)}</span>
                      {track.hidden && <span className="sub">出さない</span>}
                      {track.locked && <span className="sub">固定中</span>}
                      <button
                        className="btn btn-ghost btn-sm"
                        aria-label={`${trackLabel(doc.tracks, track.id)}の操作`}
                        title="この列の操作（右クリックでも開けます）"
                        onClick={(e) => openTrackMenu(e, track.id)}
                      >
                        ⋮
                      </button>
                    </div>
                    {/* **何もない所を押したら選択を解く**（ADR-0034 決定15）。帯を押したときは帯側が受けるので、
                        ここでは**この箱そのものを押したとき**だけ効かせる（帯から上がってきた分では解かない）。 */}
                    <div
                      // 落とし先は**自分が描いた箱**で当てる（上に何か重なっていても見失わない）。
                      ref={(el) => { if (el) laneRefs.current.set(track.id, el); else laneRefs.current.delete(track.id); }}
                      className={`timeline-track timeline-lane${drag?.drop?.at?.trackId === track.id ? (drag.drop.issue ? " drop-target--blocked" : " drop-target") : ""}`}
                      style={{ width: laneWidthPx }}
                      onClick={(e) => { if (e.target === e.currentTarget) clearSelectionByClick(); }}
                    >
                      {/* **入る場所を実寸で見せる**（#684 レビュー）＝欄のドラッグが線で示すのと同じ流儀。
                          「その列のどこに・何秒ぶん」が見えないまま落とさせない。 */}
                      {drag?.drop?.at?.trackId === track.id && (
                        <div
                          className={`timeline-drop-preview${drag.drop.issue ? " timeline-drop-preview--blocked" : ""}`}
                          style={{ left: `${pxPerSec * drag.drop.at.startSec}px`, width: `${pxPerSec * VISUAL_CLIP_DURATION_SEC}px` }}
                          aria-hidden="true"
                        />
                      )}
                      {doc.clips
                        .filter((c) => c.trackId === track.id)
                        .map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            className={[
                              "timeline-clip",
                              CLIP_KIND_CLASS[c.kind],
                              selectedClipIds.includes(c.id) ? "timeline-clip--selected" : "",
                              // 掴めることを見た目で示す（`cursor: grab`・CSS は用意済みだった）。
                              // 掴めないときは `cursor: grab` も出さない（掴めそうに見せない・#686 レビュー）。
                              grabbableClip(c) ? "timeline-clip--editable" : "",
                              clipDrag?.clipId === c.id ? "timeline-clip--dragging" : "",
                              clipDrag?.clipId === c.id && clipDrag.issue ? "drop-target--blocked" : "",
                            ].filter(Boolean).join(" ")}
                            // 掴んでいる間は**その場で動かして見せる**（離すまで文書は変えない）。
                            style={dragStyleOf(c)}
                            onPointerDown={(e) => beginClipDrag(e, c.id, "move")}
                            // 帯は短いと文字が読めない＝**名前と時間帯を添える**。書式は場面形式の見わたす画面と
                            // **同じ関数**から採る（別々に書くと同じ概念が画面で違う見え方になる・ADR-0026②）。
                            title={clipRangeTitle(clipLabel(c), c.startSec, clipEndSec(c))}
                            onClick={(e) => { if (skipClickRef.current) { skipClickRef.current = false; return; } selectClip(c.id, e.shiftKey); }}
                            // 右クリックのほか、キーボードの「メニューキー」「Shift+F10」でもここが呼ばれる
                            // ＝ドラッグ専用の操作を作らない（ADR-0034 決定19）。
                            onContextMenu={(e) => openClipMenu(e, c.id)}
                          >
                            {clipLabel(c)}
                            {/* 端を掴んで縮める（決定9）。選んだ帯にだけ出す＝隣の当たり判定を常時食わない。 */}
                            {selectedClipIds.includes(c.id) && showHandles(c) && (
                              <>
                                <span
                                  className="timeline-clip-handle timeline-clip-handle--left"
                                  onPointerDown={(e) => { e.stopPropagation(); beginClipDrag(e, c.id, "trim-start"); }}
                                />
                                <span
                                  className="timeline-clip-handle timeline-clip-handle--right"
                                  onPointerDown={(e) => { e.stopPropagation(); beginClipDrag(e, c.id, "trim-end"); }}
                                />
                              </>
                            )}
                          </button>
                        ))}
                      {/* 帯の操作を開く「⋮」（#701）＝列の行と同じ逃げ道。
                          ⚠️ **帯の中には入れない**＝`button` の入れ子は不正で、しかも帯の読み上げ名に
                          「⋮」が混ざって「その帯を名前で掴む」ができなくなる。帯と同じ場所に**並べて**置く。 */}
                      {doc.clips
                        .filter((c) => c.trackId === track.id && selectedClipIds.includes(c.id))
                        .map((c) => (
                          <button
                            key={`${c.id}-menu`}
                            type="button"
                            className="timeline-clip-menu"
                            // 帯の**内側の右端**（外に置くと隣の帯の当たり判定を食う＝CSS の ⚠️）。
                            // ⚠️ **右の取っ手のぶんだけ内側へ寄せる**（#742→#686 レビュー・実機で確認）。
                            // 「⋮」は帯の兄弟で `z-index` が上なので、右端に置くと**取っ手を丸ごと覆う**
                            // ＝左端は掴めるのに右端だけメニューが開く（左右非対称に壊れる）。
                            // 掴んでいる間は帯と**一緒に動く**（元の位置に取り残さない）。
                            // ⚠️ 取っ手を**出していないとき**まで避けると、細い帯では「⋮」が左の外へはみ出す
                            // （隣の帯の当たり判定を食う）。避ける条件は取っ手を出す条件と**同じものを見る**。
                            style={{
                              left: `calc(${pxPerSec * dragSpanOf(c).endSec}px - var(--clip-menu-w)${
                                showHandles(c) ? " - var(--clip-handle-w)" : ""
                              })`,
                            }}
                            aria-label={`${clipLabel(c)}の操作`}
                            title="この部品の操作（右クリックでも開けます）"
                            onClick={(e) => {
                              // キーボード（Enter/Space）の click は座標を持たない＝そのまま渡すと
                              // メニューが画面の左上に出る。押した要素の位置から開く。
                              if (isKeyboardActivation(e)) {
                                const r = e.currentTarget.getBoundingClientRect();
                                if (!selectedClipIds.includes(c.id)) selectClip(c.id);
                                setClipMenu({ clipId: c.id, x: r.left, y: r.bottom });
                                return;
                              }
                              openClipMenu(e, c.id);
                            }}
                          >
                            ⋮
                          </button>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </>
    ) },
    { id: PANEL_ID.selected, title: '選んだ部品', content: (
      <>
        {selected ? (
          <>
            <p className="text-muted">
              {clipLabel(selected)}（{selected.startSec.toFixed(1)}秒から{selected.durationSec.toFixed(1)}秒間）
            </p>
            <div className="row gap-sm">
              <button className="btn btn-secondary" onClick={() => moveSelectedClip({ startSec: selected.startSec - NUDGE_SEC })} {...editGuard()}>
                前へ
              </button>
              <button className="btn btn-secondary" onClick={() => moveSelectedClip({ startSec: selected.startSec + NUDGE_SEC })} {...editGuard()}>
                後ろへ
              </button>
              {/* 再生位置を使う操作は**再生中に押させない**＝走っている位置を掴むと結果が毎回変わる（§2-5）。 */}
              <button className="btn btn-secondary" onClick={() => moveSelectedClip({ startSec: playheadSec })} {...editGuard({ disabled: isPlaying, hint: playingHint })}>
                再生位置へ
              </button>
              <button className="btn btn-secondary" onClick={() => trimSelectedClip("start", playheadSec)} {...editGuard({ disabled: isPlaying, hint: playingHint })}>
                ここから始める
              </button>
              <button className="btn btn-secondary" onClick={() => trimSelectedClip("end", playheadSec)} {...editGuard({ disabled: isPlaying, hint: playingHint })}>
                ここで終わる
              </button>
              <button className="btn btn-secondary" onClick={duplicateSelectedClip} {...editGuard(duplicateExtra())}>同じものを足す</button>
              <button className="btn btn-danger" onClick={requestRemoveSelected} {...(removeBlocked ?? {})} title={removeBlocked?.title ?? "選んだ部品を消します（Delete）"}>消す</button>
            </div>
            {/* **数値でも同じ値を触れる**（#721・ADR-0034 決定6）。ボタンの「前へ／後ろへ」（0.5秒ずつ）と
                「ここで終わる」（再生位置を使う）だけでは、「3.0秒から」「5.0秒間」に**揃える手段が無い**。
                流し込む先はボタンと同じ入口（`moveSelectedClip`／`trimSelectedClip`）＝置けない条件も同じ。
                刻みは1フレーム＝出力の格子と同じ（半端な位置に置いて、書き出しで黙ってずらさない）。 */}
            <div className="row gap-sm">
              <NumberField
                label="開始（秒）"
                value={selected.startSec}
                min={0}
                step={frameStepSec}
                {...editGuard()}
                onChange={(v) => moveSelectedClip({ startSec: v })}
                inputStyle={{ width: 90 }}
              />
              <NumberField
                label="長さ（秒）"
                value={selected.durationSec}
                min={TIMELINE_MIN_CLIP_SEC}
                step={frameStepSec}
                {...editGuard()}
                // 長さは**終わりの端を動かす**＝始まりは動かない（ボタンの「ここで終わる」と同じ入口）。
                onChange={(v) => trimSelectedClip("end", selected.startSec + v)}
                inputStyle={{ width: 90 }}
              />
            </div>
            {/* **置いた部品の位置・大きさ・向き**（#685・ADR-0034 決定6）。
                ⚠️ 出す値は**解決した箱**（`resolveClipBox`）＝箱は未指定だと画面いっぱいなので、
                持っている値だけ出すと空欄になり「動かせない」に見える。編集すると箱ぜんぶを書き込む。
                言い方と並びは**場面編集の自由配置と同じ**（同じ概念を画面で別の言い方にしない・ADR-0026②）。
                ⚠️ **重ね順（前へ／奥へ）は出さない**＝この形式の重ね順は**列の並びだけ**（決定17）。 */}
            {/* ⚠️ **節にする**（#685 レビュー）＝時間の欄（開始・長さ）とひと続きに並べると、
                「長さ（秒）」の下に「幅」が来て**どれが秒でどれが画面の座標か読み取れない**。
                同じ空間の話である「切り抜き」は既に節なので、揃えないと同じ画面で流儀が割れる。 */}
            {selectedBox && (
              <CollapsibleSection key={`box-${selected.id}`} scope={SECTION_SCOPE.timeline} storageKey="box" title="位置・大きさ" defaultOpen>
                <div className="row gap-sm">
                  <NumberField label="横位置" value={selectedBox.x} {...editGuard()} onChange={(v) => setSelectedClipBox({ x: v })} inputStyle={{ width: 90 }} />
                  <NumberField label="縦位置" value={selectedBox.y} {...editGuard()} onChange={(v) => setSelectedClipBox({ y: v })} inputStyle={{ width: 90 }} />
                </div>
                <div className="row gap-sm">
                  <NumberField label="幅" value={selectedBox.w} min={MIN_BOX_SIZE_PX} {...editGuard()} onChange={(v) => setSelectedClipBox({ w: v })} inputStyle={{ width: 90 }} />
                  <NumberField label="高さ" value={selectedBox.h} min={MIN_BOX_SIZE_PX} {...editGuard()} onChange={(v) => setSelectedClipBox({ h: v })} inputStyle={{ width: 90 }} />
                  <NumberField label="角度" value={selectedBox.rotation ?? 0} min={ROTATION_DEG_MIN} max={ROTATION_DEG_MAX} {...editGuard()} onChange={(v) => setSelectedClipBox({ rotation: v })} inputStyle={{ width: 90 }} />
                </div>
              </CollapsibleSection>
            )}
            {/* ⚠️ **欄が消えるだけにしない**（#685 レビュー）＝見た目パターンの部品は枠そのものなので
                位置の欄を出さないが、黙って消すと「壊れている／見つけられない」に見える。
                行き先（「中身をバラす」）は実在するので、次の行動として名指しする（§2-5・決定8）。 */}
            {selected.kind === TIMELINE_CLIP_KIND.template && (
              <p className="text-sm text-muted">
                この部品は見た目パターンの枠そのものです。中の位置や大きさを変えるには「中身をバラす」を使ってください。
              </p>
            )}

            <label className="field">
              <span>置く列</span>
              {/* ⚠️ **移せる列だけ**出す（#714 レビュー）。全部並べると、隠した列・種別違いの列を選べて
                  **選べたのに事後に断られる**（同じ画面の置く側は `placeableTracks` で絞っている＝流儀が割れる）。
                  **いま載っている列は必ず残す**＝隠した列にある帯もその列に留まれる（動かす側の規則と同じ）。 */}
              <select className="select" value={selected.trackId} {...editGuard()} onChange={(e) => moveSelectedClip({ trackId: e.target.value })}>
                {doc.tracks
                  .filter((t) => t.id === selected.trackId || moveClipIssue(doc, selected.id, { trackId: t.id }) == null)
                  .map((t) => (
                    <option key={t.id} value={t.id}>{trackLabel(doc.tracks, t.id)}</option>
                  ))}
              </select>
            </label>

            {/* **置いた部品の中身**（#684）＝写真の差し替え・文字・図形の色や形。
                「置けるのに直せない」を作らない。場所と大きさは別（#685 のキャンバス操作）。 */}
            {(selected.kind === TIMELINE_CLIP_KIND.slot
              || selected.kind === TIMELINE_CLIP_KIND.text
              || selected.kind === TIMELINE_CLIP_KIND.shape) && (
              <CollapsibleSection key={`content-${selected.id}`} scope={SECTION_SCOPE.timeline} storageKey="content" title="中身" defaultOpen>
                {selected.kind === TIMELINE_CLIP_KIND.text && (
                  <>
                    <label className="field">
                      <span>文字</span>
                      <input
                        className="input" type="text"
                        value={selected.text ?? ""}
                        {...editGuard()}
                        {...textGroup}
                        onChange={(e) => setSelectedVisualContent({ text: e.target.value })}
                      />
                    </label>
                    <div className="row gap-sm">
                      <NumberField
                        label="文字の大きさ"
                        min={1}
                        step={4}
                        value={selected.fontSize ?? DEFAULT_FONT_SIZE}
                        {...editGuard()}
                        onChange={(v) => setSelectedVisualContent({ fontSize: v })}
                      />
                      <label className="field">
                        <span>文字の色</span>
                        <ColorPicker
                          value={selected.color ?? DEFAULT_TEXT_COLOR}
                          ariaLabel="文字の色"
                          onChange={(v) => setSelectedVisualContent({ color: v })}
                          onDragStart={beginHistoryGroup}
                          onDragEnd={endHistoryGroup}
                          {...editGuard()}
                        />
                      </label>
                    </div>
                    {/* 太さ・フォント・揃えも直せる（ADR-0034 決定4 が名指し・場面編集と同じ顔ぶれ）。
                        バラした文字はテンプレ由来の太字・中央揃えを持つので、これが無いと直せない。 */}
                    <div className="row gap-sm">
                      <label className="field">
                        <span>太さ</span>
                        <select
                          className="select"
                          value={selected.fontWeight ?? FONT_WEIGHT.normal}
                          {...editGuard()}
                          onChange={(e) => setSelectedVisualContent({ fontWeight: e.target.value as FontWeight })}
                        >
                          <option value={FONT_WEIGHT.normal}>ふつう</option>
                          <option value={FONT_WEIGHT.bold}>太字</option>
                        </select>
                      </label>
                      <label className="field">
                        <span>揃え</span>
                        <select
                          className="select"
                          value={selected.textAlign ?? TEXT_ALIGN.left}
                          {...editGuard()}
                          onChange={(e) => setSelectedVisualContent({ textAlign: e.target.value as TextAlign })}
                        >
                          <option value={TEXT_ALIGN.left}>左</option>
                          <option value={TEXT_ALIGN.center}>中央</option>
                          <option value={TEXT_ALIGN.right}>右</option>
                        </select>
                      </label>
                    </div>
                    <label className="field">
                      <span>フォント</span>
                      {/* **「動画全体に合わせる」へ戻せる**（#731）＝`clip.fontId` の `null` は継承で、
                          描画も動画全体の指定を受け皿にしている（§5）。`allowInherit` が無いと、
                          継承中でも**既定フォントの名前を現在値として表示**し（動画全体を別の字体に
                          していると表示と実際が食い違う）、一度選ぶと戻せない。場面編集は既に付いている
                          ので、無いままだと形式の間で非対称でもあった（ADR-0026②）。 */}
                      <FontPicker
                        value={selected.fontId ?? null}
                        allowInherit
                        {...editGuard()}
                        onChange={(id) => setSelectedVisualContent({ fontId: id })}
                      />
                    </label>
                  </>
                )}
                {selected.kind === TIMELINE_CLIP_KIND.shape && (
                  <div className="row gap-sm">
                    <label className="field">
                      <span>形</span>
                      <select
                        className="select"
                        value={selected.shapeType ?? FREE_SHAPE_TYPE.rect}
                        {...editGuard()}
                        onChange={(e) => setSelectedVisualContent({ shapeType: e.target.value as FreeShapeType })}
                      >
                        {FREE_SHAPE_TYPES.map((t) => (
                          <option key={t} value={t}>{freeShapeLabel[t]}</option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>色</span>
                      <ColorPicker
                        value={selected.fillColor ?? DEFAULT_SHAPE_COLOR}
                        ariaLabel="図形の色"
                        onChange={(v) => setSelectedVisualContent({ fillColor: v })}
                        onDragStart={beginHistoryGroup}
                        onDragEnd={endHistoryGroup}
                        {...editGuard()}
                      />
                    </label>
                  </div>
                )}
                {selected.kind === TIMELINE_CLIP_KIND.slot && (
                  <>
                    <label className="field">
                      <span>素材</span>
                      <select
                        className="select"
                        value={selected.assetId ?? ""}
                        {...editGuard()}
                        onChange={(e) => setSelectedVisualContent({ assetId: e.target.value === "" ? null : e.target.value })}
                      >
                        {/* 空の枠（バラすと生まれる）も表せるようにする＝いまの状態が読めない、を作らない。 */}
                        <option value="">なし（空の枠）</option>
                        {visualAssets.map((a) => (
                          <option key={a.assetId} value={a.assetId}>{a.displayName}</option>
                        ))}
                      </select>
                    </label>
                    <FitSelect
                      value={selected.fit ?? DEFAULT_FIT}
                      {...editGuard()}
                      onChange={(v) => setSelectedVisualContent({ fit: v })}
                    />
                  </>
                )}
              </CollapsibleSection>
            )}

            {/* 切り抜き（#634）＝箱の各辺を割合で隠す。中身は動かない（隠れるだけ）。
                節の `key`＝**部品を切り替えたら既定を見直す**。付けないと、同じ種類の部品を行き来する間は
                React が作り直さず、開閉が最初に選んだ部品のままになる（設定が入っていても畳まれたまま）。
                利用者が明示的に開閉した記憶は localStorage にあるので、作り直しても引き継がれる。 */}
            {selected.kind !== TIMELINE_CLIP_KIND.audio && selected.kind !== TIMELINE_CLIP_KIND.voice && (
              <CollapsibleSection key={`crop-${selected.id}`} scope={SECTION_SCOPE.timeline} storageKey="crop" title="切り抜き" defaultOpen={cropIsSet}>
                <div className="row gap-sm">
                  {CROP_EDGES.map((e) => (
                    <NumberField
                      key={e.edge}
                      label={e.label}
                      step={5}
                      min={0}
                      max={99}
                      value={Math.round((selected.crop?.[e.edge] ?? 0) * 100)}
                      {...editGuard()}
                      onChange={(v) => setSelectedClipCrop(e.edge, v / 100)}
                    />
                  ))}
                </div>
                <p className="text-muted">
                  部品の各辺を%で隠します。上下・左右それぞれの合計は99%までです。
                </p>
                {/* 切り抜きの効かせ方（#634）＝素材の差し込み口だけ（1つの素材に対する操作）。 */}
                {selected.kind === TIMELINE_CLIP_KIND.slot && (
                  <>
                    <label className="field">
                      <span>切り抜いたあと</span>
                      <select className="select"
                        value={selected.cropMode ?? CROP_MODE_DEFAULT}
                        {...editGuard()}
                        onChange={(e) => setSelectedClipCropMode(e.target.value as CropMode)}
                      >
                        <option value={CROP_MODE.mask}>隠したままにする（中身は動かない）</option>
                        <option value={CROP_MODE.fill}>残った部分を枠いっぱいに映す</option>
                      </select>
                    </label>
                    {selected.cropMode === CROP_MODE.fill && !selectedSourceSize && (
                      <p className="text-warn">
                        この素材の大きさがまだ分かりません（表示できていない素材や動画は測れません）。
                        いまは「隠したままにする」表示です。素材が画面に出れば自動で枠いっぱいに切り替わります。
                      </p>
                    )}
                  </>
                )}
                {/* 素材の寄せ（#634・05 §8）＝「枠いっぱいに表示」で収まらない側をどこで切るか。 */}
                <div className="row gap-sm">
                  <label className="field">
                    <span>素材の寄せ（横）</span>
                    <select className="select"
                      value={selected.cropAlign?.x ?? ""}
                      {...editGuard()}
                      onChange={(e) => setSelectedClipCropAlign({ x: (e.target.value || null) as CropAlignX | null })}
                    >
                      <option value="">中央</option>
                      <option value={CROP_ALIGN_X.left}>左</option>
                      <option value={CROP_ALIGN_X.right}>右</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>素材の寄せ（縦）</span>
                    <select className="select"
                      value={selected.cropAlign?.y ?? ""}
                      {...editGuard()}
                      onChange={(e) => setSelectedClipCropAlign({ y: (e.target.value || null) as CropAlignY | null })}
                    >
                      <option value="">中央</option>
                      <option value={CROP_ALIGN_Y.top}>上</option>
                      <option value={CROP_ALIGN_Y.bottom}>下</option>
                    </select>
                  </label>
                </div>
                <p className="text-muted">
                  寄せは「枠いっぱいに表示」で枠に収まらない側をどこで切るかです（全体を表示のときは余白の寄せになります）。
                </p>
              </CollapsibleSection>
            )}

            {/* 動き（キーフレーム）＝置いた時刻の値を並べると、その間はなめらかに変わる（ADR-0019・#634）。 */}
            {selected.kind !== TIMELINE_CLIP_KIND.audio && selected.kind !== TIMELINE_CLIP_KIND.voice && (
              <CollapsibleSection key={`anim-${selected.id}`} scope={SECTION_SCOPE.timeline} storageKey="anim" title="動き" defaultOpen={selectedKeyframes.length > 0 || groupKeyframes.length > 0}>
                <p className="text-muted">
                  再生位置（{playheadSec.toFixed(1)}秒）に「<strong>本来の見た目からのずれ</strong>」を置きます。
                  2か所に違う値を置くと、その間はなめらかに変わります。空欄の項目は動かしません。
                </p>
                {!keyframeAtPlayhead.live ? (
                  <p className="notice notice-warn" role="alert">
                    再生位置がこの部品の外にあります。部品が出ている時間（
                    {selected.startSec.toFixed(1)}〜{clipEndSec(selected).toFixed(1)}秒）へ動かしてから置いてください。
                  </p>
                ) : (
                  <>
                    <div className="row gap-sm">
                      {KEYFRAME_FIELDS.map((f) => (
                        <label className="field" key={f.prop}>
                          <span>{f.label}</span>
                          {/* **ここは確定式にしない**（#706 レビュー）＝この欄は文書ではなく**画面の下書き**で、
                              打っても履歴は積まれない。確定式にすると「打ってすぐ『置く』を押す」が
                              1回目に効かず（押せない状態のボタンはフォーカスを奪わない＝確定が走らない）、
                              欄が消える場面（再生位置が部品の外へ出る）で打ちかけが失われる。 */}
                          <input
                            className="input"
                            type="number"
                            step={f.step}
                            value={kfDraft[f.prop] ?? ""}
                            placeholder={String(f.neutral)}
                            {...editGuard()}
                            onChange={(e) => setKfDraft((d) => ({ ...d, [f.prop]: e.target.value }))}
                          />
                        </label>
                      ))}
                    </div>
                    <div className="row gap-sm">
                      <button
                        className="btn btn-secondary"
                        {...editGuard({
                          // 何も入っていないと押しても**何も起きず返事も出ない**＝音量の点と同じく、
                          // 押せなくして理由を出す（同じ画面で規準を割らない・#706 レビュー）。
                          disabled: isPlaying || Object.values(kfDraft).every((v) => (v ?? "") === ""),
                          hint: playingHint ?? (Object.values(kfDraft).every((v) => (v ?? "") === "") ? "動かしたい項目に値を入れてください" : undefined),
                        })}
                        onClick={() => {
                          if (keyframeLocalSec == null) return; // 置けない位置なら何もしない（音量の変化と同じ）
                          // **丸めた秒を渡す**（#702）。再生位置から起点を引いた生の値を渡すと
                          // `0.3-0.1=0.19999999999999998` のような端数になり、画面の照合（`keyframeTimeAt`）と
                          // 食い違って「置き直したのに1つ増える」「置いた値を読み込めない」が起きる。
                          setSelectedKeyframeAt(keyframeLocalSec, keyframeInputFromDraft(kfDraft));
                          // **置けたときだけ**空にする＝断られたときに入力し直しをさせない（`06 §12.1`・§2-5）。
                          // 音量の変化と同じ規準にする（同じ画面で規準を割らない＝ADR-0026②）。
                          if (!useTimelineStore.getState().editBlocked) setKfDraft({});
                        }}
                      >
                        この位置に置く
                      </button>
                      {keyframeAtPlayhead.keyframe && (
                        <button
                          className="btn btn-ghost"
                          {...editGuard()}
                          onClick={() => setKfDraft(draftFromKeyframe(keyframeAtPlayhead.keyframe))}
                        >
                          この位置の値を読み込む
                        </button>
                      )}
                    </div>
                  </>
                )}
                {selectedKeyframes.length === 0 ? (
                  <p className="text-muted">まだ動きは付いていません。</p>
                ) : (
                  <ul className="notice">
                    {selectedKeyframes.map((k) => (
                      <li key={k.timeSec}>
                        {(selectedOrigin + k.timeSec).toFixed(2)}秒：{keyframeSummary(k)}
                        {/* 動き方は「1つ前のキーフレームからここまで」に効く（#262）。 */}
                        <label className="field field-inline">
                          <span>ここまでの動き方</span>
                          <select className="select"
                            value={easingChoiceOf(k.easing)}
                            {...editGuard()}
                            onChange={(e) =>
                              setSelectedKeyframeAt(k.timeSec, {
                                easing:
                                  e.target.value === CURVE_CHOICE
                                    ? { bezier: curveSeedOf(k.easing) }
                                    : (e.target.value as Easing),
                              })
                            }
                          >
                            {EASING_CHOICES.map((c) => (
                              <option key={c.value} value={c.value}>{c.label}</option>
                            ))}
                          </select>
                        </label>
                        {/* 「両端ゆっくり」はカーブでは正確に表せない＝変える前に断る（ADR-0026④・§2-5）。 */}
                        {k.easing === EASING.easeInOut && (
                          <p className="text-muted">
                            「自由なカーブ」にすると、この動き方は正確には表せないため動きが少し変わります。
                          </p>
                        )}
                        {k.easing != null && typeof k.easing !== 'string' && (
                          <div className="row gap-sm">
                            {CURVE_FIELDS.map((f, i) => (
                              <NumberField
                                key={f.label}
                                label={f.label}
                                step={0.05}
                                {...(f.clamped ? { min: 0, max: 1 } : {})}
                                value={curveValue(k.easing, i)}
                                {...editGuard()}
                                onChange={(v) =>
                                  setSelectedKeyframeAt(k.timeSec, {
                                    easing: withCurveValue(k.easing, i, v),
                                  })
                                }
                              />
                            ))}
                          </div>
                        )}
                        <button className="btn btn-ghost btn-sm" onClick={() => setPlayhead(selectedOrigin + k.timeSec)}>
                          この位置へ
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          {...editGuard()}
                          onClick={() => removeSelectedKeyframe(k.timeSec)}
                        >
                          外す
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {selectedKeyframes.length > 0 && (
                  <button className="btn btn-ghost" {...editGuard()} onClick={clearSelectedKeyframes}>
                    動きをすべて外す
                  </button>
                )}
              </CollapsibleSection>
            )}
            {/* まとまり（グループ）に付いた動きも見せる＝画面では動いているのに「動きは付いていません」と
                言わない（焼き出しは自由配置の場面の切り替えをまとまりへ付ける・ADR-0032 決定19）。
                **これは節の外に出す**（#705 レビュー）＝中に置くと、利用者が一度「動き」を畳んでいると
                その記憶が既定より優先され、**知らせが二度と見えない**。畳める場所に置いてよい知らせではない。
                出す条件は「動き」の節と同じ（絵の無い部品では、まとまりに動きがあっても効かない）。 */}
            {selected.kind !== TIMELINE_CLIP_KIND.audio && selected.kind !== TIMELINE_CLIP_KIND.voice
              && groupKeyframes.map((g) => (
              <div className="notice" key={g.groupId}>
                <p>この部品が入っている「まとまり」にも動きが付いています（{g.keyframes.length}か所）。</p>
                <button
                  className="btn btn-ghost btn-sm"
                  {...busyGuard({
                    // **まとまりは「メンバーのどれかが固定なら固定」**（#709 レビュー）＝選んだ部品の列だけを
                    // 見ると、別のメンバーの列が固定されているときに押せてしまい、押してから断られる。
                    // 判定は domain と同じ関数を通す（画面で作り直さない）。
                    disabled: !!doc && isTargetLocked(doc, g.groupId),
                    hint: !!doc && isTargetLocked(doc, g.groupId) ? lockedSelectionHint : undefined,
                  })}
                  onClick={() => clearKeyframesOf(g.groupId)}
                >
                  まとまりの動きを外す
                </button>
              </div>
            ))}

            {/* 音の部品は、速さ・使い始め・音量・フェードを変えられる（#634＝中位の編集）。 */}
            {selected.kind === TIMELINE_CLIP_KIND.audio && (
              <CollapsibleSection scope={SECTION_SCOPE.timeline} storageKey="audio" title="音" defaultOpen={true}>
                {/* **鳴らす音を選び直せる**（#695・#723）。これが無いと「音を選び直してください」の案内に
                    対応する操作が画面に無い＝行き止まり（ADR-0034 決定5）。消して置き直す道はあるが、
                    それだと速さ・音量・フェード・音量の変化がすべて消える。 */}
                <label className="field">
                  <span>鳴らす音</span>
                  <select
                    className="select"
                    value={audioSourceValue}
                    {...editGuard()}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v.startsWith("bgm:")) setSelectedClipAudioSource({ bundledBgmId: v.slice(4) as BundledBgmId });
                      else if (v.startsWith("asset:")) setSelectedClipAudioSource({ assetId: v.slice(6) });
                    }}
                  >
                    {/* いまの状態が読めるように、選ばれていない状態も出す（空欄で固まって見えない）。 */}
                    {audioSourceValue === "" && <option value="">選ばれていません</option>}
                    {/* ⚠️ **いま指している音が候補に無いとき**（＝この欄が救おうとしている「音が見つからない」
                        状態そのもの）は、その値の option を出す。無いと `<select>` は**先頭の候補を選択済みに
                        見せる**ので、「見つかりません」と警告しているのに欄では別の曲が入っているように読める
                        （§2-5・黙って別のものに差し替えない）。素材の差し込み口と同じ流儀（`unselectableCurrent`）。 */}
                    {audioSourceMissing && (
                      <option value={audioSourceValue} disabled>元の音が見つかりません</option>
                    )}
                    {BGM_CATALOG.map((b) => (
                      <option key={b.id} value={`bgm:${b.id}`}>{b.title}</option>
                    ))}
                    {audioAssets.map((a) => (
                      <option key={a.assetId} value={`asset:${a.assetId}`}>{a.displayName}</option>
                    ))}
                  </select>
                </label>
                                  <NumberField
                    label="速さ（倍）"
                    step={0.1}
                    min={CLIP_SPEED_MIN}
                    max={CLIP_SPEED_MAX}
                    value={selected.speed ?? 1}
                    {...editGuard()}
                    onChange={(v) => setSelectedClipSpeed(v)}
                  />

                                  <NumberField
                    label="素材の使い始め（秒）"
                    step={0.5}
                    min={0}
                    value={selected.sourceStartSec ?? 0}
                    {...editGuard()}
                    onChange={(v) => setSelectedClipSourceStart(v)}
                  />

                <p className="text-muted">
                  速さを変えても部品の長さは変わりません（置いた長さぶんに、素材のどれだけを流すかが変わります）。
                  素材が置き場所より短いときは繰り返して埋まります。
                </p>
              </CollapsibleSection>
            )}

            {/* **音量と前後のフェードは、鳴る音を持つ部品すべてに出す**（#724）＝読み上げにも。
                下の「音量の変化」（点）は既に読み上げにも出ているので、**点は置けるのに基準の音量は
                直せない**という逆さまの状態だった（ADR-0026②）。描画側（`clipBaseVolume`／`clipFadeSec`）は
                どちらの種別も同じように読んでいるので、出していなかったのは画面だけ。 */}
            {isAudioClip(selected) && (
              <CollapsibleSection scope={SECTION_SCOPE.timeline} storageKey="volume" title="音量" defaultOpen={true}>
                <NumberField
                  label="音量"
                  step={VOLUME_STEP}
                  min={VOLUME_MIN}
                  max={VOLUME_MAX}
                  value={selected.volume ?? null}
                  placeholder="動画全体に合わせる"
                  {...editGuard({ disabled: hasVolumePoints, hint: volumePointsHint })}
                  onChange={(v) => setSelectedClipVolume(v)}
                  onClear={() => setSelectedClipVolume(null)}
                />
                {hasVolumePoints && <p className="text-muted">{VOLUME_POINTS_OVERRIDE_HINT}</p>}
                <div className="row gap-sm">
                  <NumberField
                    label="だんだん大きく（秒）"
                    step={0.5}
                    min={0}
                    value={selected.fadeInSec ?? 0}
                    {...editGuard()}
                    onChange={(v) => setSelectedClipFade("in", v)}
                  />
                  <NumberField
                    label="だんだん小さく（秒）"
                    step={0.5}
                    min={0}
                    value={selected.fadeOutSec ?? 0}
                    {...editGuard()}
                    onChange={(v) => setSelectedClipFade("out", v)}
                  />
                </div>
              </CollapsibleSection>
            )}

            {/* 読み上げは、この画面で文を書いて声を作れる（ADR-0032 決定7）。 */}
            {selected.kind === TIMELINE_CLIP_KIND.voice && (
              <CollapsibleSection scope={SECTION_SCOPE.timeline} storageKey="voice" title="読み上げ" defaultOpen={true}>
                <label className="field">
                  <span>読み上げる文</span>
                  <input
                    className="input" type="text"
                    value={selected.voice?.text ?? ""}
                    {...editGuard()}
                    {...textGroup}
                    onChange={(e) => setSelectedVoiceText(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>声</span>
                  <select className="select"
                    value={selected.voice?.speaker ?? ""}
                    {...editGuard()}
                    onChange={(e) => setSelectedVoiceSpeaker(e.target.value === "" ? null : Number(e.target.value))}
                  >
                    <option value="">動画全体に合わせる</option>
                    {VOICE_CATALOG.flatMap((c) =>
                      c.styles.map((st) => (
                        <option key={st.speaker} value={st.speaker}>{`${c.character}（${st.label}）`}</option>
                      )),
                    )}
                  </select>
                </label>
                <div className="row gap-sm">
                  <button
                    className="btn btn-primary"
                    {...editGuard({
                      disabled: !selected.voice?.text.trim() || generatingVoiceClipId != null,
                      // 押せない理由を無言にしない（作成中も含める＝#701 レビュー ℹ️）。
                      hint: !selected.voice?.text.trim()
                        ? "読み上げる文を入れてください"
                        : generatingVoiceClipId != null
                          ? "いま声を作っています。終わってからもう一度お試しください"
                          : undefined,
                    })}
                    onClick={() => void generateSelectedVoice()}
                  >
                    {generatingVoiceClipId === selected.id ? "作成中…" : "声を作る"}
                  </button>
                  {/* **選んだ読み上げの列の固定は関係ない**（#709 レビュー）＝置くのは別の（固定していない）列なので、
                      「固定を外してください」は実態と合わない案内になる。選択に依らない入口として扱う。 */}
                  <button className="btn btn-secondary" onClick={addLinkedSubtitleClip} {...busyGuard({ disabled: isPlaying, hint: playingHint })}>
                    この読み上げの字幕を置く
                  </button>
                </div>
                <p className="text-muted">
                  {selected.voice?.status === NARRATION_STATUS.generated
                    ? "声を作りました。長さは声に合わせています。"
                    : selected.voice?.status === NARRATION_STATUS.failed
                      ? "声を作れませんでした。もう一度お試しください。"
                      : "文を書いて「声を作る」を押すと、長さが声に合います。"}
                </p>
              </CollapsibleSection>
            )}

            {/* 音量の変化（#512 段4）＝置いた時刻の音量を並べると、その間はなめらかに変わる。
                音・読み上げのどちらにも置ける（鳴る音を持つ部品だけ）。 */}
            {isAudioClip(selected) && (
              <CollapsibleSection key={`volumePoints-${selected.id}`} scope={SECTION_SCOPE.timeline} storageKey="volumePoints" title="音量の変化" defaultOpen={selectedVolumePoints.length > 0}>
                <p className="text-muted">
                  再生位置（{playheadSec.toFixed(1)}秒）にその時の音量を置きます。違う値を2か所に置くと、
                  その間はなめらかに変わります。前後のフェードは、この変化の上に掛かります。
                </p>
                {!volumePointAtPlayhead.live ? (
                  <p className="notice notice-warn" role="alert">
                    再生位置がこの部品の外にあります。部品が鳴っている時間（
                    {selected.startSec.toFixed(1)}〜{clipEndSec(selected).toFixed(1)}秒）へ動かしてから置いてください。
                  </p>
                ) : (
                  <div className="row gap-sm">
                    <label className="field">
                      <span>この位置の音量</span>
                      {/* 上と同じ理由で**確定式にしない**（画面の下書き＝履歴に積まない・#706 レビュー）。 */}
                      <input
                        className="input"
                        type="number"
                        step={VOLUME_STEP}
                        min={VOLUME_MIN}
                        max={VOLUME_MAX}
                        value={volumeDraft}
                        {...editGuard()}
                        onChange={(e) => setVolumeDraft(e.target.value)}
                      />
                    </label>
                    <button
                      className="btn btn-secondary"
                      {...editGuard({
                        disabled: isPlaying || volumeDraft === "",
                        hint: playingHint ?? (volumeDraft === "" ? "この位置の音量を入れてください" : undefined),
                      })}
                      onClick={() => {
                        if (volumePointLocalSec == null) return; // 置けない位置なら何もしない（黙って先頭へ置かない）
                        setSelectedVolumePoint(volumePointLocalSec, Number(volumeDraft));
                        // **置けたときだけ**空にする＝上限などで断られたときに、入力し直しをさせない（§2-5）。
                        if (!useTimelineStore.getState().editBlocked) setVolumeDraft("");
                      }}
                    >
                      この位置に置く
                    </button>
                    {volumePointAtPlayhead.point && (
                      <button
                        className="btn btn-ghost"
                        {...editGuard()}
                        onClick={() => setVolumeDraft(String(volumePointAtPlayhead.point?.volume ?? ""))}
                      >
                        この位置の値を読み込む
                      </button>
                    )}
                  </div>
                )}
                {selectedVolumePoints.length === 0 ? (
                  <p className="text-muted">
                    まだ音量の変化は付いていません（この部品の間ずっと同じ音量で鳴ります）。
                  </p>
                ) : (
                  <ul className="notice">
                    {selectedVolumePoints.map((p) => (
                      <li key={p.timeSec}>
                        {(selected.startSec + p.timeSec).toFixed(2)}秒：音量 {p.volume}
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => setPlayhead(selected.startSec + p.timeSec)}
                        >
                          この位置へ
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          {...editGuard()}
                          onClick={() => removeSelectedVolumePoint(p.timeSec)}
                        >
                          外す
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {selectedVolumePoints.length > 0 && (
                  <>
                    <p className="text-muted">
                      置ける点は{VOLUME_POINTS_MAX}か所までです（いま{selectedVolumePoints.length}か所）。
                    </p>
                    <button
                      className="btn btn-ghost"
                      {...editGuard()}
                      onClick={clearSelectedVolumePoints}
                    >
                      音量の変化をすべて外す
                    </button>
                  </>
                )}
              </CollapsibleSection>
            )}

            {/* 字幕は読み上げと連動できる（ADR-0032 決定24）＝文言と時間が付いてくる。 */}
            {selected.kind === TIMELINE_CLIP_KIND.subtitle && (
              <CollapsibleSection scope={SECTION_SCOPE.timeline} storageKey="subtitleLink" title="連動する読み上げ" defaultOpen={true}>
                {voiceClips.length === 0 ? (
                  <p className="text-muted">連動できる読み上げの部品がまだありません。「読み上げを置く」で置くと、ここで選べます。</p>
                ) : (
                  <label className="field">
                    <span>連動先</span>
                    <select className="select"
                      value={selected.voiceClipId ?? ""}
                      {...editGuard()}
                      onChange={(e) => setSelectedSubtitleVoiceLink(e.target.value || null)}
                    >
                      <option value="">連動しない</option>
                      {voiceClips.map((v) => (
                        <option key={v.id} value={v.id}>{clipLabel(v)}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="field">
                  <span>{SUBTITLE_TEXT_FIELD_LABEL}</span>
                  <input
                    className="input" type="text"
                    value={selected.text ?? ""}
                    {...editGuard()}
                    placeholder={selected.voiceClipId ? "空にすると読み上げの文に合わせます" : ""}
                    {...textGroup}
                    onChange={(e) => setSelectedSubtitleText(e.target.value)}
                  />
                </label>
                <p className="text-muted">
                  {selected.voiceClipId
                    ? `いま出る文：「${subtitleTextOf(doc, selected) ?? ""}」${selected.text ? "（この部品の文が優先されています）" : "（連動先の読み上げ文）"}`
                    : "連動すると、読み上げの文と時間に合わせて字幕が出ます。"}
                </p>
              </CollapsibleSection>
            )}

            {/* 見た目パターンの部品は、置いたあとも中身を差し替えられる（ADR-0032 決定5）。 */}
            {selected.kind === TIMELINE_CLIP_KIND.template && (
              selectedTemplate ? (
                <CollapsibleSection scope={SECTION_SCOPE.timeline} storageKey="templateContent" title="この見た目パターンの中身" defaultOpen={true}>
                  {slotLayers.length === 0 && textKeys.length === 0 && (
                    <p className="text-muted">この見た目パターンに入れ替えられる中身はありません。</p>
                  )}
                  {slotLayers.map((layer, i) => (
                    <label className="field" key={layer.id}>
                      <span>{slotNames[i]}</span>
                      <select className="select"
                        value={selected.assetRefs?.[layer.id] ?? ""}
                        {...editGuard()}
                        onChange={(e) => setSelectedClipAssetRef(layer.id, e.target.value || null)}
                      >
                        <option value="">なし</option>
                        {assignableAssets(doc.assets, layer).map((a) => (
                          <option key={a.assetId} value={a.assetId}>{a.displayName}</option>
                        ))}
                        {/* いま入っているが選び直せないもの（動画）は、名前だけ出す＝「なし」と見分けが付く。 */}
                        {unselectableCurrent(doc.assets, selected.assetRefs?.[layer.id], layer) && (
                          <option value={selected.assetRefs?.[layer.id] ?? ""} disabled>
                            {unselectableCurrent(doc.assets, selected.assetRefs?.[layer.id], layer)?.displayName}（この形式では使えません）
                          </option>
                        )}
                      </select>
                      {/* 入れられる素材が1つも無い差し込み口は**永久に埋まらない**＝空の枠が動画に焼き込まれる。
                          黙って未設定のままにせず、何をすれば埋まるかを出す（§2-5・ADR-0026④）。 */}
                      {assignableAssets(doc.assets, layer).length === 0 && (
                        <span className="field-hint">
                          {layer.slotType === SLOT_TYPE.video
                            ? "ここは動画を入れる場所ですが、この形式ではまだ動画を使えません。この部品を「消す」で外し、「見た目パターンを置く」から動画を使わないものを置き直してください。"
                            : "入れられる写真がありません。「素材・文字・図形を置く」の欄で写真を取り込んでください。"}
                        </span>
                      )}
                    </label>
                  ))}
                  {textKeys.map((key) => (
                    <label className="field" key={key}>
                      <span>{textKeyLabel[key]}</span>
                      <input
                        className="input" type="text"
                        value={selected.texts?.[key] ?? ""}
                        {...editGuard()}
                        {...textGroup}
                        onChange={(e) => setSelectedClipText(key, e.target.value)}
                      />
                    </label>
                  ))}
                  <button
                    className="btn btn-secondary"
                    {...editGuard()}
                    onClick={() => setExploding({ clipId: selected.id, template: selectedTemplate })}
                  >
                    中身をバラす
                  </button>
                </CollapsibleSection>
              ) : (
                <p className="notice notice-warn" role="alert">
                  この部品の見た目パターンが見つかりません。見た目パターンを読み込み直すか、この部品を置き直してください。
                </p>
              )
            )}
          </>
        ) : (
          <p className="text-muted">
            {selectedClipIds.length > 1
              ? "1つだけ選ぶと、位置や長さを変えられます（まとめて消すことはできます）。"
              : "下の並びから部品を選ぶと、位置や長さを変えられます。"}
          </p>
        )}
        {selectedClipIds.length > 1 && (
          <button className="btn btn-danger" onClick={requestRemoveSelected} {...(removeBlocked ?? {})} title={removeBlocked?.title ?? "選んだ部品をまとめて消します（Delete）"}>選んだ{selectedClipIds.length}個を消す</button>
        )}
      </>
    ) },
    // **写真・文字・図形を置く**（#684・ADR-0034 段階1）＝置く手段がこれまで無かった。
    { id: PANEL_ID.place, title: '素材・文字・図形を置く', content: (
      <>
        {/* **取り込みは列と関係ない**（#712）＝置ける列が無いときも取り込めるようにしておく。
            ここを列の有無で隠すと、列を足すまで素材を用意できない＝行き止まり（ADR-0034 決定5）。 */}
        <div className="row gap-sm mb-sm">
          <AssetImportButton
            onFile={addAsset}
            onPath={addAssetByPath}
            isImporting={isImporting}
            disabledReason={exporting ? exportingHint : null}
            variant="secondary"
            label="写真・動画を取り込む"
          />
        </div>
        {importError && (
          <div className="notice notice-warn row-between mb-sm" role="alert">
            <span>{importError}</span>
            <button className="btn btn-ghost text-sm" onClick={clearImportError}>閉じる</button>
          </div>
        )}
        {placeableTracks.length === 0 ? (
          <p className="text-muted">置ける映像の列がありません。「映像の列を足す」で足すか、固定・非表示を外してください。</p>
        ) : (
          <>
            <p className="text-muted">
              押すと再生位置（{playheadSec.toFixed(1)}秒）から置きます。塞がっているときは、その次に空いている時刻へ置きます。
              つかんで運ぶと、落とした所（仕上がり確認の中／列の中）へ置けます。
            </p>
            <div className="row gap-sm">
              {/* **押すと再生位置へ・つかんで運ぶと落とした所へ**（ADR-0034 決定2＝両方）。
                  掴めない環境・人のために、押すだけの道は必ず残す（決定19）。 */}
              <button
                className="btn btn-secondary grabbable"
                {...busyGuard({ disabled: isPlaying, hint: playingHint })}
                onPointerDown={(e) => grabToPlace(e, TIMELINE_CLIP_KIND.text)}
                onClick={(e) => onKeyActivate(e, () => addVisualClip({ kind: TIMELINE_CLIP_KIND.text }))}
              >
                文字を置く
              </button>
              <button
                className="btn btn-secondary grabbable"
                {...busyGuard({ disabled: isPlaying, hint: playingHint })}
                onPointerDown={(e) => grabToPlace(e, TIMELINE_CLIP_KIND.shape)}
                onClick={(e) => onKeyActivate(e, () => addVisualClip({ kind: TIMELINE_CLIP_KIND.shape }))}
              >
                図形を置く
              </button>
            </div>
            {visualAssets.length === 0 ? (
              <p className="field-hint">この動画にはまだ写真がありません。「写真・動画を取り込む」で足せます。文字と図形はいま置けます。</p>
            ) : (
              <PickerList
                items={visualAssets.map((a) => ({ id: a.assetId, label: a.displayName }))}
                disabled={isPlaying || exporting}
                disabledHint={exporting ? exportingHint : playingHint}
                searchLabel="素材の絞り込み"
                onGrab={(e, assetId) => grabToPlace(e, TIMELINE_CLIP_KIND.slot, assetId)}
                onPick={(assetId) => addVisualClip({ kind: TIMELINE_CLIP_KIND.slot, assetId })}
              />
            )}
          </>
        )}
      </>
    ) },
    // 見た目パターンは「楽をするための素材」＝一覧からそのまま置ける（ADR-0032 決定6）。
    { id: PANEL_ID.templates, title: '見た目パターンを置く', content: (
      <>
        {placeableTemplates.length === 0 ? (
          <p className="text-muted">この向きの動画に置ける見た目パターンがありません。左の「見た目パターン」の画面で、この向きのものを足してください。</p>
        ) : placeableTracks.length === 0 ? (
          <p className="text-muted">置ける列がありません。「映像の列を足す」で列を作るか、列の固定・非表示を外してください。</p>
        ) : (
          <>
            <p className="text-muted">
              選んだ見た目パターンを、再生位置（{playheadSec.toFixed(1)}秒）から置きます。置いたあとも中身は差し替えられます。
            </p>
            <label className="field">
              <span>置く列</span>
              <select className="select" value={visualTrackId} onChange={(e) => setPlaceTrackId(e.target.value)}>
                {placeableTracks.map((t) => (
                  <option key={t.id} value={t.id}>{trackLabel(doc.tracks, t.id)}</option>
                ))}
              </select>
            </label>
            <PickerList
              items={placeableTemplates.map((t) => ({ id: t.templateId, label: t.name }))}
              disabled={isPlaying || exporting}
              disabledHint={exporting ? exportingHint : playingHint}
              searchLabel="見た目パターンの絞り込み"
              onPick={(templateId) => {
                const t = placeableTemplates.find((x) => x.templateId === templateId);
                if (!t) return;
                addTemplateClip({
                  template: t,
                  trackId: visualTrackId, // 欄に出ている列＝実際に置く列（表示と結果を割らない）
                  startSec: playheadSec,
                });
              }}
            />
          </>
        )}
      </>
    ) },
    { id: PANEL_ID.audio, title: '音を置く', content: (
      <>
        {voiceTracks.length === 0 ? (
          <p className="text-muted">置ける音の列がありません。「音の列を足す」で列を作るか、列の固定・非表示を外してください。</p>
        ) : (
          <>
            <p className="text-muted">再生位置（{playheadSec.toFixed(1)}秒）から置きます。置いたあとに速さ・音量を変えられます。</p>
            {/* **どこへ入るかを見せる**（#724）＝以前は無言でいちばん奥の列に固定していたので、
                列が2本以上あると「なぜここに入ったのか」が読めなかった。見た目パターンの欄と同じ流儀。 */}
            <label className="field">
              <span>置く列</span>
              <select className="select" value={audioTrackId} onChange={(e) => setPlaceAudioTrackId(e.target.value)}>
                {voiceTracks.map((t) => (
                  <option key={t.id} value={t.id}>{trackLabel(doc.tracks, t.id)}</option>
                ))}
              </select>
            </label>
            <PickerList
              items={[
                ...BGM_CATALOG.map((b) => ({ id: `bgm:${b.id}`, label: b.label, note: b.note })),
                ...audioAssets.map((a) => ({ id: `asset:${a.assetId}`, label: a.displayName })),
              ]}
              disabled={isPlaying || exporting}
              disabledHint={exporting ? exportingHint : playingHint}
              searchLabel="音の絞り込み"
              onPick={(id) => {
                // id の頭で出どころを分ける＝**音の出どころは高々1つ**（`11 §8` V25）を渡す時点で守る。
                const [kind, rest] = [id.slice(0, id.indexOf(":")), id.slice(id.indexOf(":") + 1)];
                // 同梱BGMは**目録から実体を引く**（見た目パターン側と同じ流儀）＝画面の文字列を id の型へ
                // 押し込まない。目録に無いものは置かない（存在しない曲を指す部品を作らない）。
                const bgm = kind === "bgm" ? BGM_CATALOG.find((b) => b.id === rest) : undefined;
                if (kind === "bgm" && !bgm) return;
                addAudioClip(
                  bgm
                    ? { bundledBgmId: bgm.id, trackId: audioTrackId, startSec: playheadSec }
                    : { assetId: rest, trackId: audioTrackId, startSec: playheadSec },
                );
              }}
            />
          </>
        )}
      </>
    ) },
    { id: PANEL_ID.voice, title: '読み上げを置く', content: (
      <>
        {voiceTracks.length === 0 ? (
          <p className="text-muted">置ける音の列がありません。「音の列を足す」で列を作るか、列の固定・非表示を外してください。</p>
        ) : (
          <>
            <p className="text-muted">再生位置（{playheadSec.toFixed(1)}秒）から置きます。置いたあとに文を書いて声を作ります。</p>
            {/* **どこへ入るかを見せる**（#724）＝以前は無言でいちばん奥の列に固定していたので、
                列が2本以上あると「なぜここに入ったのか」が読めなかった。見た目パターンの欄と同じ流儀。 */}
            <label className="field">
              <span>置く列</span>
              <select className="select" value={audioTrackId} onChange={(e) => setPlaceAudioTrackId(e.target.value)}>
                {voiceTracks.map((t) => (
                  <option key={t.id} value={t.id}>{trackLabel(doc.tracks, t.id)}</option>
                ))}
              </select>
            </label>
            <div className="row gap-sm">
              <button
                className="btn btn-secondary"
                {...busyGuard({ disabled: isPlaying, hint: playingHint })}
                onClick={() => addVoiceClip({ text: "", trackId: audioTrackId, startSec: playheadSec })}
              >
                読み上げを置く
              </button>
            </div>
          </>
        )}
      </>
    ) },
  ];

  return (
    <div className="main-scroll">
      {/* 説明文は出さない＝編集の場所を上から狭めない（利用者指摘 2026-08-04）。名前は「どの動画を
          編集しているか」なので残す。 */}
      <PageHead title={doc.projectName} />

      {exploding && (
        <DeleteConfirm
          message={`「${exploding.template.name}」の中身を1つ1つの部品に分けますか？動画の見た目は変わりませんが、写真や文字を入れる場所は無くなります（分けたあとは部品ごとに差し替えます）。元に戻すときは「取り消す」を押してください。`}
          confirmLabel="バラす"
          busyLabel="バラしています…"
          onCancel={() => setExploding(null)}
          onConfirm={() => {
            explodeClip(exploding.clipId, exploding.template);
            setExploding(null);
          }}
        />
      )}

      {confirmRemove !== null && (
        <DeleteConfirm
          message={`選んだ${confirmRemove.length}個の部品を消しますか？`}
          onCancel={() => setConfirmRemove(null)}
          onConfirm={() => {
            const ids = confirmRemove;
            setConfirmRemove(null);
            // 書き出しが始まっていたら消さない（出しっぱなしの確認から抜け道を作らない＝「動画の一覧へ」と同じ）。
            // 固定・存在の判定は **id を渡す先**（`removeClipsByIds`）が見る＝聞いた相手が消えていたら理由が出る。
            if (exporting) return;
            removeClipsByIds(ids);
          }}
        />
      )}

      {removingTrackId && doc.tracks.some((t) => t.id === removingTrackId) && (
        <DeleteConfirm
          message={`「${trackLabel(doc.tracks, removingTrackId)}」を消しますか？この列に置いてある${clipCountOnTrack(doc, removingTrackId)}個の部品も一緒に消えます。`}
          onCancel={() => setRemovingTrackId(null)}
          onConfirm={() => {
            removeTrack(removingTrackId);
            setRemovingTrackId(null);
          }}
        />
      )}

      {/*
        保存できていないまま戻ると変更は消える（#693）。**答えを求める確認は上に出す**＝下だと見落として
        そのまま進んでしまう（バラす・列を消すと同じ扱い）。「やめる」を選べば「保存し直す」を押しに戻れる。
      */}
      {confirmLeave !== null && (
        <DeleteConfirm
          message="保存できていない変更があります。このまま画面を移ると、その変更は失われます。移る前に「保存し直す」を試せます。"
          confirmLabel="保存しないで移る"
          onCancel={() => setConfirmLeave(null)}
          onConfirm={() => {
            const to = confirmLeave;
            setConfirmLeave(null);
            // 出しっぱなしの確認から戻れると、書き出し中でも画面を離れられてしまう（ボタン側と同じ条件で見る）。
            // 行き先は**聞いたときのもの**へ（サイドバーから離れようとしたなら、その画面へ）。
            if (exporting) {
              // 出しっぱなしの確認から抜けられると、書き出し中でも画面を離れられてしまう。
              // 黙って閉じずに理由を出す（押しても何も起きない、を作らない・§2-5）。
              setLeaveBlocked(LEAVE_BLOCKED_EXPORTING_MESSAGE);
              return;
            }
            leaveConfirmedRef.current = true;
            onNavigate(to);
          }}
        />
      )}


      {/*
        **その場の返事は「欄と同じ囲い」の中に入れる**（レビュー指摘）。貼り付け（sticky）は
        **囲いの中でだけ動く**ので、囲いを欄＋返事で閉じておけば、下にある操作の行
        （取り消す・列を足す・**動画の一覧へ**）の上に乗ることが構造的に起こらない。
        囲わないと、貼り付いた知らせが戻る導線を覆って押せなくなる（§2-5＝戻れない状態を作らない）。
      */}
      <div className="timeline-flash-zone">
        <PanelLayoutView layout={panelLayout} panels={panels} onChange={changeLayout} />

        {/* 運んでいるものの影（#684）。**指の先に付いて回る**＝いま何を運んでいるかが分かる。
            置けない所では色を変える＝**理由の文言はドラッグ中に出さない**（明滅させない・ADR-0034 決定10）。
            当たり判定は持たない（`pointer-events: none`）＝影が落とし先を隠さない。 */}
        {drag && (
          <div
            // 落とし先の**外**は中立（運んでいる道中はほぼ外＝ずっと赤だと「置けない」の意味が薄れる）。
            // 赤は**落とし先の中で置けないとき**だけ（ADR-0034 決定10）。
            className={`drag-ghost${drag.drop?.issue ? " drag-ghost--blocked" : ""}`}
            style={{ left: drag.x, top: drag.y }}
            aria-hidden="true"
          >
            {/* 名前は帯と同じ関数から採る（同じ物を画面内で別の名で呼ばない）。 */}
            {drag.kind === TIMELINE_CLIP_KIND.slot
              ? doc.assets.find((a) => a.assetId === drag.assetId)?.displayName ?? clipLabel({ kind: drag.kind })
              : clipLabel({ kind: drag.kind })}
          </div>
        )}

        {/* **操作したその場の返事**（置けなかった理由・声を作れなかった）は**欄のすぐ下に貼り付ける**。
            下へ流すと、恒常の警告が出ているときに画面外へ落ちて**同じ操作を繰り返す**（§2-5・ADR-0026④）。
            上に積まない（編集の場所を狭めない）と、必ず気づける、を両立させるための置き方。
            ※ **その場の返事を「操作した欄の中」に出すのが本筋**（ADR-0034 決定10）＝段階0 で寄せる。 */}
        {(voiceError || editBlocked || leaveBlockedMessage) && (
          <div className="notice notice-warn timeline-flash" role="alert">
            {voiceError && <p>{voiceError}</p>}
            {editBlocked && <p>{editBlockedMessage[editBlocked]}</p>}
            {leaveBlockedMessage && <p>{leaveBlockedMessage}</p>}
          </div>
        )}
      </div>

      {/* 直せば良くなる警告は、その下（出たままでも編集の邪魔をしない位置）。 */}
      {missingTemplateCount > 0 && (
        <p className="notice notice-warn" role="alert">
          見た目パターンが見つからない部品が{missingTemplateCount}個あります。その部品は動画に出ません。見た目パターンを読み込み直すか、置き直してください。
        </p>
      )}
      {emptySlotCount > 0 && (
        <p className="notice notice-warn" role="alert">
          素材が入っていない差し込み口が{emptySlotCount}個あります。そのままだと灰色の枠が動画に出ます。部品を選んで素材を入れてください。
        </p>
      )}
      {danglingLinkCount > 0 && (
        <p className="notice notice-warn" role="alert">
          連動する読み上げが見つからない字幕が{danglingLinkCount}個あります。連動先を選び直すか、連動をやめてください。
        </p>
      )}
      {missingImageCount > 0 && (
        <p className="notice notice-warn" role="alert">
          絵が出せない素材を使っている部品が{missingImageCount}個あります。そのままでは動画にその絵が出ません。素材を取り込み直すか、その部品を置き直してください。
        </p>
      )}
      {missingAudioCount > 0 && (
        <p className="notice notice-warn" role="alert">
          音が見つからない部品が{missingAudioCount}個あります。その部品は鳴りません。その部品を選んで「音」の「鳴らす音」で選び直すか、読み上げなら「声を作る」でもう一度作ってください。
        </p>
      )}
      {warnings.length > 0 && (
        <ul className="notice notice-warn" role="alert">
          {warnings.map((w) => (
            <li key={`${w.code}/${w.field}`}>{w.message}</li>
          ))}
        </ul>
      )}

      {/*
        自動保存の結果を**この画面が**出す（#693）。共通トップバーの保存ボタンは出さない決定（ADR-0032）なので、
        ここが唯一の担い手＝黙って落とすと「閉じても消えない」（`06 §12.1`）が破れる。**恒常の警告と同じ段**
        （欄の下）に置く＝編集の場所を上から圧迫しない。
      */}
      {saveStatus === "error" ? (
        <div className="notice notice-warn row gap-sm" role="alert">
          <span>{TIMELINE_SAVE_FAILED_MESSAGE}</span>
          <button className="btn btn-secondary" onClick={() => void saveTimelineProject()}>保存し直す</button>
        </div>
      ) : (
        // 保存できたことも控えめに出す（「勝手に保存されている」を信じられるようにする）。
        <p className="text-muted" role="status">{timelineSaveStatusLabel(saveStatus)}</p>
      )}

      <div className="row gap-sm mt-lg">
        {/* 閉じた欄は**必ず戻せる**・配置は**いつでも既定に戻せる**（ADR-0033 決定6/8＝戻れない状態を作らない）。 */}
        {closed.map((id) => (
          <button key={id} className="btn btn-secondary" onClick={() => changeLayout(addPanelToRegion(panelLayout, id, PANEL_REGION.left))}>
            「{panels.find((p) => p.id === id)?.title}」を表示する
          </button>
        ))}
        <button className="btn btn-ghost" onClick={resetLayout}>配置を既定に戻す</button>
      </div>

      <div className="row gap-sm mt-lg">
        <UndoRedoButtons
          canUndo={history.past.length > 0}
          canRedo={history.future.length > 0}
          onUndo={undo}
          onRedo={redo}
          disabled={exporting}
        />
        <button className="btn btn-secondary" onClick={() => addTrack(TRACK_KIND.visual)} {...busyGuard()}>映像の列を足す</button>
        <button className="btn btn-secondary" onClick={() => addTrack(TRACK_KIND.audio)} {...busyGuard()}>音の列を足す</button>
      </div>

      <div className="row gap-sm mt-lg">
        {/* 書き出し中に別の動画へ移ると、描いている途中の素材や音が入れ替わる（混ざった動画が出る）。 */}
        <button
          className="btn btn-ghost btn-icon"
          onClick={() => void leaveToHome()}
          disabled={exporting || leaving}
          title={exporting ? "書き出しが終わってから戻れます" : undefined}
        >
          <ArrowLeftIcon size={16} />
          {/* 実行中はラベルを変えて押せなくする（`06 §2` の統一規約4）。 */}
          {leaving ? "保存しています…" : "動画の一覧へ"}
        </button>
      </div>

      {trackMenu && menuTrack && (
        <ContextMenu x={trackMenu.x} y={trackMenu.y} items={trackMenuItems} onClose={() => setTrackMenu(null)} />
      )}
      {clipMenu && menuClip && (
        <ContextMenu x={clipMenu.x} y={clipMenu.y} items={clipMenuItems} onClose={() => setClipMenu(null)} />
      )}
    </div>
  );
}
