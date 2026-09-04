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
  // ⚠️ **素材を1つ置く**＝「文字情報を確認する」は送る文字があるときだけ出るので、
  // 置かないと**その言い方を一度も見ないまま緑**になる。
  useProjectStore.setState({
    assets: [
      { assetId: "asset_001", assetType: "image", displayName: "会社の外観.jpg", filePath: "assets/asset_001.jpg" },
    ] as never,
  });
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
    // ⚠️ 2か所（説明文と強調ボックス）で言うので、`getAllByText` で受ける。
    await waitFor(() => expect(screen.getAllByText(/外へ送られることはありません/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/ゆうこに渡して/), "送らないのに「渡して」と言っている").toBeNull();
    expect(screen.queryByText(/送信してよい内容か/), "送らないのに送信の確認を出している").toBeNull();
  });

  // ⚠️ **画面ぜんぶの言い方を見る**（PR #1027 レビュー 🔴）＝最初は説明文と個人情報の注意しか
  // 直しておらず、**「送る文字情報を確認する」「ゆうこに渡します」「送信して動画案を作る」**が
  // 残っていた（とくに最後は**いちばん目立つ主ボタン**＝この画面で直したはずのことが残る）。
  it("送るときは、画面ぜんぶが送る前提で言う", async () => {
    vi.spyOn(ai, "willSendExternally").mockResolvedValue(true);
    render(<ConfirmScreen onNavigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /送信して動画案を作る/ })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "送る文字情報を確認する" })).toBeInTheDocument();
    expect(screen.getByText(/ゆうこに渡します/)).toBeInTheDocument();
  });

  it("送らないときは、画面のどこにも「送る」前提の言い方が残らない", async () => {
    vi.spyOn(ai, "willSendExternally").mockResolvedValue(false);
    const { container } = render(<ConfirmScreen onNavigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /この内容で動画案を作る/ })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "使う文字情報を確認する" })).toBeInTheDocument();
    expect(screen.queryByText(/ゆうこに渡します/), "送らないのに「渡します」と言っている").toBeNull();
    // ⚠️ **画面まるごとで見る**＝直し漏れた1か所を、文言ごとに書き並べても見つけられない。
    expect(container.textContent, "送らないのに「送信」と書いてある所が残っている").not.toMatch(/送信/);
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
