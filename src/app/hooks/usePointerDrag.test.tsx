// @vitest-environment jsdom
// ドラッグの作法（ADR-0034 決定9・監査「ドラッグ規則の統一」）。掴む場所が3つ（欄・帯・キャンバス）
// あるので、規則をここで固定する＝場所ごとに書き分けて片方だけ直す、を防ぐ。
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { usePointerDrag } from "./usePointerDrag";
import { hasEscapeOwner } from "./escapeOwners";
import type { DragHandlers } from "./usePointerDrag";

afterEach(cleanup);

/** 掴む対象を1つだけ持つ試験用の画面。 */
function Grabbable({ handlers, startPx }: { handlers: Partial<DragHandlers>; startPx?: number }) {
  const begin = usePointerDrag();
  return (
    <button
      onPointerDown={(e) => begin(e, { startPx, onMove: () => {}, ...handlers } as DragHandlers)}
    >
      つかむ
    </button>
  );
}

const down = (el: HTMLElement, x: number, y: number, button = 0) =>
  fireEvent.pointerDown(el, { pointerId: 1, button, clientX: x, clientY: y });
// `buttons: 1`＝押したまま動かしている（実際のイベントと同じ）。0 は「もう離している」の意味を持つ。
const move = (x: number, y: number, pointerId = 1) =>
  fireEvent.pointerMove(window, { pointerId, buttons: 1, clientX: x, clientY: y });
const up = (x: number, y: number, pointerId = 1) =>
  fireEvent.pointerUp(window, { pointerId, clientX: x, clientY: y });

describe("usePointerDrag（ドラッグの作法）", () => {
  it("少し動かすまで掴まない（押しただけで動かさない）", () => {
    const onStart = vi.fn(); const onMove = vi.fn();
    render(<Grabbable handlers={{ onStart, onMove }} />);
    down(screen.getByRole("button"), 100, 100);
    move(102, 100); // 2px＝しきい値未満
    expect(onStart).not.toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();
    move(110, 100);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it("しきい値ちょうどでは掴む（境目の扱いを決めておく）", () => {
    const onStart = vi.fn();
    render(<Grabbable handlers={{ onStart }} />);
    down(screen.getByRole("button"), 100, 100);
    move(104, 100); // ちょうど 4px
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("遊びを0にできる（境界を掴んで広げるもの）", () => {
    const onMove = vi.fn();
    render(<Grabbable handlers={{ onMove }} startPx={0} />);
    down(screen.getByRole("button"), 100, 100);
    move(101, 100);
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  // ⚠️ **既定の動き（文字の選択）を止める**（レビュー指摘＝どこも検査していなかった）。止めないと運んでいる
  // 途中で選択が走ってドラッグが切れる。右ボタンでは止めない＝メニューを妨げない。
  it("掴む合図で文字の選択を止める（右ボタンでは止めない）", () => {
    render(<Grabbable handlers={{}} />);
    const btn = screen.getByRole("button");
    expect(down(btn, 100, 100)).toBe(false); // `false`＝既定の動きを止めた
    up(100, 100);
    expect(down(btn, 100, 100, 2)).toBe(true);
  });

  it("左ボタン以外では掴まない（右クリックで中身が書き換わらない）", () => {
    const onMove = vi.fn();
    render(<Grabbable handlers={{ onMove }} />);
    down(screen.getByRole("button"), 100, 100, 2);
    move(200, 200);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("掴んだ指だけ見る（別の指で離してもそこへ落ちない）", () => {
    const onMove = vi.fn(); const onEnd = vi.fn();
    render(<Grabbable handlers={{ onMove, onEnd }} />);
    down(screen.getByRole("button"), 100, 100);
    move(200, 100, 2); // 別の指
    expect(onMove).not.toHaveBeenCalled();
    up(500, 500, 2);
    expect(onEnd).not.toHaveBeenCalled();
    move(200, 100);
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it("動かさずに離したときは「掴んでいない」と伝える（ただのクリック）", () => {
    const onEnd = vi.fn();
    render(<Grabbable handlers={{ onEnd }} />);
    down(screen.getByRole("button"), 100, 100);
    up(100, 100);
    expect(onEnd).toHaveBeenCalledWith(expect.anything(), false);
  });

  it("Escape でやめられる（掴んだまま戻れない、を作らない）", () => {
    const onCancel = vi.fn(); const onEnd = vi.fn();
    render(<Grabbable handlers={{ onCancel, onEnd }} />);
    down(screen.getByRole("button"), 100, 100);
    move(200, 100);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    // やめた後は購読が外れている＝離しても確定しない。
    up(300, 100);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("離したのを取り逃がしたらやめる（影が指に付いたまま、を作らない）", () => {
    const onCancel = vi.fn(); const onEnd = vi.fn();
    render(<Grabbable handlers={{ onCancel, onEnd }} />);
    down(screen.getByRole("button"), 100, 100);
    move(200, 100);
    // 画面の外で離した＝`pointerup` が来ないまま、押していない状態で動きだけが届く。
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 0, clientX: 300, clientY: 100 });
    expect(onCancel).toHaveBeenCalledTimes(1);
    up(400, 100);
    expect(onEnd).not.toHaveBeenCalled(); // 次に離した所へ置かれない
  });

  it("中止したときも「掴んだ後か」を伝える（中止の直後の click を捨てられる）", () => {
    const onCancel = vi.fn();
    render(<Grabbable handlers={{ onCancel }} />);
    const btn = screen.getByRole("button");
    down(btn, 100, 100);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledWith(false); // まだ掴んでいない
    down(btn, 100, 100);
    move(200, 100);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenLastCalledWith(true); // 掴んだ後にやめた
  });

  it("pointercancel でもやめる（指が外れた・別の操作に取られた）", () => {
    const onCancel = vi.fn();
    render(<Grabbable handlers={{ onCancel }} />);
    down(screen.getByRole("button"), 100, 100);
    fireEvent.pointerCancel(window, { pointerId: 1 });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("掴んでいる間だけ Escape を受け持つ（外側の Escape まで走らせない・外し忘れない）", () => {
    render(<Grabbable handlers={{}} />);
    expect(hasEscapeOwner()).toBe(false);
    down(screen.getByRole("button"), 100, 100);
    expect(hasEscapeOwner()).toBe(true);
    up(100, 100);
    expect(hasEscapeOwner()).toBe(false);
  });

  it("画面を離れたら後始末する（購読と名乗りが残らない）", () => {
    const onMove = vi.fn();
    const { unmount } = render(<Grabbable handlers={{ onMove }} />);
    down(screen.getByRole("button"), 100, 100);
    unmount();
    expect(hasEscapeOwner()).toBe(false);
    move(200, 100);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("同時に2つは走らない（新しく掴んだら前のはやめる）", () => {
    const onCancel = vi.fn(); const onMove = vi.fn();
    render(<Grabbable handlers={{ onCancel, onMove }} />);
    const btn = screen.getByRole("button");
    down(btn, 100, 100);
    down(btn, 200, 200);
    expect(onCancel).toHaveBeenCalledTimes(1); // 前のはやめている
    expect(hasEscapeOwner()).toBe(true);       // 名乗りは1つぶんだけ残る
    up(200, 200);
    expect(hasEscapeOwner()).toBe(false);
  });
});
