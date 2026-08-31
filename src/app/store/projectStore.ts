// プロジェクトの状態（Zustand）。AI出力→検証/変換→内部Scene の結果を保持し、UIへ供給する。
// 保存/読込は project.json（infrastructure/projectFs.ts 経由）。AIは Gemini キーがあれば実プロバイダ、無ければ Mock。
import { create } from "zustand";
import { defaultDurationForTemplate } from "../../domain/template/layerOps";
import { standardLookFixesForUnresolved } from '../../domain/template/templateSelection';
import { BGM_VOLUME, DEFAULT_CHARACTER_ID, DEFAULT_TARGET_DURATION_SEC, DEFAULT_TONE, MAX_INLINE_ASSET_BYTES, NARRATION_BULK_CONCURRENCY, PROJECT_NAME_MAX_LENGTH } from "../../domain/constants";
import type { CreditDisplay } from "../../domain/voice/creditDisplay";
import type { Asset, AssetMetadata, BgmSettings, CompanyInfo, ElementAnimation, GeneralBrief, Keyframe, Narration, Part, Scene, VoiceSettings, Warning } from "../../domain/project/types";
import { ASSET_TYPE, NARRATION_STATUS, type NarrationStatus, type Orientation, type Purpose, type SceneCategory, type VideoKind } from "../../domain/enums";
import type { FontId } from "../../domain/font/fontCatalog";
import { isKnownFontId } from "../../domain/font/fontCatalog";
import { createUserFontId } from "../../domain/font/fontCatalog";
import { isExportFinished } from "../../domain/export/exportProgress";
import type { ExportProgressEvent, ExportRunPhase } from "../../domain/export/exportProgress";
import type { BundledBgmId } from "../../domain/bgm/bgmCatalog";
import type { Template } from "../../domain/template/types";
import { transformVideoPlan } from "../../domain/ai/transformPlan";
import { buildTemplateSummaries, buildYukoPoseTags, resolveTargetAudience } from "../../domain/ai/videoPlanInput";
import type { GenerateVideoPlanInput } from "../../domain/ai/aiProvider";
import type { AiVideoPlan } from "../../domain/ai/types";
import {
  assembleProject, createAnimationId, createBgmId, createPartId, createProjectId, createSceneId,
  defaultVideoSettings, defaultVoiceSettings, parseProjectDoc, projectHeaderFromProject, validateProjectDoc,
  ProjectLoadError,
} from "../../domain/project/persistence";
import type { ProjectHeader } from "../../domain/project/persistence";
import { duplicateSceneInList, moveSceneInList, moveSceneToIndexInList, splitSceneInList, splitSceneLinesInList, switchSceneTemplate } from "../../domain/project/sceneOps";
import { substituteDeletedTemplateInScenes } from "../../domain/project/templateUsage";
import { duplicateSceneAnimations, removeAnimationsForScene, removeAnimationsForTargets, retargetAnimations } from "../../domain/project/animationOps";
import { recordSnapshot, redoSnapshot, undoSnapshot } from "../../domain/project/history";
// たたき台の入力があるか＝**守る側と同じ判定**を共有する（破棄ガードと食い違わせない）。
import { hasWizardBrief, hasWorkInProgress } from "../newProjectGuard";
import { duplicateProjectDoc, duplicatedFilePaths } from "../../domain/project/duplicate";
import { thumbnailScene, thumbnailSignature } from "../../domain/project/thumbnail";
import { renderProjectThumbnail } from "../../renderer/export/projectThumbnail";
import { saveProjectThumbnail } from "../../infrastructure/projectFs";
import { changeScenesOrientation } from "../../domain/project/orientationOps";
import { MockAiProvider } from "../../infrastructure/aiProviders/mockAiProvider";
import { GeminiProvider } from "../../infrastructure/aiProviders/geminiProvider";
import { willSendExternally } from "../../infrastructure/aiClient";
import { getAiModel } from "../../infrastructure/appSettings";
import type { ScreenId } from "../data/mockData";
import { loadBundledTemplates } from "../../infrastructure/templateFs";
import * as userTemplateFs from "../../infrastructure/userTemplateFs";
import { buildBlankTemplate, isUserTemplate, replaceUserTemplates, upsertUserTemplate } from "../../domain/template/userTemplate";
import { orphanTemplateAssetIds, templateAssetIdsOf } from "../../domain/template/templateAsset";
import { deleteTemplateAsset, importTemplateAsset, loadTemplateAssetUrls } from "../../infrastructure/templateAssetFs";
import {
  clearLastProjectId, deleteProjectDoc, getLastProjectId, listProjectSummaries, loadProjectDoc, saveProjectDoc, setLastProjectId,
} from "../../infrastructure/projectFs";
import type { ProjectSummary } from "../../infrastructure/projectFs";
import { deleteUserFont, importUserFont, listUserFonts, loadUserFonts, usedUserFontIds, type UserFont } from "../../infrastructure/userFontFs";
import { importAssetFile, importAssetBytes, importAssetByPath, assetDisplayUrl, extractVideoThumbnail, extractVideoFrame, fileToDataUrl, missingAssetFiles, deleteProjectFiles } from "../../infrastructure/assetFs";
import { assetFromLibrary } from "../../domain/asset/assetLibrary";
import type { BrandKit } from "../../domain/brand/brandKit";
import { emptyBrandKit, isNoopBrandApply, planBrandApply } from "../../domain/brand/brandKit";
import { loadBrandKit, saveBrandKit } from "../../infrastructure/brandKitFs";
import { copyLibraryAssetToProject, listLibraryAssets } from "../../infrastructure/assetLibraryFs";
import { changesAssetKind, exceedsInlineAssetLimit, fileExtension, fileNameOf, isListedMaterial, newAssetFrom, newFrameAsset, UNNAMED_ASSET_NAME } from "../../domain/asset/assetFile";
import { relinkAsset } from "../../domain/asset/relink";
import { probeAndThumbVideo, probeImageSize } from "./assetImport";
import { ASSET_TOO_LARGE_USE_PICKER, assetTooLargeMessage, assetTypeMismatchMessage, clipClampedMessage, importErrorMessage, importPartlyFailedMessage, IMPORT_BUSY_MESSAGE } from "../uiLabels";
import { importVoiceFile, readVoiceDataUrl } from "../../infrastructure/voiceFs";
import { resolveLineVoice, resolveNarrationVoice, sameSynthInput } from "../../domain/voice/voiceProvider";
import type { VoiceProvider } from "../../domain/voice/voiceProvider";
import { lineAudioKey, lineDurationsFromAudio, lineVoiceStem, liveNarrationAudioKeys, sceneNeedsVoice, withLineStatus, withLineVoicePath } from "../../domain/project/narrationLines";
import { BakeError, bakeTimelineProject, bakedFilePaths } from "../../domain/timeline/bake";
import type { BakeNote, BakeRange, BakeResult } from "../../domain/timeline/bake";
import { bakeSizeBytes, copyBakedFiles } from "../../infrastructure/bakeFs";
import { validateTimelineProject } from "../../domain/validation/generated/validators.js";
import { duplicateIdsIn } from "../../domain/timeline/validateTimelineDoc";

/**
 * 焼き出しの結果が壊れていたときの案内（適合しない／id が重なる）。**空き容量の話ではない**ので、
 * 入出力の失敗（コピー・保存）とは別の「次の行動」を出す（§2-5・ADR-0026④）。
 */
const BAKE_BROKEN_RESULT_MESSAGE =
  "作れませんでした。元の動画の中身に問題があるようです。作る範囲を狭めるか、元の動画を直してからお試しください。";

import { clearPendingNarrations } from "../../domain/voice/narrationProgress";
import { runWithConcurrency } from "../../utils/concurrency";
import { emitProjectDeleted } from "./projectDeletion";
import { statusAfterVoiceFailure } from "../../domain/project/narrationStatus";
import { KEPT_PREVIOUS_VOICE_SUFFIX, alpha6Message, BRAND_FONT_CLEARED_MESSAGE, BRAND_FONT_CLEAR_FAILED_MESSAGE, BRAND_LOGO_NOT_APPLIED_MESSAGE, DUPLICATE_FAILED_MESSAGE } from "../uiLabels";

/**
 * 声を作れなかったときの知らせ（#755-3）。**前の声がそのまま使えるときだけ**その旨を添える。
 *
 * ⚠️ **判断は印と揃える**＝据え置いた（`generated` のまま）ときだけ言う。印は `failed` にするのに
 * 「そのまま使えます」と言うと、**古い文の声を使ってよい**と誤解させる（文を変えた直後がこれ）。
 * ⚠️ **鳴らす材料があることも見る**＝印が「作成済み」でも音声を読み込めていないことがある
 *（そのときは鳴らないので「使えます」は嘘になる）。
 * ⚠️ **区切りを入れる**＝合成側から来た生の文字列が句点で終わらないと1文に繋がって読めなくなる。
 */
function joinVoiceFailure(e: unknown, before: NarrationStatus, hasAudio: boolean): string {
  const base = typeof e === "string" ? e : "音声の作成に失敗しました。もう一度お試しください。";
  const kept = statusAfterVoiceFailure(before) === NARRATION_STATUS.generated && hasAudio;
  if (!kept) return base;
  return `${base}${base.endsWith("。") ? "" : "。"}${KEPT_PREVIOUS_VOICE_SUFFIX}`;
}
import type { VoiceStyleParams } from "../../domain/voice/voiceStylePresets";
import type { AudioAutoSettings } from "../../domain/voice/audioAuto";
import { MockVoiceProvider } from "../../infrastructure/voiceProviders/mockVoiceProvider";
import { VoicevoxProvider, synthesizeWithAccent } from "../../infrastructure/voiceProviders/voicevoxProvider";

export type GenerateStatus = "idle" | "generating" | "ready" | "error";
// 保存の状態は `app/saveStatus` が持つ（#924＝判定側との循環を作らない）。既存の取り込み元を保つため再輸出する。
import type { SaveStatus } from "../saveStatus";
export type { SaveStatus };
/** 書き出しの進行フェーズ（#379）。ExportScreen ローカルでなく store に持ち、他画面へ遷移しても進捗が残る。 */
// 値の定義は domain（`exportProgress.ts`）に1か所だけ置く（§2-7）。ここは別名＝進捗計算と常に同じ語彙になる。
export type ExportPhase = ExportRunPhase;
/** 書き出しの進行状態（#379）。画面横断で参照＝進捗の可視化・書き出し中の再実行/破壊操作ブロックに使う。 */
export interface ExportRunState {
  phase: ExportPhase;
  // frameFraction＝処理中の場面内の進み具合（0〜1・任意）。アニメ場面は数百フレームを焼く間 done が動かず
  // バーが凍って見える（フリーズ誤認→二重書き出しの引き金）ため、フレーム進捗で滑らかに進める（#391）。
  progress: { done: number; total: number; frameFraction?: number };
  // encoding 段（結合・字幕・BGM）の実進捗（#376）。Rust の export_progress イベントで更新しバーを 80→100% に。
  // 未受信（旧 Rust/ブラウザ）は undefined＝従来の不定バーにフォールバック。
  encode?: ExportProgressEvent;
  resultPath: string;
  message: string;
  bgmWarning: "" | "partial" | "all";
  /** BGM を下げる区間をまとめたか（#257）＝点の上限に収めるために間の狭いところをつないだ。 */
  duckMerged: boolean;
  // ユーザーが中止を要求したか（#380）。画面横断で保持し、書き出しの各段が「中止しました」で終えられるようにする。
  cancelling: boolean;
  /**
   * 終わった（done/error/cancelled）が、**書き出し画面でまだ見ていない**か（#589）。
   * 書き出し中は他画面へ移動できる（`15 §4`）ため、終端で編集ロックのバナーが消えるだけだと
   * 「消えた＝成功した」と誤読する。これが true の間、書き出し画面**以外**で結果を知らせる。
   * `setExportRun` が phase の遷移に合わせて自動で立て/落とすので、呼び出し側は意識しなくてよい。
   */
  resultUnseen: boolean;
}
/**
 * **場面形式の動画を開いているか**（差分再監査 6巡目 🟡＝判定は1か所から採る）。
 *
 * ⚠️ **どれか1つでも当てはまれば開いている**＝読み込んだ（`projectId`）／白紙から作った（`status` が
 * `idle` でない）／場面がある／**たたき台の入力がある**（会社名・発表テーマ）。1つだけで見ると取りこぼす：
 * `projectId` だけだと**白紙から作った直後**（まだ番号を採っていない）を、`status`＋場面だけだと
 * **番号だけ採った文書**を落とす。
 * ⚠️ **たたき台の入力も数える**（差分再監査 7巡目 🟡）＝AI で作る主経路（`newProject`）は `status` を
 * `idle` のままにする（自動生成を発火させるため）ので、上の3つだけだと**ウィザードの途中**が
 * 「開いていません」に落ちる。その動画は一覧にも無いので**案内どおりに開き直せない**（§2-5 の
 * 行き止まり）。守る側（`hasWorkInProgress`）が既に「作業中」と数えている状態と食い違わせない。
 */
export function hasOpenProject(s: {
  meta: { projectId: string; companyInfo?: CompanyInfo; generalBrief?: GeneralBrief };
  status: GenerateStatus;
  scenes: unknown[];
}): boolean {
  return s.meta.projectId !== "" || s.status !== "idle" || s.scenes.length > 0 || hasWizardBrief(s.meta);
}

/** 書き出し中（rendering/encoding）か。再実行・プロジェクト切替/削除・素材編集のブロック判定で共有（#379/#547 P2-1）。 */
export function isExportBusy(phase: ExportPhase): boolean {
  return phase === "rendering" || phase === "encoding";
}
// 書き出し中に素材/BGM を変更しようとしたときの案内（#547 P2-1・§2-5 次の行動）。ガードは無言 no-op にせず
// これを出す＝素材画面以外（場面編集・ウィザードは importError を表示）からの操作でも「押しても効かない」を避ける（ADR-0026④）。
const EXPORT_BUSY_ASSET_MSG = "書き出しが終わるまで、素材の追加や変更はできません。書き出しが終わってからお試しください。";
const EXPORT_BUSY_BGM_MSG = "書き出しが終わるまで、BGM は変更できません。書き出しが終わってからお試しください。";
const EXPORT_BUSY_TEMPLATE_MSG = "書き出しが終わるまで、見た目パターンは変更できません。書き出しが終わってからお試しください。";
const IDLE_EXPORT_RUN: ExportRunState = {
  phase: "idle",
  progress: { done: 0, total: 0 },
  resultPath: "",
  message: "",
  bgmWarning: "",
  duckMerged: false,
  cancelling: false,
  resultUnseen: false,
};
/** 書き出し画面の入力（ファイル名・画質・字幕）。仕上がり確認（BGM選び）への往復で ExportScreen が
 *  再マウントされても入力を失わないよう画面横断で保持する（#410 sub3 レビュー・exportRun と同じ transient state）。
 *  fileName=null は「プロジェクト名から既定」。永続 JSON ではないので schema 影響なし。 */
export interface ExportFormState {
  fileName: string | null;
  size: string;
  withSubtitle: boolean;
}
const IDLE_EXPORT_FORM: ExportFormState = { fileName: null, size: "fullhd", withSubtitle: true };
/** 声設定の編集可能パラメータのみ（defaultVoiceId は必須なので更新対象から除外）。 */
export type VoiceParamPatch = Partial<Pick<VoiceSettings, "speed" | "pitch" | "intonation" | "volume">>;
/** BGM設定の編集可能フィールドのみ（assetId は取り込み時に確定するので更新対象から除外）。 */
export type BgmPatch = Partial<Pick<BgmSettings, "volume" | "enabled" | "loop" | "fadeInSec" | "fadeOutSec">>;
/** Undo/Redo が出し入れする文書slice（ADR-0020：assets は含めない＝素材取込のディスクIOは undo 対象外）。 */
type DocSnapshot = { meta: ProjectHeader; parts: Part[]; scenes: Scene[] };

/** 「まとめて標準にする」（#547）の結果。番号は利用者が見る場面番号（1始まり）。 */
export interface StandardLookApplyResult {
  /** 標準の見た目にした場面。 */
  fixed: number[];
  /** 合う標準が無くて直せなかった場面（押した後も項目が残る理由）。 */
  unfixable: number[];
  /** 直したが、動画に出なくなった中身（写真・文字・立ち絵）がある場面（確認が要る）。 */
  lostContent: number[];
}

