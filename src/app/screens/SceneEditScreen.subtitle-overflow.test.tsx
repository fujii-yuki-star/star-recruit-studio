// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Scene } from "../../domain/project/types";
import { SceneEditScreen } from "./SceneEditScreen";

// #563：字幕のはみ出し案内は**掛け合いに限らず**出す。
// 旧実装は判定も描画も掛け合いブロックの中にあり、単独/逐次の場面では**呼ばれも描かれもしなかった**
// （domain だけ直しても画面に出ない＝この配線を固定する）。文言は原因で出し分ける（§2-5）。
const subTemplateId = "opening_yuko_right_v1"; // 同梱の字幕層つきテンプレ

const soloScene = (partial: Partial<Scene> = {}): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "opening",
    templateId: subTemplateId, durationSec: 8, assetRefs: {},
    character: { enabled: false, characterId: "yuko" },
    texts: { subtitle: "あ".repeat(40) },
    narration: { text: "こんにちは", status: "none" }, warnings: [], ...partial,
  }) as unknown as Scene;

function setup(scene: Scene) {
  useProjectStore.getState().setExportRun({ phase: "idle" });
  useProjectStore.setState({
    templates: sampleTemplates,
    parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
    scenes: [scene], assets: [], editingSceneId: "scene_001",
    past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
  });
}

describe("SceneEditScreen 字幕のはみ出し案内（#563）", () => {
  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" });
  });

  it("単独ナレーションでも、字幕を拡大しすぎたら案内が出る（掛け合いブロックの外に出す）", () => {
    setup(soloScene({ textStyles: { subtitle: { fontSize: 300 } } } as Partial<Scene>));
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    // 1帯が大きすぎる場合の「次の行動」＝小さくする・短くする（同時のセリフを減らす、ではない）。
    expect(screen.getByText(/字幕が画面からはみ出します。文字の大きさを小さくするか、字幕を短くしてください。/)).toBeTruthy();
  });

  it("既定の体裁なら案内を出さない（普通に使うだけでは警告しない）", () => {
    setup(soloScene());
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText(/画面からはみ出します/)).toBeNull();
  });

  it("同時に流れるセリフがあるときは「同時のセリフを減らす」案内にする（原因で次の行動を変える・§2-5）", () => {
    setup(soloScene({
      textStyles: { subtitle: { fontSize: 300 } },
      lines: [
        { lineId: "line_001", text: "A", status: "none" },
        { lineId: "line_002", text: "B", status: "none", startWithPrevious: true },
      ],
    } as unknown as Partial<Scene>));
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/同時に表示するセリフが多く/)).toBeTruthy();
  });
});
