// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import type { Scene } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";
import { SceneEditScreen } from "./SceneEditScreen";

// #555：通常テンプレの文字の体裁（色/サイズ/太さ/縁取り）を場面別に上書きできる。配置はテンプレのまま（§2-4）。
// 継承の流儀は「その種別のフォント」（#178）と同じ＝**触ったものだけが固有値**。
const tpl = {
  schemaVersion: "1.0", templateId: "opening_yuko_right_v1", name: "オープニング", category: "opening",
  aspectRatio: "16:9", canvas: { width: 1920, height: 1080 }, defaults: { backgroundColor: "#ffffff" },
  layers: [
    { id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 },
    { id: "title", type: "text", textKey: "title", x: 160, y: 360, w: 1100, h: 140, zIndex: 30, fontSize: 72, fontWeight: "bold" },
  ],
} as unknown as Template;

const baseScene = (extra?: Partial<Scene>): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "opening", templateId: "opening_yuko_right_v1",
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" },
    texts: { title: "タイトル" }, narration: { text: "", status: "none" }, warnings: [], ...extra,
  }) as unknown as Scene;

const setup = (extra?: Partial<Scene>) => {
  useProjectStore.setState({
    templates: [tpl],
    parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
    scenes: [baseScene(extra)],
    assets: [], editingSceneId: "scene_001",
    past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
  });
  render(<SceneEditScreen onNavigate={vi.fn()} />);
  return () => useProjectStore.getState().scenes[0];
};

// 体裁欄は既定で閉じている（#550＝開かない人のスクロール量を増やさない）ので、開いてから掴む。
const openStyles = (): HTMLElement => {
  const summary = screen.getByText(/^見出しの見た目/);
  fireEvent.click(summary);
  return summary.closest("details") as HTMLElement;
};

describe("SceneEditScreen 文字の体裁の場面別上書き（#555）", () => {
  beforeEach(() => {
    useProjectStore.setState({ past: [], future: [], _historyGroupDepth: 0 });
  });

  // 「閉じている」は details.open で見る。jsdom は閉じた <details> の中身も DOM に残す（実ブラウザだけが
  // 視覚的に畳む）ので、子要素の有無で確かめると常に緑になってしまう＝畳まれているか検査できていない。
  it("体裁の欄は既定で畳んでおく（開かない人のスクロール量を増やさない・#550）", () => {
    setup();
    const details = screen.getByText(/^見出しの見た目/).closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    fireEvent.click(screen.getByText(/^見出しの見た目/));
    expect(details.open).toBe(true); // 開ける
  });

  it("大きさの欄は空＝継承で、テンプレの実値をプレースホルダに出す（何が継承されるか見える）", () => {
    setup();
    const panel = openStyles();
    const size = within(panel).getByLabelText("文字の大きさ") as HTMLInputElement;
    expect(size.value).toBe(""); // 空＝テンプレに合わせる
    expect(size.placeholder).toBe("72"); // テンプレ層の fontSize
  });

  it("大きさを入れると場面の上書きになり、空に戻すと継承へ戻る", () => {
    const scene = setup();
    const panel = openStyles();
    const size = within(panel).getByLabelText("文字の大きさ") as HTMLInputElement;
    fireEvent.focus(size);
    fireEvent.change(size, { target: { value: "96" } });
    fireEvent.blur(size);
    expect(scene().textStyles?.title?.fontSize).toBe(96);
    // 空にして確定＝継承へ戻す（キーごと落ちる＝意味のない {} を残さない）
    fireEvent.focus(size);
    fireEvent.change(size, { target: { value: "" } });
    fireEvent.blur(size);
    expect(scene().textStyles).toBeUndefined();
  });

  it("太さは「見た目パターンに合わせる」を既定にし、選ぶと上書きになる", () => {
    const scene = setup();
    const panel = openStyles();
    const weight = within(panel).getByLabelText("太さ") as HTMLSelectElement;
    expect(weight.value).toBe(""); // 継承
    fireEvent.change(weight, { target: { value: "normal" } });
    expect(scene().textStyles?.title?.fontWeight).toBe("normal"); // テンプレの bold を上書きできる
    fireEvent.change(weight, { target: { value: "" } });
    expect(scene().textStyles).toBeUndefined(); // 継承へ戻せる
  });

  it("触ったものだけが固有値＝他のプロパティは継承のまま保存されない", () => {
    const scene = setup();
    const panel = openStyles();
    const size = within(panel).getByLabelText("文字の大きさ") as HTMLInputElement;
    fireEvent.focus(size);
    fireEvent.change(size, { target: { value: "96" } });
    fireEvent.blur(size);
    expect(scene().textStyles?.title).toEqual({ fontSize: 96 }); // color/fontWeight 等は入らない
  });

  it("上書き中は見出しに出し、「戻す」で全部まとめて継承へ戻せる（触ると戻せない、を作らない）", () => {
    const scene = setup({ textStyles: { title: { color: "#ff0000", fontSize: 96 } } });
    expect(screen.getByText(/この場面だけ変更中/)).toBeTruthy();
    const panel = openStyles();
    fireEvent.click(within(panel).getByText("見た目パターンの文字づかいに戻す"));
    expect(scene().textStyles).toBeUndefined();
    expect(screen.queryByText(/この場面だけ変更中/)).toBeNull();
  });

  it("上書きが無いときは「戻す」を出さない", () => {
    setup();
    const panel = openStyles();
    expect(within(panel).queryByText("見た目パターンの文字づかいに戻す")).toBeNull();
  });

  it("Undo で戻せる（履歴に載る）", () => {
    const scene = setup();
    const panel = openStyles();
    const size = within(panel).getByLabelText("文字の大きさ") as HTMLInputElement;
    fireEvent.focus(size);
    fireEvent.change(size, { target: { value: "96" } });
    fireEvent.blur(size);
    expect(scene().textStyles?.title?.fontSize).toBe(96);
    useProjectStore.getState().undo();
    expect(scene().textStyles).toBeUndefined();
  });
});
