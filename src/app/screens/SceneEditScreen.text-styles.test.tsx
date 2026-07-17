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
    fireEvent.click(within(panel).getByText("すべて見た目パターンに合わせる"));
    expect(scene().textStyles).toBeUndefined();
    expect(screen.queryByText(/この場面だけ変更中/)).toBeNull();
  });

  it("上書きが無いときは「戻す」を出さない", () => {
    setup();
    const panel = openStyles();
    expect(within(panel).queryByText("すべて見た目パターンに合わせる")).toBeNull();
  });

  // 色・縁取りも #555 の対象4軸。大きさ/太さだけ検証すると、この2つの UI 配線が無検証で通ってしまう。
  it("色を選ぶと場面の上書きになる（ColorPicker の配線）", () => {
    const scene = setup();
    const panel = openStyles();
    fireEvent.click(within(panel).getByRole("button", { name: "見出しの色を選ぶ" }));
    fireEvent.click(screen.getByRole("button", { name: "色 #22c55e" }));
    expect(scene().textStyles?.title?.color).toBe("#22c55e");
  });

  it("縁取りの色を選ぶと場面の上書きになる", () => {
    const scene = setup();
    const panel = openStyles();
    fireEvent.click(within(panel).getByRole("button", { name: "見出しの縁取りの色を選ぶ" }));
    fireEvent.click(screen.getByRole("button", { name: "色 #22c55e" }));
    expect(scene().textStyles?.title?.strokeColor).toBe("#22c55e");
  });

  it("縁取りの太さは空＝継承で、入れると上書き・空に戻すと継承へ戻る", () => {
    const scene = setup();
    const panel = openStyles();
    const sw = within(panel).getByLabelText("縁取りの太さ") as HTMLInputElement;
    expect(sw.value).toBe("");
    expect(sw.placeholder).toBe("0"); // テンプレ層に縁取りが無い＝0
    fireEvent.focus(sw);
    fireEvent.change(sw, { target: { value: "5" } });
    fireEvent.blur(sw);
    expect(scene().textStyles?.title?.strokeWidth).toBe(5);
    fireEvent.focus(sw);
    fireEvent.change(sw, { target: { value: "" } });
    fireEvent.blur(sw);
    expect(scene().textStyles).toBeUndefined();
  });

  // 縁取りは「太さ>0 で色未指定なら白」が実描画の既定（#275）。見本が継承値（＝縁取り無し）を出すと
  // 「実描画は白／見本は黒」のドリフトになる＝この欄が防ぐと謳っているもの（§2-7・#555 レビュー）。
  it("太さだけ足したときの縁取りの色の見本は、実描画と同じ既定（白）を出す", () => {
    setup({ textStyles: { title: { strokeWidth: 3 } } });
    const panel = openStyles();
    fireEvent.click(within(panel).getByRole("button", { name: "見出しの縁取りの色を選ぶ" }));
    expect(screen.getByLabelText("色コード")).toHaveValue("#ffffff"); // 継承値(縁取り無し→黒)ではない
  });

  // #555 レビュー P2：数値欄は空欄・太さは選択肢で個別に継承へ戻せるのに、色は ColorPicker が常に色を返すため
  // 「すべて戻す」しか無かった＝大きさを残して色だけ戻せない。同じ色を選び直しても固有値のまま残り、将来の
  // テンプレ変更に追従しなくなる（「触ったものだけ固有値」モデルから外れる）。
  it("色だけを個別に継承へ戻せる（他の上書きは残る）", () => {
    const scene = setup({ textStyles: { title: { color: "#ff0000", fontSize: 96 } } });
    const panel = openStyles();
    fireEvent.click(within(panel).getByRole("button", { name: "色を見た目パターンに合わせる" }));
    expect(scene().textStyles?.title).toEqual({ fontSize: 96 }); // 色だけ落ちて大きさは残る
  });

  it("縁取りの色だけを個別に継承へ戻せる", () => {
    const scene = setup({ textStyles: { title: { strokeColor: "#0000ff", strokeWidth: 4 } } });
    const panel = openStyles();
    fireEvent.click(within(panel).getByRole("button", { name: "縁取りの色を見た目パターンに合わせる" }));
    expect(scene().textStyles?.title).toEqual({ strokeWidth: 4 }); // 太さは残る
  });

  it("色の復帰ボタンは上書き中だけ出す（触っていない欄に戻す導線を出さない）", () => {
    setup();
    const panel = openStyles();
    expect(within(panel).queryByRole("button", { name: "色を見た目パターンに合わせる" })).toBeNull();
    expect(within(panel).queryByRole("button", { name: "縁取りの色を見た目パターンに合わせる" })).toBeNull();
  });

  it("色だけの上書きを戻すと textStyles ごと消える（意味のない {} を残さない）", () => {
    const scene = setup({ textStyles: { title: { color: "#ff0000" } } });
    const panel = openStyles();
    fireEvent.click(within(panel).getByRole("button", { name: "色を見た目パターンに合わせる" }));
    expect(scene().textStyles).toBeUndefined();
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
