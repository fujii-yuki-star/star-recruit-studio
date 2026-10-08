// @vitest-environment jsdom
// 開いているタイムライン形式の動画をホームで改名する（#1396）。
// ⚠️ ディスクだけ書き換えると、開いたままの文書が古い名前を持ち続け、次の自動保存で改名が消える＝開いている文書から改名する。
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { useTimelineStore } from "../store/timelineStore";
import type { ProjectSummary } from "../../infrastructure/projectFs";
import { HomeScreen } from "./HomeScreen";

const row = (projectId: string): ProjectSummary => ({ projectId, projectName: "旧タイトル", updatedAt: "2026-10-08T00:00:00Z", format: "timeline" });

describe("HomeScreen 開いているタイムライン形式の動画を改名する（#1396）", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useTimelineStore.setState({ doc: null } as never);
  });

  function setup(openId: string | null, ok = true) {
    const renameProject = vi.fn(async () => {});
    const renameOpen = vi.fn(async () => ok);
    useProjectStore.setState({ listProjects: vi.fn(async () => [row("proj_009")]), renameProject } as never);
    useTimelineStore.setState({ doc: openId ? ({ projectId: openId } as never) : null, renameOpenTimelineProject: renameOpen } as never);
    render(<HomeScreen onNavigate={vi.fn()} />);
    return { renameProject, renameOpen };
  }
  async function rename(): Promise<void> {
    fireEvent.click(await screen.findByLabelText("「旧タイトル」の名前を変更"));
    fireEvent.change(screen.getByLabelText("動画の名前"), { target: { value: "新タイトル" } });
    fireEvent.click(screen.getByText("保存"));
  }

  it("開いている動画なら、開いている文書から改名する（ディスクだけ書き換えない）", async () => {
    const { renameProject, renameOpen } = setup("proj_009");
    await rename();
    await waitFor(() => expect(renameOpen).toHaveBeenCalledWith("新タイトル"));
    expect(renameProject).not.toHaveBeenCalled();
  });

  it("開いていない動画は、今までどおりディスクの文書を改名する", async () => {
    const { renameProject, renameOpen } = setup("proj_other");
    await rename();
    await waitFor(() => expect(renameProject).toHaveBeenCalledWith("proj_009", "新タイトル"));
    expect(renameOpen).not.toHaveBeenCalled();
  });

  it("開いている文書の改名に失敗したら、入力欄を残して失敗を出す", async () => {
    setup("proj_009", false);
    await rename();
    await waitFor(() => expect(screen.getByLabelText("動画の名前")).toBeTruthy());
    expect(screen.getByText(/名前を変更できませんでした|変更できませんでした/)).toBeTruthy();
  });
});
