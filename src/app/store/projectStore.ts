// プロジェクトの状態（Zustand）。AI出力→検証/変換→内部Scene の結果を保持し、UIへ供給する。
// 保存/読込は project.json（infrastructure/projectFs.ts 経由）。AIは当面 MockProvider。
import { create } from "zustand";
import { DEFAULT_TARGET_DURATION_SEC } from "../../domain/constants";
import type { Asset, CompanyInfo, Part, Scene, Warning } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";
import { transformVideoPlan } from "../../domain/ai/transformPlan";
import {
  assembleProject, createAssetId, createProjectId, defaultVideoSettings, defaultVoiceSettings,
  parseProjectDoc,
} from "../../domain/project/persistence";
import type { ProjectHeader } from "../../domain/project/persistence";
import { MockAiProvider } from "../../infrastructure/aiProviders/mockAiProvider";
import { sampleAssets, sampleTemplates } from "../../infrastructure/sampleData";
import {
  listProjectSummaries, loadProjectDoc, saveProjectDoc, setLastProjectId,
} from "../../infrastructure/projectFs";
import type { ProjectSummary } from "../../infrastructure/projectFs";
import { importAssetFile, readAssetDataUrl } from "../../infrastructure/assetFs";
import { resolveNarrationVoice } from "../../domain/voice/voiceProvider";
import type { VoiceProvider } from "../../domain/voice/voiceProvider";
import { MockVoiceProvider } from "../../infrastructure/voiceProviders/mockVoiceProvider";
import { VoicevoxProvider } from "../../infrastructure/voiceProviders/voicevoxProvider";

export type GenerateStatus = "idle" | "generating" | "ready" | "error";
export type SaveStatus = "idle" | "saving" | "saved" | "error";

interface ProjectState {
  status: GenerateStatus;
  saveStatus: SaveStatus;
  /** Project の見出し情報（projectId/名前/目的/各種設定）。Asset/Part/Scene は別フィールド。 */
  meta: ProjectHeader;
  parts: Part[];
  scenes: Scene[];
  warnings: Warning[];
  templates: Template[];
  assets: Asset[];
  /** 素材の表示用src（data URL）。assetId→src。project.json には入れず永続化しない。 */
  assetSrcById: Record<string, string>;
  /** 生成済みナレーション音声（data URL）。sceneId→src。永続化しない（V-Bでファイル化予定）。 */
  narrationAudioById: Record<string, string>;
  /** 「全場面の声を作成」実行中フラグ（多重起動防止）。 */
  isGeneratingNarration: boolean;
  /** ナレーション生成に失敗したときのユーザー向け文言（成功/再試行で消える）。 */
  narrationError: string | null;
  /** Mock AI → 検証/変換 → 内部 Scene を生成してストアへ反映する。 */
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
  /** 素材を更新する（素材管理：説明/タグ/公開チェック等）。 */
  updateAsset: (assetId: string, update: (asset: Asset) => Asset) => void;
  /** 素材を削除する。 */
  removeAsset: (assetId: string) => void;
  /** 画像ファイルを素材に取り込み、プロジェクトフォルダへ永続化する（表示用srcも即時更新）。 */
  setAssetImage: (assetId: string, file: { name: string; dataUrl: string }) => Promise<void>;
  /** 新しい素材（画像）を登録する。新規IDを採番し、プロジェクトフォルダへ取り込む。 */
  addAsset: (file: { name: string; dataUrl: string }) => Promise<void>;
  /** 指定場面のナレーション音声を生成する（narration.status を更新）。 */
  generateNarration: (sceneId: string) => Promise<void>;
  /** セリフのある全場面のナレーション音声を生成する。 */
  generateAllNarrations: () => Promise<void>;
}

