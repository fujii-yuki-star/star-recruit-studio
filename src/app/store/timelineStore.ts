// タイムライン編集プロジェクト（ADR-0032・#629）の編集状態。**場面形式とは別の文書**なので store も分ける
// （projectStore に相乗りすると、片方にしか無い概念〔場面・パート〕が混ざって両形式の不変条件が曖昧になる）。
import { create } from "zustand";
import { dimsForOrientation } from "../../domain/constants";
import { assetDisplayUrl, fileToDataUrl, importAssetByPath, importAssetBytes, importAssetFile, readAssetDataUrl } from "../../infrastructure/assetFs";
import { exceedsInlineAssetLimit, newAssetFrom } from "../../domain/asset/assetFile";
import { createAssetId } from "../../domain/project/persistence";
import { probeAndThumbVideo, reserveAssetId } from "./assetImport";
import { createExportSrcResolver, resolveExportSrcMap } from "./assetExportSrc";
import { ASSET_TOO_LARGE_PICK_SMALLER, EXPORT_BLOCKED_IMPORTING_MESSAGE, VOICE_BUSY_EXPORT_MESSAGE, IMPORT_BLOCKED_EXPORTING_MESSAGE, assetTooLargeMessage, importErrorMessage } from "../uiLabels";
import type { Asset } from "../../domain/project/types";
import { readVoiceDataUrl } from "../../infrastructure/voiceFs";
import { readBundledBgmDataUrl } from "../../infrastructure/bundledBgm";
import { audioSourceKey, audioSourcesOf } from "../../domain/timeline/audio";
import { listProjectSummaries, loadProjectDoc, saveProjectDoc } from "../../infrastructure/projectFs";
import { createProjectId } from "../../domain/project/persistence";
import { useProjectStore } from "./projectStore";
import { onProjectDeleted } from "./projectDeletion";
import type { DeletionHandoff } from "./projectDeletion";
import { createEmptyTimelineProject } from "../../domain/timeline/create";
import { validateTimelineProject } from "../../domain/validation/generated/validators.js";
import { ASSET_TYPE } from "../../domain/enums";
import type { AssetType } from "../../domain/enums";
import { parseTimelineProjectDoc, TimelineLoadError, timelineDurationSec, withUpdatedAt } from "../../domain/timeline/persistence";
import { clampTimelinePlayheadSec, playbackStartSec } from "../../domain/timeline/playback";
import type { TimelineProject } from "../../domain/timeline/types";
import type { CropAlignX, CropAlignY, CropMode, Fit, FontWeight, FreeShapeType, Orientation, TextAlign, TextKey, TrackKind } from "../../domain/enums";
import type { FontId } from "../../domain/font/fontCatalog";
import type { SourceSize } from "../../domain/timeline/cropFill";
import {
  VISUAL_CLIP_DURATION_SEC, addAudioClip, addLinkedSubtitleClip, addTemplateClip, addTrack, addVisualClip, addVoiceClip, duplicateClip, duplicateTrack,
  firstFreeStart, moveClip, placeableVisualTracks,
  setVisualClipContent,
  moveClips, moveTrackOrder, moveTrackTo, removeSelectedClipsChecked, removeTrack, setClipAssetRef, setClipBox, setClipBoxes, setClipFade, setClipSourceStart, setClipSpeed,
  setClipAudioSource, setClipCrop, setClipCropAlign, setClipCropMode, setClipOriginalAudioVolume, setClipSlotAudio, setClipText,
  setClipUseOriginalAudio, setClipVolume, setSubtitleText, setSubtitleVoiceLink, setTrackFlag, setVoiceSpeaker,
  setVoiceText, trimClip,
} from "../../domain/timeline/edit";
import { EDIT_BLOCKED } from "../../domain/timeline/edit";
import type { EditBlockedReason, EditResult } from "../../domain/timeline/edit";
import { emptyHistory, recordSnapshot, redoSnapshot, undoSnapshot } from "../../domain/project/history";
import { clearKeyframes, removeKeyframe, setKeyframe } from "../../domain/timeline/keyframeEdit";
import { clearVolumePoints, removeVolumePoint, setVolumePoint } from "../../domain/timeline/volumePointEdit";
import type { KeyframeInput } from "../../domain/timeline/keyframeEdit";
import { resolveNarrationVoice, sameSynthInput } from "../../domain/voice/voiceProvider";
import { characterForSpeaker } from "../../domain/voice/voiceCatalog";
import type { VoiceProvider } from "../../domain/voice/voiceProvider";
import { MockVoiceProvider } from "../../infrastructure/voiceProviders/mockVoiceProvider";
import { VoicevoxProvider } from "../../infrastructure/voiceProviders/voicevoxProvider";
import { importVoiceFile } from "../../infrastructure/voiceFs";
import { NARRATION_STATUS, TIMELINE_CLIP_KIND } from "../../domain/enums";
import { statusAfterVoiceFailure } from "../../domain/project/narrationStatus";
import type { NarrationStatus } from "../../domain/enums";
import type { TimelineVoice } from "../../domain/timeline/types";
import type { VoiceSettings } from "../../domain/project/types";
import type { BundledBgmId } from "../../domain/bgm/bgmCatalog";
import { explodeTemplateClip } from "../../domain/timeline/explode";
import { TIMELINE_EXPORT_BLOCK, timelineAudioRuns, timelineExportBlockers, timelineImageAssetIds } from "../../domain/timeline/export";
import { buildTimelineFrames } from "../../renderer/export/buildTimelineFrames";
import { loadExportFonts } from "../../renderer/export/loadExportFonts";
import { fontFamilyForId } from "../../domain/font/fontCatalog";
import { ExportCancelledError } from "../../renderer/export/buildExportScenes";
import { EXPORT_RUN_PHASE, exportOverallPercent } from "../../domain/export/exportProgress";
import type { ExportRunPhase } from "../../domain/export/exportProgress";
import { creditForSpeaker } from "../../domain/voice/narratorCredit";
import { getVoicevoxSpeaker } from "../../infrastructure/appSettings";
import { showSaveVideoDialog } from "../../infrastructure/dialog";
import {
  beginExport, canExport, cancelExport, clearExportFramesStage, exportVideo, listenExportProgress,
  readExportFrame, stageClipFrames, stageExportFrame,
} from "../../infrastructure/ffmpegExport";
import type { BgmRunInput } from "../../infrastructure/ffmpegExport";
import type { Template } from "../../domain/template/types";
import { exportBlockedMessage, KEPT_PREVIOUS_VOICE_SUFFIX } from "../uiLabels";
import { OTHER_EXPORT_RUNNING_MESSAGE, isOtherExportRunning, useExportLockStore } from "./exportLock";
import type { HistoryStacks } from "../../domain/project/history";
import { splitClip, SPLIT_BLOCKED_REASON } from "../../domain/timeline/split";
import { volumeAt } from "../../domain/timeline/audio";

/** 読み込めなかったときの文言（§2-5：原因でなく次の行動）。想定外も生のエラーを見せない。 */
const LOAD_FAILED_MESSAGE = "この動画を開けませんでした。一覧から選び直してください。";

// 声を作れなかったときの文言（§2-5＝次の行動／§2-3＝技術用語を出さない）。
const VOICE_FAILED_MESSAGE = "声を作れませんでした。しばらくしてから、もう一度お試しください。";
const VOICE_SAVE_FAILED_MESSAGE = "作った声を保存できませんでした。もう一度お試しください。";
/**
 * 前に作った声が**そのまま使える**ときだけ、それを添える（#755-3＝消えたと思わせない）。
 *
 * ⚠️ **条件は2つ**（`projectStore` の `joinVoiceFailure` と同じ・`11 §7.6.3`）＝**印を据え置いた**
 * かつ**鳴らす材料がある**。印を `failed` にするのに「そのまま使えます」と言うと、**古い文の声を
 * 使ってよい**と誤解させる。⚠️ ファイルの有無だけで判断していた（PR #791 レビュー 🔴）＝旧バグで
 * 作られた文書（`failed` なのに `voicePath` が残っている）を開いて再試行すると、まさにそれが出ていた。
 */
const keptVoiceSuffix = (before: NarrationStatus, voicePath: string | null | undefined): string =>
  (statusAfterVoiceFailure(before) === NARRATION_STATUS.generated && voicePath ? KEPT_PREVIOUS_VOICE_SUFFIX : "");
const VOICE_EXPORTING_MESSAGE = "いま動画を書き出しています。終わってから声を作ってください。";
const VOICE_DURATION_UNKNOWN_MESSAGE = "声の長さを測れませんでした。部品の長さは手で合わせてください。";

// 書き出しの結果の文言（§2-5＝次の行動／§2-3＝技術用語を出さない）。
const EXPORT_BUSY_OPEN_MESSAGE = "いま動画を書き出しています。終わってから、別の動画を開いてください。";
// 取り込みの最中に文書を入れ替えると、着地したときには別の動画なので**取り込んだ素材が入らない**
// （ファイルだけディスクに残る）。書き出し中と同じ形で、開く前に断る（#724・§2-5）。
const IMPORTING_OPEN_MESSAGE = "いま素材を取り込んでいます。終わってから、別の動画を開いてください。";
const IMPORTING_CREATE_MESSAGE = "いま素材を取り込んでいます。終わってから、新しい動画を作ってください。";
const EXPORT_DONE_MESSAGE = "動画を保存しました。";
const EXPORT_FAILED_MESSAGE = "動画を書き出せませんでした。しばらくしてから、もう一度お試しください。";
const EXPORT_CANCELLED_MESSAGE = "書き出しを中止しました。もう一度書き出せます。";
const EXPORT_UNSUPPORTED_MESSAGE = "この環境では動画を書き出せません。アプリから起動し直してお試しください。";

/**
 * 理由の**出どころ**（#729 レビュー）。画面は理由を2か所に出す＝**中身の理由は一覧**（`timelineExportBlockers`
 * を全件並べる）、**いまの事情は一段の知らせ**。どちらに属するかを画面側で数え上げ直すと
 * （例：`exportBlockers.length === 0` で判定する）**この関数の判定順を推測する**ことになり、
 * 順番を入れ替えた瞬間に黙って同じ文が二重に出る。**属性として返して、画面はそれに従う**。
 */
export const EXPORT_BLOCK_SOURCE = {
  /** 文書の中身が理由＝**下の一覧にも同じ文が並ぶ**（画面は重ねて出さない）。 */
  content: "content",
  /** いま始められない事情（取り込み中・声の作成中・別形式の書き出し中・この端末では書き出せない）。 */
  situation: "situation",
} as const;
export type ExportBlockSource = (typeof EXPORT_BLOCK_SOURCE)[keyof typeof EXPORT_BLOCK_SOURCE];

/** 書き出しを始められない理由（`null`＝始められる）。`phase` は場面形式と同じ扱い分け（`11 §3.5`）。 */
export type ExportStartBlock = {
  message: string;
  phase: typeof P.error | typeof P.unsupported;
  source: ExportBlockSource;
};

/**
 * **書き出しを始められるか**を1か所で見る（#718）。
 *
 * これまで store の開始チェックと画面のボタンで**条件が別々に書かれ**、画面は `timelineExportBlockers` と
 * 再生中しか見ていなかった＝取り込み中・別形式の書き出し中・この端末では書き出せない・**声を作っている最中**は
 * **押せてしまって、押してから断られていた**（#703 が場面編集で消した「押してから断る」の残り）。
 *
 * 特に**声を作っている最中**は実害が大きい＝合成が着地したときには書き出しが始まっていて `commit` が撥ねるので、
 * **作った声はファイルだけ残って文書に入らず**、その読み上げが無いままの動画が「保存しました」で終わる
 * （ADR-0026④）。場面形式は同じ入口で両方向を塞いでいる（`ExportScreen` の `startBlockedMessage`）。
 */
export function exportStartBlock(input: {
  doc: TimelineProject | null;
  isImporting: boolean;
  /** 声を作る回が走っているか（#755）。⚠️ **印ではなく回**＝印は開き直しで消える。 */
  voiceRunning: boolean;
  knownTemplateIds: Set<string>;
  otherExportRunning: boolean;
  canExportHere: boolean;
}): ExportStartBlock | null {
  const S = EXPORT_BLOCK_SOURCE;
  if (!input.doc) return null; // 開いていないときはボタン自体が無い
  if (input.isImporting) return { message: EXPORT_BLOCKED_IMPORTING_MESSAGE, phase: P.error, source: S.situation };
  // ⚠️ 見るのは**走っている回**（`voiceRunning`）＝印（`generatingVoiceClipId`）は開き直しで消えるので、
  // それだけを見ると**合成が走ったまま書き出しを始められる**（`/canon-check`）。
  if (input.voiceRunning) return { message: VOICE_BUSY_EXPORT_MESSAGE, phase: P.error, source: S.situation };
  if (input.otherExportRunning) return { message: OTHER_EXPORT_RUNNING_MESSAGE, phase: P.error, source: S.situation };
  const blockers = timelineExportBlockers(input.doc, { knownTemplateIds: input.knownTemplateIds });
  if (blockers.length > 0) return { message: exportBlockedMessage[blockers[0].code], phase: P.error, source: S.content };
  // 「この端末では書き出せない」は失敗と別（場面形式と同じ扱い＝`11 §3.5` の `unsupported`）。
  if (!input.canExportHere) return { message: EXPORT_UNSUPPORTED_MESSAGE, phase: P.unsupported, source: S.situation };
  return null;
}

