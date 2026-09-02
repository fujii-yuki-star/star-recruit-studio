// 戻す操作が、**走っている保存の着地**に潰されないこと（α-7 出口監査 🔴）。
//
// ⚠️ `_doSave` は「まだ同じ文書か」を**書き込みの後**でしか見ない＝待たずに戻すと、
// **戻した `project.json` を戻す前の内容で上書き**する（何も言われずに復元が無かったことになる）。
// ⚠️ 画面の未保存確認も、`saveStatus === "saving"` の間は false になるので**素通り**する。
import { afterEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "./projectStore";
import * as keeper from "./restorePointKeeper";

describe("戻す操作は走っている保存を待つ（α-7 出口監査 🔴）", () => {
  afterEach(() => vi.restoreAllMocks());

  it("保存が着地してから戻す（順番が入れ替わらない）", async () => {
    const order: string[] = [];
    let finishSave: (() => void) | null = null;
    // ⚠️ **保存の中身は差し替える**＝ここで見たいのは**順番**であって、保存そのものではない。
    // 実物を走らせると、声の書き出しなど関係ない前処理で止まる。
    useProjectStore.setState({
      _doSave: () => new Promise<void>((resolve) => { finishSave = () => { order.push("保存の着地"); resolve(); }; }),
    });
    const restore = vi.spyOn(keeper, "restoreToPoint").mockImplementation(async () => { order.push("戻す"); return 0; });

    const saving = useProjectStore.getState().saveProject();
    await vi.waitFor(() => expect(finishSave).not.toBeNull());
    // 保存が走っている最中に戻す。
    const restoring = useProjectStore.getState().restoreToRestorePoint("proj_20260901_001", "p-1.json");
    // ⚠️ **まだ戻していない**＝待っているはず。
    await new Promise((r) => setTimeout(r, 20));
    expect(restore).not.toHaveBeenCalled();
    finishSave!();
    await saving;
    await restoring;
    expect(order).toEqual(["保存の着地", "戻す"]);
  });

  it("戻したあとの着地は受け取らない（印を進める）", async () => {
    vi.spyOn(keeper, "restoreToPoint").mockResolvedValue(0);
    useProjectStore.setState({ meta: { ...useProjectStore.getState().meta, projectId: "proj_20260901_001" } });
    const before = useProjectStore.getState()._docEpoch;
    await useProjectStore.getState().restoreToRestorePoint("proj_20260901_001", "p-1.json");
    expect(useProjectStore.getState()._docEpoch).toBe(before + 1);
  });

  it("開いていない動画を戻すときは、印を進めない（関係ない文書を巻き込まない）", async () => {
    vi.spyOn(keeper, "restoreToPoint").mockResolvedValue(0);
    useProjectStore.setState({ meta: { ...useProjectStore.getState().meta, projectId: "proj_20260901_001" } });
    const before = useProjectStore.getState()._docEpoch;
    await useProjectStore.getState().restoreToRestorePoint("proj_20260901_999", "p-1.json");
    expect(useProjectStore.getState()._docEpoch).toBe(before);
  });

  it("書き出し中は戻さない（ほかの入口と揃える）", async () => {
    const restore = vi.spyOn(keeper, "restoreToPoint").mockResolvedValue(0);
    useProjectStore.getState().setExportRun({ phase: "rendering" });
    expect(await useProjectStore.getState().restoreToRestorePoint("proj_20260901_001", "p-1.json")).toBe(0);
    expect(restore).not.toHaveBeenCalled();
    useProjectStore.getState().setExportRun({ phase: "idle" });
  });
});
