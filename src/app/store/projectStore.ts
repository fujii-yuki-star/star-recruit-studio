// プロジェクトの状態（Zustand）。AI出力→検証/変換→内部Scene の結果を保持し、UIへ供給する。
// 保存/読込は project.json（infrastructure/projectFs.ts 経由）。AIは Gemini キーがあれば実プロバイダ、無ければ Mock。
import { create } from "zustand";
import { BGM_VOLUME, DEFAULT_CHARACTER_ID, DEFAULT_TARGET_DURATION_SEC, DEFAULT_TONE, MAX_INLINE_ASSET_BYTES, PROJECT_NAME_MAX_LENGTH, SCENE_DEFAULT_DURATION_SEC } from "../../domain/constants";
import type { Asset, AssetMetadata, BgmSettings, CompanyInfo, ElementAnimation, GeneralBrief, Keyframe, Narration, OverlayClip, Part, Scene, VoiceSettings, Warning } from "../../domain/project/types";
import { ASSET_TYPE, NARRATION_STATUS, type Orientation, type Purpose, type SceneCategory, type VideoKind } from "../../domain/enums";
import type { FontId } from "../../domain/font/fontCatalog";
import type { BundledBgmId } from "../../domain/bgm/bgmCatalog";
import type { Template } from "../../domain/template/types";
import { transformVideoPlan } from "../../domain/ai/transformPlan";
import { buildTemplateSummaries, buildYukoPoseTags, resolveTargetAudience } from "../../domain/ai/videoPlanInput";
import type { GenerateVideoPlanInput } from "../../domain/ai/aiProvider";
import type { AiVideoPlan } from "../../domain/ai/types";
import {
  assembleProject, createAnimationId, createAssetId, createBgmId, createOverlayClipId, createPartId, createProjectId, createSceneId,
  defaultVideoSettings, defaultVoiceSettings, parseProjectDoc, projectHeaderFromProject, validateProjectDoc,
} from "../../domain/project/persistence";
import type { ProjectHeader } from "../../domain/project/persistence";
import { duplicateSceneInList, moveSceneInList, moveSceneToIndexInList, splitSceneInList, splitSceneLinesInList } from "../../domain/project/sceneOps";
import { substituteDeletedTemplateInScenes } from "../../domain/project/templateUsage";
import { duplicateSceneAnimations, removeAnimationsForTargets } from "../../domain/project/animationOps";
import { recordSnapshot, redoSnapshot, undoSnapshot } from "../../domain/project/history";
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
import { importAssetFile, importAssetBytes, importAssetByPath, assetDisplayUrl, probeVideo, extractVideoThumbnail, fileToDataUrl } from "../../infrastructure/assetFs";
import { detectAssetType, exceedsInlineAssetLimit, fileExtension } from "../../domain/asset/assetFile";
import { importVoiceFile, readVoiceDataUrl } from "../../infrastructure/voiceFs";
import { resolveLineVoice, resolveNarrationVoice } from "../../domain/voice/voiceProvider";
import type { VoiceProvider } from "../../domain/voice/voiceProvider";
import { lineAudioKey, lineVoiceStem, sceneNeedsVoice, withLineStatus, withLineVoicePath } from "../../domain/project/narrationLines";
import type { VoiceStyleParams } from "../../domain/voice/voiceStylePresets";
import { MockVoiceProvider } from "../../infrastructure/voiceProviders/mockVoiceProvider";
import { VoicevoxProvider } from "../../infrastructure/voiceProviders/voicevoxProvider";

