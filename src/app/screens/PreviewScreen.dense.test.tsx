// @vitest-environment jsdom
// 場面形式の「仕上がり確認」と「書き出し」にも詰めた表示を当てる（ADR-0047 の残り・#1256 b8）。
// ⚠️ **空の枝には付けない**（ADR-0047 追補）＝詰める本体が無く、文が読みにくくなるだけ。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { PreviewScreen } from "./PreviewScreen";
import { ExportScreen } from "./ExportScreen";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";

const scene = {
  sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "photo_intro",
  templateId: "photo_left_text_right_yuko_v1", durationSec: 8, assetRefs: {},
  character: { enabled: false, characterId: "yuko" }, texts: {}, narration: { text: "", status: "none" }, warnings: [],
};

describe("場面形式の仕上がり確認・書き出しの詰めた表示（#1256 b8）", () => {
  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" });
    useProjectStore.getState().newProject();
  });

  it("場面があるときは詰めた表示", () => {
    useProjectStore.setState({ templates: sampleTemplates, parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }], scenes: [scene] as never, status: "ready" });
    const a = render(<PreviewScreen onNavigate={vi.fn()} />);
    expect(a.container.querySelector(".main-scroll.dense"), "仕上がり確認").not.toBeNull();
    a.unmount();
    const b = render(<ExportScreen onNavigate={vi.fn()} />);
    expect(b.container.querySelector(".main-scroll.dense"), "書き出し").not.toBeNull();
  });

  it("場面が無いとき（空の枝）は詰めない", () => {
    useProjectStore.setState({ templates: sampleTemplates, parts: [], scenes: [], status: "ready" });
    const a = render(<PreviewScreen onNavigate={vi.fn()} />);
    expect(a.container.querySelector(".dense"), "仕上がり確認の空の枝").toBeNull();
    a.unmount();
    const b = render(<ExportScreen onNavigate={vi.fn()} />);
    expect(b.container.querySelector(".dense"), "書き出しの空の枝").toBeNull();
  });
});
