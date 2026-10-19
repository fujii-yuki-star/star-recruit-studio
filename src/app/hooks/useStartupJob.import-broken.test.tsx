// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import * as startupFs from "../../infrastructure/startupFs";
import { useStartupJobStore } from "../store/startupJobStore";
import { STARTUP_IMPORT_BROKEN_MESSAGE, STARTUP_IMPORT_UNREADABLE_MESSAGE, useStartupJob } from "./useStartupJob";

/**
 * 取り込む元が読めないときの断りを、原因で言い分ける（通し点検 2026-10-16）。
 *
 * ⚠️ 中身が壊れているだけ（フォルダの指定は正しい）でも「動画のフォルダごと指定してください」と出ていた
 * ＝**従っても直らない案内**（§2-5）。
 */
describe("起動の引数の取り込み：読めない理由で断りを分ける", () => {
  beforeEach(() => {
    useStartupJobStore.setState({ pendingExportOut: null, forwarded: false, notice: null, requestKnown: "unknown" });
    vi.spyOn(startupFs, "onStartupRequestForwarded").mockResolvedValue(() => undefined);
    vi.spyOn(startupFs, "finishStartupJob").mockResolvedValue(undefined);
    vi.spyOn(startupFs, "startupRequest").mockResolvedValue({
      kind: "import", folder: "C:/取り込む", forwarded: false, argError: null,
    } as never);
  });
  afterEach(() => vi.restoreAllMocks());

  it("中身が壊れている（読めるが形になっていない）ときは「中身が壊れている」と言う", async () => {
    vi.spyOn(startupFs, "readImportFolder").mockResolvedValue('{"schemaVersion": "1.0", "broken": ');
    renderHook(() => useStartupJob(vi.fn()));
    await waitFor(() => expect(useStartupJobStore.getState().notice).toBe(STARTUP_IMPORT_BROKEN_MESSAGE));
  });

  it("フォルダの中身を読めないときは、いままでどおり「フォルダごと指定して」", async () => {
    vi.spyOn(startupFs, "readImportFolder").mockRejectedValue(new Error("無い"));
    renderHook(() => useStartupJob(vi.fn()));
    await waitFor(() => expect(useStartupJobStore.getState().notice).toBe(STARTUP_IMPORT_UNREADABLE_MESSAGE));
  });
});