export interface TimelineState {
  /** 開いている文書（未オープンは null）。 */
  doc: TimelineProject | null;
  /** 開けなかった理由（利用者向け文言）。 */
  loadError: string | null;
  /** 読み込み中（二重に開かない）。 */
  isLoading: boolean;
  /** 再生ヘッドの位置（秒）。 */
  playheadSec: number;
  /** 選んでいるクリップ（複数選択・#629）。 */
  selectedClipIds: string[];
  /** 素材の表示用 src（assetId → URL）。場面形式の `assetSrcById` と同じ役割。 */
  assetSrcById: Record<string, string>;
  /**
   * **動画の本体**の URL（assetId → URL・#512 段1）。`assetSrcById` は動画に**代表フレーム**を入れる
   * （絵として描く用）ので、実映像を流すにはこちらを使う。無い＝流せない＝静止のまま（穴を開けない）。
   */
  videoSrcById: Record<string, string>;
  /**
   * 素材の**実寸**（assetId → px・#634）。絵を測らないと分からないので**画面が測って入れる**。
   * プレビューと書き出しが同じ値を見る＝同じ絵になる（ADR-0001）。測れていない素材は入らない。
   */
  assetSizes: Record<string, SourceSize>;
  /** 測った実寸を入れる（#634）。同じ値なら何もしない＝描き直しを増やさない。 */
  setAssetSize: (assetId: string, size: SourceSize) => void;
  /**
   * 音源（**音源キー** → 再生できる URL）。**開いたときにまとめて用意する**＝鳴らす瞬間に読みに行くと
   * 頭が欠ける。キーはクリップ id ではなく**音源の中身**（`audioSourceKey`）なので、同じ曲を使う複数の
   * クリップで使い回せ、セッション中に増えたクリップ（複製）も読み直さずに鳴る。
   * 読めなかったものは入らない（その部品は鳴らない）。
   */
  audioSrcByKey: Record<string, string>;
  /** 取り消し/やり直し（ADR-0020 と同じスナップショット方式・積むのは文書そのもの）。 */
  history: HistoryStacks<TimelineProject>;
  /** 直前の操作が置けなかった理由（`15 §6` の `TIMELINE_EDIT_*`）。次の操作で消す。 */
  editBlocked: EditBlockedReason | null;
  /** 声を作れなかったときの案内（§2-5）。次に作り始めたら消す。 */
  voiceError: string | null;
  /** 素材を取り込めなかったときの案内（#712・§2-5）。閉じるまで残す。 */
  importError: string | null;
  /** 素材を取り込んでいる最中（#712）。**二重に取り込まない**＝同じ番号の素材が2つできる。 */
  isImporting: boolean;
  /**
   * 素材（写真・動画）をこの動画へ取り込む（#712）。**ファイルを取り込んでから一覧へ足す**
   * ＝失敗した素材の行を残さない。取り消しできる（文書まるごとの履歴に載る）。
   */
  addAsset: (file: File) => Promise<void>;
  /** ネイティブの「開く」で選んだパスから取り込む（バイトを JS に載せない・#712）。 */
  addAssetByPath: (path: string) => Promise<void>;
  /** 取り込みの案内を閉じる。 */
  clearImportError: () => void;
  /**
   * いま声を作っている部品（`null`＝作っていない）。**文書には持たない**＝自動保存で「作成中」が
   * 残ると、開き直しても作り直せない状態が固定される（履歴にも積まない）。
   */
  generatingVoiceClipId: string | null;
  /**
   * いま走っている「声を作る」回の番号（#755・内部）。**自分の回のときだけ**印を下ろす
   * ＝前の回が着地して、**走っている今の回の印を横取りする**のを防ぐ（横取りされると
   * 書き出しの締めが外れ、次の着地は `commit` に断られて作った声が消える）。
   */
  _voiceRun: number | null;
  /**
   * 連続入力を1つの取り消しにまとめている深さ（#708）。**保存しない**（画面の都合であって動画の中身ではない）。
   * 場面形式の `_historyGroupDepth` と同じ仕組み＝同じ概念を同じ挙動にする（ADR-0026②）。
   */
  _historyGroupDepth: number;
  /** グループ中でまだ「編集前」を記録していないか（**遅延記録**＝欄に入っただけでは履歴を消費しない）。 */
  _historyGroupPending: boolean;
  /** 連続入力の開始（文字欄の focus・ドラッグの pointerdown）。 */
  beginHistoryGroup: () => void;
  /** 連続入力の終了（blur・pointerup）。**必ず呼ぶ**＝開きっぱなしだと以後の取り消しが積まれない。 */
  endHistoryGroup: () => void;
  /** まとめを強制的に畳む（欄がフォーカス中に消えたときの保険＝`blur` が来ない）。 */
  resetHistoryGroup: () => void;
  /** 保存の状態（場面形式の `saveStatus` と同じ語彙＝同じ概念を同じ言葉で扱う）。 */
  saveStatus: "idle" | "saving" | "saved" | "error";
  /** 再生中か。時計は画面側（`useTimelinePlayback`）が回し、位置は `setPlayhead` で入る。 */
  isPlaying: boolean;
  /** 書き出しの進み具合（`06 §12.1`）。**この画面の中だけ**で持つ＝場面形式の書き出しと状態を混ぜない。 */
  exportRun: TimelineExportRun;
  /**
   * 位置を外から動かした回数。**再生中のシークを時計へ伝える**ための世代番号で、
   * `playheadSec` を effect の依存にすると effect 自身が更新して回り続けるため、これを依存にする。
   */
  seekNonce: number;

  /**
   * **完全新規のタイムラインプロジェクトを作って開く**（ADR-0032 決定7/15・#635）。
   * 作った id を返す（呼び出し側が画面を切り替える）。**未適合なら保存しない**＝開けない動画を一覧に作らない。
   */
  createTimelineProject: (projectName: string, aspectRatio?: Orientation) => Promise<string>;
  openTimelineProject: (projectId: string) => Promise<void>;
  closeTimelineProject: () => void;
  /** 消された動画を手放す（#755）＝以後どこからも書かない。走行中の印は残す。 */
  /**
   * 消された動画を手放す。**進行中の書き込みがあればその約束を返す**（#763-4）＝消す側が
   * 着地を待てるようにする（手放しても、すでに発行済みの書き込みは止まらない）。
   */
  discardDeletedProject: (projectId: string) => DeletionHandoff;
  setPlayhead: (sec: number) => void;
  selectClip: (clipId: string, additive?: boolean) => void;
  /** まとめて選ぶ（`Ctrl+A` の全選択など）。存在しない id は落とす＝消えたものを選んだままにしない。 */
  selectClips: (clipIds: string[]) => void;
  clearSelection: () => void;