interface ProjectState {
  status: GenerateStatus;
  /** 現在のたたき台が「AI 生成直後」か（#467）。generate 成功でのみ true。白紙/手動/読込済みは false。
   *  たたき台の「ゆうこ(AI)が作成した」文言はこれが true のときだけ出す＝表示と実挙動を一致させる（ADR-0026）。 */
  draftFromAi: boolean;
  saveStatus: SaveStatus;
  /** 素材の取り込み失敗のユーザー向け文言（§2-5。プロジェクト保存状態とは別物。再試行/成功で消える）。 */
  importError: string | null;
  /** Project の見出し情報（projectId/名前/目的/各種設定）。Asset/Part/Scene は別フィールド。 */
  meta: ProjectHeader;
  parts: Part[];
  scenes: Scene[];
  warnings: Warning[];
  templates: Template[];
  assets: Asset[];
  /** 素材の表示用src（data URL）。assetId→src。project.json には入れず永続化しない。 */
  assetSrcById: Record<string, string>;
  /** テンプレ所有素材の表示用src（data URL）。tmpl_asset_NNN→src（ADR-0021・グローバル・プロジェクト非依存）。起動時に一括ロード。 */
  templateAssetSrcById: Record<string, string>;
  /** 生成済みナレーション音声（data URL）。キーは単一 narration＝sceneId／掛け合い＝lineAudioKey(sceneId,lineId)（ADR-0015 PR-C2）。メモリ保持し保存時に voicePath として永続化する。 */
  narrationAudioById: Record<string, string>;
  /**
   * 前回保存以降に新規生成された音声キー（narrationAudioById のキー部分集合・#390）。保存時はこの集合だけ WAV 書き出しし、
   * 未変更（＝既に voicePath を持つ）音声の再書き出しを避ける（保存の高速化）。project.json には入れず永続化しない。
   */
  _dirtyAudioKeys: Set<string>;
  /** 「全場面の声を作成」実行中フラグ（多重起動防止）。 */
  isGeneratingNarration: boolean;
  /** 素材/BGM の取り込み中フラグ（多重取り込み防止・取り込み中表示）。 */
  isImporting: boolean;
  /**
   * まとめて取り込んでいるときの進み具合（#858）。`null`＝出さない（1件だけ／取り込んでいない）。
   *
   * ⚠️ **1件だけのときは出さない**＝一瞬出て消える表示は雑音になる。
   * project.json には入れず永続化しない（取り込み中だけの状態）。
   */
  importProgress: { done: number; total: number } | null;
  /** 見た目パターンの保存/削除/素材登録が非同期実行中か（#570 レビュー）。最初の await 前に立て、書き出し開始側が
   *  これを見て止まる＝isImporting と同じ「開始の相互排他」。書き出し中の見た目変更で MP4 とプレビュー/保存がずれるのを防ぐ。 */
  isTemplateMutating: boolean;
  /** ナレーション生成に失敗したときのユーザー向け文言（成功/再試行で消える）。 */
  narrationError: string | null;
  /** BGM 取り込みに失敗したときのユーザー向け文言（§2-5。次のBGM操作で消える）。保存状態とは別物。 */
  bgmError: string | null;
  /** AI 構成案の生成に失敗したときのユーザー向け文言（§2-5。再生成/成功で消える）。UI は status==="error" 時にこれを表示する。 */
  aiError: string | null;
  /** AI（鍵があれば実プロバイダ／無ければ Mock）→ 検証/変換 → 内部 Scene を生成してストアへ反映する。 */
  generate: () => Promise<void>;
  /**
   * 画面に直接landしたときの自動たたき台生成（#384・§2-6）。status=idle かつ**外部送信にならない（Mock）**ときだけ生成する。
   * 実プロバイダ（Gemini キーあり）では、送信前確認（ConfirmScreen）を通らない自動送信を避けて何もしない
   * ＝画面は空状態のまま（利用者はウィザード→確認画面の同意フローへ）。Mock は従来どおり利便性のため生成する。
   */
  autoGenerateIfSafe: () => Promise<void>;
  /** 生成の世代番号（#402・内部）。generate 開始で進め、cancelGeneration でも進める。
   *  in-flight の generate は自分の世代が現行と一致するときだけ結果を反映する（キャンセル/後発生成で置換されたら破棄）。 */
  _generationSeq: number;
  /** 生成中のキャンセル（#402）。世代を進めて in-flight の結果適用を無効化し、既存の場面があれば ready・無ければ idle へ戻す。 */
  cancelGeneration: () => void;
  /** デモ/テスト用にエラー状態へ。 */
  fail: () => void;
  reset: () => void;
  /**
   * **いま開いている文書の世代**（#762）。開き直す・新規にする・消すたびに1つ進む。
   * ⚠️ 照合に `projectId` を使わない＝**新規の動画は id を持たない**（保存で初めて採番する）ので、
   * 保存中に別の新規を作ると「どちらも id 無し」で同じものに見え、**採番した id が別の文書へ乗る**。
   */
  _docEpoch: number;
  /** 新規プロジェクト（作業状態を初期化）。 */
  newProject: () => void;
  /** 白紙から作る（ウィザード/AI を通らない・#393）。空プロジェクトにし status を "ready" にして自動生成（§2-6）を発火させない。 */
  newBlankProject: () => void;
  /**
   * 動画を**複製する**（#395）＝同じ会社・シリーズの動画を作り直すときの土台。
   * 素材・場面・声・設定ごとコピーし、**新しい動画として開く**。
   * 成功したら新しい `projectId`、できなければ `null`。
   */
  duplicateProject: (projectId: string) => Promise<string | null>;
  /** 生成失敗/中断から手動作成へ入る（#393 P1・12 §9.3／15）。入力済みの会社情報・素材は残し、status を "ready"・
   *  aiError をクリアして手動で組む状態にする（AI 生成はしない＝draftFromAi=false）。 */
  startManualEdit: () => void;
  /** 現在の状態を project.json として保存する。進行中の保存があればその完了を待つ（多重起動防止＋await で保存完了を保証・#256）。 */
  saveProject: () => Promise<void>;
  /** 一覧に出す小さな絵を焼き直す（#397・内部用）。 */
  _refreshProjectThumbnail: (projectId: string) => Promise<void>;
  /** 実際の保存処理（内部・saveProject 経由でのみ呼ぶ）。 */
  _doSave: () => Promise<void>;
  /** 保存済みプロジェクトを読み込んで反映する。 */
  loadProject: (projectId: string) => Promise<void>;
  /** 保存済みプロジェクトの要約一覧を返す。 */
  listProjects: () => Promise<ProjectSummary[]>;
  /** 保存済みプロジェクトをディスクから完全に削除する（#212）。 */
  deleteProject: (projectId: string) => Promise<void>;
  /** 保存済みプロジェクトの名前（projectName）を変更して保存する（#241）。 */
  renameProject: (projectId: string, newName: string) => Promise<void>;
  /** 焼き出したときに増えるディスク容量（バイト）と、持っていけないもの（焼く前の確認用・ADR-0032 決定13）。 */
  estimateBake: (range: BakeRange) => Promise<{ bytes: number; notes: BakeNote[] }>;
  /** タイムライン編集の形式へ焼き出して**新しいプロジェクト**として保存する（片道・ADR-0032 決定16）。 */
  bakeToTimeline: (range: BakeRange, projectName: string) => Promise<{ projectId: string; notes: BakeNote[] }>;
  /** 焼き出しの変換だけ（内部・estimateBake / bakeToTimeline が共有＝見積りと本番で同じ結果を見る）。 */
  _bake: (range: BakeRange, projectName: string, projectId?: string) => BakeResult;
  /** 編集中プロジェクトの名前を変更する（#252・メモリの meta.projectName を更新＝保存/自動保存で永続化）。 */
  setProjectName: (name: string) => void;
  /** 指定シーンを更新する（編集→プレビュー即反映）。 */
  updateScene: (sceneId: string, update: (scene: Scene) => Scene) => void;
  /** 末尾パートに新しい空の場面を追加し、その sceneId を返す（既定テンプレ）。テンプレ未読込時は ""。 */
  addScene: () => string;
  /** 指定の場面を削除する（パートからも除き、order を 1..N に振り直す）。 */
  removeScene: (sceneId: string) => void;
  /**
   * 開いたプロジェクトに**旧・場面横断タイムラインの手編集**（`timelineOverlay.clips`）が残っているか（#635）。
   * データは消さないが動画には出さないので、画面が一言断るために使う（`15 §6` TIMELINE_OVERLAY_RETIRED）。
   */
  hasRetiredTimelineEdits: boolean;
  /** その案内を閉じる（読み終えたら出し続けない）。 */
  dismissRetiredTimelineNotice: () => void;
  /** 場面を上/下へ1つ移動する（表示順＝配列順を入れ替え、order と part.sceneIds を整合）。 */
  moveScene: (sceneId: string, direction: "up" | "down") => void;
  /** 場面を任意の位置（移動後の配列index）へ動かす（ドラッグ&ドロップ・#398）。1操作=1履歴。 */
  moveSceneToIndex: (sceneId: string, toIndex: number) => void;
  /** 要素アニメーション（キーフレーム）を追加し、その id を返す（④・ADR-0019・timelineOverlay.animations）。 */
  addAnimation: (sceneId: string, targetId: string, keyframes: Keyframe[]) => string;
  /** 要素アニメーションのキーフレームを差し替える（フェードインの所要秒変更など）。Undo は meta スナップショットで自動。 */
  updateAnimation: (animId: string, keyframes: Keyframe[]) => void;
  /** 要素アニメーションを削除する（「動きをやめる」）。 */
  removeAnimation: (animId: string) => void;
  /** 指定場面の指定要素(targetIds)に紐づくアニメを取り除く（要素削除時の孤児掃除・④）。対象なしなら何もしない。 */
  removeAnimationsForElements: (sceneId: string, targetIds: string[]) => void;
  /**
   * 取り出しておいた動きを、複製先の場面・要素へ宛て直して足す（要素の複製・貼り付け・#770）。
   * 引き継がないと**動く要素を複製したのに動かない複製**ができる（消す側は対で片づけている）。
   */
  addAnimationsForElement: (sceneId: string, targetId: string, source: readonly ElementAnimation[]) => void;
  /** 場面を複製して直後に挿入し、新しい sceneId を返す（セリフは引き継ぎ・音声は作り直し）。 */
  duplicateScene: (sceneId: string) => string;
  /** 場面のセリフを splitIndex（カーソル位置）で分け、1場面を2場面にする。新しい sceneId を返す。 */
  splitScene: (sceneId: string, splitIndex: number) => string;
  /** 掛け合い場面（scene.lines）を lineIndex（この行から後ろ）で2場面に分ける。新しい sceneId を返す（#405）。 */
  splitSceneAtLine: (sceneId: string, lineIndex: number) => string;
  /** ウィザードで入力した目的・会社情報を現在のプロジェクト(meta)へ反映する（保存・生成で使う）。 */
  applyProjectInfo: (input: {
    videoKind?: VideoKind;
    purpose: Purpose;
    companyInfo?: CompanyInfo;
    generalBrief?: GeneralBrief;
    additionalNotes?: string;
    /** トーン（toneSettings.tone へ。未指定なら既存維持）。 */
    tone?: string;
    /** 読み上げの声の感じ（speed/pitch/intonation を voiceSettings へ。未指定なら既存維持）。 */
    voice?: VoiceStyleParams;
    /** 動画の向き（aspectRatio を videoSettings へ。未指定なら既存維持・ADR-0012/B5）。 */
    aspectRatio?: Orientation;
  }) => void;
  /** 動画全体の向きを切り替え、各場面のテンプレを同カテゴリ・新向きへ写像する（B5-b・ADR-0012）。
   *  切替えた件数と、対応する見た目が無く原状維持した件数を返す（UIの結果表示用）。 */
  changeOrientation: (target: Orientation) => { changed: number; unsupported: number };
  /**
   * 見た目が見つからない場面を**まとめて標準の見た目にする**（#547）。直した場面数を返す。
   * TEMPLATE_NOT_FOUND は自動置換しない方針（黙って中身が減った動画を出さない）だが、別PCで開いた等で
   * 多数の場面が該当すると手直しが重いので、**利用者の明示操作**として一括で寄せられるようにする（15 §3）。
   * 当てる先が無い場面（その向き・種類の同梱テンプレが無い）は触らない。Undo 可（pushHistory）。
   */
  applyStandardLookToUnresolvedScenes: () => StandardLookApplyResult;
  /** 動画全体のフォントを切り替える（videoSettings.fontId・保存時に永続化）。 */
  setFontId: (fontId: FontId) => void;
  /**
   * クレジットの見せ方を変える（ADR-0025・#359）。
   * ⚠️ **About 画面のクレジットは必須で不変**（`13 §4`）＝ここで変わるのは**動画に焼く側**だけ。
   */
  setCreditDisplay: (patch: Partial<CreditDisplay>) => void;
  /**
   * 音の自動処理（#257 ダッキング／#259 ノーマライズ）を部分更新する。
   * ⚠️ **プロジェクト単位**（`videoSettings.audioAuto`）＝場面ごとには持たない（ADR-0032 追補4）。
   */
  updateAudioAuto: (patch: AudioAutoSettings) => void;
  /** 声設定（話速・高さ・抑揚など）を部分更新する（現在のプロジェクト・保存時に永続化）。defaultVoiceId は更新不可。 */
  updateVoiceSettings: (patch: VoiceParamPatch) => void;
  /** BGM設定（音量など）を部分更新する（現在のプロジェクト・保存時に永続化）。assetId は更新不可。 */
  updateBgmSettings: (patch: BgmPatch) => void;
  /** 標準BGM（同梱）を選ぶ（bundledBgmId を設定し assetId を解除・BGMを有効化）。 */
  setBundledBgm: (bundledBgmId: BundledBgmId) => void;
  /**
   * **この動画にある音の素材**を BGM にする（PR #910 レビュー 🟡）。
   *
   * ⚠️ **選ぶ導線が無かった**＝よく使う素材から音を取り込んでも `project.assets` に入るだけで、
   * BGM にできるのは**ファイルを読み込む**か**同梱の3曲**だけだった。取り込みの案内は
   * 「「動画を保存」のBGMから選べます」と言っているのに**選べない**（§2-5＝実行できない行動）。
   */
  setBgmAsset: (assetId: string) => void;
  /** 素材を更新する（素材管理：説明/タグ/公開チェック等）。 */
  updateAsset: (assetId: string, update: (asset: Asset) => Asset) => void;
  /** 素材を削除する。 */
  removeAsset: (assetId: string) => void;
  /**
   * 素材を**まとめて**消す（#348・使っていない素材の整理）。
   *
   * ⚠️ **ファイルも片づける**＝一覧から消えてもプロジェクトフォルダに残ると、容量だけ食い続ける
   *（整理のための機能で片づかない、を作らない）。消せなくても失敗にしない（無害な余り）。
   */
  removeAssets: (assetIds: readonly string[]) => void;
  /** 見た目パターンのパックを取り込み、既存に統合する（templateId で重複排除・B2/ADR-0012）。 */
  addTemplatePack: (templates: Template[]) => void;
  /** ユーザー作成テンプレ（グローバル）を読み込み templates にマージする（起動時・ADR-0017）。 */
  loadUserTemplates: () => Promise<void>;
  /** ユーザーテンプレを保存し一覧へ反映する（新規 id は allocateUserTemplateId で払い出し済み前提）。 */
  saveUserTemplate: (template: Template) => Promise<void>;
  /** ユーザーテンプレを削除し一覧から外す（成功＝true）。開いているプロジェクトの参照場面は即時に標準へ置換し
   *  （#458・substituteDeletedTemplateInScenes）、他プロジェクト（disk）の参照は次回の読込/表示時の §9 補正に委ねる。 */
  deleteUserTemplate: (templateId: string) => Promise<boolean>;
  /** 既存テンプレ（同梱/ユーザー）を複製してマイテンプレ（ユーザーテンプレ）として保存し、新 id を返す。 */
  duplicateAsUserTemplate: (sourceTemplateId: string) => Promise<string>;
  /** ゼロからマイテンプレを新規作成して保存し、新 id を返す（失敗時は ""）。向き/カテゴリ/名前を指定（ADR-0017）。 */
  createBlankUserTemplate: (name: string, category: SceneCategory, orientation: Orientation) => Promise<string>;
  /** テンプレ既定素材を取り込み、採番した tmpl_asset id を返す（失敗・非 Tauri は null）。表示用 src も登録する（ADR-0021）。 */
  registerTemplateAsset: (file: File) => Promise<string | null>;
  /** テンプレ保存/削除の失敗文言（§2-5。成功/次操作で消える）。保存状態とは別物。 */
  templateError: string | null;
  clearTemplateError: () => void;
  /** 専用の見た目パターン編集画面で編集中のテンプレ id（#271。param 無しの画面遷移で「どれを編集するか」を渡す）。 */
  editingTemplateId: string | null;
  setEditingTemplateId: (templateId: string | null) => void;
  /** 場面編集画面を「どの場面で開くか」を渡す id（#400。onNavigate はペイロードを運べないため editingTemplateId と同方式）。
   *  たたき台の行ボタン・仕上がり確認「場面を直す」等が set→遷移し、SceneEditScreen が初期選択に使う。null=先頭場面。 */
  editingSceneId: string | null;
  setEditingSceneId: (sceneId: string | null) => void;
  /** ウィザードの現在ステップ（#401）。画面遷移/離脱でローカル state が消えても復元できるよう store に保持する。
   *  サイドバー離脱→復帰・confirm「キャンセル」→ウィザードで、step0 に戻らず直前のステップを開く。新規/読込で 0。 */
  wizardStep: number;
  setWizardStep: (step: number) => void;
  /** 送信前確認（ConfirmScreen）から「キャンセル」で戻る画面（#423・§2-6）。ウィザード起点は既定（null＝"wizard"）、
   *  たたき台の「作り直す」起点は "draft"。ConfirmScreen がマウント時に読み取り消費する（editingSceneId と同方式の一度きりペイロード）。 */
  confirmReturnTo: ScreenId | null;
  setConfirmReturnTo: (screen: ScreenId | null) => void;
  /** 仕上がり確認（PreviewScreen）の「戻る」で戻る画面（#410 sub3）。多入口（たたき台/場面編集/書き出し）
   *  のため、開いた側が「来た画面」を記録する。confirmReturnTo と違い読み取り後も消費せず永続させる＝Preview→
   *  タイムライン→「仕上がり確認へ戻る」で Preview に再入場しても直前の入口ラベルを保つため（消費すると退行）。
   *  ※「編集中の場面」自体は editingSceneId（一度きり）で別に受け渡す（場面編集→仕上がり確認→戻るで同じ場面へ）。 */
  previewReturnTo: ScreenId | null;
  setPreviewReturnTo: (screen: ScreenId | null) => void;
  /** 書き出しの進行状態（#379・画面横断）。ExportScreen が更新し、他画面から戻っても進捗が見える。 */
  exportRun: ExportRunState;
  /** 書き出し状態を部分更新する（ExportScreen の setPhase/setProgress 等の単一入口）。 */
  setExportRun: (patch: Partial<ExportRunState>) => void;
  /** 書き出し画面の入力（ファイル名・画質・字幕）。仕上がり確認への往復で失わないよう画面横断で保持（#410 sub3）。 */
  exportForm: ExportFormState;
  setExportForm: (patch: Partial<ExportFormState>) => void;
  /** 画像ファイルを素材に取り込み、プロジェクトフォルダへ永続化する（表示用srcも即時更新）。 */
  setAssetImage: (assetId: string, file: File) => Promise<void>;
  /** 新しい素材（画像/動画）を登録する。動画は生バイトで取り込み（メモリ節約）、画像は data URL。 */
  addAsset: (file: File) => Promise<void>;
  addAssetByPath: (path: string) => Promise<void>;
  /**
   * 素材の**ファイルだけを差し替える**（#347）。`assetId` は変えない。
   *
   * ⚠️ **`assetId` を付け替えないのが肝**（ADR-0024＝Asset は元素材の源泉）＝配置・尺・
   * キーフレーム・字幕の紐づけは**構造的に**そのまま残る（参照の書き換え漏れが起きない）。
   * 使いどころは2つ＝**見つからなくなった素材の復旧**と、**使ったまま別のファイルへ差し替え**。
   */
  relinkAssetByPath: (assetId: string, srcPath: string) => Promise<void>;
  /**
   * 実体が見つからない素材の id（#347）。**素材の画面・公開前チェックを開いたとき**に調べ直す
   *（素材は**アプリの外**で動かされるので、開くたびに確かめる）。文書を切り替えたら捨てる。
   * 空＝全部そろっている（調べていない状態と区別しない＝**無いことを警告に使わない**）。
   */
  missingAssetIds: string[];
  /**
   * ブランドキット（ADR-0036・#351）。会社の既定フォント・色・ロゴ。
   * ⚠️ **動画の中身ではない**（`project.json` には入らない）＝ここに置くのは、
   * 色を選ぶところなど**あちこちから同じものを見る**ため（渡し歩くと配り忘れる）。
   */
  brandKit: BrandKit;
  /** 見つからない素材を調べ直す（#347）。 */
  refreshMissingAssets: () => Promise<void>;
  /** ブランドキットを読み直す（#351）。 */
  refreshBrandKit: () => Promise<void>;
  /**
   * 会社の見た目を覚え直す（#351）。**書けたら `true`**（α-6 出口監査 🟡23）。
   * ⚠️ **書けなかったら画面を戻して理由を `brandKitError` に置く**＝保存できていないのに覚えた顔をしない。
   */
  updateBrandKit: (next: BrandKit) => Promise<boolean>;
  /** 会社の見た目の保存で出た理由（§2-5）。 */
  brandKitError: string | null;
  /**
   * 会社の見た目を**読めなかった**か（差分再監査 3巡目）。**「何も覚えていない」とは別**＝
   * 空に潰すと、直後の書き込みが**覚えていた中身をそのまま上書き**して消える。
   */
  brandKitUnreadable: boolean;
  /**
   * ブランドキットをいまの動画へ**適用し直す**（#351 決定3）。**できたかどうかを返す**。
   * ⚠️ **自動では遡及しない**（§2-5）＝この明示操作のときだけ。何がいくつ変わるかは
   * 押す前に `planBrandApply` で見せる。取り消し（Undo）で戻せる。
   * ⚠️ **ロゴの取り込みは失敗しうる**（置き場から消えている等）ので、**成功を騙らない**ために
   * 結果を返す（呼ぶ側が「反映しました」と言ってよいかを決める）。
   * ⚠️ **`addedLogo` も返す**（差分再監査）＝履歴は `{meta,parts,scenes}` だけを覚える（ADR-0020＝
   * assets は入れない）ので、**取り消しでロゴは戻らない**。返さないと画面が
   * 「元に戻す」で全部戻るかのように見せてしまう（§2-5＝できないことを名指ししない）。
   */
  applyBrandKit: () => Promise<{ ok: boolean; applied: boolean; addedLogo: boolean; error: string | null }>;
  /**
   * 新しい動画へブランドキットを焼き込む（#351 決定2＝コピー）。`newBlankProject` から呼ばれる。
   * ⚠️ **既にある動画には効かない**（そちらは `applyBrandKit` の明示操作だけ）。
   */
  applyBrandKitToNew: () => Promise<void>;
  /**
   * いま持っている持ち込みフォントの id（#261）。**`null` ＝まだ調べていない**
   *（`missingAssetIds` と同じ流儀＝調べていないのに「全部そろっている」と言わない）。
   */
  userFontIds: string[] | null;
  /**
   * 持ち込みフォントの一覧（**名前つき**・α-6 出口監査 🔴1）。
   *
   * ⚠️ **id だけでは選ばせられない**＝`FontPicker` は「その字形で名前を出す」ので表示名が要る。
   * ⚠️ **部品が自分で store から読む**（ADR-0036 の色と同じ流儀）＝`FontPicker` の呼び出しは
   * 6か所あり、一覧を渡し歩くと**配り忘れた所だけ同梱3種**になる（実際にそうなっていた）。
   * `userFontIds` は「調べたか」を含む判定（`null`＝まだ調べていない）に使い続ける。
   */
  userFonts: UserFont[];
  /**
   * 目録が**読めなかった**か（α-6 出口監査 🟡19 のレビュー）。**「まだ調べていない」とは別**＝
   * あちら（`userFontIds === null`）は待てば埋まるので止めないが、こちらは待っても埋まらない。
   * 黙ると**別の字体の動画を成功として出す**ので、公開前チェックがそう言って止める（ADR-0038）。
   */
  userFontsUnreadable: boolean;
  /** 持ち込みフォントの一覧を調べ直す（#261）。**実体があるものだけ**が入る。 */
  refreshUserFonts: () => Promise<void>;
  /** フォントを持ち込む（#261）。成功したら足した id、できなければ `null`（理由は `fontError`）。 */
  addUserFont: (srcPath: string, displayName: string) => Promise<string | null>;
  /**
   * 持ち込みフォントを消す（#261）。使っている動画には公開前チェックが断りを出す。
   * **外せたら `true`**（α-6 出口監査 🟡13）＝`addUserFont` と同型。⚠️ **失敗を成功として知らせない**
   *（外せていないのに「外しました」と出すと、赤い理由と並んで**一覧にも残ったまま**になる＝§2-5）。
   */
  removeUserFont: (fontId: string) => Promise<boolean>;
  /** フォントの取り込み/削除で出た理由（§2-5）。 */
  fontError: string | null;
  /**
   * 文字の形まわりの**知らせ**（`/canon-check` ℹ️）。⚠️ **成功を `fontError` に載せない**＝
   * 画面はそれを赤字の `role="alert"` で出すので、うまくいったのに**失敗のように見える**。
   */
  fontNotice: string | null;
  /**
   * 素材を**まとめて**取り込む（#858）。1件ずつ順に `addAsset`/`addAssetByPath` を通す。
   *
   * ⚠️ **失敗しても止めない**（§2-5）＝成功した分は残し、入らなかったものを名前で示す。
   * ⚠️ **必ず `await` で1件ずつ**（11.2）＝`asset_NNN` は `get().assets` を見て採る。
   * 並行に走らせると、2件目以降が `isImporting` ガードに黙って弾かれる（入ったつもりで消える）。
   */
  addAssets: (items: File[] | string[]) => Promise<void>;
  /**
   * ユーザー素材ライブラリ（ADR-0035・#260）から、この動画へ**コピー**して取り込む。
   * 成功したら足した素材の id、できなければ `null`（理由は `importError`）。
   * ⚠️ **参照ではなくコピー**＝プロジェクトは自己完結のまま（ADR-0024 決定6）。
   */
  importFromLibrary: (libraryAssetId: string) => Promise<string | null>;
  /**
   * 動画の**その瞬間**を静止画として切り出し、**普通の写真素材**として足す（#349）。
   * 成功したら足した素材の id、できなければ `null`（理由は `importError`）。
   */
  captureVideoFrame: (videoAssetId: string, atSec: number) => Promise<string | null>;
  clearImportError: () => void;
  /** 読めなくなった会社の見た目を作り直す（`updateBrandKit` の門の唯一の出口・§2-5）。 */
  rebuildBrandKit: () => Promise<boolean>;
  /** BGM 取り込みエラー文言を消す（通知を閉じる）。 */
  clearBgmError: () => void;
  /** BGM 音声を取り込み、bgmSettings に設定する（プロジェクトに1つ。既存があれば差し替え）。 */
  setBgm: (file: { name: string; dataUrl: string }) => Promise<void>;
  /** 指定場面のナレーション音声を生成する（narration.status を更新）。 */
  generateNarration: (sceneId: string, opts?: { fromBulk?: boolean }) => Promise<void>;
  /** セリフのある全場面のナレーション音声を生成する。 */
  generateAllNarrations: () => Promise<void>;
  /**
   * 声の作成を中止する（#547 P2-6）。**これ以上新しい合成を始めない**だけで、できあがった声は取り消さない
   * （作った音声を捨てない・開始済みの合成は届いた時点で反映される）。待機中のまま残った「準備中」は未作成へ戻す。
   */
  cancelNarrationGeneration: () => void;
  /** 直前の一括作成を中止したか（UI の案内用）。次に作成を始めると false へ戻る。 */
  narrationCancelled: boolean;
  /** 声の作成の世代番号（内部）。中止・新規開始で進め、実行中のループは自分の世代が現行と一致するときだけ次を始める。 */
  _narrationRunSeq: number;
  /** 設定の試聴：サンプル文を現在の声設定で合成し、音声 data URL を返す。 */
  synthesizePreview: () => Promise<string>;
  /**
   * 読み方の聞き比べ（ADR-0037 決定6・#350）。**読みと下がる場所をその場で鳴らす**。
   * ⚠️ 辞書には**まだ入れていない**ものを聞くので、辞書経由（言葉→読み）ではなく
   * **読みをそのまま読ませて**アクセントだけ差し替える＝登録前に確かめられる。
   */
  synthesizeReading: (yomi: string, accentType: number) => Promise<string>;
  // ── Undo/Redo（ADR-0020・#211）。文書slice（meta/parts/scenes）のスナップショット履歴。assets は対象外。 ──
  /** 過去（undo で戻る先）。末尾が直近の「編集前」。 */
  past: DocSnapshot[];
  /** 未来（redo でやり直す先）。 */
  future: DocSnapshot[];
  /** 連続操作（ドラッグ等）を1ステップに合成するためのネスト深さ（内部）。 */
  _historyGroupDepth: number;
  /** グループ中でまだ snapshot 未記録か（内部）。最初の実変更で記録＝未変更 focus/pointerdown では履歴を消費しない（#389）。 */
  _historyGroupPending: boolean;
  /** 文書を変える操作の「適用前」に呼び、現在状態を past へ積む（グループ中は最初の実変更の1回だけ積む・transient 変更では呼ばない）。 */
  pushHistory: () => void;
  /** 連続操作の開始/終了。開始では記録せず（遅延）、グループ中の最初の pushHistory＝最初の実変更で1回だけ「編集前」を記録する。 */
  beginHistoryGroup: () => void;
  endHistoryGroup: () => void;
  /** 取り消し（直前の編集前へ戻す）。 */
  undo: () => void;
  /** やり直し（取り消した編集を再適用）。 */
  redo: () => void;
}

/** 文書slice（undo 対象）を現在状態から取り出す。 */
const docSnapshot = (s: ProjectState): DocSnapshot => ({ meta: s.meta, parts: s.parts, scenes: s.scenes });

/**
 * 取り消し・やり直しで戻した文書へ、**いまの動画の身元（`projectId`）を残す**（差分再監査 🔴）。
 *
 * ⚠️ **番号は「編集の中身」ではなく「実体の身元」**＝どのフォルダに保存するかを決める値で、
 * 採るのは**遅い**（最初の保存か、最初の素材の取り込み）。採る前に積まれた履歴へ戻ると
 * `projectId` が `""` に戻り、**次の自動保存が別の番号で別フォルダへ**書く＝素材は前のフォルダに
 * あるので新しい方からは全部「見つかりません」になり、一覧に同じ名前の動画が2つ残る。
 * 取り消しても素材は戻らない（`assets` は履歴の外＝ADR-0020）ので、**取り消しで壊れる**。
 *
 * ⚠️ **一度採った番号は戻さない**（`||` で live 優先）＝番号は `""` → 採番 の一方向にしか動かないので、
 * これで「履歴が古い番号を持っている」ケースを作らない。ADR-0020 の「meta/parts/scenes を戻す」は
 * **編集内容**の話で、フォルダ名の身元まで巻き戻す約束ではない。
 */
function keepIdentity(restored: DocSnapshot, live: ProjectState): DocSnapshot {
  const projectId = live.meta.projectId || restored.meta.projectId;
  return projectId === restored.meta.projectId
    ? restored
    : { ...restored, meta: { ...restored.meta, projectId } };
}

// 進行中の保存 Promise（#256 レビュー🔴）。多重起動は防ぎつつ、**`await saveProject()` が「保存の完了」を保証**する
// （早期 return だと書き出し前の保存が no-op になり projectId 未確定→画像欠落の恐れ）。進行中があれば同じ Promise を待つ。
let saveInFlight: Promise<void> | null = null;
/**
 * 直近に焼いた一覧の絵の印（#397）。**文書には持たない**＝絵は作り直せるもので、動画の中身ではない。
 * 別の動画を開いたら `null` へ戻す（前の動画の印で焼き直しを飛ばさない）。
 *
 * ⚠️ **どの動画の印かまで持つ**（PR #889 レビュー 🟡）＝印だけだと、**中身が同じ別の動画**
 *（複製した直後がまさにそれ）で「変わっていない」と誤判定し、**一度も焼いていない側の絵が
 * 焼かれないまま**になる。投げっぱなしで走るので着地の順番も保証できない。
 */
let lastThumbnail: { projectId: string; signature: string } | null = null;
/**
 * 進行中の**一覧の絵の焼き込み**（#927）。保存の後に**投げっぱなし**で走るので、
 * `saveInFlight` には入らない＝削除の待ちからも外れていた。
 *
 * ⚠️ **消した後に着地すると、`preview.png` だけのフォルダが復活する**（一覧には出ないので
 * 利用者からは気づけない残骸）。`deleteProject` がこれも待つ。
 */
