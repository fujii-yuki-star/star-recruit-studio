import { beforeEach, describe, expect, it, vi } from "vitest";

// projectFs をモックしてディスクI/Oを避け、保存の完了タイミングを制御する（#256 レビュー🔴の並行保存を検証）。
// vi.mock はホイストされるため、モックとその制御状態は vi.hoisted で用意する。
const h = vi.hoisted(() => {
  const state: { resolve: (() => void) | null } = { resolve: null };
  const saveProjectDocMock = vi.fn(() => new Promise<void>((res) => { state.resolve = res; }));
  return { state, saveProjectDocMock };
});
vi.mock("../../infrastructure/projectFs", () => ({
  saveProjectDoc: h.saveProjectDocMock,
  listProjectSummaries: vi.fn(async () => []),
  setLastProjectId: vi.fn(),
  getLastProjectId: vi.fn(() => null),
  clearLastProjectId: vi.fn(),
  deleteProjectDoc: vi.fn(),
  loadProjectDoc: vi.fn(async () => ""),
}));

import { useProjectStore } from "./projectStore";
import type { Scene } from "../../domain/project/types";

const scene = (id: string): Scene => ({
  sceneId: id, partId: "part_001", order: 1, sceneType: "photo_intro", templateId: "t",
  durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" },
  texts: {}, narration: { text: "", status: "none" }, warnings: [],
});
const flush = () => new Promise((r) => setTimeout(r, 0)); // マイクロタスクを流す

describe("saveProject 多重起動ガード（#256 レビュー🔴・進行中の保存を共有）", () => {
  beforeEach(() => {
    h.saveProjectDocMock.mockClear();
    h.state.resolve = null;
    useProjectStore.setState({
      parts: [{ partId: "part_001", title: "p", order: 1, sceneIds: ["scene_001"] }],
      scenes: [scene("scene_001")],
      assets: [],
      meta: { ...useProjectStore.getState().meta, projectId: "" },
      saveStatus: "idle",
    });
  });

  it("並行呼び出しは進行中の保存の完了を待ち、await 後は projectId が確定する（早期 return では未確定になる）", async () => {
    const p1 = useProjectStore.getState().saveProject();
    const p2 = useProjectStore.getState().saveProject(); // 進行中＝同じ保存を待つ（新規保存を始めない）
    await flush(); // 保存書き込み手前まで進める
    expect(h.saveProjectDocMock).toHaveBeenCalledTimes(1); // 二重に書き込まない
    h.state.resolve?.(); // 保存を完了させる
    await Promise.all([p1, p2]);
    const st = useProjectStore.getState();
    expect(st.saveStatus).toBe("saved");
    expect(st.meta.projectId).not.toBe(""); // 新規でも保存完了で projectId が確定（書き出し前保存の前提）
  });

  it("保存完了後の再保存は新しい保存を開始できる（in-flight がクリアされる）", async () => {
    const p1 = useProjectStore.getState().saveProject();
    await flush();
    h.state.resolve?.();
    await p1;
    expect(h.saveProjectDocMock).toHaveBeenCalledTimes(1);
    // 追加の編集で未保存に戻し、もう一度保存＝2回目の書き込みが走る。
    useProjectStore.setState({ saveStatus: "idle" });
    const p2 = useProjectStore.getState().saveProject();
    await flush();
    h.state.resolve?.();
    await p2;
    expect(h.saveProjectDocMock).toHaveBeenCalledTimes(2);
  });
});
