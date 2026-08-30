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

// #264 の影・字間・背景帯も同じ欄で場面別に上書きできる（差分再監査 4巡目 🟡＋PR #913 レビュー 🟡）。
// ⚠️ 影と帯は `resolveTextStyle` が**まるごと差し替え**で解く（`ov?.shadow ?? layer.shadow`）ので、
// 入／切と数値の見せ方を上書きの有無で作ると「見た目パターン側で付いている帯を『切』と偽る」
// 「1項目だけ書いて残りが既定へ落ちる（黙って別の絵）」が起きる＝そこを固定する。
const decoTpl = {
  ...tpl,
  layers: [
    tpl.layers[0],
    { ...tpl.layers[1], shadow: { enabled: true, color: "#123456", opacity: 0.4, blur: 3, dx: 2, dy: 1 }, background: { enabled: true, color: "#654321", opacity: 0.6, radius: 8 } },
  ],
} as unknown as Template;

const setupDeco = (extra?: Partial<Scene>) => {
  useProjectStore.setState({
    templates: [decoTpl],
    parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
    scenes: [baseScene(extra)], assets: [], editingSceneId: "scene_001",
    past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
  });
  render(<SceneEditScreen onNavigate={vi.fn()} />);
  return () => useProjectStore.getState().scenes[0];
};

