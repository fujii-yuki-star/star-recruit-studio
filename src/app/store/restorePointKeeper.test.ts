import { afterEach, describe, expect, it, vi } from "vitest";
import * as projectFs from "../../infrastructure/projectFs";
import { RESTORE_POINT_MAX, RESTORE_POINT_MIN_INTERVAL_MS } from "../../domain/project/restorePoints";
import { keepRestorePoints, loadRestorePoints } from "./restorePointKeeper";

const at = (savedAt: number) => ({ name: `p-${savedAt}.json`, savedAt });

describe("keepRestorePoints（#263 段階2）", () => {
  afterEach(() => vi.restoreAllMocks());

  it("1つも無ければ作る", async () => {
    vi.spyOn(projectFs, "listRestorePoints").mockResolvedValue([]);
    const take = vi.spyOn(projectFs, "takeRestorePoint").mockResolvedValue(undefined);
    await keepRestorePoints("proj_001", 1000);
    expect(take).toHaveBeenCalledWith("proj_001", 1000);
  });

  it("最短の間隔より近い保存では作らない（自動保存のたびに溜めない）", async () => {
    const now = 10_000_000;
    vi.spyOn(projectFs, "listRestorePoints").mockResolvedValue([at(now - 1000)]);
    const take = vi.spyOn(projectFs, "takeRestorePoint").mockResolvedValue(undefined);
    const drop = vi.spyOn(projectFs, "dropRestorePoint").mockResolvedValue(undefined);
    await keepRestorePoints("proj_001", now);
    expect(take).not.toHaveBeenCalled();
    expect(drop).not.toHaveBeenCalled(); // 作らないときは片づけもしない
  });

  it("上限を超えたら、古いほうから落としてから作る", async () => {
    const now = 10_000_000;
    const points = Array.from({ length: RESTORE_POINT_MAX }, (_, i) => at(i * 1000));
    vi.spyOn(projectFs, "listRestorePoints").mockResolvedValue(points);
    const drop = vi.spyOn(projectFs, "dropRestorePoint").mockResolvedValue(undefined);
    const take = vi.spyOn(projectFs, "takeRestorePoint").mockResolvedValue(undefined);
    await keepRestorePoints("proj_001", now);
    expect(drop).toHaveBeenCalledWith("proj_001", "p-0.json"); // いちばん古いもの
    // ⚠️ **落としてから作る**（作ってから消すと一瞬だけ上限を超える）。
    expect(drop.mock.invocationCallOrder[0]).toBeLessThan(take.mock.invocationCallOrder[0]);
  });

  it("控えられなくても保存は止めない（投げない）", async () => {
    vi.spyOn(projectFs, "listRestorePoints").mockRejectedValue(new Error("むり"));
    await expect(keepRestorePoints("proj_001", 1000)).resolves.toBeUndefined();
  });

  it("間隔ちょうどでは作る（境界）", async () => {
    const now = 10_000_000;
    vi.spyOn(projectFs, "listRestorePoints").mockResolvedValue([at(now - RESTORE_POINT_MIN_INTERVAL_MS)]);
    const take = vi.spyOn(projectFs, "takeRestorePoint").mockResolvedValue(undefined);
    await keepRestorePoints("proj_001", now);
    expect(take).toHaveBeenCalled();
  });
});

describe("loadRestorePoints", () => {
  afterEach(() => vi.restoreAllMocks());

  it("新しい順で返す（戻りたいのはたいてい直前の状態）", async () => {
    vi.spyOn(projectFs, "listRestorePoints").mockResolvedValue([at(1), at(3), at(2)]);
    expect((await loadRestorePoints("proj_001")).map((p) => p.savedAt)).toEqual([3, 2, 1]);
  });
});
