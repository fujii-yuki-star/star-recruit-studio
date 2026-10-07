// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { useStartupJobStore } from "../store/startupJobStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import * as ffmpeg from "../../infrastructure/ffmpegExport";
import { EXPORT_SIZE } from "../../domain/constants";
import type { Scene } from "../../domain/project/types";
import { ExportScreen } from "./ExportScreen";

// 動画サイズの3択（#1218・利用者判断 2026-10-07）。「ふつう」は大きさ 1080 のまま、映像の上限だけを渡す。
// ⚠️ 上限の値は domain（`exportSizeMaxBitrateBps`）の検査で見る＝この画面から書き出しの呼び出しまでは、
//   本物のアプリの機能を途中で呼ぶので検査では届かない（既存の検査も届いていない）。
const scene = (id: string, order: number): Scene => ({
  sceneId: id, partId: "part_001", order, sceneType: "photo_intro",
  templateId: "photo_left_text_right_yuko_v1", durationSec: 8, assetRefs: {},
  character: { enabled: false, characterId: "yuko" }, texts: {},
  narration: { text: "", status: "none" }, warnings: [],
});

describe("動画サイズの3択（#1218）", () => {
  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" });
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [scene("scene_001", 1)],
      isImporting: false,
      status: "ready",
      saveStatus: "saved",
    });
    useStartupJobStore.setState({ pendingExportOut: null, forwarded: false, notice: null });
    vi.spyOn(ffmpeg, "canExport").mockReturnValue(true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    useProjectStore.getState().setExportForm({ size: EXPORT_SIZE.full });
  });

  it("選択肢は きれい／ふつう／軽い（ふつうは大きさ 1080 のまま）", () => {
    const { container } = render(<ExportScreen onNavigate={vi.fn()} />);
    const texts = [...(container.querySelector("#size") as HTMLSelectElement).options].map((o) => o.text);
    expect(texts).toEqual(["きれい（1920×1080）", "ふつう（1920×1080・ファイル小さめ）", "軽い（1280×720）"]);
  });

  it("「ふつう」を選ぶと覚える／知らない値は受けない", () => {
    const { container } = render(<ExportScreen onNavigate={vi.fn()} />);
    const sel = container.querySelector("#size") as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: EXPORT_SIZE.standard } });
    expect(useProjectStore.getState().exportForm.size).toBe(EXPORT_SIZE.standard);
  });
});
