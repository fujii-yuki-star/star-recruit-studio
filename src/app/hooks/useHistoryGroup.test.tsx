// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useHistoryGroup } from "./useHistoryGroup";
import { useUndoRedoShortcuts } from "./useUndoRedoShortcuts";
import { isPointerDragging } from "./usePointerDrag";
import { useProjectStore } from "../store/projectStore";

/** 左ボタンの pointerdown（掴んだ指の番号つき）。 */
const down = (button = 0, pointerId = 1): ReactPointerEvent =>
  ({ button, pointerId }) as unknown as ReactPointerEvent;
/** その指を離した合図（window へ流す）。 */
const up = (pointerId = 1, type = "pointerup"): Event =>
  Object.assign(new Event(type), { pointerId });

describe("useHistoryGroup（連続編集を1履歴に・#389）", () => {
  const realBegin = useProjectStore.getState().beginHistoryGroup;
  const realEnd = useProjectStore.getState().endHistoryGroup;
  afterEach(() => useProjectStore.setState({ beginHistoryGroup: realBegin, endHistoryGroup: realEnd }));
  // 掴んだ数（`usePointerDrag` のモジュール変数）を残さない＝途中のアサーションで落ちた回に、
  // 後続のテストが「掴みっぱなし」を引き継がないようにする。指の番号を持たない合図は素通しで
  // 全部閉じる（本文の `pid == null` の道をそのまま使う）。
  afterEach(() => { window.dispatchEvent(new Event("pointercancel")); });

  it("dragGroup: pointerdown で begin、window の pointerup で end（要素外で離しても閉じる・one-shot）", () => {
    const begin = vi.fn();
    const end = vi.fn();
    useProjectStore.setState({ beginHistoryGroup: begin, endHistoryGroup: end });
    const { result } = renderHook(() => useHistoryGroup());
    result.current.dragGroup.onPointerDown(down());
    expect(begin).toHaveBeenCalledTimes(1);
    expect(end).not.toHaveBeenCalled();
    // 要素外で指を離しても window で拾って閉じる（取りこぼしで開きっぱなしにならない）。
    window.dispatchEvent(up());
    expect(end).toHaveBeenCalledTimes(1);
    // 自己解除＝もう一度 pointerup が来ても end は増えない。
    window.dispatchEvent(up());
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("スライダーを掴んだまま Ctrl+Z しても、そのドラッグは1つの取り消しに収まる（#830）", () => {
    // 実物の履歴で見る（begin/end を差し替えない）＝**押し出される件数**という実害を直接固定する。
    const { pushHistory } = useProjectStore.getState();
    useProjectStore.setState({ past: [], future: [], _historyGroupDepth: 0, _historyGroupPending: false });
    // 取り消しのキー入口も一緒に載せる（掴んだまま押せてしまう経路そのもの）。
    const { result } = renderHook(() => {
      useUndoRedoShortcuts(true);
      return useHistoryGroup();
    });

    act(() => result.current.dragGroup.onPointerDown(down()));
    act(() => pushHistory()); // ドラッグの最初のtick＝ここで1件だけ記録される
    expect(useProjectStore.getState().past).toHaveLength(1);

    // 掴んだまま Ctrl+Z（`range` は入力欄扱いではないのでキー自体は届く）。
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true })); });
    // 残りのtick。まとめが畳まれていれば**1tickごとに1件**積まれる（＝上限を流し切る）。
    act(() => { for (let i = 0; i < 5; i += 1) pushHistory(); });

    // まとめは開いたまま＝このドラッグは1件のまま。
    expect(useProjectStore.getState().past).toHaveLength(1);

    act(() => { window.dispatchEvent(up()); });
    expect(isPointerDragging()).toBe(false); // 掴んだぶんを返している（返さないと以後の取り消しが効かない）
  });

  it("右クリックでは掴んだことにしない（既定メニューで離しが届かず数が戻らなくなる・#830）", () => {
    const begin = vi.fn();
    const end = vi.fn();
    useProjectStore.setState({ beginHistoryGroup: begin, endHistoryGroup: end });
    const { result } = renderHook(() => useHistoryGroup());
    result.current.dragGroup.onPointerDown(down(2)); // 右ボタン
    expect(begin).not.toHaveBeenCalled();
    expect(isPointerDragging()).toBe(false);
  });

  it("2本目の指で掴んでいる間は、1本目の離しで数を返さない（掴んだ指だけ見る・#830）", () => {
    const { result } = renderHook(() => useHistoryGroup());
    act(() => result.current.dragGroup.onPointerDown(down(0, 7)));
    act(() => { window.dispatchEvent(up(9)); }); // 別の指の離し＝素通し
    expect(isPointerDragging()).toBe(true); // まだ握っている
    act(() => { window.dispatchEvent(up(7)); }); // 掴んだ指の離し
    expect(isPointerDragging()).toBe(false);
  });

  it("textGroup: focus で begin・blur で end", () => {
    const begin = vi.fn();
    const end = vi.fn();
    useProjectStore.setState({ beginHistoryGroup: begin, endHistoryGroup: end });
    const { result } = renderHook(() => useHistoryGroup());
    result.current.textGroup.onFocus({ currentTarget: document.createElement("input") });
    result.current.textGroup.onBlur();
    expect(begin).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
  });

  // ⚠️ **`blur` が来ない道**（#847）＝フォーカス中に欄が消えると `blur` は来ない（React の仕様）。
  // 閉じ損ねると **自動保存が止まり、以後の編集が履歴に1件も積まれない**（`Ctrl+Z` がまとめの前まで飛ぶ）。
  // 実機で踏む道は**欄の配置の組み替え**（ADR-0033＝掴む処理が `pointerdown` を `preventDefault` するので
  // フォーカスは欄に残ったまま、欄が別の親の下へ移る＝unmount）。降ろす合図を**欄の寿命に縛って**閉じる。
  it("textGroup: 欄がフォーカス中に消えても閉じる（blur が来ない道）", () => {
    const begin = vi.fn();
    const end = vi.fn();
    useProjectStore.setState({ beginHistoryGroup: begin, endHistoryGroup: end });
    const { result } = renderHook(() => useHistoryGroup());
    const el = document.createElement("input");
    const cleanup = result.current.textGroup.ref(el);   // 欄がマウントされた
    result.current.textGroup.onFocus({ currentTarget: el }); // その欄に手が入る＝まとめが開く
    expect(begin).toHaveBeenCalledTimes(1);
    cleanup();                                          // `blur` を通さずに欄が消える
    expect(end).toHaveBeenCalledTimes(1);               // それでも閉じる
  });

  // ⚠️ **他人のまとめを閉じない**（#847）＝`end()` は数を1つ減らすだけなので、開けていない欄が消えた
  // ときに閉じると**別の欄のまとめ**を早く畳んでしまう（そちらの編集が1操作ずつ積まれ始める）。
  it("textGroup: 開けていない欄が消えても、他人のまとめは閉じない", () => {
    const begin = vi.fn();
    const end = vi.fn();
    useProjectStore.setState({ beginHistoryGroup: begin, endHistoryGroup: end });
    const { result } = renderHook(() => useHistoryGroup());
    const focused = document.createElement("input");
    const other = document.createElement("input");
    const cleanupOther = result.current.textGroup.ref(other);
    result.current.textGroup.ref(focused);
    result.current.textGroup.onFocus({ currentTarget: focused }); // 開けたのは focused
    cleanupOther();                                               // 手の乗っていない欄だけが消えた
    expect(end).not.toHaveBeenCalled();                           // まだ開いたまま
    result.current.textGroup.onBlur();
    expect(end).toHaveBeenCalledTimes(1);                         // 本人の blur で1回だけ閉じる
  });

  // ⚠️ **二重に閉じない**＝寿命で閉じた後に（順序しだいで）`blur` が来ても、数を2回返さない
  //（返しすぎると**他人のまとめ**まで畳む）。
  it("textGroup: 寿命で閉じた後に blur が来ても、二度は閉じない", () => {
    const begin = vi.fn();
    const end = vi.fn();
    useProjectStore.setState({ beginHistoryGroup: begin, endHistoryGroup: end });
    const { result } = renderHook(() => useHistoryGroup());
    const el = document.createElement("input");
    const cleanup = result.current.textGroup.ref(el);
    result.current.textGroup.onFocus({ currentTarget: el });
    cleanup();
    result.current.textGroup.onBlur();
    expect(end).toHaveBeenCalledTimes(1);
  });
});
