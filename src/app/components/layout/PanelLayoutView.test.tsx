// @vitest-environment jsdom
// 欄の配置の画面側（ADR-0033 段階2/3）。**掴んで動かす**と**境界で大きさを変える**を固定する。
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
  fireEvent.pointerDown(from, { clientX: 0, clientY: 0 });
  fireEvent.pointerMove(window, { clientX: to.x, clientY: to.y });
  fireEvent.pointerUp(window, { clientX: to.x, clientY: to.y });
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
    fireEvent.pointerDown(head, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 11, clientY: 11 }); // 1px＝掴まない
    fireEvent.pointerUp(window, { clientX: 11, clientY: 11 });
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
    fireEvent.pointerDown(head, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 150, clientY: 95 });
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerUp(window, { clientX: 150, clientY: 95 });
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
    fireEvent.pointerDown(screen.getByRole("heading", { name: "あ" }).parentElement!, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 150, clientY: 95 });
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
    fireEvent.pointerDown(divider, { clientX: 0, clientY: 50 });
    fireEvent.pointerMove(window, { clientX: 0, clientY: 70 });
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[onChange.mock.calls.length - 1][0] as PanelLayout;
    const node = next.nodes.left;
    expect(node && isSplit(node) && node.sizes[0]).toBeCloseTo(0.7, 6);
  });
});
