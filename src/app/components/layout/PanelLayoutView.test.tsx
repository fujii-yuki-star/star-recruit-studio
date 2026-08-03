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
  fireEvent.pointerMove(window, { clientX: to.x, clientY: to.y, pointerId: 1 });
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
    fireEvent.pointerMove(window, { clientX: 11, clientY: 11, pointerId: 1 }); // 1px＝掴まない
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
    fireEvent.pointerMove(window, { clientX: 150, clientY: 95, pointerId: 1 });
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
    fireEvent.pointerMove(window, { clientX: 150, clientY: 95, pointerId: 1 });
    expect(container.querySelector(".panel-drop-line--bottom")).not.toBeNull();
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
    fireEvent.pointerMove(window, { clientX: 0, clientY: 70, pointerId: 1 });
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
    fireEvent.pointerMove(window, { clientX: 150, clientY: 95, pointerId: 1 });
    fireEvent.pointerCancel(window, { clientX: 150, clientY: 95, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 150, clientY: 95, pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("掴んだまま画面を離れても、あとから動かない（掴みっぱなしを残さない）", () => {
    const { onChange, unmount, head } = setup();
    pointerDownAt(head, 1000, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 150, clientY: 95, pointerId: 1 });
    unmount();
    fireEvent.pointerMove(window, { clientX: 150, clientY: 50, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 150, clientY: 50, pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("右クリックでは掴まない（メニューを開く操作と食い合わない）", () => {
    const { onChange, head } = setup();
    pointerDownAt(head, 1000, { clientX: 0, clientY: 0, button: 2 });
    fireEvent.pointerMove(window, { clientX: 150, clientY: 95, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 150, clientY: 95, pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("別の指の動きでは落ちない（掴んだ指だけを見る）", () => {
    const { onChange, head } = setup();
    pointerDownAt(head, 1000, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 150, clientY: 95, pointerId: 1 });
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
    fireEvent.pointerMove(window, { clientX: 0, clientY: 70, pointerId: 1 });
    fireEvent.keyDown(window, { key: "Escape" });
    // 最後に渡されるのは**掴む前の配置そのもの**（同じ参照）。
    expect(onChange.mock.calls[onChange.mock.calls.length - 1][0]).toBe(l);
  });
});