  /** 選んでいるクリップを動かす（列を替える／時間をずらす）。置けなければ何も変えず理由を持つ。 */
  moveSelectedClip: (to: { trackId?: string; startSec?: number }) => void;
  /** 選んでいるクリップの端を動かす（トリム）。 */
  trimSelectedClip: (edge: "start" | "end", sec: number) => void;
  /**
   * **id で受ける**移動とトリム（#686 レビュー）。掴んで動かす経路は、掴んだ相手が `clipId` で決まる
   * のに `moveSelectedClip` は選択に効くので、**掴んでいる間に選択が変わると別の帯が動く**
   * （左ドラッグ中の右クリック・取り消しで対象が消える）。`explodeClip`／`removeClipsByIds` と同じ流儀。
   */
  moveClipById: (clipId: string, to: { trackId?: string; startSec?: number }) => void;
  /** **まとめて動かす**（#686 段階4・1つでも置けなければ全体を断る＝決定15）。 */
  moveClipsBy: (updates: readonly { id: string; startSec?: number; trackId?: string }[]) => void;
  trimClipById: (clipId: string, edge: "start" | "end", sec: number) => void;
  /** 断り文をそのまま立てる（掴む前に断るとき＝押してから断らない・#686）。 */
  setEditBlocked: (reason: EditBlockedReason) => void;
  /** 置いた部品の位置・大きさ・向き（#685）。触った時点で箱ぜんぶを書き込む＝見えている値を編集する。 */
  setSelectedClipBox: (patch: { x?: number; y?: number; w?: number; h?: number; rotation?: number }) => void;
  /**
   * **id で受ける**箱の編集（#685 後半）。キャンバスは掴んだ相手が id で決まるので、選択に効かせると
   * まとめて動かすときに別の部品が動く（`moveClipById` と同じ流儀）。
   */
  setClipBoxFor: (clipId: string, patch: { x?: number; y?: number; w?: number; h?: number; rotation?: number }) => void;
  /**
   * **id で受ける**文字の書き換え（#746-2）。キャンバスの二度押し編集は**押した相手が id で決まる**ので、
   * 選択に効かせると（打っている最中に選択が変わったとき）**別の部品の文字が書き換わる**
   *（`setClipBoxFor` と同じ流儀）。
   */
  setClipTextFor: (clipId: string, text: string) => void;
  /**
   * 選んだ帯を再生位置で分ける（#686 段階4・ADR-0034 決定16）。
   * 分けたら**後半を選び直す**（他社の型＝続きを触りたい手が自然に繋がる）。
   */
  splitSelectedClip: (atSec: number) => void;
  /** **まとめて**箱を変える（1つでも置けなければ全体を断る＝ADR-0034 決定15）。 */
  setClipBoxesFor: (updates: readonly { id: string; patch: { x?: number; y?: number; w?: number; h?: number; rotation?: number } }[]) => void;
  /** 選んでいるクリップを複製する（同じ列の直後）。 */
  duplicateSelectedClip: () => void;
  /** 選んでいるクリップを消す。 */
  removeSelectedClips: () => void;
  /**
   * **id を名指しで消す**（#721 レビュー）。まとめて消すときの確認は「聞いた時点の相手」を持つので、
   * 確認を出している間に選択が変わっても**聞いた数と消える数がずれない**（`exploding` が相手を組で
   * 持つのと同じ流儀）。`removeSelectedClips` はこれに選択を渡すだけ＝規則は1つ。
   */
  removeClipsByIds: (clipIds: readonly string[]) => void;
  /** 選んでいる見た目パターンの差し込み口に素材を入れる／外す（#632）。 */
  setSelectedClipAssetRef: (layerId: string, assetId: string | null) => void;
  /**
   * 選んでいる部品の、**指定した時刻**のキーフレームを置く／直す（#634・#262）。
   * 時刻は**対象の先頭からの秒**で、**呼ぶ側が丸めてから渡す**（#702）＝再生位置から起点を引いた生の値だと
   * `0.3-0.1=0.19999999999999998` のような端数になり、画面の照合（`keyframeTimeAt`）と食い違って
   * 「置き直したのに1つ増える」が起きる。入口はこれ1つ（素通しの入口を作らない＝音量の変化と同じ形）。
   */
  setSelectedKeyframeAt: (timeSec: number, input: KeyframeInput) => void;
  /** 選んでいる部品の、その時刻のキーフレームを外す（#634）。 */
  removeSelectedKeyframe: (timeSec: number) => void;
  /** 選んでいる部品の動きをすべて外す（#634）。 */
  clearSelectedKeyframes: () => void;
  /** 指定した対象（まとまりなど）の動きをすべて外す（#634）。 */
  clearKeyframesOf: (targetId: string) => void;
  /** 選んでいる字幕自身の文を書き換える（空にすると連動先の読み上げ文に戻る・#633）。 */
  setSelectedSubtitleText: (text: string) => void;
  /** 選んでいる字幕の連動先（読み上げ）を決める／やめる（#633）。 */
  setSelectedSubtitleVoiceLink: (voiceClipId: string | null) => void;
  /** 選んでいる見た目パターンの文字を書き換える（#632）。 */
  setSelectedClipText: (textKey: TextKey, text: string) => void;
  /** 見た目パターンの部品をバラす（中身ぶんの部品へ展開・#632）。**戻せない**（取り消しでだけ戻る）。 */
  explodeClip: (clipId: string, template: Template) => void;
  /**
   * **写真・文字・図形を置く**（#684）。置いたものは**そのまま選ぶ**＝続けて中身を直せる。
   * 置ける列が無ければ理由を出す（黙って何もしない、を作らない）。
   */
  addVisualClip: (input: {
    kind: typeof TIMELINE_CLIP_KIND.slot | typeof TIMELINE_CLIP_KIND.text | typeof TIMELINE_CLIP_KIND.shape;
    assetId?: string;
    center?: { x: number; y: number };
    /**
     * **利用者が置き場所を指したとき**（ドラッグで落とした・#684）。ここが入っていたら
     * その列・その時刻へ置き、置けなければ**断る**（寄せない・別の列へ移さない＝ADR-0034 決定10）。
     * 未指定＝アプリが決める（ボタン）＝空いている列と時刻を探す。
     */
    at?: { trackId: string; startSec: number };
    /**
     * **置く列だけを指したとき**（欄の「置く列」・#771(b)）。時刻はアプリが探す
     *（＝ボタンの約束「塞がっているときは、その次に空いている時刻へ」を保つ）。
     * 未指定＝いちばん手前の置ける列。`at` があるときは使わない（あちらが列も時刻も指している）。
     */
    trackId?: string;
  }) => void;
  /** 置いた部品の中身を直す（#684）＝写真の差し替え・文字・図形の色や形。 */
  setSelectedVisualContent: (patch: {
    text?: string; fontSize?: number; color?: string;
    fontId?: FontId | null; fontWeight?: FontWeight; textAlign?: TextAlign;
    shapeType?: FreeShapeType; fillColor?: string; assetId?: string | null; fit?: Fit;
  }) => void;
  /** 音（同梱BGM／持ち込んだ音）を置く（#634）。 */
  addAudioClip: (input: { bundledBgmId?: BundledBgmId; assetId?: string; trackId: string; startSec: number }) => void;
  /** 選んでいる音・動画の素材の再生速度（#634）。 */
  setSelectedClipSpeed: (speed: number) => void;
  /** 選んでいる素材のどこから使うか（#634）。 */
  setSelectedClipSourceStart: (sec: number) => void;
  /** 選んでいる音の音量（`null`＝動画全体に合わせる・#634）。 */
  setSelectedClipVolume: (volume: number | null) => void;
  /** 動画の**元の音を鳴らすか**（#512 段2）。 */
  setSelectedClipUseOriginalAudio: (use: boolean) => void;
  /** 元の音の音量（`null`＝標準へ戻す）。 */
  setSelectedClipOriginalAudioVolume: (volume: number | null) => void;
  /** 見た目パターンの**差し込み口ごと**の元の音（#512 段3b）。 */
  setSelectedClipSlotAudio: (layerId: string, patch: { useOriginalAudio?: boolean; originalAudioVolume?: number | null }) => void;
  /**
   * 選んでいる音の**音源を選び直す**（#695・#723）。素材が見つからないときの案内
   * 「音を選び直してください」に対応する操作＝これが無いと行き止まり（ADR-0034 決定5）。
   * 消して置き直すと速さ・音量・フェードが全部消えるので、差し替えの道を残す。
   */
  setSelectedClipAudioSource: (source: { bundledBgmId: BundledBgmId } | { assetId: string }) => void;
  /** 選んでいる部品の切り抜きの効かせ方（#634）。 */
  setSelectedClipCropMode: (mode: CropMode | null) => void;
  /** 選んでいる部品の素材の寄せ（#634）。 */
  setSelectedClipCropAlign: (patch: { x: CropAlignX | null } | { y: CropAlignY | null }) => void;
  /** 選んでいる部品の切り抜き（#634）。 */
  setSelectedClipCrop: (edge: "top" | "right" | "bottom" | "left", value: number) => void;
  /** 選んでいる音の前後のフェード（#634）。 */
  setSelectedClipFade: (edge: "in" | "out", sec: number) => void;
  /**
   * 選んでいる音の**音量の変化**（#512 段4）＝再生位置に点を置く／直す。時刻は部品の先頭からの秒で渡す
   * （画面は再生位置から引く＝動きのキーフレームと同じ流儀）。
   */
  setSelectedVolumePoint: (timeSec: number, volume: number) => void;
  /** 選んでいる音の音量の点を外す（#512 段4）。 */
  removeSelectedVolumePoint: (timeSec: number) => void;
  /** 選んでいる音の音量の変化をすべて外す（一定の音量へ戻る・#512 段4）。 */
  clearSelectedVolumePoints: () => void;
  /** 読み上げを置く（#633＝タイムライン側でも声を作れる）。 */
  addVoiceClip: (input: { text: string; trackId: string; startSec: number }) => void;
  /** 選んでいる読み上げの文を書き換える（作成済みの音声は外れる・#633）。 */
  setSelectedVoiceText: (text: string) => void;
  /** 選んでいる読み上げの話者を変える（`null`＝動画全体に合わせる・#633）。 */
  setSelectedVoiceSpeaker: (speaker: number | null) => void;
  /** 選んでいる読み上げの声を作る（VOICEVOX）。作れたら**長さを実際の尺へ合わせる**（#633）。 */
  generateSelectedVoice: () => Promise<void>;
  /** 選んでいる読み上げに連動する字幕を置く（#633）。 */
  addLinkedSubtitleClip: () => void;
  /** 見た目パターンを素材として置く（#632）。 */
  addTemplateClip: (input: { template: Template; trackId: string; startSec: number }) => void;
  addTrack: (kind: TrackKind) => void;
  removeTrack: (trackId: string) => void;
  /**
   * 列を**中身ごと**複製する（#767）。空の列だけ増やすなら「列を足す」と同じなので、
   * 中の部品も一緒に運ぶ（置けない事情は domain が理由で返す＝黙って別の結果にしない）。
   */
  duplicateTrack: (trackId: string) => void;
  moveTrackOrder: (trackId: string, direction: "front" | "back") => void;
  /** 列を**指した位置へ**動かす（#767・掴んで並べ替える）。`toIndex` は動かす前の並びでの落とし先。 */
  moveTrackTo: (trackId: string, toIndex: number) => void;
  setTrackFlag: (trackId: string, flag: "hidden" | "locked", value: boolean) => void;
  undo: () => void;
  redo: () => void;
  /** 編集内容をディスクへ書く（編集のたびに自動で走る＝閉じても消えない）。 */
  saveTimelineProject: () => Promise<void>;
  /** 再生を始める（終端にいるときは先頭から）。何も置いていない動画では始めない。 */
  play: () => void;
  /** 再生を止める（位置はそのまま＝続きから再生できる）。 */
  pause: () => void;
  /**
   * 時計が進めた位置を入れる（内部・`useTimelinePlayback` からのみ）。**`setPlayhead` と違い世代番号を
   * 上げない**＝時計自身の更新で「外から動かされた」と誤認して測り直しループに入るのを防ぐ。
   */
  _advancePlayhead: (sec: number) => void;

  /**
   * 動画（MP4）を書き出す。保存先を選ぶところから、描く→仕上げるまで。
   * **描くのに要るもの（見た目パターン・素材の src）は画面から受け取る**＝プレビューと同じ入力で描く
   * ＝見えているものがそのまま出る（ADR-0001）。
   */
  exportTimelineVideo: (deps: TimelineDrawDeps) => Promise<void>;
  /** 書き出しを止める（押した時点までの一時ファイルは片づける）。 */
  cancelTimelineExport: () => void;
  /** 完了・失敗の知らせを閉じる。 */
  dismissTimelineExport: () => void;
}

/** 描くのに要る入力（プレビューと共有＝別々に解決して食い違わせない）。 */
export interface TimelineDrawDeps {
  /** 置いてある見た目パターン（グローバル＝場面形式と同じ一覧）。 */
  templates: Template[];
  /** 見た目パターンが持つ既定素材の src（ADR-0021）。 */
  templateAssetSrcById: Record<string, string>;
}

/** 書き出しの進み具合（画面が読む）。 */
export interface TimelineExportRun {
  phase: TimelineExportPhase;
  /** 0〜100。描く段が 0〜80、仕上げが 80〜100（場面形式のバーと同じ配分＝同じ見え方）。 */
  percent: number;
  /** 結果や断りの案内（§2-5＝次の行動）。走行中は null。 */
  message: string | null;
  /** 中止を押したか（描くループが次のフレームで気づく）。 */
  cancelling: boolean;
}

/**
 * 書き出しの段。**場面形式と同じ値**（`EXPORT_RUN_PHASE`＝単一の参照元・§2-7）を使う＝
 * 同じ概念を形式ごとに別の言葉で持たない（ADR-0026②）。
 */
export type TimelineExportPhase = ExportRunPhase;

/** 走行中（押せない・二重に始めない）か。画面と store で同じ判定を使う（§6）。 */
export function isTimelineExportBusy(phase: TimelineExportPhase): boolean {
  return phase === P.preparing || phase === P.rendering || phase === P.encoding;
}

/** 声の合成（アプリ内は VOICEVOX・それ以外は Mock）。判定は場面形式（`projectStore`）と**同じ式**にする。 */
const hasTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const voiceProvider: VoiceProvider = hasTauri ? new VoicevoxProvider() : new MockVoiceProvider();

const IDLE_EXPORT: TimelineExportRun = { phase: EXPORT_RUN_PHASE.idle, percent: 0, message: null, cancelling: false };

/** 段の値の短い別名（この file 内で何度も使う＝直書きしない・§2-7）。 */
const P = EXPORT_RUN_PHASE;

/** 書き出しの持ち主（`exportLock`）。場面形式と一時ファイルの置き場を取り合わないために使う。 */
/** 書き出しの締めの持ち主（画面も同じものを見る＝#718）。 */
export const EXPORT_OWNER = "timeline" as const;

/**
 * 選び直したときに落とす「直前の操作の返事」（#701 レビュー）。前の部品で出た理由が残っていると、
 * **いま選んでいる部品の返事**に見える（`06 §12.1`＝その場の返事）。落とす先を1か所にして取りこぼさない。
 */
const CLEARED_NOTICES = { editBlocked: null, voiceError: null } as const;

/**
 * 進行中の保存の1回ぶん（#693）。**同時に2本走らせない**ための見張り。書き込みは上書き（truncate）なので、
 * 古い文書を持つ側が後着すると**ディスク上の変更が巻き戻る**。
 *
 * `again` を**この回ごとに持つ**理由＝走っている保存の「後にもう一度書く」印は、その回のものでなければ
 * ならない。1つの変数を共有すると、動画を切り替えた前後で走る2回ぶんが互いの印を消し合う。
 * （待たせるだけで「もう一度」を持たないと、保存中に足した変更が「保存しました」と言われたまま
 * **一度も書かれない**＝呼んだ側は進行中の約束を受け取って保存できたと思う。）
 */
interface SaveRun {
  promise: Promise<void>;
  again: boolean;
}
/** いま走っている保存（`null`＝走っていない）。 */
let currentSave: SaveRun | null = null;

/**
 * **開いている文書が入れ替わるときに見張りを手放す**（#693 レビュー）。前の動画の保存が返ってこないと、
 * 次に開いた動画の保存が「進行中」と誤解されて**永久に書かれない**。
 * 走っている書き込み自体は止められないが、
 * - それが**次の動画の保存状態を書き換えない**ことは `doSaveTimelineProject`（`projectId` の照合）が、
 * - それの**後始末が次の保存の見張りを外さない**ことは `currentSave === run` の照合が担保する。
 */
function releaseSaveGuard(): void {
  currentSave = null;
}

/**
 * **飛んでいる書き込み**（動画ごと・#763-4）。⚠️ `currentSave`（並走を防ぐ見張り）とは別に持つ＝
 * あちらは文書を切り替えるたびに手放す（`releaseSaveGuard`）ので、**手放した後も走り続けている
 * 書き込み**を誰も待てなくなる。消すときは「その動画の書き込みが着地したか」だけが要る。
 *
 * ⚠️ **1件だけ覚える形にしない**（#763-4 レビュー）＝この形式は文書を切り替えると**新しい書き込みを
 * すぐ許す**（見張りを外すため）ので、**2つの動画の書き込みが同時に飛びうる**。1件だけだと
 * 「A が飛んでいる最中に B の保存が始まる」で A を見失い、A を消すときに待てない
 *（場面形式は `saveInFlight` が完全に直列なのでこの非対称が無い）。
 */
const inFlightWrites = new Map<string, Set<Promise<void>>>();

/** 書き込みを「飛んでいる」に入れ、着地したら（成否を問わず）外す。 */
function trackWrite(projectId: string, promise: Promise<void>): void {
  const flying = inFlightWrites.get(projectId) ?? new Set<Promise<void>>();
  flying.add(promise);
  inFlightWrites.set(projectId, flying);
  void promise.then(
    () => { flying.delete(promise); if (flying.size === 0) inFlightWrites.delete(projectId); },
    () => { flying.delete(promise); if (flying.size === 0) inFlightWrites.delete(projectId); },
  );
}

/** その動画へ飛んでいる書き込みの**すべて**の着地（無ければ `undefined`）。 */
function writesFor(projectId: string): Promise<void> | undefined {
  const flying = inFlightWrites.get(projectId);
  if (!flying || flying.size === 0) return undefined;
  return Promise.all([...flying]).then(() => undefined);
}

/**
 * 開いていない状態（閉じる・開き直しの初期値）。**毎回新しい実体を返す**＝配列/オブジェクトを使い回すと、
 * 将来その場書き換えが入ったときに別の文書へ選択が漏れる（構造で防ぐ）。
 */