describe("SceneEditScreen 文字の影・字間・背景帯の場面別上書き（#264）", () => {
  it("字間を入れると上書きになり、空に戻すと継承へ戻る", () => {
    const scene = setup();
    const panel = openStyles();
    const ls = within(panel).getByLabelText("字間") as HTMLInputElement;
    fireEvent.focus(ls);
    fireEvent.change(ls, { target: { value: "0.2" } });
    fireEvent.blur(ls);
    expect(scene().textStyles?.title?.letterSpacing).toBeCloseTo(0.2);
    fireEvent.focus(ls);
    fireEvent.change(ls, { target: { value: "" } });
    fireEvent.blur(ls);
    expect(scene().textStyles).toBeUndefined();
  });

  it("入／切は「いま描かれているか」を出す（見た目パターンが付けている影・帯を『切』と偽らない）", () => {
    setupDeco();
    const panel = openStyles();
    expect(within(panel).getByRole("switch", { name: "見出しに影を付ける" })).toBeChecked();
    expect(within(panel).getByRole("switch", { name: "見出しに背景帯を付ける" })).toBeChecked();
  });

  it("継承している影を切ると、明示的に「切」と書く（落として継承へ戻すと切れないため）", () => {
    const scene = setupDeco();
    const panel = openStyles();
    fireEvent.click(within(panel).getByRole("switch", { name: "見出しに影を付ける" }));
    expect(scene().textStyles?.title?.shadow?.enabled).toBe(false);
    expect(within(panel).getByRole("switch", { name: "見出しに影を付ける" })).not.toBeChecked();
  });

  it("見た目パターンが付けていない帯は、切に戻すと上書きごと落ちる（意味のない上書きを残さない）", () => {
    const scene = setup();
    const panel = openStyles();
    const sw = within(panel).getByRole("switch", { name: "見出しに背景帯を付ける" });
    fireEvent.click(sw);
    expect(scene().textStyles?.title?.background?.enabled).toBe(true);
    fireEvent.click(within(panel).getByRole("switch", { name: "見出しに背景帯を付ける" }));
    expect(scene().textStyles).toBeUndefined();
  });

  it("継承中に1項目だけ触っても、残りの設定を引き継ぐ（黙って別の絵にしない）", () => {
    const scene = setupDeco();
    const panel = openStyles();
    const radius = within(panel).getByLabelText("角丸") as HTMLInputElement;
    expect(radius.value).toBe("8"); // 継承中もテンプレの実値を出す
    fireEvent.focus(radius);
    fireEvent.change(radius, { target: { value: "24" } });
    fireEvent.blur(radius);
    expect(scene().textStyles?.title?.background).toEqual({ enabled: true, color: "#654321", opacity: 0.6, radius: 24 });
  });

  it("影のぼかしも同じく残りを引き継ぐ", () => {
    const scene = setupDeco();
    const panel = openStyles();
    const blur = within(panel).getByLabelText("ぼかし") as HTMLInputElement;
    expect(blur.value).toBe("3");
    // 濃さも継承中の実値を出す（影＝40%／帯＝60%。上書き側から読むと両方とも既定に化ける）
    const opacities = within(panel).getAllByLabelText("濃さ(%)") as HTMLInputElement[];
    expect(opacities.map((o) => o.value)).toEqual(["40", "60"]);
    fireEvent.focus(blur);
    fireEvent.change(blur, { target: { value: "9" } });
    fireEvent.blur(blur);
    expect(scene().textStyles?.title?.shadow).toEqual({ enabled: true, color: "#123456", opacity: 0.4, blur: 9, dx: 2, dy: 1 });
  });

  it("切のときは詳細を出さない", () => {
    setup();
    const panel = openStyles();
    expect(within(panel).queryByText("影の色")).toBeNull();
    expect(within(panel).queryByText("背景色")).toBeNull();
  });

  it("見た目パターンが付けていない影も、切に戻すと上書きごと落ちる", () => {
    const scene = setup();
    const panel = openStyles();
    const sw = () => within(panel).getByRole("switch", { name: "見出しに影を付ける" });
    fireEvent.click(sw());
    expect(scene().textStyles?.title?.shadow?.enabled).toBe(true);
    fireEvent.click(sw());
    expect(scene().textStyles).toBeUndefined();
  });

  // 入→切→入で**差分ゼロの上書き**が残ると、①絵は同じなのに「この場面だけ変更中」と出る（嘘）
  // ②以後この場面だけ見た目パターンの変更に追従しない（見た目パターンは編集できる＝ADR-0017）。
  it("入→切→入で往復しても、見た目パターンと同じ値なら上書きを残さない", () => {
    const scene = setupDeco();
    const panel = openStyles();
    const sw = () => within(panel).getByRole("switch", { name: "見出しに背景帯を付ける" });
    fireEvent.click(sw()); // 切
    expect(scene().textStyles?.title?.background?.enabled).toBe(false);
    fireEvent.click(sw()); // 入＝見た目パターンと同じ絵へ戻った
    expect(scene().textStyles).toBeUndefined();
    expect(screen.queryByText(/この場面だけ変更中/)).toBeNull();
  });

  // ⚠️ **同じ絵に戻したら上書きは残さない**（差分再監査 5巡目 ℹ️）＝生の値で比べると、色を変えて
  // 見た目パターンと同じ色へ戻したときに絵は同じなのに「この場面だけ変更中」が残る（嘘＋追従切れ）。
  it("色を変えて見た目パターンと同じ色へ戻したら、上書きが残らない", () => {
    const scene = setupDeco();
    const panel = openStyles();
    const pick = (name: string): void => {
      fireEvent.click(within(panel).getByRole("button", { name: "見出しの背景色を選ぶ" }));
      const code = screen.getByLabelText("色コード");
      fireEvent.change(code, { target: { value: name } });
      fireEvent.blur(code); // 確定は Enter か欄を出たとき（#752-1）
      fireEvent.keyDown(window, { key: "Escape" }); // 閉じてから次を開く（開いたまま押すと閉じるだけ）
    };
    // 欄が開いていることを先に確かめる（開いていないと以降が無言で素通りする）
    expect(within(panel).getByRole("button", { name: "見出しの背景色を選ぶ" })).toBeTruthy();
    pick("#123456");
    expect(scene().textStyles?.title?.background?.color).toBe("#123456");
    pick("#654321"); // 見た目パターンと同じ色へ戻す
    expect(scene().textStyles).toBeUndefined();
  });

  it("影も同じく往復で上書きが残らない", () => {
    const scene = setupDeco();
    const panel = openStyles();
    const sw = () => within(panel).getByRole("switch", { name: "見出しに影を付ける" });
    fireEvent.click(sw());
    fireEvent.click(sw());
    expect(scene().textStyles).toBeUndefined();
  });

  it("「すべて見た目パターンに合わせる」で影・字間・帯も戻る", () => {
    const scene = setup({ textStyles: { title: { letterSpacing: 0.2, shadow: { enabled: true }, background: { enabled: true } } } });
    const panel = openStyles();
    fireEvent.click(within(panel).getByText("すべて見た目パターンに合わせる"));
    expect(scene().textStyles).toBeUndefined();
  });
});

