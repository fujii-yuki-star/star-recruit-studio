// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import type { ProjectHeader } from "../../domain/project/persistence";
import type { Scene } from "../../domain/project/types";
import { HomeScreen } from "./HomeScreen";

/**
 * 複製の破棄ガード（#395・PR #889 レビュー 🔴）。
 *
 * ⚠️ **押したボタンのことが起きる**＝以前は複製でも「開く」用の状態を使い回しており、
 * 未保存があるときに「複製」を押して確認を通すと **複製されずに元の動画が開いて**いた。
 * 確認の行き先（開く／複製）と文言の両方をここで留める。
 */
describe("HomeScreen 複製の破棄ガード（#395・PR #889 レビュー 🔴）", () => {
  afterEach(() => vi.restoreAllMocks());

  const ONE = [{ projectId: "proj_001", projectName: "テスト動画", updatedAt: "2026-07-09T00:00:00Z" }];

  function setup(hasWork: boolean) {
    const loadProject = vi.fn(() => Promise.resolve());
    const duplicateProject = vi.fn(() => Promise.resolve("proj_002"));
    useProjectStore.setState({
      listProjects: vi.fn(() => Promise.resolve(ONE as unknown as ProjectHeader[])),
      loadProject,
      duplicateProject,
      saveStatus: "idle",
      scenes: hasWork ? [{ sceneId: "scene_001" } as unknown as Scene] : [],
      assets: [],
    } as never);
    return { loadProject, duplicateProject };
  }

  const clickDuplicate = async () => {
    await screen.findByText("テスト動画");
    fireEvent.click(screen.getByRole("button", { name: "「テスト動画」を複製" }));
  };

  it("未保存があると即複製せず、複製の確認を出す（「開きますか」ではない）", async () => {
    const { duplicateProject } = setup(true);
    render(<HomeScreen onNavigate={vi.fn()} />);
    await clickDuplicate();
    expect(screen.getByText(/複製して開きますか/)).toBeTruthy();
    expect(duplicateProject).not.toHaveBeenCalled();
  });

  it("確認を通すと複製が走る（元を開くのではない）", async () => {
    const { duplicateProject, loadProject } = setup(true);
    render(<HomeScreen onNavigate={vi.fn()} />);
    await clickDuplicate();
    fireEvent.click(screen.getByRole("button", { name: "複製して開く" }));
    expect(duplicateProject).toHaveBeenCalledWith("proj_001");
    expect(loadProject).not.toHaveBeenCalled(); // ⚠️ ここが以前の不具合（元が開いていた）
  });

  it("「やめる」を押すと何もせず確認が消える", async () => {
    const { duplicateProject, loadProject } = setup(true);
    render(<HomeScreen onNavigate={vi.fn()} />);
    await clickDuplicate();
    fireEvent.click(screen.getByRole("button", { name: "やめる" }));
    expect(duplicateProject).not.toHaveBeenCalled();
    expect(loadProject).not.toHaveBeenCalled();
    expect(screen.queryByText(/複製して開きますか/)).toBeNull();
  });

  it("未保存が無ければ確認せず複製する", async () => {
    const { duplicateProject } = setup(false);
    render(<HomeScreen onNavigate={vi.fn()} />);
    await clickDuplicate();
    expect(duplicateProject).toHaveBeenCalledWith("proj_001");
  });

  /** ⚠️ 開く確認の文言は**そのまま**（複製の文言に引きずられていない）。 */
  it("カードから開くときは今までどおり「開きますか」と聞く", async () => {
    const { loadProject } = setup(true);
    render(<HomeScreen onNavigate={vi.fn()} />);
    fireEvent.click((await screen.findByText("テスト動画")).closest("button") as HTMLButtonElement);
    expect(screen.getByText(/別のプロジェクトを開きますか/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "開く" }));
    expect(loadProject).toHaveBeenCalledWith("proj_001");
  });
});
