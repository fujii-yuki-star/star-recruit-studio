// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Scene } from "../../domain/project/types";
import { PreviewScreen } from "./PreviewScreen";

// #465 レビュー P1：仕上がり確認の全体音量スライダーは §6 の解決順で「個別設定＞全体既定」。いまの場面が
// 個別の声量/BGM を持つとき、全体スライダーを動かしてもその場面の音は変わらないため、その場面だけ無効化し
// 理由＋「場面を直す」導線を出す（設定できるのに効かない誤認を防ぐ）。声・BGM は別個に判定する（利用者決定）。
function baseScene(over: Partial<Scene>): Scene {
  return {
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "photo_intro",
    templateId: "photo_left_text_right_yuko_v1",
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" }, warnings: [],
    ...over,
  } as unknown as Scene;
}

function renderWithScene(scene: Scene) {
  useProjectStore.getState().setExportRun({ phase: "idle" });
  useProjectStore.getState().newProject();
  useProjectStore.setState({
    templates: sampleTemplates,
    parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
    scenes: [scene],
    status: "ready", // 自動生成（autoGenerateIfSafe）を発火させない＝この場面が差し替えられない（#620）
    saveStatus: "saved",
  });
  // 全体BGMを「入れる」にしておく（BGM音量スライダーが描画される）。曲は BgmPicker の初期化で既定が入る。
  useProjectStore.getState().updateBgmSettings({ enabled: true });
  return render(<PreviewScreen onNavigate={vi.fn()} />);
}

const narInput = (c: HTMLElement) => c.querySelector("#narrationVolume") as HTMLInputElement | null;
const bgmInput = (c: HTMLElement) => c.querySelector("#bgmVolume") as HTMLInputElement | null;

describe("PreviewScreen 個別音量の場面では全体スライダーを無効化（#465 レビュー P1）", () => {
  beforeEach(() => useProjectStore.getState().setExportRun({ phase: "idle" }));

  it("個別設定なしの場面：声・BGM とも操作できる（無効化されない）", () => {
    const { container, queryByText } = renderWithScene(baseScene({}));
    expect(narInput(container)?.disabled).toBe(false);
    expect(bgmInput(container)?.disabled).toBe(false);
    expect(queryByText(/個別の声量/)).toBeNull();
    expect(queryByText(/個別のBGM/)).toBeNull();
  });

  it("声だけ個別の場面：声スライダーは無効化＋理由、BGM は操作できる（別個に判定）", () => {
    const { container, queryByText } = renderWithScene(baseScene({ audioMix: { narrationVolume: 0.5 } } as Partial<Scene>));
    expect(narInput(container)?.disabled).toBe(true); // 個別の声量＝全体では変えられない
    expect(queryByText(/個別の声量/)).not.toBeNull(); // 理由＋「場面を直す」導線
    expect(bgmInput(container)?.disabled).toBe(false); // BGM は個別でない＝操作可
  });

  it("BGM だけ個別の場面：BGM は無効化＋理由、声は操作できる（別個に判定）", () => {
    const { container, queryByText } = renderWithScene(baseScene({ bgmSettings: { enabled: false } } as Partial<Scene>));
    expect(bgmInput(container)?.disabled).toBe(true); // 個別のBGM＝全体では変えられない
    expect(queryByText(/個別のBGM/)).not.toBeNull();
    expect(narInput(container)?.disabled).toBe(false); // 声は個別でない＝操作可
  });
});
