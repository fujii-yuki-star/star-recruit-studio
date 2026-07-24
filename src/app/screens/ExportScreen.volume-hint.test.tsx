// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { AudioMix, Scene } from "../../domain/project/types";
import { ExportScreen } from "./ExportScreen";

// #547 P3-13：書き出し画面のナレーション音量スライダーは「動画全体の既定」（11 §6）。個別の声量を設定した場面は
// その設定が優先されて全体スライダーでは変わらないのに、書き出し画面はそれを説明していなかった（仕上がり確認は説明する
// ＝ADR-0026②）。個別設定を持つ場面が1つでもあれば注意を添え、無ければ添えないことを固定する。
const OVERRIDE_HINT =
  "一部の場面は個別の声量を設定しています。その場面は、この全体の設定より個別の設定が優先されます（場面編集で変えられます）。";

function scene(id: string, order: number, audioMix?: AudioMix): Scene {
  return {
    sceneId: id,
    partId: "part_001",
    order,
    sceneType: "photo_intro",
    templateId: "photo_left_text_right_yuko_v1",
    durationSec: 8,
    assetRefs: {},
    character: { enabled: false, characterId: "yuko" },
    texts: {},
    narration: { text: "", status: "none" },
    warnings: [],
    ...(audioMix ? { audioMix } : {}),
  };
}

function setup(scenes: Scene[]) {
  useProjectStore.getState().setExportRun({ phase: "idle" }); // newProject のガードを外す
  useProjectStore.getState().newProject();
  useProjectStore.setState({
    templates: sampleTemplates,
    parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: scenes.map((s) => s.sceneId) }],
    scenes,
    saveStatus: "saved",
  });
}

describe("ExportScreen ナレーション音量の個別設定注意（#547 P3-13）", () => {
  beforeEach(() => {
    setup([scene("scene_001", 1)]);
  });

  it("個別の声量を設定した場面が1つでもあれば、全体設定より優先される旨を添える", () => {
    setup([scene("scene_001", 1), scene("scene_002", 2, { narrationVolume: 0.4 })]);
    const { getByText } = render(<ExportScreen onNavigate={vi.fn()} />);
    expect(getByText(OVERRIDE_HINT)).toBeInTheDocument();
  });

  it("どの場面も個別の声量を持たなければ注意は出さない（不要な注意を出さない）", () => {
    setup([scene("scene_001", 1), scene("scene_002", 2)]);
    const { queryByText } = render(<ExportScreen onNavigate={vi.fn()} />);
    expect(queryByText(OVERRIDE_HINT)).toBeNull();
  });

  it("narrationVolume=null（継承）は個別設定ではない＝注意を出さない", () => {
    setup([scene("scene_001", 1, { narrationVolume: null })]);
    const { queryByText } = render(<ExportScreen onNavigate={vi.fn()} />);
    expect(queryByText(OVERRIDE_HINT)).toBeNull();
  });

  it("音量スライダー自体は無効化しない（全体設定は他の場面には効く＝ADR-0026①）", () => {
    setup([scene("scene_001", 1, { narrationVolume: 0.4 })]);
    const { container } = render(<ExportScreen onNavigate={vi.fn()} />);
    const slider = container.querySelector("#narrationVolume") as HTMLInputElement;
    expect(slider.disabled).toBe(false);
  });
});
