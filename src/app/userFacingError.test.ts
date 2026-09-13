// 「画面に出してよい断りか」の関門の検査（#1118 レビュー由来・#1123）。
//
// ⚠️ **両端で正反対のことをしていた**＝一方は `.catch(() => …)` で**中身を全部捨て**、
// もう一方は `e.message` を**無条件で出して**いた。この関門はその真ん中に置く。
import { describe, expect, it, vi, afterEach } from "vitest";
import { userFacingMessage } from "./userFacingError";

afterEach(() => vi.restoreAllMocks());

describe("画面に出してよい断りを見分ける", () => {
  it("日本語で書かれ、句点を持つ文は通す（Rust 側の定数はこの形）", () => {
    expect(userFacingMessage("開こうとしたものが見つかりませんでした。移動または削除されていないかご確認ください。", "t"))
      .toContain("見つかりませんでした");
  });

  it("Tauri は**文字列で**失敗を返す＝`Error` でなくても受ける", () => {
    expect(userFacingMessage(new Error("この動画を扱えませんでした。開き直してください。"), "t")).not.toBeNull();
    expect(userFacingMessage("この動画を扱えませんでした。開き直してください。", "t")).not.toBeNull();
  });

  it("**生の OS エラーは通さない**（`15 §6` が禁じている・#1123）", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(userFacingMessage("os error 3", "t")).toBeNull();
    expect(userFacingMessage(new Error("The system cannot find the path specified. (os error 3)"), "t")).toBeNull();
  });

  it("句点の無い断片は通さない（`format!` で割られた側＝文になっていない）", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(userFacingMessage("不正なプロジェクトIDです", "t")).toBeNull();
  });

  it("空・未知の形は通さない（押しても何も出ない、を作らない側は呼び出し元の定型文）", () => {
    expect(userFacingMessage("", "t")).toBeNull();
    expect(userFacingMessage(undefined, "t")).toBeNull();
    expect(userFacingMessage({ code: 1 }, "t")).toBeNull();
  });

  it("**通さなかった中身は捨てない**＝記録へ流す（`troubleLogBridge` が運ぶ）", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    userFacingMessage("os error 3", "open-video");
    expect(spy).toHaveBeenCalled();
    expect(String(spy.mock.calls[0]?.[0])).toContain("open-video");
    expect(spy.mock.calls[0]?.[1]).toBe("os error 3");
  });

  it("空のときは記録にも流さない（毎回の空振りで記録を埋めない）", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    userFacingMessage("", "t");
    expect(spy).not.toHaveBeenCalled();
  });
});
