// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import type { ProjectHeader } from "../../domain/project/persistence";
import { HomeScreen } from "./HomeScreen";

/**
 * 複製と開くは**互いに止め合う**（α-6 出口監査 🟡32）。
 *
 * ⚠️ **片側しか止めていなかった**＝素材と声のコピー中に別の動画を開けると**後勝ち**になり、
 * 複製の着地が別の文書へ落ちる。逆向き（開いている最中の複製）は**黙って no-op** で、
 * 押しても何も起きなかった（§2-5＝押せない理由を押す前に出す）。
 */
describe("HomeScreen 複製と開くの相互ロック（🟡32）", () => {
  afterEach(() => vi.restoreAllMocks());

  const TWO = [
    { projectId: "proj_001", projectName: "1本目", updatedAt: "2026-08-29T00:00:00Z" },
    { projectId: "proj_002", projectName: "2本目", updatedAt: "2026-08-29T00:00:00Z" },
  ];

  /** 解決しない Promise を返す＝「走っている最中」を作る。 */
  function setupPending(kind: "open" | "duplicate") {
    const pending = new Promise<never>(() => {});
    useProjectStore.setState({
      listProjects: vi.fn(() => Promise.resolve(TWO as unknown as ProjectHeader[])),
      loadProject: vi.fn(() => (kind === "open" ? pending : Promise.resolve())),
      duplicateProject: vi.fn(() => (kind === "duplicate" ? pending : Promise.resolve("proj_003"))),
      saveStatus: "saved",
      scenes: [],
      assets: [],
    } as never);
  }

  /** カード全体が「開く」ボタン（名前ではなく中身の文字から辿る＝複製ボタンと区別する）。 */
  const openBtn = (name: string) => screen.getByText(name).closest("button") as HTMLButtonElement;
  const dupBtn = (name: string) => screen.getByRole("button", { name: `「${name}」を複製` });

  it("開いている最中は、複製を押せない（理由も出す）", async () => {
    setupPending("open");
    render(<HomeScreen onNavigate={vi.fn()} />);
    await screen.findByText("1本目");
    fireEvent.click(openBtn("1本目"));
    await waitFor(() => expect(dupBtn("2本目")).toBeDisabled());
    expect(dupBtn("2本目")).toHaveAttribute("title", "プロジェクトを開いています…");
  });

  it("コピーしている最中は、別の動画を開けない（理由も出す）", async () => {
    setupPending("duplicate");
    render(<HomeScreen onNavigate={vi.fn()} />);
    await screen.findByText("1本目");
    fireEvent.click(dupBtn("1本目"));
    await waitFor(() => expect(openBtn("2本目")).toBeDisabled());
    expect(openBtn("2本目")).toHaveAttribute("title", "コピーしています…");
  });


  /**
   * ⚠️ **進み具合を出す**（α-6 出口監査 ℹ️）＝素材と声のコピーは時間がかかるのに「開いています…」
   * だけがあり、複製は**押しても何も変わらないように見えた**。
   */
  it("コピー中はその行に進み具合を出す", async () => {
    setupPending("duplicate");
    render(<HomeScreen onNavigate={vi.fn()} />);
    await screen.findByText("1本目");
    fireEvent.click(dupBtn("1本目"));
    await waitFor(() => expect(screen.getByText("コピーしています…")).toBeInTheDocument());
  });
});
