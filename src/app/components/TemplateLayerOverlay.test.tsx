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

  const grp = { id: "group_001", members: ["title"], transform: { x: 0, y: 0, rotation: 0, scale: 1 } };

  it("グループのメンバーを押すとグループ選択が呼ばれる（onSelectGroup・#307）", () => {
    const onSelectGroup = vi.fn();
    const { boxes, onSelect } = renderOverlay({ groups: [grp], onSelectGroup });
    fireEvent.pointerDown(boxes[1], { button: 0, pointerId: 1 }); // title（グループ所属）
    expect(onSelectGroup).toHaveBeenCalledWith("group_001");
    expect(onSelect).not.toHaveBeenCalledWith("title");
  });

  it("グループ選択中はグループ枠（tmpl-group-frame）が出る（#307）", () => {
    const { root } = renderOverlay({ groups: [grp], activeGroupId: "group_001" });
    expect(root.querySelector('[data-testid="tmpl-group-frame"]')).not.toBeNull();
  });

  it("グループ枠をドラッグするとグループの transform.x/y が更新される（onGroupTransform・#307）", () => {
    const onGroupTransform = vi.fn();
    const { root } = renderOverlay({ groups: [grp], activeGroupId: "group_001", onGroupTransform });
    Object.defineProperty(root, "clientWidth", { value: CANVAS_W, configurable: true }); // scale=1
    const frame = root.querySelector('[data-testid="tmpl-group-frame"]') as HTMLElement;
    fireEvent.pointerDown(frame, { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(frame, { clientX: 30, clientY: 40, pointerId: 1 });
    expect(onGroupTransform).toHaveBeenLastCalledWith("group_001", { x: 30, y: 40 });
  });

  it("hidden グループのメンバーは描画されない（#307）", () => {
    const hiddenGrp = { id: "group_001", members: ["title"], transform: { x: 0, y: 0, rotation: 0, scale: 1 }, hidden: true };
    const { boxes } = renderOverlay({ groups: [hiddenGrp] });
    expect(boxes).toHaveLength(1); // title は hidden グループ所属＝非描画。background のみ残る
  });

  const mockRect = (root: HTMLElement) => {
    root.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: CANVAS_W, height: CANVAS_H, right: CANVAS_W, bottom: CANVAS_H, x: 0, y: 0, toJSON: () => undefined }) as DOMRect;
  };

  it("グループ枠の角ハンドルで transform.scale が更新される（中心固定の一様拡縮・#307）", () => {
    const onGroupTransform = vi.fn();
    const { root } = renderOverlay({ groups: [grp], activeGroupId: "group_001", onGroupTransform });
    mockRect(root);
    const se = root.querySelector('[data-testid="tmpl-group-scale-se"]') as HTMLElement;
    // title(200,200,400,120) → 枠中心(400,260)。開始(600,260)=距離200、移動先(800,260)=距離400 ⇒ scale 2。
    fireEvent.pointerDown(se, { button: 0, clientX: 600, clientY: 260, pointerId: 1 });
    fireEvent.pointerMove(se, { clientX: 800, clientY: 260, pointerId: 1 });
    expect(onGroupTransform).toHaveBeenLastCalledWith("group_001", { scale: 2 });
  });

  it("グループ枠の回転ハンドルで transform.rotation が更新される（#307）", () => {
    const onGroupTransform = vi.fn();
    const { root } = renderOverlay({ groups: [grp], activeGroupId: "group_001", onGroupTransform });
    mockRect(root);
    const knob = root.querySelector('[data-testid="tmpl-group-rotate-handle"]') as HTMLElement;
    // 枠中心(400,260) の右(600,260)＝3時方向＝90°。
    fireEvent.pointerDown(knob, { button: 0, clientX: 400, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(knob, { clientX: 600, clientY: 260, pointerId: 1 });
    const calls = onGroupTransform.mock.calls;
    expect(calls[calls.length - 1][0]).toBe("group_001");
    expect(calls[calls.length - 1][1].rotation).toBeCloseTo(90, 1);
  });

  it("ロック中のグループは枠ハンドル（拡縮・回転）を出さない（#307）", () => {
    const lockedGrp = { ...grp, locked: true };
    const { root } = renderOverlay({ groups: [lockedGrp], activeGroupId: "group_001" });
    expect(root.querySelector('[data-testid="tmpl-group-frame"]')).not.toBeNull(); // 枠は出る
    expect(root.querySelector('[data-testid="tmpl-group-scale-se"]')).toBeNull();
    expect(root.querySelector('[data-testid="tmpl-group-rotate-handle"]')).toBeNull();
  });
});
