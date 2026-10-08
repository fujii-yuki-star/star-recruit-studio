// @vitest-environment jsdom
// 欄の配置の画面側（ADR-0033 段階2/3）。**掴んで動かす**と**境界で大きさを変える**を固定する。
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
// 押下は**時刻を固定するヘルパー**を通す（#645）＝並列実行の負荷で押下の間隔が化けない。
// ここは二度押しではないが、同じファイルに「押す→離す→押す」が並ぶので同じ流儀にそろえる。
import { pointerDownAt } from "../../../test/pointer";
import { PanelLayoutView } from "./PanelLayoutView";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// ⚠️ **拾い方は1か所**（`src/test/cssRules.ts`）＝`timelineMetrics.test.ts` と同じ取り出しを使う。
import { ruleBody } from "../../../test/cssRules";
import { SPLIT_DIR, emptyLayout, isSplit, placedPanelIds } from "../../../domain/layout/panelLayout";
import type { PanelLayout } from "../../../domain/layout/panelLayout";

const panels = [
  { id: "a", title: "あ", content: <p>あの中身</p> },
  { id: "b", title: "い", content: <p>いの中身</p> },
];

/** 左に「あ」・右に「い」を置いた配置。 */
function sideBySide(): PanelLayout {
  const l = emptyLayout();
  l.nodes.left = { panelId: "a" };
  l.nodes.center = { panelId: "b" };
  return l;
}

/** jsdom は大きさを持たないので、欄の箱を置く（当たり判定はこの箱で決まる）。 */
function stubBoxes(boxes: Record<string, { left: number; top: number; width: number; height: number }>): void {
  for (const [id, box] of Object.entries(boxes)) {
    const el = document.querySelector(`[data-panel-id="${id}"]`) as HTMLElement;
    el.getBoundingClientRect = () => ({ ...box, right: box.left + box.width, bottom: box.top + box.height, x: box.left, y: box.top, toJSON: () => ({}) });
  }
}

const drag = (from: HTMLElement, to: { x: number; y: number }): void => {
  pointerDownAt(from, 1000, { clientX: 0, clientY: 0 });
  // `buttons: 1`＝押したまま動かしている（実際のイベントと同じ。0 は「もう離している」の意味）。
  fireEvent.pointerMove(window, { buttons: 1, clientX: to.x, clientY: to.y, pointerId: 1 });
  fireEvent.pointerUp(window, { clientX: to.x, clientY: to.y, pointerId: 1 });
};

