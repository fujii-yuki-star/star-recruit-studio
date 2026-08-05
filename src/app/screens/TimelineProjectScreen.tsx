import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { ScreenId } from "../data/mockData";
import { isTimelineExportBusy, useTimelineStore } from "../store/timelineStore";
import { useProjectStore } from "../store/projectStore";
import { frameTimeSec, timelineDurationSec } from "../../domain/timeline/persistence";
import { CROP_MODE, CROP_MODE_DEFAULT, EASING, TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import type { Easing, EasingSpec } from "../../domain/enums";
import { EASE_IN_OUT_APPROX_CURVE, easingCurveOf } from "../../domain/project/keyframes";
import { clipCountOnTrack } from "../../domain/timeline/edit";
import { audioSourceKeyOfClip, isAudioClip, normalizedVolumePoints } from "../../domain/timeline/audio";
import { volumePointTimeAt } from "../../domain/timeline/volumePointEdit";
import { useUndoRedoShortcuts } from "../hooks/useUndoRedoShortcuts";
import { shouldIgnoreShortcut } from "../hooks/keyboardShortcut";
import { hasEscapeOwner, useEscapeOwner } from "../hooks/escapeOwners";
import type { Template } from "../../domain/template/types";
import { useTimelinePlayback } from "../hooks/useTimelinePlayback";
import { useTimelineAudio } from "../hooks/useTimelineAudio";
import type { CropMode, TrackKind } from "../../domain/enums";
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
import { CLIP_SPEED_MAX, CLIP_SPEED_MIN, VOLUME_MAX, VOLUME_MIN, VOLUME_POINTS_MAX, VOLUME_STEP } from "../../domain/constants";
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
import { NumberField } from "../components/NumberField";
import { CollapsibleSection } from "../components/CollapsibleSection";
import { SECTION_SCOPE } from "../components/sectionOpen";
import type { ContextMenuItem } from "../components/ContextMenu";
import { PickerList } from "../components/PickerList";
import { PanelLayoutView } from "../components/layout/PanelLayoutView";
import type { PanelSpec } from "../components/layout/PanelLayoutView";
import { usePanelLayout } from "../components/layout/usePanelLayout";
import { PANEL_REGION, PANEL_SCREEN, SPLIT_DIR, addPanelToRegion, emptyLayout } from "../../domain/layout/panelLayout";

/**
 * この画面が持つ欄（配置に出てくる id の集合＝知らない欄を落とす基準）。**値集合にする**＝
 * 綴り違いで `normalizeLayout` に落とされ、**欄が黙って消える**のを防ぐ（§2-7）。
 */
const PANEL_ID = {
  preview: "preview",
  arrange: "arrange",
  selected: "selected",
  templates: "templates",
  audio: "audio",
  voice: "voice",
} as const;
const PANEL_IDS = Object.values(PANEL_ID);
import { ArrowLeftIcon } from "../components/icons";
import { clipLabel, clipRangeTitle, editBlockedMessage, exportBlockedMessage, slotLabelsFor, SUBTITLE_TEXT_FIELD_LABEL, textKeyLabel, TIMELINE_SAVE_FAILED_MESSAGE, timelineSaveStatusLabel, trackLabel, VOLUME_POINTS_OVERRIDE_HINT } from "../uiLabels";
import { templateSlotIds, usedTextKeys } from "../../domain/template/layerOps";
import { templatesForOrientation } from "../../infrastructure/templateFs";
import { ASSET_TYPE, CROP_ALIGN_X, CROP_ALIGN_Y, SLOT_TYPE } from "../../domain/enums";
import type { CropAlignX, CropAlignY } from "../../domain/enums";
import type { Asset } from "../../domain/project/types";
import type { Layer } from "../../domain/template/types";

interface TimelineProjectScreenProps {
  onNavigate: (screen: ScreenId) => void;
}

/** 編集してから自動保存するまでの待ち（ms）。連続操作のたびに書かないための間。 */
const AUTOSAVE_DELAY_MS = 800;

/** 「前へ／後ろへ」1回で動かす秒。細かすぎず粗すぎない刻み（再生位置へ寄せる操作と併用する前提）。 */
const NUDGE_SEC = 0.5;

/** 1秒あたりの表示幅（px）と、レーンの最小幅。読み取り専用タイムラインと同じ見え方に寄せる。 */
const PX_PER_SEC = 40;
const MIN_LANE_WIDTH_PX = 640;

/** 列の種別ごとの色分け（読み取り専用タイムラインの既存クラスを使い回す＝見え方を揃える）。 */
function trackClipClass(kind: TrackKind): string {
  return kind === TRACK_KIND.audio ? "timeline-clip--audio" : "timeline-clip--video";
}

/** 目盛りの間隔（秒）。短い動画で目盛りが潰れないよう、尺に応じて粗くする。 */
function tickStepSec(totalSec: number): number {
  if (totalSec <= 10) return 1;
  if (totalSec <= 60) return 5;
  return 30;
}

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
    setPlayhead, selectClip, selectClips, clearSelection, moveSelectedClip, trimSelectedClip, duplicateSelectedClip, removeSelectedClips,
    addTrack, removeTrack, moveTrackOrder, setTrackFlag, undo, redo, saveTimelineProject, saveStatus,
    isPlaying, play, pause, exportTimelineVideo, cancelTimelineExport, dismissTimelineExport,
    setSelectedClipAssetRef, setSelectedClipText, addTemplateClip, explodeClip, setSelectedSubtitleVoiceLink, setSelectedSubtitleText,
    addVoiceClip, setSelectedVoiceText, setSelectedVoiceSpeaker, generateSelectedVoice, addLinkedSubtitleClip, voiceError, generatingVoiceClipId,
    setSelectedKeyframeAt, removeSelectedKeyframe, clearSelectedKeyframes, clearKeyframesOf,
    addAudioClip, setSelectedClipSpeed, setSelectedClipSourceStart, setSelectedClipVolume, setSelectedClipFade,
    setSelectedClipCrop, setSelectedClipCropAlign, setSelectedClipCropMode,
    setSelectedVolumePoint, removeSelectedVolumePoint, clearSelectedVolumePoints,
  } = useTimelineStore();

  // 連続再生の時計（再生中だけ回る）。見せる時刻の決め方は domain（`playbackTick`）に委ねる。
  useTimelinePlayback();
  // 音は「その瞬間に鳴っているもの」を時刻から決めて鳴らす（絵と同じ時刻を見る＝ずれない）。
  useTimelineAudio();

  // 取り消し/やり直しのキー操作は**この画面の store** へ繋ぐ（既定は場面形式を巻き戻すので渡さない＝
  // 見えていない文書を戻して自動保存が永続化する事故を作らない・#547 P1-1 と同じ筋）。
  useUndoRedoShortcuts(true, { undo, redo });


  // 編集したら少し待って自動保存する（場面形式と同じ「閉じても消えない」＝ADR-0026②）。
  // 連続操作のたびに書かないよう間を置く。保存中の再編集は `saveTimelineProject` 側で見る。
  // **失敗（`error`）のときは自動で繰り返さない**＝同じ理由で失敗し続ける間ディスクを叩き続けても直らないので、
  // 画面に理由と「保存し直す」を出して利用者に返す（#693・§2-5）。次の編集で `idle` に戻れば自動保存も再開する。
  const saveTimer = useRef<number | null>(null);
  useEffect(() => {
    if (saveStatus !== "idle") return;
    if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void saveTimelineProject(), AUTOSAVE_DELAY_MS);
    return () => {
      if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
    };
  }, [saveStatus, saveTimelineProject]);
  // **画面を離れるときは、待っている保存を書き切る**（#693）。自動保存のタイマはこの画面のものなので、
  // 書くより前に離れると上の後始末でタイマごと消え、直前の編集が**無言で**失われていた（サイドバーからの
  // 移動も同じ）。場面形式は自動保存が常時ある層に載っていてこの穴が無い＝形式で挙動を割らない（ADR-0026②）。
  // 依存を持たない effect にして**アンマウントのときだけ**走らせる（張り直しのたびに保存しない）。
  useEffect(() => () => {
    if (useTimelineStore.getState().saveStatus === "idle") void useTimelineStore.getState().saveTimelineProject();
  }, []);
  const templates = useProjectStore((s) => s.templates);
  // テンプレが持つ既定素材（ADR-0021）は全プロジェクト共通の置き場にある＝場面形式のプレビュー・書き出しと
  // 同じフォールバック（素材 → テンプレ既定素材）を通す。無いと同じ見た目が場面形式と違う絵になる（ADR-0026②）。
  const templateAssetSrcById = useProjectStore((s) => s.templateAssetSrcById);

  const [removingTrackId, setRemovingTrackId] = useState<string | null>(null);
  // 保存できていないまま一覧へ戻ろうとしているか（#693）。戻ると変更は失われるので、黙って捨てずに聞く。
  const [confirmLeave, setConfirmLeave] = useState(false);
  // 戻る前の保存を待っているか（#693 レビュー）。待っている間は二重に押せないようにする。
  const [leaving, setLeaving] = useState(false);
  /**
   * 一覧へ戻る（#693）。**保存が済むまで待ってから**離れる＝書いている途中（`saving`）に離れると、
   * そのあと失敗しても利用者はもう別の画面にいて気づけない（確認も出ない）。
   * 失敗していたら離れずに確認を出す＝「保存し直す」を押しに戻れる。
   */
  const leaveToHome = useCallback(async () => {
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
    if (useTimelineStore.getState().saveStatus === "error") {
      setConfirmLeave(true);
      return;
    }
    onNavigate("home");
  }, [onNavigate]);
  // 見た目パターンを置く先の列（消された/固定されたときは置くときに実在するものへ落とす）。
  const [placeTrackId, setPlaceTrackId] = useState<string>("");
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
  }, [selectedKey]);
  // 右クリック（または「⋮」）で開く列の操作メニュー（ADR-0033）。
  const [trackMenu, setTrackMenu] = useState<{ trackId: string; x: number; y: number } | null>(null);

  // 欄の配置（ADR-0033 段階2）。**既定は「再生位置と『選んだ部品』が同時に見える」形**にする
  // ＝#512 の実機確認で露呈した「1点置くごとに上下スクロール」を、設定を変えないままでも起こさない。
  const defaultLayout = useMemo(() => {
    const l = emptyLayout();
    l.nodes.center = { panelId: PANEL_ID.preview };
    l.nodes.right = { panelId: PANEL_ID.selected };
    l.nodes.bottom = { panelId: PANEL_ID.arrange };
    l.nodes.left = {
      dir: SPLIT_DIR.column,
      sizes: [1 / 3, 1 / 3, 1 / 3],
      children: [{ panelId: PANEL_ID.templates }, { panelId: PANEL_ID.audio }, { panelId: PANEL_ID.voice }],
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
  const overlayOpen = exploding !== null || removingTrackId !== null || confirmLeave;
  useEscapeOwner(overlayOpen);

  // 選択のキー操作（ADR-0034 決定15/18）。**入力欄と日本語の変換中は奪わない**（共有の判定を通す）。
  // `Escape`＝選択を解く／`Ctrl+A`＝全部選ぶ。**ドラッグ専用の操作を作らない**（決定19）ための土台でもある。
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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        // 対象が無くても**既定の全選択には落とさない**（同じキーの結果が2通りになる＝画面の文字が反転する）。
        e.preventDefault();
        const ids = useTimelineStore.getState().doc?.clips.map((c) => c.id) ?? [];
        if (ids.length > 0) selectClips(ids);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clearSelection, selectClips, overlayOpen]);
  const totalSec = doc ? timelineDurationSec(doc) : 0;
  // 1つだけ選んでいるときが「動かせる」状態（複数選択はまとめて消すだけ＝対象が決まらない）。
  const selected = doc && selectedClipIds.length === 1 ? doc.clips.find((c) => c.id === selectedClipIds[0]) : undefined;
  const layout = useMemo(() => {
    if (!doc) return null;
    const byId = new Map(templates.map((t) => [t.templateId, t]));
    // 末尾ちょうどは1フレーム手前へ寄せる（半開区間で画面が真っ白になるのを防ぐ・`frameTimeSec`）。
    return layoutTimelineAt(doc, frameTimeSec(doc, playheadSec), { templateOf: (id) => byId.get(id), assetSizeOf: (id) => assetSizes[id] });
  }, [doc, playheadSec, templates, assetSizes]);

  // 素材の**実寸**を測る（#634）。「枠いっぱいに映す」は素材の縦横比が要るが、保存データには
  // 絵の大きさが無い（動画だけ持っている）ので、表示に使っている src をブラウザで測って store へ入れる。
  // 測れたら描き直す＝プレビューと書き出しが同じ値を見る（ADR-0001）。
  useEffect(() => {
    let alive = true;
    for (const [assetId, src] of Object.entries(assetSrcById)) {
      if (assetSizes[assetId] || !src) continue;
      const img = new Image();
      img.onload = () => {
        if (alive && img.naturalWidth > 0 && img.naturalHeight > 0) {
          setAssetSize(assetId, { w: img.naturalWidth, h: img.naturalHeight });
        }
      };
      // 測れないもの（動画など）は入れない＝そのクリップは「辺を隠す」表示のまま（画面が理由を出す）。
      img.src = src;
    }
    return () => {
      alive = false;
    };
  }, [assetSrcById, assetSizes, setAssetSize]);

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
  const placeableTracks = doc?.tracks.filter((t) => t.kind === TRACK_KIND.visual && !t.locked && !t.hidden) ?? [];
  // 読み上げを置ける列（音の列）。
  // この動画が持っている音の素材（焼き出しで運ばれたものなど）。
  const audioAssets = doc?.assets.filter((a) => a.assetType === ASSET_TYPE.bgm) ?? [];
  // 隠した列は動画に出ない／鳴らないので、置き先の候補に出さない（置けるのに出ない、を作らない）。
  const voiceTracks = doc?.tracks.filter((t) => t.kind === TRACK_KIND.audio && !t.locked && !t.hidden) ?? [];
  // 置き場所や音の出どころの取り違え（11 §8 V22–V28）。描画から外れるものもあるので必ず見せる。
  const warnings = useMemo(() => (doc ? validateTimelineDoc(doc) : []), [doc]);
  // 書き出せない理由（`timelineExportBlockers`）は**押す前に**見せる＝押しても断られるだけ、を作らない（§2-5）。
  const exportBlockers = useMemo(
    // 見た目の未解決も理由になる（描かれないものを黙って落とした動画を成功にしない・ADR-0026④）。
    () => (doc ? timelineExportBlockers(doc, { knownTemplateIds: new Set(templates.map((t) => t.templateId)) }) : []),
    [doc, templates],
  );
  const exporting = isTimelineExportBusy(exportRun.phase);
  // 音が見つからない部品は**鳴らない**（読み上げ未作成・音源の読み込み失敗）。黙って無音にしない（§2-5）。
  const missingAudioCount = useMemo(() => {
    if (!doc) return 0;
    return doc.clips.filter((c) => {
      if (c.kind !== TIMELINE_CLIP_KIND.voice && c.kind !== TIMELINE_CLIP_KIND.audio) return false;
      const key = audioSourceKeyOfClip(c);
      return !key || !audioSrcByKey[key];
    }).length;
  }, [doc, audioSrcByKey]);

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
  // 書き出し中の編集は store が断る（`TIMELINE_EDIT_EXPORTING`）。**押してから断るのではなく、押す前に理由を出す**
  // （#694・監査 §2.2-11＝事前 disabled の流儀に統一）。押せてしまうと、断られた入力を消さない配慮も要らぬ手戻りになる。
  const exportingHint = exporting ? "書き出しが終わってから編集できます" : undefined;
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

  // 列の操作（順番・出す出さない・固定・消す）は**右クリックのメニュー**へ畳む（ADR-0033・利用者指摘 2026-08-03）。
  // 行にボタンを並べると帯より文字のほうが目立ち、並びが読めなくなる。項目名は**いまの状態で意味が通る言い方**にする。
  const openTrackMenu = (e: ReactMouseEvent, trackId: string): void => {
    e.preventDefault();
    setTrackMenu({ trackId, x: e.clientX, y: e.clientY });
  };
  const menuTrack = trackMenu ? doc?.tracks.find((t) => t.id === trackMenu.trackId) : undefined;
  const trackMenuItems: ContextMenuItem[] = menuTrack
    ? [
        { label: "手前へ", onSelect: () => moveTrackOrder(menuTrack.id, "front") },
        { label: "奥へ", onSelect: () => moveTrackOrder(menuTrack.id, "back") },
        {
          label: menuTrack.hidden ? "動画に出す" : "動画に出さない",
          onSelect: () => setTrackFlag(menuTrack.id, "hidden", !menuTrack.hidden),
        },
        {
          label: menuTrack.locked ? "固定を外す" : "動かせないように固定する",
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
  const step = tickStepSec(totalSec);
  const ticks = Array.from({ length: Math.floor(totalSec / step) + 1 }, (_, i) => i * step);
  // 時間 → 画面上の長さ。短い動画でも列が潰れないよう下限を置く（横スクロールは既存 CSS が持つ）。
  const pxPerSec = totalSec > 0 ? Math.max(MIN_LANE_WIDTH_PX / totalSec, PX_PER_SEC) : PX_PER_SEC;
  const laneWidthPx = Math.max(totalSec * pxPerSec, MIN_LANE_WIDTH_PX);

  // 欄（ADR-0033 段階2）＝いまのカードをそのまま欄にする。**中身は変えない**（配置の仕組みだけを外から被せる）。
  const panels: PanelSpec[] = [
    { id: PANEL_ID.preview, title: '仕上がり確認', content: (
      <>
        <div className="preview-stage" dangerouslySetInnerHTML={{ __html: svg }} />
        <div className="row gap-sm">
          <button
            className="btn btn-primary"
            onClick={isPlaying ? pause : play}
            disabled={totalSec <= 0}
            title={totalSec <= 0 ? "まだ部品を置いていないので再生できません" : undefined}
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
              onClick={() => void exportTimelineVideo({ templates, templateAssetSrcById })}
              disabled={exportBlockers.length > 0 || isPlaying}
              title={exportBlockers.length > 0 ? exportBlockedMessage[exportBlockers[0].code] : playingHint}
            >
              動画を書き出す
            </button>
          )}
        </div>
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
        {doc.clips.length === 0 ? (
          <p className="text-muted">まだ何も置かれていません。</p>
        ) : (
          // 見た目は読み取り専用タイムライン（ADR-0018 ③(2)）と同じ CSS を使う＝2つの一覧で見え方が割れない（§6）。
          <div className="timeline">
            <div className="timeline-scroll">
              <div className="timeline-inner">
                <div className="timeline-row">
                  <div className="timeline-row-label" />
                  <div className="timeline-track timeline-ruler" style={{ width: laneWidthPx }}>
                    {ticks.map((t) => (
                      <span key={t} className="timeline-tick" style={{ left: `${pxPerSec * t}px` }}>
                        {t}秒
                      </span>
                    ))}
                  </div>
                </div>
                {/* 表示は**手前が上**（配列は後ろほど手前なので逆順に並べる）＝重なりの見え方と一致させる。
                    行にも解除を付けるのは、列の幅より画面が広いとき**右側にできる余白**を押しても解けるようにするため
                    ＝「何もない所を押すと解ける」の当たり判定を見た目どおりにする（#701 レビュー）。 */}
                {[...doc.tracks].reverse().map((track) => (
                  <div
                    className="timeline-row"
                    key={track.id}
                    onClick={(e) => { if (e.target === e.currentTarget) clearSelection(); }}
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
                      className="timeline-track timeline-lane"
                      style={{ width: laneWidthPx }}
                      onClick={(e) => { if (e.target === e.currentTarget) clearSelection(); }}
                    >
                      {doc.clips
                        .filter((c) => c.trackId === track.id)
                        .map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            className={`timeline-clip ${trackClipClass(track.kind)}${selectedClipIds.includes(c.id) ? " timeline-clip--selected" : ""}`}
                            style={{ left: `${pxPerSec * c.startSec}px`, width: `${pxPerSec * (clipEndSec(c) - c.startSec)}px` }}
                            // 帯は短いと文字が読めない＝**名前と時間帯を添える**。書式は場面形式の見わたす画面と
                            // **同じ関数**から採る（別々に書くと同じ概念が画面で違う見え方になる・ADR-0026②）。
                            title={clipRangeTitle(clipLabel(c), c.startSec, clipEndSec(c))}
                            onClick={(e) => selectClip(c.id, e.shiftKey)}
                          >
                            {clipLabel(c)}
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
              <button className="btn btn-secondary" onClick={duplicateSelectedClip} {...editGuard()}>同じものを足す</button>
              <button className="btn btn-danger" onClick={removeSelectedClips} {...editGuard()}>消す</button>
            </div>
            <label className="field">
              <span>置く列</span>
              <select className="select" value={selected.trackId} onChange={(e) => moveSelectedClip({ trackId: e.target.value })}>
                {doc.tracks.map((t) => (
                  <option key={t.id} value={t.id}>{trackLabel(doc.tracks, t.id)}</option>
                ))}
              </select>
            </label>

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
                        <NumberField
                          key={f.prop}
                          label={f.label}
                          step={f.step}
                          value={kfDraft[f.prop] === undefined || kfDraft[f.prop] === "" ? null : Number(kfDraft[f.prop])}
                          placeholder={String(f.neutral)}
                          {...editGuard()}
                          onChange={(v) => setKfDraft({ ...kfDraft, [f.prop]: String(v) })}
                          // 空にしたら**その項目は動かさない**（下書きから落とす）＝0 と「触っていない」を混同しない。
                          onClear={() => setKfDraft(Object.fromEntries(Object.entries(kfDraft).filter(([k]) => k !== f.prop)))}
                        />
                      ))}
                    </div>
                    <div className="row gap-sm">
                      <button
                        className="btn btn-secondary"
                        {...editGuard({ disabled: isPlaying, hint: playingHint })}
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
                  {...editGuard()}
                  onClick={() => clearKeyframesOf(g.groupId)}
                >
                  まとまりの動きを外す
                </button>
              </div>
            ))}

            {/* 音の部品は、速さ・使い始め・音量・フェードを変えられる（#634＝中位の編集）。 */}
            {selected.kind === TIMELINE_CLIP_KIND.audio && (
              <CollapsibleSection scope={SECTION_SCOPE.timeline} storageKey="audio" title="音" defaultOpen={true}>
                <label className="field">
                  <NumberField
                    label="速さ（倍）"
                    step={0.1}
                    min={CLIP_SPEED_MIN}
                    max={CLIP_SPEED_MAX}
                    value={selected.speed ?? 1}
                    {...editGuard()}
                    onChange={(v) => setSelectedClipSpeed(v)}
                  />
                </label>
                <label className="field">
                  <NumberField
                    label="素材の使い始め（秒）"
                    step={0.5}
                    min={0}
                    value={selected.sourceStartSec ?? 0}
                    {...editGuard()}
                    onChange={(v) => setSelectedClipSourceStart(v)}
                  />
                </label>
                <label className="field">
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
                </label>
                {hasVolumePoints && <p className="text-muted">{VOLUME_POINTS_OVERRIDE_HINT}</p>}
                <div className="row gap-sm">
                  <label className="field">
                    <NumberField
                      label="だんだん大きく（秒）"
                      step={0.5}
                      min={0}
                      value={selected.fadeInSec ?? 0}
                      {...editGuard()}
                      onChange={(v) => setSelectedClipFade("in", v)}
                    />
                  </label>
                  <label className="field">
                    <NumberField
                      label="だんだん小さく（秒）"
                      step={0.5}
                      min={0}
                      value={selected.fadeOutSec ?? 0}
                      {...editGuard()}
                      onChange={(v) => setSelectedClipFade("out", v)}
                    />
                  </label>
                </div>
                <p className="text-muted">
                  速さを変えても部品の長さは変わりません（置いた長さぶんに、素材のどれだけを流すかが変わります）。
                  素材が置き場所より短いときは繰り返して埋まります。
                </p>
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
                  <button className="btn btn-secondary" onClick={addLinkedSubtitleClip}>
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
                    <NumberField
                      label="この位置の音量"
                      step={VOLUME_STEP}
                      min={VOLUME_MIN}
                      max={VOLUME_MAX}
                      value={volumeDraft === "" ? null : Number(volumeDraft)}
                      {...editGuard()}
                      onChange={(v) => setVolumeDraft(String(v))}
                      onClear={() => setVolumeDraft("")}
                    />
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
                  <p className="text-muted">連動できる読み上げの部品がまだありません。</p>
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
                            ? "ここは動画を入れる場所ですが、この形式ではまだ動画を使えません。別の見た目パターンを選んでください。"
                            : "入れられる写真がありません。素材の画面で写真を取り込んでください。"}
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
          <button className="btn btn-danger" onClick={removeSelectedClips} {...editGuard()}>選んだ{selectedClipIds.length}個を消す</button>
        )}
      </>
    ) },
    // 見た目パターンは「楽をするための素材」＝一覧からそのまま置ける（ADR-0032 決定6）。
    { id: PANEL_ID.templates, title: '見た目パターンを置く', content: (
      <>
        {placeableTemplates.length === 0 ? (
          <p className="text-muted">この向きの動画に置ける見た目パターンがありません。見た目パターンを読み込んでからお試しください。</p>
        ) : placeableTracks.length === 0 ? (
          <p className="text-muted">置ける列がありません。「映像の列を足す」で列を作るか、列の固定を外してください。</p>
        ) : (
          <>
            <p className="text-muted">
              選んだ見た目パターンを、再生位置（{playheadSec.toFixed(1)}秒）から置きます。置いたあとも中身は差し替えられます。
            </p>
            <label className="field">
              <span>置く列</span>
              <select className="select" value={placeTrackId} onChange={(e) => setPlaceTrackId(e.target.value)}>
                {placeableTracks.map((t) => (
                  <option key={t.id} value={t.id}>{trackLabel(doc.tracks, t.id)}</option>
                ))}
              </select>
            </label>
            <PickerList
              items={placeableTemplates.map((t) => ({ id: t.templateId, label: t.name }))}
              disabled={isPlaying}
              disabledHint={playingHint}
              searchLabel="見た目パターンの絞り込み"
              onPick={(templateId) => {
                const t = placeableTemplates.find((x) => x.templateId === templateId);
                if (!t) return;
                addTemplateClip({
                  template: t,
                  trackId: placeableTracks.some((x) => x.id === placeTrackId) ? placeTrackId : placeableTracks[0].id,
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
          <p className="text-muted">置ける音の列がありません。「音の列を足す」で列を作るか、列の固定を外してください。</p>
        ) : (
          <>
            <p className="text-muted">再生位置（{playheadSec.toFixed(1)}秒）から置きます。置いたあとに速さ・音量を変えられます。</p>
            <PickerList
              items={[
                ...BGM_CATALOG.map((b) => ({ id: `bgm:${b.id}`, label: b.label, note: b.note })),
                ...audioAssets.map((a) => ({ id: `asset:${a.assetId}`, label: a.displayName })),
              ]}
              disabled={isPlaying}
              disabledHint={playingHint}
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
                    ? { bundledBgmId: bgm.id, trackId: voiceTracks[0].id, startSec: playheadSec }
                    : { assetId: rest, trackId: voiceTracks[0].id, startSec: playheadSec },
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
          <p className="text-muted">置ける音の列がありません。「音の列を足す」で列を作るか、列の固定を外してください。</p>
        ) : (
          <>
            <p className="text-muted">再生位置（{playheadSec.toFixed(1)}秒）から置きます。置いたあとに文を書いて声を作ります。</p>
            <div className="row gap-sm">
              <button
                className="btn btn-secondary"
                disabled={isPlaying}
                title={playingHint}
                onClick={() => addVoiceClip({ text: "", trackId: voiceTracks[0].id, startSec: playheadSec })}
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
      {confirmLeave && saveStatus === "error" && (
        <DeleteConfirm
          message="保存できていない変更があります。このまま一覧へ戻ると、その変更は失われます。戻る前に「保存し直す」を試せます。"
          confirmLabel="保存しないで戻る"
          onCancel={() => setConfirmLeave(false)}
          onConfirm={() => {
            setConfirmLeave(false);
            // 出しっぱなしの確認から戻れると、書き出し中でも画面を離れられてしまう（ボタン側と同じ条件で見る）。
            if (!exporting) onNavigate("home");
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

        {/* **操作したその場の返事**（置けなかった理由・声を作れなかった）は**欄のすぐ下に貼り付ける**。
            下へ流すと、恒常の警告が出ているときに画面外へ落ちて**同じ操作を繰り返す**（§2-5・ADR-0026④）。
            上に積まない（編集の場所を狭めない）と、必ず気づける、を両立させるための置き方。
            ※ **その場の返事を「操作した欄の中」に出すのが本筋**（ADR-0034 決定10）＝段階0 で寄せる。 */}
        {(voiceError || editBlocked) && (
          <div className="notice notice-warn timeline-flash" role="alert">
            {voiceError && <p>{voiceError}</p>}
            {editBlocked && <p>{editBlockedMessage[editBlocked]}</p>}
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
      {missingAudioCount > 0 && (
        <p className="notice notice-warn" role="alert">
          音が見つからない部品が{missingAudioCount}個あります。その部品は鳴りません。読み上げを作り直すか、音を選び直してください。
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
        <button className="btn btn-ghost" onClick={undo} disabled={history.past.length === 0}>取り消す</button>
        <button className="btn btn-ghost" onClick={redo} disabled={history.future.length === 0}>やり直す</button>
        <button className="btn btn-secondary" onClick={() => addTrack(TRACK_KIND.visual)} disabled={exporting} title={exportingHint}>映像の列を足す</button>
        <button className="btn btn-secondary" onClick={() => addTrack(TRACK_KIND.audio)} disabled={exporting} title={exportingHint}>音の列を足す</button>
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
    </div>
  );
}
