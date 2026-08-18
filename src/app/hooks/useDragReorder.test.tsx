// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, renderHook } from "@testing-library/react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useDragReorder } from "./useDragReorder";
import { isPointerDragging } from "./usePointerDrag";
import { hasEscapeOwner } from "./escapeOwners";

// Pointer Events 版（#398 再対応）。button 直掛けだと HTML5 dragstart が発火しなかったため置換。
// #714-4 で**掴む作法を共通部品（`usePointerDrag`）へ移した**ので、ここで見るのは
// 「作法に乗っているか」＋「落とし先の決め方（すき間・#771(c)）」の2つ。

afterEach(cleanup);

/** 掴む（押す）。`usePointerDrag` が指を見分けるので `pointerId` と座標を必ず渡す。 */
const mkDown = (button = 0, pointerId = 1) => ({
  button,
  pointerId,
  clientX: 100,
  clientY: 100,
  preventDefault: vi.fn(),
  currentTarget: { hasPointerCapture: () => false, releasePointerCapture: () => {} },
}) as unknown as ReactPointerEvent;

/** 指を動かす（window）。しきい値（4px）を越えると「掴んだ」になる。 */
const move = (dx: number, pointerId = 1) =>
  act(() => { fireEvent.pointerMove(window, { pointerId, buttons: 1, clientX: 100 + dx, clientY: 100 }); });
const up = (pointerId = 1) =>
  act(() => { fireEvent.pointerUp(window, { pointerId, clientX: 200, clientY: 100 }); });
/** 掴んだ状態にする（押す→しきい値を越える）。 */
const grab = (r: { current: ReturnType<typeof useDragReorder> }, id = "s1", index = 0) => {
  act(() => r.current.handleProps(id, index).onPointerDown(mkDown()));
  move(20);
};

/**
 * 落下先の上での移動。**要素の半分より手前か後ろか**ですき間が決まる（#771(c)）ので、
 * 実寸（`getBoundingClientRect`）と指の位置を渡す。`after` で後ろ半分を指す。
 */
const mkMove = (after = false, axis: "x" | "y" = "y", pointerId = 1) => ({
  pointerId,
  clientX: axis === "x" ? (after ? 80 : 20) : 20,
  clientY: axis === "y" ? (after ? 80 : 20) : 20,
  currentTarget: {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }),
  },
}) as unknown as ReactPointerEvent;