export type GenerateStatus = "idle" | "generating" | "ready" | "error";
export type SaveStatus = "idle" | "saving" | "saved" | "error";
/** 書き出しの進行フェーズ（#379）。ExportScreen ローカルでなく store に持ち、他画面へ遷移しても進捗が残る。 */
export type ExportPhase = "idle" | "rendering" | "encoding" | "done" | "error" | "unsupported" | "cancelled";
/** 書き出しの進行状態（#379）。画面横断で参照＝進捗の可視化・書き出し中の再実行/破壊操作ブロックに使う。 */
export interface ExportRunState {
  phase: ExportPhase;
  progress: { done: number; total: number };
  resultPath: string;
  message: string;
  bgmWarning: "" | "partial" | "all";
  // ユーザーが中止を要求したか（#380）。画面横断で保持し、書き出しの各段が「中止しました」で終えられるようにする。
  cancelling: boolean;
}
/** 書き出し中（rendering/encoding）か。再実行・プロジェクト切替/削除のブロック判定で共有（#379）。 */
export function isExportBusy(phase: ExportPhase): boolean {
  return phase === "rendering" || phase === "encoding";
}
const IDLE_EXPORT_RUN: ExportRunState = {
  phase: "idle",
  progress: { done: 0, total: 0 },
  resultPath: "",
  message: "",
  bgmWarning: "",
  cancelling: false,
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
  /** 「全場面の声を作成」実行中フラグ（多重起動防止）。 */
  isGeneratingNarration: boolean;
  /** 素材/BGM の取り込み中フラグ（多重取り込み防止・取り込み中表示）。 */
  isImporting: boolean;
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
  /** 新規プロジェクト（作業状態を初期化）。 */
  newProject: () => void;
  /** 白紙から作る（ウィザード/AI を通らない・#393）。空プロジェクトにし status を "ready" にして自動生成（§2-6）を発火させない。 */
  newBlankProject: () => void;
  /** 生成失敗/中断から手動作成へ入る（#393 P1・12 §9.3／15）。入力済みの会社情報・素材は残し、status を "ready"・
   *  aiError をクリアして手動で組む状態にする（AI 生成はしない＝draftFromAi=false）。 */
  startManualEdit: () => void;
  /** 現在の状態を project.json として保存する。進行中の保存があればその完了を待つ（多重起動防止＋await で保存完了を保証・#256）。 */
  saveProject: () => Promise<void>;
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
  /** 編集中プロジェクトの名前を変更する（#252・メモリの meta.projectName を更新＝保存/自動保存で永続化）。 */
  setProjectName: (name: string) => void;
  /** 指定シーンを更新する（編集→プレビュー即反映）。 */
  updateScene: (sceneId: string, update: (scene: Scene) => Scene) => void;
  /** 末尾パートに新しい空の場面を追加し、その sceneId を返す（既定テンプレ）。テンプレ未読込時は ""。 */
  addScene: () => string;
  /** 指定の場面を削除する（パートからも除き、order を 1..N に振り直す）。 */
  removeScene: (sceneId: string) => void;
  /** 場面を上/下へ1つ移動する（表示順＝配列順を入れ替え、order と part.sceneIds を整合）。 */
  moveScene: (sceneId: string, direction: "up" | "down") => void;
  /** 場面を任意の位置（移動後の配列index）へ動かす（ドラッグ&ドロップ・#398）。1操作=1履歴。 */
  moveSceneToIndex: (sceneId: string, toIndex: number) => void;
  /** タイムライン上位編集：テロップ overlay クリップを追加し、その id を返す（ADR-0018・③(4)）。 */
  addOverlayClip: (clip: Partial<Omit<OverlayClip, "id">>) => string;
  /** overlay クリップを部分更新（移動＝startSec/anchorSceneId、文言＝text 等）。Undo は meta スナップショットで自動。 */
  updateOverlayClip: (id: string, patch: Partial<Omit<OverlayClip, "id">>) => void;
  /** overlay クリップを削除する。 */
  removeOverlayClip: (id: string) => void;
  /** 要素アニメーション（キーフレーム）を追加し、その id を返す（④・ADR-0019・timelineOverlay.animations）。 */
  addAnimation: (sceneId: string, targetId: string, keyframes: Keyframe[]) => string;
  /** 要素アニメーションのキーフレームを差し替える（フェードインの所要秒変更など）。Undo は meta スナップショットで自動。 */
  updateAnimation: (animId: string, keyframes: Keyframe[]) => void;
  /** 要素アニメーションを削除する（「動きをやめる」）。 */
  removeAnimation: (animId: string) => void;
  /** 指定場面の指定要素(targetIds)に紐づくアニメを取り除く（要素削除時の孤児掃除・④）。対象なしなら何もしない。 */
  removeAnimationsForElements: (sceneId: string, targetIds: string[]) => void;
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
  /** 動画全体のフォントを切り替える（videoSettings.fontId・保存時に永続化）。 */
  setFontId: (fontId: FontId) => void;
  /** 声設定（話速・高さ・抑揚など）を部分更新する（現在のプロジェクト・保存時に永続化）。defaultVoiceId は更新不可。 */
  updateVoiceSettings: (patch: VoiceParamPatch) => void;
  /** BGM設定（音量など）を部分更新する（現在のプロジェクト・保存時に永続化）。assetId は更新不可。 */
  updateBgmSettings: (patch: BgmPatch) => void;
  /** 標準BGM（同梱）を選ぶ（bundledBgmId を設定し assetId を解除・BGMを有効化）。 */
  setBundledBgm: (bundledBgmId: BundledBgmId) => void;
  /** 素材を更新する（素材管理：説明/タグ/公開チェック等）。 */
  updateAsset: (assetId: string, update: (asset: Asset) => Asset) => void;
  /** 素材を削除する。 */
  removeAsset: (assetId: string) => void;
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
  clearImportError: () => void;
  /** BGM 取り込みエラー文言を消す（通知を閉じる）。 */
  clearBgmError: () => void;
  /** BGM 音声を取り込み、bgmSettings に設定する（プロジェクトに1つ。既存があれば差し替え）。 */
  setBgm: (file: { name: string; dataUrl: string }) => Promise<void>;
  /** 指定場面のナレーション音声を生成する（narration.status を更新）。 */
  generateNarration: (sceneId: string, opts?: { fromBulk?: boolean }) => Promise<void>;
  /** セリフのある全場面のナレーション音声を生成する。 */
  generateAllNarrations: () => Promise<void>;
  /** 設定の試聴：サンプル文を現在の声設定で合成し、音声 data URL を返す。 */
  synthesizePreview: () => Promise<string>;
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

// 進行中の保存 Promise（#256 レビュー🔴）。多重起動は防ぎつつ、**`await saveProject()` が「保存の完了」を保証**する
// （早期 return だと書き出し前の保存が no-op になり projectId 未確定→画像欠落の恐れ）。進行中があれば同じ Promise を待つ。
let saveInFlight: Promise<void> | null = null;

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

// 取り込んだ動画の付加情報（メタ＝長さ/音声有無/解像度、代表フレーム＝サムネ）を取得する純IO。
// store は更新せず結果のみ返す。各取得は独立に失敗を握り、部分結果で続行する（取り込みの成否とは独立）。
async function probeAndThumbVideo(
  projectId: string,
  relPath: string,
): Promise<{ metadata?: AssetMetadata; thumbnailPath?: string; thumbUrl?: string }> {
  const out: { metadata?: AssetMetadata; thumbnailPath?: string; thumbUrl?: string } = {};
  try {
    const meta = await probeVideo(projectId, relPath);
    if (meta) out.metadata = meta;
    else if (hasTauri) console.warn("[asset] 動画メタの取得に失敗しました（既定値で続行）");
  } catch (e) {
    console.warn("[asset] 動画メタ取得で例外:", e);
  }
  try {
    // 代表フレームを生成し、表示用 src（小さなPNG）として読み戻す＝確認画面/一覧に動画フレーム表示。
    const thumbPath = await extractVideoThumbnail(projectId, relPath);
    if (thumbPath) {
      out.thumbnailPath = thumbPath;
      const url = await assetDisplayUrl(projectId, thumbPath);
      if (url) out.thumbUrl = url;
    } else if (hasTauri) {
      console.warn("[asset] 動画サムネの生成に失敗しました（アイコン表示にフォールバック）");
    }
  } catch (e) {
    console.warn("[asset] 動画サムネ生成で例外:", e);
  }
  return out;
}

// probeAndThumbVideo の結果を該当素材へ反映する set 更新関数を返す（addAsset/addAssetByPath 共通）。
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

// 取り込み失敗時のユーザー向け文言を取り出す。Tauri コマンドは文字列で reject される
// （Rust が §2-5 準拠で整えた文言）のでそのまま使い、それ以外は定型文にフォールバックする。
function importErrorMessage(e: unknown): string {
  if (typeof e === "string" && e.trim()) return e;
  if (e instanceof Error && e.message) return e.message;
  return "素材を取り込めませんでした。もう一度お選びください。";
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
  saveStatus: "idle",
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
  isGeneratingNarration: false,
  isImporting: false,
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
  reset: () =>
    set((s) => ({ status: "idle", draftFromAi: false, saveStatus: "idle", parts: [], scenes: [], warnings: [], aiError: null, _generationSeq: s._generationSeq + 1 })),
  newProject: () => {
    // 書き出し中は現在の場面/素材を読むため、内容を破壊しない（#379・進行中の書き出しが空データになるのを防ぐ）。
    if (isExportBusy(get().exportRun.phase)) return;
    set((s) => ({
      status: "idle",
      draftFromAi: false,
      saveStatus: "idle",
      meta: defaultHeader(),
      parts: [],
      scenes: [],
      warnings: [],
      assets: [],
      assetSrcById: {},
      narrationAudioById: {},
      narrationError: null,
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
  },
  newBlankProject: () => {
    // 白紙から作る（#393）＝ウィザード/AI を通らず手動で場面を組む。共通リセット（newProject）を流用し、
    // status を "idle" のままにしない（"ready" にする）ことで、各画面マウント時の autoGenerateIfSafe（§2-6）が
    // 発火しない＝白紙開始がそのまま AI 送信を誘発しない。書き出し中ガードは newProject 側と二重で持つ（早期 return）。
    if (isExportBusy(get().exportRun.phase)) return;
    get().newProject();
    set({ status: "ready" });
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
    try {
      const s = get();
      let projectId = s.meta.projectId;
      if (!projectId) {
        const existing = await listProjectSummaries();
        projectId = createProjectId(new Date(), existing.map((p) => p.projectId));
      }
      // ナレーション音声をディスクへ保存し、voicePath を更新（生成済みのみ）。
      // 生成済みでない場面は古い音声参照を残さない（再生成で上書きされる）。
      const audioById = s.narrationAudioById;
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
              const lineAudio = audioById[lineAudioKey(sc.sceneId, line.lineId)];
              if (lineAudio) {
                const vp = await importVoiceFile(projectId, lineVoiceStem(sc.sceneId, line.lineId), lineAudio);
                if (vp) next = withLineVoicePath(next, line.lineId, vp);
              }
              // 生成済みだがメモリに音声なし → 既存 voicePath を保持（何もしない）。
            }
            return next;
          }
          // 未生成・失敗の場面は古い voicePath を残さない（再生成で上書きされる）。
          if (sc.narration.status !== NARRATION_STATUS.generated) {
            return sc.narration.voicePath
              ? { ...sc, narration: { ...sc.narration, voicePath: null } }
              : sc;
          }
          // 生成済み：メモリに音声があればディスク保存して voicePath を更新。
          const audio = audioById[sc.sceneId];
          if (audio) {
            const voicePath = await importVoiceFile(projectId, sc.sceneId, audio);
            return voicePath ? { ...sc, narration: { ...sc.narration, voicePath } } : sc;
          }
          // 生成済みだがメモリに音声なし（復元失敗・非Tauri等）→ 既存 voicePath を保持する。
          return sc;
        }),
      );
      const meta: ProjectHeader = { ...s.meta, projectId, updatedAt: new Date().toISOString() };
      const project = assembleProject(meta, s.assets, s.parts, scenes);
      // 保存前検証（#416）：当面は警告ログのみ（アプリが正典に反するデータを作っていないか監視・入力防御は #411）。
      const pv = validateProjectDoc(project);
      if (!pv.valid) console.warn("[project] 保存内容がスキーマに未適合（要修正・#416）:", pv.errors);
      await saveProjectDoc(projectId, JSON.stringify(project, null, 2));
      setLastProjectId(projectId);
      set({ meta, scenes, saveStatus: "saved" });
    } catch {
      set({ saveStatus: "error" });
    }
  },
  loadProject: async (projectId) => {
    // 書き出し中は別プロジェクトへ切り替えない（進行中の書き出しが参照するデータ/状態を保つ・#379）。
    if (isExportBusy(get().exportRun.phase)) return;
    const text = await loadProjectDoc(projectId);
    const project = parseProjectDoc(text);
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
      draftFromAi: false, // 読込済みプロジェクトは「生成直後」ではない＝AI作成文言は出さない（#467）
      saveStatus: "saved", // 読み込み直後はディスクと一致＝保存済み扱い（未保存検知の基準・#256）
      // 保存用ヘッダは projectHeaderFromProject に一元化（Project のヘッダ系フィールドの取りこぼしを防ぐ・#324）。
      // ADR-0011 の種別/発表内容/自由記述、ADR-0018 の timelineOverlay もここでまとめて復元される。
      meta: projectHeaderFromProject(project),
      assets: project.assets.map((a) =>
        videoThumb[a.assetId] ? { ...a, thumbnailPath: videoThumb[a.assetId] } : a,
      ),
      parts: project.parts,
      scenes: project.scenes,
      warnings: [],
      assetSrcById,
      narrationAudioById,
      narrationError: null,
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
    await deleteProjectDoc(projectId);
    // 削除したのが最後に開いたプロジェクトなら、次回起動の自動復元対象から外す（消えたものを開こうとしない）。
    if (getLastProjectId() === projectId) clearLastProjectId();
    // 開いているプロジェクトを消したら編集状態も新規化する（#383）。そのままだと自動保存（useAutoSave）が
    // 同じ projectId を書き戻し、「元に戻せません」の説明に反して一覧へ復活してしまう。書き出し中は上でブロック済み。
    if (get().meta.projectId === projectId) get().newProject();
  },
  renameProject: async (projectId, newName) => {
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
    get().pushHistory(); // 適用前を履歴へ（ドラッグ中はグループ化で1ステップに合成・#211）
    set((s) => ({
      scenes: s.scenes.map((sc) => (sc.sceneId === sceneId ? update(sc) : sc)),
      // 編集したら「保存しました」表示を解除（未保存と分かるように）。
      saveStatus: "idle",
    }));
  },
  addOverlayClip: (clip) => {
    const clips = get().meta.timelineOverlay?.clips ?? [];
    const id = createOverlayClipId(clips.map((c) => c.id));
    // 既定＝telop・開始0秒・長さ3秒。呼び出し側でアンカー場面/開始秒/文言を上書きする。
    const newClip: OverlayClip = { id, track: "telop", startSec: 0, durationSec: 3, ...clip };
    get().pushHistory();
    set((s) => ({
      meta: { ...s.meta, timelineOverlay: { ...s.meta.timelineOverlay, clips: [...(s.meta.timelineOverlay?.clips ?? []), newClip] } },
      saveStatus: "idle",
    }));
    return id;
  },
  updateOverlayClip: (id, patch) => {
    get().pushHistory();
    set((s) => ({
      meta: {
        ...s.meta,
        timelineOverlay: {
          ...s.meta.timelineOverlay,
          clips: (s.meta.timelineOverlay?.clips ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c)),
        },
      },
      saveStatus: "idle",
    }));
  },
  removeOverlayClip: (id) => {
    get().pushHistory();
    set((s) => ({
      meta: {
        ...s.meta,
        timelineOverlay: {
          ...s.meta.timelineOverlay,
          clips: (s.meta.timelineOverlay?.clips ?? []).filter((c) => c.id !== id),
        },
      },
      saveStatus: "idle",
    }));
  },
  addAnimation: (sceneId, targetId, keyframes) => {
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
    const s = get();
    const tmpl = s.templates[0];
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
      durationSec: tmpl.defaults?.durationSec ?? SCENE_DEFAULT_DURATION_SEC,
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
      saveStatus: "idle",
    }));
  },
  moveScene: (sceneId, direction) => {
    const s = get();
    const next = moveSceneInList(s.scenes, s.parts, sceneId, direction);
    if (next.scenes === s.scenes) return; // 端＝変化なし（未保存にしない）
    get().pushHistory();
    set({ ...next, saveStatus: "idle" });
  },
  moveSceneToIndex: (sceneId, toIndex) => {
    const s = get();
    const next = moveSceneToIndexInList(s.scenes, s.parts, sceneId, toIndex);
    if (next.scenes === s.scenes) return; // 位置不変/対象なし＝変化なし（未保存/履歴にしない）
    get().pushHistory();
    set({ ...next, saveStatus: "idle" });
  },
  duplicateScene: (sceneId) => {
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
    const s = get();
    const newId = createSceneId(s.scenes.map((x) => x.sceneId));
    const next = splitSceneLinesInList(s.scenes, s.parts, sceneId, lineIndex, newId);
    if (next.scenes === s.scenes) return ""; // 分割不能（掛け合いでない/1行/尺不足）＝変化なし（未保存にしない）
    get().pushHistory();
    // 後半場面（newId）は前半と同じ freeLayout を持つ＝元場面のアニメを後半にも引き継ぐ（splitScene と同じ・④）。
    set({ ...next, meta: metaWithDuplicatedAnimations(s.meta, sceneId, newId), saveStatus: "idle" });
    return newId;
  },
  removeAnimationsForElements: (sceneId, targetIds) => {
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
  changeOrientation: (target) => {
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
    get().pushHistory();
    set((s) => ({
      meta: { ...s.meta, videoSettings: { ...s.meta.videoSettings, fontId } },
      saveStatus: "idle",
    }));
  },
  setProjectName: (name) => {
    // 編集中の名前変更＝メモリの meta を更新（保存/自動保存で永続化）。UI 側は blur/Enter で確定＝1改名=1履歴。
    // 上限で切り詰め＝schema の projectName maxLength(80) 超をメモリにも入れない（貼り付け等の保険・#411）。
    get().pushHistory();
    set((s) => ({ meta: { ...s.meta, projectName: name.slice(0, PROJECT_NAME_MAX_LENGTH) }, saveStatus: "idle" }));
  },
  updateVoiceSettings: (patch) => {
    get().pushHistory();
    set((s) => ({
      meta: { ...s.meta, voiceSettings: { ...s.meta.voiceSettings, ...patch } },
      saveStatus: "idle",
    }));
  },
  updateBgmSettings: (patch) => {
    get().pushHistory();
    set((s) => ({
      meta: { ...s.meta, bgmSettings: { ...s.meta.bgmSettings, ...patch } },
      saveStatus: "idle",
    }));
  },
  setBundledBgm: (bundledBgmId) => {
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
  updateAsset: (assetId, update) =>
    set((s) => ({
      assets: s.assets.map((a) => (a.assetId === assetId ? update(a) : a)),
      saveStatus: "idle",
    })),
  removeAsset: (assetId) =>
    set((s) => ({ assets: s.assets.filter((a) => a.assetId !== assetId), saveStatus: "idle" })),
  addTemplatePack: (incoming) =>
    set((s) => {
      // templateId で重複排除（取り込んだものが同IDの既存を上書き）。順序は既存→新規。
      // テンプレは project.json に保存しない（利用可能な見た目パターン）ので saveStatus は変えない。
      // 取り込んだパックはセッション内で保持し newProject でもリセットしない（永続化/リセットは将来フェーズ＝B2 スコープ外）。
      const byId = new Map(s.templates.map((t) => [t.templateId, t] as const));
      for (const t of incoming) byId.set(t.templateId, t);
      return { templates: [...byId.values()] };
    }),
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
    try {
      await userTemplateFs.saveUserTemplate(template);
      set((s) => ({ templates: upsertUserTemplate(s.templates, template), templateError: null }));
    } catch {
      set({ templateError: "見た目パターンを保存できませんでした。もう一度お試しください。" });
    }
  },
  deleteUserTemplate: async (templateId) => {
    // ユーザーテンプレ以外（同梱/取り込みパック）はこのアクションで消さない（誤渡し時の同梱消去防止）。
    if (!isUserTemplate(templateId)) return false;
    // 削除前に所有素材 id を控える（テンプレ素材は登録テンプレ専用ゆえ、テンプレと一緒に掃除する＝ADR-0021）。
    const owned = templateAssetIdsOf(get().templates.find((t) => t.templateId === templateId)?.layers ?? []);
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
    // 取り込み→グローバル保存（Tauri）→ 表示用 src を合流。採番は現存テンプレ素材 id を基に最大連番+1。
    const result = await importTemplateAsset(file, Object.keys(get().templateAssetSrcById));
    if (!result) return null;
    set((s) => ({ templateAssetSrcById: { ...s.templateAssetSrcById, [result.assetId]: result.url } }));
    return result.assetId;
  },
  clearTemplateError: () => set({ templateError: null }),
  setEditingTemplateId: (templateId) => set({ editingTemplateId: templateId }),
  setEditingSceneId: (sceneId) => set({ editingSceneId: sceneId }),
  setWizardStep: (step) => set({ wizardStep: step }),
  setConfirmReturnTo: (screen) => set({ confirmReturnTo: screen }),
  setPreviewReturnTo: (screen) => set({ previewReturnTo: screen }),
  setExportRun: (patch) => set((s) => ({ exportRun: { ...s.exportRun, ...patch } })),
  setExportForm: (patch) => set((s) => ({ exportForm: { ...s.exportForm, ...patch } })),
  setAssetImage: async (assetId, file) => {
    if (get().isImporting) return; // 取り込み中の多重実行を防ぐ
    // 大容量はメモリへ展開しない（#48・A3）。小さい画像のみ data URL で即時表示する。
    if (exceedsInlineAssetLimit(file.size)) {
      const limitMb = Math.round(MAX_INLINE_ASSET_BYTES / (1024 * 1024));
      set({ importError: `この画像は大きすぎます（上限${limitMb}MB）。別の小さい画像を選び直してください。` });
      return;
    }
    // 画像は表示＋書き出し(ADR-0004)で data URL が必要。読み込んで即時表示。
    let dataUrl: string;
    try {
      dataUrl = await fileToDataUrl(file);
    } catch {
      set({ importError: "画像を読み込めませんでした。別の画像をお選びください。" }); // §2-5：次の行動。
      return;
    }
    set((s) => ({ assetSrcById: { ...s.assetSrcById, [assetId]: dataUrl }, importError: null }));
    set({ isImporting: true });
    try {
      // 保存先フォルダの名前空間のため projectId を確保する。
      let projectId = get().meta.projectId;
      if (!projectId) {
        const existing = await listProjectSummaries();
        projectId = createProjectId(new Date(), existing.map((p) => p.projectId));
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
        set((s) => ({
          assets: s.assets.map((a) => (a.assetId === assetId ? { ...a, filePath } : a)),
          assetSrcById: freshUrl ? { ...s.assetSrcById, [assetId]: freshUrl } : s.assetSrcById,
        }));
      }
    } catch (e) {
      // 表示は維持しつつ、保存に失敗したことを通知する（CLAUDE.md §2-5）。
      set({ importError: importErrorMessage(e) });
    } finally {
      set({ isImporting: false });
    }
  },
  addAsset: async (file) => {
    if (get().isImporting) return; // 取り込み中の多重実行を防ぐ
    // 大容量はメモリへ展開せず、ネイティブ「開く」のパス0コピー取り込み（addAssetByPath）へ誘導する（#48・A3）。
    if (exceedsInlineAssetLimit(file.size)) {
      const limitMb = Math.round(MAX_INLINE_ASSET_BYTES / (1024 * 1024));
      set({ importError: `このファイルは大きすぎます（上限${limitMb}MB）。大きいファイルは「写真・動画を選ぶ」から取り込んでください。` });
      return;
    }
    const assetId = createAssetId(get().assets.map((a) => a.assetId));
    // 拡張子から素材種別を判別（動画/画像）。詳細メタ(長さ・音声有無)・クリップ設定は follow-up。
    const assetType = detectAssetType(file.name);
    const parts = file.name.split(".");
    const ext = fileExtension(file.name) || (assetType === ASSET_TYPE.video ? "mp4" : "png");
    const baseName = parts.length > 1 ? parts.slice(0, -1).join(".") : file.name;
    const fileName = `${assetId}.${ext}`;
    const asset: Asset = {
      assetId,
      assetType,
      displayName: baseName.trim() || "新しい素材",
      filePath: `assets/${fileName}`,
    };
    // 画像は表示＋書き出し(ADR-0004)で data URL が要る。動画は表示用srcを持たない
    //（サムネは別途・書き出しはスロットを別経路で合成＝src不要。ADR-0006）。
    let dataUrl: string | undefined;
    if (assetType !== ASSET_TYPE.video) {
      try {
        dataUrl = await fileToDataUrl(file);
      } catch {
        set({ importError: "画像を読み込めませんでした。別の画像をお選びください。" }); // §2-5。素材は追加しない。
        return;
      }
    }
    // 即時：一覧へ追加（画像は表示も）。素材追加で未保存に戻す（「保存しました」取り残し防止）。
    set((s) => ({
      assets: [...s.assets, asset],
      assetSrcById: dataUrl ? { ...s.assetSrcById, [assetId]: dataUrl } : s.assetSrcById,
      saveStatus: "idle",
      importError: null,
    }));
    // 永続化（プロジェクトフォルダへコピー）。
    set({ isImporting: true });
    try {
      let projectId = get().meta.projectId;
      if (!projectId) {
        const existing = await listProjectSummaries();
        projectId = createProjectId(new Date(), existing.map((p) => p.projectId));
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
        const relPath = savedPath ?? `assets/${fileName}`;
        // メタ・サムネは取り込みの成否と独立（失敗してもロールバックしない）。
        const enrich = await probeAndThumbVideo(projectId, relPath);
        set(applyEnrichment(assetId, enrich));
      } else {
        // 画像は data URL で取り込み、取り込み後は表示用 src を asset:// に差し替える（data URL 常駐を解消・A3-2 レビュー）。
        const savedPath = await importAssetFile(projectId, fileName, dataUrl!);
        const displayUrl = savedPath ? await assetDisplayUrl(projectId, savedPath) : null;
        if (displayUrl) set((s) => ({ assetSrcById: { ...s.assetSrcById, [assetId]: displayUrl } }));
      }
    } catch (e) {
      // 取り込み失敗：楽観追加した素材をロールバックし、原因（Rust文言）を通知する（§2-5）。
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
    if (get().isImporting) return; // 取り込み中の多重実行を防ぐ
    const assetId = createAssetId(get().assets.map((a) => a.assetId));
    // パス末尾（ファイル名部分。/ と \ の両方に対応）から種別・拡張子・表示名を決める。
    const namePart = path.split(/[/\\]/).pop() ?? path;
    const assetType = detectAssetType(namePart);
    const parts = namePart.split(".");
    const ext = fileExtension(namePart) || (assetType === ASSET_TYPE.video ? "mp4" : "png");
    const baseName = parts.length > 1 ? parts.slice(0, -1).join(".") : namePart;
    const fileName = `${assetId}.${ext}`;
    const asset: Asset = {
      assetId,
      assetType,
      displayName: baseName.trim() || "新しい素材",
      filePath: `assets/${fileName}`,
    };
    // 即時：一覧へ追加（表示用 src は取り込み後に読み戻す）。素材追加で未保存に戻す。
    set((s) => ({ assets: [...s.assets, asset], saveStatus: "idle", importError: null }));
    set({ isImporting: true });
    try {
      let projectId = get().meta.projectId;
      if (!projectId) {
        const existing = await listProjectSummaries();
        projectId = createProjectId(new Date(), existing.map((p) => p.projectId));
        set((s) => ({ meta: { ...s.meta, projectId } }));
      }
      // 元ファイルを Rust が直接コピー（バイトは JS を経由しない）。
      const savedPath = await importAssetByPath(projectId, fileName, path);
      const relPath = savedPath ?? `assets/${fileName}`;
      if (assetType === ASSET_TYPE.video) {
        // メタ・サムネは取り込みの成否と独立（失敗してもロールバックしない）。
        const enrich = await probeAndThumbVideo(projectId, relPath);
        set(applyEnrichment(assetId, enrich));
      } else {
        // 画像の表示用 src を取り込んだ実体から解決（Tauri は asset://）。書き出しの data URL は書き出し時に別途読む（A3-2/ADR-0004）。
        const url = await assetDisplayUrl(projectId, relPath);
        if (url) set((s) => ({ assetSrcById: { ...s.assetSrcById, [assetId]: url } }));
      }
    } catch (e) {
      // 取り込み失敗：楽観追加した素材をロールバックし、原因（Rust文言）を通知する（§2-5）。
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
  clearImportError: () => set({ importError: null }),
  clearBgmError: () => set({ bgmError: null }),
  setBgm: async (file) => {
    if (get().isImporting) return; // 取り込み中の多重実行を防ぐ
    set({ bgmError: null, isImporting: true });
    try {
      let projectId = get().meta.projectId;
      if (!projectId) {
        const existing = await listProjectSummaries();
        projectId = createProjectId(new Date(), existing.map((p) => p.projectId));
      }
      const parts = file.name.split(".");
      const rawExt = parts.length > 1 ? parts[parts.length - 1] : "mp3";
      const ext = rawExt.toLowerCase().replace(/[^a-z0-9]/g, "") || "mp3";
      const baseName = parts.length > 1 ? parts.slice(0, -1).join(".") : file.name;
      // BGM はプロジェクトに1つ。既存があればその assetId を使い回してファイルを差し替える。
      // 新規IDは §2.1 の bgm_{slug}_{NNN}（slug=ファイル名）で採番する。
      const existingBgm = get().assets.find((a) => a.assetType === ASSET_TYPE.bgm);
      const assetId =
        existingBgm?.assetId ?? createBgmId(baseName, get().assets.map((a) => a.assetId));
      const fileName = `${assetId}.${ext}`;
      // 先に取り込み（失敗時はストアを変えない＝ゴースト防止）。Tauri 非検出時は null（非永続）。
      const filePath = await importAssetFile(projectId, fileName, file.dataUrl);
      const asset: Asset = {
        assetId,
        assetType: ASSET_TYPE.bgm,
        displayName: baseName.trim() || "BGM",
        filePath: filePath ?? `assets/${fileName}`,
      };
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
    const scene = get().scenes.find((s) => s.sceneId === sceneId);
    if (!scene) return;
    // 全場面生成中は個別呼び出し（UI/他画面/テストからの直接呼び出し）を弾く。bulk 自身は fromBulk で通す。
    if (!opts?.fromBulk && get().isGeneratingNarration) return;

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
      set({ narrationError: null });
      try {
        const base = resolveNarrationVoice(scene.narration, get().meta.voiceSettings);
        for (const line of targets) {
          const result = await voiceProvider.synthesize(resolveLineVoice(line, base));
          set((st) => ({
            scenes: st.scenes.map((s) => (s.sceneId === sceneId ? withLineStatus(s, line.lineId, NARRATION_STATUS.generated) : s)),
            narrationAudioById: { ...st.narrationAudioById, [lineAudioKey(sceneId, line.lineId)]: result.audioDataUrl },
          }));
        }
      } catch (e) {
        // pending の行だけ failed にする（既に generated 済みの行とその音声は保持＝不整合を避ける）。
        set((st) => ({
          scenes: st.scenes.map((s) =>
            s.sceneId === sceneId && s.lines
              ? { ...s, lines: s.lines.map((l) => (l.status === NARRATION_STATUS.pending ? { ...l, status: NARRATION_STATUS.failed } : l)) }
              : s,
          ),
        }));
        set({ narrationError: typeof e === "string" ? e : "音声の作成に失敗しました。もう一度お試しください。" });
      }
      return;
    }

    if (scene.narration.text.trim().length === 0) return;
    if (scene.narration.status === NARRATION_STATUS.pending) return; // 多重起動防止（連打・再入）
    const setStatus = (status: Scene["narration"]["status"]) =>
      set((st) => ({
        scenes: st.scenes.map((s) =>
          s.sceneId === sceneId ? { ...s, narration: { ...s.narration, status } } : s,
        ),
      }));
    setStatus(NARRATION_STATUS.pending);
    set({ narrationError: null });
    try {
      const v = resolveNarrationVoice(scene.narration, get().meta.voiceSettings);
      const result = await voiceProvider.synthesize({ text: scene.narration.text, ...v });
      set((st) => ({
        scenes: st.scenes.map((s) =>
          s.sceneId === sceneId ? { ...s, narration: { ...s.narration, status: NARRATION_STATUS.generated } } : s,
        ),
        narrationAudioById: { ...st.narrationAudioById, [sceneId]: result.audioDataUrl },
      }));
    } catch (e) {
      setStatus(NARRATION_STATUS.failed);
      set({
        narrationError:
          typeof e === "string" ? e : "音声の作成に失敗しました。もう一度お試しください。",
      });
    }
  },
  generateAllNarrations: async () => {
    if (get().isGeneratingNarration) return;
    set({ isGeneratingNarration: true });
    try {
      // 未生成（none/pending/failed）のみ対象。生成済みは個別の「声を作り直す」で上書きする。
      // 掛け合い・単一 narration 共通の実効判定（sceneNeedsVoice）を precheck と共有＝同概念同挙動（#403）。
      const ids = get().scenes.filter(sceneNeedsVoice).map((s) => s.sceneId);
      await Promise.all(ids.map((id) => get().generateNarration(id, { fromBulk: true })));
    } finally {
      set({ isGeneratingNarration: false });
    }
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
  undo: () =>
    set((s) => {
      // 書き出し中は文書 slice（scenes/parts/meta）を変えない＝進行中の書き出しが不整合データを読むのを防ぐ
      // （newProject/loadProject と同じ #379 ガード。Undo は全画面ショートカット化で書き出し中も到達し得る・#413）。
      if (isExportBusy(s.exportRun.phase)) return {};
      const r = undoSnapshot<DocSnapshot>({ past: s.past, future: s.future }, docSnapshot(s));
      if (!r) return {}; // 戻せない
      return { ...r.restored, past: r.history.past, future: r.history.future, saveStatus: "idle" };
    }),
  redo: () =>
    set((s) => {
      if (isExportBusy(s.exportRun.phase)) return {}; // 同上（書き出し中は redo も文書 slice を変えない・#379/#413）
      const r = redoSnapshot<DocSnapshot>({ past: s.past, future: s.future }, docSnapshot(s));
      if (!r) return {}; // やり直せない
      return { ...r.restored, past: r.history.past, future: r.history.future, saveStatus: "idle" };
    }),
}));