// 休眠の種別ごとフォント（差分再監査 6巡目 🟡）。
//
// ⚠️ **書き出しの門は休眠のぶんも数えて断る**（`usedFonts`）のに、欄が「いま使う種別」だけだと
// 持ち込みフォントが手元から消えたとき**案内どおりに選び直す先が無い**（§2-5 の行き止まり）。
// タイムライン側と同じ規則（`editableTextKeys`）＝片方だけ直る形にしない。
describe("SceneEditScreen いま使っていない種別のフォント", () => {
  const openScene = (textFontIds?: object): (() => Scene) => {
    useProjectStore.setState({
      templates: [tpl],
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [baseScene(textFontIds ? ({ textFontIds } as Partial<Scene>) : undefined)],
      assets: [], editingSceneId: "scene_001",
      past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
    });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    return () => useProjectStore.getState().scenes[0];
  };

  it("指定が残っていれば、いま使っていない種別でも直せる", () => {
    openScene({ subtitle: "gen-interface-jp" }); // この見た目パターンに字幕の層は無い
    expect(screen.getByText("字幕のフォント")).toBeInTheDocument();
    expect(screen.getByText(/いまの見た目パターンでは使っていない文字/)).toBeInTheDocument();
  });

  // ⚠️ **自由配置の場面でも出す**（差分再監査 7巡目 🟡）＝門は場面の種類を見ずに数えるので、
  // 「文字」節（通常テンプレだけ）の中に置くと切り替えた場面で選び直す先が無くなる。
  it("自由配置の場面でも直せる（切り替えても指定は休眠のまま残る）", () => {
    useProjectStore.setState({
      // 自由配置の見た目は文字の層を持たない＝この場面では見出しの指定が休眠になる。
      templates: [{ ...tpl, templateId: "free_canvas_v1", category: "free", layers: [tpl.layers[0]] } as unknown as Template],
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [baseScene({ templateId: "free_canvas_v1", sceneType: "free", textFontIds: { title: "gen-interface-jp" } } as Partial<Scene>)],
      assets: [], editingSceneId: "scene_001", past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
    });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("見出しのフォント")).toBeInTheDocument();
  });

  it("見た目パターンが見つからない場面でも直せる（値が入っているのに欄が出ない、を作らない）", () => {
    useProjectStore.setState({
      templates: [],
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [baseScene({ textFontIds: { title: "gen-interface-jp" } } as Partial<Scene>)],
      assets: [], editingSceneId: "scene_001", past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
    });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("見出しのフォント")).toBeInTheDocument();
  });

  it("指定が無ければ出さない（使っていないものを並べない）", () => {
    openScene();
    expect(screen.queryByText("字幕のフォント")).toBeNull();
    expect(screen.queryByText(/いまの見た目パターンでは使っていない文字/)).toBeNull();
  });

  it("いま使う種別の欄には出さない（二重に並べない）", () => {
    openScene({ title: "gen-interface-jp" });
    expect(screen.getAllByText("見出しのフォント")).toHaveLength(1);
    expect(screen.queryByText(/いまの見た目パターンでは使っていない文字/)).toBeNull();
  });
});