describe("PanelLayoutView", () => {
  // ⚠️ **実機で踏んだ**（#1104）＝「並び」の欄は道具立てと帯が縦に並ぶので、**欄ごと**流すと
  // 帯を見に下へ送った瞬間に「列を足す」が画面の外へ出る（列を12本にすると足せなくなった）。
  // 流す役を中身へ渡す印がこのクラス。⚠️ **既定では付けない**＝ほかの欄は欄ごと流すまま。
  it("`fillBody` の欄だけ、中身に流す役を渡す印が付く", () => {
    const { container } = render(
      <PanelLayoutView
        layout={sideBySide()}
        panels={[
          { id: "a", title: "あ", content: <p>あの中身</p>, fillBody: true },
          { id: "b", title: "い", content: <p>いの中身</p> },
        ]}
        onChange={vi.fn()}
      />,
    );
    const bodyOf = (id: string): HTMLElement =>
      container.querySelector(`[data-panel-id="${id}"] .panel-frame-body`) as HTMLElement;
    expect(bodyOf("a").classList.contains("panel-frame-body--fill")).toBe(true);
    expect(bodyOf("b").classList.contains("panel-frame-body--fill")).toBe(false);
    // 印を付けても、中身の箱そのものは同じ綴りのまま（探している側を取り違えさせない）。
    expect(bodyOf("a").classList.contains("panel-frame-body")).toBe(true);
  });

  // ⚠️ **印だけでは効かない**＝印に対応する書き方が無ければ、欄は今までどおり自分で流す
  // （＝実機では「列を足す」が画面の外へ出たまま）。jsdom は CSS を読まないので**書き方を見る**。
  it("`fillBody` の印に、欄が流さない書き方が伴っている", () => {
    const theme = readFileSync(join(process.cwd(), "src/styles/theme.css"), "utf8");
    const fill = ruleBody(theme, ".panel-frame-body--fill");
    expect(fill).not.toBeNull();
    // ⚠️ **欄では流さない**＝中身にも流す場所があると縦棒が二重になり、どちらが動くか押すまで分からない。
    expect(/overflow:\s*hidden\s*;/.test(fill ?? "")).toBe(true);
    // 中身を縦に積む（道具立て → 帯 → 「列を足す」の順に積み、帯だけが伸び縮みする）。
    expect(fill).toContain("flex-direction: column");
  });

  it("欄の見出しと中身を出す", () => {
    render(<PanelLayoutView layout={sideBySide()} panels={panels} onChange={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "あ" })).toBeInTheDocument();
    expect(screen.getByText("いの中身")).toBeInTheDocument();
  });

  it("見出しをつかんで、ほかの欄の辺へ落とすと移る（段階3）", () => {
    const onChange = vi.fn();
    render(<PanelLayoutView layout={sideBySide()} panels={panels} onChange={onChange} />);
    stubBoxes({ a: { left: 0, top: 0, width: 100, height: 100 }, b: { left: 100, top: 0, width: 100, height: 100 } });
    // 「あ」の見出しをつかみ、「い」の**下寄り**へ落とす＝「い」の下に入る。
    drag(screen.getByRole("heading", { name: "あ" }).parentElement!, { x: 150, y: 95 });
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as PanelLayout;
    expect(next.nodes.left).toBeNull();
    expect(next.nodes.center && isSplit(next.nodes.center) && next.nodes.center.dir).toBe(SPLIT_DIR.column);
    expect(placedPanelIds(next)).toEqual(["b", "a"]);
  });

  it("少し動かすまでは掴まない（見出しを押しただけで動かさない）", () => {
    const onChange = vi.fn();
    render(<PanelLayoutView layout={sideBySide()} panels={panels} onChange={onChange} />);
    stubBoxes({ a: { left: 0, top: 0, width: 100, height: 100 }, b: { left: 100, top: 0, width: 100, height: 100 } });
    const head = screen.getByRole("heading", { name: "あ" }).parentElement!;
    pointerDownAt(head, 1000, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { buttons: 1, clientX: 11, clientY: 11, pointerId: 1 }); // 1px＝掴まない
    fireEvent.pointerUp(window, { clientX: 11, clientY: 11, pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("自分の上へ落としても何も起きない（意味のない移動をさせない）", () => {
    const onChange = vi.fn();
    render(<PanelLayoutView layout={sideBySide()} panels={panels} onChange={onChange} />);
    stubBoxes({ a: { left: 0, top: 0, width: 100, height: 100 }, b: { left: 100, top: 0, width: 100, height: 100 } });
    drag(screen.getByRole("heading", { name: "あ" }).parentElement!, { x: 50, y: 50 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Escape でやめられる（掴んだまま戻れない、を作らない）", () => {
    const onChange = vi.fn();
    render(<PanelLayoutView layout={sideBySide()} panels={panels} onChange={onChange} />);
    stubBoxes({ a: { left: 0, top: 0, width: 100, height: 100 }, b: { left: 100, top: 0, width: 100, height: 100 } });
    const head = screen.getByRole("heading", { name: "あ" }).parentElement!;
    pointerDownAt(head, 1000, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { buttons: 1, clientX: 150, clientY: 95, pointerId: 1 });
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerUp(window, { clientX: 150, clientY: 95, pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("「⋮」の上からは動かし始めない（メニューを開く操作を奪わない）", () => {
    const onChange = vi.fn();
    render(<PanelLayoutView layout={sideBySide()} panels={panels} onChange={onChange} />);
    stubBoxes({ a: { left: 0, top: 0, width: 100, height: 100 }, b: { left: 100, top: 0, width: 100, height: 100 } });
    drag(screen.getByLabelText("あの欄の操作"), { x: 150, y: 95 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("落とし先は線で示す（どこに入るか分からないまま落とさせない）", () => {
    const { container } = render(<PanelLayoutView layout={sideBySide()} panels={panels} onChange={vi.fn()} />);
    stubBoxes({ a: { left: 0, top: 0, width: 100, height: 100 }, b: { left: 100, top: 0, width: 100, height: 100 } });
    pointerDownAt(screen.getByRole("heading", { name: "あ" }).parentElement!, 1000, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { buttons: 1, clientX: 150, clientY: 95, pointerId: 1 });
    expect(container.querySelector(".panel-drop-line--bottom")).not.toBeNull();
  });

  it("境界は押した瞬間から追従する（掴んだのに動かない遊びを作らない）", () => {
    const onChange = vi.fn();
    const l = emptyLayout();
    l.nodes.left = { dir: SPLIT_DIR.column, sizes: [0.5, 0.5], children: [{ panelId: "a" }, { panelId: "b" }] };
    render(<PanelLayoutView layout={l} panels={panels} onChange={onChange} />);
    const divider = screen.getAllByLabelText("欄の境目")[0];
    (divider.parentElement as HTMLElement).getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    pointerDownAt(divider, 1000, { clientX: 0, clientY: 50 });
    // 1px＝欄の見出しなら「掴まない」距離。境界は**この 1px でも動く**（`startPx: 0`）。
    fireEvent.pointerMove(window, { buttons: 1, clientX: 0, clientY: 51, pointerId: 1 });
    expect(onChange).toHaveBeenCalled();
  });

  it("領域の外枠も掴んで動かせる（左右の幅・下の高さ）", () => {
    const onChange = vi.fn();
    // ⚠️ 真ん中にも欄を置く＝左だけだと左が全体を使い、境目そのものが無い（閉じた場所を空けない・実機指摘 2026-09-30）。
    const { container } = render(<PanelLayoutView layout={sideBySide()} panels={panels} onChange={onChange} />);
    (container.firstElementChild as HTMLElement).getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const edge = screen.getByLabelText("左の欄の幅");
    pointerDownAt(edge, 1000, { clientX: 200, clientY: 400 });
    fireEvent.pointerMove(window, { buttons: 1, clientX: 300, clientY: 400, pointerId: 1 });
    expect(onChange).toHaveBeenCalled();
  });

  it("右ボタンでは境界も掴まない（左ボタンのみ）", () => {
    const onChange = vi.fn();
    const l = emptyLayout();
    l.nodes.left = { dir: SPLIT_DIR.column, sizes: [0.5, 0.5], children: [{ panelId: "a" }, { panelId: "b" }] };
    render(<PanelLayoutView layout={l} panels={panels} onChange={onChange} />);
    const divider = screen.getAllByLabelText("欄の境目")[0];
    fireEvent.pointerDown(divider, { pointerId: 1, button: 2, clientX: 0, clientY: 50 });
    fireEvent.pointerMove(window, { buttons: 2, clientX: 0, clientY: 70, pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("境界を掴んで大きさを変えられる（段階2）", () => {
    const onChange = vi.fn();
    const l = emptyLayout();
    l.nodes.left = { dir: SPLIT_DIR.column, sizes: [0.5, 0.5], children: [{ panelId: "a" }, { panelId: "b" }] };
    render(<PanelLayoutView layout={l} panels={panels} onChange={onChange} />);
    const divider = screen.getAllByLabelText("欄の境目")[0];
    // 親の箱（分割の入れ物）で割合を決めるので、そこに大きさを置く。
    (divider.parentElement as HTMLElement).getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    pointerDownAt(divider, 1000, { clientX: 0, clientY: 50 });
    fireEvent.pointerMove(window, { buttons: 1, clientX: 0, clientY: 70, pointerId: 1 });
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[onChange.mock.calls.length - 1][0] as PanelLayout;
    const node = next.nodes.left;
    expect(node && isSplit(node) && node.sizes[0]).toBeCloseTo(0.7, 6);
  });
});

describe("PanelLayoutView: 途中でやめる・片づけ（/canon-check の指摘）", () => {
  const setup = (): { onChange: ReturnType<typeof vi.fn>; unmount: () => void; head: HTMLElement } => {
    const onChange = vi.fn();
    const { unmount } = render(<PanelLayoutView layout={sideBySide()} panels={panels} onChange={onChange} />);
    stubBoxes({ a: { left: 0, top: 0, width: 100, height: 100 }, b: { left: 100, top: 0, width: 100, height: 100 } });
    return { onChange, unmount, head: screen.getByRole("heading", { name: "あ" }).parentElement! };
  };

  it("指が外れた（pointercancel）ときは動かさない", () => {
    const { onChange, head } = setup();
    pointerDownAt(head, 1000, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { buttons: 1, clientX: 150, clientY: 95, pointerId: 1 });
    fireEvent.pointerCancel(window, { clientX: 150, clientY: 95, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 150, clientY: 95, pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("掴んだまま画面を離れても、あとから動かない（掴みっぱなしを残さない）", () => {
    const { onChange, unmount, head } = setup();
    pointerDownAt(head, 1000, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { buttons: 1, clientX: 150, clientY: 95, pointerId: 1 });
    unmount();
    fireEvent.pointerMove(window, { buttons: 1, clientX: 150, clientY: 50, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 150, clientY: 50, pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("右クリックでは掴まない（メニューを開く操作と食い合わない）", () => {
    const { onChange, head } = setup();
    pointerDownAt(head, 1000, { clientX: 0, clientY: 0, button: 2 });
    fireEvent.pointerMove(window, { buttons: 1, clientX: 150, clientY: 95, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 150, clientY: 95, pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("別の指の動きでは落ちない（掴んだ指だけを見る）", () => {
    const { onChange, head } = setup();
    pointerDownAt(head, 1000, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { buttons: 1, clientX: 150, clientY: 95, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 10, clientY: 10, pointerId: 2 }); // 別の指
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(window, { clientX: 150, clientY: 95, pointerId: 1 });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("境界のドラッグを Escape でやめると、掴む前の大きさに戻る（欄のドラッグと同じ意味）", () => {
    const onChange = vi.fn();
    const l = emptyLayout();
    l.nodes.left = { dir: SPLIT_DIR.column, sizes: [0.5, 0.5], children: [{ panelId: "a" }, { panelId: "b" }] };
    render(<PanelLayoutView layout={l} panels={panels} onChange={onChange} />);
    const divider = screen.getAllByLabelText("欄の境目")[0];
    (divider.parentElement as HTMLElement).getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    pointerDownAt(divider, 1000, { clientX: 0, clientY: 50 });
    fireEvent.pointerMove(window, { buttons: 1, clientX: 0, clientY: 70, pointerId: 1 });
    fireEvent.keyDown(window, { key: "Escape" });
    // 最後に渡されるのは**掴む前の配置そのもの**（同じ参照）。
    expect(onChange.mock.calls[onChange.mock.calls.length - 1][0]).toBe(l);
  });
});

// 並べ替えは**ドラッグとメニューの両方**（ADR-0033 決定12・#724）。ドラッグ経路だけ担保されていて、
// メニュー経路はどこにもテストが無かった＝**ドラッグが使えない人の逃げ道**が黙って壊れうる。
describe("PanelLayoutView: メニューからの並べ替え（決定12）", () => {
  const openMenu = (name: string): void => {
    fireEvent.click(screen.getByRole("button", { name: `${name}の欄の操作` }));
  };

  it("「右へ」で同じ向きの並びの中を入れ替えられる", () => {
    const onChange = vi.fn();
    // 中央に2つ横並び（あ・い）＝左右に入れ替えられる形。
    const l = emptyLayout();
    l.nodes.center = { dir: SPLIT_DIR.row, sizes: [0.5, 0.5], children: [{ panelId: "a" }, { panelId: "b" }] };
    render(<PanelLayoutView layout={l} panels={panels} onChange={onChange} />);
    openMenu("あ");
    fireEvent.click(screen.getByRole("menuitem", { name: "右へ" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(placedPanelIds(onChange.mock.calls[0][0] as PanelLayout)).toEqual(["b", "a"]);
  });

  it("動かせない向きは押せなくして理由を出す（押しても何も起きない、を作らない）", () => {
    const onChange = vi.fn();
    const l = emptyLayout();
    l.nodes.center = { dir: SPLIT_DIR.row, sizes: [0.5, 0.5], children: [{ panelId: "a" }, { panelId: "b" }] };
    render(<PanelLayoutView layout={l} panels={panels} onChange={onChange} />);
    openMenu("あ");
    // 横並びなので「上へ」は動かせない＝押せないうえに理由が付く。
    const up = screen.getByRole("menuitem", { name: "上へ" });
    expect(up.hasAttribute("disabled") || up.getAttribute("aria-disabled") === "true").toBe(true);
    expect(up.getAttribute("title")).toContain("同じ向きに並んでいる欄");
  });

  it("「左へ移す」で領域そのものを変えられる（ドラッグでは入れない空の領域への逃げ道）", () => {
    const onChange = vi.fn();
    render(<PanelLayoutView layout={sideBySide()} panels={panels} onChange={onChange} />);
    openMenu("い");
    fireEvent.click(screen.getByRole("menuitem", { name: "左へ移す" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as PanelLayout;
    expect(next.nodes.left).not.toBeNull();
    expect(placedPanelIds(next)).toContain("b");
  });
});

describe("欄が縮めること（#1104・実機で発覚）", () => {
  // ⚠️ **`1fr` は `minmax(auto, 1fr)` と同じ**＝**中身の最小の高さより縮まない**。
  // 器がスクロールしない画面では、上の欄が縮まずに下の欄を押し潰し、
  // **器からはみ出すので欄の中のスクロールも効かなくなる**（実機で起きた）。
  it("行は minmax(0, …fr)＝中身より小さくなれる／割合は % で書かない", () => {
    const layout = { ...emptyLayout(), nodes: { left: null, center: { panelId: "a" }, right: null, bottom: { panelId: "b" } } };
    const { container } = render(
      <PanelLayoutView layout={layout} panels={[{ id: "a", title: "A", content: <div /> }, { id: "b", title: "B", content: <div /> }]} onChange={() => {}} />,
    );
    const root = container.querySelector(".panel-layout") as HTMLElement;
    const rows = root.style.gridTemplateRows;
    // ⚠️ **どの行も `minmax(0, …)` で包む**＝包まないと、その行は中身より縮めない。
    expect(rows).toContain("minmax(0,");
    expect(rows.split("minmax(0,").length - 1, "包まれていない行がある").toBe(2);
    // ⚠️ **割合を `%` で書かない**（#1104・実機で発覚）＝器の高さが flex で決まるとき、
    // `%` は解決できずに行が中身なりに伸び、**器からはみ出して欄の中のスクロールも効かなくなる**。
    expect(rows, "割合を % で書いている").not.toContain("%");
  });
});

// 欄を一時的に広げる（ADR-0048 決定5・#1256 b3）。Premiere の `` ` ``・VEGAS の Ctrl+F11 と同じ型。
// ⚠️ **記憶しない一時状態**＝配置（ADR-0033 の記憶）を書き換えない。
describe("PanelLayoutView: 欄を広げる", () => {
  const frame = (id: string): HTMLElement => document.querySelector(`[data-panel-id="${id}"]`) as HTMLElement;
  const isMax = (id: string): boolean => frame(id).classList.contains("panel-frame--maximized");

  it("見出しのボタンで広げ、もう一度で戻す（配置は書き換えない）", () => {
    const onChange = vi.fn();
    const { container } = render(<PanelLayoutView layout={sideBySide()} panels={panels} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "あの欄を広げる" }));
    expect(isMax("a")).toBe(true);
    expect(isMax("b")).toBe(false);
    expect(container.querySelector(".panel-layout")!.classList.contains("panel-layout--maximized")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "あの欄を元に戻す" }));
    expect(isMax("a")).toBe(false);
    expect(container.querySelector(".panel-layout")!.classList.contains("panel-layout--maximized")).toBe(false);
    expect(onChange, "広げただけで配置を書き換えた（記憶してしまう）").not.toHaveBeenCalled();
  });

  // ⚠️ **ほかの欄は外さない**＝外すと中身の状態が消える（仕上がり確認で鳴っている音が止まる）。
  it("広げている間も、ほかの欄の中身は残っている（隠すだけ）", () => {
    render(<PanelLayoutView layout={sideBySide()} panels={panels} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "あの欄を広げる" }));
    expect(screen.getByText("いの中身")).toBeTruthy();
  });

  it("見出しの二度押しでも広げる／戻す", () => {
    render(<PanelLayoutView layout={sideBySide()} panels={panels} onChange={vi.fn()} />);
    fireEvent.doubleClick(frame("b").querySelector(".panel-frame-head h3")!);
    expect(isMax("b")).toBe(true);
    fireEvent.doubleClick(frame("b").querySelector(".panel-frame-head h3")!);
    expect(isMax("b")).toBe(false);
  });

  it("指している欄を `` ` `` キーで広げる（文字を打っている所では奪わない）", () => {
    render(
      <PanelLayoutView
        layout={sideBySide()}
        panels={[panels[0], { id: "b", title: "い", content: <input aria-label="入力" /> }]}
        onChange={vi.fn()}
      />,
    );
    fireEvent.keyDown(window, { key: "`" });
    expect(isMax("a") || isMax("b"), "どこも指していないのに広がった").toBe(false);
    fireEvent.pointerEnter(frame("a"));
    fireEvent.keyDown(window, { key: "`" });
    expect(isMax("a")).toBe(true);
    fireEvent.keyDown(window, { key: "`" });
    expect(isMax("a")).toBe(false);
    fireEvent.pointerEnter(frame("b"));
    fireEvent.keyDown(screen.getByLabelText("入力"), { key: "`" });
    expect(isMax("b"), "文字を打っている所でキーを奪った").toBe(false);
  });

  it("欄のメニューからも広げられる", () => {
    render(<PanelLayoutView layout={sideBySide()} panels={panels} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "いの欄の操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "広げる" }));
    expect(isMax("b")).toBe(true);
  });

  // 広げた欄が配置から消えたら（閉じた・既定に戻した）元に戻す＝見えない欄を広げたまま残さない。
  it("広げた欄が配置から消えたら、広げた状態を解く", () => {
    const { rerender, container } = render(<PanelLayoutView layout={sideBySide()} panels={panels} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "あの欄を広げる" }));
    const only = emptyLayout();
    only.nodes.center = { panelId: "b" };
    rerender(<PanelLayoutView layout={only} panels={panels} onChange={vi.fn()} />);
    expect(container.querySelector(".panel-layout")!.classList.contains("panel-layout--maximized")).toBe(false);
  });

  // ⚠️ **広げている間は、隠れた欄を落とし先にしない**（#1259 レビュー 🟡）＝隠した欄も箱は残るので、
  //   見えない欄の上で離すと、何が起きたか分からないまま配置が変わった。
  it("広げている間は、隠れた欄の上で離しても配置を変えない", () => {
    const onChange = vi.fn();
    render(<PanelLayoutView layout={sideBySide()} panels={panels} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "あの欄を広げる" }));
    stubBoxes({ a: { left: 0, top: 0, width: 400, height: 300 }, b: { left: 0, top: 0, width: 400, height: 300 } });
    drag(frame("a").querySelector(".panel-frame-head h3") as HTMLElement, { x: 200, y: 150 });
    expect(onChange, "隠れた欄が落とし先になった").not.toHaveBeenCalled();
  });

  // **外から持つ**（#1262＝「大きく見る」が仕上がり確認を広げる）。
  it("広げている欄を外から渡せ、見出しのボタンは外へ知らせる（自分では持たない）", () => {
    const onMax = vi.fn();
    const { rerender } = render(<PanelLayoutView layout={sideBySide()} panels={panels} onChange={vi.fn()} maximized="b" onMaximizedChange={onMax} />);
    expect(frame("b").classList.contains("panel-frame--maximized")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "いの欄を元に戻す" }));
    expect(onMax).toHaveBeenLastCalledWith(null);
    expect(frame("b").classList.contains("panel-frame--maximized"), "外が戻す前に自分で戻した").toBe(true);
    rerender(<PanelLayoutView layout={sideBySide()} panels={panels} onChange={vi.fn()} maximized={null} onMaximizedChange={onMax} />);
    expect(frame("b").classList.contains("panel-frame--maximized")).toBe(false);
    fireEvent.pointerEnter(frame("a"));
    fireEvent.keyDown(window, { key: "`" });
    expect(onMax, "キーの道が外へ知らせない").toHaveBeenLastCalledWith("a");
  });

  it("CSS：広げた欄は器いっぱいに重ね、ほかの欄は隠すだけ（外さない）", () => {
    const theme = readFileSync(join(__dirname, "../../../styles/theme.css"), "utf8");
    const max = ruleBody(theme, ".panel-frame--maximized") ?? "";
    expect(max).toMatch(/position:\s*absolute/);
    expect(max).toMatch(/inset:\s*0/);
    expect(ruleBody(theme, ".panel-layout--maximized") ?? "", "器が基準にならない").toMatch(/position:\s*relative/);
    const hide = ruleBody(theme, ".panel-layout--maximized .panel-frame:not(.panel-frame--maximized),\n.panel-layout--maximized .panel-divider") ?? "";
    expect(hide, "ほかの欄を外している／隠していない").toMatch(/visibility:\s*hidden/);
  });

  // ── 閉じた欄の場所を空けたままにしない（実機指摘 2026-09-30＝特に真ん中）─────────────────
  describe("閉じた領域の場所を詰める", () => {
    const three = [...panels, { id: "c", title: "う", content: <p>うの中身</p> }];
    const regionEl = (c: HTMLElement, r: string) => c.querySelector(`[data-region="${r}"]`) as HTMLElement | null;
    const dividers = () => screen.queryAllByRole("separator").map((d) => d.getAttribute("aria-label"));

    it("真ん中が空なら、右が残りを使う（左は覚えた幅・境目は1本で左の幅を動かす）", () => {
      const l = emptyLayout();
      l.nodes.left = { panelId: "a" };
      l.nodes.right = { panelId: "b" };
      const { container } = render(<PanelLayoutView layout={l} panels={panels} onChange={vi.fn()} />);
      expect(regionEl(container, "center"), "空の真ん中を描いている").toBeNull();
      expect(regionEl(container, "right")!.className).toContain("panel-layout-region--flex");
      expect(regionEl(container, "right")!.style.width, "残りを使う側に幅を決めている").toBe("");
      expect(regionEl(container, "left")!.style.width).toBe(`${l.regionSizes.left * 100}%`);
      expect(dividers()).toEqual(["左の欄の幅"]);
    });

    it("右だけなら右が全体を使う（境目は出さない）", () => {
      const l = emptyLayout();
      l.nodes.right = { panelId: "b" };
      const { container } = render(<PanelLayoutView layout={l} panels={panels} onChange={vi.fn()} />);
      expect(regionEl(container, "right")!.className).toContain("panel-layout-region--flex");
      expect(dividers()).toEqual([]);
    });

    it("左・真ん中・右がそろっていれば、真ん中が残りを使い、左右は覚えた幅", () => {
      const l = emptyLayout();
      l.nodes.left = { panelId: "a" };
      l.nodes.center = { panelId: "b" };
      l.nodes.right = { panelId: "c" };
      const { container } = render(<PanelLayoutView layout={l} panels={three} onChange={vi.fn()} />);
      expect(regionEl(container, "center")!.className).toContain("panel-layout-region--flex");
      expect(regionEl(container, "right")!.style.width).toBe(`${l.regionSizes.right * 100}%`);
      expect(dividers()).toEqual(["左の欄の幅", "右の欄の幅"]);
    });

    it("上の段が空なら、下の欄が全体を使う（下の境目も出さない）", () => {
      const l = emptyLayout();
      l.nodes.bottom = { panelId: "a" };
      const { container } = render(<PanelLayoutView layout={l} panels={panels} onChange={vi.fn()} />);
      expect(container.querySelector(".panel-layout-main"), "空の上の段を描いている").toBeNull();
      expect((container.firstElementChild as HTMLElement).style.gridTemplateRows).toBe("minmax(0, 1fr)");
      expect(dividers()).toEqual([]);
    });

    it("CSS：残りを使う印が幅を受け持つ（真ん中の印ではなく）", () => {
      const css = readFileSync(join(__dirname, "../../../styles/theme.css"), "utf8");
      expect(ruleBody(css, ".panel-layout-region--flex")).toMatch(/flex:\s*1 1 0/);
      expect(ruleBody(css, ".panel-layout-region--center"), "真ん中の印が幅を持っている（真ん中を閉じても場所が残る）").toBeNull();
    });
  });

  // ── 空いた領域へもドラッグで移せる（実機指摘 2026-09-30）──────────────────────────
  describe("空いた領域への落とし先", () => {
    const stubRoot = (c: HTMLElement) => {
      (c.firstElementChild as HTMLElement).getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    };
    const grab = (title: string) => pointerDownAt(screen.getByRole("heading", { name: title }).parentElement!, 1000, { clientX: 500, clientY: 10 });
    const move = (x: number, y: number) => fireEvent.pointerMove(window, { buttons: 1, clientX: x, clientY: y, pointerId: 1 });
    const up = (x: number, y: number) => fireEvent.pointerUp(window, { clientX: x, clientY: y, pointerId: 1 });

    it("掴んでいる間だけ、空いた領域の帯を外周に出す（空でない領域には出さない）", () => {
      const { container } = render(<PanelLayoutView layout={sideBySide()} panels={panels} onChange={vi.fn()} />);
      stubRoot(container);
      expect(container.querySelector(".panel-dock-zone")).toBeNull();
      grab("い");
      move(500, 300);
      const zones = [...container.querySelectorAll("[data-dock-region]")].map((z) => z.getAttribute("data-dock-region")).sort();
      expect(zones).toEqual(["bottom", "right"]);
      up(500, 300);
      expect(container.querySelector(".panel-dock-zone"), "離しても帯が残る").toBeNull();
    });

    it("Escape でやめたら、帯も名前札も片付ける", () => {
      const { container } = render(<PanelLayoutView layout={sideBySide()} panels={panels} onChange={vi.fn()} />);
      stubRoot(container);
      grab("あ");
      move(500, 300);
      expect(container.querySelector(".panel-dock-zone")).not.toBeNull();
      fireEvent.keyDown(window, { key: "Escape" });
      expect(container.querySelector(".panel-dock-zone"), "やめても帯が残る").toBeNull();
      expect(container.querySelector(".drag-ghost"), "やめても名前札が残る").toBeNull();
      up(500, 300);
    });

    it("右端の帯で離すと、空いていた右の領域へ移す", () => {
      const onChange = vi.fn();
      const { container } = render(<PanelLayoutView layout={sideBySide()} panels={panels} onChange={onChange} />);
      stubRoot(container);
      grab("あ");
      move(990, 300);
      expect(container.querySelector('[data-dock-region="right"]')!.className).toContain("panel-dock-zone--active");
      up(990, 300);
      const next = onChange.mock.calls[0][0] as PanelLayout;
      expect(next.nodes.right).toEqual({ panelId: "a" });
      expect(next.nodes.left).toBeNull();
    });

    it("下端の帯で離すと、空いていた下の領域へ移す", () => {
      const onChange = vi.fn();
      const { container } = render(<PanelLayoutView layout={sideBySide()} panels={panels} onChange={onChange} />);
      stubRoot(container);
      grab("あ");
      move(500, 790);
      up(500, 790);
      expect((onChange.mock.calls[0][0] as PanelLayout).nodes.bottom).toEqual({ panelId: "a" });
    });

    it("真ん中が空なら左右の境目に帯を出し、そこで離すと真ん中へ移す", () => {
      const onChange = vi.fn();
      const l = emptyLayout();
      l.nodes.left = { panelId: "a" };
      l.nodes.right = { panelId: "b" };
      const { container } = render(<PanelLayoutView layout={l} panels={panels} onChange={onChange} />);
      stubRoot(container);
      (container.querySelector('[data-region="left"]') as HTMLElement).getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 280, height: 800, right: 280, bottom: 800, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      grab("い");
      move(282, 300);
      expect(container.querySelector('[data-dock-region="center"]')!.className).toContain("panel-dock-zone--active");
      up(282, 300);
      expect((onChange.mock.calls[0][0] as PanelLayout).nodes.center).toEqual({ panelId: "b" });
    });

    it("欄を広げている間は、空いた領域の帯を出さない（隠れた欄の周りへ落とさない）", () => {
      const { container } = render(<PanelLayoutView layout={sideBySide()} panels={panels} onChange={vi.fn()} maximized="a" onMaximizedChange={vi.fn()} />);
      stubRoot(container);
      grab("あ");
      move(990, 300);
      expect(container.querySelector(".panel-dock-zone")).toBeNull();
      up(990, 300);
    });

    it("掴んでいる欄の名前を指の先に出す", () => {
      const { container } = render(<PanelLayoutView layout={sideBySide()} panels={panels} onChange={vi.fn()} />);
      stubRoot(container);
      grab("あ");
      move(400, 300);
      const ghost = container.querySelector(".drag-ghost") as HTMLElement;
      expect(ghost.textContent).toBe("あ");
      expect([ghost.style.left, ghost.style.top]).toEqual(["400px", "300px"]);
      up(400, 300);
      expect(container.querySelector(".drag-ghost")).toBeNull();
    });

    it("CSS：欄の辺へ落とすときは、入る半分を塗る（線だけでは広さが読めない）", () => {
      const css = readFileSync(join(__dirname, "../../../styles/theme.css"), "utf8");
      expect(ruleBody(css, ".panel-drop-line--top")).toMatch(/height:\s*50%/);
      expect(ruleBody(css, ".panel-drop-line--left")).toMatch(/width:\s*50%/);
    });
  });

  // ── 見出しの行の道具（実機指摘 2026-09-30＝中身の上に重ねない）────────────────────
  describe("見出しの道具", () => {
    const withTools = [{ id: "a", title: "あ", content: <p>あの中身</p>, headerTools: <button>道具</button> }, panels[1]];

    it("見出しの行に出る（中身の側には出さない）", () => {
      const { container } = render(<PanelLayoutView layout={sideBySide()} panels={withTools} onChange={vi.fn()} />);
      const tool = screen.getByRole("button", { name: "道具" });
      expect(tool.closest(".panel-frame-head")).not.toBeNull();
      expect(container.querySelector('[data-panel-id="a"] .panel-frame-body')!.contains(tool)).toBe(false);
    });

    it("道具を押しても欄は動かし始めない・二度押しでも広げない", () => {
      const onChange = vi.fn();
      const onMax = vi.fn();
      const { container } = render(<PanelLayoutView layout={sideBySide()} panels={withTools} onChange={onChange} maximized={null} onMaximizedChange={onMax} />);
      stubBoxes({ a: { left: 0, top: 0, width: 100, height: 100 }, b: { left: 100, top: 0, width: 100, height: 100 } });
      const toolsBox = container.querySelector(".panel-frame-head-tools") as HTMLElement;
      pointerDownAt(toolsBox, 1000, { clientX: 0, clientY: 0 });
      fireEvent.pointerMove(window, { buttons: 1, clientX: 150, clientY: 95, pointerId: 1 });
      fireEvent.pointerUp(window, { clientX: 150, clientY: 95, pointerId: 1 });
      expect(onChange).not.toHaveBeenCalled();
      fireEvent.doubleClick(toolsBox);
      expect(onMax).not.toHaveBeenCalled();
    });
  });
});

describe("配置を覚えられなかった知らせ（#1396）", () => {
  it("立っているときだけ出し、「閉じる」で知らせる", () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<PanelLayoutView layout={sideBySide()} panels={panels} onChange={vi.fn()} />);
    expect(screen.queryByText(/画面の配置を覚えられませんでした/)).toBeNull();
    rerender(<PanelLayoutView layout={sideBySide()} panels={panels} onChange={vi.fn()} saveFailed onDismissSaveFailed={onDismiss} />);
    const note = screen.getByText(/画面の配置を覚えられませんでした/);
    fireEvent.click(note.parentElement!.querySelector("button")!);
    expect(onDismiss).toHaveBeenCalled();
  });
});
