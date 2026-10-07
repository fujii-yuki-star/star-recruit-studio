// 戻す操作が、**走っている保存の着地**に潰されないこと（α-7 出口監査 🔴）。
//
// ⚠️ `_doSave` は「まだ同じ文書か」を**書き込みの後**でしか見ない＝待たずに戻すと、
// **戻した `project.json` を戻す前の内容で上書き**する（何も言われずに復元が無かったことになる）。
// ⚠️ 画面の未保存確認も、`saveStatus === "saving"` の間は false になるので**素通り**する。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "./projectStore";
import * as keeper from "./restorePointKeeper";

// ⚠️ **差し替えた `_doSave` は `restoreAllMocks` では戻らない**（`setState` なので）＝
// 戻さないと、後のテストが**前のテストの止まった保存**を待って固まる（実際に固まった）。
const 本物の保存 = useProjectStore.getState()._doSave;

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

// ⚠️ **戻した後、開いていた文書を持ち続けない**（α-7 再監査 🔴）。
//
// 印（`_docEpoch`）を進めるだけでは足りなかった＝`_doSave` は書き込みの**後**でしか印を見ないので、
// **ディスクへは書かれていた**。しかも知らせに「あとで開く」を足した時点で、
// **開き直さずに編集へ帰る道**ができ、次の保存が戻した内容を上書きした。
describe("戻したら、開いていた文書を手放す（α-7 再監査 🔴）", () => {
  beforeEach(() => useProjectStore.setState({ _doSave: 本物の保存 }));
  afterEach(() => vi.restoreAllMocks());

  it("開いていた動画を戻すと、その動画を持たなくなる", async () => {
    vi.spyOn(keeper, "restoreToPoint").mockResolvedValue(0);
    useProjectStore.setState({ meta: { ...useProjectStore.getState().meta, projectId: "proj_20260901_001" } });
    await useProjectStore.getState().restoreToRestorePoint("proj_20260901_001", "p-1.json");
    expect(useProjectStore.getState().meta.projectId).not.toBe("proj_20260901_001");
  });

  it("開いていない動画を戻しても、いま開いている動画は閉じない", async () => {
    // ⚠️ **巻き添えにしない**＝一覧から別の動画を戻しただけで、編集中の動画が閉じたら作業が飛ぶ。
    vi.spyOn(keeper, "restoreToPoint").mockResolvedValue(0);
    useProjectStore.setState({ meta: { ...useProjectStore.getState().meta, projectId: "proj_20260901_002" } });
    await useProjectStore.getState().restoreToRestorePoint("proj_20260901_001", "p-1.json");
    expect(useProjectStore.getState().meta.projectId).toBe("proj_20260901_002");
  });

  it("書き込みの前にも「まだ同じ文書か」を見る（手放した後は書かない）", async () => {
    // ⚠️ **これが本体**＝手放しても、書き込みが後ろの門しか通らないなら上書きは止まらない。
    const fs = await import("../../infrastructure/projectFs");
    const save = vi.spyOn(fs, "saveProjectDoc").mockResolvedValue("");
    vi.spyOn(keeper, "keepRestorePoints").mockImplementation(async () => {
      // 保存の途中（控えを取っている最中）に手放される＝待っている間に起きうる。
      useProjectStore.getState().newProject();
    });
    useProjectStore.setState({ meta: { ...useProjectStore.getState().meta, projectId: "proj_20260901_003" } });
    await useProjectStore.getState().saveProject();
    expect(save).not.toHaveBeenCalled();
  });
});

// ⚠️ **両方の形式の受け手に手放させる**（#977）。
// もとは場面形式だけを手放し、場面形式の保存だけを待っていた＝タイムライン形式は
// **待たれも手放されもしない**ので、走っている保存の着地が戻した内容を上書きした。
describe("戻すときは、両方の形式へ手放させる（#977）", () => {
  beforeEach(() => useProjectStore.setState({ _doSave: 本物の保存 }));
  afterEach(() => vi.restoreAllMocks());

  it("タイムライン形式の受け手にも知らせる（着地を待つ）", async () => {
    vi.spyOn(keeper, "restoreToPoint").mockResolvedValue(0);
    const deletion = await import("./projectDeletion");
    const heard: string[] = [];
    const off = deletion.onProjectDeleted((id) => { heard.push(id); return undefined; });
    await useProjectStore.getState().restoreToRestorePoint("proj_20260901_007", "p-1.json");
    off();
    expect(heard).toEqual(["proj_20260901_007"]);
  });

  it("別の形式が書き出している間は戻さない", async () => {
    const restore = vi.spyOn(keeper, "restoreToPoint").mockResolvedValue(0);
    const lock = await import("./exportLock");
    lock.useExportLockStore.getState().acquire("timeline");
    expect(await useProjectStore.getState().restoreToRestorePoint("proj_20260901_008", "p-1.json")).toBe(0);
    expect(restore).not.toHaveBeenCalled();
    lock.useExportLockStore.getState().release("timeline");
  });

  it("自分の形式が書き出していない・錠も空いていれば戻す", async () => {
    const restore = vi.spyOn(keeper, "restoreToPoint").mockResolvedValue(0);
    await useProjectStore.getState().restoreToRestorePoint("proj_20260901_009", "p-1.json");
    expect(restore).toHaveBeenCalled();
  });
});

// ⚠️ **戻せなかったら、手放した相手を戻す**（#980 レビュー 🟡）。
// 手放しを先にやる以上、失敗したときに戻さないと**一覧には動画が残るのに編集画面だけ空**になる。
describe("戻せなかったときの後始末（#980 レビュー 🟡）", () => {
  beforeEach(() => useProjectStore.setState({ _doSave: 本物の保存 }));
  afterEach(() => vi.restoreAllMocks());

  it("失敗したら、手放した受け手を戻す", async () => {
    vi.spyOn(keeper, "restoreToPoint").mockRejectedValue(new Error("戻せない"));
    const deletion = await import("./projectDeletion");
    let restored = 0;
    const off = deletion.onProjectDeleted(() => ({ restore: () => { restored += 1; } }));
    await expect(
      useProjectStore.getState().restoreToRestorePoint("proj_20260901_010", "p-1.json"),
    ).rejects.toThrow();
    off();
    expect(restored).toBe(1);
  });

  it("成功したときは戻さない（答える前に画面を変えない）", async () => {
    vi.spyOn(keeper, "restoreToPoint").mockResolvedValue(0);
    const deletion = await import("./projectDeletion");
    let restored = 0;
    const off = deletion.onProjectDeleted(() => ({ restore: () => { restored += 1; } }));
    await useProjectStore.getState().restoreToRestorePoint("proj_20260901_011", "p-1.json");
    off();
    expect(restored).toBe(0);
  });
});
