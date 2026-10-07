// @vitest-environment jsdom
// 書き出し画面の「字幕ファイルを書き出す」（ADR-0055 決定4・#1351）。
//
// ⚠️ **場面形式は焼き出しを通して同じ取り出し方へ**＝画面の配線（`_bake` → `subtitleCuesOf`）を本物の store で通す。
// ⚠️ 「字幕を入れる」（動画に焼き込むか）とは別＝OFF でも字幕ファイルには出る（06 §13）。
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", async (orig) => ({
  ...(await orig<typeof import("@tauri-apps/api/core")>()),
  invoke: vi.fn(async () => undefined),
}));
vi.mock("../../infrastructure/dialog", async (orig) => ({
  ...(await orig<typeof import("../../infrastructure/dialog")>()),
  showSaveSubtitleDialog: vi.fn(async () => "C:/out/字幕.srt"),
}));

import { invoke } from "@tauri-apps/api/core";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Scene } from "../../domain/project/types";
import { ExportScreen } from "./ExportScreen";
import { SUBTITLE_FILE_EXPORT_LABEL, subtitleExportedMessage, subtitleFileMessage, subtitleFileSkippedScenesMessage } from "../uiLabels";

function scene(id: string, order: number, subtitle: string): Scene {
  return {
    sceneId: id,
    partId: "part_001",
    order,
    sceneType: "photo_intro",
    templateId: sampleTemplates[0].templateId,
    durationSec: 4,
    assetRefs: {},
    character: { enabled: false, characterId: "yuko" },
    texts: { subtitle },
    narration: { text: "", status: "none" },
    warnings: [],
  };
}

function setup(scenes: Scene[]) {
  useProjectStore.getState().setExportRun({ phase: "idle" });
  useProjectStore.getState().newProject();
  useProjectStore.setState({
    templates: sampleTemplates,
    parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: scenes.map((s) => s.sceneId) }],
    scenes,
    saveStatus: "saved",
  });
  useProjectStore.getState().setExportForm({ withSubtitle: false });
}

const writes = () => vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "write_subtitle_file");
afterEach(() => vi.clearAllMocks());

describe("ExportScreen 字幕ファイルを書き出す", () => {
  it("場面の字幕を場面の時刻で書く（「字幕を入れる」が OFF でも）・書けた数を知らせる", async () => {
    setup([scene("scene_001", 1, "最初の字幕"), scene("scene_002", 2, "次の字幕")]);
    render(<ExportScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: SUBTITLE_FILE_EXPORT_LABEL }));
    expect(await screen.findByText(subtitleExportedMessage(2))).toBeInTheDocument();
    const [, args] = writes()[0] as [string, { path: string; text: string }];
    expect(args.path).toBe("C:/out/字幕.srt");
    expect(args.text).toContain("00:00:00,000 --> 00:00:04,000\n最初の字幕");
    expect(args.text).toContain("次の字幕");
  });

  it("字幕が無ければ書かずに次の行動を言う", async () => {
    setup([scene("scene_001", 1, "")]);
    render(<ExportScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: SUBTITLE_FILE_EXPORT_LABEL }));
    expect(await screen.findByText(subtitleFileMessage.SUBTITLE_FILE_NOTHING_TO_EXPORT)).toBeInTheDocument();
    await waitFor(() => expect(writes()).toHaveLength(0));
  });

  // PR #1356 レビュー 🟡：自由配置の字幕ボックスがセリフに追従する場面は、動画に出るのに字幕ファイルへ入らない＝黙って抜かない。
  it("セリフに追従する字幕ボックスの場面は、入れていないことを場面番号つきで知らせる", async () => {
    const free: Scene = {
      ...scene("scene_002", 2, ""),
      templateId: "free_canvas_v1",
      sceneType: "free",
      freeLayout: [{ id: "free_001", kind: "subtitle", x: 100, y: 900, w: 1720, h: 120, subtitleSource: { kind: "allLines" } }],
      lines: [{ lineId: "line_001", text: "いち", status: "none" }],
    } as Scene;
    setup([scene("scene_001", 1, "最初の字幕"), free]);
    render(<ExportScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: SUBTITLE_FILE_EXPORT_LABEL }));
    expect(await screen.findByText(`${subtitleExportedMessage(1)}${subtitleFileSkippedScenesMessage([2])}`)).toBeInTheDocument();
  });
});
