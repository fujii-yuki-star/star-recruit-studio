// @vitest-environment jsdom
// #396（画面側）：`console.warn`/`console.error` は配布版では**どこにも残らない**ので、
// うまくいかないときの記録へ流す。⚠️ **1か所ずつ書き換えない**＝37 か所に散っており、
// 足し忘れた所だけ記録が残らない（これから増える分も自動で乗る形にする）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { invoke } from "@tauri-apps/api/core";

let origWarn: typeof console.warn;
let origError: typeof console.error;
let origLog: typeof console.log;

describe("画面側の技術詳細も記録へ流す（#396）", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.mocked(invoke).mockResolvedValue(undefined);
    origWarn = console.warn; origError = console.error; origLog = console.log;
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    const mod = await import("./troubleLogBridge");
    mod.installTroubleLogBridge();
  });
  afterEach(() => {
    console.warn = origWarn; console.error = origError; console.log = origLog;
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it("warn を記録へ流す", () => {
    console.warn("[asset] 読み込み失敗", 42);
    expect(invoke).toHaveBeenCalledWith("trouble_log_record", { tag: "ui:warn", detail: "[asset] 読み込み失敗 42" });
  });

  it("error も流す（種別が分かる）", () => {
    console.error("こわれた");
    expect(invoke).toHaveBeenCalledWith("trouble_log_record", { tag: "ui:error", detail: "こわれた" });
  });

  // ⚠️ **`log` は流さない**＝普段の動きの実況を混ぜると、肝心の失敗が埋もれる。
  it("log は流さない", () => {
    console.log("ふつうの実況");
    expect(invoke).not.toHaveBeenCalled();
  });

  // ⚠️ **`Error` は名前も残す**＝message だけだと何の失敗か分からない。
  it("Error は名前つきで残す", () => {
    console.error(new TypeError("だめ"));
    expect(invoke).toHaveBeenCalledWith("trouble_log_record", { tag: "ui:error", detail: "TypeError: だめ" });
  });

  // ⚠️ **元の出力は必ず出す**＝開発中の見え方を変えない。
  it("元の console も呼ぶ", async () => {
    // 包む**前**に見張りを置いてから仕掛け直す（実装は仕掛けた時点の関数を控える）。
    vi.resetModules();
    const spy = vi.fn();
    console.warn = spy;
    const mod = await import("./troubleLogBridge");
    mod.installTroubleLogBridge();
    console.warn("出るはず");
    expect(spy).toHaveBeenCalledWith("出るはず");
  });

  // ⚠️ **記録に失敗しても `console` を壊さない**＝記録は「あると助かる」もので、
  // それが呼び出し側の処理を止める理由にはならない。
  it("記録が投げても console は普通に出る", async () => {
    vi.resetModules();
    const spy = vi.fn();
    console.warn = spy;
    vi.mocked(invoke).mockImplementation(() => { throw new Error("記録できない"); });
    const mod = await import("./troubleLogBridge");
    mod.installTroubleLogBridge();
    expect(() => console.warn("それでも出る")).not.toThrow();
    expect(spy).toHaveBeenCalledWith("それでも出る");
  });

  // ⚠️ **二重に包まない**＝包むたびに1回の出力が2件・4件と増える。
  it("二度仕掛けても1件しか流れない", async () => {
    const mod = await import("./troubleLogBridge");
    mod.installTroubleLogBridge();
    console.warn("いちど");
    expect(vi.mocked(invoke).mock.calls.filter((c) => c[0] === "trouble_log_record")).toHaveLength(1);
  });
});