/**
 * 声を作る**回**の番号（#755）。⚠️ `emptyState` には入れない＝開き直しで 0 に戻ると、
 * まだ走っている前の回と**同じ番号**になり、印を横取りする。store の生きている間ずっと増える。
 */
let voiceRunSeq = 0;

function emptyState() {
  return {
    doc: null,
    loadError: null,
    isLoading: false,
    playheadSec: 0,
    selectedClipIds: [] as string[],
    assetSrcById: {} as Record<string, string>,
    videoSrcById: {} as Record<string, string>,
    assetSizes: {} as Record<string, SourceSize>,
    audioSrcByKey: {} as Record<string, string>,
    history: emptyHistory<TimelineProject>(),
    editBlocked: null as EditBlockedReason | null,
    voiceError: null as string | null,
    importError: null as string | null,
    isImporting: false,
    generatingVoiceClipId: null as string | null,
    _historyGroupDepth: 0,
    _historyGroupPending: false,
    saveStatus: "saved" as TimelineState["saveStatus"],
    isPlaying: false,
    seekNonce: 0,
    exportRun: IDLE_EXPORT,
  };
}

export const useTimelineStore = create<TimelineState>((set, get) => ({
  ...emptyState(),
  // ⚠️ **開き直しでも消さない**（`/canon-check`）＝`emptyState` に入れると、走っている合成が
  // 見えなくなって**書き出しを始められる**。着地は `commit` に断られ、その直後の保存が
  // **声の入っていない文書**を書く＝作った声が wav だけ残って消える。
  _voiceRun: null,

  createTimelineProject: async (projectName, aspectRatio) => {
    // 書き出し中は作らない（開く・閉じると同じ扱い＝走っている間は入力を固定・ADR-0032）。
    // 断る理由は store 側に置く（画面ごとに条件を書き分けない）。
    if (isTimelineExportBusy(get().exportRun.phase)) {
      set({ exportRun: { ...get().exportRun, message: EXPORT_BUSY_OPEN_MESSAGE } });
      throw new Error("timeline export busy");
    }
    // **取り込みの最中も作らない**（#724）＝着地したときには別の文書なので、取り込んだ素材は
    // `projectId` 違いで黙って捨てられる（ファイルだけ残る）。書き出し中と同じ扱い。
    if (get().isImporting) {
      set({ exportRun: { ...get().exportRun, message: IMPORTING_CREATE_MESSAGE } });
      throw new Error("timeline import busy");
    }
    // **採番の前に場面形式の保存を待つ**（`bakeToTimeline` と同じ流儀）。場面形式の id は保存時に初めて
    // 発行されディスクへ現れるまで一覧に出ないので、待たないと**同じ番号を二重に発行**して
    // 片方の project.json をもう片方が上書きしうる（11 §2.1）。
    await useProjectStore.getState().saveProject();
    const existing = await listProjectSummaries();
    const projectId = createProjectId(new Date(), existing.map((p) => p.projectId));
    const now = new Date().toISOString();
    const doc = createEmptyTimelineProject({ projectId, projectName, now, aspectRatio });
    // 焼き出しと同じ流儀＝**未適合なら保存しない**（一覧に出るのに開けない動画を作らない・ADR-0026④）。
    if (!validateTimelineProject(doc)) {
      console.warn("[timeline] 新規作成した内容がスキーマに未適合:", validateTimelineProject.errors);
      throw new Error("new timeline project failed schema validation");
    }
    await saveProjectDoc(projectId, JSON.stringify(doc, null, 2));
    releaseSaveGuard(); // 開くときと同じ＝前の動画の保存を引きずらない
    // 保存できたものをそのまま開く（読み直さない＝ディスクと同じ内容を持っている）。
    // **必ず `emptyState()` から作る**＝前に開いていた文書の取り消し履歴・選択・作成中の声を持ち越さない
    // （持ち越すと「新しい動画で取り消す」が**別の動画の内容**を書き戻し、自動保存がそちらを上書きする）。
    set({ ...emptyState(), doc, saveStatus: "saved" });
    return projectId;
  },
  openTimelineProject: async (projectId) => {
    // 書き出し中に別の動画を開くと、描いている途中の素材・音が入れ替わる（＝混ざった MP4 が出る）。
    // 開かずに理由を出す（§2-5）。画面側も一覧へ戻る導線を押せなくしているが、規則はここに置く。
    if (isTimelineExportBusy(get().exportRun.phase)) {
      set({ exportRun: { ...get().exportRun, message: EXPORT_BUSY_OPEN_MESSAGE } });
      return;
    }
    // **取り込みの最中も開かない**（#724）＝理由は上と同じ（着地しても入らない素材を作らない）。
    if (get().isImporting) {
      set({ exportRun: { ...get().exportRun, message: IMPORTING_OPEN_MESSAGE } });
      return;
    }
    if (get().isLoading) return;
    // **ここが本番で文書が入れ替わる場所**（一覧からは `closeTimelineProject` を経由せず直接開く）。
    releaseSaveGuard();
    set({ ...emptyState(), isLoading: true });
    try {
      const doc = parseTimelineProjectDoc(await loadProjectDoc(projectId));
      // 素材の表示用 src を解決する（動画は本体でなく代表フレーム＝場面形式の読込と同じ方針）。
      const entries = await Promise.all(
        doc.assets.map(async (a): Promise<[string, string] | null> => {
          const path = a.assetType === ASSET_TYPE.video ? a.thumbnailPath : a.filePath;
          if (!path) return null;
          const url = await assetDisplayUrl(doc.projectId, path);
          return url ? [a.assetId, url] : null;
        }),
      );
      const assetSrcById: Record<string, string> = {};
      for (const e of entries) if (e) assetSrcById[e[0]] = e[1];
      // ⚠️ **動画は本体の URL も要る**（#512 段1）＝上の `assetSrcById` は動画に**代表フレーム**を入れる
      // （絵として描く用）。仕上がり確認で実映像を流すには本体を指す必要がある＝場面形式の
      // `PreviewScreen`（`assetDisplayUrl(pid, clipRelPath)`）と同じ解き方。混ぜると
      // **穴だけ開いて何も映らない**（分割で開けた穴に静止画の URL を置くことになる）。
      const videoEntries = await Promise.all(
        doc.assets
          .filter((a) => a.assetType === ASSET_TYPE.video)
          .map(async (a): Promise<[string, string] | null> => {
            const url = await assetDisplayUrl(doc.projectId, a.filePath);
            return url ? [a.assetId, url] : null;
          }),
      );
      const videoSrcById: Record<string, string> = {};
      for (const e of videoEntries) if (e) videoSrcById[e[0]] = e[1];
      // 音源も**先に**用意する（鳴らす瞬間に読みに行くと頭が欠ける）。読めないものは黙って飛ばし、
      // その部品は鳴らない（読み込み失敗で動画全体を開けなくしない）。
      const audioEntries = await Promise.all(
        audioSourcesOf(doc).map(async (src): Promise<[string, string] | null> => {
          const url = src.voicePath
            ? await readVoiceDataUrl(doc.projectId, src.voicePath)
            : src.bundledBgmId
              ? (await readBundledBgmDataUrl(src.bundledBgmId)) ?? null
              : src.assetId
                ? await readAssetDataUrl(doc.projectId, assetPathOf(doc, src.assetId) ?? "")
                : null;
          return url ? [audioSourceKey(src), url] : null;
        }),
      );
      const audioSrcByKey: Record<string, string> = {};
      for (const e of audioEntries) if (e) audioSrcByKey[e[0]] = e[1];
      set({ doc, assetSrcById, videoSrcById, audioSrcByKey, assetSizes: {}, isLoading: false });
    } catch (e) {
      // 読込の失敗理由は文書側（TimelineLoadError）が「次の行動」つきで持っている。それ以外は既定文言。
      set({ ...emptyState(), loadError: e instanceof TimelineLoadError ? e.message : LOAD_FAILED_MESSAGE });
    }
  },

  /**
   * **消された動画を手放す**（#755）。持ったままだと、非同期の着地（声の完成・素材の取り込み）が
   * 保存して**フォルダごと作り直し、一覧へ復活する**（素材と声は消えているので開いても壊れている）。
   *
   * ⚠️ **走行中の印（`exportRun`）は残す**＝ここで初期化すると書き出し中の締めが外れ、
   * 二重に始められる。書き出しの入力は始めた時点で退避済みなので、文書を手放しても走り切る。
   */
  discardDeletedProject: (projectId) => {
    // ⚠️ **手放しても、すでに発行済みの書き込みは止まらない**（#763-4）＝その動画への書き込みが
    // 走っていれば約束を返し、消す側に着地まで待たせる。待たないと、消した**後**に `save_project` が
    // 着地して**フォルダごと作り直し**、素材と声だけ消えた動画が一覧へ戻る。
    //
    // ⚠️ **`currentSave` を見てはいけない**＝`releaseSaveGuard()` がそれを捨てるので、手放した後に
    // 読むと必ず空になる（待ちが丸ごと空振りする）。**いま開いていない動画の書き込み**（別の動画へ
    // 移った後も走っている）も待てるよう、手放しで消えない `inFlightWrites`（`writesFor`）を見る。
    const pending = writesFor(projectId);
    if (get().doc?.projectId !== projectId) return { pending }; // 開いてはいないが、書き込みは待たせる
    releaseSaveGuard();
    set({ ...emptyState(), exportRun: get().exportRun });
    // 文書はもう手放しているので、この保存は最後の `set` を `stillOpen` で見送る（#693）。
    // ⚠️ **戻す手も返す**（#763-4 レビュー🔴）＝消す前に手放すので、**消せなかったとき**に戻せないと、
    // 一覧には動画が残るのにこの画面だけ空になる（場面形式では開き直しているのに、こちらだけ
    // 取り残されていた＝同じ症状の片側だけ直した形）。
    return {
      pending,
      // ⚠️ **待っている間に別の動画を開かれていたら戻さない**（#763-4 レビュー）＝消す側の待ちは
      // このPRで意図的に長くしたので、その間に別の動画を開ける。無条件に開き直すと、
      // **いま開いている方を黙って上書きする**（§2-5）。手放したまま（空）のときだけ戻す。
      restore: () => (get().doc == null ? get().openTimelineProject(projectId) : undefined),
    };
  },

  closeTimelineProject: () => {
    // 開くときと同じ理由で、走行中は閉じない（`exportRun` ごと初期化されると書き出し中の締めが外れる）。
    if (isTimelineExportBusy(get().exportRun.phase)) return;
    releaseSaveGuard();
    set({ ...emptyState() });
  },

  // 再生ヘッドは [0, 尺] に収める＝ドラッグやキー操作で動画の外へ出ない（何も無い時刻を指さない）。
  setPlayhead: (sec) => {
    const doc = get().doc;
    if (!doc || !Number.isFinite(sec)) return; // 壊れた入力で位置を失わない
    // 再生中に位置を動かされたら、時計を測り直させる（そうしないと次のフレームで元へ戻る）。
    set({ playheadSec: clampTimelinePlayheadSec(doc, sec), seekNonce: get().seekNonce + 1 });
  },

  // 選ぶのも「次の操作」＝**前の操作の返事は落とす**（#701 レビュー）。残すと、置けなかった理由や
  // 声を作れなかった案内が**いま選んでいる部品の返事**に見える。
  selectClip: (clipId, additive = false) =>
    set((s) => {
      if (!additive) return { ...CLEARED_NOTICES, selectedClipIds: [clipId] };
      // 追加選択は「入っていれば外す」＝同じ操作で付け外しできる（複数選択の通例）。
      return {
        ...CLEARED_NOTICES,
        selectedClipIds: s.selectedClipIds.includes(clipId)
          ? s.selectedClipIds.filter((id) => id !== clipId)
          : [...s.selectedClipIds, clipId],
      };
    }),

  selectClips: (clipIds) => {
    const doc = get().doc;
    if (!doc) return;
    const exists = new Set(doc.clips.map((c) => c.id));
    // **重複も落とす**＝「選んだN個」の数え方が呼び出し側の作り方で変わらない（不変条件を store で閉じる）。
    set({ ...CLEARED_NOTICES, selectedClipIds: [...new Set(clipIds.filter((id) => exists.has(id)))] });
  },
  clearSelection: () => set({ ...CLEARED_NOTICES, selectedClipIds: [] }),

  // 連続入力を1つの取り消しにまとめる（#708）。**開始では記録しない**＝欄に入っただけ・掴んだだけでは
  // 履歴を消費しない。最初の実変更で1回だけ「編集前」を積む（場面形式と同じ遅延記録）。
  beginHistoryGroup: () =>
    set((s) => (s._historyGroupDepth === 0
      ? { _historyGroupDepth: 1, _historyGroupPending: true }
      : { _historyGroupDepth: s._historyGroupDepth + 1 })),
  endHistoryGroup: () => set((s) => ({ _historyGroupDepth: Math.max(0, s._historyGroupDepth - 1) })),
  /**
   * まとめを**強制的に畳む**（#708 レビュー）。文字欄は `blur` で閉じるが、**フォーカス中に欄が消えると
   * `blur` は来ない**（仕様）＝開きっぱなしになり、以後の取り消しが一切積まれなくなる。
   * ドラッグ側が `window` で終了を拾っているのと同じ役割を、こちらは「欄が消えうる場面」で呼んで担う。
   */
  resetHistoryGroup: () => set({ _historyGroupDepth: 0, _historyGroupPending: false }),

  moveSelectedClip: (to) => applyEdit(set, get, (doc, id) => moveClip(doc, id, to)),
  trimSelectedClip: (edge, sec) => applyEdit(set, get, (doc, id) => trimClip(doc, id, edge, sec)),
  moveClipById: (clipId, to) => applyEditTo(set, get, clipId, (doc, id) => moveClip(doc, id, to)),
  moveClipsBy: (updates) => {
    const doc = get().doc;
    if (!doc || updates.length === 0) return;
    const r = moveClips(doc, updates);
    if (r.ok) commit(set, get, r.doc);
    else set({ editBlocked: r.reason });
  },
  trimClipById: (clipId, edge, sec) => applyEditTo(set, get, clipId, (doc, id) => trimClip(doc, id, edge, sec)),
  setEditBlocked: (reason) => set({ editBlocked: reason }),
  setSelectedClipBox: (patch) =>
    applyEdit(set, get, (d, id) => setClipBox(d, id, dimsForOrientation(d.videoSettings.aspectRatio), patch)),
  setClipBoxFor: (clipId, patch) =>
    applyEditTo(set, get, clipId, (d, id) => setClipBox(d, id, dimsForOrientation(d.videoSettings.aspectRatio), patch)),
  setClipTextFor: (clipId, text) => applyEditTo(set, get, clipId, (d, id) => setVisualClipContent(d, id, { text })),
  splitSelectedClip: (atSec) => {
    const { doc, selectedClipIds } = get();
    if (!doc || selectedClipIds.length !== 1) return;
    const r = splitClip(doc, selectedClipIds[0], atSec, volumeAt);
    if (!r.ok) { set({ editBlocked: SPLIT_BLOCKED_REASON[r.reason] }); return; }
    // ⚠️ 選択の差し替えは **`commit` に載せる**（#750 レビュー）。別に `set` すると、`commit` が
    // 断ったとき（書き出し中）でも**存在しない id が選択に残り**、以後の操作が「見つかりません」で
    // 空振りする（嘘の理由）。`explodeClip` と同じ形。
    commit(set, get, r.doc, { selectedClipIds: [r.newClipId] });
  },
  setClipBoxesFor: (updates) => {
    const doc = get().doc;
    if (!doc || updates.length === 0) return;
    const r = setClipBoxes(doc, dimsForOrientation(doc.videoSettings.aspectRatio), updates);
    if (r.ok) commit(set, get, r.doc);
    else set({ editBlocked: r.reason });
  },
  duplicateSelectedClip: () => applyEdit(set, get, (doc, id) => duplicateClip(doc, id)),

  removeSelectedClips: () => get().removeClipsByIds(get().selectedClipIds),

  removeClipsByIds: (clipIds) => {
    const doc = get().doc;
    if (!doc || clipIds.length === 0) return;
    // **固定した列の部品が混ざっていたら断る**（#701 レビュー）＝`Ctrl+A` で全部選んでから消せてしまうと、
    // 固定が意味を失う。ほかの編集（動かす・複製する）が固定列を断るのと同じ扱い。
    const checked = removeSelectedClipsChecked(doc, clipIds);
    if (!checked.ok) {
      set({ editBlocked: checked.reason });
      return;
    }
    // 消した後は選択を空にする（消えたものを選んだままにしない）。
    commit(set, get, checked.doc, { selectedClipIds: [] });
  },

  setSelectedClipAssetRef: (layerId, assetId) => applyEdit(set, get, (d, id) => setClipAssetRef(d, id, layerId, assetId)),
  setSelectedClipText: (textKey, text) => applyEdit(set, get, (d, id) => setClipText(d, id, textKey, text)),
  setSelectedKeyframeAt: (timeSec, input) => applyEdit(set, get, (d, id) => setKeyframe(d, id, timeSec, input)),
  removeSelectedKeyframe: (timeSec) => applyEdit(set, get, (d, id) => removeKeyframe(d, id, timeSec)),
  clearSelectedKeyframes: () => applyEdit(set, get, (d, id) => clearKeyframes(d, id)),
  clearKeyframesOf: (targetId) => {
    const doc = get().doc;
    if (!doc) return;
    const r = clearKeyframes(doc, targetId);
    if (r.ok) commit(set, get, r.doc);
    else set({ editBlocked: r.reason });
  },

  setSelectedSubtitleText: (text) => applyEdit(set, get, (d, id) => setSubtitleText(d, id, text)),
  setSelectedSubtitleVoiceLink: (voiceClipId) =>
    applyEdit(set, get, (d, id) => setSubtitleVoiceLink(d, id, voiceClipId)),

  explodeClip: (clipId, template) => {
    const doc = get().doc;
    if (!doc) return;
    // **対象は確認したその部品**（選択ではなく id で受ける）＝確認を出したまま別の部品を選んでも、
    // 戻せない操作が別の部品に効かない。
    const r = explodeTemplateClip(doc, clipId, template);
    if (!r.ok) {
      set({ editBlocked: r.reason });
      return;
    }
    // バラした部品をまとめて選ぶ＝続けて動かせる（元の部品はもう無い）。
    const before = new Set(doc.clips.map((c) => c.id));
    commit(set, get, r.doc, { selectedClipIds: r.doc.clips.filter((c) => !before.has(c.id)).map((c) => c.id) });
  },

  setSelectedVisualContent: (patch) => applyEdit(set, get, (d, id) => setVisualClipContent(d, id, patch)),
  addVisualClip: (input) => {
    const doc = get().doc;
    if (!doc) return;
    // **指された場所へ置く**（ドラッグ）＝探さない・寄せない。置けなければ理由を出して終わり
    // （ADR-0034 決定10＝利用者が位置を指したときは勝手に別の場所へ動かさない）。
    if (input.at) {
      const r = addVisualClip(doc, { ...input, trackId: input.at.trackId, startSec: input.at.startSec });
      if (r.ok) {
        const placed = r.doc.clips[r.doc.clips.length - 1];
        // **置いた瞬間に見える**（`06 §12.1`）＝置き先が再生位置と違うときは、そこへ再生位置を移す。
        // 移さないと、塞がっていて先の時刻へ置かれたときに**仕上がり確認に何も現れない**（#684 レビュー）。
        commit(set, get, r.doc, { selectedClipIds: [placed.id], playheadSec: placed.startSec });
      } else {
        set({ editBlocked: r.reason });
      }
      return;
    }
    // 置き先は**いちばん手前の置ける列**（`11 §7.6.3`・#722）。**列をまたいでは探さない**＝
    // 奥の列の再生位置が空いていてもそちらへは置かない。手前に全画面の部品があると**その裏に入って
    // 見えない**からで、`06 §12.1` の「押して置いたときも必ず仕上がり確認に現れる」が守れなくなる
    //（再生位置を移すだけでは足りない）。代わりに時刻は後ろへずれることがある＝利用者判断で
    // 「見える」を優先した（#722・案A）。
    // **隠した列・固定した列は選ばない**（`11 §7.6.2.4`）＝置けても動画に出ない部品が黙って生まれる。
    // 条件は `placeableVisualTracks` を見る。その中身は `trackPlacementIssue`（列そのものの事情の
    // 単一の参照元）から導かれるので、1か所を断る `visualPlacementIssue` とも規則が割れない（#722）。
    const placeable = placeableVisualTracks(doc);
    // 置ける列が1本も無いときは、理由を出す（押しても何も起きない、を作らない・§2-5）。
    if (placeable.length === 0) {
      set({ editBlocked: EDIT_BLOCKED.notFound });
      return;
    }
    // 欄で選んだ列があればそれを使う（表示と結果を割らない）。無い／置けない列なら手前へ落とす
    // ＝**選び直しを強いない**（列を消した直後でも押せる・§2-5 の行き止まりを作らない）。
    const track = placeable.find((t) => t.id === input.trackId) ?? placeable[0];
    // **間の空きを飛び越さない**（#684 レビュー）＝「いちばん後ろの部品の終わり」ではなく、
    // まるごと収まる最初の空きを探す。規則は domain に置く（画面で数え直さない）。
    const startSec = firstFreeStart(doc.clips, track.id, get().playheadSec, VISUAL_CLIP_DURATION_SEC);
    const r = addVisualClip(doc, { ...input, trackId: track.id, startSec });
    if (!r.ok) {
      set({ editBlocked: r.reason });
      return;
    }
    const placed = r.doc.clips[r.doc.clips.length - 1];
    // **置いた瞬間に見える**（`06 §12.1`）＝置き先が再生位置と違うときは、そこへ再生位置を移す。
    // 移さないと、塞がっていて先の時刻へ置かれたときに**仕上がり確認に何も現れない**（#684 レビュー）。
    commit(set, get, r.doc, { selectedClipIds: [placed.id], playheadSec: placed.startSec });
  },
  addAudioClip: (input) => {
    const doc = get().doc;
    if (!doc) return;
    const r = addAudioClip(doc, input);
    if (!r.ok) {
      set({ editBlocked: r.reason });
      return;
    }
    const before = new Set(doc.clips.map((c) => c.id));
    const added = r.doc.clips.find((c) => !before.has(c.id));
    // **置いた瞬間に見える**（`06 §12.1`）＝運んで置いた先が再生位置と違うなら、そこへ移す。
    // ⚠️ 押して置くときは再生位置そのものなので何も変わらないが、**掴んで運べるようになった**ので
    // 置き先が離れうる（#714）。絵の部品は既にこうしており、揃えないと種類で流儀が割れる（ADR-0026②）。
    commit(set, get, r.doc, added ? { selectedClipIds: [added.id], playheadSec: added.startSec } : {});
  },

  setSelectedClipSpeed: (speed) => applyEdit(set, get, (d, id) => setClipSpeed(d, id, speed)),
  setSelectedClipSourceStart: (sec) => applyEdit(set, get, (d, id) => setClipSourceStart(d, id, sec)),
  setSelectedClipVolume: (volume) => applyEdit(set, get, (d, id) => setClipVolume(d, id, volume)),
  setSelectedClipUseOriginalAudio: (use) => applyEdit(set, get, (d, id) => setClipUseOriginalAudio(d, id, use)),
  setSelectedClipOriginalAudioVolume: (volume) =>
    applyEdit(set, get, (d, id) => setClipOriginalAudioVolume(d, id, volume)),
  setSelectedClipSlotAudio: (layerId, patch) => applyEdit(set, get, (d, id) => setClipSlotAudio(d, id, layerId, patch)),
  setSelectedClipAudioSource: (source) => applyEdit(set, get, (d, id) => setClipAudioSource(d, id, source)),
  setSelectedClipFade: (edge, sec) => applyEdit(set, get, (d, id) => setClipFade(d, id, edge, sec)),
  setSelectedVolumePoint: (timeSec, volume) =>
    applyEdit(set, get, (d, id) => setVolumePoint(d, id, timeSec, volume)),
  removeSelectedVolumePoint: (timeSec) => applyEdit(set, get, (d, id) => removeVolumePoint(d, id, timeSec)),
  clearSelectedVolumePoints: () => applyEdit(set, get, (d, id) => clearVolumePoints(d, id)),
  setSelectedClipCrop: (edge, value) => applyEdit(set, get, (d, id) => setClipCrop(d, id, edge, value)),
  setSelectedClipCropAlign: (patch) => applyEdit(set, get, (d, id) => setClipCropAlign(d, id, patch)),
  setSelectedClipCropMode: (mode) => applyEdit(set, get, (d, id) => setClipCropMode(d, id, mode)),
  setAssetSize: (assetId, size) => {
    const cur = get().assetSizes[assetId];
    if (cur && cur.w === size.w && cur.h === size.h) return;
    set({ assetSizes: { ...get().assetSizes, [assetId]: size } });
  },

  clearImportError: () => set({ importError: null }),

  addAsset: async (file) => {
    // 順番は場面形式と同じ（開いているか→書き出し中→取り込み中→大きさ）＝同じ状況で同じ案内が出る（ADR-0026②）。
    if (!canStartImport(set, get)) return;
    // 大容量はメモリへ展開しない（#48・A3）。**アプリの中ではここへ来ない**＝取り込みボタンが
    // ネイティブの「開く」へ回し、パスだけを受け取る経路（`addAssetByPath`）に上限は無い。
    // 次の行動は場面形式と別（この画面に「写真・動画を選ぶ」は無い＝**実行できない案内**にしない・ADR-0034 決定5）。
    if (exceedsInlineAssetLimit(file.size)) {
      set({ importError: assetTooLargeMessage(ASSET_TOO_LARGE_PICK_SMALLER) });
      return;
    }
    await runImport(set, get, file.name, async (fileName, assetType) => {
      if (assetType === ASSET_TYPE.video) {
        // 動画は base64 を経由せず生バイトで取り込む（大容量でもメモリを食わない）。
        return await importAssetBytes(get().doc!.projectId, fileName, new Uint8Array(await file.arrayBuffer()));
      }
      return await importAssetFile(get().doc!.projectId, fileName, await fileToDataUrl(file));
    });
  },

  addAssetByPath: async (path) => {
    await runImport(set, get, path, async (fileName) =>
      await importAssetByPath(get().doc!.projectId, fileName, path));
  },

  addVoiceClip: (input) => {
    const doc = get().doc;
    if (!doc) return;
    const r = addVoiceClip(doc, input);
    if (!r.ok) {
      set({ editBlocked: r.reason });
      return;
    }
    const before = new Set(doc.clips.map((c) => c.id));
    const added = r.doc.clips.find((c) => !before.has(c.id));
    // **置いた瞬間に見える**（`06 §12.1`）＝運んで置いた先が再生位置と違うなら、そこへ移す。
    // ⚠️ 押して置くときは再生位置そのものなので何も変わらないが、**掴んで運べるようになった**ので
    // 置き先が離れうる（#714）。絵の部品は既にこうしており、揃えないと種類で流儀が割れる（ADR-0026②）。
    commit(set, get, r.doc, added ? { selectedClipIds: [added.id], playheadSec: added.startSec } : {});
  },

  setSelectedVoiceText: (text) => applyEdit(set, get, (d, id) => setVoiceText(d, id, text)),
  setSelectedVoiceSpeaker: (speaker) => applyEdit(set, get, (d, id) => setVoiceSpeaker(d, id, speaker)),

  addLinkedSubtitleClip: () => {
    const { doc, selectedClipIds } = get();
    if (!doc || selectedClipIds.length !== 1) return;
    const r = addLinkedSubtitleClip(doc, selectedClipIds[0]);
    if (!r.ok) {
      set({ editBlocked: r.reason });
      return;
    }
    const before = new Set(doc.clips.map((c) => c.id));
    const added = r.doc.clips.find((c) => !before.has(c.id));
    commit(set, get, r.doc, added ? { selectedClipIds: [added.id] } : {});
  },

  generateSelectedVoice: async () => {
    const { doc, selectedClipIds } = get();
    if (!doc || selectedClipIds.length !== 1) return;
    const clipId = selectedClipIds[0];
    const clip = doc.clips.find((c) => c.id === clipId);
    if (!clip || clip.kind !== TIMELINE_CLIP_KIND.voice || !clip.voice) return;
    if (clip.voice.text.trim().length === 0) return; // 空の文では鳴らない（V28 が案内済み）
    if (get()._voiceRun != null) return; // 連打・再入で二重に作らない（開き直しても走っている回は続く）
    // 書き出し中は始めない＝作れても文書へ入れられず（`commit` が断る）、作った声を捨てることになる。
    if (isTimelineExportBusy(get().exportRun.phase)) {
      set({ voiceError: VOICE_EXPORTING_MESSAGE });
      return;
    }
    voiceRunSeq += 1;
    const myRun = voiceRunSeq;
    /** **作り始める前**の印。失敗したときに据え置いてよいか（＝いまの文の声が既にあるか）はこれで決まる。 */
    const statusBefore = clip.voice.status;
    /** 自分の回のときだけ印を下ろす（前の回が今の回の印を横取りしない・#755）。 */
    const clearIfMine = (extra: Partial<TimelineState> = {}): void => {
      set(get()._voiceRun === myRun ? { ...extra, generatingVoiceClipId: null, _voiceRun: null } : extra);
    };
    set({ voiceError: null, generatingVoiceClipId: clipId, _voiceRun: myRun });
    // 合成に渡した設定。**完了時にこれと今の設定を比べる**＝作っている間に文・声・話し方を変えたら
    // その結果は使わない（鳴っている声と表示が食い違う状態を作らない）。
    const input = { text: clip.voice.text, ...resolveTimelineVoice(clip.voice, doc.voiceSettings) };
    try {
      const result = await voiceProvider.synthesize(input);
      const voicePath = await importVoiceFile(doc.projectId, clipId, result.audioDataUrl);
      // 作っている間に文書が入れ替わった／この部品が消えた／設定を変えた＝結果は捨てる。
      const now = get().doc;
      const current = now?.clips.find((c) => c.id === clipId);
      if (
        !now ||
        now.projectId !== doc.projectId ||
        !current?.voice ||
        !sameSynthInput(input, { text: current.voice.text, ...resolveTimelineVoice(current.voice, now.voiceSettings) })
      ) {
        clearIfMine();
        return;
      }
      if (!voicePath) {
        // ⚠️ **作り始める前が「作成済み」なら印は据え置く**（#755-3）＝鳴る側は `voicePath` しか見ないので、
        // `failed` を書くと「作れませんでした」と出ながら声は鳴る、が**文書に残る**。
        setVoiceStatus(set, get, clipId, statusAfterVoiceFailure(statusBefore));
        clearIfMine({ voiceError: `${VOICE_SAVE_FAILED_MESSAGE}${keptVoiceSuffix(statusBefore, current.voice.voicePath)}` });
        void get().saveTimelineProject(); // 印も同じ理由で自分から書く（上の ⚠️）
        return;
      }
      // **長さを実際の尺へ合わせる**（`trimClip` を通す＝連動している字幕も一緒に動く・ADR-0032 決定24）。
      const withVoice = {
        ...now,
        clips: now.clips.map((c) =>
          c.id === clipId && c.voice
            ? { ...c, voice: { ...c.voice, voicePath, status: NARRATION_STATUS.generated } }
            : c,
        ),
      };
      const sized =
        result.durationSec > 0 ? trimClip(withVoice, clipId, 'end', current.startSec + result.durationSec) : null;
      // 長さを合わせられない（置けない）ときは、**声はそのまま置いて**理由を出す＝作った声を捨てない。
      // 理由は `commit` の中で消えるので、まとめて渡す（`commit` は毎回 `editBlocked` を空にする）。
      commit(set, get, sized?.ok ? sized.doc : withVoice, {
        audioSrcByKey: { ...get().audioSrcByKey, [`voice:${voicePath}`]: result.audioDataUrl },
        ...(sized && !sized.ok ? { editBlocked: sized.reason } : {}),
      }, { outsideGroup: true });
      // 尺を測れなかったときは黙って仮の長さのままにしない（区間から出た声は鳴らない）。
      clearIfMine(result.durationSec > 0 ? {} : { voiceError: VOICE_DURATION_UNKNOWN_MESSAGE });
      // ⚠️ **自分から保存する**（#751）。自動保存は**画面**が持っているので、作っている最中に
      // 画面を離れると、着地したぶんを**誰も書かない**＝開き直すと作った声と合わせた長さが
      // 黙って消える（音声ファイルだけ残る）。取り込み（`runImport`）が同じ穴を同じ形で塞いでいる。
      void get().saveTimelineProject();
    } catch {
      // 失敗も成功と同じく**別の文書の部品を巻き込まない**（id は文書ごとに採番＝同じ id が別文書にもある）。
      const now = get().doc;
      const failed = now?.clips.find((c) => c.id === clipId);
      // ⚠️ **作っている間に入力が変わっていたら、印に触れない**（#801）＝この失敗は**古い入力のもの**。
      // 触ると「作り始める前の印」を無検査で書き戻すことになり、
      // ・文を書き換えた後に失敗＝**音声の無い「作成済み」**が文書に残る（鳴る側は `voicePath` しか
      //   見ないので、その読み上げが**黙って欠けた動画**が「保存しました」で出る＝ADR-0026④）
      // ・取り消しで作成済みへ戻した後に失敗＝**鳴るのに「作れませんでした」**（#755-3 の再発）
      // 成功側（上）と場面形式の失敗側（`projectStore`）は同じ照合を持っており、ここだけ抜けていた。
      const sameInput =
        failed?.voice != null &&
        now != null &&
        sameSynthInput(input, { text: failed.voice.text, ...resolveTimelineVoice(failed.voice, now.voiceSettings) });
      if (now && now.projectId === doc.projectId && failed && sameInput) {
        // 上と同じ理由＝**作り始める前が「作成済み」なら作れなかったことにしない**（#755-3）。
        setVoiceStatus(set, get, clipId, statusAfterVoiceFailure(statusBefore));
        set({ voiceError: `${VOICE_FAILED_MESSAGE}${keptVoiceSuffix(statusBefore, failed.voice?.voicePath)}` });
        void get().saveTimelineProject(); // 印も同じ理由で自分から書く（上の ⚠️）
      }
      clearIfMine();
    }
  },

  addTemplateClip: (input) => {
    const doc = get().doc;
    if (!doc) return;
    const r = addTemplateClip(doc, input);
    if (!r.ok) {
      set({ editBlocked: r.reason });
      return;
    }
    // 置いた部品をそのまま選ぶ（続けて中身を入れられる）。**id は増えたものを引き当てる**＝
    // 「末尾に足す」という実装の都合に画面が寄りかからない。
    const before = new Set(doc.clips.map((c) => c.id));
    const added = r.doc.clips.find((c) => !before.has(c.id));
    // **置いた瞬間に見える**（`06 §12.1`）＝運んで置いた先が再生位置と違うなら、そこへ移す。
    // ⚠️ 押して置くときは再生位置そのものなので何も変わらないが、**掴んで運べるようになった**ので
    // 置き先が離れうる（#714）。絵の部品は既にこうしており、揃えないと種類で流儀が割れる（ADR-0026②）。
    commit(set, get, r.doc, added ? { selectedClipIds: [added.id], playheadSec: added.startSec } : {});
  },

  addTrack: (kind) => {
    const doc = get().doc;
    if (doc) commit(set, get, addTrack(doc, kind));
  },
  duplicateTrack: (trackId) => {
    const doc = get().doc;
    if (!doc) return;
    const r = duplicateTrack(doc, trackId);
    if (!r.ok) { set({ editBlocked: r.reason }); return; }
    commit(set, get, r.doc);
  },
  removeTrack: (trackId) => {
    const doc = get().doc;
    if (!doc) return;
    const r = removeTrack(doc, trackId);
    if (!r.ok) {
      set({ editBlocked: r.reason });
      return;
    }
    // 列と一緒に消えるクリップは選択からも外す（消えたものを選んだままにしない）。
    const gone = new Set(doc.clips.filter((c) => c.trackId === trackId).map((c) => c.id));
    commit(set, get, r.doc, { selectedClipIds: get().selectedClipIds.filter((id) => !gone.has(id)) });
  },
  moveTrackTo: (trackId, toIndex) => {
    const doc = get().doc;
    if (!doc) return;
    const r = moveTrackTo(doc, trackId, toIndex);
    if (!r.ok) { set({ editBlocked: r.reason }); return; }
    commit(set, get, r.doc);
  },
  moveTrackOrder: (trackId, direction) => {
    const doc = get().doc;
    if (!doc) return;
    const r = moveTrackOrder(doc, trackId, direction);
    if (!r.ok) { set({ editBlocked: r.reason }); return; }
    commit(set, get, r.doc);
  },
  setTrackFlag: (trackId, flag, value) => {
    const doc = get().doc;
    if (doc) commit(set, get, setTrackFlag(doc, trackId, flag, value));
  },

  undo: () => {
    const { doc, history } = get();
    if (!doc || blockedByExport(set, get)) return;
    const r = undoSnapshot(history, doc);
    if (r) restore(set, get, r.restored, r.history);
  },
  redo: () => {
    const { doc, history } = get();
    if (!doc || blockedByExport(set, get)) return;
    const r = redoSnapshot(history, doc);
    if (r) restore(set, get, r.restored, r.history);
  },

  play: () => {
    const doc = get().doc;
    if (!doc) return;
    // ⚠️ **書き出し中は始めない**（#752-6）。成果物は壊れないが、音が鳴り出す入口だけ開いていた
    //（編集も声の作成も塞いであるのに再生だけ通る＝同じ「走っている間」で挙動が割れる・ADR-0026②）。
    // 押せない見た目はボタン側が出す（キーは見た目を持たないので、ここでも止める）。
    if (isTimelineExportBusy(get().exportRun.phase)) return;
    const total = timelineDurationSec(doc);
    if (total <= 0) return; // 何も置いていない動画では始めない（押しても動かない状態を作らない）
    set({ isPlaying: true, playheadSec: playbackStartSec(get().playheadSec, total), seekNonce: get().seekNonce + 1 });
  },
  pause: () => set({ isPlaying: false }),
  _advancePlayhead: (sec) => {
    const doc = get().doc;
    if (doc) set({ playheadSec: clampTimelinePlayheadSec(doc, sec) });
  },

  // 保存の入口。**進行中の保存があればそれを待って戻る**（場面形式 `projectStore.saveProject` と同じ形）。
  // 無いと、保存中の編集で張り直された自動保存タイマと「保存し直す」から**2本目が並走**し、
  // 古い文書を持つ側が後着してディスク上の編集が巻き戻る（書き込みは truncate＝上書き）。
  saveTimelineProject: async () => {
    const running = currentSave;
    if (running) {
      running.again = true; // いま走っている保存には入らない内容なので、終わったらもう一度書く
      return running.promise;
    }
    // 約束を入れる器を先に作る＝下の処理から**自分の回**を指せる（走っている途中で置き換わらない）。
    const run: SaveRun = { promise: Promise.resolve(), again: false };
    currentSave = run;
    // どの動画への書き込みかを控える（消すときに着地を待たせる・#763-4）。
    // ⚠️ ループの途中で文書が入れ替わると書く相手は変わるが、**待つ側に要るのは「着地したか」だけ**
    // なので安全側（待ちすぎることはあっても、待たなさすぎることはない）。
    const writingId = get().doc?.projectId ?? null;
    run.promise = (async () => {
      try {
        do {
          run.again = false;
          await doSaveTimelineProject(set, get);
        } while (run.again);
      } finally {
        // **自分が置いた見張りのときだけ外す**。動画を切り替えたあとは新しい保存が走っているので、
        // 無条件に外すとその保存が「走っていない」ことにされ、次の依頼が**並走**する（＝上書きで
        // 変更が巻き戻る・このPRが潰したはずの事故が同じ動画の中で再発する）。
        if (currentSave === run) currentSave = null;
      }
    })();
    if (writingId) trackWrite(writingId, run.promise);
    return run.promise;
  },

  exportTimelineVideo: async (deps) => {
    const doc = get().doc;
    if (!doc || isTimelineExportBusy(get().exportRun.phase)) return;
    // **始められない理由は1か所で見る**（`exportStartBlock`・#718）＝画面のボタンが押す前に出す理由と
    // 同じものを、ここでも使う。条件を2か所に書くと、画面が塞いでいない理由で押してから断る（#703 の型）。
    // 判定材料（読み込めている見た目）は描くときと**同じもの**を渡す＝断る条件と描く条件がずれない。
    const blocked = exportStartBlock({
      doc,
      isImporting: get().isImporting,
      voiceRunning: get()._voiceRun != null,
      knownTemplateIds: new Set(deps.templates.map((t) => t.templateId)),
      otherExportRunning: isOtherExportRunning(EXPORT_OWNER),
      canExportHere: canExport(),
    });
    if (blocked) {
      set({ exportRun: { ...IDLE_EXPORT, phase: blocked.phase, message: blocked.message } });
      return;
    }
    // 保存先を先に決める（重い処理をしてから「やっぱりやめる」を選ばせない）。ここから走行中に数える
    // ＝ダイアログを開いている間に続けて押しても、書き出しが二重に走らない。
    set({ exportRun: { ...IDLE_EXPORT, phase: P.preparing } });
    useExportLockStore.getState().acquire(EXPORT_OWNER);
    let unlisten: (() => void) | undefined;
    try {
      // 見た目パターンの解決は**代表フレームの要否**（どの枠が実フレームで描かれるか＝#512 段3）にも
      // 要るので、絵を描く手前ではなく**ここで**用意する（同じ表を2度作らない）。
      const templateById = new Map(deps.templates.map((t) => [t.templateId, t]));
      const templateOf = (id: string) => templateById.get(id);
      // **表示用の URL（`asset://`）は書き出しでは読めない**（#716）＝ここで data URL へ解き直す。
      // 解き方は場面形式と共有（`createExportSrcResolver`）＝形式によって焼ける絵が割れない。
      // 使っている素材だけをまとめて持つ（全フレームで同じ絵を引くので都度読み直さない）。
      // ⚠️ **保存先を聞く前**にやる（#726 レビュー）＝ほかの断る理由と同じ順番で返す。ディスクを読むので
      // `timelineExportBlockers`（同期）には入れられないが、**聞いてから断る**のは避ける。
      // ⚠️ 走行中に数え始めた**後**でやる＝ここで待つ間に押し直されて二重に走るのを防ぐ。
      const exportSrcById = await resolveExportSrcMap(
        timelineImageAssetIds(doc, templateOf),
        createExportSrcResolver({ projectId: doc.projectId, assets: doc.assets, templateAssetSrcById: deps.templateAssetSrcById }),
      );
      // 読めなかった素材があれば断る。そのまま焼くとその部品だけ灰色の枠になり、プレビューでは
      // （開いた時点の表示先で）写真が出たままなので**見えていたものと違う動画**が成功として出る（ADR-0026④）。
      if (timelineImageAssetIds(doc, templateOf).some((id) => !exportSrcById[id] && !deps.templateAssetSrcById[id])) {
        set({ exportRun: { ...IDLE_EXPORT, phase: P.error, message: exportBlockedMessage[TIMELINE_EXPORT_BLOCK.assetUnreadable] } });
        return;
      }
      // 保存先を聞くのも try の中（失敗しても `preparing` のまま固まらない＝画面が戻らなくなる）。
      const outputPath = await showSaveVideoDialog(doc.projectName || "movie");
      if (!outputPath) {
        set({ exportRun: IDLE_EXPORT });
        return;
      }
      // ダイアログの間に中止を押していたら始めない（押した中止を黙って無かったことにしない）。
      if (get().exportRun.cancelling) throw new ExportCancelledError();
      // 再生したまま書き出すと、鳴っている音と作業が重なる。止めてから始める（ADR-0032 追補と同じ流儀）。
      get().pause();
      // **描くのに使うものは、始めた時点のものを取っておく**（数分かかる処理の途中で別の動画を開かれても、
      // 別プロジェクトの絵や音が混ざらない＝場面形式が #379/#570 で潰したのと同じ事故）。
      const { audioSrcByKey, assetSizes } = get();
      set({ exportRun: { phase: P.rendering, percent: 0, message: null, cancelling: false } });
      await beginExport();
      unlisten = await listenExportProgress((ev) => {
        set({
          exportRun: {
            ...get().exportRun,
            phase: P.encoding,
            percent: exportOverallPercent({ phase: P.encoding, progress: { done: 0, total: 0 }, encode: ev }),
          },
        });
      });
      await clearExportFramesStage();
      // 同梱フォントを先にそろえる（読み込み済みの字体しか焼けない＝プレビューと違う字にしない）。
      await loadExportFonts();
      const frames = await buildTimelineFrames(doc, {
        templateOf,
        assetSrc: (id) => (id ? exportSrcById[id] ?? deps.templateAssetSrcById[id] : undefined),
        // 素材の実寸（#634）＝プレビューと同じものを渡す（渡さないと「枠いっぱい」だけ書き出しで戻る）。
        assetSizeOf: (id) => assetSizes[id],
        // 動画全体のフォント（`videoSettings.fontId`）は、部品ごとの指定が無いときの受け皿（11 §6 継承）。
        fontFamily: fontFamilyForId(doc.videoSettings.fontId),
        fallbackCredit: creditForSpeaker(getVoicevoxSpeaker()),
        stageFrame: stageExportFrame,
        // 動画の実フレーム（#512 段1）＝場面形式（#442）と**同じ Rust の口**を通す。
        // ⚠️ 素材は**プロジェクトからの相対パス**で渡す（`stage_clip_frames` がそう解決する）。
        // 動画の id が解けない・プロジェクト id が無いときは渡さない＝静止のまま（画面が先に断る）。
        stageVideo: async (v) => {
          const asset = doc.assets.find((a) => a.assetId === v.assetId);
          if (!asset) return 0; // 素材が見つからない＝静止のまま（描画側の知らせが受け止める）
          return stageClipFrames(
            doc.projectId, asset.filePath, v.sourceStartSec, v.durationSec, v.speed, v.fps,
            dimsForOrientation(doc.videoSettings.aspectRatio).width, v.dirName,
          );
        },
        readVideoFrame: (dirName, frameIndex) => readExportFrame(dirName, frameIndex),
        onProgress: (done, total) =>
          set({
            exportRun: {
              ...get().exportRun,
              percent: exportOverallPercent({ phase: P.rendering, progress: { done, total } }),
            },
          }),
        shouldCancel: () => get().exportRun.cancelling,
      });
      if (get().exportRun.cancelling) throw new ExportCancelledError();
      set({ exportRun: { ...get().exportRun, phase: P.encoding } });
      const bgmRuns = timelineBgmRunInputs(doc, audioSrcByKey, templateOf);
      await exportVideo([frames], doc.projectName || "movie", bgmRuns, doc.projectId, outputPath);
      set({ exportRun: { phase: P.done, percent: 100, message: EXPORT_DONE_MESSAGE, cancelling: false } });
    } catch (e) {
      const cancelled = e instanceof ExportCancelledError || get().exportRun.cancelling;
      // ⚠️ **Rust が整えた「次の行動」つきの文言は丸めない**（レビュー 🟡・場面形式の `ExportScreen` と同じ規則）。
      // Tauri のコマンドは**文字列で**失敗を返す（`Error` ではない）。#512 段1 でコマの焼き出しが本走行に
      // 入り、「動画が見つかりませんでした。もう一度取り込んでください」等が新たに届くようになったのに、
      // 常に「もう一度お試しください」へ潰すと**何度やっても成功しない案内**になる。
      // ⚠️ **文字列で返ったものだけ**を出す＝Tauri のコマンドは**文字列で** reject し、それは Rust が
      // 利用者向けに整えた「次の行動」つきの文言（技術詳細は stderr へ）。`Error` は中の失敗
      // （`ffmpeg exited with code 1` 等）なので**見せない**（§2-5・既存テストが守っている規則）。
      const detail = typeof e === "string" ? e : "";
      set({
        exportRun: {
          ...IDLE_EXPORT,
          phase: cancelled ? P.cancelled : P.error,
          message: cancelled ? EXPORT_CANCELLED_MESSAGE : detail || EXPORT_FAILED_MESSAGE,
        },
      });
    } finally {
      unlisten?.();
      useExportLockStore.getState().release(EXPORT_OWNER);
      // 一時ファイルは成功でも失敗でも片づける（次の書き出しに古いフレームを混ぜない）。
      await clearExportFramesStage();
    }
  },

  cancelTimelineExport: () => {
    const run = get().exportRun;
    if (!isTimelineExportBusy(run.phase)) return;
    set({ exportRun: { ...run, cancelling: true } });
    void cancelExport();
  },

  dismissTimelineExport: () => {
    // 走行中に出る知らせ（別の動画を開こうとした等）を閉じても、**走行中は解除しない**
    // ＝閉じるボタンが「書き出し中の締め」を外す抜け道にならない（一覧へ戻る・二重起動が開く）。
    const run = get().exportRun;
    set({ exportRun: isTimelineExportBusy(run.phase) ? { ...run, message: null } : IDLE_EXPORT });
  },
}));

