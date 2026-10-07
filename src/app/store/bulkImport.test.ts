// まとめて取り込みの**回し方**（#1024 ③／PR #1034 レビュー 🔴）。
//
// ⚠️ **store を通さずに直接叩く**＝この回し方は2つの形式が共有しているので、
// 「どちらかの store では通っているが、もう片方では通っていない」を作らない。
import { describe, expect, it, vi } from "vitest";
import { runBulkImport, type BulkImportPort } from "./bulkImport";
import { IMPORT_BUSY_MESSAGE, importCancelledMessage, importPartlyFailedMessage } from "../uiLabels";

/** 取り込みの成否を筋書きで与える台（`null`＝成功・文字列＝その理由で失敗）。 */
function stub(results: (string | null)[], opts: { cancelAt?: number; busyAt?: number } = {}) {
  const state = { importError: null as string | null, isImporting: false, seq: 0 };
  const progress: ({ done: number; total: number } | null)[] = [];
  let n = 0;
  const port: BulkImportPort = {
    isImporting: () => state.isImporting,
    importError: () => state.importError,
    setImportError: (m) => { state.importError = m; },
    setProgress: (p) => { progress.push(p); },
    runSeq: () => state.seq,
    importOne: async () => {
      const i = n++;
      state.importError = results[i] ?? null;
      // 「この件を運び終えた直後」に起きることを再現する（中止・横取り）。
      if (opts.cancelAt === i) state.seq += 1;
      if (opts.busyAt === i) state.isImporting = true;
    },
  };
  return { port, state, progress, count: () => n };
}

describe("runBulkImport（まとめて取り込みの回し方）", () => {
  it("全部成功したら、何も言わない", async () => {
    const t = stub([null, null, null]);
    await runBulkImport(t.port, ["a.png", "b.png", "c.png"]);
    expect(t.count()).toBe(3);
    expect(t.state.importError).toBeNull();
  });

  it("中止されたら、次の1件へ進まない（入ったものは残す・件数を言う）", async () => {
    const t = stub([null, null, null], { cancelAt: 0 });
    await runBulkImport(t.port, ["a.png", "b.png", "c.png"]);
    expect(t.count(), "中止したのに次の1件へ進んだ").toBe(1);
    expect(t.state.importError).toBe(importCancelledMessage(1));
  });

  it("中止までに失敗した分は、入った件数から差し引く", async () => {
    const t = stub(["読めません", null, null], { cancelAt: 1 });
    await runBulkImport(t.port, ["a.png", "b.png", "c.png"]);
    expect(t.count()).toBe(2);
    expect(t.state.importError).toBe(importCancelledMessage(1));
  });

  it("1件だけ失敗したら、その理由をそのまま出す（単発と同じ文言）", async () => {
    const t = stub([null, "読めません"]);
    await runBulkImport(t.port, ["a.png", "b.png"]);
    expect(t.state.importError).toBe("読めません");
  });

  it("2件以上失敗したら、入らなかったものを名前で挙げる", async () => {
    const t = stub(["読めません", "大きすぎます"]);
    await runBulkImport(t.port, ["a.png", "b.png"]);
    expect(t.state.importError).toBe(importPartlyFailedMessage(["a.png", "b.png"], "読めません"));
  });

  it("横取りされたら、残りを「入らなかったもの」として挙げる（成功に数えない）", async () => {
    const t = stub([null, null, null], { busyAt: 0 });
    await runBulkImport(t.port, ["a.png", "b.png", "c.png"]);
    expect(t.count()).toBe(1);
    expect(t.state.importError).toBe(importPartlyFailedMessage(["b.png", "c.png"], IMPORT_BUSY_MESSAGE));
  });

  it("1件だけのときは進み具合を出さない（一瞬出て消える表示にしない）", async () => {
    const t = stub([null]);
    await runBulkImport(t.port, ["a.png"]);
    expect(t.progress).toEqual([null]); // 終わりの片づけだけ
  });

  it("まとめてのときは何件目かを出し、終わったら片づける", async () => {
    const t = stub([null, null]);
    await runBulkImport(t.port, ["a.png", "b.png"]);
    expect(t.progress).toEqual([{ done: 0, total: 2 }, { done: 1, total: 2 }, { done: 2, total: 2 }, null]);
  });

  it("途中で例外が出ても進み具合は片づける（出しっぱなしにしない）", async () => {
    const t = stub([null]);
    t.port.importOne = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(runBulkImport(t.port, ["a.png", "b.png"])).rejects.toThrow("boom");
    expect(t.progress[t.progress.length - 1]).toBeNull();
  });
});