describe("useDragReorder（Pointer Events 並び替え・#398）", () => {
  it("掴む→すき間→離す で onReorder(fromId, 入れる位置) を呼び解除する", () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useDragReorder(onReorder));
    grab(result, "scene_001", 0);
    expect(result.current.draggingId).toBe("scene_001");
    act(() => result.current.dropProps(2).onPointerMove(mkMove()));
    expect(result.current.overGap).toBe(2); // 2番目の手前のすき間
    up(); // 要素外で離しても window で拾う
    // すき間2 は 0番目から見て「後ろ」なので、抜いた後の位置は1つ手前＝1（`insertIndexForGap`）。
    expect(onReorder).toHaveBeenCalledWith("scene_001", 1);
    expect(result.current.draggingId).toBeNull();
    expect(result.current.overGap).toBeNull();
  });

  // ⚠️ #714-4 の本体。以前は押した瞬間に掴んだ扱いで、**元が薄くなり 1〜2px の震えで隣のすき間が確定**した。
  it("少し動かすまで掴まない（押しただけでは元が薄くならず、線も出ない）", () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useDragReorder(onReorder));
    act(() => result.current.handleProps("s1", 0).onPointerDown(mkDown()));
    expect(result.current.draggingId).toBeNull();
    move(2); // しきい値未満（震え）
    act(() => result.current.dropProps(2).onPointerMove(mkMove()));
    expect(result.current.draggingId).toBeNull();
    expect(result.current.overGap).toBeNull(); // 震えでは線を出さない
    up();
    expect(onReorder).not.toHaveBeenCalled(); // 震えただけで並べ替わらない
  });

  // ⚠️ 落とし先（要素）の pointermove は、しきい値を見る window の購読**より先**に走る。控えておかないと
  // 「掴んだと決まった当の動き」のすき間を落とし、次に動かすまで線が出ない（掴んだ瞬間だけ線が消える）。
  it("掴んだと決まった当の動きのすき間を取りこぼさない", () => {
    const { result } = renderHook(() => useDragReorder(vi.fn()));
    act(() => result.current.handleProps("s1", 0).onPointerDown(mkDown()));
    act(() => result.current.dropProps(2).onPointerMove(mkMove())); // 要素側が先に走る
    move(20); // ここで初めて「掴んだ」になる
    expect(result.current.overGap).toBe(2); // 直前に控えたすき間がそのまま出る
  });

  it("ドラッグ中でないときの pointermove はすき間を変えない（通常のマウス移動を拾わない）", () => {
    const { result } = renderHook(() => useDragReorder(vi.fn()));
    act(() => result.current.dropProps(1).onPointerMove(mkMove()));
    expect(result.current.overGap).toBeNull();
  });

  it("どの落下先にも重ならず離した（すき間 無し）ときは onReorder を呼ばない＝クリック相当", () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useDragReorder(onReorder));
    grab(result);
    up();
    expect(onReorder).not.toHaveBeenCalled();
    expect(result.current.draggingId).toBeNull();
  });

  it("主ボタン以外（右クリック等）の pointerdown は無視する", () => {
    const { result } = renderHook(() => useDragReorder(vi.fn()));
    const e = mkDown(2);
    act(() => result.current.handleProps("s1", 0).onPointerDown(e));
    move(20);
    expect(result.current.draggingId).toBeNull();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("pointercancel は中断＝すき間があっても onReorder を呼ばず状態だけ戻す", () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useDragReorder(onReorder));
    grab(result);
    act(() => result.current.dropProps(1).onPointerMove(mkMove()));
    expect(result.current.overGap).toBe(1); // すき間はあった
    act(() => { fireEvent.pointerCancel(window, { pointerId: 1 }); });
    expect(onReorder).not.toHaveBeenCalled(); // 中断なので並べ替えない
    expect(result.current.draggingId).toBeNull();
    expect(result.current.overGap).toBeNull();
  });

  // ⚠️ #714-4：以前は中止できず、**同じアプリで `Escape` の意味が2つ**あった（列・欄・帯・色の面はやめられる）。
  it("Escape でやめられる（元へ戻す＝並べ替えない）", () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useDragReorder(onReorder));
    grab(result);
    act(() => result.current.dropProps(1).onPointerMove(mkMove()));
    act(() => { fireEvent.keyDown(window, { key: "Escape" }); });
    expect(onReorder).not.toHaveBeenCalled();
    expect(result.current.draggingId).toBeNull();
    expect(result.current.overGap).toBeNull();
    up(); // やめた後に離しても確定しない
    expect(onReorder).not.toHaveBeenCalled();
  });

  // ⚠️ #714-4：以前は `pointerId` を見ておらず、**取り逃がした後の無関係な離しでそこへ落ちた**。
  it("掴んだ指だけ見る（別の指で離してもそこへ落ちない）", () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useDragReorder(onReorder));
    grab(result);
    act(() => result.current.dropProps(1).onPointerMove(mkMove()));
    up(2); // 別の指で離した
    expect(onReorder).not.toHaveBeenCalled();
    expect(result.current.draggingId).toBe("s1"); // まだ掴んだまま
    up(1);
    expect(onReorder).toHaveBeenCalledTimes(1);
  });

  // 掴んでいる間は取り消しを止める（結果が変わるため）＝帯・キャンバスと同じ合図に乗る。
  it("掴んでいる間だけ「いま掴んでいる」に数えられ、Escape も受け持つ", () => {
    const { result } = renderHook(() => useDragReorder(vi.fn()));
    expect(isPointerDragging()).toBe(false);
    grab(result);
    expect(isPointerDragging()).toBe(true);
    expect(hasEscapeOwner()).toBe(true);
    up();
    expect(isPointerDragging()).toBe(false);
    expect(hasEscapeOwner()).toBe(false); // 外し忘れると以後ずっと Escape が効かない
  });

  it("画面を離れたら後始末する（購読も名乗りも残らない）", () => {
    const onReorder = vi.fn();
    const { result, unmount } = renderHook(() => useDragReorder(onReorder));
    grab(result);
    act(() => result.current.dropProps(1).onPointerMove(mkMove()));
    unmount();
    expect(hasEscapeOwner()).toBe(false);
    up();
    expect(onReorder).not.toHaveBeenCalled();
  });

  // #771(c)：**半分より後ろを指したら「その後ろのすき間」**＝同じ手つきが向きで別の意味にならない。
  it("要素の後ろ半分を指すと、後ろのすき間になる", () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useDragReorder(onReorder));
    grab(result);
    act(() => result.current.dropProps(2).onPointerMove(mkMove(true)));
    expect(result.current.overGap).toBe(3); // 2番目の**後ろ**
    up();
    expect(onReorder).toHaveBeenCalledWith("s1", 2); // 抜いた後の位置
  });

  // ⚠️ 掴んだ指だけ見るのは**確定だけでなくすき間の追随も**（レビュー指摘）。
  // 別の指が並びの上を通っただけで落とし先が変わると、指したのと違う所へ入る。
  it("別の指が並びの上を通ってもすき間は動かない", () => {
    const { result } = renderHook(() => useDragReorder(vi.fn()));
    grab(result);
    act(() => result.current.dropProps(1).onPointerMove(mkMove()));
    expect(result.current.overGap).toBe(1);
    act(() => result.current.dropProps(3).onPointerMove(mkMove(false, "y", 2))); // 別の指
    expect(result.current.overGap).toBe(1); // 変わらない
  });

  // ⚠️ 前のドラッグが生きているうちに掴み直す経路（レビュー指摘・2名が独立に検出）。
  // 控えを `beginDrag` の**前**に立てると、`begin` が前のドラッグをやめる拍子に消え、
  // **元は薄くなるのにどこにも入らない**（#398「掴めるのに並ばない」の再来）になる。
  it("離したのを取り逃がしたまま掴み直しても、ちゃんと並べ替えられる", () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useDragReorder(onReorder));
    grab(result, "s1", 0);            // 1回目＝掴んだまま
    act(() => { /* `pointerup` が来ない（画面の外で離した） */ });
    // 動かさずにもう一度押す＝`usePointerDrag` が前のドラッグを同期でやめる。
    act(() => result.current.handleProps("s2", 1).onPointerDown(mkDown()));
    move(20);
    act(() => result.current.dropProps(3).onPointerMove(mkMove()));
    expect(result.current.overGap).toBe(3);
    up();
    expect(onReorder).toHaveBeenCalledWith("s2", 2);
  });

  // ⚠️ 利用者レビュー（PR #786）で確認を求められた2点。どちらも `usePointerDrag` に載せたことで
  // 自動的に満たされるはずのものだが、**満たされていることをここで固定する**（載せ替えを戻したら赤くなる）。

  // ① 掴んでいる間の `Ctrl+Z` 遮断。旧実装は素通しで、**取り消しで並びが変わった後に古い位置で確定**
  // ＝線と違う所へ落ちる筋があった。共通の合図（`isPointerDragging`）に数えられていれば止まる。
  it("掴んでいる間は取り消しの合図が立つ（並びが動いた後に古い位置で確定しない）", () => {
    const { result } = renderHook(() => useDragReorder(vi.fn()));
    act(() => result.current.handleProps("s1", 0).onPointerDown(mkDown()));
    expect(isPointerDragging()).toBe(false); // 押しただけでは止めない
    move(20);
    expect(isPointerDragging()).toBe(true);  // 掴んでいる間だけ止める
    up();
    expect(isPointerDragging()).toBe(false);
  });

  // ② 画面の外で離して `pointerup` を取り逃がしたとき＝押していないのに動きだけが届く（`buttons: 0`）。
  // 救済が無いと影が指に付いたままになり、**次に無関係な所で離した瞬間**にそこへ並べ替わる。
  it("画面の外で離したのを取り逃がしたら、次の離しで並べ替えない", () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useDragReorder(onReorder));
    grab(result);
    act(() => result.current.dropProps(2).onPointerMove(mkMove()));
    expect(result.current.overGap).toBe(2);
    // 押していない状態で動きだけが届く＝どこかで離していた。
    act(() => { fireEvent.pointerMove(window, { pointerId: 1, buttons: 0, clientX: 300, clientY: 100 }); });
    expect(result.current.draggingId).toBeNull(); // その場でやめる
    expect(result.current.overGap).toBeNull();
    up();
    expect(onReorder).not.toHaveBeenCalled(); // 次の離しでそこへ落ちない
    expect(isPointerDragging()).toBe(false);  // 取り消しも塞ぎっぱなしにしない
  });

  it("横並びのときは左右で決める（縦の位置では変わらない）", () => {
    const { result } = renderHook(() => useDragReorder(vi.fn(), { axis: "x" }));
    grab(result);
    // 右半分＝後ろのすき間（縦は手前を指していても左右で決まる）。
    act(() => result.current.dropProps(1).onPointerMove(mkMove(true, "x")));
    expect(result.current.overGap).toBe(2);
  });
});
