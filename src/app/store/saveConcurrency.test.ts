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

  it("**保存中に別の動画へ移ったら、その動画へ id を書き込まない**（別の動画を上書きしない・#762）", async () => {
    // ⚠️ 保存中は「未保存あり」と見なさない＝ホームは**確認なしで別の動画を開ける**。括らないと、
    // 完了の set が**新しい方の meta へ古い projectId を書き込み**、以後その動画の自動保存が
    // **古い方の `project.json` を上書き**する（作業がディスクごと消える・取り消し不能）。
    const p = useProjectStore.getState().saveProject();
    await flush(); // 書き込みの手前まで進める
    // 別の動画を開いた（＝文書が入れ替わった）状態にする。
    useProjectStore.setState({
      _docEpoch: useProjectStore.getState()._docEpoch + 1,
      meta: { ...useProjectStore.getState().meta, projectId: "proj_other" },
      saveStatus: "saved",
    });
    h.state.resolve?.();
    await p;
    const st = useProjectStore.getState();
    expect(st.meta.projectId).toBe("proj_other"); // 開いている方の id を書き替えない
    expect(st.saveStatus).toBe("saved"); // 別の文書の結果を、いまの画面の状態にしない
  });

  it("保存中に別の動画へ移ったら、失敗もその動画へ出さない（#762）", async () => {
    // ⚠️ **失敗させるのは移った後**（すぐ reject すると、移る前に catch が走って
    // 「移ったのに出さない」を見ていない＝空振りになる）。
    let fail: ((e: Error) => void) | null = null;
    h.saveProjectDocMock.mockImplementationOnce(() => new Promise<void>((_res, rej) => { fail = rej; }));
    const p = useProjectStore.getState().saveProject();
    await flush();
    useProjectStore.setState({
      _docEpoch: useProjectStore.getState()._docEpoch + 1,
      meta: { ...useProjectStore.getState().meta, projectId: "proj_other" },
      saveStatus: "saved",
    });
    (fail as unknown as (e: Error) => void)(new Error("disk"));
    await p;
    expect(useProjectStore.getState().saveStatus).toBe("saved"); // 「保存できませんでした」を誤って帰属させない
  });

  it("**新規どうしでも取り違えない**（id ではなく世代で照合する・#762）", async () => {
    // ⚠️ 新規の動画は id を持たない（保存で初めて採番する）＝id で照合すると「どちらも空」で
    // 同じものに見え、**採番した id が別の新規文書へ乗る**。
    const p = useProjectStore.getState().saveProject();
    await flush();
    useProjectStore.getState().newProject(); // もう1つ新規を作った（id はやはり空）
    h.state.resolve?.();
    await p;
    expect(useProjectStore.getState().meta.projectId).toBe(""); // 新しい方へ id を乗せない
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
