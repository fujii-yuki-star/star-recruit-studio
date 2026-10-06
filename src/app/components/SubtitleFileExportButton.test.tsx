// @vitest-environment jsdom
// 字幕ファイルを書き出すボタン（ADR-0055 決定4・#1351）。
//
// ⚠️ **押した結果は必ず言う**（§2-5）＝書けた数・何も無い・保存できなかった。閉じたときだけ黙る。
// 保存の口（`invoke`）と保存ダイアログだけを差し替え、形式の決め方（拡張子）と中身の組み立ては本物を通す。
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("../../infrastructure/dialog", () => ({ showSaveSubtitleDialog: vi.fn(async () => null) }));

import { invoke } from "@tauri-apps/api/core";
import { showSaveSubtitleDialog } from "../../infrastructure/dialog";
import { SubtitleFileExportButton } from "./SubtitleFileExportButton";
import { SUBTITLE_FILE_EXPORT_LABEL, subtitleExportedMessage, subtitleFileMessage } from "../uiLabels";

const cues = [{ startSec: 1, endSec: 2.5, text: "こんにちは" }];
afterEach(() => vi.clearAllMocks());

function press(cuesOf = () => cues) {
  const onMessage = vi.fn();
  render(<SubtitleFileExportButton cuesOf={cuesOf} defaultName="会社紹介" disabledReason={null} onMessage={onMessage} />);
  fireEvent.click(screen.getByRole("button", { name: SUBTITLE_FILE_EXPORT_LABEL }));
  return onMessage;
}

describe("SubtitleFileExportButton", () => {
  it("選んだ拡張子の形式で書き、書けた数を言う（初期のファイル名は動画の名前）", async () => {
    vi.mocked(showSaveSubtitleDialog).mockResolvedValueOnce("C:/out/字幕.vtt");
    const onMessage = press();
    await waitFor(() => expect(onMessage).toHaveBeenCalledWith(subtitleExportedMessage(1), true));
    expect(showSaveSubtitleDialog).toHaveBeenCalledWith("会社紹介");
    expect(invoke).toHaveBeenCalledWith("write_subtitle_file", {
      path: "C:/out/字幕.vtt",
      text: "WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nこんにちは\n",
    });
  });

  it("拡張子が付かずに返ってきたら .srt を足して SRT で書く", async () => {
    vi.mocked(showSaveSubtitleDialog).mockResolvedValueOnce("C:/out/字幕");
    const onMessage = press();
    await waitFor(() => expect(onMessage).toHaveBeenCalledWith(subtitleExportedMessage(1), true));
    const [, args] = vi.mocked(invoke).mock.calls[0] as [string, { path: string; text: string }];
    expect(args.path).toBe("C:/out/字幕.srt");
    expect(args.text.charCodeAt(0)).toBe(0xfeff);
  });

  it("書き出せる字幕が無ければ、保存先を聞かずに次の行動を言う", async () => {
    const onMessage = press(() => []);
    await waitFor(() => expect(onMessage).toHaveBeenCalledWith(subtitleFileMessage.SUBTITLE_FILE_NOTHING_TO_EXPORT, false));
    expect(showSaveSubtitleDialog).not.toHaveBeenCalled();
  });

  it("保存できなかったら次の行動を言う・保存先を閉じたら黙る", async () => {
    vi.mocked(showSaveSubtitleDialog).mockResolvedValueOnce("C:/out/字幕.srt");
    vi.mocked(invoke).mockRejectedValueOnce(new Error("拒否"));
    const failed = press();
    await waitFor(() => expect(failed).toHaveBeenCalledWith(subtitleFileMessage.SUBTITLE_FILE_SAVE_FAILED, false));

    document.body.innerHTML = "";
    const cancelled = press();
    await waitFor(() => expect(showSaveSubtitleDialog).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 0));
    expect(cancelled).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
