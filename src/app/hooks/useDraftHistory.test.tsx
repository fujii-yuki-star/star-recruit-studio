// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { HISTORY_LIMIT } from "../../domain/project/history";
import { useDraftHistory } from "./useDraftHistory";

// #547 P2-3：画面ローカル下書きの取り消し/やり直し。意味論は store（ADR-0020）と同じものを共有するため、
// ここでは「フックとしての繋ぎ」＝記録タイミング・グループ合成・上限・future 破棄 を固定する。
describe("useDraftHistory（画面ローカル下書きの取り消し/やり直し・#547 P2-3）", () => {
  it("編集で履歴が積まれ、取り消しで直前に戻り、やり直しで再適用される", () => {
    const { result } = renderHook(() => useDraftHistory({ n: 0 }));
    expect(result.current.canUndo).toBe(false); // 初期は戻せない
    expect(result.current.canRedo).toBe(false);

    act(() => result.current.set({ n: 1 }));
    act(() => result.current.set({ n: 2 }));
    expect(result.current.value).toEqual({ n: 2 });
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.undo());
    expect(result.current.value).toEqual({ n: 1 }); // 直前へ
    act(() => result.current.undo());
    expect(result.current.value).toEqual({ n: 0 }); // さらに前へ
    expect(result.current.canUndo).toBe(false);

    act(() => result.current.redo());
    expect(result.current.value).toEqual({ n: 1 }); // やり直し
    expect(result.current.canRedo).toBe(true);
  });

  it("更新関数でも積める（現在値を受け取る）", () => {
    const { result } = renderHook(() => useDraftHistory({ n: 0 }));
    act(() => result.current.set((cur) => ({ n: cur.n + 5 })));
    expect(result.current.value).toEqual({ n: 5 });
    act(() => result.current.undo());
    expect(result.current.value).toEqual({ n: 0 });
  });

  it("取り消した後に新しい編集をすると、やり直し分は捨てられる（分岐を残さない）", () => {
    const { result } = renderHook(() => useDraftHistory({ n: 0 }));
    act(() => result.current.set({ n: 1 }));
    act(() => result.current.undo());
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.set({ n: 9 })); // 別方向へ編集
    expect(result.current.canRedo).toBe(false); // future は破棄
    act(() => result.current.undo());
    expect(result.current.value).toEqual({ n: 0 });
  });

  it("変化のない set は履歴を積まない（空の取り消しを作らない）", () => {
    const same = { n: 0 };
    const { result } = renderHook(() => useDraftHistory(same));
    act(() => result.current.set(same)); // 同一参照＝変化なし
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.set((cur) => cur)); // 更新関数が現在値をそのまま返す
    expect(result.current.canUndo).toBe(false);
  });

  it("グループ中の連続編集は1履歴に合成される（1ドラッグ＝1取り消し）", () => {
    const { result } = renderHook(() => useDraftHistory({ n: 0 }));
    act(() => result.current.beginGroup());
    act(() => result.current.set({ n: 1 })); // ドラッグ中の連続更新…
    act(() => result.current.set({ n: 2 }));
    act(() => result.current.set({ n: 3 }));
    act(() => result.current.endGroup());
    expect(result.current.value).toEqual({ n: 3 });
    act(() => result.current.undo());
    expect(result.current.value).toEqual({ n: 0 }); // 1回の取り消しでドラッグ前へ（途中値に戻らない）
  });

  it("グループを開いても変更しなければ積まない（遅延記録＝未変更フォーカスで履歴を汚さない）", () => {
    const { result } = renderHook(() => useDraftHistory({ n: 0 }));
    act(() => result.current.beginGroup());
    act(() => result.current.endGroup());
    expect(result.current.canUndo).toBe(false);
  });

  it("グループを閉じた後の編集は別の履歴になる（境界が釣り合う）", () => {
    const { result } = renderHook(() => useDraftHistory({ n: 0 }));
    act(() => result.current.beginGroup());
    act(() => result.current.set({ n: 1 }));
    act(() => result.current.set({ n: 2 }));
    act(() => result.current.endGroup());
    act(() => result.current.set({ n: 3 })); // 閉じた後の単独編集
    act(() => result.current.undo());
    expect(result.current.value).toEqual({ n: 2 }); // 単独編集だけ戻る
    act(() => result.current.undo());
    expect(result.current.value).toEqual({ n: 0 }); // グループ分がまとめて戻る
  });

  it("上限を超えたら古い方から捨てる（store と同じ HISTORY_LIMIT）", () => {
    const { result } = renderHook(() => useDraftHistory({ n: 0 }));
    for (let i = 1; i <= HISTORY_LIMIT + 5; i++) act(() => result.current.set({ n: i }));
    for (let i = 0; i < HISTORY_LIMIT; i++) act(() => result.current.undo());
    expect(result.current.canUndo).toBe(false); // 上限ぶんまでしか戻れない
    expect(result.current.value).toEqual({ n: 5 }); // 最初の5件は捨てられている（0 までは戻れない）
  });
});
