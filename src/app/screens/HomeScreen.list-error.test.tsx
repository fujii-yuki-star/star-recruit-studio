// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import type { ProjectSummary } from "../../infrastructure/projectFs";
import { HomeScreen } from "./HomeScreen";

// #547 P2-2：一覧取得の失敗を「保存物なし（空）」と区別する（§2-5・ADR-0026④）。
// 一時失敗で `.catch(()=>{})`→projects=[] にすると、保存したプロジェクトが消えたように見え、原因も次の行動も出ない。
// 失敗時は原因＋「もう一度読み込む」（再試行）を出し、成功したら失敗表示を消して一覧を出す。
describe("HomeScreen 一覧取得の失敗表示と再試行（#547 P2-2）", () => {
  let origList: () => Promise<ProjectSummary[]>;
  const project = (name: string): ProjectSummary => ({ projectId: "proj_001", projectName: name, updatedAt: "2026-07-09T00:00:00Z" });

  beforeEach(() => {
    origList = useProjectStore.getState().listProjects;
  });
  afterEach(() => {
    useProjectStore.setState({ listProjects: origList });
    vi.restoreAllMocks();
  });

  it("取得失敗：原因＋再試行を出し、「保存物なし」の空表示は出さない", async () => {
    useProjectStore.setState({ listProjects: vi.fn(() => Promise.reject(new Error("fs down"))) });
    render(<HomeScreen onNavigate={vi.fn()} />);
    expect(await screen.findByText(/一覧を読み込めませんでした/)).toBeTruthy(); // 原因（§2-5）
    expect(screen.getByText("もう一度読み込む")).toBeTruthy(); // 次の行動（再試行）
    expect(screen.queryByText(/まだありません/)).toBeNull(); // 失敗を「空」と混同しない
  });

  it("再試行が成功：失敗表示が消え、一覧が出る", async () => {
    const list = vi
      .fn<() => Promise<ProjectSummary[]>>()
      .mockRejectedValueOnce(new Error("fs down"))
      .mockResolvedValueOnce([project("復活した動画")]);
    useProjectStore.setState({ listProjects: list });
    render(<HomeScreen onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByText("もう一度読み込む"));
    expect(await screen.findByText("復活した動画")).toBeTruthy(); // 再取得で一覧が出る
    await waitFor(() => expect(screen.queryByText(/読み込めませんでした/)).toBeNull()); // 失敗表示は消える
  });

  it("再試行も失敗：失敗表示のまま＋ボタンは固まらず再度押せる（空表示に化けない）", async () => {
    useProjectStore.setState({ listProjects: vi.fn(() => Promise.reject(new Error("fs down"))) });
    render(<HomeScreen onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByText("もう一度読み込む"));
    await waitFor(() => expect(screen.getByText(/読み込めませんでした/)).toBeTruthy());
    expect(screen.queryByText(/まだありません/)).toBeNull();
    // finally で listRetrying を戻す＝「読み込み中…」で固まらず再度押せる（回帰ガード）。
    const retry = (await screen.findByText("もう一度読み込む")) as HTMLButtonElement;
    expect(retry.disabled).toBe(false);
    expect(screen.queryByText("読み込み中…")).toBeNull();
  });

  it("本当に空（成功して0件）：失敗表示ではなく空の案内を出す", async () => {
    useProjectStore.setState({ listProjects: vi.fn(() => Promise.resolve([])) });
    render(<HomeScreen onNavigate={vi.fn()} />);
    expect(await screen.findByText(/まだありません/)).toBeTruthy(); // 空は空として案内
    expect(screen.queryByText(/読み込めませんでした/)).toBeNull(); // 失敗表示は出さない
  });
});
