// @vitest-environment jsdom
// 単独の語りの「声」の欄（ADR-0073 段階2）＝掛け合いの行と同じ部品・選ばない＝ナレーターの声（設定）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Scene } from "../../domain/project/types";
import { SceneEditScreen } from "./SceneEditScreen";
import { VOICE_FOLLOW_NARRATOR_LABEL } from "../uiLabels";

const soloScene = (over: Partial<Scene["narration"]> = {}): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "photo_intro",
    templateId: "photo_left_text_right_yuko_v1", durationSec: 8, assetRefs: {},
    character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "こんにちは", status: "generated", voicePath: "voices/scene_001.wav", ...over },
    warnings: [],
  }) as unknown as Scene;

const dialogueScene = (): Scene =>
  ({
    ...soloScene({ text: "", status: "none", voicePath: null }),
    lines: [{ lineId: "line_001", text: "やあ", speaker: 2, status: "generated" }],
  }) as unknown as Scene;

function setScene(sc: Scene): void {
  useProjectStore.setState({
    templates: sampleTemplates,
    parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
    scenes: [sc],
    assets: [],
    editingSceneId: "scene_001",
    past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
  });
}

describe("単独の語りの「声」の欄（ADR-0073 段階2）", () => {
  beforeEach(() => setScene(soloScene()));

  it("初めは「ナレーターの声（設定）に合わせる」", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    const sel = screen.getByRole("combobox", { name: "この場面の声" }) as HTMLSelectElement;
    expect(sel.value).toBe("");
    expect(sel.options[0].textContent).toBe(VOICE_FOLLOW_NARRATOR_LABEL);
  });

  it("選ぶと場面の話者になり、声は作り直しが要る状態に戻る（取り消せる）・同じ声を選び直しても戻さない", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    const sel = screen.getByRole("combobox", { name: "この場面の声" });
    fireEvent.change(sel, { target: { value: "2" } });
    expect(useProjectStore.getState().scenes[0].narration).toMatchObject({ speaker: 2, status: "none" });
    expect(useProjectStore.getState().past.length).toBeGreaterThan(0);
    // 作り直したとして、同じ声をもう一度選んでも作り直しにしない
    useProjectStore.setState({ scenes: [soloScene({ speaker: 2 })], past: [] });
    fireEvent.change(sel, { target: { value: "2" } });
    expect(useProjectStore.getState().scenes[0].narration.status).toBe("generated");
    // 空に戻す＝設定の声
    fireEvent.change(sel, { target: { value: "" } });
    expect(useProjectStore.getState().scenes[0].narration).toMatchObject({ speaker: null, status: "none" });
  });

  it("掛け合いの場面では出さず、行の欄の「選ばない」も同じ言葉", () => {
    setScene(dialogueScene());
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(screen.queryByRole("combobox", { name: "この場面の声" })).toBeNull();
    const lineSel = screen.getAllByRole("combobox").find((s) => (s as HTMLSelectElement).value === "2") as HTMLSelectElement;
    expect(lineSel.options[0].textContent).toBe(VOICE_FOLLOW_NARRATOR_LABEL);
  });
});
