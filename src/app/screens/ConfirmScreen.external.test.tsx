// @vitest-environment jsdom
// 送らないのに「送信してよい内容か」と聞かない（#995 ④）。
//
// ⚠️ **同じ概念の挙動が経路で割れていた**（ADR-0026②）＝たたき台の「作り直す」は
// `willSendExternally()` を見て、外部送信でなければ確認画面を**飛ばす**のに、
// ウィザードの最終段は**常に**ここへ来る。既定（Mock）では**何も送っていない**のに
// 「ゆうこに渡して」「送信してよい内容か」が出ていた。
//
// ⚠️ **確認そのものは残す**（§2-6＝外部送信は事前確認必須）＝変えるのは**言い方**だけ。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ConfirmScreen } from "./ConfirmScreen";
import { useProjectStore } from "../store/projectStore";
import * as ai from "../../infrastructure/aiClient";

beforeEach(() => {
  vi.restoreAllMocks();
  useProjectStore.getState().setExportRun({ phase: "idle" });
  useProjectStore.getState().newProject();
});

describe("送信前確認の言い方が、実際に送るかで変わる（#995 ④）", () => {
  it("外へ送るときは、送る前提で言い、個人情報の注意も出す", async () => {
    vi.spyOn(ai, "willSendExternally").mockResolvedValue(true);
    render(<ConfirmScreen onNavigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/ゆうこに渡して/)).toBeInTheDocument());
    expect(screen.getByText(/送信してよい内容か/)).toBeInTheDocument();
  });

  it("送らないときは、送る前提の言い方も個人情報の注意も出さない", async () => {
    vi.spyOn(ai, "willSendExternally").mockResolvedValue(false);
    render(<ConfirmScreen onNavigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/外へ送られることはありません/)).toBeInTheDocument());
    expect(screen.queryByText(/ゆうこに渡して/), "送らないのに「渡して」と言っている").toBeNull();
    expect(screen.queryByText(/送信してよい内容か/), "送らないのに送信の確認を出している").toBeNull();
  });

  // ⚠️ **判定できないうちは「送る」側**＝先に「送りません」と見せると、
  // 実際は送る場合に**注意を読ませないまま通す**（安全側に倒す）。
  it("判定できないときは、送る側の言い方にする", async () => {
    vi.spyOn(ai, "willSendExternally").mockRejectedValue(new Error("x"));
    render(<ConfirmScreen onNavigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/送信してよい内容か/)).toBeInTheDocument());
  });

  it("答えが返る前も、送る側の言い方で待つ", () => {
    vi.spyOn(ai, "willSendExternally").mockReturnValue(new Promise(() => {})); // 返らない
    render(<ConfirmScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/送信してよい内容か/)).toBeInTheDocument();
  });
});
