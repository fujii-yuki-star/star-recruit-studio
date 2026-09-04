// @vitest-environment jsdom
// まとめて取り込みを中止できる（#1024 ③）。
//
// ⚠️ **「やめられるか」が操作で割れていた**＝書き出しと声には中止があるのに、
// 取り込みだけ**打ち切る入口が無かった**（大きな動画を10件入れたら終わるまで待つしかない）。
//
// ⚠️ **入ったものは残す**＝取り消しではない。いま運んでいる1件も止まらない
// （IPC の往復は途中で切れない）ので、そこまでは入る。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "./projectStore";
import { importCancelledMessage } from "../uiLabels";
import { resetAssetIdReservations } from "./assetImport";

beforeEach(() => {
  vi.restoreAllMocks();
  resetAssetIdReservations();
  useProjectStore.getState().setExportRun({ phase: "idle" });
  useProjectStore.getState().newProject();
});

/** 1件ずつ取り込む代わりに、呼ばれた回数を数える（実ファイルは触らない）。 */
function stubAddAsset(onEach?: (n: number) => void) {
  let n = 0;
  useProjectStore.setState({
    addAssetByPath: vi.fn(async (path: string) => {
      n += 1;
      onEach?.(n);
      useProjectStore.setState((s) => ({
        assets: [...s.assets, { assetId: `asset_${String(n).padStart(3, "0")}`, assetType: "image", displayName: path, filePath: path } as never],
        importError: null,
      }));
    }),
  } as never);
  return () => n;
}

describe("まとめて取り込みの中止（#1024 ③）", () => {
  it("中止すると、次の1件へ進まない", async () => {
    // 2件目を運んでいる最中に中止する。
    const count = stubAddAsset((n) => {
      if (n === 2) useProjectStore.getState().cancelAssetImport();
    });
    await useProjectStore.getState().addAssets(["a.png", "b.png", "c.png", "d.png"]);
    expect(count(), "中止したのに残りまで取り込んでいる").toBe(2);
  });

  // ⚠️ **入ったものは残す**（§2-5＝途中まで入れた素材を黙って捨てない）。
  it("中止しても、入ったものは残る", async () => {
    stubAddAsset((n) => { if (n === 2) useProjectStore.getState().cancelAssetImport(); });
    await useProjectStore.getState().addAssets(["a.png", "b.png", "c.png"]);
    expect(useProjectStore.getState().assets).toHaveLength(2);
  });

  // ⚠️ **中止は「失敗」ではない**＝何件入ったかと、もう一度できることを言う。
  it("中止したことと、入った件数を知らせる", async () => {
    stubAddAsset((n) => { if (n === 2) useProjectStore.getState().cancelAssetImport(); });
    await useProjectStore.getState().addAssets(["a.png", "b.png", "c.png"]);
    expect(useProjectStore.getState().importError).toBe(importCancelledMessage(2));
  });

  it("中止しなければ、全部取り込む", async () => {
    const count = stubAddAsset();
    await useProjectStore.getState().addAssets(["a.png", "b.png", "c.png"]);
    expect(count()).toBe(3);
    expect(useProjectStore.getState().importError).toBeNull();
  });

  // ⚠️ **前回の中止を持ち越さない**＝始めるときに印を下ろす。
  it("次に取り込みを始めると、中止の印は下りる", async () => {
    stubAddAsset((n) => { if (n === 1) useProjectStore.getState().cancelAssetImport(); });
    await useProjectStore.getState().addAssets(["a.png", "b.png"]);
    expect(useProjectStore.getState().importCancelled).toBe(true);
    stubAddAsset();
    await useProjectStore.getState().addAssets(["c.png"]);
    expect(useProjectStore.getState().importCancelled, "前回の中止を持ち越している").toBe(false);
  });
});

describe("importCancelledMessage（#1024 ③）", () => {
  it("入ったものがあれば件数を言い、次の行動を添える", () => {
    expect(importCancelledMessage(3)).toContain("3件は入っています");
    expect(importCancelledMessage(3)).toContain("もう一度");
  });

  // ⚠️ **0件のときに「0件は入っています」と言わない**（数えた結果が嘘に見える）。
  it("1件も入っていなければ、そう言う", () => {
    expect(importCancelledMessage(0)).toContain("まだ何も入っていません");
    expect(importCancelledMessage(0)).not.toMatch(/0件/);
  });
});