// 自由配置の要素のフォントも、門は休眠のぶんまで数える（差分再監査 8巡目 🟡）。
//
// ⚠️ 直す欄は自由配置の場面にしかないので、通常テンプレへ切り替えた場面では選び直す先が
// 1つも無くなる（書き出しが止まったまま解除できない＝§2-5 の行き止まり）。
describe("SceneEditScreen 休眠した自由配置の要素のフォント", () => {
  const openScene = (over: Partial<Scene>): void => {
    useProjectStore.setState({
      templates: [tpl],
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [baseScene(over)],
      assets: [], editingSceneId: "scene_001", past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
    });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
  };

  it("通常テンプレの場面でも、休眠した要素のフォントを直せる", () => {
    openScene({ freeLayout: [{ id: "free_001", kind: "text", x: 0, y: 0, w: 100, h: 40, text: "あ", fontId: "gen-interface-jp" }] } as Partial<Scene>);
    // 要素の表示名（自動名）つきの欄が出る＝どれを直すのか分かる。
    const hint = screen.getByText(/いまの見た目パターンでは使っていない文字/);
    expect(within(hint.parentElement as HTMLElement).getByText(/のフォント$/)).toBeInTheDocument();
  });

  // ⚠️ **絞るのは「実際に『文字』節へ出るキー」**（差分再監査 8巡目 🟡）＝あちらの節は自由配置では
  // 描かれないので、見た目パターンが使う種別で絞ると**文字層を持つ自由配置の見た目**（自作できる）で
  // どちらにも出ないキーができる（門は種類を見ずに数えるので、そのまま行き止まりになる）。
  // ⚠️ **描かれているものを「使っていない」と言わない**（差分再監査 9巡目 🟡）＝自由配置の見た目でも
  // 文字層は描かれる（`layoutScene` は種類で切らない）ので、案内どおり戻すと**出ている字体が変わる**。
  it("文字の層を持つ自由配置の見た目では、「使っていない」と言わない", () => {
    useProjectStore.setState({
      templates: [{ ...tpl, templateId: "user_tmpl_001", category: "free" } as unknown as Template],
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [baseScene({ templateId: "user_tmpl_001", sceneType: "free", textFontIds: { title: "gen-interface-jp" } } as Partial<Scene>)],
      assets: [], editingSceneId: "scene_001", past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
    });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("見出しのフォント")).toBeInTheDocument();
    expect(screen.queryByText(/いまの見た目パターンでは使っていない文字/)).toBeNull();
    expect(screen.getByText(/この見た目パターンの文字は、ここでフォントだけ選べます/)).toBeInTheDocument();
  });

  // ⚠️ **書き出しを止めている理由も畳める場所に置かない**（差分再監査 9巡目 🟡）＝
  // `<details>` は畳んでも中身が DOM に残るので、**位置そのもの**を固定しないと戻っても気づけない。
  it("見た目が見つからないときの理由は、畳める節の外に出す", () => {
    useProjectStore.setState({
      templates: [], // 見た目が解決できない
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [baseScene()],
      assets: [], editingSceneId: "scene_001", past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
    });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    // ⚠️ **候補ゼロなら「選び直して」と言わない**（差分再監査 10巡目 🟡）＝実行できない次の行動。
    // 節の外の断りは `role="alert"`（節の中の同じ文言と取り違えない）。
    const notice = screen.getByRole("alert");
    // ⚠️ **できない手を名指ししない**＝見た目が1つも無い状態では、種類も変えられず作成の入口も出ない。
    expect(notice.textContent).toContain("見た目パターンが読み込まれていません。アプリを開き直してください。");
    // ⚠️ **行き先は分岐に依らず出す**（次の行動の置き場所も同じ節の中）。
    expect(notice.textContent).toContain("（下の「見た目・フォント」にあります）");
    expect(notice.closest("details")).toBeNull();
    // ⚠️ **存在しない見た目について語らない**＝別の次の行動が並ぶ。
    expect(screen.queryByText("この見た目パターンは文字を表示しません。")).toBeNull();
  });

  // ⚠️ **調べていない ≠ 使っていない**（差分再監査 10巡目 🟡）＝見た目が見つからないと「使っているか」は
  // 分からない。「使っていない」と言って戻させると、見た目が戻った時点で**字体が黙って変わる**。
  it("見た目が見つからない場面では「使っていない」と言わない", () => {
    useProjectStore.setState({
      templates: [],
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [baseScene({ textFontIds: { title: "gen-interface-jp" } } as Partial<Scene>)],
      assets: [], editingSceneId: "scene_001", past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
    });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("見出しのフォント")).toBeInTheDocument(); // 直せることは変えない
    expect(screen.queryByText(/いまの見た目パターンでは使っていない文字/)).toBeNull();
    expect(screen.getByText(/見た目が見つからないので、どの文字に使っているかは分かりません/)).toBeInTheDocument();
  });

  // ⚠️ **自由配置の要素側にも同じ規則**（差分再監査 11巡目 🟡）＝`isFree` は見た目が見つからないとき
  // false になるので、素通しだと全要素が「休眠」に落ちる（消えた見た目が自由配置なら描かれる）。
  it("見た目が見つからない場面では、要素のフォントも「使っていない」と言わない", () => {
    useProjectStore.setState({
      templates: [],
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [baseScene({ freeLayout: [{ id: "free_001", kind: "text", x: 0, y: 0, w: 100, h: 40, text: "あ", fontId: "gen-interface-jp" }] } as Partial<Scene>)],
      assets: [], editingSceneId: "scene_001", past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
    });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText(/いまの見た目パターンでは使っていない文字/)).toBeNull();
    expect(screen.getByText(/見た目が見つからないので、どの文字に使っているかは分かりません/)).toBeInTheDocument();
    // 直せることは変えない（知らせの群の中に欄がある）。
    const hint = screen.getByText(/見た目が見つからないので、どの文字に使っているかは分かりません/);
    expect(within(hint.parentElement as HTMLElement).getByText(/のフォント$/)).toBeInTheDocument();
  });

  // ⚠️ **同時に持っていても同じ群に入る**（PR #920 レビュー ℹ️）＝片方ずつしか見ていないと、
  // 条件を片方だけ壊しても気づけない（「同じ群」であること自体を固定する）。
  it("種別ごとと要素の両方が残っていても、まとめて「分かりません」の群に入る", () => {
    useProjectStore.setState({
      templates: [],
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [baseScene({
        textFontIds: { title: "gen-interface-jp" },
        freeLayout: [{ id: "free_001", kind: "text", x: 0, y: 0, w: 100, h: 40, text: "あ", fontId: "kaitou-yokoku-gothic" }],
      } as Partial<Scene>)],
      assets: [], editingSceneId: "scene_001", past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
    });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText(/いまの見た目パターンでは使っていない文字/)).toBeNull();
    const hint = screen.getByText(/見た目が見つからないので、どの文字に使っているかは分かりません/);
    // ⚠️ **「同じ群」は位置で見る**（PR #920 レビュー ℹ️）＝親要素で見ると別の群の欄まで拾うので、
    // 「知らせの直後に2つ並ぶ」ことを固定する（群を動かす変異を検知できる形）。
    const fields = [...(hint.parentElement as HTMLElement).querySelectorAll(".field")]
      .filter((n) => /のフォント$/.test(n.querySelector("label")?.textContent ?? ""));
    expect(fields).toHaveLength(2);
    for (const f of fields) {
      // 知らせ → 欄 の順（`DOCUMENT_POSITION_FOLLOWING` = 4）。
      expect(hint.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("指定が1つも無ければ知らせを出さない（片づける対象が無いのに片づけを勧めない）", () => {
    useProjectStore.setState({
      templates: [{ ...tpl, templateId: "user_tmpl_001", category: "free" } as unknown as Template],
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [baseScene({ templateId: "user_tmpl_001", sceneType: "free" } as Partial<Scene>)],
      assets: [], editingSceneId: "scene_001", past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
    });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText(/いまの見た目パターンでは使っていない文字/)).toBeNull();
  });

  // ⚠️ **自由配置の場面では二重に並べない**（要素は自由配置の編集面で直せる）。
  it("自由配置の場面では、要素のフォントをここに並べない", () => {
    useProjectStore.setState({
      templates: [{ ...tpl, templateId: "free_canvas_v1", category: "free", layers: [tpl.layers[0]] } as unknown as Template],
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [baseScene({ templateId: "free_canvas_v1", sceneType: "free", freeLayout: [{ id: "free_001", kind: "text", x: 0, y: 0, w: 100, h: 40, text: "あ", fontId: "gen-interface-jp" }] } as Partial<Scene>)],
      assets: [], editingSceneId: "scene_001", past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
    });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText(/いまの見た目パターンでは使っていない文字/)).toBeNull();
    // ⚠️ **どちらの群も出さない**（tests 🟡）＝片方の文言だけ見ると、群を取り違える変異を検知できない。
    expect(screen.queryByText(/この見た目パターンの文字は、ここでフォントだけ選べます/)).toBeNull();
    expect(screen.queryByText(/見た目が見つからないので、どの文字に使っているかは分かりません/)).toBeNull();
  });

  it("文字の層を持つ自由配置の見た目でも、種別ごとのフォントを直せる", () => {
    useProjectStore.setState({
      // 自作の自由配置テンプレは文字の層を持てる（`TEMPLATE_ADDABLE_LAYER_TYPES` に text がある）。
      templates: [{ ...tpl, templateId: "user_tmpl_001", category: "free" } as unknown as Template],
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [baseScene({ templateId: "user_tmpl_001", sceneType: "free", textFontIds: { title: "gen-interface-jp" } } as Partial<Scene>)],
      assets: [], editingSceneId: "scene_001", past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
    });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("見出しのフォント")).toBeInTheDocument();
  });

  it("選び直すと、その要素のフォントだけが変わる（他の要素は触らない）", () => {
    openScene({ freeLayout: [
      { id: "free_001", kind: "text", x: 0, y: 0, w: 100, h: 40, text: "あ", fontId: "gen-interface-jp" },
      { id: "free_002", kind: "text", x: 0, y: 60, w: 100, h: 40, text: "い", fontId: "kaitou-yokoku-gothic" },
    ] } as Partial<Scene>);
    const hint = screen.getByText(/いまの見た目パターンでは使っていない文字/);
    // ⚠️ **2つ目を触る**＝1つ目だと「常に先頭へ書く」変異でも緑のまま通る（取り違えを検知できない）。
    const field = within(hint.parentElement as HTMLElement).getAllByText(/のフォント$/)[1].closest("div") as HTMLElement;
    fireEvent.click(field.querySelector("button.select") as HTMLElement);
    const option = [...field.querySelectorAll("button")].find(
      (b) => !b.classList.contains("select") && (b.textContent ?? "").startsWith("Gen Interface JP Display"),
    ) as HTMLElement;
    fireEvent.click(option);
    const els = useProjectStore.getState().scenes[0].freeLayout!;
    expect(els.find((e) => e.id === "free_002")!.fontId).toBe("gen-interface-jp-display");
    expect(els.find((e) => e.id === "free_001")!.fontId).toBe("gen-interface-jp"); // 他は不変
  });

  // ⚠️ **継承へ戻すとキーごと落ちる**（差分再監査 9巡目 ℹ️）＝`null` を残すと同じ絵の文書が2通りできる。
  it("「動画全体に合わせる」へ戻すと、キーごと落ちる（null を残さない）", () => {
    openScene({ freeLayout: [{ id: "free_001", kind: "text", x: 0, y: 0, w: 100, h: 40, text: "あ", fontId: "gen-interface-jp" }] } as Partial<Scene>);
    const hint = screen.getByText(/いまの見た目パターンでは使っていない文字/);
    const field = within(hint.parentElement as HTMLElement).getByText(/のフォント$/).closest("div") as HTMLElement;
    fireEvent.click(field.querySelector("button.select") as HTMLElement);
    const option = [...field.querySelectorAll("button")].find(
      (b) => !b.classList.contains("select") && (b.textContent ?? "").startsWith("動画全体に合わせる"),
    ) as HTMLElement;
    fireEvent.click(option);
    const el = useProjectStore.getState().scenes[0].freeLayout![0];
    expect("fontId" in el).toBe(false);
  });

  it("フォントの指定が無い要素は並べない", () => {
    openScene({ freeLayout: [{ id: "free_001", kind: "text", x: 0, y: 0, w: 100, h: 40, text: "あ" }] } as Partial<Scene>);
    expect(screen.queryByText(/いまの見た目パターンでは使っていない文字/)).toBeNull();
  });

  // ⚠️ **知らせは節の中に埋めない**＝畳んだ記憶は既定より優先されるので、一度畳むと二度と出ない。
  it("知らせは畳める節の外に出す（一度畳んだら二度と出ない、を作らない）", () => {
    openScene({ textFontIds: { subtitle: "gen-interface-jp" } } as Partial<Scene>);
    const hint = screen.getByText(/いまの見た目パターンでは使っていない文字/);
    expect(hint.closest("details")).toBeNull();
  });
});

