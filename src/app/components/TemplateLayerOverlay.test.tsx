// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { fireEvent, render } from "@testing-library/react";
import { TemplateLayerOverlay } from "./TemplateLayerOverlay";
import { isPointerDragging } from "../hooks/usePointerDrag";
import { hasEscapeOwner } from "../hooks/escapeOwners";
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
    fireEvent.pointerMove(boxes[1], { buttons: 1, clientX: 30, clientY: 40, pointerId: 1 });
    // title start (200,200) + (30,40) = (230,240)。背景全面への吸着は閾値外で発生しない。
    expect(onMoveMany).toHaveBeenLastCalledWith([{ id: "title", x: 230, y: 240 }]);
  });

  /** 掴んで動かす（しきい値を越えるだけ動かす）。実寸を与えないと縮尺 0 で**そもそも動かない**。 */
  const grabbed = () => {
    const r = renderOverlay({ selectedIds: ["title"] });
    Object.defineProperty(r.root, "clientWidth", { value: CANVAS_W, configurable: true });
    fireEvent.pointerDown(r.boxes[1], { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    return r;
  };

  it("**掴んでいる間は取り消しを止める**（3つのキャンバスで同じ作法・#769）", () => {
    // ⚠️ ここだけ数に入れていなかった＝掴んでいる最中の `Ctrl+Z` が通り、**取り消しで戻した下書きの上に
    // 続きの動きが古い開始値から書き戻す**（取り消しが黙って打ち消される）。
    expect(isPointerDragging()).toBe(false);
    const { root } = grabbed();
    expect(isPointerDragging()).toBe(true);
    fireEvent.pointerUp(root, { clientX: 0, clientY: 0, pointerId: 1 });
    expect(isPointerDragging()).toBe(false);
  });

  it("**`Escape` でやめると元の位置へ戻す**（掴んだまま戻れない、を作らない・#769）", () => {
    const { boxes, onMoveMany } = grabbed();
    fireEvent.pointerMove(boxes[1], { buttons: 1, clientX: 30, clientY: 40, pointerId: 1 });
    onMoveMany.mockClear();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onMoveMany).toHaveBeenLastCalledWith([{ id: "title", x: 200, y: 200 }]); // 開始時の値へ
    expect(isPointerDragging()).toBe(false);
    expect(hasEscapeOwner()).toBe(false);
  });

  it("**少し動かすまで動かさない**（押しただけでは位置を書かない・#769）", () => {
    const { boxes, onMoveMany } = grabbed();
    fireEvent.pointerMove(boxes[1], { buttons: 1, clientX: 2, clientY: 1, pointerId: 1 }); // しきい値の内
    expect(onMoveMany).not.toHaveBeenCalled();
    fireEvent.pointerMove(boxes[1], { buttons: 1, clientX: 30, clientY: 0, pointerId: 1 });
    expect(onMoveMany).toHaveBeenCalled();
  });

  it("**離すのを取り逃がしたら元へ戻して終わる**（影が指に付いたままにしない・#769）", () => {
    const { boxes, onMoveMany } = grabbed();
    fireEvent.pointerMove(boxes[1], { buttons: 1, clientX: 30, clientY: 40, pointerId: 1 });
    onMoveMany.mockClear();
    fireEvent.pointerMove(boxes[1], { buttons: 0, clientX: 60, clientY: 40, pointerId: 1 }); // 押していない
    expect(onMoveMany).toHaveBeenLastCalledWith([{ id: "title", x: 200, y: 200 }]);
    expect(isPointerDragging()).toBe(false);
    onMoveMany.mockClear();
    fireEvent.pointerMove(boxes[1], { buttons: 0, clientX: 90, clientY: 40, pointerId: 1 });
    expect(onMoveMany).not.toHaveBeenCalled(); // もう指に付いてこない
  });

  it("**枠の外で離しても名乗りを外す**（指を捕まえ損ねた回に塞ぎっぱなしにしない・#769）", () => {
    const { boxes } = grabbed();
    fireEvent.pointerMove(boxes[1], { buttons: 1, clientX: 30, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 900, clientY: 900, pointerId: 1 });
    expect(isPointerDragging()).toBe(false);
    expect(hasEscapeOwner()).toBe(false);
  });

  it("**別の指を離してもそこへ落とさない**（掴んだ指だけ見る・#769）", () => {
    const { boxes, onMoveMany } = grabbed();
    fireEvent.pointerMove(boxes[1], { buttons: 1, clientX: 30, clientY: 40, pointerId: 1 });
    onMoveMany.mockClear();
    fireEvent.pointerMove(boxes[1], { buttons: 1, clientX: 300, clientY: 300, pointerId: 2 }); // 別の指
    expect(onMoveMany).not.toHaveBeenCalled();
    fireEvent.pointerUp(window, { clientX: 300, clientY: 300, pointerId: 2 });
    expect(isPointerDragging()).toBe(true); // まだ掴んでいる
    fireEvent.pointerUp(window, { clientX: 30, clientY: 40, pointerId: 1 });
    expect(isPointerDragging()).toBe(false);
  });

  it("`Ctrl` を押している間は吸着しない（#686 段階4・決定12）", () => {
    // ⚠️ 3つのキャンバス（場面の自由配置・タイムライン・見た目パターン）で**切り方を揃える**。
    // ここだけ切れないと、同じ概念が画面によって切れたり切れなかったりする。
    const { root, boxes, onMoveMany } = renderOverlay({ selectedIds: ["title"] });
    Object.defineProperty(root, "clientWidth", { value: CANVAS_W, configurable: true });
    fireEvent.pointerDown(boxes[1], { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    // 背景（全面）の左辺 0 へ吸い付く距離まで戻す＝title の左辺 200 を 0 の近くへ。
    fireEvent.pointerMove(boxes[1], { buttons: 1, clientX: -197, clientY: 0, pointerId: 1 });
    const snapped = onMoveMany.mock.calls[onMoveMany.mock.calls.length - 1][0][0].x;
    fireEvent.pointerMove(boxes[1], { buttons: 1, clientX: -197, clientY: 0, pointerId: 1, ctrlKey: true });
    const raw = onMoveMany.mock.calls[onMoveMany.mock.calls.length - 1][0][0].x;
    expect(snapped).toBe(0); // 吸着すると背景の左辺へ
    expect(raw).toBe(3); // 押している間は指の位置のまま
  });

  it("角ハンドルをドラッグすると onChange に新しいサイズが渡る（純粋 resizeFreeElement 流用）", () => {
    const { root, boxes, onChange } = renderOverlay({ selectedIds: ["title"] });
    Object.defineProperty(root, "clientWidth", { value: CANVAS_W, configurable: true });
    const seHandle = boxes[1].querySelectorAll("div")[3]; // [nw,ne,sw,se] の se
    fireEvent.pointerDown(seHandle, { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(seHandle, { buttons: 1, clientX: 20, clientY: 10, pointerId: 1 });
    // se を (+20,+10)：左上 (200,200) 固定で w=400+20=420・h=120+10=130。
    expect(onChange).toHaveBeenLastCalledWith("title", expect.objectContaining({ x: 200, y: 200, w: 420, h: 130 }));
  });

  it("Shift+クリックで選択トグル（additive・ドラッグは始めない・#306）", () => {
    const { boxes, onSelect, onMoveMany } = renderOverlay({ selectedIds: ["title"] });
    fireEvent.pointerDown(boxes[0], { button: 0, shiftKey: true, clientX: 0, clientY: 0, pointerId: 1 });
    expect(onSelect).toHaveBeenCalledWith("background", true); // additive＝トグル
    fireEvent.pointerMove(boxes[0], { buttons: 1, clientX: 30, clientY: 40, pointerId: 1 });
    expect(onMoveMany).not.toHaveBeenCalled(); // Shift＋クリックは選択のみ
  });

  it("空白をドラッグ（マーキー）で交差レイヤーが onSelectMany に渡る（#306）", () => {
    const { root, onSelectMany } = renderOverlay();
    // jsdom はレイアウトを持たないため getBoundingClientRect を実寸でモック（canvas 等倍）。
    root.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: CANVAS_W, height: CANVAS_H, right: CANVAS_W, bottom: CANVAS_H, x: 0, y: 0, toJSON: () => undefined }) as DOMRect;
    fireEvent.pointerDown(root, { button: 0, clientX: 100, clientY: 100, pointerId: 1 }); // 空白＝root 自身
    fireEvent.pointerMove(root, { buttons: 1, clientX: 700, clientY: 400, pointerId: 1 }); // (100,100)-(700,400) に title が交差
    expect(onSelectMany).toHaveBeenLastCalledWith(["background", "title"]);
  });

  it("回転ハンドルをドラッグすると onRotate に角度が渡る（#279 同様）", () => {
    const { root, boxes, onRotate } = renderOverlay({ selectedIds: ["title"] });
    root.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: CANVAS_W, height: CANVAS_H, right: CANVAS_W, bottom: CANVAS_H, x: 0, y: 0, toJSON: () => undefined }) as DOMRect;
    const knob = boxes[1].querySelector('[data-testid="tmpl-rotate-handle"]') as HTMLElement;
    // title (200,200,400,120) 中心=(400,260)。右(600,260)＝3時方向＝90°。
    fireEvent.pointerDown(knob, { button: 0, clientX: 400, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(knob, { buttons: 1, clientX: 600, clientY: 260, pointerId: 1 });
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

  it("ネストした外側グループ（メンバーが子グループ id だけ）でも操作枠が出る（#525-10 レビュー）", () => {
    const outer = { id: "group_002", members: ["group_001"], transform: { x: 0, y: 0, rotation: 0, scale: 1 } };
    const { root } = renderOverlay({ groups: [grp, outer], activeGroupId: "group_002" });
    expect(root.querySelector('[data-testid="tmpl-group-frame"]')).not.toBeNull(); // 旧実装は枠が消えていた
  });

  it("非表示グループを選択中でも操作枠（tmpl-group-frame）は出さない＝描画されないものを操作可能にしない（#525-9 レビュー）", () => {
    const { root } = renderOverlay({ groups: [{ ...grp, hidden: true }], activeGroupId: "group_001" });
    expect(root.querySelector('[data-testid="tmpl-group-frame"]')).toBeNull();
  });

  it("グループ枠をドラッグするとグループの transform.x/y が更新される（onGroupTransform・#307）", () => {
    const onGroupTransform = vi.fn();
    const { root } = renderOverlay({ groups: [grp], activeGroupId: "group_001", onGroupTransform });
    Object.defineProperty(root, "clientWidth", { value: CANVAS_W, configurable: true }); // scale=1（ドラッグの縮尺）
    // #548/#552：枠の押下は「ポインタの下に何があるか」を実ヒットテストするようになったため rect の実寸が要る
    // （旧テストは座標が任意だった＝jsdom が当たり判定をせず何でも通っていた）。
    root.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: CANVAS_W, height: CANVAS_H, right: CANVAS_W, bottom: CANVAS_H, x: 0, y: 0, toJSON: () => undefined }) as DOMRect;
    const frame = root.querySelector('[data-testid="tmpl-group-frame"]') as HTMLElement;
    // 枠内かつ**メンバー**（title＝200,200,400,120）の上を押す＝まとまり移動（従来どおり）。
    fireEvent.pointerDown(frame, { button: 0, clientX: 300, clientY: 250, pointerId: 1 });
    fireEvent.pointerMove(frame, { buttons: 1, clientX: 330, clientY: 290, pointerId: 1 });
    expect(onGroupTransform).toHaveBeenLastCalledWith("group_001", { x: 30, y: 40 });
  });

  // #548/#552：グループ枠は不透明でグループ全域を覆うため、そのまま beginGroupDrag していた頃は枠内に重なる
  // **グループ外のレイヤー**を選べなかった（FREE 側 FreeLayoutOverlay と同型の欠陥＝テンプレ作成側も直す）。
  // **枠の pointerdown 経由**で発火＝実機と同じ経路（レイヤー div へ直接発火すると jsdom が重なり順を無視して偽陽性になる）。
  it("枠内でもグループ外のレイヤーの上を押したらそのレイヤーが選ばれる（グループは動かない・#552）", () => {
    const onGroupTransform = vi.fn();
    // 枠（＝title の bbox 200,200-600,320）の内側に、**グループ外**のレイヤーを最前面（zIndex 5）で重ねる。
    const layers = [
      { id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 },
      { id: "title", type: "text", x: 200, y: 200, w: 400, h: 120, zIndex: 1 },
      { id: "logo", type: "logo", x: 250, y: 220, w: 100, h: 60, zIndex: 5 },
    ] as Layer[];
    const { root, onSelect } = renderOverlay({ layers, groups: [grp], activeGroupId: "group_001", onGroupTransform });
    Object.defineProperty(root, "clientWidth", { value: CANVAS_W, configurable: true });
    root.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: CANVAS_W, height: CANVAS_H, right: CANVAS_W, bottom: CANVAS_H, x: 0, y: 0, toJSON: () => undefined }) as DOMRect;
    const frame = root.querySelector('[data-testid="tmpl-group-frame"]') as HTMLElement;
    // (300,250)＝logo（250,220,100,60・最前面）の上。枠に隠れて選べなかったレイヤー。
    fireEvent.pointerDown(frame, { button: 0, clientX: 300, clientY: 250, pointerId: 1 });
    expect(onSelect).toHaveBeenCalledWith("logo"); // 奥のレイヤーへ届く
    expect(onGroupTransform).not.toHaveBeenCalled(); // グループ移動にはならない
  });

  // レビュー🔴の回帰：テンプレは**全面 background を必ず持ち**、グループは**2メンバー以上**（LooksEditScreen が
  // 2未満を弾く）＝枠にはメンバー間の**空白**が必ずできる。委譲対象を絞らないと空白でも background に当たって
  // しまい、グループ移動どころか背景が動く（＋グループ選択も無言解除）。空白＝グループ移動を固定する。
  it("枠内の空白（メンバーの隙間）を押したらグループ移動＝奥の背景を掴まない（#307 維持）", () => {
    const onGroupTransform = vi.fn();
    const layers = [
      { id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 }, // 全面・メンバーより奥
      { id: "title", type: "text", x: 200, y: 200, w: 400, h: 120, zIndex: 1 },
      { id: "logo", type: "logo", x: 1400, y: 200, w: 200, h: 120, zIndex: 2 },
    ] as Layer[];
    const twoMemberGrp = { id: "group_001", members: ["title", "logo"], transform: { x: 0, y: 0, rotation: 0, scale: 1 } };
    const { root, onSelect, onMoveMany } = renderOverlay({ layers, groups: [twoMemberGrp], activeGroupId: "group_001", onGroupTransform });
    Object.defineProperty(root, "clientWidth", { value: CANVAS_W, configurable: true });
    root.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: CANVAS_W, height: CANVAS_H, right: CANVAS_W, bottom: CANVAS_H, x: 0, y: 0, toJSON: () => undefined }) as DOMRect;
    const frame = root.querySelector('[data-testid="tmpl-group-frame"]') as HTMLElement;
    // 枠 AABB(200,200)-(1600,320) の (900,250)＝title と logo の隙間。見えているのは background だが枠の内部。
    fireEvent.pointerDown(frame, { button: 0, clientX: 900, clientY: 250, pointerId: 1 });
    fireEvent.pointerMove(frame, { buttons: 1, clientX: 930, clientY: 290, pointerId: 1 });
    expect(onGroupTransform).toHaveBeenLastCalledWith("group_001", { x: 30, y: 40 }); // まとまりが動く
    expect(onSelect).not.toHaveBeenCalledWith("background"); // 奥の背景を掴まない
    expect(onMoveMany).not.toHaveBeenCalled();
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
    fireEvent.pointerMove(se, { buttons: 1, clientX: 800, clientY: 260, pointerId: 1 });
    expect(onGroupTransform).toHaveBeenLastCalledWith("group_001", { scale: 2 });
  });

  it("**まとまりの拡縮を `Escape` でやめると、掴む前の形へ戻す**（#777 レビュー 🔴）", () => {
    // ⚠️ `group-move` だけを戻していたので、拡縮・回転は**何も戻らなかった**（居ない id へ書いて
    // 黙って何も起きない）＝同じ画面で「操作によって `Escape` が効いたり効かなかったり」に見える。
    const onGroupTransform = vi.fn();
    const { root } = renderOverlay({ groups: [grp], activeGroupId: "group_001", onGroupTransform });
    mockRect(root);
    const se = root.querySelector('[data-testid="tmpl-group-scale-se"]') as HTMLElement;
    fireEvent.pointerDown(se, { button: 0, clientX: 600, clientY: 260, pointerId: 1 });
    fireEvent.pointerMove(se, { buttons: 1, clientX: 800, clientY: 260, pointerId: 1 });
    onGroupTransform.mockClear();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onGroupTransform).toHaveBeenLastCalledWith("group_001", grp.transform); // 掴む前の形へ
    expect(isPointerDragging()).toBe(false);
  });

  it("**まとまりの回転を `Escape` でやめても戻す**（#777 レビュー 🔴）", () => {
    const onGroupTransform = vi.fn();
    const { root } = renderOverlay({ groups: [grp], activeGroupId: "group_001", onGroupTransform });
    mockRect(root);
    const knob = root.querySelector('[data-testid="tmpl-group-rotate-handle"]') as HTMLElement;
    fireEvent.pointerDown(knob, { button: 0, clientX: 400, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(knob, { buttons: 1, clientX: 600, clientY: 260, pointerId: 1 });
    onGroupTransform.mockClear();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onGroupTransform).toHaveBeenLastCalledWith("group_001", grp.transform);
  });

  it("**まとまりの移動も同じく戻す**（3つのモードが同じ扱い・#777 レビュー）", () => {
    const onGroupTransform = vi.fn();
    const { root, boxes } = renderOverlay({ groups: [grp], activeGroupId: "group_001", onGroupTransform });
    mockRect(root);
    fireEvent.pointerDown(boxes[1], { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(boxes[1], { buttons: 1, clientX: 40, clientY: 40, pointerId: 1 });
    onGroupTransform.mockClear();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onGroupTransform).toHaveBeenLastCalledWith("group_001", grp.transform);
  });

  it("グループ枠の回転ハンドルで transform.rotation が更新される（#307）", () => {
    const onGroupTransform = vi.fn();
    const { root } = renderOverlay({ groups: [grp], activeGroupId: "group_001", onGroupTransform });
    mockRect(root);
    const knob = root.querySelector('[data-testid="tmpl-group-rotate-handle"]') as HTMLElement;
    // 枠中心(400,260) の右(600,260)＝3時方向＝90°。
    fireEvent.pointerDown(knob, { button: 0, clientX: 400, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(knob, { buttons: 1, clientX: 600, clientY: 260, pointerId: 1 });
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

// #547 P2-3：取り消しの「1操作＝1ステップ」境界。レイヤー/ハンドルの onPointerDown は stopPropagation するため、
// 祖先で pointerdown を見る方式では境界を取れない（＝連続移動が pointermove ごとに1履歴になり履歴上限を食い潰す）。
// 明示コールバックで通知することを固定する（FreeLayoutOverlay と同じ流儀）。
describe("TemplateLayerOverlay: 取り消しの合成境界（#547 P2-3）", () => {
  it("ドラッグは onInteractionStart/End を1回ずつ呼ぶ（連続移動では増えない）", () => {
    const onInteractionStart = vi.fn();
    const onInteractionEnd = vi.fn();
    const { root, boxes } = renderOverlay({ selectedIds: ["title"], onInteractionStart, onInteractionEnd });
    Object.defineProperty(root, "clientWidth", { value: CANVAS_W, configurable: true }); // scale=1
    fireEvent.pointerDown(boxes[1], { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    expect(onInteractionStart).toHaveBeenCalledTimes(1);
    fireEvent.pointerMove(root, { buttons: 1, clientX: 40, clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(root, { buttons: 1, clientX: 80, clientY: 40, pointerId: 1 });
    expect(onInteractionStart).toHaveBeenCalledTimes(1); // 移動中は増やさない
    expect(onInteractionEnd).not.toHaveBeenCalled(); // まだ閉じない
    fireEvent.pointerUp(root, { pointerId: 1 });
    expect(onInteractionEnd).toHaveBeenCalledTimes(1);
  });

  it("回転ハンドルのドラッグでも境界を通知する", () => {
    const onInteractionStart = vi.fn();
    const onInteractionEnd = vi.fn();
    const { root, boxes } = renderOverlay({ selectedIds: ["title"], onInteractionStart, onInteractionEnd });
    Object.defineProperty(root, "clientWidth", { value: CANVAS_W, configurable: true });
    const knob = boxes[1].querySelectorAll("div")[5] as HTMLElement; // 回転ノブ（リサイズ4＋stem の次）
    fireEvent.pointerDown(knob, { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    expect(onInteractionStart).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(root, { pointerId: 1 });
    expect(onInteractionEnd).toHaveBeenCalledTimes(1);
  });

  // この性質が「祖先で pointerdown を拾う実装」を成立させない理由そのもの＝退行の再発防止。
  it("レイヤーの onPointerDown は祖先へ伝播しない（祖先検知では境界を取れない）", () => {
    const ancestorDown = vi.fn();
    const onInteractionStart = vi.fn();
    const { getByText } = render(
      <div onPointerDown={ancestorDown}>
        <TemplateLayerOverlay
          layers={makeLayers()}
          canvasW={CANVAS_W}
          canvasH={CANVAS_H}
          selectedIds={["title"]}
          onSelect={vi.fn()}
          onSelectMany={vi.fn()}
          onChange={vi.fn()}
          onMoveMany={vi.fn()}
          onRotate={vi.fn()}
          label={(l) => l.type}
          onInteractionStart={onInteractionStart}
        />
      </div>,
    );
    fireEvent.pointerDown(getByText("text"), { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    expect(ancestorDown).not.toHaveBeenCalled(); // stopPropagation ＝祖先には届かない
    expect(onInteractionStart).toHaveBeenCalledTimes(1); // 明示コールバックなら届く
  });
});

// #547 P2-12：選択要素の塗りも主操作色（青緑）と同色相のトークン。選択枠は 2px solid var(--color-primary) で、
// 塗りが別色相の青だと枠と色がちぐはぐだった。塗りは var(--color-primary-rgb) で枠と同色相にする。
describe("TemplateLayerOverlay 選択ハイライトの色（#547 P2-12）", () => {
  it("選択した要素の塗りは var(--color-primary-rgb)（旧オフパレット青を使わない）", () => {
    const { boxes } = renderOverlay({ selectedIds: ["title"] });
    const styles = boxes.map((b) => b.getAttribute("style") ?? "");
    expect(styles.some((s) => s.includes("var(--color-primary-rgb)"))).toBe(true);
    expect(styles.some((s) => s.includes("80,130,255") || s.includes("80, 130, 255"))).toBe(false);
  });
})