const provider = new MockAiProvider();
// Tauri ではローカル VOICEVOX に接続、ブラウザ開発では Mock（無音）にフォールバック。
const hasTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const voiceProvider: VoiceProvider = hasTauri ? new VoicevoxProvider() : new MockVoiceProvider();

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
  generate: async () => {
    set({ status: "generating" });
    try {
      const companyInfo: CompanyInfo = {
        companyName: "株式会社サンプル",
        industry: "IT・業務システム開発",
        jobType: "エンジニア（新卒）",
      };
      const purpose = "new_graduate" as const;
      const plan = await provider.generateVideoPlan({
        companyInfo,
        purpose,
        targetAudience: "新卒採用",
        targetDurationSec: DEFAULT_TARGET_DURATION_SEC,
        tone: "親しみやすい",
        templates: [],
        assets: sampleAssets,
        yukoPoseTags: ["smile", "guide"],
      });
      const { parts, scenes, warnings } = transformVideoPlan(plan, {
        templates: sampleTemplates,
        assets: sampleAssets,
      });
      set((s) => ({
        status: "ready",
        parts,
        scenes,
        warnings,
        meta: { ...s.meta, companyInfo, purpose },
      }));
    } catch {
      set({ status: "error" });
    }
  },
  fail: () => set({ status: "error" }),
  reset: () => set({ status: "idle", saveStatus: "idle", parts: [], scenes: [], warnings: [] }),
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
      const meta: ProjectHeader = { ...s.meta, projectId, updatedAt: new Date().toISOString() };
      const project = assembleProject(meta, s.assets, s.parts, s.scenes);
      await saveProjectDoc(projectId, JSON.stringify(project, null, 2));
      setLastProjectId(projectId);
      set({ meta, saveStatus: "saved" });
    } catch {
      set({ saveStatus: "error" });
    }
  },
  loadProject: async (projectId) => {
    const text = await loadProjectDoc(projectId);
    const project = parseProjectDoc(text);
    // ディスクの素材を data URL に復元（filePath を持つもの。未配置のサンプル等は null でスキップ）。並列実行。
    const loaded = await Promise.all(
      project.assets
        .filter((a) => a.filePath)
        .map(async (a) => {
          const url = await readAssetDataUrl(project.projectId, a.filePath);
          return url ? ([a.assetId, url] as const) : null;
        }),
    );
    const assetSrcById: Record<string, string> = {};
    for (const entry of loaded) {
      if (entry) assetSrcById[entry[0]] = entry[1];
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
      assets: project.assets,
      parts: project.parts,
      scenes: project.scenes,
      warnings: [],
      assetSrcById,
      narrationAudioById: {},
      narrationError: null,
    });
    setLastProjectId(projectId);
  },
  listProjects: () => listProjectSummaries(),
  updateScene: (sceneId, update) =>
    set((s) => ({
      scenes: s.scenes.map((sc) => (sc.sceneId === sceneId ? update(sc) : sc)),
    })),
  updateAsset: (assetId, update) =>
    set((s) => ({ assets: s.assets.map((a) => (a.assetId === assetId ? update(a) : a)) })),
  removeAsset: (assetId) =>
    set((s) => ({ assets: s.assets.filter((a) => a.assetId !== assetId) })),
  setAssetImage: async (assetId, file) => {
    // 即時表示（メモリ内 data URL）。
    set((s) => ({ assetSrcById: { ...s.assetSrcById, [assetId]: file.dataUrl } }));
    try {
      // 保存先フォルダの名前空間のため projectId を確保する。
      let projectId = get().meta.projectId;
      if (!projectId) {
        const existing = await listProjectSummaries();
        projectId = createProjectId(new Date(), existing.map((p) => p.projectId));
        set((s) => ({ meta: { ...s.meta, projectId } }));
      }
      const parts = file.name.split(".");
      const rawExt = parts.length > 1 ? parts[parts.length - 1] : "png";
      const ext = rawExt.toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
      const filePath = await importAssetFile(projectId, `${assetId}.${ext}`, file.dataUrl);
      if (filePath) {
        set((s) => ({ assets: s.assets.map((a) => (a.assetId === assetId ? { ...a, filePath } : a)) }));
      }
    } catch {
      // 表示は維持しつつ、保存に失敗したことを通知する（CLAUDE.md §2-5）。
      set({ saveStatus: "error" });
    }
  },
  addAsset: async (file) => {
    const assetId = createAssetId(get().assets.map((a) => a.assetId));
    const parts = file.name.split(".");
    const rawExt = parts.length > 1 ? parts[parts.length - 1] : "png";
    const ext = rawExt.toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
    const baseName = parts.length > 1 ? parts.slice(0, -1).join(".") : file.name;
    const fileName = `${assetId}.${ext}`;
    const asset: Asset = {
      assetId,
      // TODO: mime/拡張子から assetType を判別（動画/ロゴ等）。当面は image 固定（follow-up）。
      assetType: "image",
      displayName: baseName.trim() || "新しい素材",
      filePath: `assets/${fileName}`,
    };
    // 即時：一覧へ追加＋表示。
    set((s) => ({
      assets: [...s.assets, asset],
      assetSrcById: { ...s.assetSrcById, [assetId]: file.dataUrl },
    }));
    // 永続化（プロジェクトフォルダへコピー）。
    try {
      let projectId = get().meta.projectId;
      if (!projectId) {
        const existing = await listProjectSummaries();
        projectId = createProjectId(new Date(), existing.map((p) => p.projectId));
        set((s) => ({ meta: { ...s.meta, projectId } }));
      }
      await importAssetFile(projectId, fileName, file.dataUrl);
    } catch {
      // 取り込み失敗：楽観追加した素材をロールバック（filePathあり・実体なしの不整合を防ぐ）。
      set((s) => ({
        assets: s.assets.filter((a) => a.assetId !== assetId),
        assetSrcById: Object.fromEntries(
          Object.entries(s.assetSrcById).filter(([id]) => id !== assetId),
        ),
        saveStatus: "error",
      }));
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
    setStatus("pending");
    set({ narrationError: null });
    try {
      const v = resolveNarrationVoice(scene.narration, get().meta.voiceSettings);
      const result = await voiceProvider.synthesize({ text: scene.narration.text, ...v });
      set((st) => ({
        scenes: st.scenes.map((s) =>
          s.sceneId === sceneId ? { ...s, narration: { ...s.narration, status: "generated" } } : s,
        ),
        narrationAudioById: { ...st.narrationAudioById, [sceneId]: result.audioDataUrl },
      }));
    } catch (e) {
      setStatus("failed");
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
        .scenes.filter((s) => s.narration.text.trim().length > 0 && s.narration.status !== "generated")
        .map((s) => s.sceneId);
      await Promise.all(ids.map((id) => get().generateNarration(id)));
    } finally {
      set({ isGeneratingNarration: false });
    }
  },
}));
