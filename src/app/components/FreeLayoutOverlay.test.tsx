// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { FreeLayoutOverlay } from "./FreeLayoutOverlay";
import type { FreeElement } from "../../domain/project/types";
import { FREE_ELEMENT_KIND } from "../../domain/enums";

// FreeLayoutOverlay の「対話」をブラウザ非依存で自動検証するサンプル（ADR-0014）。
// 各要素ボックスの中身（テキスト等）は重ねる ScenePreview 側が描くため overlay のボックスは
// ロール/テキストで引けない。よってルート直下の子要素を構造で参照する（順序は freeLayout と一致）。
// 一方、右クリックメニュー（role="menu"/"menuitem"）とインライン編集の textarea はロールで引ける。

const CANVAS_W = 1920;
const CANVAS_H = 1080;

function makeLayout(): FreeElement[] {
  return [
    { id: "free_001", kind: FREE_ELEMENT_KIND.text, x: 100, y: 100, w: 400, h: 120, zIndex: 2, text: "見出し" },
    { id: "free_002", kind: FREE_ELEMENT_KIND.shape, x: 0, y: 0, w: 200, h: 200, zIndex: 1 },
  ];
}

function renderOverlay(overrides: Partial<ComponentProps<typeof FreeLayoutOverlay>> = {}) {
  const spies = {
    onSelect: vi.fn(),
    onSelectMany: vi.fn(),
    onChange: vi.fn(),
    onMoveMany: vi.fn(),
    onResizeMany: vi.fn(),
    onRotate: vi.fn(),
    onDuplicate: vi.fn(),
    onBringToFront: vi.fn(),
    onSendToBack: vi.fn(),
    onDelete: vi.fn(),
    onChangeText: vi.fn(),
    onRequestEdit: vi.fn(),
  };
  const result = render(
    <FreeLayoutOverlay
      freeLayout={makeLayout()}
      canvasW={CANVAS_W}
      canvasH={CANVAS_H}
      selectedIds={[]}
      {...spies}
      {...overrides}
    />,
  );
  const root = result.container.firstElementChild as HTMLElement;
  const boxes = Array.from(root.children) as HTMLElement[]; // [0]=free_001(text), [1]=free_002(shape)
  return { ...spies, root, boxes, ...result };
}

