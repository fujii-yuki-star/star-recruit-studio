// @vitest-environment jsdom
// 欄の配置の画面側（ADR-0033 段階2/3）。**掴んで動かす**と**境界で大きさを変える**を固定する。
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
// 押下は**時刻を固定するヘルパー**を通す（#645）＝並列実行の負荷で押下の間隔が化けない。
// ここは二度押しではないが、同じファイルに「押す→離す→押す」が並ぶので同じ流儀にそろえる。
import { pointerDownAt } from "../../../test/pointer";
import { PanelLayoutView } from "./PanelLayoutView";
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
    const l = emptyLayout();
    l.nodes.left = { panelId: "a" };
    const { container } = render(<PanelLayoutView layout={l} panels={panels} onChange={onChange} />);
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
