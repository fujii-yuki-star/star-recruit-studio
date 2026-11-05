// @vitest-environment jsdom
// あなた向け会社説明の学生の画面（β・ADR-0061 決定3）。
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { defaultBriefingCatalog, type BriefingCatalog } from "../../domain/briefing/catalog";
import type { BriefingCandidate } from "../../domain/briefing/compose";

const run = vi.hoisted(() => ({
  composeCalls: [] as { chosen: readonly string[]; length: string }[],
  picks: [] as unknown[],
  prepareFails: null as Error | null,
  prepared: [] as unknown[],
  deleted: [] as string[],
  cleanups: 0,
}));

vi.mock("../briefing/briefingRun", () => {
  class BriefingPrepareError extends Error {}
  return {
    BriefingPrepareError,
    cleanupStaleBriefingSessions: async () => { run.cleanups += 1; },
    loadBriefingSources: async () => [],
    composeForStudent: async (_c: unknown, _d: unknown, chosen: readonly string[], length: string) => {
      run.composeCalls.push({ chosen, length });
      return { picks: run.picks, totalSec: 0, by: "rules", aiProblem: null };
    },
    prepareBriefingVideo: async (input: unknown) => {
      run.prepared.push(input);
      if (run.prepareFails) throw run.prepareFails;
      return "proj_20261105_901";
    },
    withLastProjectKept: async (open: () => Promise<unknown>) => open(),
  };
});
vi.mock("../../infrastructure/briefingSessionFs", () => ({
  deleteBriefingSession: async (id: string) => { run.deleted.push(id); },
}));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: async () => "C:/data",
  join: async (...p: string[]) => p.join("/"),
}));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (p: string) => `asset://localhost/${p}`, invoke: vi.fn() }));
// 書き出しの画面は裏で動かすだけ（ここでは中身を検査しない）。
vi.mock("./ExportScreen", () => ({ ExportScreen: () => <div data-testid="hidden-export" /> }));

import { BriefingStudentScreen } from "./BriefingStudentScreen";
import { useProjectStore } from "../store/projectStore";
import { useStartupJobStore } from "../store/startupJobStore";
import { useBriefingStudentStore } from "../store/briefingStudentStore";
import { BRIEFING_EXIT_CODE_WRONG_MESSAGE, BRIEFING_EXPORT_FAILED_MESSAGE, BRIEFING_NO_SCENES_MESSAGE } from "../uiLabels";

function cand(key: string, title: string, durationSec: number, matched: string[]): BriefingCandidate {
  return { key, projectId: "proj_20261101_001", sceneId: `scene_00${key.slice(1)}`, title, speech: "", durationSec, interestIds: matched, matched, priority: "normal", required: false };
}

function catalog(): BriefingCatalog {
  return { ...defaultBriefingCatalog(), exitCode: "0427" };
}

beforeEach(() => {
  run.composeCalls = [];
  run.picks = [cand("c1", "研修のようす", 50, ["interest_002"]), cand("c2", "先輩の一日", 35, ["interest_003"])];
  run.prepareFails = null;
  run.prepared = [];
  run.deleted = [];
  run.cleanups = 0;
  useProjectStore.setState({ scenes: [], narrationAudioById: {} });
  useProjectStore.getState().setExportRun({ phase: "idle", resultPath: "", message: "" });
  useStartupJobStore.setState({ pendingExportOut: null, internal: false });
  useBriefingStudentStore.setState({ catalog: catalog() });
  useProjectStore.setState({ loadProject: vi.fn(async () => {}) } as never);
});