/**
 * 音の並べ方（domain）を、混ぜる側の入力へ写す。**音源は再生と同じもの**（`audioSrcByKey`）＝
 * 聞いた音と書き出した音が一致する。読めなかった音源は置かない（その部品は鳴らない）。
 */
export function timelineBgmRunInputs(
  doc: TimelineProject,
  audioSrcByKey: Record<string, string>,
  templateOf?: (templateId: string) => Template | undefined,
): BgmRunInput[] {
  const runs: BgmRunInput[] = [];
  // 見た目パターンは**差し込み口の元の音**（#512 段3b）を解くのに要る（渡さないと差し込み口は鳴らない）。
  for (const run of timelineAudioRuns(doc, templateOf)) {
    // ⚠️ **動画の元の音はパスで渡す**（#512 段2）＝中身（base64）は要らない。
    // ここで `audioSrcByKey` を要求すると、動画を丸ごと文字列にしないと鳴らせなくなる。
    const audioBase64 = run.assetPath ? "" : audioSrcByKey[run.sourceKey];
    if (!run.assetPath && !audioBase64) continue;
    runs.push({
      audioBase64,
      ...(run.assetPath ? { audioPath: run.assetPath } : {}),
      fileExt: run.fileExt,
      volume: run.volume,
      // 音量の変化（#512）＝点が無い部品ではキーごと落とす（未指定＝一定値の `volume` で出る）。
      ...(run.volumeExpr ? { volumeExpr: run.volumeExpr } : {}),
      delaySec: run.delaySec,
      playSec: run.playSec,
      fadeInSec: run.fadeInSec,
      fadeOutSec: run.fadeOutSec,
      loopSource: run.loop,
      sourceStartSec: run.sourceStartSec,
      speed: run.speed,
    });
  }
  return runs;
}


