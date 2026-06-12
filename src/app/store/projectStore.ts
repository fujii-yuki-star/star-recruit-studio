// プロジェクトの状態（Zustand）。AI出力→検証/変換→内部Scene の結果を保持し、UIへ供給する。
// 本実装では project.json の読込/保存・実AIプロバイダに差し替える。今は MockProvider＋サンプルで全フローを通す。
import { create } from "zustand";
import type { Asset, Part, Scene, Warning } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";
import { transformVideoPlan } from "../../domain/ai/transformPlan";
import { MockAiProvider } from "../../infrastructure/aiProviders/mockAiProvider";
import { sampleAssets, sampleTemplates } from "../../infrastructure/sampleData";

export type GenerateStatus = "idle" | "generating" | "ready" | "error";

interface ProjectState {
  status: GenerateStatus;
  parts: Part[];
  scenes: Scene[];
  warnings: Warning[];
  templates: Template[];
  assets: Asset[];
  /** Mock AI → 検証/変換 → 内部 Scene を生成してストアへ反映する。 */
  generate: () => Promise<void>;
  /** デモ/テスト用にエラー状態へ。 */
  fail: () => void;
  reset: () => void;
  /** 指定シーンを更新する（編集→プレビュー即反映）。 */
  updateScene: (sceneId: string, update: (scene: Scene) => Scene) => void;
  /** 素材を更新する（素材管理：説明/タグ/公開チェック等）。 */
  updateAsset: (assetId: string, update: (asset: Asset) => Asset) => void;
  /** 素材を削除する。 */
  removeAsset: (assetId: string) => void;
}

const provider = new MockAiProvider();

export const useProjectStore = create<ProjectState>((set) => ({
  status: "idle",
  parts: [],
  scenes: [],
  warnings: [],
  templates: sampleTemplates,
  assets: sampleAssets,
  generate: async () => {
    set({ status: "generating" });
    try {
      const plan = await provider.generateVideoPlan({
        companyInfo: { companyName: "株式会社サンプル", industry: "IT・業務システム開発", jobType: "エンジニア（新卒）" },
        purpose: "new_graduate",
        targetAudience: "新卒採用",
        targetDurationSec: 60,
        tone: "親しみやすい",
        templates: [],
        assets: sampleAssets,
        yukoPoseTags: ["smile", "guide"],
      });
      const { parts, scenes, warnings } = transformVideoPlan(plan, {
        templates: sampleTemplates,
        assets: sampleAssets,
      });
      set({ status: "ready", parts, scenes, warnings });
    } catch {
      set({ status: "error" });
    }
  },
  fail: () => set({ status: "error" }),
  reset: () => set({ status: "idle", parts: [], scenes: [], warnings: [] }),
  updateScene: (sceneId, update) =>
    set((s) => ({
      scenes: s.scenes.map((sc) => (sc.sceneId === sceneId ? update(sc) : sc)),
    })),
  updateAsset: (assetId, update) =>
    set((s) => ({ assets: s.assets.map((a) => (a.assetId === assetId ? update(a) : a)) })),
  removeAsset: (assetId) =>
    set((s) => ({ assets: s.assets.filter((a) => a.assetId !== assetId) })),
}));