describe("FreeLayoutOverlay: 選択とリサイズハンドル", () => {
  it("選択中の要素にリサイズ(4)＋回転ハンドルが出て、非選択には出ない", () => {
    const { root, boxes } = renderOverlay({ selectedIds: ["free_001"] });
    expect(root).toBeInTheDocument();
    expect(boxes).toHaveLength(2);
    expect(boxes[0].children).toHaveLength(6); // 選択中＝リサイズ4＋回転(stem+knob)2
    expect(screen.getByTestId("rotate-handle")).toBeInTheDocument(); // 回転ハンドルが出る
    expect(boxes[1].children).toHaveLength(0); // 非選択＝ハンドルなし
  });

  it("要素を押すと、その id で選択コールバックが呼ばれる", () => {
    const { boxes, onSelect } = renderOverlay();
    fireEvent.pointerDown(boxes[1], { button: 0, clientX: 50, clientY: 50, pointerId: 1 });
    expect(onSelect).toHaveBeenCalledWith("free_002");
  });

  it("要素押下はルートまで伝播せず、選択が解除されない（stopPropagation）", () => {
    const { boxes, onSelect } = renderOverlay();
    fireEvent.pointerDown(boxes[0], { button: 0, pointerId: 1 });
    expect(onSelect).toHaveBeenCalledWith("free_001");
    expect(onSelect).not.toHaveBeenCalledWith(null);
  });

  it("何もない所（ルート）を押すと選択が解除される（null）", () => {
    const { root, onSelect } = renderOverlay({ selectedIds: ["free_001"] });
    fireEvent.pointerDown(root, { button: 0, clientX: 5, clientY: 5, pointerId: 1 });
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});

describe("FreeLayoutOverlay: 複数選択・一括操作（#206）", () => {
  it("複数選択中はグループ bbox の角ハンドルを出し、個別要素にはハンドルを出さない（#274）", () => {
    const { boxes } = renderOverlay({ selectedIds: ["free_002", "free_001"] });
    expect(boxes[0].children).toHaveLength(0); // 個別ハンドルは出さない（グループに集約）
    expect(boxes[1].children).toHaveLength(0);
    const bbox = screen.getByTestId("group-bbox");
    expect(bbox).toBeInTheDocument();
    expect(bbox.children).toHaveLength(4); // グループ bbox に4つの角ハンドル
  });

  it("Shift＋クリックは選択トグル（additive=true）で呼ばれ、ドラッグ移動は始まらない", () => {
    const { boxes, onSelect, onMoveMany } = renderOverlay({ selectedIds: ["free_001"] });
    fireEvent.pointerDown(boxes[1], { button: 0, shiftKey: true, clientX: 50, clientY: 50, pointerId: 1 });
    expect(onSelect).toHaveBeenCalledWith("free_002", true);
    fireEvent.pointerMove(boxes[1], { clientX: 90, clientY: 90, pointerId: 1 });
    expect(onMoveMany).not.toHaveBeenCalled(); // Shift＋クリックは選択操作のみ
  });

  it("選択済みの要素をドラッグすると、選択中の全要素が同じ差分で一括移動する（onMoveMany）", () => {
    const { root, boxes, onMoveMany } = renderOverlay({ selectedIds: ["free_001", "free_002"] });
    // jsdom は実レイアウトを持たず clientWidth=0（→scale=0）になるため、canvas と等倍（scale=1）になるよう明示。
    Object.defineProperty(root, "clientWidth", { value: CANVAS_W, configurable: true });
    // 主（free_001・末尾）を掴んで動かす。free_001 start=(100,100), free_002 start=(0,0)、差分(+30,+40)。
    fireEvent.pointerDown(boxes[0], { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(boxes[0], { clientX: 30, clientY: 40, pointerId: 1 });
    expect(onMoveMany).toHaveBeenLastCalledWith([
      { id: "free_001", x: 130, y: 140 },
      { id: "free_002", x: 30, y: 40 },
    ]);
  });
});

describe("FreeLayoutOverlay: グループ（ADR-0022・#305）", () => {
  const grp = { id: "group_001", members: ["free_001"], transform: { x: 0, y: 0, rotation: 0, scale: 1 } };
  // jsdom はレイアウトを持たないため getBoundingClientRect を実寸でモック（toCanvas が scale=1＝canvas 等倍）。
  const mockRect = (root: HTMLElement) => {
    root.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: CANVAS_W, height: CANVAS_H, right: CANVAS_W, bottom: CANVAS_H, x: 0, y: 0, toJSON: () => undefined }) as DOMRect;
  };

  it("グループのメンバーを押すとグループ選択コールバックが呼ばれる（onSelectGroup・個別選択は呼ばない）", () => {
    const onSelectGroup = vi.fn();
    const { boxes, onSelect } = renderOverlay({ groups: [grp], onSelectGroup });
    fireEvent.pointerDown(boxes[0], { button: 0, pointerId: 1 }); // free_001＝グループ所属
    expect(onSelectGroup).toHaveBeenCalledWith("group_001");
    expect(onSelect).not.toHaveBeenCalledWith("free_001");
  });

  it("グループ選択中はグループ枠（group-frame）が出る", () => {
    renderOverlay({ groups: [grp], activeGroupId: "group_001" });
    expect(screen.getByTestId("group-frame")).toBeInTheDocument();
  });

  it("グループのメンバーには個別リサイズハンドルを出さない（グループ単位で編集）", () => {
    const { boxes } = renderOverlay({ groups: [grp], activeGroupId: "group_001", selectedIds: ["free_001"] });
    expect(boxes[0].children).toHaveLength(0); // grouped＝primary でもハンドルなし
  });

  it("グループ枠をドラッグするとグループの transform.x/y が更新される（onGroupTransform）", () => {
    const onGroupTransform = vi.fn();
    const { root } = renderOverlay({ groups: [grp], activeGroupId: "group_001", onGroupTransform });
    Object.defineProperty(root, "clientWidth", { value: CANVAS_W, configurable: true }); // scale=1
    const frame = screen.getByTestId("group-frame");
    fireEvent.pointerDown(frame, { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(frame, { clientX: 30, clientY: 40, pointerId: 1 });
    expect(onGroupTransform).toHaveBeenLastCalledWith("group_001", { x: 30, y: 40 });
  });

  it("グループ枠の角ハンドルをドラッグすると transform.scale が更新される（中心固定の一様拡縮・#305-2）", () => {
    const onGroupTransform = vi.fn();
    const { root } = renderOverlay({ groups: [grp], activeGroupId: "group_001", onGroupTransform });
    mockRect(root);
    const se = screen.getByTestId("group-scale-se");
    // free_001=(100,100,400,120) → 枠中心(300,160)。開始(500,160)=距離200、移動先(700,160)=距離400 ⇒ scale 2。
    fireEvent.pointerDown(se, { button: 0, clientX: 500, clientY: 160, pointerId: 1 });
    fireEvent.pointerMove(se, { clientX: 700, clientY: 160, pointerId: 1 });
    expect(onGroupTransform).toHaveBeenLastCalledWith("group_001", { scale: 2 });
  });

  it("グループ枠の回転ハンドルをドラッグすると transform.rotation が更新される（#305-2）", () => {
    const onGroupTransform = vi.fn();
    const { root } = renderOverlay({ groups: [grp], activeGroupId: "group_001", onGroupTransform });
    mockRect(root);
    const knob = screen.getByTestId("group-rotate-handle");
    // 枠中心(300,160) の右(500,160)＝3時方向＝90°（上=0°時計回り）。
    fireEvent.pointerDown(knob, { button: 0, clientX: 300, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(knob, { clientX: 500, clientY: 160, pointerId: 1 });
    const calls = onGroupTransform.mock.calls;
    const last = calls[calls.length - 1];
    expect(last[0]).toBe("group_001");
    expect(last[1].rotation).toBeCloseTo(90, 1);
  });

  it("ロック中のグループは枠ハンドル（拡縮・回転）を出さない", () => {
    renderOverlay({ groups: [{ ...grp, locked: true }], activeGroupId: "group_001" });
    expect(screen.getByTestId("group-frame")).toBeInTheDocument(); // 枠は出る
    expect(screen.queryByTestId("group-scale-se")).toBeNull(); // 拡縮ハンドルなし
    expect(screen.queryByTestId("group-rotate-handle")).toBeNull(); // 回転ハンドルなし
  });
});

describe("FreeLayoutOverlay: 範囲選択（マーキー・#274）", () => {
  // jsdom はレイアウトを持たないため getBoundingClientRect を実寸でモック（scale=1＝canvas と等倍）。
  const mockRect = (root: HTMLElement) => {
    root.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: CANVAS_W, height: CANVAS_H, right: CANVAS_W, bottom: CANVAS_H, x: 0, y: 0, toJSON: () => undefined }) as DOMRect;
  };

  it("空白をドラッグすると矩形が出て、交差した要素が onSelectMany でまとめて選択される", () => {
    const { root, onSelect, onSelectMany } = renderOverlay({ selectedIds: [] });
    mockRect(root);
    fireEvent.pointerDown(root, { button: 0, clientX: 50, clientY: 50, pointerId: 1 });
    expect(onSelect).toHaveBeenCalledWith(null); // 空白押下で一旦解除
    expect(screen.getByTestId("marquee")).toBeInTheDocument(); // 矩形が出る
    fireEvent.pointerMove(root, { clientX: 350, clientY: 350, pointerId: 1 });
    // free_001(100,100,400,120) と free_002(0,0,200,200) が矩形(50..350)に交差。
    expect(onSelectMany).toHaveBeenLastCalledWith(["free_001", "free_002"]);
    fireEvent.pointerUp(root, { pointerId: 1 });
    expect(screen.queryByTestId("marquee")).not.toBeInTheDocument(); // 終了で矩形が消える
  });

  it("空白クリック（ドラッグなし）は選択解除のままで集合選択は呼ばれない", () => {
    const { root, onSelect, onSelectMany } = renderOverlay({ selectedIds: ["free_001"] });
    mockRect(root);
    fireEvent.pointerDown(root, { button: 0, clientX: 50, clientY: 50, pointerId: 1 });
    fireEvent.pointerUp(root, { pointerId: 1 });
    expect(onSelect).toHaveBeenCalledWith(null);
    expect(onSelectMany).not.toHaveBeenCalled(); // 動かしていない＝集合選択なし
    expect(screen.queryByTestId("marquee")).not.toBeInTheDocument();
  });
});

describe("FreeLayoutOverlay: 複数同時リサイズ（#274）", () => {
  it("グループの角ハンドルをドラッグすると選択要素がまとめてスケールされる（onResizeMany）", () => {
    const layout: FreeElement[] = [
      { id: "free_001", kind: FREE_ELEMENT_KIND.shape, x: 0, y: 0, w: 100, h: 100, zIndex: 1 },
      { id: "free_002", kind: FREE_ELEMENT_KIND.shape, x: 100, y: 100, w: 100, h: 100, zIndex: 2 },
    ];
    const { root, onResizeMany } = renderOverlay({ freeLayout: layout, selectedIds: ["free_001", "free_002"] });
    Object.defineProperty(root, "clientWidth", { value: CANVAS_W, configurable: true });
    // bbox=(0,0,200,200)。se 角を +200,+200 → bbox 2倍(0,0,400,400)。各要素も相対位置を保って2倍。
    const se = screen.getByTestId("group-handle-se");
    fireEvent.pointerDown(se, { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(root, { clientX: 200, clientY: 200, pointerId: 1 });
    expect(onResizeMany).toHaveBeenLastCalledWith([
      { id: "free_001", x: 0, y: 0, w: 200, h: 200 },
      { id: "free_002", x: 200, y: 200, w: 200, h: 200 },
    ]);
  });

  it("ロック中の要素はグループ拡縮の対象に含めない", () => {
    const layout: FreeElement[] = [
      { id: "free_001", kind: FREE_ELEMENT_KIND.shape, x: 0, y: 0, w: 100, h: 100, zIndex: 1 },
      { id: "free_002", kind: FREE_ELEMENT_KIND.shape, x: 100, y: 100, w: 100, h: 100, zIndex: 2, locked: true },
    ];
    const { root, onResizeMany } = renderOverlay({ freeLayout: layout, selectedIds: ["free_001", "free_002"] });
    Object.defineProperty(root, "clientWidth", { value: CANVAS_W, configurable: true });
    // 非ロックは free_001 のみ＝bbox=(0,0,100,100)。se +100,+100 で2倍。free_002(locked) は含まれない。
    const se = screen.getByTestId("group-handle-se");
    fireEvent.pointerDown(se, { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(root, { clientX: 100, clientY: 100, pointerId: 1 });
    expect(onResizeMany).toHaveBeenLastCalledWith([{ id: "free_001", x: 0, y: 0, w: 200, h: 200 }]);
  });

  it("回転中の要素もグループ拡縮の対象に含める（見た目 AABB で囲む・#300(a)）", () => {
    const layout: FreeElement[] = [
      { id: "free_001", kind: FREE_ELEMENT_KIND.shape, x: 0, y: 0, w: 100, h: 100, zIndex: 1 },
      { id: "free_002", kind: FREE_ELEMENT_KIND.shape, x: 100, y: 100, w: 100, h: 100, zIndex: 2, rotation: 30 },
    ];
    const { root, onResizeMany } = renderOverlay({ freeLayout: layout, selectedIds: ["free_001", "free_002"] });
    Object.defineProperty(root, "clientWidth", { value: CANVAS_W, configurable: true });
    // 以前は回転要素を除外していたが、枠を見た目（回転後）AABB で取るため両方を一括拡縮に含める（#300(a)）。
    const se = screen.getByTestId("group-handle-se");
    fireEvent.pointerDown(se, { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(root, { clientX: 100, clientY: 100, pointerId: 1 });
    // 幾何の厳密値は freeLayoutOps のユニットで検証。ここでは回転要素(free_002)が含まれる配線を確認する。
    expect(onResizeMany).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: "free_001" }),
        expect.objectContaining({ id: "free_002" }),
      ]),
    );
    expect(onResizeMany.mock.lastCall?.[0]).toHaveLength(2);
  });
});

describe("FreeLayoutOverlay: 回転ハンドル（#279）", () => {
  const mockRect = (root: HTMLElement) => {
    root.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: CANVAS_W, height: CANVAS_H, right: CANVAS_W, bottom: CANVAS_H, x: 0, y: 0, toJSON: () => undefined }) as DOMRect;
  };

  it("単一選択の回転ハンドルをドラッグすると中心からの角度で onRotate が呼ばれる", () => {
    const layout: FreeElement[] = [{ id: "free_001", kind: FREE_ELEMENT_KIND.shape, x: 100, y: 100, w: 200, h: 200, zIndex: 1 }];
    const { root, onRotate } = renderOverlay({ freeLayout: layout, selectedIds: ["free_001"] });
    mockRect(root);
    fireEvent.pointerDown(screen.getByTestId("rotate-handle"), { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    // center=(200,200)。ポインタを中心の真右(300,200)へ → 90°。
    fireEvent.pointerMove(root, { clientX: 300, clientY: 200, pointerId: 1 });
    expect(onRotate).toHaveBeenLastCalledWith("free_001", 90);
  });

  it("Shift ドラッグは15°きざみに吸着する", () => {
    const layout: FreeElement[] = [{ id: "free_001", kind: FREE_ELEMENT_KIND.shape, x: 0, y: 0, w: 200, h: 200, zIndex: 1 }];
    const { root, onRotate } = renderOverlay({ freeLayout: layout, selectedIds: ["free_001"] });
    mockRect(root);
    fireEvent.pointerDown(screen.getByTestId("rotate-handle"), { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(root, { clientX: 200, clientY: 130, shiftKey: true, pointerId: 1 });
    const last = onRotate.mock.calls[onRotate.mock.calls.length - 1];
    expect(last[0]).toBe("free_001");
    expect((last[1] as number) % 15).toBe(0); // 15°きざみ
  });

  it("複数選択中は回転ハンドルを出さない（回転は単一要素のみ）", () => {
    const layout: FreeElement[] = [
      { id: "free_001", kind: FREE_ELEMENT_KIND.shape, x: 0, y: 0, w: 100, h: 100, zIndex: 1 },
      { id: "free_002", kind: FREE_ELEMENT_KIND.shape, x: 200, y: 200, w: 100, h: 100, zIndex: 2 },
    ];
    renderOverlay({ freeLayout: layout, selectedIds: ["free_001", "free_002"] });
    expect(screen.queryByTestId("rotate-handle")).toBeNull();
  });

  it("回転ドラッグは onInteractionStart/End を呼ぶ（Undo の1ステップ境界・#211）", () => {
    const layout: FreeElement[] = [{ id: "free_001", kind: FREE_ELEMENT_KIND.shape, x: 100, y: 100, w: 200, h: 200, zIndex: 1 }];
    const onInteractionStart = vi.fn();
    const onInteractionEnd = vi.fn();
    const { root } = renderOverlay({ freeLayout: layout, selectedIds: ["free_001"], onInteractionStart, onInteractionEnd });
    fireEvent.pointerDown(screen.getByTestId("rotate-handle"), { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    expect(onInteractionStart).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(root, { pointerId: 1 });
    expect(onInteractionEnd).toHaveBeenCalledTimes(1);
  });
});

describe("FreeLayoutOverlay: 吸着ガイド（#205 後半）", () => {
  it("他要素の左辺の近くへドラッグすると左辺に吸着し、縦ガイド線が現れる", () => {
    const layout: FreeElement[] = [
      { id: "free_001", kind: FREE_ELEMENT_KIND.shape, x: 100, y: 400, w: 200, h: 100, zIndex: 1 },
      { id: "free_002", kind: FREE_ELEMENT_KIND.shape, x: 0, y: 0, w: 80, h: 40, zIndex: 2 },
    ];
    const { root, onMoveMany } = renderOverlay({ freeLayout: layout, selectedIds: ["free_002"] });
    Object.defineProperty(root, "clientWidth", { value: CANVAS_W, configurable: true });
    const box002 = root.children[1] as HTMLElement;
    expect(screen.queryByTestId("snap-guide-x")).not.toBeInTheDocument(); // ドラッグ前はガイドなし
    // free_002(left=0) を +96 動かすと left=96。free_001.left=100 に距離4（threshold 6 以内）→ x=100 に吸着。
    fireEvent.pointerDown(box002, { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(box002, { clientX: 96, clientY: 5, pointerId: 1 });
    expect(onMoveMany).toHaveBeenLastCalledWith([{ id: "free_002", x: 100, y: 5 }]); // 左辺に吸着
    expect(screen.getByTestId("snap-guide-x")).toBeInTheDocument(); // 縦ガイド線が現れる
    // ドラッグ終了でガイドは消える。
    fireEvent.pointerUp(box002, { pointerId: 1 });
    expect(screen.queryByTestId("snap-guide-x")).not.toBeInTheDocument();
  });

  it("どの辺も threshold 外なら吸着せずガイドも出ない", () => {
    const layout: FreeElement[] = [
      { id: "free_001", kind: FREE_ELEMENT_KIND.shape, x: 100, y: 400, w: 200, h: 100, zIndex: 1 },
      { id: "free_002", kind: FREE_ELEMENT_KIND.shape, x: 0, y: 0, w: 80, h: 40, zIndex: 2 },
    ];
    const { root, onMoveMany } = renderOverlay({ freeLayout: layout, selectedIds: ["free_002"] });
    Object.defineProperty(root, "clientWidth", { value: CANVAS_W, configurable: true });
    const box002 = root.children[1] as HTMLElement;
    fireEvent.pointerDown(box002, { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    // x=40 → left=40/right=120/centerX=80。free_001 の left100/right300/centerX200 のどれにも 6px 以内で当たらない。
    fireEvent.pointerMove(box002, { clientX: 40, clientY: 40, pointerId: 1 });
    expect(onMoveMany).toHaveBeenLastCalledWith([{ id: "free_002", x: 40, y: 40 }]);
    expect(screen.queryByTestId("snap-guide-x")).not.toBeInTheDocument(); // ガイドなし
    expect(screen.queryByTestId("snap-guide-y")).not.toBeInTheDocument();
  });
});

describe("FreeLayoutOverlay: 右クリックの操作メニュー（#174）", () => {
  it("テキスト要素を右クリックすると「編集/複製/前面/背面/削除」が並ぶ", () => {
    const { boxes } = renderOverlay();
    fireEvent.contextMenu(boxes[0], { clientX: 100, clientY: 100 });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    const labels = screen.getAllByRole("menuitem").map((b) => b.textContent);
    expect(labels).toEqual(["編集", "複製", "前面", "背面", "削除"]);
  });

  it("図形の右クリックにも「編集」が並ぶ（#185：全 kind で kind 別エディタを開く）", () => {
    const { boxes } = renderOverlay();
    fireEvent.contextMenu(boxes[1], { clientX: 100, clientY: 100 });
    const labels = screen.getAllByRole("menuitem").map((b) => b.textContent);
    expect(labels).toEqual(["編集", "複製", "前面", "背面", "削除"]);
  });

  it("「複製」を押すと対象 id で onDuplicate が呼ばれ、メニューが閉じる", () => {
    const { boxes, onDuplicate } = renderOverlay();
    fireEvent.contextMenu(boxes[1], { clientX: 100, clientY: 100 });
    fireEvent.click(screen.getByRole("menuitem", { name: "複製" }));
    expect(onDuplicate).toHaveBeenCalledWith("free_002");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("「削除」を押すと対象 id で onDelete が呼ばれる", () => {
    const { boxes, onDelete } = renderOverlay();
    fireEvent.contextMenu(boxes[1], { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole("menuitem", { name: "削除" }));
    expect(onDelete).toHaveBeenCalledWith("free_002");
  });

  it("Escape でメニューが閉じる", () => {
    const { boxes } = renderOverlay();
    fireEvent.contextMenu(boxes[0], { clientX: 100, clientY: 100 });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

describe("FreeLayoutOverlay: テキストのインライン編集（#174）", () => {
  // テキスト要素をダブルクリックして編集中の textarea を返す。
  function openTextEditor() {
    const ctx = renderOverlay();
    fireEvent.doubleClick(ctx.boxes[0]); // free_001（text）
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    return { ...ctx, textarea };
  }

  it("メニューの「編集」で onRequestEdit が対象 id と座標で呼ばれメニューが閉じる（#185：kind 別エディタを開く）", () => {
    const { boxes, onRequestEdit } = renderOverlay();
    fireEvent.contextMenu(boxes[0], { clientX: 120, clientY: 140 });
    fireEvent.click(screen.getByRole("menuitem", { name: "編集" }));
    expect(onRequestEdit).toHaveBeenCalledWith("free_001", expect.any(Number), expect.any(Number));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument(); // 「編集」を押すとメニューは閉じる
    // textarea はダブルクリックで開く（編集メニューはポップオーバー＝親側を開くのみ）。
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("テキスト要素のダブルクリックで textarea が現れ、現在の文字が入る", () => {
    const { textarea } = openTextEditor();
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveValue("見出し");
  });

  it("textarea へ入力すると、対象 id と入力値で onChangeText が呼ばれる", () => {
    const { textarea, onChangeText } = openTextEditor();
    fireEvent.change(textarea, { target: { value: "新しい見出し" } });
    expect(onChangeText).toHaveBeenCalledWith("free_001", "新しい見出し");
  });

  it("Enter（Shift なし）で編集を抜ける（textarea が消える）", () => {
    const { textarea } = openTextEditor();
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("Esc で編集を抜ける", () => {
    const { textarea } = openTextEditor();
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("フォーカスを外す（blur）と編集を抜ける", () => {
    const { textarea } = openTextEditor();
    fireEvent.blur(textarea);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("Shift+Enter は改行のため編集を抜けない（textarea が残る）", () => {
    const { textarea } = openTextEditor();
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("テキスト以外（図形）のダブルクリックでは textarea は出ない", () => {
    const { boxes } = renderOverlay();
    fireEvent.doubleClick(boxes[1]); // free_002（shape）
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});

describe("FreeLayoutOverlay: 回転（#208）", () => {
  it("回転している主要素も CSS rotate を当てつつリサイズ4＋回転ハンドルを出す（回転考慮リサイズ・#279後継）", () => {
    const layout: FreeElement[] = [
      { id: "free_001", kind: FREE_ELEMENT_KIND.shape, x: 100, y: 100, w: 200, h: 100, zIndex: 1, rotation: 30 },
    ];
    const { root } = renderOverlay({ freeLayout: layout, selectedIds: ["free_001"] });
    const box = root.children[0] as HTMLElement;
    expect(box.style.transform).toContain("rotate(30deg)");
    expect(screen.getByTestId("rotate-handle")).toBeInTheDocument();
    expect(box.children).toHaveLength(6); // リサイズ4＋回転(stem+knob)2＝回転要素もリサイズできる（#279後継）
  });

  it("回転要素のリサイズカーソルは画面の実方向に合わせる（90°で nw は nesw-resize・#279後継）", () => {
    const layout: FreeElement[] = [
      { id: "free_001", kind: FREE_ELEMENT_KIND.shape, x: 100, y: 100, w: 200, h: 100, zIndex: 1, rotation: 90 },
    ];
    const { root } = renderOverlay({ freeLayout: layout, selectedIds: ["free_001"] });
    const box = root.children[0] as HTMLElement;
    // 子の先頭4つがリサイズハンドル（nw,ne,sw,se 順）。nw は 90°回転で nwse→nesw に変わる。
    expect((box.children[0] as HTMLElement).style.cursor).toBe("nesw-resize");
  });

  it("回転 0（未指定）の主要素はリサイズ4＋回転ハンドルを出し、transform を付けない（#208/#279）", () => {
    const layout: FreeElement[] = [
      { id: "free_001", kind: FREE_ELEMENT_KIND.shape, x: 100, y: 100, w: 200, h: 100, zIndex: 1 },
    ];
    const { root } = renderOverlay({ freeLayout: layout, selectedIds: ["free_001"] });
    const box = root.children[0] as HTMLElement;
    expect(box.style.transform).toBe("");
    expect(screen.getByTestId("rotate-handle")).toBeInTheDocument();
    expect(box.children).toHaveLength(6); // リサイズ4＋回転(stem+knob)2
  });
});

describe("FreeLayoutOverlay: 非表示/ロック（#210）", () => {
  it("hidden の要素は箱を描かない（レイヤー一覧から再表示）", () => {
    const layout: FreeElement[] = [
      { id: "free_001", kind: FREE_ELEMENT_KIND.shape, x: 0, y: 0, w: 100, h: 100, zIndex: 1, hidden: true },
      { id: "free_002", kind: FREE_ELEMENT_KIND.shape, x: 0, y: 0, w: 100, h: 100, zIndex: 2 },
    ];
    const { root } = renderOverlay({ freeLayout: layout });
    expect(root.children).toHaveLength(1); // free_001 は描かれず free_002 の1箱のみ
  });

  it("ロック中の要素はクリックで選択されるが、ドラッグしても移動しない", () => {
    const layout: FreeElement[] = [
      { id: "free_001", kind: FREE_ELEMENT_KIND.shape, x: 100, y: 100, w: 200, h: 100, zIndex: 1, locked: true },
    ];
    const { root, onSelect, onMoveMany } = renderOverlay({ freeLayout: layout, selectedIds: ["free_001"] });
    Object.defineProperty(root, "clientWidth", { value: CANVAS_W, configurable: true });
    const box = root.children[0] as HTMLElement;
    fireEvent.pointerDown(box, { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    expect(onSelect).toHaveBeenCalledWith("free_001"); // 選択はされる
    fireEvent.pointerMove(box, { clientX: 50, clientY: 50, pointerId: 1 });
    expect(onMoveMany).not.toHaveBeenCalled(); // ロック中は移動しない
    expect(box.children).toHaveLength(0); // リサイズハンドルも出さない
  });
});
