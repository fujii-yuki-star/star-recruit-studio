// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import * as startupFs from "../../infrastructure/startupFs";
import * as projectFs from "../../infrastructure/projectFs";
import { useTimelineStore } from "../store/timelineStore";
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

// ⚠️ **取り込んで採り直した番号を、頼んだ側へ返す**（通し点検 2026-10-16）＝どこにも出さないと、外の AI は続く
//   `--make-voices <番号>` に渡す番号を置き場を覗いて推すしかなかった。標準出力へ1行（`18 §18.5`）＝`finishStartupJob` の結果。
describe("起動の引数の取り込み：採り直した番号を返す", () => {
  beforeEach(() => {
    useStartupJobStore.setState({ pendingExportOut: null, forwarded: false, notice: null, requestKnown: "unknown" });
    vi.spyOn(startupFs, "onStartupRequestForwarded").mockResolvedValue(() => undefined);
    vi.spyOn(startupFs, "startupRequest").mockResolvedValue({
      kind: "import", folder: "C:/取り込む", forwarded: false, argError: null,
    } as never);
  });
  afterEach(() => vi.restoreAllMocks());

  it("できたら、新しい番号を結果として渡す（画面の知らせには出さない）", async () => {
    const sample = readFileSync("docs/yuko_recruit_docs/fixtures/timeline-project.sample.json", "utf8");
    vi.spyOn(startupFs, "readImportFolder").mockResolvedValue(sample);
    vi.spyOn(projectFs, "listProjectSummaries").mockResolvedValue([]);
    vi.spyOn(projectFs, "saveProjectDoc").mockResolvedValue(undefined as never);
    vi.spyOn(startupFs, "importProjectFolder").mockResolvedValue({ copied: 3, skipped: 0 });
    vi.spyOn(useTimelineStore.getState(), "openTimelineProject").mockResolvedValue(undefined);
    const finish = vi.spyOn(startupFs, "finishStartupJob").mockResolvedValue(undefined);
    renderHook(() => useStartupJob(vi.fn()));
    await waitFor(() => expect(finish).toHaveBeenCalled());
    const [ok, , message, result] = finish.mock.calls[0]!;
    expect(ok).toBe(true);
    expect(result).toMatch(/^proj_\d{8}_\d{3}$/);
    expect(String(message).includes(String(result)), "番号を画面の知らせに出した").toBe(false);
  });
});