/** 素材 id → プロジェクト相対のファイルパス（音の素材を読むのに使う）。 */
function assetPathOf(doc: TimelineProject, assetId: string): string | undefined {
  return doc.assets.find((a) => a.assetId === assetId)?.filePath;
}

type SetState = (partial: Partial<TimelineState>) => void;
type GetState = () => TimelineState;

/**
 * 変更を確定して履歴へ積む（ADR-0020 と同じ＝**適用前**の文書を past へ）。
 * 文書が変わっていないとき（端で何も起きない操作など）は履歴を汚さない＝取り消しが空振りしない
 * （各操作は「変わらないなら同一参照」を返すので、参照比較で足りる）。
 */
/**
 * @param opts.outsideGroup **利用者が打っている最中のまとめに混ぜない**（#708 レビュー）。
 *   非同期の完了（声ができた等）は利用者のひと続きの操作ではないので、まとめの「最初の1回」を
 *   食べてしまうと、打った文字と作った声が**同じ取り消しで一緒に消える**。必ず自分で1つ積む。
 */
/**
 * 素材を取り込み始めてよいか（#712）。**2つの入口で同じ順に見る**（場面形式と同じ並び＝ADR-0026②）。
 * `false` のときは理由を出し終えている（黙って何もしない、を作らない）。
 */
