// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { GROUP_MIN_SCALE } from "../../domain/constants";
import type { Scene } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";
import { SceneEditScreen } from "./SceneEditScreen";

// #554：グループの位置/大きさ/角度の数値入力（枠のつまみだけが唯一の手段＝逃げ道なし、の解消）。
// 欄そのものの単体挙動は GroupTransformFields.test.tsx。ここは**画面に繋いだ結果**＝store へ書けること、
// ロック中は書けないことを見る。
const freeTemplate = {
  schemaVersion: "1.0", templateId: "free_canvas_v1", name: "自由配置", category: "free", aspectRatio: "16:9",
  canvas: { width: 1920, height: 1080 }, defaults: { backgroundColor: "#ffffff" },
  layers: [{ id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 }],
} as unknown as Template;

const groupedScene = (locked?: boolean): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "free", templateId: "free_canvas_v1",
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" },
    freeLayout: [
      { id: "free_001", kind: "shape", x: 100, y: 100, w: 200, h: 200, zIndex: 1 },
      { id: "free_002", kind: "shape", x: 400, y: 100, w: 200, h: 200, zIndex: 2 },
    ],
    groups: [{ id: "group_001", members: ["free_001", "free_002"], transform: { x: 0, y: 0, rotation: 0, scale: 1 }, ...(locked ? { locked: true } : {}) }],
    warnings: [],
  }) as unknown as Scene;

const setup = (locked?: boolean) => {
  useProjectStore.setState({
    templates: [freeTemplate],
    parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
    scenes: [groupedScene(locked)],
    assets: [], editingSceneId: "scene_001",
    past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
  });
  render(<SceneEditScreen onNavigate={vi.fn()} />);
  // メンバーを1回押す＝グループ選択（ツールバー＋数値欄が出る）。
  const member = document.querySelector('[data-free-id="free_001"]') as HTMLElement;
  fireEvent.pointerDown(member, { button: 0, clientX: 150, clientY: 150, pointerId: 1 });
  fireEvent.pointerUp(member, { pointerId: 1 });
  return () => useProjectStore.getState().scenes[0].groups?.[0].transform;
};

// 欄はグループのパネル内に限定して掴む（各 FREE 要素の詳細にも同名の「横位置」欄があるため）。
const type = (label: string, value: string) => {
  const panel = screen.getByTestId("group-panel");
  const input = within(panel).getByLabelText(label) as HTMLInputElement;
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

describe("SceneEditScreen グループの数値入力（#554）", () => {
  beforeEach(() => {
    useProjectStore.setState({ past: [], future: [], _historyGroupDepth: 0 });
  });

  it("大きさ(%) が store の拡大率に入る＝つまみで届かない下限まで縮められる", () => {
    const transform = setup();
    expect(screen.getByText(/グループを選択中/)).toBeTruthy();
    type("大きさ(%)", "1");
    expect(transform()?.scale).toBe(GROUP_MIN_SCALE); // 旧下限 0.1 の 1/10 まで到達
  });

  it("位置・角度も store に入る（変更した項目だけ・他は保つ）", () => {
    const transform = setup();
    type("横位置", "40");
    expect(transform()).toMatchObject({ x: 40, y: 0, rotation: 0, scale: 1 });
    type("角度", "30");
    expect(transform()).toMatchObject({ x: 40, rotation: 30, scale: 1 });
  });

  it("Undo で戻せる（履歴に載る）", () => {
    const transform = setup();
    type("大きさ(%)", "250");
    expect(transform()?.scale).toBe(2.5);
    useProjectStore.getState().undo();
    expect(transform()?.scale).toBe(1);
  });

  // ロック中は fieldset で欄を無効化しているが、**jsdom は fieldset disabled を子 input へ伝播しない**ため
  // この経路は UI ガードを素通りする＝ここで守っているのは `transformGroup` のストア側ガード（多重防御・
  // #319 の流儀に揃えた・#554 レビュー）。実機では fieldset が先に止める。
  it("ロック中のグループは数値欄からも変えられない（ストア側の多重防御）", () => {
    const transform = setup(true);
    expect(screen.getByText(/ロック中/)).toBeTruthy();
    type("大きさ(%)", "250");
    expect(transform()?.scale).toBe(1); // 変わらない
    type("横位置", "40");
    expect(transform()?.x).toBe(0);
  });
});
