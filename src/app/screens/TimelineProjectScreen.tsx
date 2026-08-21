import { useCallback, useEffect, useMemo, useRef, useState, Fragment } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useEdgeAutoScroll } from "../hooks/useEdgeAutoScroll";
import { isKeyboardActivation, isPointerDragging, usePointerDrag, whenPointerDragEnds } from "../hooks/usePointerDrag";
import { playbackScrollLeft } from "../../domain/timeline/autoScroll";
import { canvasPointAt, clampToVisible, laneTimeAt, pointInRect, visibleRectOf } from "../timelineDrop";
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
import { DELETE_LABEL, DUPLICATE_LABEL, TIMELINE_VIDEO_AUDIO_UNKNOWN, TIMELINE_VIDEO_NO_AUDIO, TIMELINE_VIDEO_STILL_IN_GROUP_FADE, TIMELINE_VIDEO_STILL_ROTATED_CROP, TIMELINE_VIDEO_STILL_UNPLAYABLE, lockedTrackMessage, hiddenTrackDuplicateMessage, clockLabel } from "../uiLabels";
import { insertIndexForGap } from "../../domain/reorder";
import { EDIT_BLOCKED, clipCountOnTrack, clipPlacementIssue, moveClipIssue, placeableAudioTracks, placeableVisualTracks, placedDurationSec, trimClipIssue, moveClips } from "../../domain/timeline/edit";
import { clipImageAssetIds, timelineImageAssetIds, ASSET_USE_KIND } from "../../domain/timeline/export";
import type { ClipPlacement, EditBlockedReason } from "../../domain/timeline/edit";
import { dimsForOrientation, MIN_BOX_SIZE_PX, ROTATION_DEG_MIN, ROTATION_DEG_MAX } from "../../domain/constants";
import { audioSourceKeyOfClip, isAudioClip, normalizedVolumePoints } from "../../domain/timeline/audio";
import { volumePointTimeAt } from "../../domain/timeline/volumePointEdit";
import { useUndoRedoShortcuts } from "../hooks/useUndoRedoShortcuts";
import { useTimelineHistoryGroup } from "../hooks/useHistoryGroup";
import { activatesOnSpace, NUDGE_GROUP_IDLE_MS, shouldIgnoreShortcut, usesArrowKeys } from "../hooks/keyboardShortcut";
import { hasEscapeOwner, useEscapeOwner } from "../hooks/escapeOwners";
import type { Template } from "../../domain/template/types";
import { useTimelinePlayback } from "../hooks/useTimelinePlayback";
import { useTimelineAudio } from "../hooks/useTimelineAudio";
import type { CropMode, TimelineClipKind } from "../../domain/enums";
import type { TimelineClip } from "../../domain/timeline/types";
import "../components/timeline.css";
import { clipEndSec, validateTimelineDoc } from "../../domain/timeline/validateTimelineDoc";
import { splitVideoSceneSvgMulti } from "../../renderer/export/videoSceneSplit";
import { assignableAssetsFor } from "../../domain/template/slotAssign";
import { canUseOriginalAudio, compositeSpansOthers, cropPivotDiffers, placementAudioState, placementOriginalAudio, videoAssetIds, videoAudioState, videoHoldsLastFrameAt, videoPlacementsOf, videoPlacementsOfClip, videoSourceSecAt, videoStagePlan } from "../../domain/timeline/video";
import { TimelineSlotVideo } from "../components/TimelineSlotVideo";
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
import { CLIP_SPEED_MAX, CLIP_SPEED_MIN, FPS, ORIGINAL_AUDIO_VOLUME, TIMELINE_LABEL_W_PX, TIMELINE_MIN_CLIP_SEC, VOLUME_MAX, VOLUME_MIN, VOLUME_POINTS_MAX, VOLUME_STEP } from "../../domain/constants";
import { NARRATION_STATUS } from "../../domain/enums";
import { EXPORT_RUN_PHASE } from "../../domain/export/exportProgress";
import { creditSpeakerAt } from "../../domain/timeline/credit";
import { creditForLine, creditForSpeaker } from "../../domain/voice/narratorCredit";
import { fontFamilyForId } from "../../domain/font/fontCatalog";
import { getVoicevoxSpeaker } from "../../infrastructure/appSettings";
import { layoutToSvg } from "../../renderer/sceneSvg";
import type { LayoutItem } from "../../renderer/layout";
import { PageHead } from "../components/ui";
import { DeleteConfirm } from "../components/DeleteConfirm";
import { ContextMenu } from "../components/ContextMenu";
import { EditorToolbar } from "../components/EditorToolbar";
import { isTargetLocked } from "../../domain/timeline/keyframeEdit";
import { NumberField } from "../components/NumberField";
import { CollapsibleSection } from "../components/CollapsibleSection";
import { SECTION_SCOPE } from "../components/sectionOpen";
import type { ContextMenuItem } from "../components/ContextMenu";
import { AssetImportButton } from "../components/AssetImportButton";
import { PickerList } from "../components/PickerList";
import { PANEL_BODY_CLASS, PanelLayoutView } from "../components/layout/PanelLayoutView";
import type { PanelSpec } from "../components/layout/PanelLayoutView";
import { usePanelLayout } from "../components/layout/usePanelLayout";
import { PANEL_REGION, PANEL_SCREEN, SPLIT_DIR, addPanelToRegion, emptyLayout } from "../../domain/layout/panelLayout";

/**
 * この画面が持つ欄（配置に出てくる id の集合＝知らない欄を落とす基準）。**値集合にする**＝
 * 綴り違いで `normalizeLayout` に落とされ、**欄が黙って消える**のを防ぐ（§2-7）。
 */
/** 置ける部品の種類（素材・文字・図形）。 */
type VisualKind = typeof TIMELINE_CLIP_KIND.slot | typeof TIMELINE_CLIP_KIND.text | typeof TIMELINE_CLIP_KIND.shape;

/**
 * その部品が**動画の中の場所を持つ**か（＝仕上がり確認へ落とせるか・#714）。
 * 見た目パターン・音・読み上げは箱を持たないので、キャンバスは落とし先にならない。
 */
function isVisualSpec(spec: ClipPlacement): spec is { kind: VisualKind; assetId?: string } {
  return (
    spec.kind === TIMELINE_CLIP_KIND.slot ||
    spec.kind === TIMELINE_CLIP_KIND.text ||
    spec.kind === TIMELINE_CLIP_KIND.shape
  );
}

/**
 * つかんで運んでいる最中の状態（#684）。`drop` が null＝落とし先の外。
 *
 * ⚠️ **何を置こうとしているかは `spec` が持つ**（#714）＝絵の部品だけでなく、見た目パターン・音・
 * 読み上げも同じ道で運べる（置き方＝ボタン／掴んで運ぶ、で流儀を割らない・ADR-0026②）。
 */
