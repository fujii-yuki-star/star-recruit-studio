// プロジェクトの状態（Zustand）。AI出力→検証/変換→内部Scene の結果を保持し、UIへ供給する。
// 保存/読込は project.json（infrastructure/projectFs.ts 経由）。AIは Gemini キーがあれば実プロバイダ、無ければ Mock。
import { create } from "zustand";
import { BGM_VOLUME, DEFAULT_CHARACTER_ID, DEFAULT_TARGET_DURATION_SEC, SCENE_DEFAULT_DURATION_SEC } from "../../domain/constants";
import type { Asset, AssetMetadata, BgmSettings, CompanyInfo, Narration, Part, Scene, VoiceSettings, Warning } from "../../domain/project/types";
import { ASSET_TYPE, NARRATION_STATUS, type Purpose } from "../../domain/enums";
import type { Template } from "../../domain/template/types";
import { transformVideoPlan } from "../../domain/ai/transformPlan";
import { buildTemplateSummaries, buildYukoPoseTags } from "../../domain/ai/videoPlanInput";
import type { GenerateVideoPlanInput } from "../../domain/ai/aiProvider";
import type { AiVideoPlan } from "../../domain/ai/types";
import {
  assembleProject, createAssetId, createBgmId, createPartId, createProjectId, createSceneId,
  defaultVideoSettings, defaultVoiceSettings, parseProjectDoc,
} from "../../domain/project/persistence";
import type { ProjectHeader } from "../../domain/project/persistence";
import { duplicateSceneInList, moveSceneInList, splitSceneInList } from "../../domain/project/sceneOps";
import { MockAiProvider } from "../../infrastructure/aiProviders/mockAiProvider";
import { GeminiProvider } from "../../infrastructure/aiProviders/geminiProvider";
import { GEMINI_PROVIDER, hasApiKey, isTauri } from "../../infrastructure/aiClient";
import { getAiModel } from "../../infrastructure/appSettings";
import { sampleAssets, sampleTemplates } from "../../infrastructure/sampleData";
import {
  listProjectSummaries, loadProjectDoc, saveProjectDoc, setLastProjectId,
} from "../../infrastructure/projectFs";
import type { ProjectSummary } from "../../infrastructure/projectFs";
import { importAssetFile, importAssetBytes, importAssetByPath, readAssetDataUrl, probeVideo, extractVideoThumbnail, fileToDataUrl } from "../../infrastructure/assetFs";
import { detectAssetType, fileExtension } from "../../domain/asset/assetFile";
import { importVoiceFile, readVoiceDataUrl } from "../../infrastructure/voiceFs";
import { resolveNarrationVoice } from "../../domain/voice/voiceProvider";
import type { VoiceProvider } from "../../domain/voice/voiceProvider";
import { MockVoiceProvider } from "../../infrastructure/voiceProviders/mockVoiceProvider";
import { VoicevoxProvider } from "../../infrastructure/voiceProviders/voicevoxProvider";

export type GenerateStatus = "idle" | "generating" | "ready" | "error";
export type SaveStatus = "idle" | "saving" | "saved" | "error";
/** 声設定の編集可能パラメータのみ（defaultVoiceId は必須なので更新対象から除外）。 */
export type VoiceParamPatch = Partial<Pick<VoiceSettings, "speed" | "pitch" | "intonation" | "volume">>;
/** BGM設定の編集可能フィールドのみ（assetId は取り込み時に確定するので更新対象から除外）。 */
export type BgmPatch = Partial<Pick<BgmSettings, "volume" | "enabled" | "loop" | "fadeInSec" | "fadeOutSec">>;

