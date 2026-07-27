// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import type { ProjectHeader } from "../../domain/project/persistence";
import type { Scene } from "../../domain/project/types";
import { HomeScreen } from "./HomeScreen";

// #547 P1-2：別プロジェクトを「開く」前に、未保存の変更があれば破棄確認を挟む（新規作成と同じガード＝データ喪失防止）。
describe("HomeScreen プロジェクトを開く破棄ガード（#547 P1-2）", () => {
  afterEach(() => vi.restoreAllMocks());

  const ONE = [{ projectId: "proj_001", projectName: "テスト動画", updatedAt: "2026-07-09T00:00:00Z" }];

  // saveStatus と「作業中の内容」の有無を指定してストアを用意する。scenes.length>0 で hasWorkInProgress=true。
  function setup(saveStatus: "idle" | "saved", hasWork: boolean, projects = ONE) {
    const loadProject = vi.fn(() => Promise.resolve());
    useProjectStore.setState({
      listProjects: vi.fn(() => Promise.resolve(projects as unknown as ProjectHeader[])),
      loadProject,
      saveStatus,
      scenes: hasWork ? [{ sceneId: "scene_001" } as unknown as Scene] : [],
      assets: [],
    });
    return loadProject;
  }

  const clickCard = async () =>
    fireEvent.click((await screen.findByText("テスト動画")).closest("button") as HTMLButtonElement);

  it("未保存があるとカードを押しても即開かず、破棄確認を出す", async () => {
    const loadProject = setup("idle", true);
    render(<HomeScreen onNavigate={vi.fn()} />);
    await clickCard();
    expect(screen.getByText(/別のプロジェクトを開きますか/)).toBeTruthy(); // 確認バナー
    expect(loadProject).not.toHaveBeenCalled(); // まだ開いていない＝未保存分を失わない
  });

  it("確認で「開く」を押すと loadProject が呼ばれる", async () => {
    const loadProject = setup("idle", true);
    render(<HomeScreen onNavigate={vi.fn()} />);
    await clickCard();
    fireEvent.click(screen.getByRole("button", { name: "開く" }));
    expect(loadProject).toHaveBeenCalledWith("proj_001");
  });

  it("「やめる」を押すと開かず確認が消える", async () => {
    const loadProject = setup("idle", true);
    render(<HomeScreen onNavigate={vi.fn()} />);
    await clickCard();
    fireEvent.click(screen.getByRole("button", { name: "やめる" }));
    expect(loadProject).not.toHaveBeenCalled();
    expect(screen.queryByText(/別のプロジェクトを開きますか/)).toBeNull();
  });

  it("未保存が無ければ確認せず即開く（保存済み＝saved）", async () => {
    const loadProject = setup("saved", true);
    render(<HomeScreen onNavigate={vi.fn()} />);
    await clickCard();
    expect(loadProject).toHaveBeenCalledWith("proj_001"); // 確認なしで即ロード
    expect(screen.queryByText(/別のプロジェクトを開きますか/)).toBeNull();
  });

  it("確認バナー表示中は他カードが無効化され、開く先がすり替わらない（pendingOpenId 上書き防止）", async () => {
    const loadProject = setup("idle", true, [
      { projectId: "proj_001", projectName: "動画A", updatedAt: "2026-07-09T00:00:00Z" },
      { projectId: "proj_002", projectName: "動画B", updatedAt: "2026-07-09T00:00:00Z" },
    ]);
    render(<HomeScreen onNavigate={vi.fn()} />);
    fireEvent.click((await screen.findByText("動画A")).closest("button") as HTMLButtonElement);
    const cardB = screen.getByText("動画B").closest("button") as HTMLButtonElement;
    expect(cardB.disabled).toBe(true); // 確認中は他カードを無効化
    fireEvent.click(cardB); // 無効ゆえ pendingOpenId を上書きしない
    fireEvent.click(screen.getByRole("button", { name: "開く" }));
    expect(loadProject).toHaveBeenCalledWith("proj_001"); // 最初に選んだ動画Aが開く
    expect(loadProject).not.toHaveBeenCalledWith("proj_002"); // すり替わらない
  });

  it("確認バナー表示中は削除も止まる（確認中の開く先を消せない）", async () => {
    setup("idle", true);
    render(<HomeScreen onNavigate={vi.fn()} />);
    await clickCard();
    const del = screen.getByRole("button", { name: /「テスト動画」を削除/ }) as HTMLButtonElement;
    expect(del.disabled).toBe(true); // カード/新規作成ボタンと同じ「確認中は他操作を止める」方針
  });

  it("確認中に書き出しが始まったら「開く」を押しても開かない（多重防御）", async () => {
    const loadProject = setup("idle", true);
    render(<HomeScreen onNavigate={vi.fn()} />);
    await clickCard();
    // 確認バナー表示後に別画面から書き出しが並走した想定＝isExporting を true にする（再描画を flush）。
    act(() => useProjectStore.setState({ exportRun: { ...useProjectStore.getState().exportRun, phase: "encoding" } }));
    fireEvent.click(screen.getByRole("button", { name: "開く" }));
    expect(loadProject).not.toHaveBeenCalled(); // doOpenProject 先頭の再チェックで止まる
  });
});