describe("学生の画面", () => {
  it("開いたら古い一時の動画を片づける・知りたいことを選ぶまで組めない・選んだ順でなく登録の順で頼む", async () => {
    render(<BriefingStudentScreen catalog={catalog()} />);
    await waitFor(() => expect(run.cleanups).toBe(1));
    const go = screen.getByRole("button", { name: "説明動画を組む" });
    expect((go as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "若手社員" }));
    fireEvent.click(screen.getByRole("button", { name: "研修" }));
    expect(screen.getByRole("button", { name: "研修" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: /しっかり/ }));
    fireEvent.click(go);
    await screen.findByText("この内容で作ります（見たくないものは外せます）");
    expect(run.composeCalls).toEqual([{ chosen: ["interest_002", "interest_003"], length: "long" }]);
  });

  it("確かめる＝外したものは作るときに渡さない・おおよその長さは外した分を引く（最後のひとことも数える）", async () => {
    render(<BriefingStudentScreen catalog={catalog()} />);
    fireEvent.click(screen.getByRole("button", { name: "研修" }));
    fireEvent.click(screen.getByRole("button", { name: "説明動画を組む" }));
    await screen.findByText("研修のようす");
    // 50＋35＋最後のひとこと 6 秒＝91 秒＝約 2 分（ひとことを数えないと 85 秒＝約 1 分）
    expect(screen.getByText("長さ：約 2 分")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /先輩の一日/ }));
    expect(screen.getByText("長さ：約 1 分")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "この内容で作る" }));
    await waitFor(() => expect(run.prepared).toHaveLength(1));
    expect((run.prepared[0] as { picks: BriefingCandidate[] }).picks.map((c) => c.key)).toEqual(["c1"]);
    // 仕上げは書き出しの画面へ「アプリの中の仕事」として保存先を渡す
    await waitFor(() => expect(useStartupJobStore.getState().pendingExportOut).toBe("C:/data/temporary-sessions/proj_20261105_901/briefing.mp4"));
    expect(useStartupJobStore.getState().internal).toBe(true);
    expect(screen.getByTestId("hidden-export")).toBeTruthy();
  });

  it("仕上がったらその場で再生し、終わると一時の動画を消して最初へ戻る", async () => {
    render(<BriefingStudentScreen catalog={catalog()} />);
    fireEvent.click(screen.getByRole("button", { name: "研修" }));
    fireEvent.click(screen.getByRole("button", { name: "説明動画を組む" }));
    fireEvent.click(await screen.findByRole("button", { name: "この内容で作る" }));
    await screen.findByTestId("hidden-export");
    act(() => useProjectStore.getState().setExportRun({ phase: "done", resultPath: "C:/data/temporary-sessions/proj_20261105_901/briefing.mp4" }));
    const video = (await screen.findByText("「終わる」を押すと、この動画は消えます。")).parentElement!.querySelector("video")!;
    expect(video.getAttribute("src")).toMatch(/^asset:\/\/localhost\/C:\/data\/temporary-sessions\/proj_20261105_901\/briefing\.mp4\?t=\d+$/);
    fireEvent.click(screen.getByRole("button", { name: "終わる" }));
    await screen.findByRole("button", { name: "説明動画を組む" });
    expect(run.deleted).toEqual(["proj_20261105_901"]);
    expect(useProjectStore.getState().exportRun.phase).toBe("idle");
  });

  it("仕上げに失敗したら、学生の言葉で知らせる（編集ソフトの文をそのまま出さない）", async () => {
    render(<BriefingStudentScreen catalog={catalog()} />);
    fireEvent.click(screen.getByRole("button", { name: "研修" }));
    fireEvent.click(screen.getByRole("button", { name: "説明動画を組む" }));
    fireEvent.click(await screen.findByRole("button", { name: "この内容で作る" }));
    await screen.findByTestId("hidden-export");
    act(() => useProjectStore.getState().setExportRun({ phase: "error", message: "書き出す場面がありません。" }));
    expect(await screen.findByText(BRIEFING_EXPORT_FAILED_MESSAGE)).toBeTruthy();
    expect(screen.queryByText("書き出す場面がありません。")).toBeNull();
  });

  it("合う説明が無ければそう言う", async () => {
    run.picks = [];
    render(<BriefingStudentScreen catalog={catalog()} />);
    fireEvent.click(screen.getByRole("button", { name: "研修" }));
    fireEvent.click(screen.getByRole("button", { name: "説明動画を組む" }));
    expect(await screen.findByText(BRIEFING_NO_SCENES_MESSAGE)).toBeTruthy();
  });

  it("抜けるのは担当の人の番号だけ（違えば抜けない）", async () => {
    render(<BriefingStudentScreen catalog={catalog()} />);
    fireEvent.click(screen.getByRole("button", { name: "担当の人へ" }));
    const input = screen.getByLabelText("担当の人の番号（4 桁）");
    fireEvent.change(input, { target: { value: "1111" } });
    fireEvent.click(screen.getByRole("button", { name: "抜ける" }));
    expect(screen.getByText(BRIEFING_EXIT_CODE_WRONG_MESSAGE)).toBeTruthy();
    expect(useBriefingStudentStore.getState().catalog).not.toBeNull();
    fireEvent.change(input, { target: { value: "0427" } });
    fireEvent.click(screen.getByRole("button", { name: "抜ける" }));
    await waitFor(() => expect(useBriefingStudentStore.getState().catalog).toBeNull());
  });
});