function canStartImport(set: SetState, get: GetState): boolean {
  if (!get().doc) return false;
  // 書き出しは**始めた時点の文書**を焼くので、増やしても動画に入らない（`commit` と同じ規準・§2-5）。
  if (isTimelineExportBusy(get().exportRun.phase)) { set({ editBlocked: EDIT_BLOCKED.exporting }); return false; }
  if (get().isImporting) return false; // 二重に取り込むと同じ番号の素材が2つできる
  return true;
}

/**
 * 素材の取り込み（#712）。**2つの入口（ファイル／パス）で同じ手順を踏む**ための1か所。
 *
 * 場面形式は「先に一覧へ足して、失敗したら戻す」（楽観追加＋ロールバック）だが、こちらは
 * **取り込めてから足す**。理由＝この形式の取り消しは**文書まるごと**なので、楽観追加とロールバックが
 * それぞれ履歴に積まれ、失敗しただけで取り消しが2つ増える（`setBgm` の「先に取り込み＝ゴースト防止」と同じ流儀）。
 */
async function runImport(
  set: SetState,
  get: GetState,
  sourceName: string,
  copy: (fileName: string, assetType: AssetType) => Promise<string | null>,
): Promise<void> {
  const doc = get().doc;
  if (!doc || !canStartImport(set, get)) return;
  // **番号は使い回さない**（`reserveAssetId`）＝取り消し・開き直しで文書から消えても、その番号のファイルは
  // ディスクに残っている。空き番号を埋めると**同じ名前のファイルを上書きして前の写真が消える**。
  const assetId = reserveAssetId(doc.projectId, doc.assets.map((a) => a.assetId), createAssetId);
  const { asset, fileName } = newAssetFrom(sourceName, [], assetId);
  set({ isImporting: true, importError: null });
  try {
    const savedPath = await copy(fileName, asset.assetType);
    const relPath = savedPath ?? asset.filePath;
    // 動画は長さ・代表フレームまで揃える（取れなくても素材そのものは使える）。
    const enrich = asset.assetType === ASSET_TYPE.video
      ? await probeAndThumbVideo(doc.projectId, relPath)
      : null;
    const src = enrich ? enrich.thumbUrl : (await assetDisplayUrl(doc.projectId, relPath)) ?? undefined;
    // **待っている間に文書が入れ替わっていたら、そちらへは何も書かない**。判定はここ1か所＝最後の await の後
    // （2か所に置くと、片方を消しても、もう片方が拾ってしまい**壊れていることに気づけない**）。
    // 表示先だけ書くのも駄目（文書に無い素材の絵が残り、次に同じ番号が来たときそれが出る）。
    const cur = get().doc;
    if (!cur || cur.projectId !== doc.projectId) return;
    // 待っている間に書き出しが始まっていたら、`commit` は足さずに戻る。**そこで気づけるように**先に断る
    // ＝「終わってから編集してください」だけ出して取り込みが消えた、を作らない（§2-5・#570 P1 と同じ流儀）。
    if (isTimelineExportBusy(get().exportRun.phase)) {
      set({ importError: IMPORT_BLOCKED_EXPORTING_MESSAGE });
      return;
    }
    const full: Asset = { ...asset, filePath: relPath, ...(enrich?.metadata ? { metadata: enrich.metadata } : {}), ...(enrich?.thumbnailPath ? { thumbnailPath: enrich.thumbnailPath } : {}) };
    // **いまの文書へ足す**（取り込んでいる間の編集を巻き戻さない）。取り消しできる＝文書まるごとの履歴に載る。
    // `outsideGroup`＝**非同期の着地は利用者のまとめに混ぜない**（文字を打っている最中に着地すると、
    // その1回ぶんを食べて以後の入力が記録されない・声の完成と同じ流儀）。
    commit(set, get, { ...cur, assets: [...cur.assets, full] }, {}, { outsideGroup: true });
    if (src) set({ assetSrcById: { ...get().assetSrcById, [asset.assetId]: src } });
    // ⚠️ **取り込んだ動画にも本体の URL を用意する**（#512 段1）＝読込時と同じ扱い。
    // 忘れると「開き直すと映るのに、取り込んだ直後は映らない」という入口ごとの割れになる。
    if (asset.assetType === ASSET_TYPE.video) {
      const bodyUrl = await assetDisplayUrl(doc.projectId, relPath);
      const now = get().doc;
      if (bodyUrl && now && now.projectId === doc.projectId) {
        set({ videoSrcById: { ...get().videoSrcById, [asset.assetId]: bodyUrl } });
      }
    }
    // 自動保存は**画面**が持っているので、離れた後に着地したぶんは誰も書かない＝ここで自分から保存する。
    void get().saveTimelineProject();
  } catch (e) {
    // 足す前に断るので、戻すものは無い（一覧に幽霊を作らない）。触っていない動画へは出さない。
    if (get().doc?.projectId === doc.projectId) set({ importError: importErrorMessage(e) });
  } finally {
    // 取り込みの鍵は**始めた動画のもの**＝別の動画を開いた後に外さない（そちらの取り込みを止めてしまう）。
    if (get().doc?.projectId === doc.projectId) set({ isImporting: false });
  }
}

