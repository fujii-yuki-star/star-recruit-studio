// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import * as startupFs from "../../infrastructure/startupFs";
import * as projectFs from "../../infrastructure/projectFs";
import { useProjectStore } from "../store/projectStore";
import { useTimelineStore } from "../store/timelineStore";
import { useStartupJobStore } from "../store/startupJobStore";
import { useStartupJob } from "./useStartupJob";

/**
 * 起動のときに頼まれた書き出しの**行き先**（ADR-0042・#1184）。
 *
 * ⚠️ **実機で見つかった穴**（2026-09-17）＝場面形式の道しか無く、
 * `--export <タイムライン形式>` は **3秒で何もせず終了コード 0**（＝成功に見える）だった。
 * ⚠️ **ここが塞がっていると ADR-0041 の枠②が成立しない**＝外の AI にタイムラインを書かせると決めたのに、
 * 書いたものを書き出す口が無い。
 */
describe("頼まれた書き出しの行き先は、動画の形式で決まる（#1184）", () => {
  beforeEach(() => {
    useStartupJobStore.setState({ pendingExportOut: null, forwarded: false, notice: null, requestKnown: "unknown" });
    vi.spyOn(startupFs, "onStartupRequestForwarded").mockResolvedValue(() => undefined);
    vi.spyOn(startupFs, "finishStartupJob").mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  const askFor = (projectId: string): void => {
    vi.spyOn(startupFs, "startupRequest").mockResolvedValue({
      kind: "export", projectId, out: "C:/頼まれた.mp4", forwarded: false, argError: null,
    } as never);
  };

  it("タイムライン形式なら、タイムラインの画面で開いて保存先を渡す", async () => {
    askFor("proj_20260917_001");
    vi.spyOn(projectFs, "listProjectSummaries").mockResolvedValue([
      { projectId: "proj_20260917_001", projectName: "長尺", updatedAt: "", format: "timeline" },
    ]);
    const open = vi.spyOn(useTimelineStore.getState(), "openTimelineProject").mockResolvedValue(undefined);
    const scene = vi.spyOn(useProjectStore.getState(), "loadProject").mockResolvedValue(undefined as never);
    const navigate = vi.fn();
    renderHook(() => useStartupJob(navigate));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("timeline-project"));
    expect(open).toHaveBeenCalledWith("proj_20260917_001");
    expect(scene, "場面形式の道へ行っている").not.toHaveBeenCalled();
    expect(useStartupJobStore.getState().pendingExportOut).toBe("C:/頼まれた.mp4");
  });

  it("場面形式なら、いままでどおり書き出しの画面へ行く", async () => {
    askFor("proj_20260624_003");
    vi.spyOn(projectFs, "listProjectSummaries").mockResolvedValue([
      { projectId: "proj_20260624_003", projectName: "会社紹介", updatedAt: "" },
    ]);
    const open = vi.spyOn(useTimelineStore.getState(), "openTimelineProject").mockResolvedValue(undefined);
    const scene = vi.spyOn(useProjectStore.getState(), "loadProject").mockResolvedValue(undefined as never);
    const navigate = vi.fn();
    renderHook(() => useStartupJob(navigate));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("export"));
    expect(scene).toHaveBeenCalledWith("proj_20260624_003");
    expect(open, "タイムラインの道へ行っている").not.toHaveBeenCalled();
  });

  // ⚠️ **開けなかったら保存先も捨てる**＝残すと、次に人が押した書き出しが黙ってそこへ書く。
  it("開けなかったときは、頼まれた保存先を残さない", async () => {
    askFor("proj_20260917_001");
    vi.spyOn(projectFs, "listProjectSummaries").mockResolvedValue([
      { projectId: "proj_20260917_001", projectName: "長尺", updatedAt: "", format: "timeline" },
    ]);
    vi.spyOn(useTimelineStore.getState(), "openTimelineProject").mockRejectedValue(new Error("読めない"));
    renderHook(() => useStartupJob(vi.fn()));
    await waitFor(() => expect(useStartupJobStore.getState().notice).not.toBeNull());
    expect(useStartupJobStore.getState().pendingExportOut).toBeNull();
  });
});