type DragPlace = {
  spec: ClipPlacement;
  /** ゴーストに出す名前（素材名・曲名など＝一覧に出ているものと同じ言い方）。 */
  label: string;
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
    /** 寄せた先（点線を出す秒・`null`＝寄せていない）。帯を運ぶときと同じ線を使う（#771(a)）。 */
    guideSec?: number | null;
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
import { LEAVE_BLOCKED_EXPORTING_MESSAGE, canvasHoldMessage, type CanvasHoldReason, clipLabel, clipRangeTitle, editBlockedMessage, freeShapeLabel, exportBlockedMessage, slotLabelsFor, SUBTITLE_TEXT_FIELD_LABEL, textKeyLabel, TIMELINE_SAVE_FAILED_MESSAGE, timelineSaveStatusLabel, trackLabel, VOLUME_POINTS_OVERRIDE_HINT } from "../uiLabels";
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
import { freeElementFromClip, isItemOfClip, isItemOfPlacement, timelineCanvasClipsAt, type Box, type TimelineCanvasClip } from "../../renderer/timelineLayout";
import { SNAP_THRESHOLD_PX, snapTime, timeSnapTargets, visibleTimeRange } from "../../domain/timeline/snap";
import { splitClipIssue, SPLIT_BLOCKED_REASON } from "../../domain/timeline/split";

interface TimelineProjectScreenProps {
  onNavigate: (screen: ScreenId) => void;
}

/** 編集してから自動保存するまでの待ち（ms）。連続操作のたびに書かないための間。 */
const AUTOSAVE_DELAY_MS = 800;

/** 「前へ／後ろへ」1回で動かす秒。細かすぎず粗すぎない刻み（再生位置へ寄せる操作と併用する前提）。 */
const NUDGE_SEC = 0.5;
/**
 * キャンバスで部品を**少しだけ動かす**量（px・ADR-0034 決定18・#752-9）。
 * `Shift` を押している間は `NUDGE_BOX_FAST_PX`（他社の型＝細かい詰めと大きな移動を1つのキーで分ける）。
 */
const NUDGE_BOX_PX = 1;
const NUDGE_BOX_FAST_PX = 10;
/** 矢印で動かす手が止まったとみなすまで（ms）。ここを過ぎたら取り消しのまとめを閉じる。 */


/** 1秒あたりの表示幅（px）と、レーンの最小幅。読み取り専用タイムラインと同じ見え方に寄せる。 */
const MIN_LANE_WIDTH_PX = 640;
/**
 * 端の取っ手の**見た目**の幅（px）。当たり判定はこれより広い（下の `CLIP_HANDLE_HIT_W_PX`）。
 */
export const CLIP_HANDLE_W_PX = 7;
/**
 * 取っ手の**当たり判定**の幅（px・#752-7）。見た目（`CLIP_HANDLE_W_PX`）の**2倍**＝業界の型
 *（見た目どおり 7px だと、指が乗る前に本体を掴む）。広げるのは**帯の内側だけ**（外へ広げると
 * 隣の帯を食う）。⚠️ **「⋮」を避ける幅も取っ手を出す下限もこの値から導く**＝見た目の幅を
 * 流用すると、広げた当たり判定が「⋮」を覆う（#742/#743 で直した事故の裏返し）。
 */
export const CLIP_HANDLE_HIT_W_PX = CLIP_HANDLE_W_PX * 2;
export const CLIP_MENU_W_PX = 14;
/**
 * 取っ手を出す最小の帯の幅（px・#686 レビュー）。左右の取っ手と「⋮」が食うぶん＋本体を掴む余地。
 * 短い帯／低い倍率では**本体を掴む所が無くなる**（動かせなくなる）ので、狭いときは取っ手を出さず、
 * 長さは数値の欄で変えてもらう＝**ドラッグ専用の操作を作らない**（決定19）ので行き止まりにならない。
 * ⚠️ 食う幅は**当たり判定**で数える（見た目で数えると、広げたぶんだけ本体が掴めなくなる）。
 * ⚠️ **幅は TS 側が単一の参照元**（`--timeline-label-w` と同じ流儀＝CSS へ流し込む）。
 * CSS にだけ書くと、値を変えたときにこの下限が黙って合わなくなる（計算と描画が食い違う）。
 */
const CLIP_HANDLES_MIN_W_PX = CLIP_HANDLE_HIT_W_PX * 2 + CLIP_MENU_W_PX + 16;

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
 * いま入っているのに選択肢に出せない素材。`<select className="select">` の value に合う option が
 * 無いと**空欄**になり「なし」と見分けが付かないので、名前だけ出す（選び直しはできない＝`disabled`）。
 * ⚠️ **動画は段3 で選べるようになった**（差し込み口でも映る）＝残るのは種別の合わない素材だけ。
 */
function unselectableCurrent(assets: readonly Asset[], assetId: string | null | undefined, layer: Layer): Asset | undefined {
  if (!assetId) return undefined;
  if (assignableAssets(assets, layer).some((a) => a.assetId === assetId)) return undefined;
  return assets.find((a) => a.assetId === assetId);
}

function assignableAssets(assets: readonly Asset[], layer: Layer): Asset[] {
  // 規則は domain に1つ（場面編集と共有＝同じ枠を画面によって別扱いしない）。
  return assignableAssetsFor(assets, layer);
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
    doc, loadError, isLoading, playheadSec, selectedClipIds, assetSrcById, videoSrcById, audioSrcByKey, assetSizes, setAssetSize, editBlocked, history, exportRun,
    setPlayhead, selectClip, selectClips, clearSelection, moveSelectedClip, trimSelectedClip, moveClipById, moveClipsBy, trimClipById, setEditBlocked, setSelectedClipBox, setClipBoxFor, setClipTextFor, setClipBoxesFor, splitSelectedClip, duplicateSelectedClip, removeSelectedClips, removeClipsByIds,
    addTrack, duplicateTrack, removeTrack, moveTrackOrder, moveTrackTo, setTrackFlag, undo, redo, saveTimelineProject, saveStatus,
    isPlaying, play, pause, exportTimelineVideo, cancelTimelineExport, dismissTimelineExport,
    setSelectedClipAssetRef, setSelectedClipText, addTemplateClip, explodeClip, setSelectedSubtitleVoiceLink, setSelectedSubtitleText,
    addVoiceClip, setSelectedVoiceText, setSelectedVoiceSpeaker, generateSelectedVoice, addLinkedSubtitleClip, voiceError, generatingVoiceClipId,
    setSelectedKeyframeAt, removeSelectedKeyframe, clearSelectedKeyframes, clearKeyframesOf,
    addAudioClip, addVisualClip, setSelectedVisualContent, setSelectedClipSpeed, setSelectedClipSourceStart, setSelectedClipVolume, setSelectedClipAudioSource, setSelectedClipFade,
    setSelectedClipUseOriginalAudio, setSelectedClipOriginalAudioVolume,
    setSelectedClipSlotAudio,
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
  /** 声を作る回が走っているか（#755）＝印は開き直しで消えるので、書き出しの締めはこちらを見る。 */
  const voiceRunning = useTimelineStore((s) => s._voiceRun != null);
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
    // ⚠️ **書き切るかどうかは、子の後始末より後で見る**（#763-3）。React の後始末は**親→子**の順に走る
    // ＝ここで「保存済み」を見て降りた**後**に、子（色の欄）が打ちかけを確定して未保存へ戻すことがある。
    // そのときこの画面はもう無いので**誰も書かない**＝開き直すと、確定したはずの色が消える（#751 と同型）。
    // マイクロタスクへ回すと、その回の後始末が全部終わってから状態を見られる。
    // 別の動画へ移っていたときの心配は要らない＝**書く側が「いま開いている文書」を読み直し**、
    // 書き終えてからも「まだ同じ動画か」で括る（`doSaveTimelineProject` の `stillOpen`・#762）。
    // ここで id を控えて弾いても結果は変わらない（文書が消えていれば書く側が先に降りる）ので、
    // 確かめようのない枝を増やさない。
    queueMicrotask(() => {
      const s = useTimelineStore.getState();
      if (s.saveStatus === "idle") void s.saveTimelineProject();
    });
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
  // ⚠️ **マウントで真へ戻す**（実機で発覚）。開発ビルドは effect を「張る→外す→張り直す」で2度走らせるので、
  // 外した回で偽になったまま**張り直しでは戻らず**、以後この画面から**どの入口でも離れられなくなる**
  //（下の関門が「もう画面に居ない」と判断して黙って降りる＝押しても何も起きない・§2-5）。
  // 後始末だけを書く形は、**画面が生き返る**ことを想定していない。`HomeScreen` の `mountedRef` と同じ形にする。
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

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
  /**
   * **固定を除外して動かしたことの知らせ**（#773・ADR-0034 未解決7 の決着 (a)）。
   * 空間の移動は「除外して動かす」＝黙って一部だけ動かさない。
   *
   * ⚠️ **一度だけ出す**（利用者決定）＝見れば分かることなので、動かすたびに出すとうるさい。
   * **選んだ組み合わせが変わったら出し直す**（別の組み合わせなら、また知らせる意味がある）。
   */
  const [lockedSkipNotice, setLockedSkipNotice] = useState<string | null>(null);
  const noticedForRef = useRef<string | null>(null);
  /**
   * 一緒に動かさなかったものを**理由別に**知らせる（#788-1）。
   *
   * ⚠️ 以前は数だけ受け取り、常に「固定された列の部品N個は…**固定を外してください**」と出していた。
   * ところがキャンバスで掴めない理由は**固定した列だけではない**（動きが効いている／まとまりの変形も
   * 掴ませない＝#746-4）ので、動き起因のときは**従っても直らない案内**になっていた。
   * 単体選択のときは既に理由別に出していたので、その規準へ揃える（言い方は `canvasHoldMessage` に1か所）。
   */
  const noticeSkipped = useCallback((reasons: readonly CanvasHoldReason[], key: string): void => {
    if (reasons.length === 0 || noticedForRef.current === key) return;
    noticedForRef.current = key;
    // 理由が混ざることもある（固定した列の部品と、動きの効いた部品を一緒に選んだ）。
    // **数えた理由をすべて出す**＝1つにまとめると、残りの部品が動かない訳が分からない。
    const order: CanvasHoldReason[] = ["track", "animation", "group"];
    const counts = new Map<CanvasHoldReason, number>();
    for (const r of reasons) counts.set(r, (counts.get(r) ?? 0) + 1);
    setLockedSkipNotice(order.filter((r) => counts.has(r)).map((r) => canvasHoldMessage(r, counts.get(r))).join(" "));
  }, []);
  /**
   * 掴んでいる最中に開いた「まとめ」を、**離した合図で必ず閉じる**（#813 レビュー 🔴）。
   *
   * ⚠️ **閉じるのを掴み手に頼れない**＝閉じる合図（`onInteractionEnd`）を出すのは
   * `FreeLayoutOverlay` の**要素ドラッグだけ**。空白クリックでの選択解除・範囲選択（マーキー）は
   * `claimDrag` で「掴んでいる」数だけ上げて終わりに何も出さず（`FreeLayoutOverlay` の `endDrag` は
   * マーキーなら `releaseDrag` して戻る）、帯のドラッグも `usePointerDrag` が**しきい値を越えた時点で
   * 数を上げてから** `onStart`（＝選び直し）を呼ぶので、どちらもここを通る。
   * 閉じ損ねると **(a) 以後の編集が履歴に積まれない**（まとめ中は最初の1回しか記録しない）
   * **(b) 自動保存が止まる**（`historyDepth > 0` の間は保留）＝そのままアプリを閉じると編集が消える。
   * `endHistoryGroup` は 0 で止めるので**ずれても無言**＝気づけない。
   *
   * ⚠️ **終わりの合図を自分で数えない**（#813 再レビュー 🔴）＝`Escape` での中止は
   * `pointercancel` を出さずに直接止める（帯もマーキーも `onCancel()` を直接呼ぶ）ので、
   * `pointerup`/`pointercancel` を待ち受ける形では**その回だけ静かに取り残される**。
   * **「掴んでいるものが無くなったか」の1か所**（`whenPointerDragEnds`）で閉じる。
   */
  const openDragHistoryGroup = useCallback((): void => {
    useTimelineStore.getState().beginHistoryGroup();
    whenPointerDragEnds(() => { useTimelineStore.getState().endHistoryGroup(); });
  }, []);
  const lastSelectedKey = useRef(selectedKey);
  useEffect(() => {
    if (lastSelectedKey.current === selectedKey) return;
    lastSelectedKey.current = selectedKey;
    setKfDraft({});
    setVolumeDraft("");
    // 前の選択について出した知らせを、いまの選択の返事に見せない（断り文と同じ扱い）。
    setLockedSkipNotice(null);
    // 文字欄はフォーカス中に消えると `blur` が来ない＝まとめが開きっぱなしになる（#708 レビュー）。
    // 欄が入れ替わるここで必ず畳む（ドラッグが `window` で終了を拾うのと同じ役割）。
    // ⚠️ **掴んでいる最中なら開き直す**（#813）＝キャンバスで**まだ選んでいない**部品を掴むと、
    // 同じ pointerdown が「選ぶ」→「まとめを開く」の順に走り、選択が変わったこの後始末が
    // **開いた直後のまとめを畳んでしまう**。以後は動かすたびに1件ずつ積まれ（既定では吸着が無く
    // 毎回別の値になるので間引きも効かない）、60回動かすと上限50に達して**そのドラッグより前の
    // 編集が取り消せなくなる**（実測）。「バラす」のように取り消しでしか戻せない操作が押し出される。
    // 畳んでから開き直すのは、**開きっぱなしの古いまとめ（消えた文字欄）も一緒に片づける**ため
    //（畳まずに素通りすると、そちらが残って以後の編集がひとつながりになる）。
    const dragging = isPointerDragging();
    useTimelineStore.getState().resetHistoryGroup();
    // ⚠️ 掴んでいないときに開いても**結果は同じ**（`whenPointerDragEnds` がその場で閉じる）＝
    // この見張りはテストで固定できない。無駄に開け閉てしないためのもので、正しさは閉じ方が担う。
    if (dragging) openDragHistoryGroup();
  }, [selectedKey, openDragHistoryGroup]);
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
  const playRef = useRef({ playing: false, total: 0, exporting: false, fps: FPS, play, pause, seekFrames: (_frames: number) => {} });
  /** `Ctrl+K` の受け皿（毎レンダー最新にする＝`playRef`/`removeRef` と同じ形）。 */
  const splitRef = useRef<() => void>(() => {});
  /**
   * 矢印で**少しだけ動かす**受け皿（#752-9）。`null`＝いまは動かす相手がいない（＝再生位置を送る）。
   * 毎レンダー入れ替える（`playRef` と同じ形＝実リスナーは張り替えない）。
   */
  const nudgeBoxRef = useRef<((dx: number, dy: number, fast: boolean) => void) | null>(null);
  /**
   * 矢印で動かしている間の**取り消しのまとめ**（#752 レビュー）。押すたびに開き直さず、
   * **手が止まったら閉じる**（掴んで動かすのと同じ「1回の操作＝1回の取り消し」）。
   * ⚠️ `keyup` だけに頼らない＝押したまま画面が変わると閉じる合図が来ず、以後の編集が全部つながる。
   */
  const nudgeGroupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nudgeGroupOpenRef = useRef(false);
  /** 開いた時点の世代（畳まれたかを見分ける・#817 レビュー）。 */
  const nudgeGroupGenRef = useRef(0);
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
      // **`Ctrl+K`＝ここで分ける**（決定18）。押せる条件も断り文もボタンと同じ入口が決める
      // ＝キーだけ通って理由が出ない、を作らない。
      // ⚠️ **修飾キーを弾く行より前**に置く（後ろだと届かない＝実際にそこへ置いて動かなかった）。
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        splitRef.current();
        return;
      }
      // ここから下は**修飾キーの付いていない単独キー**だけ（`Ctrl+←` 等は OS/ブラウザのものを奪わない）。
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === " ") {
        // **押した要素が `Space` で反応するなら、そちらに譲る**（消すボタンを押したら消えたうえに再生が
        // 始まる、を作らない）。一律で奪うと画面じゅうのボタンがキーボードで押せなくなる。
        if (activatesOnSpace(e.target)) return;
        e.preventDefault(); // 既定の「画面を下へ送る」を止める
        if (playRef.current.playing) { playRef.current.pause(); return; } // 止めるのはいつでも通す
        if (playRef.current.total <= 0) return; // 置いていないときは再生できない（ボタンと同じ条件）
        // ⚠️ **キーで断るなら理由を出す**（#752 レビュー）＝`Delete`・`Ctrl+K` は喋るのに
        // `Space` だけ黙ると、押せない見た目を持たない入口で挙動が割れる（ADR-0026②）。
        if (playRef.current.exporting) { setEditBlocked(EDIT_BLOCKED.playExporting); return; }
        playRef.current.play();
        return;
      }
      if (e.key === "Delete") {
        e.preventDefault();
        removeRef.current(); // 押せる条件・確認の有無はボタンと同じ入口が決める
        return;
      }
      const arrowX = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
      const arrowY = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
      if (arrowX !== 0 || arrowY !== 0) {
        // **矢印を使う要素に手がかかっているなら譲る**（`Space` と同じ理由・同じ形＝ADR-0026②）。
        // 譲らないと、セレクトやスライダーにフォーカスしたまま押したとき**その欄の値が変わらず
        // 再生位置だけ動く**（この画面はセレクトが多い）。
        if (usesArrowKeys(e.target)) return;
        // **キャンバスで箱を持つ部品を1つだけ選んでいる間は「少しだけ動かす」**（決定18・#752-9）。
        // ⚠️ 上下は**この文脈のときだけ**奪う（それ以外は画面送りに返す＝奪って何も起きない、を作らない）。
        const nudge = nudgeBoxRef.current;
        if (nudge) { e.preventDefault(); nudge(arrowX, arrowY, e.shiftKey); return; }
        if (arrowX === 0) return; // 上下は再生位置を動かす意味を持たない
        // **1フレームずつ・`Shift` で1秒**（決定18）。
        e.preventDefault();
        const p = playRef.current;
        if (p.total <= 0) return;
        // **フレーム番号で動かす**（秒を足し込むと誤差が積もって同じ絵に留まる／飛ぶ・#721 レビュー）。
        // `Shift` の「1秒」も同じ格子の上で数える（1秒 = fps フレーム）。
        p.seekFrames((e.shiftKey ? p.fps : 1) * arrowX);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clearSelection, selectClips, overlayOpen, setEditBlocked]);
  const totalSec = doc ? timelineDurationSec(doc) : 0;
  // 数値欄の刻み＝**1フレーム**（出力の格子と同じ・#721）。⚠️ **丸めない**＝`0.033` にすると格子から外れ、
  // 30回刻んで 0.99 秒にしかならない（「格子と同じ」という約束が嘘になる・#721 レビュー）。
  const frameStepSec = 1 / (doc ? effectiveFps(doc) : FPS);
  // 1つだけ選んでいるときが「動かせる」状態（複数選択はまとめて消すだけ＝対象が決まらない）。
  const selected = doc && selectedClipIds.length === 1 ? doc.clips.find((c) => c.id === selectedClipIds[0]) : undefined;
  // 見た目パターンの解決は**絵を並べる側と、どの枠が動画を受けるか（#512 段3）の両方**が要る＝1つにする。
  const templateOf = useMemo(() => {
    const byId = new Map(templates.map((t) => [t.templateId, t]));
    return (id: string) => byId.get(id);
  }, [templates]);
  const layout = useMemo(() => {
    if (!doc) return null;
    // 末尾ちょうどは1フレーム手前へ寄せる（半開区間で画面が真っ白になるのを防ぐ・`frameTimeSec`）。
    return layoutTimelineAt(doc, frameTimeSec(doc, playheadSec), { templateOf, assetSizeOf: (id) => assetSizes[id] });
  }, [doc, playheadSec, templateOf, assetSizes]);

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
  // その部品の差し込み口に入っている動画（#512 段3b）＝元の音の欄を出す先。判定は domain の1か所。
  const slotPlacements = doc && selected ? videoPlacementsOfClip(doc, selected, { templateOf }).filter((p) => p.use === ASSET_USE_KIND.slot) : [];
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
  const lockedSelectionHint = editBlockedMessage[EDIT_BLOCKED.lockedSelection];
  // 断り文は共有の1か所から作る（#819-2）＝画面で手書きすると、同じ状況に2通りの文が出る。
  const lockedHint = selectedLocked ? lockedTrackMessage("content") : undefined;
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
  // ⚠️ **動画も出す**（#512・利用者判断 2026-08-19）＝以前は「置けても書き出しの手前で断られる」ので
  // 外していたが、**直接置いた動画は映り（段1）、元の音も鳴る（段2）**ようになったので理由が消えた。
  const visualAssets = doc?.assets.filter((a) => isFreeSlotAssetType(a.assetType)) ?? [];
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
  // 置き場所や音の出どころの取り違え（11 §8 V22–V32）。描画から外れるものもあるので必ず見せる。
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
        voiceRunning: voiceRunning,
        knownTemplateIds: new Set(templates.map((t) => t.templateId)),
        otherExportRunning: exportLockOwner != null && exportLockOwner !== EXPORT_OWNER,
        canExportHere: canExport(),
      }),
    [doc, isImporting, voiceRunning, templates, exportLockOwner],
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
      // ⚠️ **見た目パターンを渡す**（レビュー 🟡）＝渡さないと差し込み口を解決できず、実映像で描く
      // 枠まで代表フレームが要る扱いになり、**誤った理由**で「絵が出せない」と数える。
      timelineImageAssetIds(doc, templateOf).filter((id) => !assetSrcById[id] && !templateAssetSrcById[id]),
    );
    if (unresolved.size === 0) return 0;
    return doc.clips.filter((c) => clipImageAssetIds(c).some((id) => unresolved.has(id))).length;
  }, [doc, assetSrcById, templateAssetSrcById, templateOf]);

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
   *
   * ⚠️ 見るのは**画面ぜんぶで共通の「いま掴んでいる」**（`isPointerDragging`・#752-5）。帯だけの
   * 写しを見ていたので、**部品を運んでいる最中**（`grabToPlace`）は素通りし、`Ctrl`+ホイールで
   * 倍率が変わって**古い倍率で落とし先を計算**していた（掴んだものが指から離れるのは帯と同じ）。
   * 掴む場所が増えるたびに写しを足す形にしない＝合図は1つ。
   */
  const changeZoomRef = useRef<(next: number | ((i: number | null) => number)) => boolean>(() => false);
  const changeZoom = (next: number | ((i: number | null) => number)): boolean => {
    if (isPointerDragging()) return false;
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
  // ⚠️ **再生に合わせて見える範囲を送る**（#819-1）＝送らないと、再生ヘッドが枠の外へ出た時点で
  // **いま何が出ているのかが画面から消える**（倍率を上げるほど早く外れる）。送り方は domain の
  // 1か所（`playbackScrollLeft`）＝ヘッドが見えている間は動かさず、外へ出たときだけページ送り。
  // ⚠️ 早い段階（画面を返す前）に置く＝フックの数を毎回そろえる。倍率と全長はここで解き直す。
  useEffect(() => {
    if (!isPlaying) return;
    const el = scrollRef.current;
    if (!el) return;
    const px = ZOOM_LEVELS[zoomIndex ?? DEFAULT_ZOOM_INDEX];
    const next = playbackScrollLeft({
      scrollLeft: el.scrollLeft,
      viewPx: el.clientWidth,
      contentPx: Math.max(totalSec * px, MIN_LANE_WIDTH_PX),
      headPx: playheadSec * px,
      insetStartPx: LANE_LABEL_PX,
    });
    if (next != null) el.scrollLeft = next;
  }, [isPlaying, playheadSec, zoomIndex, totalSec]);

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
  const exportingHint = exporting ? editBlockedMessage[EDIT_BLOCKED.exporting] : undefined;
  /**
   * **消せない理由**（`null`＝消せる・#721）。1つのときのボタン・まとめて消すボタン・`Delete` キーが
   * **同じものを見る**＝入口ごとに条件を書き分けると、キーだけ固定した列の部品を消せる、が起きる
   * （`exportStartBlock` と同じ流儀）。`selectionHasLocked` は選んでいる全部を見るので、
   * 1つだけのときも `selectedLocked` と同じ答えになる（片方だけ直す事故を作らないよう、こちらに寄せる）。
   */
  /**
   * ⚠️ **理由の組はボタンへそのまま流さない**（#752 レビュー）。React は知らない小文字の属性を
   * 素通しするので、`reason` を混ぜたままスプレッドすると `<button reason="TIMELINE_EDIT_...">`
   * として**内部の合図が描画結果に出る**（§2-3）。ボタンへ渡すのは `removeGuard`（`{disabled,title}`）、
   * `reason` は断る側だけが読む。
   */
  const removeBlocked = useMemo<{ disabled: boolean; title: string | undefined; reason: EditBlockedReason | null } | null>(
    () =>
      selectedClipIds.length === 0
        ? { disabled: true, title: undefined, reason: null } // 選んでいなければ、そもそも消す対象が無い
        : selectionHasLocked
          ? { disabled: true, title: lockedSelectionHint, reason: EDIT_BLOCKED.lockedSelection }
          : exporting
            ? { disabled: true, title: exportingHint, reason: EDIT_BLOCKED.exporting }
            : null,
    [selectedClipIds.length, selectionHasLocked, exporting, exportingHint, lockedSelectionHint],
  );
  /** ボタンへ渡す分（`editGuard`／`busyGuard` と同じ形＝`{disabled,title}` だけ）。 */
  const removeGuard: { disabled: boolean; title: string | undefined } | null =
    removeBlocked ? { disabled: removeBlocked.disabled, title: removeBlocked.title } : null;
  /**
   * **消す（どの入口からでも同じ流れ）**（#721）。単体は**即時＋取り消し**、**まとめては確認**
   * ＝`06 §2` 統一規約1／ADR-0034 決定20。ここを通さずに `removeSelectedClips` を直に呼ぶと、
   * まとめて消すのが確認なしになる（キーからも同じ道を使うので、片方だけ確認、も作らない）。
   * ⚠️ **early return より前**に置く（抜ける回と抜けない回でフックの数が変わらない＝下の土台と同じ理由）。
   */
  const requestRemoveSelected = useCallback(() => {
    // ⚠️ **断るなら理由を出す**（#752-3・§2-5）。ボタンは押せない見た目と説明で伝わるが、
    // **キーには押せない見た目が無い**ので、ここで理由を立てないと `Delete` が無言で何も起きない
    //（分ける `Ctrl+K` は理由を立てているのに、消すだけ黙る＝入口で挙動が割れる・ADR-0026②）。
    // 選んでいないときだけ黙る（消す相手がそもそも無い＝他社の型でも何も出ない）。
    if (removeBlocked) { if (removeBlocked.reason) setEditBlocked(removeBlocked.reason); return; }
    if (selectedClipIds.length > 1) setConfirmRemove(selectedClipIds);
    else removeSelectedClips();
  }, [removeBlocked, selectedClipIds, removeSelectedClips, setEditBlocked]);
  const trackOf = (trackId: string) => doc?.tracks.find((t) => t.id === trackId);
  /**
   * **いまキャンバスに出ているか**（#752 レビュー）。キャンバスの顔ぶれ（`canvasEls`）と、
   * 矢印で動かす相手が**同じ規則**を見る＝選んでいるだけで見えていない部品（再生位置の外・
   * 出さない列）を、画面のどこも変わらないまま動かして保存する、を作らない。
   */
  /**
   * その時刻に**描かれる部品**（描く順・実効の箱つき）＝**描画と同じ関数**から採る（#746-4/5）。
   * 自前で並べたり隠す条件を書いたりしない＝重なった所で奥が掴まれる／描かれていないものが掴める、
   * を構造で防ぐ。
   */
  const canvasClips = doc ? timelineCanvasClipsAt(doc, frameTimeSec(doc, playheadSec)) : [];
  const onCanvasIds = new Set(canvasClips.map((cc) => cc.clip.id));
  /** いまキャンバスに出ていて、**箱を自分で持てる**部品か（見た目パターンは枠そのものなので外す）。 */
  const isOnCanvas = (c: TimelineClip): boolean => canHaveBox(c.kind) && onCanvasIds.has(c.id);
  /**
   * 掴めるか（#686 レビュー）。**見た目（`cursor`）と、掴む処理を始めるかが同じものを見る**。
   *
   * ⚠️ **再生中も掴ませない**（#752-4）＝吸着の寄り先に**再生位置**が入っているので、掴んだ時点の
   * 値で止まったまま流れ続ける（見えている線と寄る先がずれる）。置く操作は既に塞いであるのに
   * 掴む方だけ通っていた＝同じ理由なら同じ挙動（ADR-0026②）。
   */
  const grabbableClip = (c: TimelineClip): boolean => !exporting && !isPlaying && !trackOf(c.trackId)?.locked;
  /**
   * 矢印のまとめを開く（開いていれば延長するだけ）。手が止まったら閉じる。
   *
   * ⚠️ **自分のまとめがまだ生きているかは「世代」で見る**（#817 レビュー 🔴）＝取り消しや選び直しは
   * 持ち主の都合と無関係に畳むので、自前の印だけを見ていると **(a)** 畳まれた後も開いているつもりで
   * 開き直さず**1押下＝1履歴**になり上限を数秒で流し切る（取り消しでしか戻せない編集が押し出される）
   * **(b)** 遅れて走るこのタイマが**別人のまとめ**（掴んでいる最中のもの等）を閉じてしまう。
   */
  const openNudgeGroup = useCallback((): void => {
    const genNow = (): number => useTimelineStore.getState()._historyGroupGen;
    if (!nudgeGroupOpenRef.current || nudgeGroupGenRef.current !== genNow()) {
      nudgeGroupOpenRef.current = true;
      beginHistoryGroup();
      nudgeGroupGenRef.current = genNow(); // 開いた時点の世代を控える
    }
    if (nudgeGroupTimerRef.current) clearTimeout(nudgeGroupTimerRef.current);
    const gen = nudgeGroupGenRef.current;
    nudgeGroupTimerRef.current = setTimeout(() => {
      nudgeGroupTimerRef.current = null;
      nudgeGroupOpenRef.current = false;
      if (gen === genNow()) endHistoryGroup(); // 自分のまとめが残っているときだけ閉じる
    }, NUDGE_GROUP_IDLE_MS);
  }, [beginHistoryGroup, endHistoryGroup]);
  // 画面を離れるときは**必ず閉じる**（開けっぱなしだと以後の編集が全部ひとつながりになる）。
  const closeNudgeGroupRef = useRef<() => void>(() => {});
  useEffect(() => {
    closeNudgeGroupRef.current = () => {
      if (nudgeGroupTimerRef.current) clearTimeout(nudgeGroupTimerRef.current);
      nudgeGroupTimerRef.current = null;
      if (!nudgeGroupOpenRef.current) return;
      nudgeGroupOpenRef.current = false;
      // 画面を離れるときも**自分のまとめだけ**閉じる（畳まれた後なら閉じる相手がいない）。
      if (nudgeGroupGenRef.current === useTimelineStore.getState()._historyGroupGen) endHistoryGroup();
    };
  });
  useEffect(() => () => closeNudgeGroupRef.current(), []);

  // キー操作の入れ物を毎レンダー最新にする（描き終わってから差し替える＝レンダー中に ref を書かない）。
  useEffect(() => {
    playRef.current = {
      playing: isPlaying, total: totalSec, exporting,
      fps: doc ? Math.round(effectiveFps(doc)) : FPS,
      play, pause,
      seekFrames: (frames) => { if (doc) setPlayhead(seekByFrames(doc, playheadSec, frames)); },
    };
    removeRef.current = requestRemoveSelected;
    // ⚠️ **矢印は文脈で分かれる**（決定18・#752-9）＝キャンバスで箱を持つ部品を選んでいる間は
    // 「少しだけ動かす」、それ以外は再生位置を送る。#685（キャンバスで動かす）が入るまで保留して
    // いたが、着地したので繋ぐ。
    // **まとめて選んでいるときも一緒に動かす**（掴んで動かすのと同じ・決定15／#752 レビュー）
    // ＝個数で意味を変えない。箱を持たない相手（読み上げ・音）は混ざっていても動かさない
    //（キャンバスに出ていないものは、キャンバスの操作の対象ではない）。
    // **動かせないときは矢印を奪わない**（固定した列・書き出し中・再生中＝掴めないのと同じ条件）。
    // 奪ったうえで断ると、再生位置も動かせず部品も動かない＝行き止まり（決定5）。
    // ⚠️ 対象は**キャンバスに出ているもの**（`canvasEls` と同じ絞り＝#752 レビュー）。
    // 選んでいるだけで見えていない部品（再生位置の外・出さない列）まで動かすと、
    // **画面のどこも変わらないのに文書だけ動いて保存される**（矢印を奪って何も起きないのと同じ）。
    // ⚠️ **固定は混ぜず、残りを動かす**（#773・決定 (a)＝空間の移動は「除外」）。
    // 以前は「1つでも固定が混ざったら何も動かさない」（＝時間の移動と同じ全か無か）だったが、
    // キャンバスは要素が独立なので、固定した背景が残っても寄せた結果はそのまま使える。
    // **全部が固定なら矢印を奪わない**（奪って何も起きない＝行き止まり・決定5）。
    const onCanvasSelected = doc ? doc.clips.filter((c) => selectedClipIds.includes(c.id) && isOnCanvas(c)) : [];
    const nudgeTargets = onCanvasSelected.filter((c) => grabbableClip(c));
    const nudgeSkipped = onCanvasSelected.length - nudgeTargets.length;
    nudgeBoxRef.current =
      doc && nudgeTargets.length > 0
        ? (dx, dy, fast) => {
            // 矢印は**列の固定しか見ない**（`grabbableClip`）ので、除外の理由は必ず「固定した列」。
            if (nudgeSkipped > 0) noticeSkipped(Array<CanvasHoldReason>(nudgeSkipped).fill("track"), [...selectedClipIds].sort().join(","));
            const dims = dimsForOrientation(doc.videoSettings.aspectRatio);
            const step = fast ? NUDGE_BOX_FAST_PX : NUDGE_BOX_PX;
            // ⚠️ **押し続けても取り消しは1回ぶん**（決定20・掴んで動かすのと同じ）。畳まないと、
            // キーの連続で履歴の上限（50）を数秒で流し切り、**「バラす」の唯一の戻り道**まで消える。
            openNudgeGroup();
            setClipBoxesFor(
              nudgeTargets.map((c) => {
                const box = resolveClipBox(c, dims);
                return { id: c.id, patch: { x: box.x + dx * step, y: box.y + dy * step } };
              }),
            );
          }
        : null;
    // ⚠️ 分けるは**押せる条件を先に見る**（キーには「押せない見た目」が無いので、ここで断りを立てる）。
    // 見る条件はボタンと同じもの（`splitClipIssue`＋再生中）＝キーだけ通る道を作らない。
    splitRef.current = () => {
      // 断る順は**ボタンの `editGuard` と同じ**（固定 → 書き出し中 → その入口の事情）。
      if (selectedLocked) { setEditBlocked(EDIT_BLOCKED.locked); return; }
      if (exporting) { setEditBlocked(EDIT_BLOCKED.exporting); return; }
      if (isPlaying) { setEditBlocked(EDIT_BLOCKED.playing); return; } // 位置を使う操作＝再生中は断る（決定21）
      if (!doc || !selected) { setEditBlocked(EDIT_BLOCKED.notFound); return; }
      // ⚠️ **見た目パターンも渡す**（PR #825 レビュー 🟡）＝渡さないと差し込み口の置き場所が
      // 1件も解けず、「素材を使い切った先」の判定が**差し込み口では必ず偽**になる。
      // ⚠️ ただし**このキーの道だけは、渡さなくても結果が変わらない**（この先の `splitSelectedClip` が
      // 同じ判定を通し、同じ理由を出す）＝テストでは区別できない。ボタン・右クリックの `disabled` は
      // ここを通らないので**そちらは実際に押せてしまう**（そこは固定してある）。3つの入口が同じ材料を
      // 見ている、を保つために合わせる。
      const issue = splitClipIssue(doc, selected.id, playheadSec, { templateOf });
      if (issue) { setEditBlocked(SPLIT_BLOCKED_REASON[issue]); return; }
      splitSelectedClip(playheadSec);
    };
    changeZoomRef.current = changeZoom; // ホイールの実リスナーは張り替えないので写し越しに呼ぶ
  });
  /**
   * **帯を掴んでいる間**（#686・ADR-0034 決定9/10）。作法は欄のドラッグ（ADR-0033 段階3）と同じ。
   *
   * 置けない所では**寄せない**＝ゴーストの色で知らせ、離したら**元の位置へ戻す**（決定10）。
   * 判定は domain の `moveClipIssue`／`trimClipIssue`＝**ゴーストの色と離した結果が同じ規則**。
   */
  /** キャンバスで**文字を直している**部品の id（#746-2）。SVG 側の同じ文字を伏せる（二重表示回避）。 */
  const [editingCanvasId, setEditingCanvasId] = useState<string | null>(null);
  /** 吸着した先（#686 段階4）＝縦の点線を出す位置。吸着していなければ `null`。 */
  const [snapGuideSec, setSnapGuideSec] = useState<number | null>(null);
  const [clipDrag, setClipDrag] = useState<
    {
      clipId: string;
      mode: "move" | "trim-start" | "trim-end";
      sec: number;
      /** 運び先の列（#686 段階4）。**掴んだ列と同じなら持たない**＝端のトリムは列を変えない。 */
      trackId?: string;
      /**
       * まとめて動かしている相手と、そのずれ（秒）。**掴んだ時点で固めたものを見せかけも確定も読む**
       * ＝ドラッグ中に選択が変わっても、動いて見える帯と動く帯がずれない（#686 段階4・`/canon-check`）。
       */
      groupIds?: readonly string[];
      shiftSec?: number;
      issue: EditBlockedReason | null;
    } | null
  >(null);

  /**
   * 掴んだ直後の `click` を1回だけ捨てる（#686 レビュー）。`pointerdown` の `preventDefault` は
   * `click` を止めないので、離した後に選び直しが走り**断り文がその場で消える**／`Shift` を押していた
   * ときは**動かした帯の選択が外れる**（取っ手も消える）。
   */
  const skipClickRef = useRef(false);
  /**
   * 印を**この順番の終わりで落とす**（#686 段階4 レビュー）。列をまたいで離すと帯の DOM は親ごと
   * 作り直されるので、**その帯の `onClick` は走らない**＝印を消費する相手が誰も居ない。
   * 残ると次の「何もない所を押して選択を解く」1回を飲み込む。離した直後の `click` は同じ順番で
   * 来るので、`setTimeout(0)` はその**後**に走る＝消費すべき1回は守りつつ、持ち越さない。
   */
  const dropSkipClickSoon = (): void => {
    skipClickRef.current = true;
    setTimeout(() => { skipClickRef.current = false; }, 0);
  };
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
  // 列の並べ替えは**縦**に送る（置く・運ぶは横）。速さ・行き止まりの規則は同じ部品から。
  const trackAutoScroll = useEdgeAutoScroll(0, "y");
  const stageRef = useRef<HTMLDivElement>(null);
  const laneRefs = useRef(new Map<string, HTMLElement>());
  /** 行（列の見出しを含む1行）の実体。掴んで並べ替えるとき、落ちる先を**実寸**で決める。 */
  const rowRefs = useRef(new Map<string, HTMLElement>());
  /**
   * 列の並べ替え（#767）。掴んでいる列と、いま落ちる先（**表示上**の位置＝上が手前）。
   * ⚠️ 表示は配列の逆順（後ろほど手前）なので、確定のときに**並びの位置へ直す**。
   */
  const [trackDrag, setTrackDrag] = useState<{ trackId: string; gap: number } | null>(null);
  /**
   * その高さに来る**すき間**（表示上・0＝いちばん上の行の上／`n`＝いちばん下の行の下）。
   *
   * ⚠️ **「行」ではなく「すき間」で持つ**（レビュー 🔴）＝行で持つと、線は「その行の上」を指すのに
   * 確定は**抜いた後の位置**として効くので、**下向きに運んだときだけ1つ余計に下がる**
   *（線を引いた所と違う絵が黙って確定する＝重ね順は絵そのもの）。
   */
  /**
   * 列を並べている枠（縦にスクロールする器）。端まで運んだときの送り先・可視域の基準にする。
   * ⚠️ 列そのものの枠（`.timeline-scroll`）は**横だけ**（`overflow-y: hidden`）なので、縦は欄の器が持つ。
   */
  const trackScroller = (): HTMLElement | null => {
    for (const el of rowRefs.current.values()) return el.closest<HTMLElement>(`.${PANEL_BODY_CLASS}`);
    return null;
  };
  const displayGapAt = (clientY: number): number => {
    const rows = [...(doc?.tracks ?? [])].reverse().map((t) => rowRefs.current.get(t.id));
    // ⚠️ **見えている範囲へ丸めてから当てる**（#802-3）＝置く・運ぶ側（#714 項目5）と同じ規則。
    // 丸めないと、欄からはみ出した位置で**見えていない列のすき間**に線が決まり、そこで確定してしまう。
    const box = trackScroller();
    const y = clampToVisible(box ? visibleRectOf(box) : null, clientY, "y");
    // ⚠️ ここは `gapAtPosition` へ委ねない＝列の行は**隙間なく並ぶ**ので「どちらとも決めない（余白）」が
    // 要らず、素朴な走査で足りる（並べ替えの一覧は余白があるので domain 側の規則が要る）。
    for (let i = 0; i < rows.length; i += 1) {
      const el = rows[i];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (y < r.top + r.height / 2) return i;
    }
    return rows.length;
  };
  /**
   * 表示上のすき間 → **並びの位置**（後ろほど手前なので裏返す）＋**抜いた後の位置**へ直す。
   * 抜いた場所より後ろへ入れるときは1つ手前へずれる（`splice` は抜いてから入れるため）。
   */
  const arrayIndexForGap = (gap: number, from: number, count: number): number =>
    // 裏返す（後ろほど手前）のはこの画面の事情。**すき間 → 入れる位置**の直しは domain の1か所
    // （`insertIndexForGap`・#771(c)）＝場面カード・台本表の行と同じ計算を見る。
    insertIndexForGap(count - gap, from);
  /** 掴んで並べ替える（作法は画面ぜんぶで同じ＝`usePointerDrag`）。 */
  const beginTrackDrag = (e: ReactPointerEvent, trackId: string): void => {
    if (exporting || !doc) return; // 押せない状況では掴ませない（押してから断らない）
    const tracks = doc.tracks;
    const from = tracks.findIndex((t) => t.id === trackId);
    const gapOf = (id: string): number => [...tracks].reverse().findIndex((t) => t.id === id);
    beginDrag(e, {
      onStart: () => setTrackDrag({ trackId, gap: gapOf(trackId) }),
      onMove: (ev) => {
        const show = (e2: PointerEvent): void => setTrackDrag({ trackId, gap: displayGapAt(e2.clientY) });
        show(ev);
        // ⚠️ **端まで運んだら送る**（#802-3）＝置く・運ぶ・並べ替えと**同じ部品**。
        // 送っている間は指が止まるので、毎フレーム最後の位置で見せ直す（線が追いつく）。
        trackAutoScroll.track(trackScroller(), ev, show);
      },
      onEnd: (ev, started) => {
        trackAutoScroll.stop();
        setTrackDrag(null);
        if (!started) return; // 動かしていない＝ただのクリック
        // **確定は最後に見せた所**（見えていた線のすき間）。
        moveTrackTo(trackId, arrayIndexForGap(displayGapAt(ev.clientY), from, tracks.length));
      },
      onCancel: () => { trackAutoScroll.stop(); setTrackDrag(null); },
    });
  };
  const [drag, setDrag] = useState<DragPlace | null>(null);
  /** この画面で読めなかった動画の素材（#512 段1・実映像をやめて代表フレームへ戻す相手）。 */
  const [unplayableVideoIds, setUnplayableVideoIds] = useState<ReadonlySet<string>>(new Set());

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
  // ⚠️ 文言は**断り文と同じ所**から採る（`TIMELINE_EDIT_PLAYING`）＝ボタンの手前とキーの後で
  // 同じ状況の言い方が変わらない（ADR-0026②）。
  const playingHint = isPlaying ? editBlockedMessage[EDIT_BLOCKED.playing] : undefined;
  /**
   * 再生ボタンの見た目（#752-6/10）。**押せない理由は押す前に出す**（§2-5）。
   * ⚠️ 書き出し中は store の `play` も断るので、ここで押せなくしないと**押しても何も起きない**
   *（成果物は壊れないが、音が鳴り出す入口だけ開いていた＝走っている間の扱いが割れる）。
   * 押せるときは**キーの割り当てを添える**（決定18＝キーだけの操作を作らない＝あることを知らせる）。
   */
  const playGuard: { disabled: boolean; title: string | undefined } =
    // ⚠️ **走っている最中の「停止」は塞がない**（#752 レビュー）＝止められないまま音だけ流れる
    // 行き止まりを作らない。塞ぐのは「始める」方だけ。
    isPlaying
      ? { disabled: false, title: "再生を止めます（Space）" }
      : totalSec <= 0
        ? { disabled: true, title: "まだ何も置かれていません。部品を置くと再生できます" }
        : exporting
          ? { disabled: true, title: editBlockedMessage[EDIT_BLOCKED.playExporting] }
          : { disabled: false, title: "再生位置から流します（Space）" };

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
   * 置けるかどうかは domain の `clipPlacementIssue` で見る＝**ゴーストの色と、離したときの結果が同じ判定**
   * （置けそうに見えたのに断られる、を作らない）。置けないまま離したら**元へ戻す**＝寄せない（決定10）。
   */

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
  /**
   * 2つの箱が**違う場所**か（#746-4）。⚠️ しきい値は**極小**にする＝「ほぼ同じなら掴ませる」にすると、
   * その差が確定のたびに素の箱へ書き戻り、**1回動かすごとにわずかにずれていく**。
   */
  const boxDiffers = (a: Box, b: Box): boolean =>
    Math.abs(a.x - b.x) > 1e-6 || Math.abs(a.y - b.y) > 1e-6
    || Math.abs(a.w - b.w) > 1e-6 || Math.abs(a.h - b.h) > 1e-6
    || Math.abs((a.rotation ?? 0) - (b.rotation ?? 0)) > 1e-6;
  /**
   * キャンバスで掴めない理由（#746-4）。`null`＝掴める。
   *
   * 枠は**描かれている場所**に出すので、そこを掴んだ量は**素の箱**へ書き戻る＝動き・まとまりの変形の
   * ぶんだけ絵が飛ぶ。⚠️ **理由は原因ごとに分ける**＝「動き」で解けないものを「動きで調整して」と
   * 案内すると、言われたとおりにしても直らない（まとまりの変形は動きの欄では外せない）。
   */
  const canvasHoldReason = (cc: TimelineCanvasClip): "animation" | "group" | null => {
    if (boxDiffers(cc.groupedBox, cc.finalBox)) return "animation";
    if (boxDiffers(cc.box, cc.groupedBox)) return "group";
    return null;
  };
  /**
   * 一緒に動かさなかった部品の**理由**（#788-1）。キャンバスの `locked` を立てているのと**同じ材料**を
   * 見る＝判定を書き写さない（片方だけ直る割れを作らない）。
   *
   * ⚠️ **列の固定を先に見る**（レビュー指摘）＝固定した列の上に動きの効いた部品があると、両方が理由に
   * なりうる。動きを先に見ると「下の数値（または矢印キー）で…」と案内するが、**その部品は数値の欄が
   * 固定で押せず、矢印も列の固定で外れる**＝示した行き先が2つとも塞がっている。固定を先に言えば
   * 「固定を外してください」＝実際に効く1手になる（§2-5）。
   * 見つからない部品も列の固定で外れたものとして扱う（`grabbableClip` と同じ既定）。
   */
  const skippedReasonOf = (id: string): CanvasHoldReason => {
    const cc = canvasClips.find((x) => x.clip.id === id);
    if (!cc || trackOf(cc.clip.trackId)?.locked) return "track";
    return canvasHoldReason(cc) ?? "track";
  };
  /** 選んでいる部品をキャンバスで掴めない理由（出す先＝「位置・大きさ」の欄）。 */
  const selectedOnCanvas = canvasClips.find((cc) => cc.clip.id === selected?.id);
  const selectedHoldReason = selectedOnCanvas ? canvasHoldReason(selectedOnCanvas) : null;
  const canvasEls: FreeElement[] = canvasClips
    .filter((cc) => canHaveBox(cc.clip.kind))
    .map((cc, i) => ({
      // ⚠️ **描画と同じ変換を通す**（#746-2）＝手で作り直すと文字・書体・帯が抜け、
      // インライン編集の見た目だけ実描画と割れる（`freeElementFromClip` は描画の入口と同じもの）。
      ...freeElementFromClip(cc.clip, canvasDims),
      // ⚠️ **枠は「いま描かれている場所」に出す**（#746-4）＝動きが効いている間、素の箱に出すと
      // **掴もうとした所に部品が無い**。
      ...cc.finalBox,
      // ⚠️ **重ね順は描く順**（#746-5）＝配列の順で当てるので、後ろほど手前。列の並びと同じにしないと、
      // 重なった所で**奥の部品が掴まれる**（右クリックの「削除」も奥に当たる）。
      zIndex: i,
      // 固定した列の部品は**掴めない**（帯と同じ＝同じ状態を場所で変えない・ADR-0026②）。
      // ⚠️ 見るのは**列の固定だけ**＝domain の関門（動かす・中身を変える・消す）も列だけを見るので、
      // 部品自身の `locked` をここでだけ効かせると、キャンバスだけ理由なく掴めない、になる。
      // ⚠️ **動きが効いている間も掴ませない**（#746-4）＝掴んだ量は**素の箱**へ書き戻るので、
      // 動きのぶんだけ絵が飛ぶ。値は数値の欄で変えられる（行き止まりにしない・決定5）。
      locked: (trackOf(cc.clip.trackId)?.locked ?? false) || canvasHoldReason(cc) != null,
    }));
  /** キャンバスからの編集は **`setClipBox` と同じ入口**（数値欄と置けない条件を割らない）。 */
  const setClipBoxById = (clipId: string, patch: { x?: number; y?: number; w?: number; h?: number; rotation?: number }): void => {
    if (!doc) return;
    setClipBoxFor(clipId, patch);
  };

  const selectedBox = selected && canHaveBox(selected.kind) && doc
    ? resolveClipBox(selected, dimsForOrientation(doc.videoSettings.aspectRatio))
    : null;
  /**
   * 端の取っ手を出すか。**細い帯では出さない**＝左右の取っ手と「⋮」で**本体を掴む所が無くなる**。
   * 長さは数値の欄で変えられる（ドラッグ専用の操作を作らない・決定19）ので行き止まりにならない。
   */
  /**
   * 取っ手を置く**幅があるか**。⚠️ 「⋮」の位置はこちらだけを見る（#752 レビュー）＝掴めるかまで
   * 見ると、**再生の開始・停止のたびに「⋮」が 14px 跳ぶ**（取っ手が消えるのは意図どおりでも、
   * 位置まで動かす理由は無い）。
   */
  const wideEnoughForHandles = (c: TimelineClip): boolean => pxPerSec * c.durationSec >= CLIP_HANDLES_MIN_W_PX;
  const showHandles = (c: TimelineClip): boolean => grabbableClip(c) && wideEnoughForHandles(c);
  /**
   * 掴んでいる間の帯の位置と長さ（#686）。**離すまで文書は変えない**ので、見せかけだけを動かす。
   * 端の縮めは `applyClipEdge` と同じ下限に当たるので、見た目も同じ所で止まる。
   */
  /**
   * その帯を**いまどの列に描くか**（#686 段階4）。運んでいる間は**運び先の列**へ描く
   * ＝指と一緒に列をまたぐ（元の列に置いたまま行き先だけ光らせる、にしない）。
   * ⚠️ 描く親が変わるので帯の DOM は作り直されるが、掴む処理は `window` で受けているので切れない。
   */
  const laneOf = (c: TimelineClip): string =>
    clipDrag?.clipId === c.id && clipDrag.trackId ? clipDrag.trackId : c.trackId;

  /**
   * 掴んでいる間の**ずれ**（秒）。まとめて動かすとき、掴んでいない帯にも同じだけ効かせる
   * ＝見えている群の形と、離したときの結果を割らない（#686 段階4）。
   */
  const dragShiftSec = (c: TimelineClip): number => {
    if (!clipDrag || clipDrag.mode !== "move" || !clipDrag.groupIds || clipDrag.shiftSec == null) return 0;
    if (clipDrag.clipId === c.id) return 0; // 掴んだ相手は `dragSpanOf` が直に持つ
    // ⚠️ 見るのは**掴んだ時点で固めた群**（`selectedClipIds` を見ると、ドラッグ中に選択が変わったとき
    // 動いて見える帯と動く帯がずれる＝右クリックで選択が潰れる道がある・`/canon-check`）。
    if (clipDrag.groupIds.includes(c.id)) return c.voiceClipId != null ? 0 : clipDrag.shiftSec;
    // ⚠️ **連動している字幕は読み上げに付いてくる**（`withBoundSubtitles`）＝群にその読み上げが
    // 入っているなら、見せかけも一緒にずらす（据え置いて見せると**離した瞬間に飛ぶ**）。
    if (c.voiceClipId != null && clipDrag.groupIds.includes(c.voiceClipId)) return clipDrag.shiftSec;
    return 0;
  };

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
    const shift = dragShiftSec(c);
    const { startSec: s0, endSec: e0 } = dragSpanOf(c);
    const startSec = Math.max(0, s0 + shift);
    const endSec = e0 + shift;
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
    // ⚠️ **複数選んでいるうちの1つを掴んだら、まとめて動かす**（#686 段階4・決定15）。
    // 掴んだ相手の動いた量を、選択ぶんへ**同じだけ**当てる（群の形を崩さない）。
    // 置けるかは `moveClips` が**全か無か**で見る（1つでも置けなければ何も動かさない）。
    const groupIds = selectedClipIds.length > 1 && selectedClipIds.includes(clipId) ? [...selectedClipIds] : null;
    const startX = e.clientX;
    const startScroll = scrollRef.current?.scrollLeft ?? 0;
    const origin = mode === "trim-end" ? clipEndSec(clip0) : clip0.startSec;
    // ⚠️ **`pxPerSec` は掴んだ時点の値**（下で倍率の変更を止めているので、途中で変わらない）。
    // ⚠️ **端送り（#714）の分も足す**＝指が止まっていても枠が動けば指の下の時刻は変わる。
    // 足さないと「送られてはいるが、離すと送る前の時刻に落ちる」＝見えているものと結果が食い違う。
    /**
     * ⚠️ **連動している字幕は時間を持たない**（読み上げが決める・ADR-0032 決定24）。横にも動かすと
     * `moveClip` が `linkedSubtitleTime` で断るので、**縦にだけ動かしたときしか列を変えられない**
     * （1px 横にぶれると赤くなる）＝同じ操作が指のぶれで通ったり断られたりする（#686 段階4 レビュー）。
     * 時間を動かさない相手は**横に追従させない**＝「動かしたのに変わらない」も作らず、列だけ運べる。
     */
    const timeFixed = mode === "move" && clip0.voiceClipId != null;
    const clipLen = clipEndSec(clip0) - clip0.startSec;
    /**
     * 吸着（決定12）＝**他の帯の端・再生位置・0秒**へ寄せる。**`Ctrl` を押している間は切れる**。
     * 寄せ先は**画面内に見えているものだけ**（見えていない所へ吸い付くと理由が読めない）。
     * しきい値は px で決めて倍率で秒へ換算する＝**倍率が変わっても指の感覚が同じ**。
     */
    // ⚠️ **計算だけ**にする（線を出すのは呼び出し側）。ここで state を触ると、離すときに
    // 「消してから計算する」順になって**線が消えない**（実際に踏んだ）。
    const applySnap = (sec: number, ev: PointerEvent): { sec: number; guideSec: number | null } =>
      // 運ぶときは開始と終わりの両方・端を縮めるときは**動かしている端だけ**を見る。
      snapPlacement(sec, (t) => (mode === "move" ? [t, t + clipLen] : [t]), {
        exceptId: clipId,
        off: ev.ctrlKey || ev.metaKey || timeFixed,
      });
    const at = (ev: PointerEvent): number => {
      if (timeFixed) return origin;
      const scrolled = (scrollRef.current?.scrollLeft ?? startScroll) - startScroll;
      return Math.max(0, origin + (ev.clientX - startX + scrolled) / pxPerSec);
    };
    // 判定は**今の文書**で引く（掴んだ時点の写しで見ると、途中で変わったとき色と結果が食い違う）。
    /**
     * まとめて動かすときの**行き先ぜんぶ**（#686 段階4）。ゴーストの色と確定が**同じもの**を見る。
     * 掴んだ相手の動いた量を、選択ぶんへ同じだけ。**列が変わるのは掴んだ相手だけ**
     * （まとめて別の列へ移すと、他の帯が知らない列へ飛ぶ＝見ていない所が動く）。
     */
    /**
     * ⚠️ **ずれは群ぜんぶで丸める**（`/canon-check`）。帯ごとに `Math.max(0, …)` で切ると、
     * 先頭側だけ 0 に張り付いて**間隔が消える**（別の列どうしなら成功として確定してしまう）。
     * 群のいちばん早い帯が 0 に着いたら、そこで**群ごと止まる**。
     */
    const shiftFor = (sec: number): number => {
      const dt = sec - clip0.startSec;
      // ⚠️ 床に数えるのは**実際に動く帯だけ**（#754 レビュー 🔴）。連動している字幕は
      // **連動先の読み上げが群に居るときだけ**動く（居なければ時間は据え置き＝`moveClips`）。
      // 据え置く帯の位置を数えると、その帯が 0秒に居るだけで**群ぜんぶが左へ動けなくなる**
      // （しかも断り文も出ないので「なぜ動かないか」が分からない）。
      const starts = (groupIds ?? [])
        .map((id) => doc0.clips.find((x) => x.id === id))
        .filter((c): c is TimelineClip => c != null && c.voiceClipId == null)
        .map((c) => c.startSec);
      return starts.length > 0 ? Math.max(dt, -Math.min(...starts)) : dt;
    };
    const updatesFor = (dt: number, trackId?: string) =>
      (groupIds ?? []).map((id) => {
        const c = doc0.clips.find((x) => x.id === id);
        return { id, startSec: (c?.startSec ?? 0) + dt, ...(id === clipId && trackId ? { trackId } : {}) };
      });
    const issueOf = (sec: number, trackId?: string): EditBlockedReason | null => {
      const now = useTimelineStore.getState().doc ?? doc0;
      if (mode !== "move") return trimClipIssue(now, clipId, mode === "trim-start" ? "start" : "end", sec);
      // ⚠️ **まとめて動かすときは群ぜんぶで見る**（#686 段階4）。掴んだ相手だけを見ると、
      // **一緒に動く相手と重なる**判定になって赤くなるのに、離すと（正しく）置ける＝
      // 見えている色と結果が割れる（実機で踏んだ）。確定と同じ `moveClips` を通す。
      if (groupIds) {
        const r = moveClips(now, updatesFor(shiftFor(sec), trackId));
        return r.ok ? null : r.reason;
      }
      return moveClipIssue(now, clipId, { startSec: sec, ...(trackId ? { trackId } : {}) });
    };
    /**
     * 運び先の列（`move` のときだけ）。**指の下の列**を「置く」と同じ規則（`laneAt`）で採る。
     * 列の外（欄の余白・仕上がり確認の上）へ出たら `undefined`＝**掴んだ列のまま**
     * （`moveClip` も `laneOf` も「指定が無ければ元の列」を見るので、勝手に別の列へ飛ばさない）。
     */
    const trackAt = (ev: PointerEvent): string | undefined =>
      mode === "move" ? laneAt(ev.clientX, ev.clientY)?.trackId : undefined;
    /**
     * **最後に見せた時刻**（#686 段階4 レビュー）。確定はこれを使う＝見えていたものと違う所へ落とさない。
     * ⚠️ state（`clipDrag`）は**掴んだ時点の render の値**しか見えない（この関数の closure）ので使えない。
     *
     * 初期値は `origin`＝**まだ何も見せていないなら動かさない**。`null` を入れて確定側で
     * 「無ければ計算し直す」と書くと、**到達しない道**が残る（掴んだと見なす前に必ず1回見せるため）
     * ＝読み手に「本当に起きるのか」を追わせる（#749 レビュー）。
     */
    let lastShownSec = origin;
    beginDrag(e, {
      // 掴んだ相手を選ぶ＝「選んだ部品」の欄と一致する。
      // ⚠️ **まとめて掴んだときは潰さない**（#686 段階4）＝潰すと選択が1つになり、
      // 一緒に動かすはずの相手が置き去りになる（見えている群と結果が割れる）。
      onStart: () => { if (!groupIds) selectClip(clipId); },
      onMove: (ev) => {
        // ⚠️ 掴み直してもらう道でも**送りを止める**（#714 レビュー）。止めないと rAF が回り続け、
        // 毎フレーム下の `replay` が走って**消したはずのゴーストが復活**し、枠も流れ続ける。
        if (clipChanged(clip0)) { autoScroll.stop(); setClipDrag(null); return; }
        const show = (e2: PointerEvent): void => {
          const { sec: raw, guideSec } = applySnap(at(e2), e2);
          // 群ごと丸めたずれから、掴んだ相手の位置も出す（見せかけと確定が同じ値を見る）。
          const shiftSec = groupIds ? shiftFor(raw) : undefined;
          const sec = groupIds ? clip0.startSec + (shiftSec ?? 0) : raw;
          lastShownSec = sec;
          const trackId = trackAt(e2);
          setClipDrag({ clipId, mode, sec, trackId, groupIds: groupIds ?? undefined, shiftSec, issue: issueOf(sec, trackId) });
          setSnapGuideSec(guideSec);
        };
        show(ev);
        // 端まで来たら送る。送った各フレームで**この処理をやり直す**（上の `at` が枠の動きも見る）。
        autoScroll.track(scrollRef.current, ev, show);
      },
      onEnd: (ev, started) => {
        autoScroll.stop();
        setSnapGuideSec(null);
        if (!started) return; // 動かしていない＝ただのクリック（選択は `onClick` が受ける）
        setClipDrag(null);
        // 離した後に来る `click` を捨てる＝**選び直しで理由が消える**のと、`Shift` を押していたときに
        // 動かした帯の選択が外れるのを防ぐ（`pointerdown` の `preventDefault` は `click` を止めない）。
        dropSkipClickSoon();
        if (clipChanged(clip0)) return;
        // ⚠️ 確定は**最後に見せた値そのもの**（#686 段階4 レビュー）。ここで計算し直すと、
        // `Ctrl` を先に離してからボタンを離したときに**点線が出ていなかったのに落ちた瞬間に寄る**
        // （逆順なら寄っていたのに寄らない）＝見えていたものと違う所へ落ちる。
        const sec = lastShownSec;
        // ⚠️ **ここで置けるかを見ない**＝`moveClipById` が同じ `moveClip` を走らせ、置けなければ
        // **文書を変えずに理由だけ立てる**（＝寄せない＋離したときに出す・決定10）。
        // 手前で1回断る形にしていたが、結果は同じで**判定する場所が2つ**になるだけだった
        // （ゴーストの色も同じ関数を見ている＝決めるのは1か所）。
        // 掴んだ相手は `clipId`。**選択に効かせない**＝掴んでいる間に選択が変わっても（左ドラッグ中の
        // 右クリック・取り消しで対象が消える等）**掴んでいない帯**が動く、を作らない。
        if (mode === "move") {
          const trackId = trackAt(ev);
          if (groupIds) moveClipsBy(updatesFor(shiftFor(sec), trackId));
          else moveClipById(clipId, { startSec: sec, trackId });
        }
        else trimClipById(clipId, mode === "trim-start" ? "start" : "end", sec);
      },
      onCancel: (started) => { autoScroll.stop(); setClipDrag(null); setSnapGuideSec(null); if (started) dropSkipClickSoon(); },
    });
  };

  /**
   * その点の下にある**列と時刻**（#686 段階4）。**置く**（#684）と**帯を運ぶ**が同じ規則を見る
   * ＝どちらか片方だけ「見えている分だけ」を忘れる、を作らない。
   *
   * **見えている分だけ**を落とし先にする（スクロールで欄の外へ出ている列へ落とさない）。
   * 時刻は**列そのものの左端**から測る（切った矩形の左端は列の 0 秒ではない）。
   */
  const laneAt = (x: number, y: number): { trackId: string; startSec: number } | null => {
    for (const [trackId, el] of laneRefs.current) {
      if (!pointInRect(visibleRectOf(el) ?? { left: 0, top: 0, right: -1, bottom: -1 }, x, y)) continue;
      return { trackId, startSec: laneTimeAt(el.getBoundingClientRect(), pxPerSec, x) };
    }
    return null;
  };

  /**
   * **時刻を吸着させる**（決定12）＝他の帯の端・再生位置・0秒へ寄せる。**`Ctrl` で切れる**。
   * 寄せ先は**画面内に見えているものだけ**（見えていない所へ吸い付くと理由が読めない）。
   * しきい値は px で決めて倍率で秒へ換算する＝**倍率が変わっても指の感覚が同じ**。
   *
   * ⚠️ **帯を運ぶときも、新しく置くときも同じ式を通す**（#771(a)）＝同じ「時間を決める操作」なのに
   * 片方だけ吸着が無いと、置いた直後に必ず微妙にずれる（置いてから運び直す羽目になる）。
   * ⚠️ **計算だけ**にする（線を出すのは呼び出し側）。ここで state を触ると、離すときに
   * 「消してから計算する」順になって**線が消えない**（実際に踏んだ）。
   */
  const snapPlacement = (
    sec: number,
    edgesOf: (sec: number) => number[],
    opts: { exceptId?: string; off?: boolean },
  ): { sec: number; guideSec: number | null } => {
    if (opts.off) return { sec, guideSec: null };
    const el = scrollRef.current;
    const now = useTimelineStore.getState().doc;
    if (!el || !now || pxPerSec <= 0) return { sec, guideSec: null };
    const visible = visibleTimeRange({
      scrollLeft: el.scrollLeft, clientWidth: el.clientWidth, labelPx: LANE_LABEL_PX, pxPerSec,
    });
    const targets = timeSnapTargets({ clips: now.clips, exceptId: opts.exceptId, playheadSec, visible });
    const r = snapTime({ edges: edgesOf(sec), targets, thresholdSec: SNAP_THRESHOLD_PX / pxPerSec });
    return { sec: Math.max(0, sec + r.deltaSec), guideSec: r.guide?.sec ?? null };
  };

  /** 落とした点から「どこへ置くか」を決める。**列が先**（下の並びは仕上がり確認に重ならない）。 */
  const resolveDrop = (
    spec: ClipPlacement, x: number, y: number, noSnap = false,
  ): DragPlace["drop"] => {
    if (!doc) return null;
    const lane = laneAt(x, y);
    if (lane) {
      // ⚠️ **置くときも帯を運ぶときと同じ吸着**（#771(a)）＝同じ「時間を決める操作」で作法を割らない。
      // 置く部品の長さは種類ごとに決まっている（`placedDurationSec`）ので、開始と終わりの両方で寄せる。
      const durationSec = placedDurationSec(spec);
      const { sec: startSec, guideSec } = snapPlacement(
        lane.startSec, (t) => [t, t + durationSec], { off: noSnap },
      );
      const { trackId } = lane;
      return { at: { trackId, startSec }, guideSec, issue: clipPlacementIssue(doc, spec, trackId, startSec) };
    }
    // ⚠️ **仕上がり確認へ落とせるのは絵の部品だけ**（#714）＝見た目パターン・音・読み上げは
    // 「動画の中の場所」を持たない。落とせない所として扱う（勝手に別の場所へ置かない・決定10）。
    if (!isVisualSpec(spec)) return null;
    const stage = stageRef.current?.getBoundingClientRect();
    const stageVisible = stageRef.current ? visibleRectOf(stageRef.current) : null;
    if (stage && stageVisible && pointInRect(stageVisible, x, y)) {
      // 仕上がり確認は**動画の中の場所**だけを決める。列は**欄に出ている「置く列」**・時刻はボタンと
      // 同じ規則でアプリが選ぶ（決定10 の「寄せない」は**利用者が指した軸**＝ここでは位置の話。
      // 列と時間は指していない）。
      const center = canvasPointAt(stage, dimsForOrientation(doc.videoSettings.aspectRatio), x, y);
      return { center, issue: placeableTracks.length === 0 ? EDIT_BLOCKED.notFound : null };
    }
    return null;
  };

  /** 一覧・ボタンから掴む。**動かさずに離したときは何もしない**（そのまま `click` が走って再生位置へ置く）。 */
  /**
   * 一覧・ボタンから掴んで置く（#684・#714）。
   *
   * `place` は**実際に置く**手（ボタンで押したときと同じもの）＝置き先が決まっていなければ
   * 欄に出ている列と再生位置へ置く。**種類ごとの違いは呼ぶ側に残す**（掴む作法はここで1つ）。
   */
  const grabToPlace = (
    e: ReactPointerEvent,
    spec: ClipPlacement,
    label: string,
    place: (at?: { trackId: string; startSec: number }, center?: { x: number; y: number }) => void,
  ): void => {
    if (exporting || isPlaying) return; // 押せない状況では掴ませない（押してから断らない）
    beginDrag(e, {
      onStart: (ev) => setDrag({ spec, label, x: ev.clientX, y: ev.clientY, drop: resolveDrop(spec, ev.clientX, ev.clientY, ev.ctrlKey || ev.metaKey) }),
      onMove: (ev) => {
        const show = (e2: PointerEvent): void => {
          const drop = resolveDrop(spec, e2.clientX, e2.clientY, e2.ctrlKey || e2.metaKey);
          setDrag({ spec, label, x: e2.clientX, y: e2.clientY, drop });
          // 寄せ先の点線は帯を運ぶときと同じもの（同じ state を使う＝画面に2本出ない）。
          setSnapGuideSec(drop?.guideSec ?? null);
        };
        show(ev);
        // 端まで運んだら送る（#714）。落とし先は列の位置から測り直すので、送った分だけ時刻も動く。
        autoScroll.track(scrollRef.current, ev, show);
      },
      onEnd: (ev, started) => {
        setDrag(null);
        autoScroll.stop();
        // **動かさずに離した＝押しただけ**。ここで置く（`click` を待たない＝指の経路はここで完結する）。
        // 動かさずに離した＝押しただけ＝**欄に出ている列**へ置く（ボタンと同じ・#771(b)）。
        if (!started) { place(); return; }
        const drop = resolveDrop(spec, ev.clientX, ev.clientY, ev.ctrlKey || ev.metaKey);
        setSnapGuideSec(null); // 離したら線を消す（帯を運ぶときと同じ）
        // 落とし先の外・置けない所で離したら**何も置かない**（寄せない）。理由は離したときだけ出す（決定10）。
        if (!drop) return;
        // 置けないときも**同じ入口**へ渡す＝断る理由は store（domain）が出す（判定を2か所に持たない）。
        // ⚠️ **仕上がり確認へ落としたときも「置く列」へ入れる**（#771(b) レビュー🔴）＝あちらは
        // **動画の中の場所**だけを指しており、列は指していない。欄に出ている列を使わないと
        // 「表示と結果を割らない」（`11 §7.6.3`）が破れる（ボタンは同じ列へ入るのに、運ぶと別の列へ入る）。
        place(drop.at, drop.center);
      },
      // 中止しても**点線を消す**（#771(a) レビュー）＝ゴーストは消えるのに線だけ残ると、
      // 「いま何かが吸着している」という嘘が次の操作まで居座る（帯を運ぶ側は消している）。
      onCancel: () => { autoScroll.stop(); setDrag(null); setSnapGuideSec(null); },
    });
  };

  /**
   * 見た目パターンを置く（#714）。**押した＝欄に出ている列と再生位置／運んだ＝落とした所**。
   * どちらもこの1か所を通る＝置き方で入る場所の規則が割れない。
   */
  const placeTemplate = (t: Template, at?: { trackId: string; startSec: number }): void => {
    addTemplateClip({ template: t, trackId: at?.trackId ?? visualTrackId, startSec: at?.startSec ?? playheadSec });
  };

  /**
   * 一覧の id から**音の出どころ**を引く（`bgm:` / `asset:`）。
   * ⚠️ **目録・素材に無いものは返さない**＝存在しない曲や写真を指す部品を作らない。
   * 出どころは**高々1つ**（`11 §8` V25）なので、ここで片方だけを持つ形にして渡す。
   */
  const audioSourceOf = (id: string): { spec: { bundledBgmId?: BundledBgmId; assetId?: string }; label: string } | null => {
    const sep = id.indexOf(":");
    const [kind, rest] = [id.slice(0, sep), id.slice(sep + 1)];
    if (kind === "bgm") {
      const bgm = BGM_CATALOG.find((b) => b.id === rest);
      return bgm ? { spec: { bundledBgmId: bgm.id }, label: bgm.label } : null;
    }
    const asset = doc?.assets.find((a) => a.assetId === rest);
    // ⚠️ 無いものは `null`＝**無言で終わる**が、一覧の項目と here の照合は**同じ描画の `doc`** から
    // 作っているので到達しない（押した瞬間に消えている素材、が作れない）。理由を出す道は
    // 置く関数側（`clipPlacementIssue` の `notFound`）に残っている。
    return asset ? { spec: { assetId: asset.assetId }, label: asset.displayName } : null;
  };

  /** 音を置く（見た目パターンと同じく、押した／運んだのどちらもここを通る）。 */
  const placeAudio = (
    spec: { bundledBgmId?: BundledBgmId; assetId?: string },
    at?: { trackId: string; startSec: number },
  ): void => {
    addAudioClip({ ...spec, trackId: at?.trackId ?? audioTrackId, startSec: at?.startSec ?? playheadSec });
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
      ? { disabled: true, hint: hiddenTrackDuplicateMessage() }
      : {};

  /**
   * **いま分けられるか**（#686 段階4・決定16）。`splitClipIssue` を見る＝押す前に断るのと、
   * 実際に分けるときの規則が同じもの（押せるのに何も起きない、を作らない）。
   */
  const splitExtra = (): { disabled?: boolean; hint?: string } => {
    if (!doc || !selected) return { disabled: true, hint: "分ける部品を選んでください" };
    // ⚠️ **再生中もここで断る**（#750 レビュー）＝ボタン・`Ctrl+K` は断るのに右クリックだけ通ると、
    // **走っている再生位置で分割が確定**する（同じ操作の結果が毎回変わる・ADR-0032 決定21）。
    if (isPlaying) return { disabled: true, hint: editBlockedMessage[EDIT_BLOCKED.playing] };
    // ⚠️ **見た目パターンも渡す**（PR #825 レビュー 🟡）＝実際に分ける側（store）と同じ材料で見る。
    // 渡さないと差し込み口の置き場所が解けず、押せるのに押した先で断られる（この節の趣旨と逆）。
    const issue = splitClipIssue(doc, selected.id, playheadSec, { templateOf });
    return issue ? { disabled: true, hint: editBlockedMessage[SPLIT_BLOCKED_REASON[issue]] } : {};
  };
  /** ボタンの見た目（説明はここで作る＝押せるときはキーの割り当てを添える・#752-10）。 */
  const splitGuard = editGuard(splitExtra());
  const singleClipMenuGuard: { disabled?: boolean; disabledHint?: string } =
    selectedClipIds.length > 1
      ? { disabled: true, disabledHint: "1つだけ選ぶと使えます" }
      : editGuard().disabled
        ? { disabled: true, disabledHint: editGuard().title }
        : {};
  /**
   * メニューの「複製」の関門（#746-1）。**帯とキャンバスが同じ式を見る**
   * ＝多重選択の条件を片方で落とすと、押せる見た目のまま**押しても無反応**になる
   *（複製は選択がちょうど1件でないと store が何もせず理由も持たない）。
   */
  const duplicateMenuGuard: { disabled?: boolean; disabledHint?: string } = {
    ...singleClipMenuGuard,
    ...(duplicateExtra().disabled ? { disabled: true, disabledHint: duplicateExtra().hint } : {}),
  };
  const clipMenuItems: ContextMenuItem[] = menuClip
    ? [
        // ⚠️ **1つのときだけ**（#701 レビュー）＝複製は store が「選択がちょうど1件」でないと**何もせず
        // 理由も持たない**ので、押せる状態で出すと**押しても無反応**になる。理由の言い方は
        // 「選んだ部品」の欄と同じ（`editGuard`）＝同じ状態を画面の場所で別の言い方にしない（ADR-0026②）。
        {
          label: DUPLICATE_LABEL,
          ...duplicateMenuGuard,
          onSelect: duplicateSelectedClip,
        },
        {
          label: "ここで分ける",
          ...singleClipMenuGuard,
          ...(splitExtra().disabled ? { disabled: true, disabledHint: splitExtra().hint } : {}),
          onSelect: () => splitSelectedClip(playheadSec),
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
          label: selectedClipIds.length > 1 ? `選んだ${selectedClipIds.length}個を${DELETE_LABEL}` : DELETE_LABEL,
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
        // **中身ごと複製**（#767・利用者決定）＝空の列だけ増やすなら「列を足す」と同じ。
        // 言い方は共有の語（`uiLabels`）から採る＝同じ操作を場所で別の語にしない（#763-6）。
        { label: `この列を中身ごと${DUPLICATE_LABEL}`, ...trackMenuGuard, onSelect: () => duplicateTrack(menuTrack.id) },
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
          label: `この列を${DELETE_LABEL}`,
          danger: true,
          // 固定した列は消せない（`removeTrack` が断る＝ADR-0032）。押してから断られるのではなく、
          // **押す前に理由を出す**（長い画面では上部の知らせを見落とす・§2-5）。
          // 書き出し中も**開く前に**断る（答えてから断ると、取り返しのつかなさを聞いた意味が無くなる・#703）。
          disabled: menuTrack.locked || exporting,
          disabledHint: menuTrack.locked ? lockedTrackMessage("delete") : exportingHint,
          onSelect: () => setRemovingTrackId(menuTrack.id),
        },
      ]
    : [];
  // インライン編集中の部品は**SVG から伏せる**（#746-2）＝編集欄が同じ体裁・同じ位置に文字を出すので、
  // 伏せないと二重に見える（場面形式の `hideItemIds` と同じ後段の間引き＝正準の結果は変えない）。
  const shownLayout = layout && editingCanvasId
    ? { ...layout, items: layout.items.filter((i) => !isItemOfClip(i.id, editingCanvasId)) }
    : layout;
  const svg = shownLayout
    ? layoutToSvg(shownLayout, {
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
  // 動画の素材の id（選んだ部品の知らせに使う＝描画のたびに作り直さない）。
  const videoAssetIdSet = videoAssetIds(doc);
  // **動画の実映像**（#512 段1）＝書き出しで実フレームが出るので、プレビューにも同じ絵を出す
  // （出さないと「見えていたものと違う動画が出る」＝ADR-0001 が破れる）。分割は書き出しと**同じ関数**
  // （`splitVideoSceneSvgMulti`）＝穴を開けて `video` 要素で埋める。元の音は段2（`placementOriginalAudio`）。
  const videoPlay = shownLayout
    ? videoPlacementsOf(doc, templateOf)
        .map((placement) => {
          const clip = placement.clip;
          // ⚠️ **置き場所そのもののアイテム**を探す（#512 段3）＝部品 id だけで探すと、
          // 見た目パターンの**別の枠**まで動画のコマで塗ってしまう。
          const item = shownLayout.items.find(
            (it) => it.kind === "image" && it.role === "slot" && isItemOfPlacement(it.id, placement),
          ) as (LayoutItem & { kind: "image" }) | undefined;
          // ⚠️ **動画の本体**の URL（`assetSrcById` は代表フレーム＝静止画）。無ければ**穴を開けない**
          // ＝何も映らない窓を作るより、いままでどおり代表フレームで見せる（#512 段1 レビュー 🔴）。
          // ⚠️ **この画面で読めなかった素材は実映像にしない**（レビュー 🟡）＝取り込みは変換しないので
          // 画面が再生できない形式が入りうる。穴だけ開いた窓を残さず、代表フレームへ戻す。
          // ⚠️ **復号できない形式は「理由つきで静止」へ回す**（#816-1）＝ここで落とすと、絵が静止する
          // だけでなく**音も落ち、理由も出ない**。書き出しは実映像＋元の音を出すので、黙っていると
          // 「見えていたものと違う動画」が成功として出る（ADR-0001・ADR-0026④）。
          // `.avi`/`.mkv` は取り込めるが復号できない＝**例外ではなく主要ケース**。
          const unplayable = unplayableVideoIds.has(placement.assetId);
          const src = !unplayable ? videoSrcById[placement.assetId] : undefined;
          // 描かれていない部品は音も鳴らない（`item` が無い＝その時刻に出ていない・隠れている）。
          if (!item) return null;
          // まだ読めていないだけ（読み込み中）は理由を出さない＝一時的な状態を不具合のように見せない。
          if (!src && !unplayable) return null;
          // ⚠️ **書き出しと同じ関数で、同じ格子**（`frameTimeSec`）から出す＝置いた位置が格子に
          // 乗っていなくても、プレビューと書き出しが同じコマになる。
          const sourceSec = videoSourceSecAt(placement, frameTimeSec(doc, playheadSec), effectiveFps(doc));
          if (sourceSec == null) return null;
          const speed = videoStagePlan(placement).speed;
          // ⚠️ **合成の単位がこの部品だけに閉じていないなら、実映像にしない**（レビュー 🔴・`11 §7.6.4`
          // ＝「帯分割は合成の単位を跨いで切る…跨ぐときは分割を拒否して理由を返すこと」）。
          // まとまり全体のフェードは複数の部品へ同じ単位で掛かるので、層ごとに掛けると
          // **重なった所で下が透ける**＝書き出し（1枚にしてから掛ける）と別の絵になる。
          // ⚠️ **出せない理由を持ち帰る**（レビュー 🔴）＝「実映像になっていない」全部を同じ文言で説明すると、
          // 区間の外・本体が無い・編集中でも「まとまりを薄くしている間は…」と**嘘の理由**が出る。
          const held = unplayable
            ? "unplayable"
            : compositeSpansOthers(shownLayout.items, item.id)
              ? "groupFade"
              : cropPivotDiffers(item, item.clipRect, item.rotation)
                ? "rotatedCrop"
                : null;
          return {
            clip, placement, held, itemId: item.id, src, sourceSec, speed,
            fit: item.fit, align: item.align,
            // 元の音（#512 段2・段3b）。鳴るかどうか・音量は domain の1か所が決める（書き出しと同じ値）。
            // 直接置きも差し込み口も**同じ関数**を通る＝置き場所で挙動を割らない。
            audioVolume: doc ? (placementOriginalAudio(doc, placement)?.volume ?? undefined) : undefined,
            // ⚠️ **使える長さを過ぎたら止める**（レビュー 🟡）＝素材の秒は頭打ちで一定になるが、
            // それだけでは `video` 要素が自分で先へ流れ続ける（絵も音も「ここまで」を越える）。
            // 書き出しは最後のコマで凍るので、ここでも止めて凍らせる（ADR-0001）。
            pastUsableLength: videoHoldsLastFrameAt(placement, frameTimeSec(doc, playheadSec)),
            // 合成の不透明度・切り抜きは**書き出しが `<g>` で掛けているもの**＝実映像にも同じだけ効かせる。
            // ⚠️ 書き出しは**入れ子で掛かる**（合成の単位の α × 要素の α）＝置き換えない（レビュー 🟡）。
            opacity: (item.composite?.opacity ?? 1) * (item.opacity ?? 1),
            clipRect: item.clipRect,
          };
        })
        .filter((v): v is NonNullable<typeof v> => v != null)
    : [];
  /** 実際に実映像として出すもの（出せない理由が付いたものは静止のまま）。 */
  // ⚠️ `src` は「読めなかった形式」で無い場合がある（#816-1）＝**型でも外す**（flatMap で絞る）。
  const videoShown = videoPlay.flatMap((v) => (v.held == null && v.src ? [{ ...v, src: v.src }] : []));
  /**
   * **絵は出せないが、音は鳴らすもの**（#512 段2・レビュー 🟡）。
   * ⚠️ 絵を出せない理由（合成の単位を跨ぐ・回した切り抜き）は**音には当てはまらない**（音は合成しない）
   * ＝ここで消すと「仕上がり確認では聞こえないのに、書き出した動画には入っている」になる（ADR-0001）。
   */
  // ⚠️ **復号できない形式は音も出せない**（同じ復号器を通る）＝ここから外す。外さないと
  // src の無い要素を作るだけで、鳴らない理由も伝わらない（理由は選んだ部品の欄に出す）。
  const videoHeldAudible = videoPlay.flatMap((v) =>
    v.held != null && v.held !== "unplayable" && v.audioVolume != null && v.src ? [{ ...v, src: v.src }] : [],
  );
  const videoSplit =
    shownLayout && videoShown.length > 0
      ? splitVideoSceneSvgMulti(
          shownLayout,
          videoShown.map((v) => v.itemId),
          (id) => (id ? assetSrcById[id] ?? templateAssetSrcById[id] : undefined),
          undefined,
          fontFamilyForId(doc.videoSettings.fontId),
          creditForLine(
            { speaker: creditSpeakerAt(doc, frameTimeSec(doc, playheadSec)) },
            creditForSpeaker(getVoicevoxSpeaker()),
          ),
          true,
        )
      : null;

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
          {/* 絵は静止のままでも**音は鳴らす**（#512 段2・レビュー 🟡）＝聞こえないのに書き出しには
              入っている、を作らない（ADR-0001）。⚠️ **枠の外に置く**＝枠は絵が1枚のとき
              `dangerouslySetInnerHTML` を使うので、中に子を足せない。見えない・触れない姿で流す。 */}
          {videoHeldAudible.map((v) => (
            <TimelineSlotVideo
              // ⚠️ **鍵も置き場所ごと**（レビュー 🟡）＝部品 id だと差し込み口が2つある部品で重なり、
              // 取り違えて片方しか鳴らない（書き出しには2本入るので食い違う）。
              key={v.itemId}
              audioOnly
              src={v.src}
              rect={{ x: 0, y: 0, w: 0, h: 0 }}
              fit={v.fit}
              canvas={canvasDims}
              sourceSec={v.sourceSec}
              speed={v.speed}
              playing={isPlaying && !v.pastUsableLength}
              audioVolume={v.audioVolume}
              onUnplayable={() =>
                setUnplayableVideoIds((prev) =>
                  prev.has(v.placement.assetId) ? prev : new Set([...prev, v.placement.assetId]),
                )
              }
            />
          ))}
          {/* ⚠️ **比を動画の向きに合わせる**（#685 レビュー 🔴）。CSS の既定は 16:9 固定なので、縦型では
              SVG が中で letterbox され、上に重ねる操作レイヤ（`inset: 0`）と**実際に描かれている矩形が
              ずれる**（枠が約3倍の幅になり、動かす量も同じだけずれる）。場面形式のプレビューも
              「比をキャンバスに合わせて SVG を充填する＝余白を作らない」で同じ問題を解いている。 */}
          <div
            ref={stageRef}
            className={`preview-stage${drag?.drop?.center ? (drag.drop.issue ? " drop-target--blocked" : " drop-target") : ""}`}
            style={{ aspectRatio: `${canvasDims.width} / ${canvasDims.height}`, position: "relative" }}
            {...(videoSplit ? {} : { dangerouslySetInnerHTML: { __html: svg } })}
          >
            {/* 動画があるときは**下の静止層 →（実映像 → 間の静止層）* → 上の静止層**の順に重ねる
                （#512 段1・書き出しと同じ分割）。無いときは1枚の SVG のまま＝出力の差分を作らない。 */}
            {videoSplit && (
              <>
                <div style={{ position: "absolute", inset: 0 }} dangerouslySetInnerHTML={{ __html: videoSplit.belowSvg }} />
                {videoSplit.slots.map((slot, k) => {
                  const v = videoShown.find((x) => x.itemId === slot.layerId);
                  return (
                    <Fragment key={slot.layerId}>
                      {v && (
                        <TimelineSlotVideo
                          src={v.src}
                          rect={slot.rect}
                          rotation={slot.rotation}
                          opacity={v.opacity}
                          fit={v.fit}
                          align={v.align}
                          clipRect={v.clipRect}
                          canvas={canvasDims}
                          sourceSec={v.sourceSec}
                          speed={v.speed}
                          playing={isPlaying && !v.pastUsableLength}
                          audioVolume={v.audioVolume}
                          onUnplayable={() =>
                            setUnplayableVideoIds((prev) =>
                              // ⚠️ **置き場所の素材**を覚える（レビュー 🟡）＝差し込み口では部品に
                              // `assetId` が無く、部品側で見ると穴だけ開いた窓が残る。
                              prev.has(v.placement.assetId) ? prev : new Set([...prev, v.placement.assetId]),
                            )
                          }
                        />
                      )}
                      {k < videoSplit.midSvgs.length && (
                        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }} dangerouslySetInnerHTML={{ __html: videoSplit.midSvgs[k] }} />
                      )}
                    </Fragment>
                  );
                })}
                <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }} dangerouslySetInnerHTML={{ __html: videoSplit.aboveSvg }} />
              </>
            )}
          </div>
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
              onSkippedLocked={(ids) => noticeSkipped(ids.map(skippedReasonOf), [...selectedClipIds].sort().join(","))}
              // ⚠️ **右クリックで黙らない**（#746-1）＝帯には「複製／削除」があるのに、
              // キャンバスだけ何も出ないと**同じ操作が場所によって在ったり無かったり**になる。
              // 関門も文言も帯と同じもの（決定17 が禁じるのは「前へ／奥へ」だけ＝そちらは渡さない）。
              onDuplicate={() => duplicateSelectedClip()}
              onDelete={() => requestRemoveSelected()}
              menuGuards={{
                duplicate: duplicateMenuGuard,
                delete: { disabled: removeGuard?.disabled, disabledHint: removeGuard?.title },
              }}
              // ⚠️ **文字は二度押しで直せる**（#746-2）＝他社の型。値は「中身」の欄でも触れるが、
              // 同じ部品で画面ごとに手が変わる（ADR-0026②）。編集中は下の SVG を伏せる（二重表示回避）。
              onChangeText={(id: string, text: string) => setClipTextFor(id, text)}
              onEditingIdChange={setEditingCanvasId}
              textFontFamily={fontFamilyForId(doc.videoSettings.fontId)}
            />
          )}
        </div>
        <div className="row gap-sm">
          <button
            className="btn btn-primary"
            onClick={isPlaying ? pause : play}
            {...playGuard}
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
              ["--clip-handle-hit-w" as string]: `${CLIP_HANDLE_HIT_W_PX}px`,
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
            {/* ⚠️ **吸着の外し方を画面に書く**（#819-3）＝掴むと勝手に隣へ寄るのに、切る方法が
                どこにも書かれておらず「思った所へ置けない」ままになる（決定12 は切れると定めている）。 */}
            <p className="text-muted text-sm">
              帯を掴むと、ほかの帯の端・再生位置・0秒へ吸い寄せます。<kbd>Ctrl</kbd> を押しながら動かすと吸着しません。
            </p>
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
                    // ⚠️ **掴んだまま動かせる**（#819-1・ADR-0034 決定1＝業界の型に合わせる）＝
                    // 再生ヘッドには**掴み手の三角**を描いておきながら、押した所へ跳ぶだけで
                    // **追従しなかった**（掴める合図を出して掴めない＝一番わかりにくい壊れ方）。
                    // 作法は帯・欄と**同じもの**（`usePointerDrag`＝少し動かすまで掴まない・
                    // `Escape` で戻す・左ボタンのみ・画面を離れても後始末が走る）。
                    // ⚠️ **押した瞬間から追従させる**（`startPx: 0`）＝つまみを掴む操作なので遊びを作らない
                    //（境界を掴んで広げるのと同じ扱い）。押しただけなら `onClick` が同じ所へ跳ばす。
                    onPointerDown={(e) => {
                      if (isPlaying) return; // 再生中は掴ませない（走っている的を狙わせない・決定21）
                      const rect = e.currentTarget.getBoundingClientRect();
                      const before = playheadSec;
                      beginDrag(e, {
                        startPx: 0,
                        onMove: (ev) => setPlayhead((ev.clientX - rect.left) / pxPerSec),
                        // やめたら掴む前へ戻す（帯の移動と同じ＝中止は「無かったこと」にする）。
                        onCancel: () => setPlayhead(before),
                      });
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
                    {/* ⚠️ **時刻の書き方は1つにそろえる**（#819-3・§6・ADR-0026②）＝同じ画面の帯の
                        ツールチップ（`clipRangeTitle`）と見わたす画面が `m:ss` なのに、ここだけ「N秒」
                        だった。刻みは常に整数秒（`tickStepSec`）なので丸めで潰れることはない。 */}
                    {ticks.map((t) => (
                      <span key={t} className="timeline-tick" style={{ left: `${pxPerSec * t}px` }}>
                        {clockLabel(t)}
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
                {/* 吸着した先の**縦の点線**（#686 段階4・決定12）＝「なぜそこで止まったか」を見せる。
                    再生位置の線と同じ場所・同じ測り方（列の名前の欄ぶん右から）＝2本の線がずれない。 */}
                {snapGuideSec != null && (
                  <div
                    className="timeline-snapline"
                    style={{ left: `calc(var(--timeline-label-w) + ${pxPerSec * snapGuideSec}px)` }}
                    aria-hidden
                  />
                )}
                {/* 表示は**手前が上**（配列は後ろほど手前なので逆順に並べる）＝重なりの見え方と一致させる。
                    行にも解除を付けるのは、列の幅より画面が広いとき**右側にできる余白**を押しても解けるようにするため
                    ＝「何もない所を押すと解ける」の当たり判定を見た目どおりにする（#701 レビュー）。 */}
                {[...doc.tracks].reverse().map((track, displayIndex) => (
                  <div
                    className={`timeline-row${trackDrag?.trackId === track.id ? " timeline-row--dragging" : ""}${
                      trackDrag?.gap === displayIndex ? " timeline-row--drop-above" : ""
                    }${
                      // いちばん下のすき間は「最後の行の下」に引く（行の上端だけだと表せない）。
                      trackDrag?.gap === doc.tracks.length && displayIndex === doc.tracks.length - 1
                        ? " timeline-row--drop-below"
                        : ""
                    }`}
                    key={track.id}
                    ref={(el) => { if (el) rowRefs.current.set(track.id, el); else rowRefs.current.delete(track.id); }}
                    onClick={(e) => { if (e.target === e.currentTarget) clearSelectionByClick(); }}
                  >
                    {/* 操作は右クリックのメニューへ畳む＝行に文字を並べない（帯が読めなくなる・利用者指摘 2026-08-03）。
                        行に残すのは**名前と状態**だけ。右クリックできると分かるよう、同じメニューを開く小さなボタンも置く
                        （右クリックを知らない・使えない場合の逃げ道＝§2-5）。 */}
                    {/* ⚠️ **掴んで並べ替えられる**（#767・利用者要望）＝帯は掴めるのに列だけメニューの
                        「手前へ／奥へ」しか無い、を解消する。作法は画面ぜんぶで同じ（`usePointerDrag`）。
                        **ドラッグ専用にしない**（決定19）＝「⋮」の「手前へ／奥へ」は残す。 */}
                    <div
                      className={`timeline-row-label${exporting ? "" : " grabbable"}`}
                      onContextMenu={(e) => openTrackMenu(e, track.id)}
                      onPointerDown={(e) => beginTrackDrag(e, track.id)}
                    >
                      <span>{trackLabel(doc.tracks, track.id)}</span>
                      {track.hidden && <span className="sub">出さない</span>}
                      {track.locked && <span className="sub">固定中</span>}
                      <button
                        className="btn btn-ghost btn-sm"
                        // ⚠️ **親（掴んで並べ替える面）へ渡さない**（レビュー）＝押してから少し動かすと
                        // 列が並べ替わる（帯の端の取っ手が本体のドラッグを兼ねないのと同じ理由）。
                        onPointerDown={(e) => e.stopPropagation()}
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
                          style={{ left: `${pxPerSec * drag.drop.at.startSec}px`, width: `${pxPerSec * placedDurationSec(drag.spec)}px` }}
                          aria-hidden="true"
                        />
                      )}
                      {doc.clips
                        .filter((c) => laneOf(c) === track.id)
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
                        .filter((c) => laneOf(c) === track.id && selectedClipIds.includes(c.id))
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
                                wideEnoughForHandles(c) ? " - var(--clip-handle-hit-w)" : ""
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
        {/* ⚠️ **列を足すのは「並び」の欄の中で**（#767・利用者要望）＝欄だけを見ていると列を足せず、
            欄の外を探しに行くことになっていた。**同じ操作を2か所に置かない**ので画面下部からは外す
            （`06 §2` 統一規約5 の流儀）。 */}
        <div className="row gap-sm mt-md">
          <button className="btn btn-secondary" onClick={() => addTrack(TRACK_KIND.visual)} {...busyGuard()}>映像の列を足す</button>
          <button className="btn btn-secondary" onClick={() => addTrack(TRACK_KIND.audio)} {...busyGuard()}>音の列を足す</button>
        </div>
      </>
    ) },
    { id: PANEL_ID.selected, title: '選んだ部品', content: (
      <>
        {selected ? (
          <>
            <p className="text-muted">
              {clipLabel(selected)}（{selected.startSec.toFixed(1)}秒から{selected.durationSec.toFixed(1)}秒間）
            </p>
            {/* ⚠️ **知らせは節の外に出す**（レビュー 🟡・#705 と同じ理由）＝節を畳んだ記憶は既定より
                優先されるので、中に置くと**一度畳んだ人には二度と見えない**。
                ・音が入っていない動画（#512 段2）＝欄を出さずにその場で理由を出す（§2-5）
                ・実映像にできないとき（まとまりのフェード中・回した切り抜き）＝黙って静止画に見せない */}
            {selected.assetId != null && videoAssetIdSet.has(selected.assetId) && (
              <>
                {/* 元の音（#512 段2）＝**鳴らせない動画にはその場で理由を出す**（§2-5）。
                    欄を出す条件は domain の `canUseOriginalAudio` と同じ＝押せるのに断られる、を作らない。 */}
                {doc && videoAudioState(doc, selected) === "none" && (
                  <p className="field-hint">{TIMELINE_VIDEO_NO_AUDIO}</p>
                )}
                {doc && videoAudioState(doc, selected) === "unknown" && (
                  <p className="field-hint">{TIMELINE_VIDEO_AUDIO_UNKNOWN}</p>
                )}
              </>
            )}
            {/* ⚠️ **実映像にできない理由は、置き場所を問わず出す**（レビュー 🟡）＝差し込み口の動画でも
                起きるので、直接置いた動画のときだけ出していると**理由なしで静止**する。 */}
            {videoPlay.some((v) => v.clip.id === selected.id && v.held === "groupFade") && (
              <p className="field-hint">{TIMELINE_VIDEO_STILL_IN_GROUP_FADE}</p>
            )}
            {videoPlay.some((v) => v.clip.id === selected.id && v.held === "rotatedCrop") && (
              <p className="field-hint">{TIMELINE_VIDEO_STILL_ROTATED_CROP}</p>
            )}
            {videoPlay.some((v) => v.clip.id === selected.id && v.held === "unplayable") && (
              <p className="field-hint">{TIMELINE_VIDEO_STILL_UNPLAYABLE}</p>
            )}
            {/* ⚠️ **動く量を画面から分かるようにする**（#819-3）＝ボタンの名前だけでは 0.5秒 刻みだと
                分からず、押してみるまで結果が読めない（数値の欄と併用する前提の操作なので、量が要る）。 */}
            <div className="row gap-sm">
              <button className="btn btn-secondary" onClick={() => moveSelectedClip({ startSec: selected.startSec - NUDGE_SEC })} {...editGuard({ hint: `${NUDGE_SEC}秒ずつ前へ動かします` })}>
                前へ
              </button>
              <button className="btn btn-secondary" onClick={() => moveSelectedClip({ startSec: selected.startSec + NUDGE_SEC })} {...editGuard({ hint: `${NUDGE_SEC}秒ずつ後ろへ動かします` })}>
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
              {/* **ここで分ける**（決定16）＝再生位置×選んだ帯。`Ctrl+K` と同じ入口（決定19＝キーだけにしない）。 */}
              <button
                className="btn btn-secondary"
                onClick={() => splitSelectedClip(playheadSec)}
                {...splitGuard}
                title={splitGuard.title ?? "選んだ部品を再生位置で分けます（Ctrl+K）"}
              >
                ここで分ける
              </button>
              <button className="btn btn-secondary" onClick={duplicateSelectedClip} {...editGuard(duplicateExtra())}>{DUPLICATE_LABEL}</button>
              <button className="btn btn-danger" onClick={requestRemoveSelected} {...(removeGuard ?? {})} title={removeGuard?.title ?? "選んだ部品を削除します（Delete）"}>{DELETE_LABEL}</button>
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
                {/* ⚠️ **掴めない理由をここで出す**（#746-4）＝キャンバスでは動きの効いている部品を掴ませない
                    （掴んだ量は下の数値へ書き戻るので、動きのぶんだけ絵が飛ぶ）。**触れる先を必ず示す**
                    ＝理由だけ出して行き止まりにしない（決定5）。 */}
                {selectedHoldReason && (
                  <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                    {/* ⚠️ 言い方は**まとめて動かしたときと同じ関数**から採る（#788-1）＝2か所に持つと片方だけ直る。 */}
                    {canvasHoldMessage(selectedHoldReason)}
                    {selected.kind === TIMELINE_CLIP_KIND.text ? "（文言は「中身」で直せます）" : ""}
                  </p>
                )}
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
                行き先（「中身をバラす」）は実在するので、次の行動として名指しする（§2-5・決定8）。
                ⚠️ **名指しできるのは、そのボタンが実在するときだけ**（#812）＝見た目パターンが
                見つからないと「中身をバラす」は描かれない（下の節が代わりに理由を出す）ので、
                ここで名指しすると**どこにも無いボタンを探させる**うえ、下の「見つかりません」と
                食い違う2つの案内が並ぶ。未解決のときは下の案内だけに委ねる。 */}
            {selected.kind === TIMELINE_CLIP_KIND.template && selectedTemplate && (
              <p className="text-sm text-muted">
                この部品は見た目パターンの枠そのものです。中の位置や大きさを変えるには「中身をバラす」を使ってください。
              </p>
            )}

            {/* ⚠️ **名前を分ける**（#819-3）＝「置く列」は下の置く欄でも使っており、**次に置く先**と
                **この部品が載っている列**の2つの意味で同じ言葉を使っていた（読むほうは区別できない）。 */}
            <label className="field">
              <span>載っている列</span>
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
                    {/* ⚠️ **選ぶ欄も `label`**（#802-2）＝目録自身が「`label`/`note` は選択UI・
                        `title`/`artist` は About 専用」と定めている。置く欄・帯の名前も `label` なので、
                        ここだけ原題だと**同じ物が画面内で別の名**になる（ADR-0026②）。 */}
                    {BGM_CATALOG.map((b) => (
                      <option key={b.id} value={`bgm:${b.id}`}>{b.label}</option>
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
            {/* 動画の**元の音**（#512 段2）＝音のクリップとは別の欄（対象も値も別物なので混ぜない）。
                音量の変化・前後のフェードは段2 の対象外＝**欄を出さない**（出しておいて効かない、を作らない）。 */}
            {doc && canUseOriginalAudio(doc, selected) && (
              <CollapsibleSection scope={SECTION_SCOPE.timeline} storageKey="originalAudio" title="この動画の音" defaultOpen={true}>
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={selected.useOriginalAudio === true}
                    {...editGuard()}
                    onChange={(e) => setSelectedClipUseOriginalAudio(e.target.checked)}
                  />
                  <span>この動画に入っている音を流す</span>
                </label>
                <NumberField
                  label="音量"
                  step={VOLUME_STEP}
                  min={VOLUME_MIN}
                  max={VOLUME_MAX}
                  value={selected.originalAudioVolume ?? null}
                  placeholder={`標準（${Math.round(ORIGINAL_AUDIO_VOLUME * 100)}%）`}
                  {...editGuard()}
                  onChange={(v) => setSelectedClipOriginalAudioVolume(v)}
                  onClear={() => setSelectedClipOriginalAudioVolume(null)}
                />
              </CollapsibleSection>
            )}
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
                      // ⚠️ 見るのは**走っている回**（`voiceRunning`）＝印（`generatingVoiceClipId`）は
                      // 開き直しで消えるので、それだけだと**押せる見た目なのに無反応**になる
                      // （関門は回を見て即 return する・#757 レビュー）。押せない理由を無言にしない（§2-5）。
                      disabled: !selected.voice?.text.trim() || voiceRunning,
                      hint: !selected.voice?.text.trim()
                        ? "読み上げる文を入れてください"
                        : voiceRunning
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
                        {/* いま入っているが選び直せないもの（種別の合わない素材）は、名前だけ出す＝「なし」と見分けが付く。 */}
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
                            ? "入れられる動画がありません。「写真・動画を取り込む」で動画を取り込んでください。"
                            : "入れられる写真がありません。「素材・文字・図形を置く」の欄で写真を取り込んでください。"}
                        </span>
                      )}
                      {/* その枠に入れた動画の**元の音**（#512 段3b）。直接置きの「この動画の音」と同じ形
                          ＝同じ概念を枠によって別の言い方にしない（ADR-0026②）。
                          ⚠️ **音の入った動画が入っている枠にだけ出す**＝押せない欄を並べない。
                          音が無い／確かめられない枠には、直接置きと同じ2文で理由を出す（§2-5）。 */}
                      {(() => {
                        const p = slotPlacements.find((x) => x.layerId === layer.id);
                        if (!p) return null;
                        const state = placementAudioState(doc, p);
                        if (state === "none") return <span className="field-hint">{TIMELINE_VIDEO_NO_AUDIO}</span>;
                        if (state === "unknown") return <span className="field-hint">{TIMELINE_VIDEO_AUDIO_UNKNOWN}</span>;
                        return (
                          <>
                            <label className="toggle-row">
                              <input
                                type="checkbox"
                                checked={p.useOriginalAudio}
                                {...editGuard()}
                                onChange={(e) => setSelectedClipSlotAudio(layer.id, { useOriginalAudio: e.target.checked })}
                              />
                              <span>この動画に入っている音を流す</span>
                            </label>
                            <NumberField
                              label="音量"
                              step={VOLUME_STEP}
                              min={VOLUME_MIN}
                              max={VOLUME_MAX}
                              value={selected.slotClips?.[layer.id]?.originalAudioVolume ?? null}
                              // ⚠️ 空欄＝**継承**なので、継承したときに実際に鳴る音量を出す
                              // （定数を出すと、素材側で決めた音量を隠して嘘の目安になる）。
                              placeholder={`指定なし（${Math.round(p.originalAudioVolume * 100)}%）`}
                              {...editGuard()}
                              onChange={(v) => setSelectedClipSlotAudio(layer.id, { originalAudioVolume: v })}
                              onClear={() => setSelectedClipSlotAudio(layer.id, { originalAudioVolume: null })}
                            />
                          </>
                        );
                      })()}
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
                /* ⚠️ **「読み込み直す」は名指ししない**（#812）＝見た目パターンを読み直す操作は
                   画面のどこにも無く（起動時に一度だけ）、自作のものを消した場合は読み直しても
                   戻らない＝**実行できない／効果の無い行動**になる（§2-5）。消して置き直す側だけを出す
                   （削除のボタンは選んでいれば必ず出る）。 */
                <p className="notice notice-warn" role="alert">
                  この部品の見た目パターンが見つかりません。この部品を消して、置き直してください。
                </p>
              )
            )}
          </>
        ) : (
          <p className="text-muted">
            {selectedClipIds.length > 1
              ? "1つだけ選ぶと、位置や長さを変えられます（まとめて削除することはできます）。"
              : "下の並びから部品を選ぶと、位置や長さを変えられます。"}
          </p>
        )}
        {selectedClipIds.length > 1 && (
          <button className="btn btn-danger" onClick={requestRemoveSelected} {...(removeGuard ?? {})} title={removeGuard?.title ?? "選んだ部品をまとめて削除します（Delete）"}>選んだ{selectedClipIds.length}個を{DELETE_LABEL}</button>
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
            {/* ⚠️ **どこへ入るかを見せる**（#771(b)）＝見た目パターン・音・読み上げの欄には在るのに
                ここだけ無く、**暗黙にどこかの列**へ入っていた（なぜそこに入ったのか読めない）。
                既定は「いちばん手前の置ける列」＝欄に出ている列が実際に置く列（表示と結果を割らない）。 */}
            <label className="field">
              <span>置く列</span>
              <select className="select" value={visualTrackId} onChange={(e) => setPlaceTrackId(e.target.value)}>
                {placeableTracks.map((t) => (
                  <option key={t.id} value={t.id}>{trackLabel(doc.tracks, t.id)}</option>
                ))}
              </select>
            </label>
            <div className="row gap-sm">
              {/* **押すと再生位置へ・つかんで運ぶと落とした所へ**（ADR-0034 決定2＝両方）。
                  掴めない環境・人のために、押すだけの道は必ず残す（決定19）。 */}
              <button
                className="btn btn-secondary grabbable"
                {...busyGuard({ disabled: isPlaying, hint: playingHint })}
                onPointerDown={(e) => grabToPlace(e, { kind: TIMELINE_CLIP_KIND.text }, clipLabel({ kind: TIMELINE_CLIP_KIND.text }), (at, center) =>
                  addVisualClip({ kind: TIMELINE_CLIP_KIND.text, at, center, trackId: visualTrackId }))}
                onClick={(e) => onKeyActivate(e, () => addVisualClip({ kind: TIMELINE_CLIP_KIND.text, trackId: visualTrackId }))}
              >
                文字を置く
              </button>
              <button
                className="btn btn-secondary grabbable"
                {...busyGuard({ disabled: isPlaying, hint: playingHint })}
                onPointerDown={(e) => grabToPlace(e, { kind: TIMELINE_CLIP_KIND.shape }, clipLabel({ kind: TIMELINE_CLIP_KIND.shape }), (at, center) =>
                  addVisualClip({ kind: TIMELINE_CLIP_KIND.shape, at, center, trackId: visualTrackId }))}
                onClick={(e) => onKeyActivate(e, () => addVisualClip({ kind: TIMELINE_CLIP_KIND.shape, trackId: visualTrackId }))}
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
                onGrab={(e, assetId) => grabToPlace(
                  e,
                  { kind: TIMELINE_CLIP_KIND.slot, assetId },
                  doc.assets.find((a) => a.assetId === assetId)?.displayName ?? clipLabel({ kind: TIMELINE_CLIP_KIND.slot }),
                  (at, center) => addVisualClip({ kind: TIMELINE_CLIP_KIND.slot, assetId, at, center, trackId: visualTrackId }),
                )}
                onPick={(assetId) => addVisualClip({ kind: TIMELINE_CLIP_KIND.slot, assetId, trackId: visualTrackId })}
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
              onGrab={(e, templateId) => {
                const t = placeableTemplates.find((x) => x.templateId === templateId);
                if (!t) return;
                grabToPlace(e, { kind: TIMELINE_CLIP_KIND.template, template: t }, t.name, (at) =>
                  placeTemplate(t, at));
              }}
              onPick={(templateId) => {
                const t = placeableTemplates.find((x) => x.templateId === templateId);
                if (!t) return;
                placeTemplate(t);
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
              onGrab={(e, id) => {
                const src = audioSourceOf(id);
                if (!src) return;
                grabToPlace(e, { kind: TIMELINE_CLIP_KIND.audio, ...src.spec }, src.label, (at) =>
                  placeAudio(src.spec, at));
              }}
              onPick={(id) => {
                const src = audioSourceOf(id);
                if (!src) return;
                placeAudio(src.spec);
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
              {/* 掴めるものは手を出す前に分かる（`grabbable`＝文字・図形のボタンや帯と同じ見た目・#714）。 */}
              <button
                className="btn btn-secondary grabbable"
                {...busyGuard({ disabled: isPlaying, hint: playingHint })}
                onPointerDown={(e) => grabToPlace(e, { kind: TIMELINE_CLIP_KIND.voice }, clipLabel({ kind: TIMELINE_CLIP_KIND.voice }), (at) =>
                  addVoiceClip({ text: "", trackId: at?.trackId ?? audioTrackId, startSec: at?.startSec ?? playheadSec }))}
                onClick={(e) => onKeyActivate(e, () => addVoiceClip({ text: "", trackId: audioTrackId, startSec: playheadSec }))}
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
      <PageHead
        title={doc.projectName}
        // 見出しごと貼り付ける（#774）＝この画面の見出しはスクロールする側の中にあるので、
        // 印を付けないと欄を伸ばして下へ動かした時点でツールバーごと消える（＝直した意味がなくなる）。
        sticky
        actions={(
          <EditorToolbar
            undo={{ canUndo: history.past.length > 0, canRedo: history.future.length > 0, onUndo: undo, onRedo: redo, disabled: exporting }}
            // 自動保存の結果を**この画面が**出す（#693）。共通トップバーの保存ボタンは出さない決定
            // （ADR-0032）なので、ここが唯一の担い手＝黙って落とすと「閉じても消えない」（`06 §12.1`）が破れる。
            // ⚠️ 以前は**欄の下**だった（#774 で移設）＝欄が画面の高さを超えるとスクロールしないと見えず、
            // 失敗したまま気づけなかった。同じものを2か所に置かない（`06 §2` 統一規約5）。
            status={saveStatus === "error" ? (
              // 失敗は**いつも見える所**で知らせ、その場に次の行動を置く（`15 §6` TIMELINE_SAVE_FAILED）。
              <span className="row gap-sm" role="alert" style={{ alignItems: "center" }}>
                <span className="text-sm" style={{ color: "var(--color-danger)" }}>{TIMELINE_SAVE_FAILED_MESSAGE}</span>
                <button className="btn btn-secondary btn-sm" onClick={() => void saveTimelineProject()}>保存し直す</button>
              </span>
            ) : (
              // 保存できたことも控えめに出す（「勝手に保存されている」を信じられるようにする）。
              <span className="text-sm text-muted" role="status">{timelineSaveStatusLabel(saveStatus)}</span>
            )}
            back={{
              // 書き出し中に別の動画へ移ると、描いている途中の素材や音が入れ替わる（混ざった動画が出る）。
              label: <><ArrowLeftIcon size={16} />{leaving ? "保存しています…" : "動画の一覧へ"}</>,
              onClick: () => void leaveToHome(),
              disabled: exporting || leaving,
              title: exporting ? "書き出しが終わってから戻れます" : undefined,
            }}
          />
        )}
      />

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
          message={`選んだ${confirmRemove.length}個の部品を削除しますか？`}
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
          message={`「${trackLabel(doc.tracks, removingTrackId)}」を削除しますか？この列に置いてある${clipCountOnTrack(doc, removingTrackId)}個の部品も一緒に消えます。`}
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
        （「〈欄〉を表示する」「配置を既定に戻す」）の上に乗ることが構造的に起こらない。
        囲わないと、貼り付いた知らせがそれらを覆って押せなくなる（§2-5＝戻れない状態を作らない）。
        ※ 取り消す・動画の一覧へは**見出しの行**へ移した（#774）ので、ここの列挙からは外れている。
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
            {/* 名前は掴んだ一覧に出ていたものと同じ（同じ物を画面内で別の名で呼ばない）。 */}
            {drag.label}
          </div>
        )}

        {/* **操作したその場の返事**（置けなかった理由・声を作れなかった）は**欄のすぐ下に貼り付ける**。
            下へ流すと、恒常の警告が出ているときに画面外へ落ちて**同じ操作を繰り返す**（§2-5・ADR-0026④）。
            上に積まない（編集の場所を狭めない）と、必ず気づける、を両立させるための置き方。
            ※ **その場の返事を「操作した欄の中」に出すのが本筋**（ADR-0034 決定10）＝段階0 で寄せる。 */}
        {(voiceError || editBlocked || leaveBlockedMessage || lockedSkipNotice) && (
          <div className="notice notice-warn timeline-flash" role="alert">
            {voiceError && <p>{voiceError}</p>}
            {editBlocked && <p>{editBlockedMessage[editBlocked]}</p>}
            {lockedSkipNotice && <p>{lockedSkipNotice}</p>}
            {leaveBlockedMessage && <p>{leaveBlockedMessage}</p>}
          </div>
        )}
      </div>

      {/* 直せば良くなる警告は、その下（出たままでも編集の邪魔をしない位置）。 */}
      {missingTemplateCount > 0 && (
        <p className="notice notice-warn" role="alert">
          見た目パターンが見つからない部品が{missingTemplateCount}個あります。その部品は動画に出ません。その部品を消して、置き直してください。
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

      <div className="row gap-sm mt-lg">
        {/* 閉じた欄は**必ず戻せる**・配置は**いつでも既定に戻せる**（ADR-0033 決定6/8＝戻れない状態を作らない）。 */}
        {closed.map((id) => (
          <button key={id} className="btn btn-secondary" onClick={() => changeLayout(addPanelToRegion(panelLayout, id, PANEL_REGION.left))}>
            「{panels.find((p) => p.id === id)?.title}」を表示する
          </button>
        ))}
        <button className="btn btn-ghost" onClick={resetLayout}>配置を既定に戻す</button>
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