describe("SceneEditScreen 場面ぜんぶのフォント", () => {
  // ⚠️ **継承へ戻すとキーごと落ちる**（差分再監査 11巡目 🟡＝3か所のうちここだけ双子が無かった）。
  it("「動画全体に合わせる」へ戻すと、キーごと落ちる", () => {
    useProjectStore.setState({
      templates: [tpl],
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [baseScene({ fontId: "gen-interface-jp" } as Partial<Scene>)],
      assets: [], editingSceneId: "scene_001", past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
    });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByText("見た目・フォント"));
    const field = screen.getByText("この場面のフォント").closest("div") as HTMLElement;
    fireEvent.click(field.querySelector("button.select") as HTMLElement);
    const option = [...field.querySelectorAll("button")].find(
      (b) => !b.classList.contains("select") && (b.textContent ?? "").startsWith("動画全体に合わせる"),
    ) as HTMLElement;
    fireEvent.click(option);
    expect("fontId" in useProjectStore.getState().scenes[0]).toBe(false);
  });
});

// 見た目が見つからない場面の見せ方（差分再監査 10巡目）。
describe("SceneEditScreen 見た目が見つからない場面", () => {
  // ⚠️ **候補があるときは行き先を名指しする**（差分再監査 11巡目 ℹ️）＝候補ゼロの分岐しか通っていなかった。
  it("候補があるときは「見た目・フォント」を名指しする", () => {
    useProjectStore.setState({
      templates: [tpl], // 選べる見た目はある
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [baseScene({ templateId: "gone" } as Partial<Scene>)],
      assets: [], editingSceneId: "scene_001", past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
    });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    const notice = screen.getByRole("alert");
    expect(notice.textContent).toContain("今の見た目が見つかりません。選び直してください。");
    expect(notice.textContent).toContain("（下の「見た目・フォント」にあります）");
  });

  const openUnresolved = (): void => {
    useProjectStore.setState({
      templates: [],
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [baseScene()],
      assets: [], editingSceneId: "scene_001", past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
    });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
  };

  // ⚠️ **空の入れ物を残さない**＝中身が空になるだけの節が残り、理由は節の外にある。
  it("「文字」の節そのものを出さない", () => {
    openUnresolved();
    expect(screen.queryByText("文字")).toBeNull();
  });

  it("見た目が解決できていれば「文字」の節は出る", () => {
    useProjectStore.setState({
      templates: [tpl],
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [baseScene()],
      assets: [], editingSceneId: "scene_001", past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
    });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("文字")).toBeInTheDocument();
  });
});
