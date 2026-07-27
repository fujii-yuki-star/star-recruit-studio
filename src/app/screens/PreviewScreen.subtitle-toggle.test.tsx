// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import type { Scene } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";
import { PreviewScreen } from "./PreviewScreen";

// #547 P2-7：仕上がり確認の「字幕を入れる」は書き出しと同じ設定（exportForm.withSubtitle）。
// 従来は確認が常に字幕ありで、字幕なし書き出しの見た目を確認できなかった（ADR-0026③）。
const subtitleTemplate = {
  schemaVersion: "1.0", templateId: "tpl_sub", name: "sub", category: "opening", aspectRatio: "16:9",
  canvas: { width: 1920, height: 1080 },
  layers: [{ id: "subtitle", type: "subtitle", textKey: "subtitle", x: 240, y: 920, w: 1440, h: 90, zIndex: 50, fontSize: 38 }],
} as unknown as Template;

const scene = {
  sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "opening", templateId: "tpl_sub",
  durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {}, warnings: [],
  lines: [{ lineId: "line_001", text: "字幕のテスト文", startSec: 0, status: "none" }],
} as unknown as Scene;

describe("PreviewScreen 字幕トグル（#547 P2-7）", () => {
  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" });
    useProjectStore.getState().newProject();
    useProjectStore.setState({
      templates: [subtitleTemplate],
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      // status: 自動生成（autoGenerateIfSafe）を発火させない＝この場面が差し替えられない（#620）
      scenes: [scene], status: "ready", saveStatus: "saved",
    });
  });

  it("既定は字幕あり＝トグルはオン、字幕が見える", () => {
    render(<PreviewScreen onNavigate={vi.fn()} />);
    expect(useProjectStore.getState().exportForm.withSubtitle).toBe(true);
    expect(document.body.textContent).toContain("字幕のテスト文");
  });

  it("トグルを切ると exportForm.withSubtitle が false になり、確認からも字幕が消える（書き出しと同じ設定）", () => {
    render(<PreviewScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("字幕を入れる"));
    expect(useProjectStore.getState().exportForm.withSubtitle).toBe(false); // 書き出しにも反映される同じ設定
    expect(document.body.textContent).not.toContain("字幕のテスト文"); // 確認からも字幕が消える
  });

  it("書き出し中は字幕トグルを無効化する（兄弟操作・書き出し画面と揃える・ADR-0026②）", () => {
    useProjectStore.getState().setExportRun({ phase: "rendering" }); // 書き出し中で開く
    render(<PreviewScreen onNavigate={vi.fn()} />);
    expect((screen.getByLabelText("字幕を入れる") as HTMLButtonElement).disabled).toBe(true);
    useProjectStore.getState().setExportRun({ phase: "idle" });
  });

  it("書き出しで字幕オフにしていれば、確認も字幕なしで開く（常に字幕あり、を解消）", () => {
    useProjectStore.getState().setExportForm({ withSubtitle: false });
    render(<PreviewScreen onNavigate={vi.fn()} />);
    expect(document.body.textContent).not.toContain("字幕のテスト文");
  });
});