function commit(
  set: SetState,
  get: GetState,
  next: TimelineProject,
  extra: Partial<TimelineState> = {},
  opts: { outsideGroup?: boolean } = {},
): void {
  // 書き出しは**始めた時点の文書**を焼く。途中の編集は動画に入らないので、黙って受け付けない（§2-5）。
  if (isTimelineExportBusy(get().exportRun.phase)) {
    set({ editBlocked: EDIT_BLOCKED.exporting });
    return;
  }
  const current = get().doc;
  if (!current || next === current) {
    set({ editBlocked: null, ...extra });
    return;
  }
  // グループ中は**最初の実変更だけ**積む（1文字ごとに積むと、上限 50 を文字入力だけで食い潰し、
  // それ以前の編集＝「バラす」などが取り消せなくなる・#708）。
  const inGroup = get()._historyGroupDepth > 0 && !opts.outsideGroup;
  const record = !inGroup || get()._historyGroupPending;
  set({
    doc: next,
    history: record ? recordSnapshot(get().history, current) : get().history,
    // まとめに参加した分だけ「記録済み」にする（参加していない完了で他人のまとめを消費しない）。
    ...(inGroup ? { _historyGroupPending: false } : {}),
    editBlocked: null,
    saveStatus: "idle",
    // 編集したら再生を止める＝「再生位置へ」のような操作が**動いている的**を狙うのを防ぐ（結果が毎回変わる）。
    isPlaying: false,
    // 尺が縮んだら位置を収める（消した部品より後ろに取り残さない）。
    playheadSec: clampTimelinePlayheadSec(next, get().playheadSec),
    ...extra,
  });
}

/**
 * 取り消し/やり直しで文書を差し替える。**消えたクリップを選んだままにしない**（戻した文書に無い
 * 選択が残ると、次の操作が「変化ゼロ」の履歴を積む）。
 */
/** 書き出し中は取り消し・やり直しも止める（`commit` と同じ理由＝焼く文書は始めた時点のもの）。 */
function blockedByExport(set: SetState, get: GetState): boolean {
  if (!isTimelineExportBusy(get().exportRun.phase)) return false;
  set({ editBlocked: EDIT_BLOCKED.exporting });
  return true;
}

function restore(set: SetState, get: GetState, doc: TimelineProject, history: HistoryStacks<TimelineProject>): void {
  const ids = new Set(doc.clips.map((c) => c.id));
  set({
    doc,
    history,
    editBlocked: null,
    saveStatus: "idle",
    isPlaying: false, // 取り消し/やり直しも編集と同じ扱い（動いている的を狙わせない）
    playheadSec: clampTimelinePlayheadSec(doc, get().playheadSec),
    selectedClipIds: get().selectedClipIds.filter((id) => ids.has(id)),
  });
}

/**
 * 「選んでいる1つのクリップ」に対する編集を流す。**置けなかったら文書を変えず理由だけ持つ**
 * （§2-5＝画面が「その場所には置けません」を出す）。複数選択中は対象が決まらないので何もしない。
 */
function applyEdit(set: SetState, get: GetState, run: (doc: TimelineProject, clipId: string) => EditResult): void {
  const { selectedClipIds } = get();
  if (selectedClipIds.length !== 1) return;
  applyEditTo(set, get, selectedClipIds[0], run);
}

/** **相手を id で指す**編集（掴んで動かす経路。選択に依らない＝上と同じ後始末を通す）。 */
function applyEditTo(
  set: SetState,
  get: GetState,
  clipId: string,
  run: (doc: TimelineProject, clipId: string) => EditResult,
): void {
  const doc = get().doc;
  if (!doc) return;
  const r = run(doc, clipId);
  if (r.ok) commit(set, get, r.doc);
  else set({ editBlocked: r.reason });
}

/** 読み上げクリップの状態だけを差し替える（履歴に積まない＝作成中/失敗は編集ではない）。 */
function setVoiceStatus(set: SetState, get: GetState, clipId: string, status: NarrationStatus): void {
  const doc = get().doc;
  if (!doc) return;
  set({
    doc: {
      ...doc,
      clips: doc.clips.map((c) => (c.id === clipId && c.voice ? { ...c, voice: { ...c.voice, status } } : c)),
    },
    // **文書が変わったら未保存にする**（`commit` と同じ）。ここだけ立てないと、声を作れなかった印が
    // 付いたのに画面は「保存しました」のままになり、自動保存も次の編集まで走らない。
    saveStatus: "idle",
  });
}

/**
 * 実際の保存処理（**必ず `saveTimelineProject` 経由で呼ぶ**＝並走させない）。
 * 適合しないものは書かない＝一覧に出るのに開けない動画を作らない（焼き出しと同じ判断・読込側は適合を要求する）。
 */
async function doSaveTimelineProject(set: SetState, get: GetState): Promise<void> {
  const doc = get().doc;
  if (!doc) return;
  set({ saveStatus: "saving" });
  const next = withUpdatedAt(doc, new Date().toISOString());
  // **書いている相手がまだ開いているか**。書き込みは時間がかかるので、その間に別の動画へ移れる。
  // 移ったあとに前の動画の結果でいまの動画の保存状態を書き換えると、**触ってもいない動画に**
  // 「保存できませんでした」が出たり、保存済みが未保存へ化けたりする（#693 レビュー・ADR-0026①）。
  const stillOpen = () => get().doc?.projectId === doc.projectId;
  if (!validateTimelineProject(next)) {
    console.warn("[timeline] 保存内容がスキーマに未適合:", validateTimelineProject.errors);
    if (stillOpen()) set({ saveStatus: "error" });
    return;
  }
  try {
    await saveProjectDoc(next.projectId, JSON.stringify(next, null, 2));
    if (!stillOpen()) return;
    // 保存中に更に編集されていたら「保存しました」にしない（未保存を保存済みに見せない）。
    set(get().doc === doc ? { doc: next, saveStatus: "saved" } : { saveStatus: "idle" });
  } catch {
    if (stillOpen()) set({ saveStatus: "error" });
  }
}

/**
 * 読み上げクリップの声の設定を解く（`11 §6` null=継承）。場面形式の `resolveNarrationVoice` と同じ順序で、
 * **話者だけはクリップが持つ**（掛け合いの行と同じ扱い＝ADR-0015）。
 */
function resolveTimelineVoice(voice: TimelineVoice, settings: VoiceSettings) {
  const resolved = resolveNarrationVoice(
    { text: voice.text, status: voice.status, speed: voice.speed, pitch: voice.pitch, intonation: voice.intonation },
    settings,
  );
  // catalog に無い話者は既定の声へ落とす（場面形式の `resolveLineVoice`＝V19 と同じ扱い）。
  const speaker = voice.speaker != null && characterForSpeaker(voice.speaker) != null ? voice.speaker : null;
  return { ...resolved, speaker };
}

// 動画が消えたら、その文書を持っている間は手放す（#755）。**画面ではなく store で受ける**＝
// 画面を離れていても効く（本番の導線は `closeTimelineProject` を通らない）。
onProjectDeleted((projectId) => useTimelineStore.getState().discardDeletedProject(projectId));