interface ProjectState {
  status: GenerateStatus;
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
  /** 生成済みナレーション音声（data URL）。sceneId→src。表示・書き出し用にメモリ保持し、保存時に voicePath としてディスク永続化する（V-C2）。 */
  narrationAudioById: Record<string, string>;
  /** 「全場面の声を作成」実行中フラグ（多重起動防止）。 */
  isGeneratingNarration: boolean;
  /** ナレーション生成に失敗したときのユーザー向け文言（成功/再試行で消える）。 */
  narrationError: string | null;
  /** AI 構成案の生成に失敗したときのユーザー向け文言（§2-5。再生成/成功で消える）。UI は status==="error" 時にこれを表示する。 */
  aiError: string | null;
  /** AI（鍵があれば実プロバイダ／無ければ Mock）→ 検証/変換 → 内部 Scene を生成してストアへ反映する。 */
  generate: () => Promise<void>;
  /** デモ/テスト用にエラー状態へ。 */
  fail: () => void;
  reset: () => void;
  /** 新規プロジェクト（作業状態を初期化）。 */
  newProject: () => void;
  /** 現在の状態を project.json として保存する。 */
  saveProject: () => Promise<void>;
  /** 保存済みプロジェクトを読み込んで反映する。 */
  loadProject: (projectId: string) => Promise<void>;
  /** 保存済みプロジェクトの要約一覧を返す。 */
  listProjects: () => Promise<ProjectSummary[]>;
  /** 指定シーンを更新する（編集→プレビュー即反映）。 */
  updateScene: (sceneId: string, update: (scene: Scene) => Scene) => void;
  /** 末尾パートに新しい空の場面を追加し、その sceneId を返す（既定テンプレ）。テンプレ未読込時は ""。 */
  addScene: () => string;
  /** 指定の場面を削除する（パートからも除き、order を 1..N に振り直す）。 */
  removeScene: (sceneId: string) => void;
  /** 場面を上/下へ1つ移動する（表示順＝配列順を入れ替え、order と part.sceneIds を整合）。 */
  moveScene: (sceneId: string, direction: "up" | "down") => void;
  /** 場面を複製して直後に挿入し、新しい sceneId を返す（セリフは引き継ぎ・音声は作り直し）。 */
  duplicateScene: (sceneId: string) => string;
  /** 場面のセリフを splitIndex（カーソル位置）で分け、1場面を2場面にする。新しい sceneId を返す。 */
  splitScene: (sceneId: string, splitIndex: number) => string;
  /** ウィザードで入力した目的・会社情報を現在のプロジェクト(meta)へ反映する（保存・生成で使う）。 */
  applyProjectInfo: (input: { purpose: Purpose; companyInfo: CompanyInfo }) => void;
  /** 声設定（話速・高さ・抑揚など）を部分更新する（現在のプロジェクト・保存時に永続化）。defaultVoiceId は更新不可。 */
  updateVoiceSettings: (patch: VoiceParamPatch) => void;
  /** BGM設定（音量など）を部分更新する（現在のプロジェクト・保存時に永続化）。assetId は更新不可。 */
  updateBgmSettings: (patch: BgmPatch) => void;
  /** 素材を更新する（素材管理：説明/タグ/公開チェック等）。 */
  updateAsset: (assetId: string, update: (asset: Asset) => Asset) => void;
  /** 素材を削除する。 */
  removeAsset: (assetId: string) => void;
  /** 画像ファイルを素材に取り込み、プロジェクトフォルダへ永続化する（表示用srcも即時更新）。 */
  setAssetImage: (assetId: string, file: File) => Promise<void>;
  /** 新しい素材（画像/動画）を登録する。動画は生バイトで取り込み（メモリ節約）、画像は data URL。 */
  addAsset: (file: File) => Promise<void>;
  addAssetByPath: (path: string) => Promise<void>;
  clearImportError: () => void;
  /** BGM 音声を取り込み、bgmSettings に設定する（プロジェクトに1つ。既存があれば差し替え）。 */
  setBgm: (file: { name: string; dataUrl: string }) => Promise<void>;
  /** 指定場面のナレーション音声を生成する（narration.status を更新）。 */
  generateNarration: (sceneId: string) => Promise<void>;
  /** セリフのある全場面のナレーション音声を生成する。 */
  generateAllNarrations: () => Promise<void>;
  /** 設定の試聴：サンプル文を現在の声設定で合成し、音声 data URL を返す。 */
  synthesizePreview: () => Promise<string>;
}

