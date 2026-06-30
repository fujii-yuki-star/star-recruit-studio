// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { fireEvent, render } from "@testing-library/react";
import { TemplateLayerOverlay } from "./TemplateLayerOverlay";
import type { Layer } from "../../domain/template/types";

// テンプレ作成エディタのレイヤー操作オーバーレイ（#214 ③c）。①の純粋 ops 流用をブラウザ非依存で検証（ADR-0014）。
const CANVAS_W = 1920;
const CANVAS_H = 1080;

function makeLayers(): Layer[] {
  return [
    { id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 },
    { id: "title", type: "text", x: 200, y: 200, w: 400, h: 120, zIndex: 1 },
  ];
}

function renderOverlay(over: Partial<ComponentProps<typeof TemplateLayerOverlay>> = {}) {
  const onSelect = vi.fn();
  const onSelectMany = vi.fn();
  const onChange = vi.fn();
  const onMoveMany = vi.fn();
  const onRotate = vi.fn();
  const result = render(
    <TemplateLayerOverlay
      layers={makeLayers()}
      canvasW={CANVAS_W}
      canvasH={CANVAS_H}
      selectedIds={[]}
      onSelect={onSelect}
      onSelectMany={onSelectMany}
      onChange={onChange}
      onMoveMany={onMoveMany}
      onRotate={onRotate}
      label={(l) => l.type}
      {...over}
    />,
  );
  const root = result.container.firstElementChild as HTMLElement;
  const boxes = Array.from(root.children) as HTMLElement[]; // zIndex 昇順: [0]=background, [1]=title
  return { onSelect, onSelectMany, onChange, onMoveMany, onRotate, root, boxes, ...result };
}

describe("TemplateLayerOverlay", () => {
  it("選択中のレイヤーにだけハンドルが出る（リサイズ4＋回転ハンドル2）", () => {
    const { boxes } = renderOverlay({ selectedIds: ["title"] });
    expect(boxes).toHaveLength(2);
    expect(boxes[0].querySelectorAll("div")).toHaveLength(0); // background（非選択）＝ハンドルなし
    expect(boxes[1].querySelectorAll("div")).toHaveLength(6); // title（選択中）＝リサイズ4＋回転(stem+knob)2
  });

  it("レイヤーを押すと、その id で選択コールバックが呼ばれる", () => {
    const { boxes, onSelect } = renderOverlay();
    fireEvent.pointerDown(boxes[1], { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    expect(onSelect).toHaveBeenCalledWith("title");
  });

  it("選択中レイヤーをドラッグすると onMoveMany に新しい位置が渡る（一括移動・#306）", () => {
    const { root, boxes, onMoveMany } = renderOverlay({ selectedIds: ["title"] });
    // jsdom は実レイアウトを持たず clientWidth=0（→scale=0）になるため明示して scale=1 に。
    Object.defineProperty(root, "clientWidth", { value: CANVAS_W, configurable: true });
    fireEvent.pointerDown(boxes[1], { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(boxes[1], { clientX: 30, clientY: 40, pointerId: 1 });
    // title start (200,200) + (30,40) = (230,240)。背景全面への吸着は閾値外で発生しない。
    expect(onMoveMany).toHaveBeenLastCalledWith([{ id: "title", x: 230, y: 240 }]);
  });

  it("角ハンドルをドラッグすると onChange に新しいサイズが渡る（純粋 resizeFreeElement 流用）", () => {
    const { root, boxes, onChange } = renderOverlay({ selectedIds: ["title"] });
    Object.defineProperty(root, "clientWidth", { value: CANVAS_W, configurable: true });
    const seHandle = boxes[1].querySelectorAll("div")[3]; // [nw,ne,sw,se] の se
    fireEvent.pointerDown(seHandle, { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(seHandle, { clientX: 20, clientY: 10, pointerId: 1 });
    // se を (+20,+10)：左上 (200,200) 固定で w=400+20=420・h=120+10=130。
    expect(onChange).toHaveBeenLastCalledWith("title", expect.objectContaining({ x: 200, y: 200, w: 420, h: 130 }));
  });

  it("Shift+クリックで選択トグル（additive・ドラッグは始めない・#306）", () => {
    const { boxes, onSelect, onMoveMany } = renderOverlay({ selectedIds: ["title"] });
    fireEvent.pointerDown(boxes[0], { button: 0, shiftKey: true, clientX: 0, clientY: 0, pointerId: 1 });
    expect(onSelect).toHaveBeenCalledWith("background", true); // additive＝トグル
    fireEvent.pointerMove(boxes[0], { clientX: 30, clientY: 40, pointerId: 1 });
    expect(onMoveMany).not.toHaveBeenCalled(); // Shift＋クリックは選択のみ
  });

  it("空白をドラッグ（マーキー）で交差レイヤーが onSelectMany に渡る（#306）", () => {
    const { root, onSelectMany } = renderOverlay();
    // jsdom はレイアウトを持たないため getBoundingClientRect を実寸でモック（canvas 等倍）。
    root.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: CANVAS_W, height: CANVAS_H, right: CANVAS_W, bottom: CANVAS_H, x: 0, y: 0, toJSON: () => undefined }) as DOMRect;
    fireEvent.pointerDown(root, { button: 0, clientX: 100, clientY: 100, pointerId: 1 }); // 空白＝root 自身
    fireEvent.pointerMove(root, { clientX: 700, clientY: 400, pointerId: 1 }); // (100,100)-(700,400) に title が交差
    expect(onSelectMany).toHaveBeenLastCalledWith(["background", "title"]);
  });

  it("回転ハンドルをドラッグすると onRotate に角度が渡る（#279 同様）", () => {
    const { root, boxes, onRotate } = renderOverlay({ selectedIds: ["title"] });
    root.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: CANVAS_W, height: CANVAS_H, right: CANVAS_W, bottom: CANVAS_H, x: 0, y: 0, toJSON: () => undefined }) as DOMRect;
    const knob = boxes[1].querySelector('[data-testid="tmpl-rotate-handle"]') as HTMLElement;
    // title (200,200,400,120) 中心=(400,260)。右(600,260)＝3時方向＝90°。
    fireEvent.pointerDown(knob, { button: 0, clientX: 400, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(knob, { clientX: 600, clientY: 260, pointerId: 1 });
    const calls = onRotate.mock.calls;
    expect(calls[calls.length - 1][0]).toBe("title");
    expect(calls[calls.length - 1][1]).toBeCloseTo(90, 1);
  });
});