let thumbnailInFlight: Promise<void> | null = null;
/**
 * 消した動画の id（#927）。**待ったあとに始まった焼き込み**を止めるための印＝
 * 待つだけでは、待っている最中に次の焼き込みが積まれたときに素通りする。
 */
const deletedProjectIds = new Set<string>();

// 音声合成リクエストの世代（音声キー＝sceneId／lineAudioKey ごと）。synthesize は非同期で await 中に後発の生成が来得るため、
// 完了時に「この結果がまだ最新の要求か」を token で判定する。後発が来ていれば（token 不一致）先発の完了は状態へ一切触れない
// ＝新しい pending や新しい結果を消さない。不一致（合成中に入力変更）で pending を none へ戻す処理が、後発の要求を壊さないための保護（#390 レビュー P1）。
const synthReqSeq = new Map<string, number>();
function nextSynthSeq(key: string): number {
  const n = (synthReqSeq.get(key) ?? 0) + 1;
  synthReqSeq.set(key, n);
  return n;
}
function isLatestSynth(key: string, token: number): boolean {
  return synthReqSeq.get(key) === token;
}

/** 場面複製/分割で、元場面の要素アニメ（④・ADR-0019）を新場面へ引き継いだ meta を返す（無ければ meta そのまま）。 */
function metaWithDuplicatedAnimations(meta: ProjectHeader, srcSceneId: string, newSceneId: string): ProjectHeader {
  const anims = meta.timelineOverlay?.animations;
  if (!anims || anims.length === 0) return meta;
  const copies = duplicateSceneAnimations(anims, srcSceneId, newSceneId, createAnimationId);
  if (copies.length === 0) return meta;
  return { ...meta, timelineOverlay: { ...meta.timelineOverlay, animations: [...anims, ...copies] } };
}

// AI 構成案プロバイダの選択：外部送信になる構成（Tauri かつ Gemini キーあり）なら実 Gemini、なければ Mock
// （非Tauri／オフライン／鍵未設定のフォールバック＝ADR-0010）。判定は willSendExternally に一元化（§2-6/§2-7）。
// 実 AI を試みて失敗したときは Mock に倒さずエラーを伝播する（黙って差し替えない）。
async function generateVideoPlan(input: GenerateVideoPlanInput): Promise<AiVideoPlan> {
  if (await willSendExternally()) {
    return new GeminiProvider(getAiModel()).generateVideoPlan(input);
  }
  return new MockAiProvider().generateVideoPlan(input);
}
// Tauri ではローカル VOICEVOX に接続、ブラウザ開発では Mock（無音）にフォールバック。
const hasTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const voiceProvider: VoiceProvider = hasTauri ? new VoicevoxProvider() : new MockVoiceProvider();

// probeAndThumbVideo の結果を該当素材へ反映する set 更新関数を返す（addAsset/addAssetByPath 共通）。
/**
 * **まだ同じ動画を開いているか**を確かめる合図を作る（#762 の照合を1か所に＝α-6 出口監査 🟡9/🟡21）。
 *
 * ⚠️ 取り込み・コピー・持ち込みは**待っている間に別の動画を開ける**ので、着地の `set` を括らないと
 * **別の動画へ古い中身を書き込む**。番号は動画ごとに採り直すので `asset_003` は両方に居る＝
 * 取り消し（失敗時の巻き戻し）が**新しい方の別の素材を消す**ことまで起きる。
 * ⚠️ **最初の `await` より前に作る**（作った時点の版と比べるため）。
 */
function sameDocGuard(get: () => { _docEpoch: number }): () => boolean {
  const epoch = get()._docEpoch;
  return () => get()._docEpoch === epoch;
}

function applyEnrichment(
  assetId: string,
  enrich: { metadata?: AssetMetadata; thumbnailPath?: string; thumbUrl?: string },
) {
  return (s: { assets: Asset[]; assetSrcById: Record<string, string> }) => ({
    assets: s.assets.map((a) => {
      if (a.assetId !== assetId) return a;
      const next = { ...a };
      if (enrich.metadata) next.metadata = enrich.metadata;
      if (enrich.thumbnailPath) next.thumbnailPath = enrich.thumbnailPath;
      return next;
    }),
    assetSrcById: enrich.thumbUrl
      ? { ...s.assetSrcById, [assetId]: enrich.thumbUrl }
      : s.assetSrcById,
  });
}

/** record から keep に含まれるキーだけ残した新しい record を返す（音声/素材キャッシュの剪定・#390）。 */
function pickKeys<T>(record: Record<string, T>, keep: Set<string>): Record<string, T> {
  const next: Record<string, T> = {};
  for (const k of Object.keys(record)) {
    if (keep.has(k)) next[k] = record[k];
  }
  return next;
}

