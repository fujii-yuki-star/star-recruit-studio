// @vitest-environment jsdom
// 起動のときの「最後の動画を自動で開く」と、引数で頼まれた動画の**競走**（PR #1197 レビュー 🔴・#1184）。
//
// ⚠️ **これが無いと、黙って別の動画が書き出される**＝AI が `--export <B>` で起こしたのに、
// 自動で開いた直前の A が後から勝つと、**A が B の保存先へ書かれ、成功として返る**。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import App from "../App";
import { useStartupJobStore } from "./store/startupJobStore";
import * as projectStoreMod from "./store/projectStore";
import * as startupFs from "../infrastructure/startupFs";

describe("起動時の自動で開く（頼まれごとと競走しない）", () => {
  beforeEach(() => {
    useStartupJobStore.setState({ requestKnown: "unknown", pendingExportOut: null, forwarded: false, notice: null });
    localStorage.setItem("lastProjectId", "proj_20260101_001");
    vi.spyOn(startupFs, "onStartupRequestForwarded").mockResolvedValue(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    useStartupJobStore.setState({ requestKnown: "unknown" });
  });

  // ⚠️ **頼まれているなら、自動では開かない**（開くと、どちらが勝つか分からない）。
  it("引数で動画を頼まれていたら、最後の動画を自動で開かない", async () => {
    const load = vi.spyOn(projectStoreMod.useProjectStore.getState(), "loadProject").mockResolvedValue(undefined);
    vi.spyOn(startupFs, "startupRequest").mockResolvedValue({
      kind: "export", folder: null, projectId: "proj_20260917_009", out: "C:/o.mp4",
      quitWhenDone: true, forwarded: false, argError: null,
    });
    render(<App />);
    await waitFor(() => expect(useStartupJobStore.getState().requestKnown).toBe("job"));
    expect(
      load.mock.calls.some((c) => c[0] === "proj_20260101_001"),
      "頼まれているのに、直前の動画を自動で開いている",
    ).toBe(false);
  });

  // ⚠️ **頼まれていなければ、今までどおり開く**（起動の体験を変えない）。
  it("何も頼まれていなければ、最後の動画を自動で開く", async () => {
    const load = vi.spyOn(projectStoreMod.useProjectStore.getState(), "loadProject").mockResolvedValue(undefined);
    vi.spyOn(startupFs, "startupRequest").mockResolvedValue({
      kind: "none", folder: null, projectId: null, out: null,
      quitWhenDone: false, forwarded: false, argError: null,
    });
    render(<App />);
    await waitFor(() => expect(load.mock.calls.some((c) => c[0] === "proj_20260101_001")).toBe(true));
  });
});