// AI 構成案プロバイダの選択：Tauri かつ Gemini キーありなら実 Gemini、なければ Mock
// （非Tauri／オフライン／鍵未設定のフォールバック＝ADR-0010）。
// 実 AI を試みて失敗したときは Mock に倒さずエラーを伝播する（黙って差し替えない）。
async function generateVideoPlan(input: GenerateVideoPlanInput): Promise<AiVideoPlan> {
  if (isTauri() && (await hasApiKey(GEMINI_PROVIDER))) {
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
      const url = await readAssetDataUrl(projectId, thumbPath);
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
    companyInfo: { companyName: "株式会社サンプル" },
    voiceSettings: defaultVoiceSettings(),
  };
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  status: "idle",
  saveStatus: "idle",
  importError: null,
  meta: defaultHeader(),
  parts: [],
  scenes: [],
  warnings: [],
  templates: sampleTemplates,
  assets: sampleAssets,
  assetSrcById: {},
  narrationAudioById: {},
  isGeneratingNarration: false,
  narrationError: null,
  aiError: null,
  generate: async () => {
    set({ status: "generating", aiError: null });
    try {
      // 会社情報・目的・素材はウィザードで反映済み（未経由なら既定値）。
      // 送信前確認（ConfirmScreen）の表示と AI へ渡す内容を一致させるため get() の実データを使う（§2-6）。
      const { meta, assets, templates } = get();
      const { companyInfo, purpose } = meta;
      const plan = await generateVideoPlan({
        companyInfo,
        purpose,
        targetAudience: companyInfo.recruitTarget ?? "",
        targetDurationSec: DEFAULT_TARGET_DURATION_SEC,
        tone: "親しみやすい",
        templates: buildTemplateSummaries(templates),
        assets,
        yukoPoseTags: buildYukoPoseTags(assets),
      });
      const { parts, scenes, warnings } = transformVideoPlan(plan, {
        templates,
        assets,
      });
      set({ status: "ready", parts, scenes, warnings });
    } catch (e) {
      // 失敗の文言を保持し、UI が「次の行動」を出せるようにする（§2-5）。
      // Rust/プロバイダは §2-5 のユーザー向け文言で reject する（鍵未設定→設定へ／不適合→再試行 等）。
      const aiError =
        e instanceof Error ? e.message : typeof e === "string" ? e : "生成に失敗しました。もう一度お試しください。";
      set({ status: "error", aiError });
    }
  },
  fail: () => set({ status: "error" }),
  reset: () => set({ status: "idle", saveStatus: "idle", parts: [], scenes: [], warnings: [], aiError: null }),
  newProject: () =>
    set({
      status: "idle",
      saveStatus: "idle",
      meta: defaultHeader(),
      parts: [],
      scenes: [],
      warnings: [],
      assets: sampleAssets,
      assetSrcById: {},
      narrationAudioById: {},
      narrationError: null,
      aiError: null,
    }),
  saveProject: async () => {
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
      await saveProjectDoc(projectId, JSON.stringify(project, null, 2));
      setLastProjectId(projectId);
      set({ meta, scenes, saveStatus: "saved" });
    } catch {
      set({ saveStatus: "error" });
    }
  },
  loadProject: async (projectId) => {
    const text = await loadProjectDoc(projectId);
    const project = parseProjectDoc(text);
    // ディスクの素材を data URL に復元（filePath を持つもの。未配置のサンプル等は null でスキップ）。並列実行。
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
          const url = await readAssetDataUrl(project.projectId, thumbPath);
          return url ? { assetId: a.assetId, url, thumbnailPath: thumbPath } : null;
        }
        if (!a.filePath) return null;
        const url = await readAssetDataUrl(project.projectId, a.filePath);
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
    const voiceLoaded = await Promise.all(
      project.scenes
        .filter((sc) => sc.narration.status === NARRATION_STATUS.generated && sc.narration.voicePath)
        .map(async (sc) => {
          const url = await readVoiceDataUrl(project.projectId, sc.narration.voicePath!);
          return url ? ([sc.sceneId, url] as const) : null;
        }),
    );
    const narrationAudioById: Record<string, string> = {};
    for (const entry of voiceLoaded) {
      if (entry) narrationAudioById[entry[0]] = entry[1];
    }
    set({
      status: "ready",
      saveStatus: "idle",
      meta: {
        projectId: project.projectId,
        projectName: project.projectName,
        purpose: project.purpose,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        videoSettings: project.videoSettings,
        companyInfo: project.companyInfo,
        toneSettings: project.toneSettings,
        voiceSettings: project.voiceSettings,
        bgmSettings: project.bgmSettings,
      },
      assets: project.assets.map((a) =>
        videoThumb[a.assetId] ? { ...a, thumbnailPath: videoThumb[a.assetId] } : a,
      ),
      parts: project.parts,
      scenes: project.scenes,
      warnings: [],
      assetSrcById,
      narrationAudioById,
      narrationError: null,
    });
    setLastProjectId(projectId);
  },
  listProjects: () => listProjectSummaries(),
  updateScene: (sceneId, update) =>
    set((s) => ({
      scenes: s.scenes.map((sc) => (sc.sceneId === sceneId ? update(sc) : sc)),
      // 編集したら「保存しました」表示を解除（未保存と分かるように）。
      saveStatus: "idle",
    })),
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
  removeScene: (sceneId) =>
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
    })),
  moveScene: (sceneId, direction) => {
    const s = get();
    const next = moveSceneInList(s.scenes, s.parts, sceneId, direction);
    if (next.scenes === s.scenes) return; // 端＝変化なし（未保存にしない）
    set({ ...next, saveStatus: "idle" });
  },
  duplicateScene: (sceneId) => {
    const s = get();
    const newId = createSceneId(s.scenes.map((x) => x.sceneId));
    const next = duplicateSceneInList(s.scenes, s.parts, sceneId, newId);
    if (next.scenes === s.scenes) return ""; // 対象なし＝変化なし
    set({ ...next, saveStatus: "idle" });
    return newId;
  },
  splitScene: (sceneId, splitIndex) => {
    const s = get();
    const newId = createSceneId(s.scenes.map((x) => x.sceneId));
    const next = splitSceneInList(s.scenes, s.parts, sceneId, splitIndex, newId);
    if (next.scenes === s.scenes) return ""; // 分割不能＝変化なし（未保存にしない）
    set({ ...next, saveStatus: "idle" });
    return newId;
  },
  applyProjectInfo: (input) =>
    set((s) => ({
      meta: { ...s.meta, purpose: input.purpose, companyInfo: input.companyInfo },
      saveStatus: "idle",
    })),
  updateVoiceSettings: (patch) =>
    set((s) => ({
      meta: { ...s.meta, voiceSettings: { ...s.meta.voiceSettings, ...patch } },
      saveStatus: "idle",
    })),
  updateBgmSettings: (patch) =>
    set((s) => ({
      meta: { ...s.meta, bgmSettings: { ...s.meta.bgmSettings, ...patch } },
      saveStatus: "idle",
    })),
  updateAsset: (assetId, update) =>
    set((s) => ({
      assets: s.assets.map((a) => (a.assetId === assetId ? update(a) : a)),
      saveStatus: "idle",
    })),
  removeAsset: (assetId) =>
    set((s) => ({ assets: s.assets.filter((a) => a.assetId !== assetId), saveStatus: "idle" })),
  setAssetImage: async (assetId, file) => {
    // 画像は表示＋書き出し(ADR-0004)で data URL が必要。読み込んで即時表示。
    let dataUrl: string;
    try {
      dataUrl = await fileToDataUrl(file);
    } catch {
      set({ importError: "画像を読み込めませんでした。別の画像をお選びください。" }); // §2-5：次の行動。
      return;
    }
    set((s) => ({ assetSrcById: { ...s.assetSrcById, [assetId]: dataUrl }, importError: null }));
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
        set((s) => ({ assets: s.assets.map((a) => (a.assetId === assetId ? { ...a, filePath } : a)) }));
      }
    } catch (e) {
      // 表示は維持しつつ、保存に失敗したことを通知する（CLAUDE.md §2-5）。
      set({ importError: importErrorMessage(e) });
    }
  },
  addAsset: async (file) => {
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
        // 画像は data URL(base64) 経路で取り込む（表示用に既に読み込んだ data URL を流用）。
        await importAssetFile(projectId, fileName, dataUrl!);
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
    }
  },
  // 真の0コピー取り込み（Tauri）：ネイティブ「開く」で選んだ絶対パスを Rust がコピーする。
  // JS は素材バイトを一切読まない。画像の表示用 data URL は取り込み後にディスクから読み戻す（ADR-0004）。
  addAssetByPath: async (path) => {
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
        // 画像は表示＋書き出し(ADR-0004)で data URL が要る。取り込んだ実体から読み戻す。
        const url = await readAssetDataUrl(projectId, relPath);
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
    }
  },
  clearImportError: () => set({ importError: null }),
  setBgm: async (file) => {
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
            volume: s.meta.bgmSettings?.volume ?? BGM_VOLUME,
            loop: true,
          },
        },
        assets: existingBgm
          ? s.assets.map((a) => (a.assetId === assetId ? asset : a))
          : [...s.assets, asset],
        assetSrcById: { ...s.assetSrcById, [assetId]: file.dataUrl },
      }));
    } catch {
      set({ saveStatus: "error" });
    }
  },
  generateNarration: async (sceneId) => {
    const scene = get().scenes.find((s) => s.sceneId === sceneId);
    if (!scene || scene.narration.text.trim().length === 0) return;
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
      const ids = get()
        .scenes.filter((s) => s.narration.text.trim().length > 0 && s.narration.status !== NARRATION_STATUS.generated)
        .map((s) => s.sceneId);
      await Promise.all(ids.map((id) => get().generateNarration(id)));
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
}));
