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
  const onChange = vi.fn();
  const result = render(
    <TemplateLayerOverlay
      layers={makeLayers()}
      canvasW={CANVAS_W}
      canvasH={CANVAS_H}
      selectedId={null}
      onSelect={onSelect}
      onChange={onChange}
      label={(l) => l.type}
      {...over}
    />,
  );
  const root = result.container.firstElementChild as HTMLElement;
  const boxes = Array.from(root.children) as HTMLElement[]; // zIndex 昇順: [0]=background, [1]=title
  return { onSelect, onChange, root, boxes, ...result };
}

describe("TemplateLayerOverlay", () => {
  it("各レイヤーを1ボックスずつ描画し、選択中のレイヤーにだけリサイズハンドル（4つ）が出る", () => {
    const { boxes } = renderOverlay({ selectedId: "title" });
    expect(boxes).toHaveLength(2);
    expect(boxes[0].querySelectorAll("div")).toHaveLength(0); // background（非選択）＝ハンドルなし
    expect(boxes[1].querySelectorAll("div")).toHaveLength(4); // title（選択中）＝角ハンドル4
  });

  it("レイヤーを押すと、その id で選択コールバックが呼ばれる", () => {
    const { boxes, onSelect } = renderOverlay();
    fireEvent.pointerDown(boxes[1], { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    expect(onSelect).toHaveBeenCalledWith("title");
  });

  it("選択中レイヤーをドラッグすると onChange に新しい位置が渡る（純粋 moveFreeElement 流用）", () => {
    const { root, boxes, onChange } = renderOverlay({ selectedId: "title" });
    // jsdom は実レイアウトを持たず clientWidth=0（→scale=0）になるため明示して scale=1 に。
    Object.defineProperty(root, "clientWidth", { value: CANVAS_W, configurable: true });
    fireEvent.pointerDown(boxes[1], { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(boxes[1], { clientX: 30, clientY: 40, pointerId: 1 });
    // title start (200,200) + (30,40) = (230,240)。背景全面への吸着は閾値外で発生しない。
    expect(onChange).toHaveBeenLastCalledWith("title", expect.objectContaining({ x: 230, y: 240 }));
  });

  it("角ハンドルをドラッグすると onChange に新しいサイズが渡る（純粋 resizeFreeElement 流用）", () => {
    const { root, boxes, onChange } = renderOverlay({ selectedId: "title" });
    Object.defineProperty(root, "clientWidth", { value: CANVAS_W, configurable: true });
    const seHandle = boxes[1].querySelectorAll("div")[3]; // [nw,ne,sw,se] の se
    fireEvent.pointerDown(seHandle, { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(seHandle, { clientX: 20, clientY: 10, pointerId: 1 });
    // se を (+20,+10)：左上 (200,200) 固定で w=400+20=420・h=120+10=130。
    expect(onChange).toHaveBeenLastCalledWith("title", expect.objectContaining({ x: 200, y: 200, w: 420, h: 130 }));
  });
});
