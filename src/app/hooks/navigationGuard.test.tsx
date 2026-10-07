// @vitest-environment jsdom
// 画面を離れる前の関門（#719）。**遷移の入口はひとつ**なので、そこで一度だけ聞く。
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { canNavigate, useNavigationGuard } from "./navigationGuard";
import type { NavigationGuard } from "./navigationGuard";
import type { ScreenId } from "../data/mockData";

afterEach(cleanup);

function Screen({ guard }: { guard: NavigationGuard | null }) {
  useNavigationGuard(guard);
  return <div />;
}

const to = "home" as ScreenId;

describe("useNavigationGuard（離れる前の関門）", () => {
  it("名乗り手がいなければいつでも通す", () => {
    expect(canNavigate(to)).toBe(true);
  });

  it("名乗った関門が断ったら通さない・許したら通す", () => {
    const guard = vi.fn(() => false);
    render(<Screen guard={guard} />);
    expect(canNavigate(to)).toBe(false);
    expect(guard).toHaveBeenCalledWith(to);
    cleanup();
    render(<Screen guard={() => true} />);
    expect(canNavigate(to)).toBe(true);
  });

  it("画面を離れたら名乗りを外す（関係ない画面から出られなくなる、を作らない）", () => {
    const { unmount } = render(<Screen guard={() => false} />);
    expect(canNavigate(to)).toBe(false);
    unmount();
    expect(canNavigate(to)).toBe(true);
  });

  it("聞く必要が無くなったら素通しになる（名乗ったまま固まらない）", () => {
    const { rerender } = render(<Screen guard={() => false} />);
    expect(canNavigate(to)).toBe(false);
    rerender(<Screen guard={null} />);
    expect(canNavigate(to)).toBe(true);
  });

  it("描き直しても、いちばん新しい関門が効く（古い判断で止めない）", () => {
    const { rerender } = render(<Screen guard={() => false} />);
    expect(canNavigate(to)).toBe(false);
    rerender(<Screen guard={() => true} />);
    expect(canNavigate(to)).toBe(true);
  });

  it("行き先を関門へ渡す（どこへ行こうとしたかを見て決められる）", () => {
    const seen: ScreenId[] = [];
    render(<Screen guard={(t) => { seen.push(t); return false; }} />);
    canNavigate("materials" as ScreenId);
    canNavigate("settings" as ScreenId);
    expect(seen).toEqual(["materials", "settings"]);
  });
});

describe("名乗りは数える（内側が外れても外側が残る）", () => {
  it("2つ名乗って片方が外れても、もう片方は効き続ける", () => {
    const outer = render(<Screen guard={() => false} />);
    const inner = render(<Screen guard={() => true} />);
    expect(canNavigate(to)).toBe(false); // 1つでも断れば止まる
    inner.unmount();
    expect(canNavigate(to)).toBe(false); // 外側はまだ生きている
    outer.unmount();
    expect(canNavigate(to)).toBe(true);
  });

  it("断る側にも必ず聞く（確認を出す側が飛ばされない）", () => {
    const asked: string[] = [];
    render(<Screen guard={() => { asked.push("a"); return false; }} />);
    render(<Screen guard={() => { asked.push("b"); return false; }} />);
    canNavigate(to);
    expect(asked).toEqual(["a", "b"]); // 途中で打ち切らない
  });
});
