// @vitest-environment jsdom
// 書き出しの断りは**画面に出せる文だけ**を出す（#1123・PR #1130 レビュー由来 🟡）。
//
// ⚠️ **以前の注記は嘘だった**＝「Rust 側でユーザー向けに整えた文言なので、そのまま表示する」と
// 書いてあったが、`map_err(|e| e.to_string())` は `src-tauri` に **56 か所**あり、
// `os error 3` のような**生の OS エラー**もそのまま届く形だった（`15 §6`・§2-3 が禁じている）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import * as ffmpeg from "../../infrastructure/ffmpegExport";
import * as dialog from "../../infrastructure/dialog";
import type { Scene } from "../../domain/project/types";
import { ExportScreen } from "./ExportScreen";

const scene = (): Scene => ({
  sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "photo_intro",
  templateId: "photo_left_text_right_yuko_v1", durationSec: 8, assetRefs: {},
  character: { enabled: false, characterId: "yuko" }, texts: {},
  narration: { text: "", status: "none" }, warnings: [],
});

/** 書き出しを始めて、**取っかかりで落とす**（そこから先は関門の話なので通らなくてよい）。 */
function failExportWith(reason: unknown): void {
  vi.spyOn(ffmpeg, "beginExport").mockRejectedValue(reason);
}

describe("書き出しの断りは、画面に出せる文だけ出す（#1123）", () => {
  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" });
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [scene()], assets: [], isImporting: false, status: "ready", saveStatus: "saved",
    });
    vi.spyOn(ffmpeg, "canExport").mockReturnValue(true);
    vi.spyOn(dialog, "showSaveVideoDialog").mockResolvedValue("C:/out/movie.mp4");
  });
  afterEach(() => { vi.restoreAllMocks(); useProjectStore.getState().setExportRun({ phase: "idle" }); });

  it("整えた理由が返れば、その文を出す（丸めない）", async () => {
    failExportWith("この動画は書き出せませんでした。素材を選び直してから、もう一度お試しください。");
    render(<ExportScreen onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByText("動画を保存"));
    await waitFor(() => expect(document.body.textContent).toMatch(/素材を選び直してから/));
  });

  it("生の OS エラーは出さず、次の行動つきの定型文へ倒す（§2-3）", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    failExportWith("os error 3");
    render(<ExportScreen onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByText("動画を保存"));
    await waitFor(() => expect(document.body.textContent).toMatch(/記録の場所を開く/));
    expect(document.body.textContent).not.toMatch(/os error/);
  });

  it("中の失敗（`Error`）も出さない（`ffmpeg exited with code 1` 等）", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    failExportWith(new Error("ffmpeg exited with code 1"));
    render(<ExportScreen onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByText("動画を保存"));
    await waitFor(() => expect(document.body.textContent).toMatch(/記録の場所を開く/));
    expect(document.body.textContent).not.toMatch(/ffmpeg/);
  });
});