function defaultHeader(): ProjectHeader {
  const now = new Date().toISOString();
  return {
    projectId: "",
    projectName: "無題のプロジェクト",
    purpose: "new_graduate",
    createdAt: now,
    updatedAt: now,
    videoSettings: defaultVideoSettings(),
    // 新規プロジェクトの会社情報は空で開く（#414・§2-6）。デモ値を既定にすると、未入力のまま進んだとき
    // 「株式会社サンプル」の動画案ができ、実 AI キー設定時は無自覚のまま外部送信されてしまう。
    // ウィザードは各欄の placeholder（例：株式会社サンプル）で入力を案内し、会社名は next() で必須にする。
    companyInfo: {
      companyName: "",
    },
    voiceSettings: defaultVoiceSettings(),
  };
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  status: "idle",
  draftFromAi: false,
  hasRetiredTimelineEdits: false,
  saveStatus: "idle",
  _docEpoch: 0,
  importError: null,
  past: [],
  future: [],
  _historyGroupDepth: 0,
  _historyGroupPending: false,
  meta: defaultHeader(),
  parts: [],
  scenes: [],
  warnings: [],
  templates: loadBundledTemplates(),
  assets: [], // 新規は空（見本素材は実画像が無く混乱の元のため・α）。利用者が素材管理/ウィザードで追加する。
  assetSrcById: {},
  templateAssetSrcById: {},
  narrationAudioById: {},
  _dirtyAudioKeys: new Set(),
  isGeneratingNarration: false,
  narrationCancelled: false,
  _narrationRunSeq: 0,
  isImporting: false,
  importProgress: null,
  missingAssetIds: [],
  brandKit: {},
  brandKitError: null,
  brandKitUnreadable: false,
  userFontIds: null,
  userFontsUnreadable: false,
  userFonts: [],
  fontError: null,
  fontNotice: null,
  isTemplateMutating: false,
  narrationError: null,
  bgmError: null,
  aiError: null,
  templateError: null,
  editingTemplateId: null,
  editingSceneId: null,
  wizardStep: 0,
  confirmReturnTo: null,
  previewReturnTo: null,
  _generationSeq: 0,
  exportRun: IDLE_EXPORT_RUN,
  exportForm: IDLE_EXPORT_FORM,
  autoGenerateIfSafe: async () => {
    // 画面に直接landしたときだけの自動生成（#384・§2-6）。既に生成済み/生成中なら何もしない。
    if (get().status !== "idle") return;
    // 外部送信になる構成（実 Gemini）では、送信前確認（ConfirmScreen）を通らない自動送信をしない。
    // Mock（送信なし）のときだけ従来どおり自動生成する。判定は generate と同じ willSendExternally（§2-7）。
    // 判定自体が失敗（鍵ストアにアクセス不能等で reject）したときは fail-closed で「送らない」側に倒す
    // ＝§2-6（外部送信は事前確認必須）を厳守。ここで generate() へ素通りさせると、再判定が成功した場合に
    // 確認画面を通さず自動送信してしまうため素通りしない。unhandled rejection にしないよう try/catch で握る。
    // 画面は空状態のまま（→ウィザードの導線）。エラー文言（§2-5）は能動的に生成を要求したとき＝generate() の catch が示す。
    let external = true; // 判定不能時の既定＝送信しない側（fail-closed）
    try {
      external = await willSendExternally();
    } catch {
      // 判定不能（鍵ストアにアクセス不能等）＝external は初期値 true のまま＝送らない（fail-closed）。
    }
    if (external) return;
    await get().generate();
  },
  generate: async () => {
    // 多重起動ガード：開発時の StrictMode 二重 mount や連打で generate が同時に走ると、片方が失敗・片方が成功して
    // 「成功の前に失敗表示が出る」競合や、並行呼び出しによる API エラーを招く。生成中は1本だけに絞る（isImporting 等と同方針）。
    if (get().status === "generating") return;
    if (isExportBusy(get().exportRun.phase)) return; // 書き出し中は動画案生成を始めない（進行中の書き出しは snap で進む＝#570 P1 レビュー・15§4）
    // 世代トークン（#402）：この生成の世代を記録し、結果を反映する前に「まだ現行か」を確認する。
    // キャンセル/後発の生成で世代が進んでいたら結果を破棄する（裏で完走しても場面を置き換えない）。
    const seq = get()._generationSeq + 1;
    set({ status: "generating", aiError: null, _generationSeq: seq });
    try {
      // 会社情報・目的・素材はウィザードで反映済み（未経由なら既定値）。
      // 送信前確認（ConfirmScreen）の表示と AI へ渡す内容を一致させるため get() の実データを使う（§2-6）。
      const { meta, assets, templates } = get();
      const { companyInfo, purpose } = meta;
      const plan = await generateVideoPlan({
        videoKind: meta.videoKind,
        companyInfo,
        generalBrief: meta.generalBrief,
        purpose,
        // 対象視聴者: general は generalBrief.targetAudience、recruit は会社情報の「採用対象」（ADR-0011 #12・純粋関数で解決）。
        targetAudience: resolveTargetAudience(meta),
        targetDurationSec: DEFAULT_TARGET_DURATION_SEC,
        // トーン: ウィザードで選んだ toneSettings.tone（未設定なら既定 DEFAULT_TONE・§2-7 で一本化）。
        tone: meta.toneSettings?.tone ?? DEFAULT_TONE,
        additionalNotes: meta.additionalNotes,
        templates: buildTemplateSummaries(templates, meta.videoSettings.aspectRatio),
        assets,
        yukoPoseTags: buildYukoPoseTags(assets),
      });
      if (get()._generationSeq !== seq) return; // キャンセル/後発生成で置換された＝結果を破棄（#402）
      const { parts, scenes, warnings } = transformVideoPlan(plan, {
        templates,
        assets,
        // プロジェクトの向き（縦/横）に一致するテンプレへ補正する（ADR-0012・B4）。
        orientation: meta.videoSettings.aspectRatio,
      });
      if (get()._generationSeq !== seq) return; // 変換中にキャンセルされ得るので反映直前にも再確認（#402）
      set({ status: "ready", parts, scenes, warnings, draftFromAi: true }); // AI 生成直後＝たたき台のAI作成文言を出す（#467）
      // 動画案ができたら未生成のセリフ音声をバックグラウンドで自動生成（非ブロッキング・#176）。
      // 仕上がり確認へ着いた時点で成功分は鳴る。失敗場面は per-scene の「声を作り直す」で作り直せる。
      void get().generateAllNarrations();
    } catch (e) {
      if (get()._generationSeq !== seq) return; // キャンセル済みなら失敗表示も出さない（#402）
      // 失敗の文言を保持し、UI が「次の行動」を出せるようにする（§2-5）。
      // Rust/プロバイダは §2-5 のユーザー向け文言で reject する（鍵未設定→設定へ／不適合→再試行 等）。
      const aiError =
        e instanceof Error ? e.message : typeof e === "string" ? e : "生成に失敗しました。もう一度お試しください。";
      set({ status: "error", aiError });
    }
  },
  cancelGeneration: () => {
    // in-flight の generate の結果適用を無効化し（世代を進める）、既存の下書きがあれば残す（ready）・
    // 無ければ未生成（idle）へ戻す。GeneratingScreen の「キャンセル」から呼ぶ（#402）。
    set((s) => ({
      _generationSeq: s._generationSeq + 1,
      status: s.scenes.length > 0 ? "ready" : "idle",
    }));
  },
  fail: () => set({ status: "error" }),
  // reset/newProject/loadProject も世代を進めて in-flight の generate を無効化する（#402 レビュー）。
  // キャンセル以外の経路（キャンセルせず離脱→ホームで新規/切替）でも、裏で走る旧生成が新しい状態を上書きしないように。
  reset: () => {
    if (isExportBusy(get().exportRun.phase)) return; // 書き出し中は場面/構成を破壊しない（#379 と同方針・#570 レビュー follow-up）
    set((s) => ({
      status: "idle", draftFromAi: false, hasRetiredTimelineEdits: false, saveStatus: "idle", parts: [], scenes: [], warnings: [], aiError: null,
      _generationSeq: s._generationSeq + 1,
      // 声の一括作成も打ち切る（newProject/loadProject と同じ扱い・#547 P2-6）。放置すると空になった文書の上を
      // 空回りで走り続け、「作成中…」と前の文書の「中止しました」を持ち越す。
      _narrationRunSeq: s._narrationRunSeq + 1,
      isGeneratingNarration: false,
      narrationCancelled: false,
    }));
  },
  newProject: () => {
    lastThumbnail = null; // 一覧の絵の印を戻す（#397）＝前の動画の印で焼き直しを飛ばさない
    // 書き出し中は現在の場面/素材を読むため、内容を破壊しない（#379・進行中の書き出しが空データになるのを防ぐ）。
    if (isExportBusy(get().exportRun.phase)) return;
    set((s) => ({
      status: "idle",
      draftFromAi: false,
      hasRetiredTimelineEdits: false, // 別の動画に前の案内を持ち越さない（#635）
      saveStatus: "idle",
      _docEpoch: s._docEpoch + 1, // 別の文書になった（走っている保存の着地を受け取らない・#762）
      meta: defaultHeader(),
      parts: [],
      scenes: [],
      warnings: [],
      assets: [],
      assetSrcById: {},
      narrationAudioById: {},
      _dirtyAudioKeys: new Set(),
      narrationError: null,
      narrationCancelled: false, // 新規＝前の文書の「中止しました」を持ち越さない
      // ⚠️ **見つからない素材の印は文書ごと**（#347）＝`asset_001` はどの文書にもあるので、
      // 持ち越すと**別の文書の健全な素材に「見つかりません」が付く**（§2-5＝嘘の警告）。
      missingAssetIds: [],
      _narrationRunSeq: s._narrationRunSeq + 1, // in-flight の一括作成を打ち切る（新しい声を旧文書の勢いで作らない）
      // 打ち切った実行の finally は「もう現行でない」ので作成中フラグを下ろさない＝ここで下ろす
      // （下ろさないと新しい文書で「作成中…」のまま声を作れなくなる）。
      isGeneratingNarration: false,
      aiError: null,
      past: [], // 別文書＝履歴をクリア（ADR-0020）
      future: [],
      _historyGroupDepth: 0,
      _historyGroupPending: false,
      wizardStep: 0, // 新規＝ウィザードは先頭ステップから（#401）
      exportRun: IDLE_EXPORT_RUN, // 新規＝前の書き出し結果を持ち越さない
      exportForm: IDLE_EXPORT_FORM, // 新規＝前の書き出し入力（ファイル名等）も持ち越さない
      _generationSeq: s._generationSeq + 1, // in-flight の旧生成を無効化（#402 レビュー）
    }));
    // ⚠️ **新しい動画には会社の見た目を焼き込む**（ADR-0036 決定2＝コピー）。
    // ⚠️ **`newProject` に置く**（PR #888 レビュー 🔴）＝以前は「白紙から作る」だけに入れていたので、
    // **主経路（AI で作る）に効いていなかった**。どちらも `newProject` を通るので、ここに置けば両方に効く。
    // フォントは `videoSettings` へ、ロゴは**ライブラリからの取り込みと同じ経路**（`asset_NNN` を採番）。
    void get().applyBrandKitToNew();
  },
  applyBrandKit: async () => {
    // 書き出し中は文書を固定（#570 P1）。押せないようにもしてあるが、二重に守る。
    if (isExportBusy(get().exportRun.phase)) return { ok: false, applied: false, addedLogo: false, error: EXPORT_BUSY_ASSET_MSG };
    const kit = get().brandKit;
    const plan = planBrandApply(kit, {
      fontId: get().meta.videoSettings.fontId,
      hasLogoAsset: get().assets.some((a) => a.assetType === ASSET_TYPE.logo),
    });
    if (isNoopBrandApply(plan)) return { ok: true, applied: false, addedLogo: false, error: null }; // 何も変わらないなら履歴を積まない
    // ⚠️ **履歴が変わる枝でだけ積む**（差分再監査 🟡・ADR-0020「空振りを積まない」）＝
    // ロゴだけ足す計画で加わるのは `assets`＝**履歴 slice の外**なので、先に積むと
    // **いまと同じ内容のスナップショット**が1つ増える（上限50 と合わさって古い編集を1つ押し出す。
    // 押しても何も戻らない「取り消す」も作る）。積むのは文字の形が変わるときだけ。
    // 既知の id だけ入れる（`parseBrandKit` が絞っているが、型でも狭めて `as` を書かない）。
    if (plan.fontChanges && isKnownFontId(kit.fontId)) {
      get().pushHistory();
      const fontId = kit.fontId;
      set((st) => ({
        meta: { ...st.meta, videoSettings: { ...st.meta.videoSettings, fontId } },
        saveStatus: "idle",
      }));
    }
    // ⚠️ **ロゴは「足す」だけ**＝既に置いているロゴは利用者が選んだもの（§2-5＝差し替えない）。
    // ⚠️ **できなかったら「反映しました」と言わせない**（PR #888 レビュー 🟡）＝置き場から消えている等で
    // 取り込みは失敗しうる。理由（`importError`）は設定画面には出ないので、ここで拾って返す。
    if (plan.addsLogo && kit.logoLibraryAssetId != null) {
      const added = await get().importFromLibrary(kit.logoLibraryAssetId);
      if (added == null) {
        // ⚠️ **一部だけ入った状態を隠さない**（PR #902 レビュー）＝フォントの変更は**この時点で
        // 既に文書へ入っている**（`pushHistory` も積んである）。失敗として返すだけだと、
        // 画面が戻す導線を出さず**変わったまま戻せない**（§2-5）。何が入ったかを返す。
        return {
          ok: false,
          applied: plan.fontChanges,
          addedLogo: false,
          error:
            get().importError ?? BRAND_LOGO_NOT_APPLIED_MESSAGE,
        };
      }
    }
    return { ok: true, applied: true, addedLogo: plan.addsLogo, error: null };
  },
  newBlankProject: () => {
    // 白紙から作る（#393）＝ウィザード/AI を通らず手動で場面を組む。共通リセット（newProject）を流用し、
    // status を "idle" のままにしない（"ready" にする）ことで、各画面マウント時の autoGenerateIfSafe（§2-6）が
    // 発火しない＝白紙開始がそのまま AI 送信を誘発しない。書き出し中ガードは newProject 側と二重で持つ（早期 return）。
    if (isExportBusy(get().exportRun.phase)) return;
    get().newProject();
    set({ status: "ready" });
  },
  applyBrandKitToNew: async () => {
    // ⚠️ **着地は「まだ同じ動画を開いているか」で括る**（🟡21）＝読み直しの間に別の動画を開けるので、
    // 括らないと**開いた動画の文字の形が黙って会社の既定に差し替わる**（§2-5）。
    const stillOpen = sameDocGuard(get);
    // ⚠️ **キットは読み直してから使う**＝設定画面で変えた直後でも新しい動画に効く。
    await get().refreshBrandKit();
    if (!stillOpen()) return;
    const kit = get().brandKit;
    if (isKnownFontId(kit.fontId)) {
      const fontId = kit.fontId;
      set((st) => ({ meta: { ...st.meta, videoSettings: { ...st.meta.videoSettings, fontId } } }));
    }
    // ⚠️ **入らなかったら、その場で言う**（α-6 出口監査 🟡・PR #888 と同じ流儀）＝返り値を捨てると、
    // 棚が読めない・実体が消えたときに**何も出ず**、`importError` は2ステップ先の画面でしか描かれない
    // （身に覚えのない警告として現れる）。画面は「新しい動画に最初から入ります」と約束している。
    if (kit.logoLibraryAssetId != null && (await get().importFromLibrary(kit.logoLibraryAssetId)) == null) {
      // ⚠️ **具体的な理由を一般文で潰さない**（差分再監査 🟡）＝`importFromLibrary` は
      // 「一覧を読めませんでした」「取り込み中です」「素材が見つかりません」を先に入れて `null` を返す。
      // 上書きすると**棚が読めないのに「置いてあるか確かめてください」**＝従っても直らない案内になる。
      // 明示適用（`applyBrandKit`）は既に `??` で理由を優先しているので揃える（ADR-0026②）。
      // ⚠️ **開き直していたら出さない**＝`importFromLibrary` は `!stillOpen()` のとき**わざと理由を出さず**
      // `null` を返すので、コピー中に別の動画を開くと**開いたばかりの動画**に身に覚えのない警告が出る。
      if (stillOpen()) set({ importError: get().importError ?? BRAND_LOGO_NOT_APPLIED_MESSAGE });
    }
  },
  startManualEdit: () => {
    // 生成失敗/中断からの手動作成リカバリ（#393 P1・12 §9.3／15＝失敗時の手動作成は正規リカバリ）。
    // 入力済みの会社情報・素材・（あれば）場面は残したまま、status を "ready"・aiError をクリアして手動で組む状態にする。
    // status を error のままにしないことで、たたき台が「場面を追加」導線を出す（白紙導線と同じ手動状態＝draftFromAi=false）。
    // _generationSeq を進めて in-flight の generate を無効化する（デモ/失敗表示から手動へ移った場合など、後から生成が
    // 成功して手動作成を上書きしないように・#402 と同方針・PR#468 P2）。
    set((s) => ({ status: "ready", aiError: null, draftFromAi: false, _generationSeq: s._generationSeq + 1 }));
  },
  // 保存の入口（#256 レビュー🔴）：進行中の保存があればその Promise を待って戻る＝多重起動は防ぎつつ
  // 「await saveProject() は保存の完了を保証」（書き出し前保存が no-op で projectId 未確定→画像欠落になるのを防ぐ）。
  /**
   * 一覧に出す小さな絵を焼き直す（#397）。**保存の後に投げっぱなしで呼ぶ**（待たせない）。
   * ⚠️ **失敗しても何も起きない**＝絵が無ければ一覧はプレースホルダで出る（§2-5 の行き止まりにしない）。
   */
  _refreshProjectThumbnail: async (projectId) => {
    const s = get();
    const sig = thumbnailSignature({ scenes: s.scenes, assets: s.assets, videoSettings: s.meta.videoSettings });
    // ⚠️ **同じ動画の印と比べる**＝別の動画の印と当たっても「変わっていない」にしない。
    if (lastThumbnail?.projectId === projectId && lastThumbnail.signature === sig) return;
    const scene = thumbnailScene(s.scenes);
    const template = scene ? s.templates.find((t) => t.templateId === scene.templateId) : undefined;
    if (!scene || !template) {
      lastThumbnail = { projectId, signature: sig }; // 「絵が無い」も1つの状態として覚える（毎回試さない）
      return;
    }
    const dataUrl = await renderProjectThumbnail(
      scene,
      template,
      (id) => (id ? s.assetSrcById[id] ?? s.templateAssetSrcById[id] : undefined),
      s.meta.videoSettings.fontId,
    );
    if (!dataUrl) return; // 描けなかった＝印は覚えない（次の保存でもう一度試す）
    // ⚠️ **消した動画へは書かない**（#927）＝絵を描いている間に消されることがある。
    // 書くとフォルダが**`preview.png` だけで復活**する（一覧には出ないので気づけない残骸）。
    if (deletedProjectIds.has(projectId)) return;
    try {
      await saveProjectThumbnail(projectId, dataUrl);
      lastThumbnail = { projectId, signature: sig };
    } catch {
      /* 絵が無くても一覧は開ける＝黙って続ける */
    }
  },
  saveProject: async () => {
    if (saveInFlight) return saveInFlight;
    saveInFlight = get()._doSave();
    try {
      await saveInFlight;
    } finally {
      saveInFlight = null;
    }
  },
  // 実際の保存処理（saveProject 経由でのみ呼ぶ）。saveStatus を saving→saved/error に更新。
  _doSave: async () => {
    set({ saveStatus: "saving" });
    // ⚠️ **着地は「まだ同じ文書を開いているか」で括る**（#762）。書き終えるまでの間に別の動画を開けるので
    //（保存中は「未保存あり」と見なさない＝ホームは確認なしで開ける）、括らないと**完了の set が新しい方の
    // meta へ古い projectId を書き込み**、以後その動画の自動保存が**古い方の `project.json` を上書きする**
    //（作業がディスクごと消える・取り消し不能）。タイムライン側は #693 で同じ照合を入れてある。
    const stillOpen = sameDocGuard(get);
    try {
      const s = get();
      let projectId = s.meta.projectId;
      if (!projectId) {
        const existing = await listProjectSummaries();
        projectId = createProjectId(new Date(), existing.map((p) => p.projectId));
      }
      // ナレーション音声をディスクへ保存し、voicePath を更新（生成済みのみ）。
      // 生成済みでない場面は古い音声参照を残さない（再生成で上書きされる）。
      // 効率化（#390）：新規生成された音声（_dirtyAudioKeys）だけ WAV を書き出す。未変更の音声（既に voicePath 済み）は
      // 再書き出しせず既存 voicePath を保持する。dirty でも voicePath 未設定なら念のため書く（取りこぼし防止）。
      const audioById = s.narrationAudioById;
      const dirty = s._dirtyAudioKeys;
      // 今回ディスクへ書けたキー→{voicePath, 書き出した音声}。保存完了時に live state へ voicePath をマージし dirty を落とすが、
      // 保存中に同キーが再生成されていたら（live 音声 ≠ 書き出した音声）マージも dirty クリアもしない（新しい音声を失わない・#390 レビュー）。
      const writtenPath = new Map<string, string>();
      const writtenAudio = new Map<string, string>();
      const scenes = await Promise.all(
        s.scenes.map(async (sc) => {
          // 掛け合い（明示 lines）は行ごとに保存・voicePath 更新する（ADR-0015 PR-C2）。
          if (sc.lines && sc.lines.length > 0) {
            let next = sc;
            for (const line of sc.lines) {
              if (line.status !== NARRATION_STATUS.generated) {
                if (line.voicePath) next = withLineVoicePath(next, line.lineId, null);
                continue;
              }
              const key = lineAudioKey(sc.sceneId, line.lineId);
              const lineAudio = audioById[key];
              // 未変更（非 dirty で voicePath 済み）は再書き出しせず据え置き（#390）。
              if (lineAudio && (dirty.has(key) || !line.voicePath)) {
                const vp = await importVoiceFile(projectId, lineVoiceStem(sc.sceneId, line.lineId), lineAudio);
                if (vp) {
                  next = withLineVoicePath(next, line.lineId, vp);
                  writtenPath.set(key, vp);
                  writtenAudio.set(key, lineAudio);
                }
              }
              // 生成済みだがメモリに音声なし／未変更 → 既存 voicePath を保持（何もしない）。
            }
            return next;
          }
          // 未生成・失敗の場面は古い voicePath を残さない（再生成で上書きされる）。
          if (sc.narration.status !== NARRATION_STATUS.generated) {
            return sc.narration.voicePath
              ? { ...sc, narration: { ...sc.narration, voicePath: null } }
              : sc;
          }
          // 生成済み：メモリに音声があり、かつ変更あり（dirty）／voicePath 未設定ならディスク保存して voicePath を更新。
          const audio = audioById[sc.sceneId];
          if (audio && (dirty.has(sc.sceneId) || !sc.narration.voicePath)) {
            const voicePath = await importVoiceFile(projectId, sc.sceneId, audio);
            if (voicePath) {
              writtenPath.set(sc.sceneId, voicePath);
              writtenAudio.set(sc.sceneId, audio);
              return { ...sc, narration: { ...sc.narration, voicePath } };
            }
            return sc;
          }
          // 生成済みだがメモリに音声なし（復元失敗・非Tauri等）／未変更 → 既存 voicePath を保持する。
          return sc;
        }),
      );
      // ディスクへ書く project は「保存開始時のスナップショット（scenes）」で組む＝一貫した時点の内容。
      const updatedAt = new Date().toISOString();
      const meta: ProjectHeader = { ...s.meta, projectId, updatedAt };
      const project = assembleProject(meta, s.assets, s.parts, scenes);
      // 保存前検証（#416）：当面は警告ログのみ（アプリが正典に反するデータを作っていないか監視・入力防御は #411）。
      const pv = validateProjectDoc(project);
      if (!pv.valid) console.warn("[project] 保存内容がスキーマに未適合（要修正・#416）:", pv.errors);
      await saveProjectDoc(projectId, JSON.stringify(project, null, 2));
      // ここから先は**いまの状態**へ書き戻す＝別の動画へ移っていたら何もしない（書けたファイルはそのまま
      // ディスクに残る＝内容は正しい。持ち帰らないのは「いまの画面の状態」への反映だけ）。
      if (!stillOpen()) return;
      setLastProjectId(projectId); // 次に開くのはこの動画（移っていたら書かない＝いまの画面と食い違わせない）
      // 保存完了時は「スナップショットを丸ごと戻す」のではなく、書けた voicePath だけを **live state** へマージする。
      // これで保存中の削除・編集・同一キー再生成を巻き戻さない（#390 レビュー・P1）：
      //  - 書けた voicePath は、対象の場面/行がまだ存在し、かつ音声が書き出し時と同じ（＝保存中に再生成されていない）ときだけ反映。
      //  - dirty は「書けて」かつ「未変更」のキーだけ落とす（再生成された分は dirty のまま＝次回保存で書く）。
      //  - 孤児（現存しない場面/行のキー）はメモリから剪定。saveStatus は sentinel（下記）で判定。
      set((st) => {
        const applyWritten = (sc: Scene): Scene => {
          if (sc.lines && sc.lines.length > 0) {
            let changed = false;
            const lines = sc.lines.map((l) => {
              if (l.status !== NARRATION_STATUS.generated) return l;
              const key = lineAudioKey(sc.sceneId, l.lineId);
              if (writtenPath.has(key) && st.narrationAudioById[key] === writtenAudio.get(key)) {
                changed = true;
                return { ...l, voicePath: writtenPath.get(key)! };
              }
              return l;
            });
            return changed ? { ...sc, lines } : sc;
          }
          if (sc.narration.status !== NARRATION_STATUS.generated) return sc;
          const key = sc.sceneId;
          if (writtenPath.has(key) && st.narrationAudioById[key] === writtenAudio.get(key)) {
            return { ...sc, narration: { ...sc.narration, voicePath: writtenPath.get(key)! } };
          }
          return sc;
        };
        const nextScenes = st.scenes.map(applyWritten);
        const liveKeys = liveNarrationAudioKeys(nextScenes); // 現在の場面が参照するキー（書き出し対象の判定に使う）
        // 剪定は「現在＋Undo/Redo 履歴で到達可能な場面」の和集合で行う（#390 レビュー🔴）。削除は Undo 可・Undo は
        // 音声キャッシュを戻さないため、履歴に残る場面のキーを消すと取り消し後に音声が失われる。履歴から落ちた（＝もう
        // Undo でも戻せない）キーだけ解放する。past/future の DocSnapshot も走査。
        const reachable = new Set(liveKeys);
        for (const snap of [...st.past, ...st.future]) {
          for (const k of liveNarrationAudioKeys(snap.scenes)) reachable.add(k);
        }
        const nextAudio = pickKeys(st.narrationAudioById, reachable); // 到達不能な孤児だけ落とす
        const nextDirty = new Set<string>();
        for (const k of st._dirtyAudioKeys) {
          if (!reachable.has(k)) continue; // 到達不能＝もう書き出す必要なし
          if (liveKeys.has(k) && writtenPath.has(k) && st.narrationAudioById[k] === writtenAudio.get(k)) continue; // 書けて未変更＝もう dirty でない
          nextDirty.add(k); // 未書き出し／保存中に再生成／Undo 履歴のみで到達（復活時に !voicePath で書き直す）＝dirty のまま
        }
        // sentinel：_doSave 冒頭で saveStatus="saving"。保存中に編集・削除・生成の**完了**（成功/失敗いずれも idle をセット）が
        // 入れば "idle" に変わる。まだ "saving" のまま＝保存中に確定変更なし → "saved"。変わっていれば（idle 等）そのまま＝
        // 自動保存が再度走る（作業を失わない）。※in-flight の pending は idle を立てないが、その生成は完了時に idle をセットする
        // ので、保存がちょうど pending 中に終わっても次サイクルで拾える。
        const saveStatus = st.saveStatus === "saving" ? "saved" : st.saveStatus;
        // projectId（新規採番）と updatedAt は stamp しつつ、保存中の meta 編集（改名等）は live を優先して残す。
        return {
          meta: { ...st.meta, projectId, updatedAt },
          scenes: nextScenes,
          saveStatus,
          narrationAudioById: nextAudio,
          _dirtyAudioKeys: nextDirty,
        };
      });
      // 一覧に出す小さな絵（#397）＝**投げっぱなし**にする（保存の完了を待たせない＝体感で重くならない）。
      // ⚠️ **先頭の場面が変わっていなければ焼き直さない**（印の比較）＝打つたびに焼かない。
      // ⚠️ **投げっぱなしでも控えておく**（#927）＝削除がこの着地を待てるようにする。
      thumbnailInFlight = get()._refreshProjectThumbnail(projectId).finally(() => { thumbnailInFlight = null; });
    } catch {
      // 別の動画へ移っていたら、その動画へ**別の文書の失敗**を出さない（誤って帰属させない）。
      if (stillOpen()) set({ saveStatus: "error" });
    }
  },
  dismissRetiredTimelineNotice: () => set({ hasRetiredTimelineEdits: false }),
  duplicateProject: async (projectId) => {
    // ⚠️ **入口で理由を消す**（差分再監査の対応で気づいた・§2-5）＝画面はこの操作のあと `importError` を
    // 読んで出すので、消さないと**前の操作の理由**を複製の理由として見せうる（身に覚えのない案内）。
    set({ importError: null });
    // 書き出し中は別プロジェクトへ切り替えない（進行中の書き出しが参照するデータ/状態を保つ・#379）。
    // ⚠️ **理由を置いてから返す**＝置かずに `null` を返すと、画面は定型文（「もう一度お試しください」）へ
    // 落ちる＝書き出し中は何度押しても同じなので、**従っても直らない案内**になる。
    if (isExportBusy(get().exportRun.phase)) { set({ importError: EXPORT_BUSY_ASSET_MSG }); return null; }
    try {
      // ⚠️ **元は読むだけ**＝複製で元の動画を書き換えない（焼き出し＝ADR-0032 決定16 と同じ流儀）。
      const src = parseProjectDoc(await loadProjectDoc(projectId));
      const existing = await listProjectSummaries();
      const newId = createProjectId(new Date(), existing.map((p) => p.projectId));
      const dup = duplicateProjectDoc(src, newId, new Date().toISOString());
      // ⚠️ **ファイルを運んでから文書を保存する**（焼き出しと同じ順＝`bakeToTimeline`）＝
      // 逆にすると、素材の無い動画が一覧に残る。
      // ⚠️ **コピーの入口は1つ**（`copyBakedFiles`）＝焼き出しと同じ関数を使う（規則を写さない・§2-7）。
      await copyBakedFiles(projectId, newId, duplicatedFilePaths(src));
      await saveProjectDoc(newId, JSON.stringify(dup, null, 2));
      // 複製したら**開く**（作っただけで見えないと、できたかどうか分からない）。
      await get().loadProject(newId);
      return newId;
    } catch (e) {
      // ⚠️ **理由を潰さない**（α-6 出口監査 🟡）＝新しい版で作られた文書・壊れた文書は**何度押しても
      // 直らない**のに「もう一度お試しください」と勧めていた。同じ画面の「開く」は理由を保っている
      // （同じ文書に対して入口で案内が割れる＝ADR-0026②）。
      const message = e instanceof ProjectLoadError ? e.message
        : typeof e === "string" ? e
          : DUPLICATE_FAILED_MESSAGE;
      set({ importError: message });
      return null;
    }
  },
  loadProject: async (projectId) => {
    lastThumbnail = null; // 一覧の絵の印を戻す（#397）＝前の動画の印で焼き直しを飛ばさない
    // 書き出し中は別プロジェクトへ切り替えない（進行中の書き出しが参照するデータ/状態を保つ・#379）。
    if (isExportBusy(get().exportRun.phase)) return;
    const text = await loadProjectDoc(projectId);
    const project = parseProjectDoc(text);
    // 旧・場面横断タイムラインの手編集（ADR-0032 決定11/12・#635）。**データは消さない**が動画には出さないので、
    // 開いた人に一言断る（黙って消えたように見せない・§2-5・`15 §6` TIMELINE_OVERLAY_RETIRED）。
    const hasRetiredTimelineEdits = (project.timelineOverlay?.clips?.length ?? 0) > 0;
    // ディスクの素材を表示用 src に解決（Tauri は asset://・ブラウザは null）。filePath を持つもの・未配置のサンプル等は null でスキップ。並列実行（A3-2）。
    type LoadedSrc = { assetId: string; url: string; thumbnailPath?: string };
    const loaded = await Promise.all(
      project.assets.map(async (a): Promise<LoadedSrc | null> => {
        if (a.assetType === ASSET_TYPE.video) {
          // 動画は本体(大容量)でなく代表フレーム(サムネ)を読み込む。
          // 旧プロジェクト（サムネ未生成）の動画は読込時に生成する（本体は読み込まない＝後方互換）。
          let thumbPath = a.thumbnailPath;
          if (!thumbPath && a.filePath) {
            thumbPath = (await extractVideoThumbnail(project.projectId, a.filePath)) ?? undefined;
          }
          if (!thumbPath) return null;
          const url = await assetDisplayUrl(project.projectId, thumbPath);
          return url ? { assetId: a.assetId, url, thumbnailPath: thumbPath } : null;
        }
        if (!a.filePath) return null;
        const url = await assetDisplayUrl(project.projectId, a.filePath);
        return url ? { assetId: a.assetId, url } : null;
      }),
    );
    const assetSrcById: Record<string, string> = {};
    // 読込時に解決した動画サムネのパス（再生成含む）は assets にも反映し、次回保存で永続化する。
    const videoThumb: Record<string, string> = {};
    for (const entry of loaded) {
      if (!entry) continue;
      assetSrcById[entry.assetId] = entry.url;
      if (entry.thumbnailPath) videoThumb[entry.assetId] = entry.thumbnailPath;
    }
    // 生成済みナレーション音声を data URL に復元（voicePath を持つもの。未配置は null でスキップ）。並列実行。
    // 単一 narration（従来・キーは sceneId）。掛け合い（明示 lines）の場面はここでは扱わず下で行ごとに復元する。
    const voiceLoaded = await Promise.all(
      project.scenes
        .filter((sc) => !(sc.lines && sc.lines.length > 0) && sc.narration.status === NARRATION_STATUS.generated && sc.narration.voicePath)
        .map(async (sc) => {
          const url = await readVoiceDataUrl(project.projectId, sc.narration.voicePath!);
          return url ? ([sc.sceneId, url] as const) : null;
        }),
    );
    // 掛け合い（明示 lines）の行ごと音声（キーは lineAudioKey(sceneId,lineId)・ADR-0015 PR-C2）。
    const lineVoiceLoaded = await Promise.all(
      project.scenes
        .filter((sc): sc is Scene & { lines: NonNullable<Scene["lines"]> } => !!(sc.lines && sc.lines.length > 0))
        .flatMap((sc) =>
          sc.lines
            .filter((l) => l.status === NARRATION_STATUS.generated && l.voicePath)
            .map(async (l) => {
              const url = await readVoiceDataUrl(project.projectId, l.voicePath!);
              return url ? ([lineAudioKey(sc.sceneId, l.lineId), url] as const) : null;
            }),
        ),
    );
    const narrationAudioById: Record<string, string> = {};
    for (const entry of [...voiceLoaded, ...lineVoiceLoaded]) {
      if (entry) narrationAudioById[entry[0]] = entry[1];
    }
    set((s) => ({
      status: "ready",
      _docEpoch: s._docEpoch + 1, // 別の文書になった（走っている保存の着地を受け取らない・#762）
      hasRetiredTimelineEdits,
      draftFromAi: false, // 読込済みプロジェクトは「生成直後」ではない＝AI作成文言は出さない（#467）
      saveStatus: "saved", // 読み込み直後はディスクと一致＝保存済み扱い（未保存検知の基準・#256）
      // 保存用ヘッダは projectHeaderFromProject に一元化（Project のヘッダ系フィールドの取りこぼしを防ぐ・#324）。
      // ADR-0011 の種別/発表内容/自由記述、ADR-0018 の timelineOverlay もここでまとめて復元される。
      meta: projectHeaderFromProject(project),
      assets: project.assets.map((a) =>
        videoThumb[a.assetId] ? { ...a, thumbnailPath: videoThumb[a.assetId] } : a,
      ),
      parts: project.parts,
      // 保存時に合成中だった場面は「準備中」のまま保存され得るが、その合成はアプリ終了で消えている＝**誰も作っていない
      // 準備中**が復元される。放置すると `isNarrationGenerating` が真のままで書き出しが止まり、しかも作成中では
      // ないので「中止」も出せない＝抜け道の無い行き止まりになる（15 §2.1／§4・ADR-0026④）。読込時に未作成へ戻す
      // （音声は voicePath 済みのものしか保存されない＝準備中の行に失う音声は無い＝11 §9 の読込時補正と同じ扱い）。
      scenes: clearPendingNarrations(project.scenes),
      warnings: [],
      assetSrcById,
      narrationAudioById,
      _dirtyAudioKeys: new Set(), // 読込直後は全音声が voicePath 済み＝再書き出し不要（#390）
      narrationError: null,
      narrationCancelled: false, // 別文書＝前の文書の「中止しました」を持ち越さない
      // ⚠️ **見つからない素材の印は文書ごと**（#347）＝`asset_001` はどの文書にもあるので、
      // 持ち越すと**別の文書の健全な素材に「見つかりません」が付く**（§2-5＝嘘の警告）。
      missingAssetIds: [],
      _narrationRunSeq: s._narrationRunSeq + 1, // 別文書へ切替＝in-flight の一括作成を打ち切る
      // 打ち切った実行の finally は作成中フラグを下ろさない（もう現行でない）ので、ここで下ろす。
      isGeneratingNarration: false,
      past: [], // 別文書を開く＝履歴をクリア（ADR-0020）
      future: [],
      _historyGroupDepth: 0,
      _historyGroupPending: false,
      wizardStep: 0, // 別文書＝ウィザードのステップも初期化（#401）
      exportRun: IDLE_EXPORT_RUN, // 別文書＝前の書き出し結果を持ち越さない
      exportForm: IDLE_EXPORT_FORM, // 別文書＝前の書き出し入力も持ち越さない
      _generationSeq: s._generationSeq + 1, // 別文書へ切替＝in-flight の旧生成を無効化（#402 レビュー）
    }));
    setLastProjectId(projectId);
  },
  listProjects: () => listProjectSummaries(),
  deleteProject: async (projectId) => {
    // 書き出し中に当該（開いている）プロジェクトを消すと、素材ファイルが読取り中に消えて
    // 写真の抜けた MP4 が正常完了してしまう（#379）。開いていない別プロジェクトの削除は安全なので許可。
    if (isExportBusy(get().exportRun.phase) && get().meta.projectId === projectId) return;
    // ⚠️ **消す前に、まず全員が手放す**（#755 の `/canon-check`）。消し終わってから知らせると、
    // **削除している最中**に非同期の着地（声の完成・素材の取り込み）が保存でき、
    // `save_project` がフォルダごと作り直して**素材と声だけ消えた動画が一覧へ戻る**。
    //
    // ⚠️ **自分の店も、消す前に手放す**（#763-4）＝以前は `newProject()` が削除の**後**だったので、
    // 削除している最中の自動保存（`useAutoSave`）が同じ projectId を書き戻せた。開いていない動画の
    // 削除では何も起きない（`newProject` は開いているときだけ）。
    const hadOpen = get().meta.projectId === projectId;
    if (hadOpen) get().newProject();
    // ⚠️ **手放すだけでは足りない**（#763-4）＝「これ以上書かない」にはできるが、**すでに発行済みの
    // 書き込み**はバックエンドで走っており、消した**後**に着地しうる。自分と受け手の**進行中の
    // 書き込みが着地するまで待ってから**消す。失敗した書き込みも待つ（着地したことだけが要る）。
    // ⚠️ **これ以上焼かない印を先に立てる**（#927）＝待っている間に積まれた焼き込みも止める。
    deletedProjectIds.add(projectId);
    const restoreOthers = await emitProjectDeleted(projectId);
    await saveInFlight?.catch(() => { /* 着地したことだけが要る（結果は問わない） */ });
    // ⚠️ **一覧の絵の焼き込みも待つ**（#927）＝保存の後に投げっぱなしで走るので `saveInFlight` に
    // 入らず、消した後に着地して**`preview.png` だけのフォルダが復活**しうる（気づけない残骸）。
    await thumbnailInFlight?.catch(() => { /* 着地したことだけが要る */ });
    // ⚠️ **消せなかったら開き直す**（#763-4 レビュー）＝手放しを削除の前へ動かした結果、失敗すると
    // 一覧には動画が残るのに編集画面だけ空になる（利用者から見ると作業が消えたように見える）。
    // 最後に保存した状態へ戻す＝空の画面に置き去りにしない。理由は呼び出し側（一覧）が出す。
    //
    // ⚠️ **戻すのは自分の店だけではない**（#763-4 レビュー🔴）＝`deleteProject` は**両方の形式の
    // 共通の入口**なので、`hadOpen`（場面形式の判定）だけ見ると、**タイムライン形式を消し損ねた
    // ときにあちらが空のまま**残る。手放した受け手それぞれが自分で戻す（`restoreOthers`）
    // ＝ここから相手の store を直接触らない（輪を作らない・`projectDeletion.ts` の理由）。
    try {
      await deleteProjectDoc(projectId);
    } catch (e) {
      // ⚠️ **待っている間に別の動画を開かれていたら戻さない**（#763-4 レビュー）＝この待ちは
      // このPRで**意図的に長くした**ので、その間に一覧から別の動画を開ける。捕まえた時点の id で
      // 無条件に開き直すと、**いま開いている方を黙って上書きする**（§2-5）。手放したときのまま
      //（空の新規で、作業中の内容も無い）ときだけ戻す。
      const now = get();
      // ⚠️ **消せなかったら印を戻す**（#927）＝残したまま失敗すると、その動画は**以後ずっと
      // 一覧の絵を焼けない**（消えていないのに焼けない、という直しようのない状態になる）。
      deletedProjectIds.delete(projectId);
      const untouched = now.meta.projectId === "" && !hasWorkInProgress(now.scenes.length, now.assets, now.meta);
      if (hadOpen && untouched) await get().loadProject(projectId);
      await restoreOthers();
      throw e;
    }
    // 削除したのが最後に開いたプロジェクトなら、次回起動の自動復元対象から外す（消えたものを開こうとしない）。
    if (getLastProjectId() === projectId) clearLastProjectId();
  },
  estimateBake: async (range) => {
    const { doc, notes } = get()._bake(range, get().meta.projectName);
    return { bytes: await bakeSizeBytes(get().meta.projectId, bakedFilePaths(doc)), notes };
  },
  bakeToTimeline: async (range, projectName) => {
    // 焼く前に元を保存する＝**ディスクにあるファイル**（素材・作成済みの声）を運ぶので、
    // 保存していない声が抜け落ちるのを防ぐ。元の中身は変えない（片道＝決定16）。
    await get().saveProject();
    const srcProjectId = get().meta.projectId;
    const existing = await listProjectSummaries();
    const projectId = createProjectId(new Date(), existing.map((p) => p.projectId));
    const { doc, notes } = get()._bake(range, projectName, projectId);
    // **未適合なら保存しない**＝一覧に出るのに開けない動画を作らない（読込側は適合を要求する・ADR-0026④）。
    // 失敗は呼び出し側（入口 UI）が「作れませんでした…」として見せる（§2-5）。
    if (!validateTimelineProject(doc)) {
      console.warn("[timeline] 焼き出した内容がスキーマに未適合:", validateTimelineProject.errors);
      throw new BakeError(BAKE_BROKEN_RESULT_MESSAGE);
    }
    // ⚠️ **id の重なりは適合チェックを素通りする**（配列をまたいだ id の一意は JSON Schema の語彙に無い）。
    // 重なると読む側の引き当てが別のものに効き、**焼く前と絵が変わる**（#811・ADR-0032 決定23）。
    // 採番の穴は `bake.ts` 側で塞いだが、**門をここにも置く**＝壊れた文書をディスクへ書かない。
    const dup = duplicateIdsIn(doc);
    if (dup.length > 0) {
      console.warn("[timeline] 焼き出した内容に id の重なり:", dup);
      throw new BakeError(BAKE_BROKEN_RESULT_MESSAGE);
    }
    // 先にファイルを運んでから文書を保存する＝途中で失敗しても「素材の無いプロジェクト」が一覧に残らない。
    await copyBakedFiles(srcProjectId, projectId, bakedFilePaths(doc));
    await saveProjectDoc(projectId, JSON.stringify(doc, null, 2));
    return { projectId, notes };
  },
  _bake: (range, projectName, projectId) => {
    const s = get();
    const project = assembleProject(s.meta, s.assets, s.parts, s.scenes);
    const templateById = new Map(s.templates.map((t) => [t.templateId, t]));
    return bakeTimelineProject(project, {
      range,
      // 容量の見積りでは新しい id をまだ発行しない（採番は本当に焼くときだけ＝番号を飛ばさない）。
      projectId: projectId ?? project.projectId,
      projectName,
      nowIso: new Date().toISOString(),
      templateOf: (id) => templateById.get(id),
      lineDurationsFor: (sc) => lineDurationsFromAudio(sc, s.narrationAudioById),
    });
  },
  renameProject: async (projectId, newName) => {
    // 書き出し中に「開いている」プロジェクトを改名すると、meta 直変更（凍結中の文書を触る）＋ project.json の
    // read-modify-write が、書き出し中の保存（voicePath 更新）と同一ファイルを取り合い、保存済みの更新を黙って
    // 消す（lost-update・#570 レビュー）。deleteProject と同じ線引き＝開いていない別プロジェクトの改名は書き出しと
    // 無関係なので許可（UI 側でも鉛筆を無効化・案内する＝多重防御）。
    // 逆向き（rename が in-flight のまま書き出し開始）は現状 HomeScreen 単独呼び出し＝ExportScreen へ移ると unmount する
    // ため到達不能（isImporting/isTemplateMutating のような開始フラグは不要）。呼び出し元が増えたら書き出し開始側に in-flight 検知を足す。
    if (isExportBusy(get().exportRun.phase) && get().meta.projectId === projectId) return;
    // 上限で切り詰めて保存＝schema の projectName maxLength(80) 超を保存させない（入力防御 #411・#416 と対）。
    const name = newName.trim().slice(0, PROJECT_NAME_MAX_LENGTH);
    if (!name) return; // 空名は変更しない（UI 側でも保存を抑止）
    // 保存済み project.json を読み、名前と更新日時だけ差し替えて書き戻す（他のデータは保持）。
    const updatedAt = new Date().toISOString();
    const doc = JSON.parse(await loadProjectDoc(projectId)) as Record<string, unknown>;
    doc.projectName = name;
    doc.updatedAt = updatedAt;
    // 保存前検証（#416）：改名は projectName の maxLength(80) を超え得る（#411）。当面は警告ログのみ。
    const rv = validateProjectDoc(doc);
    if (!rv.valid) console.warn("[project] 改名後の保存内容がスキーマに未適合（要修正・#416）:", rv.errors);
    await saveProjectDoc(projectId, JSON.stringify(doc, null, 2));
    // 開いているプロジェクトを改名したなら、画面表示名・更新日時（meta）も同期する。
    if (get().meta.projectId === projectId) set((s) => ({ meta: { ...s.meta, projectName: name, updatedAt } }));
  },
  updateScene: (sceneId, update) => {
    if (isExportBusy(get().exportRun.phase)) return; // 書き出し中は文書編集を固定（#570 P1・15§4・ADR-0026④＝設定した意味どおりMP4へ）
    get().pushHistory(); // 適用前を履歴へ（ドラッグ中はグループ化で1ステップに合成・#211）
    set((s) => ({
      scenes: s.scenes.map((sc) => (sc.sceneId === sceneId ? update(sc) : sc)),
      // 編集したら「保存しました」表示を解除（未保存と分かるように）。
      saveStatus: "idle",
    }));
  },
  addAnimation: (sceneId, targetId, keyframes) => {
    if (isExportBusy(get().exportRun.phase)) return ""; // 書き出し中は文書編集を固定（#570 P1・15§4・ADR-0026④＝設定した意味どおりMP4へ）
    const anims = get().meta.timelineOverlay?.animations ?? [];
    const id = createAnimationId(anims.map((a) => a.id));
    const newAnim: ElementAnimation = { id, sceneId, targetId, keyframes };
    get().pushHistory();
    set((s) => ({
      meta: { ...s.meta, timelineOverlay: { ...s.meta.timelineOverlay, animations: [...(s.meta.timelineOverlay?.animations ?? []), newAnim] } },
      saveStatus: "idle",
    }));
    return id;
  },
  updateAnimation: (animId, keyframes) => {
    if (isExportBusy(get().exportRun.phase)) return; // 書き出し中は文書編集を固定（#570 P1・15§4・ADR-0026④＝設定した意味どおりMP4へ）
    get().pushHistory();
    set((s) => ({
      meta: {
        ...s.meta,
        timelineOverlay: {
          ...s.meta.timelineOverlay,
          animations: (s.meta.timelineOverlay?.animations ?? []).map((a) => (a.id === animId ? { ...a, keyframes } : a)),
        },
      },
      saveStatus: "idle",
    }));
  },
  removeAnimation: (animId) => {
    if (isExportBusy(get().exportRun.phase)) return; // 書き出し中は文書編集を固定（#570 P1・15§4・ADR-0026④＝設定した意味どおりMP4へ）
    get().pushHistory();
    set((s) => ({
      meta: {
        ...s.meta,
        timelineOverlay: {
          ...s.meta.timelineOverlay,
          animations: (s.meta.timelineOverlay?.animations ?? []).filter((a) => a.id !== animId),
        },
      },
      saveStatus: "idle",
    }));
  },
  addScene: () => {
    if (isExportBusy(get().exportRun.phase)) return ""; // 書き出し中は文書編集を固定（#570 P1・15§4・ADR-0026④＝設定した意味どおりMP4へ）
    const s = get();
    // 追加場面の見た目は末尾（直前）の場面から引き継ぐ＝連続作成が自然で、先頭テンプレ（オープニング）固定にならない（#528）。
    // 場面が無ければ先頭テンプレ。末尾場面のテンプレがダングリング（削除済み等）でも先頭テンプレへ落ちる。
    const lastScene = s.scenes[s.scenes.length - 1];
    const tmpl = (lastScene && s.templates.find((t) => t.templateId === lastScene.templateId)) || s.templates[0];
    if (!tmpl) return ""; // テンプレ未読込（通常は起こらない）なら追加しない
    const sceneId = createSceneId(s.scenes.map((x) => x.sceneId));
    // 末尾パート（無ければ新規作成）に追加する。
    let parts = s.parts;
    let partId = parts[parts.length - 1]?.partId;
    if (!partId) {
      partId = createPartId([]);
      parts = [{ partId, title: "パート1", order: 1, sceneIds: [] }];
    }
    const newScene: Scene = {
      sceneId,
      partId,
      order: s.scenes.length + 1,
      sceneType: tmpl.category,
      templateId: tmpl.templateId,
      durationSec: defaultDurationForTemplate(tmpl),
      assetRefs: {},
      character: { enabled: false, characterId: DEFAULT_CHARACTER_ID },
      texts: {},
      narration: { text: "", status: NARRATION_STATUS.none },
      warnings: [],
    };
    get().pushHistory();
    set({
      scenes: [...s.scenes, newScene],
      parts: parts.map((p) =>
        p.partId === partId ? { ...p, sceneIds: [...p.sceneIds, sceneId] } : p,
      ),
      // 変更が入ったので保存済み表示をリセット（未保存と分かるように）。
      saveStatus: "idle",
    });
    return sceneId;
  },
  removeScene: (sceneId) => {
    if (isExportBusy(get().exportRun.phase)) return; // 書き出し中は文書編集を固定（#570 P1・15§4・ADR-0026④＝設定した意味どおりMP4へ）
    get().pushHistory();
    set((s) => ({
      // 削除して order を 1..N に振り直す（表示順＝配列順を保つ）。
      scenes: s.scenes
        .filter((x) => x.sceneId !== sceneId)
        .map((x, i) => ({ ...x, order: i + 1 })),
      parts: s.parts.map((p) => ({
        ...p,
        sceneIds: p.sceneIds.filter((id) => id !== sceneId),
      })),
      // 音声キャッシュ（narrationAudioById／dirty）はここで剪定しない：削除は Undo 可（履歴に残る）で、Undo は
      // 音声キャッシュを復元しない（DocSnapshot=meta/parts/scenes・ADR-0020）。ここで消すと「生成→削除→取り消し」で
      // 復元場面の音声が失われる（保存前は voicePath も無く復旧不能＝#390 レビュー🔴）。剪定は _doSave が「現在＋Undo/Redo
      // 履歴で到達可能な場面」を除いて行う（履歴から落ちて初めて解放＝到達不能なら Undo でも戻せず安全）。
      // ⚠️ **その場面の動きも一緒に落とす**（#779）＝`scene_NNN` は歯抜けの最小番号を再利用し、
      // 新しい場面は**直前の見た目を引き継ぐ**ので、残すと**置いた覚えのない動きで新しい場面が動く**
      //（要素・まとまりの「憑依」の場面版）。⚠️ 音声キャッシュ（上）と違い `animations` は `meta`
      // ＝**履歴のスナップショットに入る**（ADR-0020）ので、ここで落としても取り消しで戻る。
      // 同じ `pushHistory()` の中なので**取り消しは1回**（場面と動きを別々に戻させない）。
      meta: s.meta.timelineOverlay?.animations
        ? { ...s.meta, timelineOverlay: { ...s.meta.timelineOverlay, animations: removeAnimationsForScene(s.meta.timelineOverlay.animations, sceneId) } }
        : s.meta,
      saveStatus: "idle",
    }));
  },
  moveScene: (sceneId, direction) => {
    if (isExportBusy(get().exportRun.phase)) return; // 書き出し中は文書編集を固定（#570 P1・15§4・ADR-0026④＝設定した意味どおりMP4へ）
    const s = get();
    const next = moveSceneInList(s.scenes, s.parts, sceneId, direction);
    if (next.scenes === s.scenes) return; // 端＝変化なし（未保存にしない）
    get().pushHistory();
    set({ ...next, saveStatus: "idle" });
  },
  moveSceneToIndex: (sceneId, toIndex) => {
    if (isExportBusy(get().exportRun.phase)) return; // 書き出し中は文書編集を固定（#570 P1・15§4・ADR-0026④＝設定した意味どおりMP4へ）
    const s = get();
    const next = moveSceneToIndexInList(s.scenes, s.parts, sceneId, toIndex);
    if (next.scenes === s.scenes) return; // 位置不変/対象なし＝変化なし（未保存/履歴にしない）
    get().pushHistory();
    set({ ...next, saveStatus: "idle" });
  },
  duplicateScene: (sceneId) => {
    if (isExportBusy(get().exportRun.phase)) return ""; // 書き出し中は文書編集を固定（#570 P1・15§4・ADR-0026④＝設定した意味どおりMP4へ）
    const s = get();
    const newId = createSceneId(s.scenes.map((x) => x.sceneId));
    const next = duplicateSceneInList(s.scenes, s.parts, sceneId, newId);
    if (next.scenes === s.scenes) return ""; // 対象なし＝変化なし
    get().pushHistory();
    // 複製元の要素アニメ（④・ADR-0019）も新場面へ引き継ぐ（複製で freeLayout の要素id は不変＝targetId そのまま）。
    set({ ...next, meta: metaWithDuplicatedAnimations(s.meta, sceneId, newId), saveStatus: "idle" });
    return newId;
  },
  splitScene: (sceneId, splitIndex) => {
    if (isExportBusy(get().exportRun.phase)) return ""; // 書き出し中は文書編集を固定（#570 P1・15§4・ADR-0026④＝設定した意味どおりMP4へ）
    const s = get();
    const newId = createSceneId(s.scenes.map((x) => x.sceneId));
    const next = splitSceneInList(s.scenes, s.parts, sceneId, splitIndex, newId);
    if (next.scenes === s.scenes) return ""; // 分割不能＝変化なし（未保存にしない）
    get().pushHistory();
    // 分割後の後半場面（newId）は前半と同じ freeLayout を持つ＝元場面のアニメを後半にも引き継ぐ（④・ADR-0019）。
    set({ ...next, meta: metaWithDuplicatedAnimations(s.meta, sceneId, newId), saveStatus: "idle" });
    return newId;
  },
  splitSceneAtLine: (sceneId, lineIndex) => {
    if (isExportBusy(get().exportRun.phase)) return ""; // 書き出し中は文書編集を固定（#570 P1・15§4・ADR-0026④＝設定した意味どおりMP4へ）
    const s = get();
    const newId = createSceneId(s.scenes.map((x) => x.sceneId));
    const next = splitSceneLinesInList(s.scenes, s.parts, sceneId, lineIndex, newId);
    if (next.scenes === s.scenes) return ""; // 分割不能（掛け合いでない/1行/尺不足）＝変化なし（未保存にしない）
    get().pushHistory();
    // 後半場面（newId）は前半と同じ freeLayout を持つ＝元場面のアニメを後半にも引き継ぐ（splitScene と同じ・④）。
    set({ ...next, meta: metaWithDuplicatedAnimations(s.meta, sceneId, newId), saveStatus: "idle" });
    return newId;
  },
  addAnimationsForElement: (sceneId, targetId, source) => {
    if (isExportBusy(get().exportRun.phase)) return; // 書き出し中は文書編集を固定（他の動き操作と同じ関門）
    const anims = get().meta.timelineOverlay?.animations ?? [];
    const added = retargetAnimations(source, anims, sceneId, targetId, createAnimationId);
    if (added.length === 0) return; // 元に動きが無い＝変化なし（未保存/履歴にしない）
    get().pushHistory();
    set((s) => ({
      meta: { ...s.meta, timelineOverlay: { ...s.meta.timelineOverlay, animations: [...(s.meta.timelineOverlay?.animations ?? []), ...added] } },
      saveStatus: "idle",
    }));
  },
  removeAnimationsForElements: (sceneId, targetIds) => {
    if (isExportBusy(get().exportRun.phase)) return; // 書き出し中は文書編集を固定（#570 P1・15§4・ADR-0026④＝設定した意味どおりMP4へ）
    const anims = get().meta.timelineOverlay?.animations;
    if (!anims || anims.length === 0) return;
    const rest = removeAnimationsForTargets(anims, sceneId, targetIds);
    if (rest.length === anims.length) return; // 対象なし＝変化なし（未保存/履歴にしない）
    get().pushHistory();
    set((s) => ({
      meta: { ...s.meta, timelineOverlay: { ...s.meta.timelineOverlay, animations: rest } },
      saveStatus: "idle",
    }));
  },
  applyProjectInfo: (input) => {
    if (isExportBusy(get().exportRun.phase)) return; // 書き出し中は文書編集を固定（#570 P1・15§4・ADR-0026④＝設定した意味どおりMP4へ）
    get().pushHistory();
    set((s) => ({
      // ADR-0011: videoKind で会社情報/発表内容を排他に持つ。渡されなかった側を undefined にして
      // 別種別の入力が残らないようにする（保存時の schema 排他 not:required を満たす）。additionalNotes は両用途共通。
      meta: {
        ...s.meta,
        videoKind: input.videoKind ?? s.meta.videoKind,
        purpose: input.purpose,
        companyInfo: input.companyInfo,
        generalBrief: input.generalBrief,
        additionalNotes: input.additionalNotes,
        // トーンは渡されたときだけ更新（未指定時は既存 toneSettings を維持）。
        toneSettings:
          input.tone !== undefined ? { ...s.meta.toneSettings, tone: input.tone } : s.meta.toneSettings,
        // 読み上げの声の感じ（speed/pitch/intonation）を反映。詳細は設定画面で微調整できる（§7.1）。
        voiceSettings: input.voice ? { ...s.meta.voiceSettings, ...input.voice } : s.meta.voiceSettings,
        // 動画の向き（縦/横）。未指定なら既存維持（ADR-0012/B5）。
        videoSettings: input.aspectRatio
          ? { ...s.meta.videoSettings, aspectRatio: input.aspectRatio }
          : s.meta.videoSettings,
      },
      saveStatus: "idle",
    }));
  },
  applyStandardLookToUnresolvedScenes: () => {
    const none: StandardLookApplyResult = { fixed: [], unfixable: [], lostContent: [] };
    if (isExportBusy(get().exportRun.phase)) return none; // 書き出し中は文書編集を固定（#570）
    const st = get();
    const fixes = standardLookFixesForUnresolved(st.scenes, st.templates, st.meta.videoSettings.aspectRatio);
    const byScene = new Map(fixes.map((f) => [f.sceneId, f] as const));
    // 番号は scenes の位置（1始まり）＝利用者が見る場面番号（buildPrecheckItems と同じ数え方）。
    const numberOf = (sceneId: string): number => st.scenes.findIndex((sc) => sc.sceneId === sceneId) + 1;
    const result: StandardLookApplyResult = {
      fixed: fixes.map((f) => numberOf(f.sceneId)),
      lostContent: fixes.filter((f) => f.losesContent).map((f) => numberOf(f.sceneId)),
      // 当て先が無くて直せない場面（その向き・種類の標準が無い）。押した後も項目が残る理由を出すために返す。
      unfixable: st.scenes
        .map((sc, i) => ({ sc, n: i + 1 }))
        .filter(({ sc }) => !st.templates.some((t) => t.templateId === sc.templateId) && !byScene.has(sc.sceneId))
        .map(({ n }) => n),
    };
    if (fixes.length === 0) return result; // 直せる場面が無い＝履歴も積まない（空の取り消しを作らない）
    get().pushHistory();
    set((s2) => ({
      scenes: s2.scenes.map((sc) => {
        const f = byScene.get(sc.sceneId);
        // 手で選び直すのと同じ経路（配置・文字の移送も同じ規則＝ADR-0030）。旧テンプレは解決できないので prev は無し。
        return f ? switchSceneTemplate(sc, f.template.templateId, f.template.category, undefined) : sc;
      }),
      saveStatus: "idle",
    }));
    return result;
  },
  changeOrientation: (target) => {
    if (isExportBusy(get().exportRun.phase)) return { changed: 0, unsupported: 0 }; // 書き出し中は文書編集を固定（#570 P1・15§4・ADR-0026④＝設定した意味どおりMP4へ）
    const s = get();
    const result = changeScenesOrientation(s.scenes, s.templates, target);
    // 1件も切り替えられない（既に目標向き or 対応する見た目なし）なら向き・場面とも変えない。
    // ＝変換先が無いのに向きだけ変えて全場面を不整合にしてしまうのを防ぐ（B5-b レビュー）。
    if (result.changed > 0) {
      get().pushHistory();
      set({
        scenes: result.scenes,
        meta: { ...s.meta, videoSettings: { ...s.meta.videoSettings, aspectRatio: target } },
        saveStatus: "idle",
      });
    }
    return { changed: result.changed, unsupported: result.unsupported };
  },
  setFontId: (fontId) => {
    if (isExportBusy(get().exportRun.phase)) return; // 書き出し中は文書編集を固定（#570 P1・15§4・ADR-0026④＝設定した意味どおりMP4へ）
    get().pushHistory();
    set((s) => ({
      meta: { ...s.meta, videoSettings: { ...s.meta.videoSettings, fontId } },
      saveStatus: "idle",
    }));
  },
  setCreditDisplay: (patch) => {
    if (isExportBusy(get().exportRun.phase)) return; // 書き出し中は文書編集を固定（#570 P1・15§4・ADR-0026④）
    get().pushHistory();
    set((s) => ({
      meta: {
        ...s.meta,
        videoSettings: {
          ...s.meta.videoSettings,
          creditDisplay: { ...s.meta.videoSettings.creditDisplay, ...patch },
        },
      },
      saveStatus: "idle",
    }));
  },
  updateAudioAuto: (patch) => {
    if (isExportBusy(get().exportRun.phase)) return; // 書き出し中は文書編集を固定（#570 P1・15§4・ADR-0026④＝設定した意味どおりMP4へ）
    get().pushHistory();
    set((s) => ({
      meta: {
        ...s.meta,
        videoSettings: { ...s.meta.videoSettings, audioAuto: { ...s.meta.videoSettings.audioAuto, ...patch } },
      },
      saveStatus: "idle",
    }));
  },
  setProjectName: (name) => {
    if (isExportBusy(get().exportRun.phase)) return; // 書き出し中は文書編集を固定（#570 P1・15§4・ADR-0026④＝設定した意味どおりMP4へ）
    // 編集中の名前変更＝メモリの meta を更新（保存/自動保存で永続化）。UI 側は blur/Enter で確定＝1改名=1履歴。
    // 上限で切り詰め＝schema の projectName maxLength(80) 超をメモリにも入れない（貼り付け等の保険・#411）。
    get().pushHistory();
    set((s) => ({ meta: { ...s.meta, projectName: name.slice(0, PROJECT_NAME_MAX_LENGTH) }, saveStatus: "idle" }));
  },
  updateVoiceSettings: (patch) => {
    if (isExportBusy(get().exportRun.phase)) return; // 書き出し中は文書編集を固定（#570 P1・15§4・ADR-0026④＝設定した意味どおりMP4へ）
    get().pushHistory();
    set((s) => ({
      meta: { ...s.meta, voiceSettings: { ...s.meta.voiceSettings, ...patch } },
      saveStatus: "idle",
    }));
  },
  updateBgmSettings: (patch) => {
    // 書き出し中は BGM 設定（曲/音量/オンオフ）も固定する（#547 P2-1 レビュー・#570 P1）。設定だけ変わって進行中の
    // 書き出し（スナップショット）に効かない「設定できるのに効かない」を避ける（ADR-0026④）。BgmPicker が bgmError を表示。
    if (isExportBusy(get().exportRun.phase)) { set({ bgmError: EXPORT_BUSY_BGM_MSG }); return; }
    get().pushHistory();
    set((s) => ({
      meta: { ...s.meta, bgmSettings: { ...s.meta.bgmSettings, ...patch } },
      saveStatus: "idle",
    }));
  },
  setBgmAsset: (assetId) => {
    if (isExportBusy(get().exportRun.phase)) { set({ bgmError: EXPORT_BUSY_BGM_MSG }); return; } // 書き出し中は固定（#570 P1）
    // ⚠️ **この動画にある音だけ**＝一覧に無い id を書くと、書き出しで「素材が見つからない」になる。
    if (!get().assets.some((a) => a.assetId === assetId && a.assetType === ASSET_TYPE.bgm)) return;
    get().pushHistory();
    set((s) => ({
      meta: {
        ...s.meta,
        bgmSettings: {
          ...s.meta.bgmSettings,
          enabled: true,
          // 同梱の曲とは**どちらか一方**（`setBundledBgm` と対称）。
          bundledBgmId: null,
          assetId,
          volume: s.meta.bgmSettings?.volume ?? BGM_VOLUME,
          loop: true,
        },
      },
      saveStatus: "idle",
      bgmError: null,
    }));
  },
  setBundledBgm: (bundledBgmId) => {
    if (isExportBusy(get().exportRun.phase)) { set({ bgmError: EXPORT_BUSY_BGM_MSG }); return; } // 書き出し中は固定（#570 P1・ADR-0026④）
    get().pushHistory();
    set((s) => ({
      meta: {
        ...s.meta,
        bgmSettings: {
          ...s.meta.bgmSettings,
          enabled: true,
          bundledBgmId,
          assetId: null,
          volume: s.meta.bgmSettings?.volume ?? BGM_VOLUME,
          loop: true,
        },
      },
      saveStatus: "idle",
      bgmError: null,
    }));
  },
  updateAsset: (assetId, update) => {
    // 書き出し中はプロジェクトを固定する（#547 P2-1・#379 と同じ「書き出し中は編集不可」＝ADR-0026②）。書き出しは素材
    // リストをスナップショットして進むので追加/削除/メタ編集は進行中の書き出しには波及しないが、画像/BGM の差し替えは
    // 同一パスへ上書きするため（setAssetImage/setBgm）書き出しが disk から読むファイルと競合しうる＝一貫して止める。
    // 無言 no-op にせず案内を出す（素材画面以外＝場面編集/ウィザードからの操作でも「押しても効かない」を避ける・ADR-0026④）。
    if (isExportBusy(get().exportRun.phase)) { set({ importError: EXPORT_BUSY_ASSET_MSG }); return; }
    set((s) => ({
      assets: s.assets.map((a) => (a.assetId === assetId ? update(a) : a)),
      saveStatus: "idle",
    }));
  },
  // ⚠️ **1件も複数も同じ道を通す**（ADR-0026②）＝片方だけファイルを片づける、を作らない。
  removeAsset: (assetId) => { get().removeAssets([assetId]); },
  removeAssets: (assetIds) => {
    if (isExportBusy(get().exportRun.phase)) { set({ importError: EXPORT_BUSY_ASSET_MSG }); return; } // 書き出し中は固定（#547 P2-1）
    // ⚠️ **取り込み中は消さない**（レビュー 🟡）＝`asset_NNN` は**空き番号を埋める**採番なので、
    // 消した番号を取り込み中のものが拾いうる。ファイルの片づけは待たない（`void`）ので、
    // **後から着地した削除が、新しく取り込んだファイルを消す**窓ができる。
    if (get().isImporting) { set({ importError: IMPORT_BUSY_MESSAGE }); return; }
    if (assetIds.length === 0) return;
    const gone = new Set(assetIds);
    const { assets, meta } = get();
    // ⚠️ **消す前にファイルの場所を控える**＝`set` の後だと素材が居ないので、何を消すか分からなくなる。
    // 代表フレーム（動画）も一緒に片づける（本体だけ消すとサムネが残る）。
    const files = assets
      .filter((a) => gone.has(a.assetId))
      .flatMap((a) => [a.filePath, a.thumbnailPath].filter((p): p is string => typeof p === "string"));
    set((s) => ({
      assets: s.assets.filter((a) => !gone.has(a.assetId)),
      // 表示用 src（data URL）も即メモリから落とす（消した素材の src を残さない・#390）。
      assetSrcById: Object.fromEntries(Object.entries(s.assetSrcById).filter(([id]) => !gone.has(id))),
      // 消したものに「見つかりません」の印が残らない（直しようが無い警告を出さない・§2-5）。
      missingAssetIds: s.missingAssetIds.filter((id) => !gone.has(id)),
      saveStatus: "idle",
    }));
    // ⚠️ **ファイルの片づけは待たない**＝一覧からはもう消えており、片づけの成否で画面を止める理由が無い
    //（消せなくても次の取り込みで上書きされるだけの無害な余り＝ADR-0021 の孤立掃除と同じ流儀）。
    if (meta.projectId) void deleteProjectFiles(meta.projectId, files);
  },
  addTemplatePack: (incoming) => {
    // 書き出し中はパック取り込みも止める（同 id の使用中テンプレを上書きしうる＝save/delete と同じ固定・#570 レビュー・store 側の2層目）。
    if (isExportBusy(get().exportRun.phase)) { set({ templateError: EXPORT_BUSY_TEMPLATE_MSG }); return; }
    set((s) => {
      // templateId で重複排除（取り込んだものが同IDの既存を上書き）。順序は既存→新規。
      // テンプレは project.json に保存しない（利用可能な見た目パターン）ので saveStatus は変えない。
      // 取り込んだパックはセッション内で保持し newProject でもリセットしない（永続化/リセットは将来フェーズ＝B2 スコープ外）。
      const byId = new Map(s.templates.map((t) => [t.templateId, t] as const));
      for (const t of incoming) byId.set(t.templateId, t);
      return { templates: [...byId.values()] };
    });
  },
  loadUserTemplates: async () => {
    // グローバルのユーザーテンプレを読み、templates の user_tmpl 部分を差し替える（冪等）。非 Tauri は空。
    // 同時にテンプレ所有素材の表示用 URL も一括ロード（プロジェクト非依存・起動時＝ADR-0021 PR C）。
    const [user, templateAssetSrcById] = await Promise.all([
      userTemplateFs.loadUserTemplates(),
      loadTemplateAssetUrls(),
    ]);
    set((s) => ({ templates: replaceUserTemplates(s.templates, user.templates), templateAssetSrcById }));
    // 孤立したテンプレ素材ファイルを安全条件下で掃除（#299）。下書き破棄やテンプレ削除時の削除失敗で残ったファイルが対象。
    // user.complete が false（読込失敗・破損・検証却下）なら何もしない＝「空を全削除」の誤削除を防ぐ（ADR-0021 の注意）。
    const orphans = orphanTemplateAssetIds(get().templates, Object.keys(templateAssetSrcById), user.complete);
    if (orphans.length > 0) {
      for (const assetId of orphans) await deleteTemplateAsset(assetId); // 失敗は templateAssetFs 内で握る（非致命）
      set((s) => ({
        templateAssetSrcById: Object.fromEntries(
          Object.entries(s.templateAssetSrcById).filter(([id]) => !orphans.includes(id)),
        ),
      }));
    }
  },
  saveUserTemplate: async (template) => {
    // 書き出し中は見た目パターンを保存しない（#570 P1 レビュー）。使用中テンプレを保存すると、書き出しは開始時の見た目を
    // snap するのに保存/仕上がり確認だけ新しくなる＝MP4 と食い違う（15§4・ADR-0026④）。duplicate/createBlank もここを通る。
    if (isExportBusy(get().exportRun.phase)) { set({ templateError: EXPORT_BUSY_TEMPLATE_MSG }); return; }
    if (get().isTemplateMutating) return; // 進行中の見た目変更を1本に保つ（isImporting と対称）。無いと2本目の finally が先に flag を落とし、その隙に書き出しが割り込む（#570 レビュー）。
    set({ isTemplateMutating: true }); // 最初の await 前に排他を立てる＝書き出し開始側がこれを見て止まる（#570 レビュー・isImporting と対称）。
    try {
      // 排他フラグで書き出し開始をブロックするので、await 中に書き出しが割り込まない＝保存はファイル/一覧まで完走できる
      //（途中で set をスキップするとファイルだけ残り一覧に出ない不整合になるため、完了側の中断はしない）。
      await userTemplateFs.saveUserTemplate(template);
      set((s) => ({ templates: upsertUserTemplate(s.templates, template), templateError: null }));
    } catch {
      set({ templateError: "見た目パターンを保存できませんでした。もう一度お試しください。" });
    } finally {
      set({ isTemplateMutating: false });
    }
  },
  deleteUserTemplate: async (templateId) => {
    // 書き出し中は削除しない（使用中テンプレを消すと場面が標準へ置換され、MP4(旧)と保存/確認(新)が食い違う・#570 P1 レビュー）。
    if (isExportBusy(get().exportRun.phase)) { set({ templateError: EXPORT_BUSY_TEMPLATE_MSG }); return false; }
    // ユーザーテンプレ以外（同梱/取り込みパック）はこのアクションで消さない（誤渡し時の同梱消去防止）。
    if (!isUserTemplate(templateId)) return false;
    // 削除前に所有素材 id を控える（テンプレ素材は登録テンプレ専用ゆえ、テンプレと一緒に掃除する＝ADR-0021）。
    const owned = templateAssetIdsOf(get().templates.find((t) => t.templateId === templateId)?.layers ?? []);
    if (get().isTemplateMutating) return false; // 進行中の見た目変更を1本に保つ（isImporting と対称・#570 レビュー）。
    set({ isTemplateMutating: true }); // 最初の await 前に排他（#570 レビュー）。書き出し開始がこれを見て止まる＝削除はファイル/場面置換まで完走できる。
    try {
      await userTemplateFs.deleteUserTemplate(templateId);
      // 各素材ファイルの削除失敗は templateAssetFs 内で握る（非致命）。失敗時はファイルが残るが、参照していたテンプレは消えるため未参照＝孤立（disk のみ・許容）。残った孤立は次回起動の読込時に安全条件下で掃除される（#299・loadUserTemplates）。
      for (const assetId of owned) await deleteTemplateAsset(assetId);
      set((s) => {
        const remainingTemplates = s.templates.filter((t) => t.templateId !== templateId);
        // 開いているプロジェクトで、この見た目を使っていた場面を標準へ置換＝孤立参照（存在しない templateId）を
        // 残さない（#458・§9「参照中のプロジェクトは標準へ自動置換」）。代替が無い場面は原状維持（§9 補正が描画時に対応）。
        const nextScenes = substituteDeletedTemplateInScenes(
          s.scenes, templateId, remainingTemplates, s.meta.videoSettings.aspectRatio,
        );
        return {
          templates: remainingTemplates,
          scenes: nextScenes,
          templateAssetSrcById: Object.fromEntries(
            Object.entries(s.templateAssetSrcById).filter(([id]) => !owned.includes(id)),
          ),
          templateError: null,
          // 場面を置換したら未保存に（保存で永続化）。変化なし（同一参照）なら現状維持。
          ...(nextScenes !== s.scenes ? { saveStatus: "idle" as const } : {}),
        };
      });
      return true;
    } catch {
      set({ templateError: "見た目パターンを削除できませんでした。もう一度お試しください。" });
      return false;
    } finally {
      set({ isTemplateMutating: false });
    }
  },
  duplicateAsUserTemplate: async (sourceTemplateId) => {
    const s = get();
    const source = s.templates.find((t) => t.templateId === sourceTemplateId);
    if (!source) return "";
    const newId = userTemplateFs.allocateUserTemplateId(s.templates.map((t) => t.templateId));
    // 同梱/別ユーザーテンプレを複製し、新 id とコピー名で保存（saveUserTemplate が保存＋一覧反映＋エラー処理）。
    const copy: Template = { ...source, templateId: newId, name: `${source.name}のコピー` };
    await get().saveUserTemplate(copy);
    // 保存に失敗していたら id を返さない（呼び出し側で選択しない）。
    return get().templates.some((t) => t.templateId === newId) ? newId : "";
  },
  createBlankUserTemplate: async (name, category, orientation) => {
    const s = get();
    const newId = userTemplateFs.allocateUserTemplateId(s.templates.map((t) => t.templateId));
    // ゼロから（背景1枚の最小構成）作って保存（saveUserTemplate が保存＋一覧反映＋エラー処理）。複製と同じ後処理。
    const blank = buildBlankTemplate(newId, name, category, orientation);
    await get().saveUserTemplate(blank);
    return get().templates.some((t) => t.templateId === newId) ? newId : "";
  },
  registerTemplateAsset: async (file) => {
    // 書き出し中は見た目の既定素材も追加しない（テンプレ変更と同じく固定・#570 P1 レビュー）。
    if (isExportBusy(get().exportRun.phase)) { set({ templateError: EXPORT_BUSY_TEMPLATE_MSG }); return null; }
    if (get().isTemplateMutating) return null; // 進行中の見た目変更を1本に保つ（isImporting と対称・#570 レビュー）。
    set({ isTemplateMutating: true }); // 最初の await 前に排他（書き出し開始側がこれを見て止まる＝取り込みも完走できる）。
    try {
      // 取り込み→グローバル保存（Tauri）→ 表示用 src を合流。採番は現存テンプレ素材 id を基に最大連番+1。
      const result = await importTemplateAsset(file, Object.keys(get().templateAssetSrcById));
      if (!result) return null;
      set((s) => ({ templateAssetSrcById: { ...s.templateAssetSrcById, [result.assetId]: result.url } }));
      return result.assetId;
    } finally {
      set({ isTemplateMutating: false });
    }
  },
  clearTemplateError: () => set({ templateError: null }),
  setEditingTemplateId: (templateId) => set({ editingTemplateId: templateId }),
  setEditingSceneId: (sceneId) => set({ editingSceneId: sceneId }),
  setWizardStep: (step) => set({ wizardStep: step }),
  setConfirmReturnTo: (screen) => set({ confirmReturnTo: screen }),
  setPreviewReturnTo: (screen) => set({ previewReturnTo: screen }),
  setExportRun: (patch) =>
    set((s) => {
      // 「終わったがまだ見ていない」は phase の遷移から自動で決める（#589）＝呼び出し側が立て忘れない。
      // 終端（done/error/cancelled）へ入ったら未読にし、走行/未実行へ戻ったら落とす（次の書き出しに持ち越さない）。
      // patch が phase を含まないとき（進捗更新など）は現状維持。明示指定（画面で見た＝false）は最後に効かせる。
      const auto = patch.phase != null ? { resultUnseen: isExportFinished(patch.phase) } : {};
      return { exportRun: { ...s.exportRun, ...auto, ...patch } };
    }),
  setExportForm: (patch) => set((s) => ({ exportForm: { ...s.exportForm, ...patch } })),
  setAssetImage: async (assetId, file) => {
    // 書き出し中は同一パスへの画像上書きを止める（書き出しが読んでいるファイルと競合して壊れる＝実害・#547 P2-1）。
    if (isExportBusy(get().exportRun.phase)) { set({ importError: EXPORT_BUSY_ASSET_MSG }); return; }
    if (get().isImporting) return; // 取り込み中の多重実行を防ぐ
    // 大容量はメモリへ展開しない（#48・A3）。小さい画像のみ data URL で即時表示する。
    if (exceedsInlineAssetLimit(file.size)) {
      const limitMb = Math.round(MAX_INLINE_ASSET_BYTES / (1024 * 1024));
      set({ importError: `この画像は大きすぎます（上限${limitMb}MB）。別の小さい画像を選び直してください。` });
      return;
    }
    // ⚠️ **着地は「まだ同じ動画を開いているか」で括る**（差分再監査）＝ほかの取り込み5経路と同じ規則。
    // ここだけ無防備だと、差し替えの完了が**別の動画の同じ番号の素材**を書き換える。
    const stillOpen = sameDocGuard(get);
    // 最初の await の前に取り込みロック(isImporting)を取得＝書き出し開始と相互排他（#570 P1）。書き出し側は開始前に
    // isImporting を見て止まる（ExportScreen）。以降は全ての離脱経路で isImporting を戻す（下の catch/finally）。
    set({ isImporting: true });
    // 画像は表示＋書き出し(ADR-0004)で data URL が必要。読み込んで即時表示。
    let dataUrl: string;
    try {
      dataUrl = await fileToDataUrl(file);
    } catch {
      set({ importError: "画像を読み込めませんでした。別の画像をお選びください。", isImporting: false }); // §2-5：次の行動。
      return;
    }
    // 読み込み中に書き出しが始まっていたら、表示も上書きもせず戻る（開始チェックをすり抜けた残り窓・#570 P1）。
    if (isExportBusy(get().exportRun.phase)) { set({ importError: EXPORT_BUSY_ASSET_MSG, isImporting: false }); return; }
    if (!stillOpen()) { set({ isImporting: false }); return; }
    set((s) => ({ assetSrcById: { ...s.assetSrcById, [assetId]: dataUrl }, importError: null }));
    try {
      // 保存先フォルダの名前空間のため projectId を確保する。
      let projectId = get().meta.projectId;
      if (!projectId) {
        const existing = await listProjectSummaries();
        projectId = createProjectId(new Date(), existing.map((p) => p.projectId));
        // ⚠️ **番号の着地も括る**（差分再監査）＝一覧を読んでいる間に別の動画を開くと、
        // **新しい動画の projectId を採り立ての別 id で上書き**する（以後の自動保存が別フォルダへ＝#762）。
        if (!stillOpen()) return;
        set((s) => ({ meta: { ...s.meta, projectId } }));
      }
      // 拡張子処理は addAsset と同じ fileExtension に集約（§2-7：単一の参照元）。
      const ext = fileExtension(file.name) || "png";
      const filePath = await importAssetFile(projectId, `${assetId}.${ext}`, dataUrl);
      if (filePath) {
        // 取り込み後は表示用 src を asset:// に差し替え、data URL の常駐を解消する（A3-2 レビュー）。
        // 画像差し替えは同名パス（{assetId}.{ext}）へ上書き保存するため asset:// の URL が変わらず、
        // webview が旧画像をキャッシュして差し替えが反映されない（#140 由来）。変更時刻のクエリを付けて
        // キャッシュバスターにし、再取得させる（filePath 自体はクエリ無し＝保存データは汚さない）。
        const displayUrl = await assetDisplayUrl(projectId, filePath);
        const freshUrl = displayUrl ? `${displayUrl}?t=${Date.now()}` : displayUrl;
        // ⚠️ **差し替えた絵の大きさも測り直す**（差分再監査）＝測らないと `metadata` に**前の絵の
        // 解像度**が残り、「ぼやける素材」の注意が実物と食い違う（取り込みの4経路は測っている）。
        const size = await probeImageSize(projectId, filePath);
        if (!stillOpen()) return;
        set((s) => ({
          assets: s.assets.map((a) => (a.assetId === assetId ? { ...a, filePath, ...(size ? { metadata: size } : {}) } : a)),
          assetSrcById: freshUrl ? { ...s.assetSrcById, [assetId]: freshUrl } : s.assetSrcById,
        }));
      }
    } catch (e) {
      // 表示は維持しつつ、保存に失敗したことを通知する（CLAUDE.md §2-5）。
      if (stillOpen()) set({ importError: importErrorMessage(e) });
    } finally {
      set({ isImporting: false });
    }
  },
  addAsset: async (file) => {
    if (isExportBusy(get().exportRun.phase)) { set({ importError: EXPORT_BUSY_ASSET_MSG }); return; } // 書き出し中は固定（#547 P2-1）
    if (get().isImporting) return; // 取り込み中の多重実行を防ぐ
    // 大容量はメモリへ展開せず、ネイティブ「開く」のパス0コピー取り込み（addAssetByPath）へ誘導する（#48・A3）。
    if (exceedsInlineAssetLimit(file.size)) {
      set({ importError: assetTooLargeMessage(ASSET_TOO_LARGE_USE_PICKER) });
      return;
    }
    // ⚠️ **合図は採番より前に作る**（`sameDocGuard` の約束・差分再監査）＝`asset_NNN` は**この時点の**
    // 一覧から採るので、画像を読んでいる間に別の動画を開くと**古い番号のまま新しい動画へ着地**する
    //（番号が重なれば `11.2` の一意性が破れ、同名ファイルを上書きし、巻き戻しが別の素材を消す）。
    const stillOpen = sameDocGuard(get);
    // 素材1つぶんの導出は domain に1つ（#712・§2-7）。詳細メタ(長さ・音声有無)・クリップ設定は follow-up。
    const { asset, fileName } = newAssetFrom(file.name, get().assets.map((a) => a.assetId));
    const { assetId, assetType } = asset;
    // 最初の await の前に取り込みロック(isImporting)を取得＝書き出し開始と相互排他（#570 P1）。以降の離脱は isImporting を戻す。
    set({ isImporting: true });
    // 画像は表示＋書き出し(ADR-0004)で data URL が要る。動画は表示用srcを持たない
    //（サムネは別途・書き出しはスロットを別経路で合成＝src不要。ADR-0006）。
    let dataUrl: string | undefined;
    if (assetType !== ASSET_TYPE.video) {
      try {
        dataUrl = await fileToDataUrl(file);
      } catch {
        set({ importError: "画像を読み込めませんでした。別の画像をお選びください。", isImporting: false }); // §2-5。素材は追加しない。
        return;
      }
    }
    // 読み込み中に書き出しが始まっていたら、一覧に足さず戻る（開始チェックをすり抜けた残り窓・#570 P1）。
    if (isExportBusy(get().exportRun.phase)) { set({ importError: EXPORT_BUSY_ASSET_MSG, isImporting: false }); return; }
    // 着地は上で作った合図（`stillOpen`）で括る＝別の動画へこの素材が生えない。
    if (!stillOpen()) { set({ isImporting: false }); return; }
    // 即時：一覧へ追加（画像は表示も）。素材追加で未保存に戻す（「保存しました」取り残し防止）。
    set((s) => ({
      assets: [...s.assets, asset],
      assetSrcById: dataUrl ? { ...s.assetSrcById, [assetId]: dataUrl } : s.assetSrcById,
      saveStatus: "idle",
      importError: null,
    }));
    // 永続化（プロジェクトフォルダへコピー）。
    try {
      let projectId = get().meta.projectId;
      if (!projectId) {
        const existing = await listProjectSummaries();
        projectId = createProjectId(new Date(), existing.map((p) => p.projectId));
        // ⚠️ **番号の着地も括る**（差分再監査）＝一覧を読んでいる間に別の動画を開くと、
        // **新しい動画の projectId を採り立ての別 id で上書き**する（以後の自動保存が別フォルダへ＝#762）。
        if (!stillOpen()) return;
        set((s) => ({ meta: { ...s.meta, projectId } }));
      }
      if (assetType === ASSET_TYPE.video) {
        // 動画は base64 を経由せず生バイトで取り込む（大容量でもメモリを食わない。data URL は使い捨てのため）。
        const savedPath = await importAssetBytes(
          projectId,
          fileName,
          new Uint8Array(await file.arrayBuffer()),
        );
        // savedPath は楽観設定した filePath と一致する（assetId.ext は sanitize で不変）。?? は保険。
        const relPath = savedPath ?? asset.filePath;
        // メタ・サムネは取り込みの成否と独立（失敗してもロールバックしない）。
        const enrich = await probeAndThumbVideo(projectId, relPath);
        if (stillOpen()) set(applyEnrichment(assetId, enrich));
      } else {
        // 画像は data URL で取り込み、取り込み後は表示用 src を asset:// に差し替える（data URL 常駐を解消・A3-2 レビュー）。
        const savedPath = await importAssetFile(projectId, fileName, dataUrl!);
        const displayUrl = savedPath ? await assetDisplayUrl(projectId, savedPath) : null;
        if (displayUrl && stillOpen()) set((s) => ({ assetSrcById: { ...s.assetSrcById, [assetId]: displayUrl } }));
        // ⚠️ **写真も大きさを測る**（#346・パス経路と同じ）＝取り込み方で片方だけ測ると、
        // 「ぼやける素材」の注意が**入れ方によって出たり出なかったり**する（ADR-0026②）。
        const size = savedPath ? await probeImageSize(projectId, savedPath) : null;
        if (size && stillOpen()) set((s) => ({ assets: s.assets.map((a) => (a.assetId === assetId ? { ...a, metadata: size } : a)) }));
      }
    } catch (e) {
      // 取り込み失敗：楽観追加した素材をロールバックし、原因（Rust文言）を通知する（§2-5）。
      if (!stillOpen()) return;
      set((s) => ({
        assets: s.assets.filter((a) => a.assetId !== assetId),
        assetSrcById: Object.fromEntries(
          Object.entries(s.assetSrcById).filter(([id]) => id !== assetId),
        ),
        importError: importErrorMessage(e),
      }));
    } finally {
      set({ isImporting: false });
    }
  },
  // 真の0コピー取り込み（Tauri）：ネイティブ「開く」で選んだ絶対パスを Rust がコピーする。
  // JS は素材バイトを一切読まない。画像の表示用 data URL は取り込み後にディスクから読み戻す（ADR-0004）。
  addAssetByPath: async (path) => {
    if (isExportBusy(get().exportRun.phase)) { set({ importError: EXPORT_BUSY_ASSET_MSG }); return; } // 書き出し中は固定（#547 P2-1）
    if (get().isImporting) return; // 取り込み中の多重実行を防ぐ
    // パス末尾から種別・拡張子・表示名を決める（導出は domain に1つ＝#712・§2-7）。
    const { asset, fileName } = newAssetFrom(path, get().assets.map((a) => a.assetId));
    const { assetId, assetType } = asset;
    // ⚠️ **着地は「まだ同じ動画を開いているか」で括る**（🟡9 と同じ理由）。
    const stillOpen = sameDocGuard(get);
    // 即時：一覧へ追加（表示用 src は取り込み後に読み戻す）。素材追加で未保存に戻す。
    set((s) => ({ assets: [...s.assets, asset], saveStatus: "idle", importError: null }));
    set({ isImporting: true });
    try {
      let projectId = get().meta.projectId;
      if (!projectId) {
        const existing = await listProjectSummaries();
        projectId = createProjectId(new Date(), existing.map((p) => p.projectId));
        // ⚠️ **番号の着地も括る**（差分再監査）＝一覧を読んでいる間に別の動画を開くと、
        // **新しい動画の projectId を採り立ての別 id で上書き**する（以後の自動保存が別フォルダへ＝#762）。
        if (!stillOpen()) return;
        set((s) => ({ meta: { ...s.meta, projectId } }));
      }
      // 元ファイルを Rust が直接コピー（バイトは JS を経由しない）。
      const savedPath = await importAssetByPath(projectId, fileName, path);
      const relPath = savedPath ?? asset.filePath;
      if (assetType === ASSET_TYPE.video) {
        // メタ・サムネは取り込みの成否と独立（失敗してもロールバックしない）。
        const enrich = await probeAndThumbVideo(projectId, relPath);
        if (stillOpen()) set(applyEnrichment(assetId, enrich));
      } else {
        // 画像の表示用 src を取り込んだ実体から解決（Tauri は asset://）。書き出しの data URL は書き出し時に別途読む（A3-2/ADR-0004）。
        const url = await assetDisplayUrl(projectId, relPath);
        if (url && stillOpen()) set((s) => ({ assetSrcById: { ...s.assetSrcById, [assetId]: url } }));
        // ⚠️ **写真も大きさを測る**（#346）＝測らないと「ぼやける素材」の注意が**写真では一度も
        // 出ない**（判定の材料が無いので黙って素通り）。測れなくても取り込みは続ける。
        const size = await probeImageSize(projectId, relPath);
        if (size && stillOpen()) set((s) => ({ assets: s.assets.map((a) => (a.assetId === assetId ? { ...a, metadata: size } : a)) }));
      }
    } catch (e) {
      // 取り込み失敗：楽観追加した素材をロールバックし、原因（Rust文言）を通知する（§2-5）。
      if (!stillOpen()) return;
      set((s) => ({
        assets: s.assets.filter((a) => a.assetId !== assetId),
        assetSrcById: Object.fromEntries(
          Object.entries(s.assetSrcById).filter(([id]) => id !== assetId),
        ),
        importError: importErrorMessage(e),
      }));
    } finally {
      set({ isImporting: false });
    }
  },
  importFromLibrary: async (libraryAssetId) => {
    // 取り込みと同じ門（書き出し中は固定・二重取り込みを避ける）＝同じことをする操作は同じ断り方（ADR-0026②）。
    if (isExportBusy(get().exportRun.phase)) { set({ importError: EXPORT_BUSY_ASSET_MSG }); return null; }
    if (get().isImporting) { set({ importError: IMPORT_BUSY_MESSAGE }); return null; }
    // ⚠️ **旗も最初の `await` より前に立てる**（差分再監査 ℹ️）＝一覧を読んでいる間は旗が下りたままなので、
    // その窓では**2本ともこの門を通れる**。通ると両方が同じ `assets` から**同じ `asset_NNN`** を採り、
    // 同じファイル名で上書きコピーして、`assets` に**同じ id が2件**並ぶ（保存時の検査は警告だけで通る）。
    // ⚠️ **早期 return では必ず下ろす**（下ろし忘れると以後の取り込みが「いま取り込んでいます」で
    // 通らなくなる＝直しようのない行き止まり）。
    set({ isImporting: true });
    const done = <T,>(v: T): T => { set({ isImporting: false }); return v; };
    // ⚠️ **合図は最初の `await` より前**（`sameDocGuard` の約束・差分再監査）＝一覧を読んでいる間にも
    // 別の動画を開けるので、ここより後で作ると**開いた動画へ会社のロゴが黙って生える**
    //（`applyBrandKitToNew` はこの関数を呼ぶ＝外側のガードだけでは守れない窓）。
    const stillOpen = sameDocGuard(get);
    // ⚠️ **「読めなかった」と「1つも無い」を分ける**（差分再監査 2巡目・§2-5）＝`null` を潰して
    // 「見つかりませんでした」に丸めると、**置いてあるのに置いていないかのような案内**になる
    //（会社の見た目のロゴを足す経路では「「よく使う素材」に置いてあるか確かめてください」に化ける）。
    const list = await listLibraryAssets();
    if (list == null) {
      set({ importError: "よく使う素材の一覧を読めませんでした。アプリを開き直してから、もう一度お試しください。" });
      return done(null);
    }
    const lib = list.find((a) => a.id === libraryAssetId);
    if (!lib) { set({ importError: "この素材は見つかりませんでした。一覧を開き直してください。" }); return done(null); }
    const { asset, fileName } = assetFromLibrary(lib, get().assets.map((a) => a.assetId));
    if (!stillOpen()) return done(null);
    set({ importError: null });
    try {
      let projectId = get().meta.projectId;
      if (!projectId) {
        // 取り込みと同じく、保存前なら**ここで番号を採る**（素材の置き場が要るため）。
        const existing = await listProjectSummaries();
        projectId = createProjectId(new Date(), existing.map((p) => p.projectId));
        // ⚠️ **番号の着地も括る**（差分再監査 2巡目）＝一覧を読んでいる間に別の動画を開くと、
        // **新しい動画の projectId を採り立ての別 id で上書き**する（以後の自動保存が別フォルダへ）。
        if (!stillOpen()) return null;
        set((st) => ({ meta: { ...st.meta, projectId } }));
      }
      const relPath = await copyLibraryAssetToProject(libraryAssetId, projectId, fileName);
      // ⚠️ **できてから一覧へ足す**（切り出し #349 と同じ）＝コピーは失敗しうるので、
      // 先に足すと**中身の無い素材**が一瞬見えてから消える。
      if (!stillOpen()) return null;
      set((st) => ({ assets: [...st.assets, { ...asset, filePath: relPath }], saveStatus: "idle" }));
      if (asset.assetType === ASSET_TYPE.video) {
        const enrich = await probeAndThumbVideo(projectId, relPath);
        if (stillOpen()) set(applyEnrichment(asset.assetId, enrich));
      } else {
        const url = await assetDisplayUrl(projectId, relPath);
        if (url && stillOpen()) set((st) => ({ assetSrcById: { ...st.assetSrcById, [asset.assetId]: url } }));
        // ⚠️ **写真も大きさを測る**（α-6 出口監査 🟡10）＝測らないと「ぼやける素材」の注意が
        // **ここから取り込んだ写真では一度も出ない**（取り込みの経路で挙動が割れる＝ADR-0026②）。
        const size = await probeImageSize(projectId, relPath);
        if (size && stillOpen()) set((st) => ({ assets: st.assets.map((a) => (a.assetId === asset.assetId ? { ...a, metadata: size } : a)) }));
      }
      return asset.assetId;
    } catch (e) {
      if (stillOpen()) set({ importError: importErrorMessage(e) });
      return null;
    } finally {
      set({ isImporting: false });
    }
  },
  captureVideoFrame: async (videoAssetId, atSec) => {
    // 取り込みと同じ門（書き出し中は固定・二重取り込みを避ける）＝同じことをする操作は同じ断り方（ADR-0026②）。
    if (isExportBusy(get().exportRun.phase)) { set({ importError: EXPORT_BUSY_ASSET_MSG }); return null; }
    if (get().isImporting) { set({ importError: IMPORT_BUSY_MESSAGE }); return null; }
    const src = get().assets.find((a) => a.assetId === videoAssetId);
    const projectId = get().meta.projectId;
    // ⚠️ **保存前のプロジェクトでは切り出せない**＝元の動画がまだフォルダに無い（§2-5＝次の行動を出す）。
    if (!src || src.assetType !== ASSET_TYPE.video || !projectId) {
      set({ importError: "先に動画を取り込んでから、切り出したい時間を選んでください。" });
      return null;
    }
    const { asset, fileName } = newFrameAsset(src.displayName, atSec, get().assets.map((a) => a.assetId));
    // ⚠️ **着地は「まだ同じ動画を開いているか」で括る**（🟡9 と同じ理由＝切り出しの間に開き直せる）。
    const stillOpen = sameDocGuard(get);
    set({ isImporting: true, importError: null });
    try {
      const relPath = await extractVideoFrame(projectId, src.filePath, atSec, fileName);
      // ⚠️ **できてから一覧へ足す**（取り込みの楽観追加と違う）＝切り出しは失敗しうる（尺の外・壊れた動画）ので、
      // 先に足すと**中身の無い素材**が一瞬見えてから消える。押した結果が出てから増やす。
      if (!stillOpen()) return null;
      set((s) => ({ assets: [...s.assets, { ...asset, filePath: relPath }], saveStatus: "idle" }));
      const url = await assetDisplayUrl(projectId, relPath);
      if (url && stillOpen()) set((s) => ({ assetSrcById: { ...s.assetSrcById, [asset.assetId]: url } }));
      // ⚠️ **切り出した絵も大きさを測る**（🟡10 と同じ＝取り込みの経路で挙動を割らない・ADR-0026②）。
      const size = await probeImageSize(projectId, relPath);
      if (size && stillOpen()) set((s) => ({ assets: s.assets.map((a) => (a.assetId === asset.assetId ? { ...a, metadata: size } : a)) }));
      return asset.assetId;
    } catch (e) {
      if (stillOpen()) set({ importError: importErrorMessage(e) });
      return null;
    } finally {
      set({ isImporting: false });
    }
  },
  addAssets: async (items) => {
    // ⚠️ **入口で1回だけ断る**（§2-5）＝途中で `isImporting` に弾かれて**黙って落ちる**のを防ぐ。
    // 単発の取り込みは自分で同じ確認をするが、あちらは**黙って return** するので、まとめて渡すと
    // 「入りました」の顔で数件だけ消える。ここで先に止めて理由を出す。
    if (isExportBusy(get().exportRun.phase)) { set({ importError: EXPORT_BUSY_ASSET_MSG }); return; }
    if (get().isImporting) { set({ importError: IMPORT_BUSY_MESSAGE }); return; }
    if (items.length === 0) return;

    // ⚠️ **1件だけのときは進み具合を出さない**＝一瞬出て消える表示は雑音になる。
    if (items.length > 1) set({ importProgress: { done: 0, total: items.length } });
    const failedNames: string[] = [];
    let firstMessage: string | null = null;
    try {
      for (const [i, item] of items.entries()) {
        // ⚠️ **別の取り込みに横取りされていたら、そこで止める**（#858 レビュー ℹ️）＝
        // 一括の**途中は無ロック**（各件が `finally` で下ろす）なので、隙に BGM 取り込み等が
        // ロックを取ると、次の1件は取り込み側で**黙って return** し、`importError` も立たないため
        // **成功として数えてしまう**。残りは入らないので、ここで打ち切って名前に挙げる。
        if (get().isImporting) {
          for (const rest of items.slice(i)) failedNames.push(fileNameOf(typeof rest === "string" ? rest : rest.name) || UNNAMED_ASSET_NAME);
          firstMessage ??= IMPORT_BUSY_MESSAGE;
          break;
        }
        // 1件ぶんの結果を見分けるため、直前に消してから通す（成功時は取り込み側が null にする）。
        set({ importError: null });
        // ⚠️ **必ず `await` で1件ずつ**（11.2）＝`asset_NNN` は `get().assets` を見て採る。
        // `Promise.all` にすると、まず**2件目以降が `isImporting` ガードに黙って弾かれ**
        //（＝入ったつもりで消える）、そのガードを外すと**同じ番号を2つ採る**。
        // どちらも「衝突しないから並列で安全」ではない。
        if (typeof item === "string") await get().addAssetByPath(item);
        else await get().addAsset(item);
        const message = get().importError;
        if (message) {
          // ⚠️ **失敗しても止めない**＝成功した分は残す（§2-5）。
          failedNames.push(fileNameOf(typeof item === "string" ? item : item.name) || UNNAMED_ASSET_NAME);
          firstMessage ??= message;
        }
        if (items.length > 1) set({ importProgress: { done: i + 1, total: items.length } });
      }
    } finally {
      set({ importProgress: null });
    }

    // ⚠️ **1件だけ失敗したときは、その理由をそのまま出す**＝単発で取り込んだときと同じ文言になる
    // （ADR-0026②＝件数で案内が変わらない）。複数なら**何が入らなかったか**を名前で足す。
    // ⚠️ **全部入ったときにここで消し直さない**＝各件の**直前**で消しているので、最後の1件が成功した
    // 時点で既に空（変異チェックで「消す」行を外しても挙動が変わらなかった＝死んだ枝だった）。
    if (failedNames.length === 1) set({ importError: firstMessage });
    else if (failedNames.length > 1) set({ importError: importPartlyFailedMessage(failedNames, firstMessage) });
  },
  relinkAssetByPath: async (assetId, srcPath) => {
    // 断り方は取り込みと同じ経路（同じ状況で同じ案内＝ADR-0026②）。
    if (isExportBusy(get().exportRun.phase)) { set({ importError: EXPORT_BUSY_ASSET_MSG }); return; }
    if (get().isImporting) { set({ importError: IMPORT_BUSY_MESSAGE }); return; }
    const target = get().assets.find((a) => a.assetId === assetId);
    if (!target) return;
    // ⚠️ **種類の違うファイルへは差し替えない**（§2-5・ADR-0026④）＝写真↔動画で入れ替えると、
    // 種類を変えれば**置いた差し込み口が受け付けなくなって黙って消え**、種類を変えなければ
    // **写真として動画を描く**ことになり何も映らない。どちらも黙って別の結果なので、断って手を示す。
    // ⚠️ 判定は **`changesAssetKind`（動画かどうか）**＝`assetType` と直接くらべると
    // `logo`/`yuko`/`qr`/`decor` が素通りして**無言で差し替わる**（この画面はそれらも一覧に出す）。
    // ⚠️ **着地は「まだ同じ動画を開いているか」で括る**（差分再監査 2巡目・ほかの取り込み経路と同じ規則）。
    const stillOpen = sameDocGuard(get);
    if (changesAssetKind(target.assetType, srcPath)) {
      set({ importError: assetTypeMismatchMessage(target.assetType === ASSET_TYPE.video) });
      return;
    }

    set({ isImporting: true, importError: null });
    try {
      let projectId = get().meta.projectId;
      if (!projectId) {
        const existing = await listProjectSummaries();
        projectId = createProjectId(new Date(), existing.map((p) => p.projectId));
        // ⚠️ **番号の着地も括る**（差分再監査 2巡目）＝一覧を読んでいる間に別の動画を開くと、
        // **新しい動画の projectId を採り立ての別 id で上書き**する（以後の自動保存が別フォルダへ）。
        if (!stillOpen()) return;
        set((st) => ({ meta: { ...st.meta, projectId } }));
      }
      // ⚠️ **保存名の導出は `newAssetFrom` に1つ**（§2-7）＝拡張子の既定・`assets/` の付け方を
      // ここへ写すと3つ目のコピーになる（取り込みと再リンクで保存名が黙ってずれる）。
      // 採番済みの id をそのまま使う（`reservedId`）＝**同じ素材のファイルを入れ替える**だけ。
      const { fileName, asset: shape } = newAssetFrom(srcPath, [], assetId);
      const savedPath = await importAssetByPath(projectId, fileName, srcPath);
      const relPath = savedPath ?? shape.filePath;
      // ⚠️ **測り直す**＝前のファイルの長さで範囲を判断すると、実際には無い所を切り出す。
      const enrich = target.assetType === ASSET_TYPE.video ? await probeAndThumbVideo(projectId, relPath) : null;
      // 待っている間に書き出しが始まっていたら、書き換えずに戻る（#570 P1 と同じ流儀）。
      if (isExportBusy(get().exportRun.phase)) { set({ importError: EXPORT_BUSY_ASSET_MSG }); return; }

      // ⚠️ **待つのは「いまの状態を読む」より前に全部済ませる**（PR #874 レビュー 🟢）＝
      // 読んだ後にもう一度 await すると、その隙に入った編集を**古い写しで上書き**しうる
      //（サムネが取れなかったときだけ通る細い経路だった）。await を前へ寄せれば窓ごと消える。
      // ⚠️ **同じ名前へ上書きすると表示が古いまま**＝`asset://` の URL が変わらず webview が
      // 前の絵をキャッシュする（#140）。変更時刻を付けて取り直させる（保存データには入れない）。
      const displayUrl = enrich?.thumbUrl ?? (await assetDisplayUrl(projectId, relPath));
      const freshUrl = displayUrl ? `${displayUrl}?t=${Date.now()}` : null;

      // ⚠️ **本命の着地も括る**（差分再監査 3巡目 🟡）＝`projectId` だけ括っても足りない。
      // 番号は動画ごとに採り直すので `asset_003` は新しい動画にも居る＝`curAsset` は見つかってしまい、
      // **新しい動画の素材の場所を、前の動画のフォルダのパスで上書き**する（場面の収め直しごと）。
      if (!stillOpen()) return;
      const cur = get();
      const curAsset = cur.assets.find((a) => a.assetId === assetId);
      if (!curAsset) return; // 待っている間に消されていたら何も書かない
      const r = relinkAsset(curAsset, cur.scenes, cur.templates, relPath, enrich?.metadata ?? null, enrich?.thumbnailPath ?? null);
      // ⚠️ **収め直した場面だけを差し替える**（`projectstore-async-clobber` の再発防止）＝
      // `r.scenes` には**触っていない場面も元の参照のまま**入っているので、丸ごと置き換えると
      // 待っている間に着地した編集（声の一括作成など）を**古いスナップショットで巻き戻す**。
      const clamped = new Map(
        r.scenes.filter((n, i) => n !== cur.scenes[i]).map((n) => [n.sceneId, n] as const),
      );
      // ⚠️ **収め直しは取り消せるようにする**（ADR-0020）＝`scenes` は履歴 slice なので、
      // 通さずに書き換えると**次の取り消しで収め直しだけが黙って消える**（古い範囲が復活する）。
      if (clamped.size > 0) get().pushHistory();
      set((st) => ({
        assets: st.assets.map((a) => (a.assetId === assetId ? r.asset : a)),
        scenes: clamped.size > 0 ? st.scenes.map((sc) => clamped.get(sc.sceneId) ?? sc) : st.scenes,
        assetSrcById: freshUrl ? { ...st.assetSrcById, [assetId]: freshUrl } : st.assetSrcById,
        // 見つからなかった素材なら、その印を外す（直したのに警告が残らない）。
        missingAssetIds: st.missingAssetIds.filter((id) => id !== assetId),
        saveStatus: "idle",
        // ⚠️ **収め直したことは黙らない**（§2-5）＝どこが変わったか分かるようにする。
        importError: r.clampedUses > 0 ? clipClampedMessage(r.clampedUses) : null,
      }));
    } catch (e) {
      if (stillOpen()) set({ importError: importErrorMessage(e) });
    } finally {
      set({ isImporting: false });
    }
  },

  refreshBrandKit: async () => {
    const kit = await loadBrandKit();
    // ⚠️ **読めなかったら「何も覚えていない」に潰さない**（差分再監査 3巡目 🟡）＝空を見せると、
    // 直後の `updateBrandKit` が**そのまま上書き**して覚えていた字体・色・ロゴが消える。
    // 読めていない間は**書かせない**（目録・読み方辞書と同じ流儀＝ADR-0026②）。
    if (kit == null) { set({ brandKitUnreadable: true }); return; }
    set({ brandKit: kit, brandKitUnreadable: false });
  },
  /**
   * 会社の見た目を**丸ごと置き換えて**保存する。
   *
   * ⚠️ **足りない項目は「変えない」ではなく「消す」**＝呼ぶ側は必ず `{ ...brandKit, 変える項目 }` の形で
   * 渡すこと（1項目だけ渡すと**残りが消える**・PR #922 レビュー 🔴 の実例）。
   * ⚠️ **混ぜる（merge）形にはしない**＝`undefined` を渡して**外す**（ロゴ・フォント）ができなくなる。
   */
  updateBrandKit: async (next) => {
    // ⚠️ **読めていないものを上書きしない**（差分再監査 3巡目 🟡）＝覚えている中身が分からない
    // 状態で書くと、消えたことにも気づけない。
    if (get().brandKitUnreadable) {
      set({ brandKitError: "会社の見た目を読めませんでした。中身を失わないよう、変えられません。アプリを開き直してください。" });
      return false;
    }
    // ⚠️ **書けなかったら覚えた顔をしない**（α-6 出口監査 🟡23・§2-5）＝画面だけ変えて保存に失敗すると、
    // 開き直したときに黙って消えている（何を変えたか本人も分からない）。画面を戻して理由を出す。
    const before = get().brandKit;
    set({ brandKit: next, brandKitError: null });
    try {
      await saveBrandKit(next);
      return true;
    } catch {
      // ⚠️ **自分が書いた値がまだ載っているときだけ戻す**（差分再監査 ℹ️）＝丸ごと戻すと、
      // 保存を待つ間に入った**次の変更まで巻き添えで巻き戻る**（ディスクは後勝ちなので食い違う）。
      if (get().brandKit === next) set({ brandKit: before });
      set({ brandKitError: `${alpha6Message.BRAND_KIT_SAVE_FAILED}。` });
      return false;
    }
  },
  /**
   * 読めなくなった会社の見た目を**作り直す**（差分再監査 🟡・§2-5＝行き止まりを作らない）。
   *
   * ⚠️ **上書きを断る門の唯一の出口**＝`updateBrandKit` は読めていない間ずっと断り、`brandKitUnreadable`
   * を下ろすのは**読み込みの成功だけ**。ファイルが本当に壊れていると開き直しても直らないので、
   * **アプリの中から会社の見た目を二度と変えられなくなる**（案内の「開き直す」にも従えない）。
   * ⚠️ **黙って上書きしない**＝これは**利用者が明示的に押したときだけ**通る道で、
   * 押す前に「覚えていた内容は失われる」と伝えるのは画面の役目。
   */
  rebuildBrandKit: async () => {
    const empty = emptyBrandKit();
    try {
      await saveBrandKit(empty);
      set({ brandKit: empty, brandKitUnreadable: false, brandKitError: null });
      return true;
    } catch {
      set({ brandKitError: `${alpha6Message.BRAND_KIT_SAVE_FAILED}。` });
      return false;
    }
  },
  addUserFont: async (srcPath, displayName) => {
    // ⚠️ **前の知らせも消す**（差分再監査 ℹ️）＝残ると、取り込みに失敗したとき
    // **赤い理由の隣に前の成功の知らせ**が並ぶ（画面を離れて戻っても出続ける）。
    set({ fontError: null, fontNotice: null });
    try {
      // ⚠️ **番号は「これまでに使ったもの」から採る**＝消した番号は使い回さない（α-6 出口監査 🟡8）。
      // 一覧（`listUserFonts`）は**実体があるものだけ**なので、最大番号を外すと同じ番号が
      // 再発行され、その番号を指している動画が**黙って別の字体**になる。
      const id = createUserFontId(await usedUserFontIds());
      await importUserFont(id, displayName, srcPath);
      await get().refreshUserFonts();
      return id;
    } catch (e) {
      set({ fontError: typeof e === "string" ? e : "文字の形を取り込めませんでした。もう一度お試しください。" });
      return null;
    }
  },
  removeUserFont: async (fontId) => {
    set({ fontError: null, fontNotice: null });
    try {
      await deleteUserFont(fontId);
      await get().refreshUserFonts();
      // ⚠️ **消したものを指したままにしない**（α-6 出口監査 🟡・#888 のロゴと同型）＝残すと、
      // 以後に作る**すべての新規動画**が不在のフォントで始まり、プレビューは黙って既定の字体・
      // 気づけるのは**別の動画の書き出し直前**（公開前チェック）だけになる。
      if (get().brandKit.fontId === fontId) {
        // ⚠️ **いまの中身を広げてから外す**（PR #922 レビュー 🔴）＝`updateBrandKit` は**丸ごと
        // 置き換える**ので、`{ fontId: undefined }` だけ渡すと**色とロゴを巻き添えで消す**
        //（フォントを消しただけのつもりが会社の見た目が空になる・§2-5）。他の呼び出しは
        // 例外なく `...brandKit` を先に広げている＝ここだけ抜けていた。
        const ok = await get().updateBrandKit({ ...get().brandKit, fontId: undefined });
        // ⚠️ **うまくいったほうは知らせの側へ**（`/canon-check` ℹ️）＝赤字で出すと失敗に見える。
        if (ok) set({ fontNotice: BRAND_FONT_CLEARED_MESSAGE });
        else set({ fontError: BRAND_FONT_CLEAR_FAILED_MESSAGE });
      }
      return true;
    } catch (e) {
      set({ fontError: typeof e === "string" ? e : "文字の形を消せませんでした。もう一度お試しください。" });
      return false;
    }
  },
  refreshUserFonts: async () => {
    const list = await listUserFonts();
    // ⚠️ **「読めなかった」を「1つも無い」にしない**（🟡19 のレビュー）＝`[]` を書くと
    // 公開前チェックが**使っている字体を全部「見つからない」**と数えて書き出しを止める
    //（案内の「取り込み直す」も同じ目録を通るので必ず失敗＝行き止まり・§2-5）。
    // ⚠️ **起動直後の「まだ調べていない」（`userFontIds: null`）とも別**＝あちらは待てば埋まるので
    // 止めない。読めなかったことは別の印で持ち、公開前チェックがそう言って止める。
    if (list == null) { set({ userFontsUnreadable: true }); return; }
    set({ userFontsUnreadable: false });
    // ⚠️ **見つかったものは読み込んでおく**＝一覧に出したフォントで実際に描けるようにする
    // （読めなかったものは描画が既定へ倒れ、書き出しは公開前チェックが止める＝ADR-0038）。
    await loadUserFonts(list.map((f) => f.id));
    set({ userFontIds: list.map((f) => f.id), userFonts: list });
  },
  refreshMissingAssets: async () => {
    const { meta, assets } = get();
    // ⚠️ **一覧に出るものだけを調べる**（`isListedMaterial`＝§2-7 で規則は1か所）＝音（BGM・読み上げ）は
    // 素材の一覧に出ないので、数えると「その素材を選んで直してください」と言われても**選べない行き止まり**
    // になる（§2-5）。BGM は BGM の導線で直す。
    const listed = assets.filter((a) => isListedMaterial(a.assetType));
    if (!meta.projectId || listed.length === 0) { set({ missingAssetIds: [] }); return; }
    const missing = new Set(await missingAssetFiles(meta.projectId, listed.map((a) => a.filePath)));
    // ⚠️ **書き戻しは「いまの一覧」で絞る**（`projectstore-async-clobber`・レビュー 🟡）＝
    // 調べている間に消された素材の id をそのまま書くと、**消したものが「見つかりません」で復活**する
    //（一覧に無いのにバナーだけ出る＝選べない行き止まり）。
    set((st) => ({
      missingAssetIds: st.assets.filter((a) => isListedMaterial(a.assetType) && missing.has(a.filePath)).map((a) => a.assetId),
    }));
  },

  clearImportError: () => set({ importError: null }),
  clearBgmError: () => set({ bgmError: null }),
  setBgm: async (file) => {
    // BGM も素材（ASSET_TYPE.bgm）。差し替えは既存 assetId の同一パスへファイルを上書きするため、書き出しが読んで
    // いる BGM ファイルと競合しうる＝setAssetImage と同クラスのハザード（#547 P2-1・ADR-0026②）。BgmPicker は bgmError を表示。
    if (isExportBusy(get().exportRun.phase)) { set({ bgmError: EXPORT_BUSY_BGM_MSG }); return; }
    if (get().isImporting) return; // 取り込み中の多重実行を防ぐ
    // ⚠️ **着地は「まだ同じ動画を開いているか」で括る**（PR #911 レビュー ℹ️）＝ほかの取り込み経路と
    // 同じ規則。括らないと、一覧を読んでいる間に別の動画を開いたとき**新しい動画へこの音が生える**／
    // 番号の着地が別の動画を書き換える（#762 と同型）。
    const stillOpen = sameDocGuard(get);
    set({ bgmError: null, isImporting: true });
    try {
      let projectId = get().meta.projectId;
      if (!projectId) {
        const existing = await listProjectSummaries();
        projectId = createProjectId(new Date(), existing.map((p) => p.projectId));
        if (!stillOpen()) return;
        set((st) => ({ meta: { ...st.meta, projectId } }));
      }
      const parts = file.name.split(".");
      const rawExt = parts.length > 1 ? parts[parts.length - 1] : "mp3";
      const ext = rawExt.toLowerCase().replace(/[^a-z0-9]/g, "") || "mp3";
      const baseName = parts.length > 1 ? parts.slice(0, -1).join(".") : file.name;
      // BGM はプロジェクトに1つ。既存があればその assetId を使い回してファイルを差し替える。
      // 新規IDは §2.1 の bgm_{slug}_{NNN}（slug=ファイル名）で採番する。
      // ⚠️ **差し替えるのは「いま使っている音」だけ**（PR #911 レビュー 🟡）＝よく使う素材から
      // 音を取り込めるようになり、**1つの動画が複数の音を持てる**ようになった。種類だけで探すと
      // **配列の先頭にある別の音**（選んでもいないもの）のファイルを黙って上書きする（§2-5）。
      // いま選んでいるものが無ければ**新しい番号で足す**（既存を壊さない）。
      const selectedBgmId = get().meta.bgmSettings?.assetId;
      const existingBgm = get().assets.find(
        (a) => a.assetType === ASSET_TYPE.bgm && a.assetId === selectedBgmId,
      );
      const assetId =
        existingBgm?.assetId ?? createBgmId(baseName, get().assets.map((a) => a.assetId));
      const fileName = `${assetId}.${ext}`;
      // 書き込み直前に再チェック：await 中に書き出しが始まっていたら、既存 BGM の同一パスを上書きせず戻る（#570 P1）。
      if (isExportBusy(get().exportRun.phase)) { set({ bgmError: EXPORT_BUSY_BGM_MSG }); return; }
      // 先に取り込み（失敗時はストアを変えない＝ゴースト防止）。Tauri 非検出時は null（非永続）。
      const filePath = await importAssetFile(projectId, fileName, file.dataUrl);
      const asset: Asset = {
        assetId,
        assetType: ASSET_TYPE.bgm,
        displayName: baseName.trim() || "BGM",
        filePath: filePath ?? `assets/${fileName}`,
      };
      if (!stillOpen()) return;
      set((s) => ({
        meta: {
          ...s.meta,
          projectId,
          bgmSettings: {
            ...s.meta.bgmSettings,
            enabled: true,
            assetId,
            bundledBgmId: null,
            volume: s.meta.bgmSettings?.volume ?? BGM_VOLUME,
            loop: true,
          },
        },
        assets: existingBgm
          ? s.assets.map((a) => (a.assetId === assetId ? asset : a))
          : [...s.assets, asset],
        // BGM は視覚表示せず書き出しも on-demand で読むため、assetSrcById には入れない（A3-2 レビュー）。
      }));
    } catch {
      // BGM 取り込み失敗は保存状態を汚さず、専用メッセージで通知（§2-5）。
      set({ bgmError: "BGMを読み込めませんでした。別のファイルでお試しください。" });
    } finally {
      set({ isImporting: false });
    }
  },
  generateNarration: async (sceneId, opts) => {
    // 書き出し中は声を作らない（#570 P1 レビュー）。書き出しは開始時 snapNarration を使うので、いま作った声は
    // 保存/プレビューには入るが今のMP4には入らない＝バナー「編集できません」と挙動が矛盾する（15§4・ADR-0026④）。
    if (isExportBusy(get().exportRun.phase)) return;
    const scene = get().scenes.find((s) => s.sceneId === sceneId);
    if (!scene) return;
    // 全場面生成中は個別呼び出し（UI/他画面/テストからの直接呼び出し）を弾く。bulk 自身は fromBulk で通す。
    if (!opts?.fromBulk && get().isGeneratingNarration) return;
    // 中止識別（#547 P2-6）。中止されたら次の行から始めない／**失敗表示も出さない**（下記の catch）。
    // 成功は世代を見ずに反映する＝作った音声を捨てない。中止は「これ以上作らない」であって「作った物を消す」ではない。
    const runSeq = get()._narrationRunSeq;

    // 掛け合い（明示 lines）は行ごとに合成・保存する（ADR-0015 PR-C2）。単一 narration は下の従来経路。
    if (scene.lines && scene.lines.length > 0) {
      // fromBulk（全場面生成）では生成済み行を再合成しない（単一 narration と対称）。個別呼び出しは作り直し。
      const targets = scene.lines.filter(
        (l) => l.text.trim().length > 0 && (!opts?.fromBulk || l.status !== NARRATION_STATUS.generated),
      );
      if (targets.length === 0) return;
      if (scene.lines.some((l) => l.status === NARRATION_STATUS.pending)) return; // 多重起動防止
      const setLineStatus = (lineId: string, status: Scene["narration"]["status"]) =>
        set((st) => ({
          scenes: st.scenes.map((s) => (s.sceneId === sceneId ? withLineStatus(s, lineId, status) : s)),
        }));
      for (const l of targets) setLineStatus(l.lineId, NARRATION_STATUS.pending);
      set({ narrationError: null, narrationCancelled: false }); // 新しく声を作り始めた＝直前の「中止しました」の表示は消す（#547 P2-6）
      {
        const base = resolveNarrationVoice(scene.narration, get().meta.voiceSettings);
        const genSeq = get()._generationSeq; // 文書識別：別プロジェクトへ切替たら完了処理は何もしない
        // 行ごとに try/catch。1行の失敗が他行を巻き込まず、成功/失敗どちらの完了も token/genSeq で保護する（#390 レビュー P1）。
        for (const line of targets) {
          // 中止済み＝ここから先の行は**始めない**。先に「準備中」にした残りは中止側が未作成へ戻すので固着しない
          // （clearPendingNarrations）。開始済みの合成は下の完了処理でそのまま反映＝作った音声を捨てない。
          if (get()._narrationRunSeq !== runSeq) break;
          const input = resolveLineVoice(line, base);
          /** **作り始める前**の印（`pending` を書く前に控える）＝失敗時に据え置いてよいかを決める。 */
          const statusBefore = line.status;
          const key = lineAudioKey(sceneId, line.lineId);
          const token = nextSynthSeq(key); // この合成要求の世代（後発が来たら先発の完了は無視される）
          try {
            const result = await voiceProvider.synthesize(input);
            set((st) => {
              // 後発の生成が同じ行に来た／別プロジェクトへ切替＝この完了は状態へ触れない（新しい pending・結果を消さない・#390 レビュー P1）。
              if (!isLatestSynth(key, token) || st._generationSeq !== genSeq) return {};
              // 合成の await 中に対象の場面/行が消えた（削除・掛け合い解除）なら結果を捨てる＝削除の即時剪定を打ち消さない（#390 レビュー P1）。
              const sc = st.scenes.find((x) => x.sceneId === sceneId);
              const cur = sc?.lines?.find((l) => l.lineId === line.lineId);
              if (!sc || !cur) return {};
              // 合成中に本文・話し方（全体設定含む）を編集していたら旧結果は使わない。pending のままだと再試行不能なので
              // status を none（作り直し可）へ戻す（#390 レビュー P1）。token 保護済みなので後発の pending は消さない。
              const curInput = resolveLineVoice(cur, resolveNarrationVoice(sc.narration, st.meta.voiceSettings));
              if (!sameSynthInput(input, curInput)) {
                return {
                  scenes: st.scenes.map((s) => (s.sceneId === sceneId ? withLineStatus(s, line.lineId, NARRATION_STATUS.none) : s)),
                  saveStatus: "idle",
                };
              }
              // 合成中に書き出しが始まっていたら、開始時 snapNarration に無い音声を今書くと「保存/画面だけ新・MP4 は無音」に
              // なる（pending が undo/同一文字編集で消えて開始チェックをすり抜けた残り窓・#570 P1 レビュー）。書き込まず none へ
              // 戻す（書き出し後に作り直せる）＝取り込み側の書込直前 isExportBusy 再確認と対称。
              if (isExportBusy(st.exportRun.phase)) {
                return {
                  scenes: st.scenes.map((s) => (s.sceneId === sceneId ? withLineStatus(s, line.lineId, NARRATION_STATUS.none) : s)),
                  saveStatus: "idle",
                };
              }
              return {
                scenes: st.scenes.map((s) => (s.sceneId === sceneId ? withLineStatus(s, line.lineId, NARRATION_STATUS.generated) : s)),
                narrationAudioById: { ...st.narrationAudioById, [key]: result.audioDataUrl },
                _dirtyAudioKeys: new Set(st._dirtyAudioKeys).add(key), // 新規生成＝次回保存で書き出す（#390）
                saveStatus: "idle", // 音声は履歴外＝生成だけでも未保存にして自動保存の対象にする（#390 レビュー P1）
              };
            });
          } catch (e) {
            set((st) => {
              // 失敗も成功と同じく保護：後発/別文書ならこの失敗は無視（新しい pending・成功結果を failed で潰さない・#390 レビュー P1）。
              if (!isLatestSynth(key, token) || st._generationSeq !== genSeq) return {};
              // 中止したあとの失敗は表に出さない（#547 P2-6）：中止で未作成へ戻した行を failed に書き戻すと、
              // 15 §2.1 に無い「未作成→失敗」になり、止めた直後にエラー文言まで出る。成功は残す／失敗は捨てる
              // ＝「作った音声は無駄にしない、頼んでいない失敗は見せない」。
              if (st._narrationRunSeq !== runSeq) return {};
              const sc = st.scenes.find((x) => x.sceneId === sceneId);
              const cur = sc?.lines?.find((l) => l.lineId === line.lineId);
              if (!sc || !cur) return {};
              // 合成中に入力が変わっていたら、この失敗は古い入力のもの＝失敗表示せず none（作り直し可）に戻す（全体設定変更の pending 固着も解消）。
              const curInput = resolveLineVoice(cur, resolveNarrationVoice(sc.narration, st.meta.voiceSettings));
              if (!sameSynthInput(input, curInput)) {
                return {
                  scenes: st.scenes.map((s) => (s.sceneId === sceneId ? withLineStatus(s, line.lineId, NARRATION_STATUS.none) : s)),
                  saveStatus: "idle",
                };
              }
              // ⚠️ **作り始める前が「作成済み」なら「作れなかった」にしない**（#755-3）＝その声は
              // いまの文のものとして文書が既に言っていたので、そのまま鳴って動画にも入る。
              // `failed` を書くと「作れませんでした」と出ながら声は鳴る、が**文書に残る**。
              // ⚠️ **声のファイルの有無で決めない**＝場面の単独ナレーションは文を変えても `voicePath` を
              // 落とさないので、ファイルで決めると**古い文の声が「作成済み」に復帰**する（新しい字幕に
              // 古い声が乗った動画が成功として出る）。添え書きは**鳴らす材料**（保存済みの音声）で判断する。
              return {
                scenes: st.scenes.map((s) => (s.sceneId === sceneId ? withLineStatus(s, line.lineId, statusAfterVoiceFailure(statusBefore)) : s)),
                narrationError: joinVoiceFailure(e, statusBefore, st.narrationAudioById[key] != null),
                saveStatus: "idle", // 失敗も終端状態＝未保存にして永続化（sentinel が保存中の変化を取りこぼさない・#390 レビュー）
              };
            });
          }
        }
      }
      return;
    }

    if (scene.narration.text.trim().length === 0) return;
    if (scene.narration.status === NARRATION_STATUS.pending) return; // 多重起動防止（連打・再入）
    /** **作り始める前**の印（`pending` を書く前に控える）＝失敗時に据え置いてよいかを決める。 */
    const statusBefore = scene.narration.status;
    const setStatus = (status: Scene["narration"]["status"]) =>
      set((st) => ({
        scenes: st.scenes.map((s) =>
          s.sceneId === sceneId ? { ...s, narration: { ...s.narration, status } } : s,
        ),
      }));
    setStatus(NARRATION_STATUS.pending);
    set({ narrationError: null, narrationCancelled: false }); // 新しく声を作り始めた＝直前の「中止しました」の表示は消す（#547 P2-6）
    const v = resolveNarrationVoice(scene.narration, get().meta.voiceSettings);
    const input = { text: scene.narration.text, ...v };
    const key = sceneId;
    const token = nextSynthSeq(key); // この合成要求の世代（後発が来たら先発の完了は無視される）
    const genSeq = get()._generationSeq; // 文書識別：別プロジェクトへ切替たら完了処理は何もしない
    try {
      const result = await voiceProvider.synthesize(input);
      set((st) => {
        // 後発の生成が来た／別プロジェクトへ切替＝この完了は状態へ触れない（新しい pending・結果を消さない・#390 レビュー P1）。
        if (!isLatestSynth(key, token) || st._generationSeq !== genSeq) return {};
        // await 中に場面が消えた／掛け合いへ切替（lines 化）していたら結果を捨てる（#390 レビュー P1）。
        const sc = st.scenes.find((x) => x.sceneId === sceneId);
        if (!sc || (sc.lines && sc.lines.length > 0)) return {};
        // 合成中に本文・話し方（全体設定含む）を編集していたら旧結果は使わない。pending のままだと再試行不能なので
        // status を none（作り直し可）へ戻す（#390 レビュー P1）。token 保護済みなので後発の pending は消さない。
        const curInput = { text: sc.narration.text, ...resolveNarrationVoice(sc.narration, st.meta.voiceSettings) };
        if (!sameSynthInput(input, curInput)) {
          return {
            scenes: st.scenes.map((s) => (s.sceneId === sceneId ? { ...s, narration: { ...s.narration, status: NARRATION_STATUS.none } } : s)),
            saveStatus: "idle",
          };
        }
        // 合成中に書き出しが始まっていたら書き込まず none へ戻す（開始時 snap に無い音声を今書くと MP4 と食い違う・#570 P1 レビュー）。
        if (isExportBusy(st.exportRun.phase)) {
          return {
            scenes: st.scenes.map((s) => (s.sceneId === sceneId ? { ...s, narration: { ...s.narration, status: NARRATION_STATUS.none } } : s)),
            saveStatus: "idle",
          };
        }
        return {
          scenes: st.scenes.map((s) =>
            s.sceneId === sceneId ? { ...s, narration: { ...s.narration, status: NARRATION_STATUS.generated } } : s,
          ),
          narrationAudioById: { ...st.narrationAudioById, [sceneId]: result.audioDataUrl },
          _dirtyAudioKeys: new Set(st._dirtyAudioKeys).add(sceneId), // 新規生成＝次回保存で書き出す（#390）
          saveStatus: "idle", // 音声は履歴外＝生成だけでも未保存にして自動保存の対象にする（#390 レビュー P1）
        };
      });
    } catch (e) {
      set((st) => {
        // 失敗も成功と同じく保護：後発/別文書ならこの失敗は無視（新しい pending・成功結果を failed で潰さない・#390 レビュー P1）。
        if (!isLatestSynth(key, token) || st._generationSeq !== genSeq) return {};
        // 中止したあとの失敗は表に出さない（#547 P2-6・掛け合い経路と同じ扱い）。
        if (st._narrationRunSeq !== runSeq) return {};
        const sc = st.scenes.find((x) => x.sceneId === sceneId);
        if (!sc || (sc.lines && sc.lines.length > 0)) return {};
        // 合成中に入力が変わっていたら、この失敗は古い入力のもの＝失敗表示せず none（作り直し可）に戻す（全体設定変更の pending 固着も解消）。
        const curInput = { text: sc.narration.text, ...resolveNarrationVoice(sc.narration, st.meta.voiceSettings) };
        if (!sameSynthInput(input, curInput)) {
          return {
            scenes: st.scenes.map((s) => (s.sceneId === sceneId ? { ...s, narration: { ...s.narration, status: NARRATION_STATUS.none } } : s)),
            saveStatus: "idle",
          };
        }
        // 掛け合いの行と同じ理由（#755-3）＝作り始める前が「作成済み」なら据え置く。
        return {
          scenes: st.scenes.map((s) => (s.sceneId === sceneId ? { ...s, narration: { ...s.narration, status: statusAfterVoiceFailure(statusBefore) } } : s)),
          narrationError: joinVoiceFailure(e, statusBefore, st.narrationAudioById[sceneId] != null),
          saveStatus: "idle", // 失敗も終端状態＝未保存にして永続化（#390 レビュー）
        };
      });
    }
  },
  generateAllNarrations: async () => {
    if (isExportBusy(get().exportRun.phase)) return; // 書き出し中は声を作らない（#570 P1 レビュー・15§4・snapNarration とMP4が食い違う）
    if (get().isGeneratingNarration) return;
    const runSeq = get()._narrationRunSeq + 1; // この実行の世代。中止・文書切替で進み、以降は新しい合成を始めない（#547 P2-6）。
    set({ isGeneratingNarration: true, narrationCancelled: false, _narrationRunSeq: runSeq });
    try {
      // 未生成（none/pending/failed）のみ対象。生成済みは個別の「声を作り直す」で上書きする。
      // 掛け合い・単一 narration 共通の実効判定（sceneNeedsVoice）を precheck と共有＝同概念同挙動（#403）。
      const ids = get().scenes.filter(sceneNeedsVoice).map((s) => s.sceneId);
      // 同時実行数を絞る（#547 P2-6）。全件を一度に投げると「まだ始まっていない仕事」が残らず**中止が効かない**
      // ＝ボタンはあるのに止まらない（ADR-0026④）。絞れば残りは待機列に残り、進捗も少しずつ進む。
      await runWithConcurrency(ids, NARRATION_BULK_CONCURRENCY, (id) => get().generateNarration(id, { fromBulk: true }), {
        shouldStop: () => get()._narrationRunSeq !== runSeq,
      });
    } finally {
      // 中止・文書切替で世代が進んでいたら、この実行はもう現行ではない＝後発の実行/中止が立てた状態を消さない。
      if (get()._narrationRunSeq === runSeq) set({ isGeneratingNarration: false });
    }
  },
  // 中止には `isExportBusy` ガードを**置かない**（scenes を書く他の action とは非対称だが意図的）。中止は「止める」
  // 側の操作で、止められないと 15 §4 の抜け道が消える。書き出し中は `generateAllNarrations` に入れない＝
  // `isGeneratingNarration` が立たず、下の早期 return で実質到達しないが、仮に到達しても止められる方が正しい。
  cancelNarrationGeneration: () => {
    if (!get().isGeneratingNarration) return;
    set((s) => ({
      // 世代を進める＝実行中のループはここで打ち切られ、新しい合成は始まらない。
      _narrationRunSeq: s._narrationRunSeq + 1,
      isGeneratingNarration: false,
      narrationCancelled: true,
      // 待機中のまま「準備中」で残った行/場面を未作成へ戻す。残すと進捗が止まって見え、書き出しも
      // isNarrationGenerating で止まったままになる（行き止まり＝§2-5／ADR-0026④）。
      scenes: clearPendingNarrations(s.scenes),
      // 音声は履歴外＝状態変更だけでも未保存にして自動保存の対象にする（#390 の生成系と同じ扱い）。
      saveStatus: "idle",
    }));
  },
  synthesizeReading: async (yomi, accentType) => {
    const v = resolveNarrationVoice({ text: yomi, status: NARRATION_STATUS.none }, get().meta.voiceSettings);
    return synthesizeWithAccent(yomi, accentType, v);
  },
  synthesizePreview: async () => {
    const text = "こんにちは。ナレーションの聞こえ方を確認します。";
    const narration: Narration = { text, status: NARRATION_STATUS.none };
    const v = resolveNarrationVoice(narration, get().meta.voiceSettings);
    const result = await voiceProvider.synthesize({ text, ...v });
    return result.audioDataUrl;
  },
  // ── Undo/Redo（ADR-0020・#211）。文書を変える action は適用前に pushHistory を呼ぶ。連続操作は begin/endHistoryGroup で1ステップに合成。 ──
  // グループは**遅延記録**：begin では snapshot を取らず、グループ中の**最初の pushHistory（＝最初の実変更）**で
  // 「編集前」を1回だけ記録する。これで focus/pointerdown しただけ（未変更）では履歴を消費しない（#389 レビュー）。
  pushHistory: () =>
    set((s) => {
      if (s._historyGroupDepth > 0) {
        if (!s._historyGroupPending) return {}; // グループ中・記録済み＝積まない（1文字/1tick 毎に積まない）
        // グループ中の最初の変更：ここで初めて「編集前」を記録する（begin だけでは積まない）。
        return { ...recordSnapshot<DocSnapshot>({ past: s.past, future: s.future }, docSnapshot(s)), _historyGroupPending: false };
      }
      return recordSnapshot<DocSnapshot>({ past: s.past, future: s.future }, docSnapshot(s)); // グループ外＝従来どおり1操作=1履歴
    }),
  beginHistoryGroup: () =>
    // 連続操作の開始。深さ0→1 で「保留」にするだけ（snapshot は最初の pushHistory まで遅延＝未変更 focus で積まない）。
    set((s) => (s._historyGroupDepth === 0 ? { _historyGroupDepth: 1, _historyGroupPending: true } : { _historyGroupDepth: s._historyGroupDepth + 1 })),
  endHistoryGroup: () => set((s) => ({ _historyGroupDepth: Math.max(0, s._historyGroupDepth - 1) })),
  // 復元した場面の「準備中」は落とす（#547 P2-6）：`pending` は**そのとき合成が走っていた**という実行時の状態で、
  // 履歴に載せる意味がない。声の作成中に別の編集をすると `pending` 入りのスナップショットが積まれ、中止したあとに
  // 取り消すと**誰も作っていない準備中**が復活する＝書き出しは「声を作成中です」で止まり、作成中ではないので中止も出せず、
  // その場面の作り直しも押せない行き止まりになる（15 §2.1／§4・ADR-0026④）。
  undo: () =>
    set((s) => {
      // 書き出し中は文書 slice（scenes/parts/meta）を変えない＝進行中の書き出しが不整合データを読むのを防ぐ
      // （newProject/loadProject と同じ #379 ガード。書き出し中もサイドバーで たたき台/場面編集/タイムライン編集 へ移動でき、
      //   Ctrl+Z も取り消すボタンも到達し得るのでガードは必須・#413/#547 P1-1）。
      if (isExportBusy(s.exportRun.phase)) return {};
      const r = undoSnapshot<DocSnapshot>({ past: s.past, future: s.future }, docSnapshot(s));
      if (!r) return {}; // 戻せない
      r.restored = keepIdentity(r.restored, s); // 番号（実体の身元）は戻さない
      // ⚠️ **開いているまとめは畳む**（#817 レビュー 🟡＝タイムライン形式と同じ扱い・ADR-0026②）＝
      // 畳まないと、戻した**後**の編集が「まとめの続き」とみなされて**履歴に1件も積まれず**、
      // さらに自動保存が `historyDepth > 0` の間は走らないので**保存も止まる**。
      // 到達はスライダーを掴んだまま `Ctrl+Z`（掴んだ数に入らないのでキーが通る）。
      return { ...r.restored, scenes: clearPendingNarrations(r.restored.scenes), past: r.history.past, future: r.history.future, saveStatus: "idle", _historyGroupDepth: 0, _historyGroupPending: false };
    }),
  redo: () =>
    set((s) => {
      if (isExportBusy(s.exportRun.phase)) return {}; // 同上（書き出し中は redo も文書 slice を変えない・#379/#413）
      const r = redoSnapshot<DocSnapshot>({ past: s.past, future: s.future }, docSnapshot(s));
      if (!r) return {}; // やり直せない
      r.restored = keepIdentity(r.restored, s); // 同上
      return { ...r.restored, scenes: clearPendingNarrations(r.restored.scenes), past: r.history.past, future: r.history.future, saveStatus: "idle", _historyGroupDepth: 0, _historyGroupPending: false }; // まとめは畳む（上と同じ理由）
    }),
}));
