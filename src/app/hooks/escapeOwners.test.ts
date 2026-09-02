// `Escape` を受け持っているものの名簿（#701 レビュー）。**受け手が自分で名乗る**ことで、
// いちばん外側の後始末（選択を解く）が同時に走るのを防ぐ。
import { describe, expect, it, vi } from "vitest";
import { claimEscape, claimEscapeReceiver, handleEscapeKey, hasEscapeOwner } from "./escapeOwners";

describe("escapeOwners（#701）", () => {
  it("名乗っている間だけ「受け手がいる」になる", () => {
    expect(hasEscapeOwner()).toBe(false);
    const release = claimEscape();
    expect(hasEscapeOwner()).toBe(true);
    release();
    expect(hasEscapeOwner()).toBe(false);
  });

  it("重なっても数が合う（内側が外れても外側は残る）", () => {
    const outer = claimEscape();
    const inner = claimEscape();
    inner();
    expect(hasEscapeOwner()).toBe(true); // 外側はまだ受け持っている
    outer();
    expect(hasEscapeOwner()).toBe(false);
  });

  it("二重に外しても数がずれない（外し忘れの逆＝効かなくならない）", () => {
    const release = claimEscape();
    release();
    release();
    expect(hasEscapeOwner()).toBe(false);
    const other = claimEscape();
    expect(hasEscapeOwner()).toBe(true);
    other();
  });
});

// ⚠️ **前に出ているものどうしを調停する**（#965）＝名簿は当初「数を数える」だけで、
// 2つ同時に開いていると1回の `Escape` で**両方いっぺんに閉じた**（「手前から1段ずつはがす」から外れる）。
describe("名簿が配る（#965）", () => {
  const esc = (): KeyboardEvent => ({ key: "Escape" }) as KeyboardEvent;

  it("手前から順に渡し、受け取ったところで止める", () => {
    const first = vi.fn(() => true);
    const second = vi.fn(() => true);
    const a = claimEscapeReceiver(first);
    const b = claimEscapeReceiver(second);
    expect(handleEscapeKey(esc())).toBe(true);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled(); // 1回の Escape で2つ閉じない
    b();
    expect(handleEscapeKey(esc())).toBe(true);
    expect(first).toHaveBeenCalledTimes(1); // 次の Escape で手前が1段はがれる
    a();
  });

  it("見送った受け手は次へ渡す（黙って死なせない）", () => {
    // ⚠️ **これが「順番だけ」では直せない**＝下の受け手はもう走った後で、
    // 手前が見送ったことを知りようがない。だから名簿が配る。
    const under = vi.fn(() => true);
    const over = vi.fn(() => false); // 入力中などで受け取らない
    const a = claimEscapeReceiver(under);
    const b = claimEscapeReceiver(over);
    expect(handleEscapeKey(esc())).toBe(true);
    expect(over).toHaveBeenCalledTimes(1);
    expect(under).toHaveBeenCalledTimes(1);
    b();
    a();
  });

  it("誰も受け取らなければ false（外側が動いてよい合図）", () => {
    const a = claimEscapeReceiver(() => false);
    expect(handleEscapeKey(esc())).toBe(false);
    a();
  });

  it("塞ぐだけには配らない（親が塞いでも子の番を奪わない）", () => {
    // React の効果は**子が先・親が後**なので、画面（親）が「確認が出ている間」を名乗ると
    // 親のほうが後に積まれる。配る相手にすると、確認自身の番が消えて `Escape` が死ぬ。
    const confirm = vi.fn(() => true);
    const child = claimEscapeReceiver(confirm); // 子（確認）
    const parent = claimEscape(); // 親（塞ぐだけ）
    expect(handleEscapeKey(esc())).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(hasEscapeOwner()).toBe(true); // 塞ぐ側も「誰か名乗っている」には数える
    parent();
    child();
    expect(hasEscapeOwner()).toBe(false);
  });

  it("内側が先に降りても、手前の順が狂わない", () => {
    const calls: string[] = [];
    const a = claimEscapeReceiver(() => { calls.push("a"); return true; });
    const b = claimEscapeReceiver(() => { calls.push("b"); return true; });
    const c = claimEscapeReceiver(() => { calls.push("c"); return true; });
    b(); // 真ん中が先に降りる
    handleEscapeKey(esc());
    c();
    handleEscapeKey(esc());
    a();
    expect(calls).toEqual(["c", "a"]);
  });

  it("処理の中で降りた受け手へは渡さない", () => {
    // 手前の受け手が「奥のものも閉じる」処理をしたとき、閉じたものへ渡すと二重に走る。
    let releaseUnder: (() => void) | null = null;
    const under = vi.fn(() => true);
    releaseUnder = claimEscapeReceiver(under);
    const over = claimEscapeReceiver(() => {
      releaseUnder?.(); // 一緒に片づける
      return false; // 自分は受け取らない
    });
    expect(handleEscapeKey(esc())).toBe(false);
    expect(under).not.toHaveBeenCalled();
    over();
  });

  it("降ろした後は配られない（二重に外しても同じ）", () => {
    const only = vi.fn(() => true);
    const release = claimEscapeReceiver(only);
    release();
    release();
    expect(handleEscapeKey(esc())).toBe(false);
    expect(only).not.toHaveBeenCalled();
    expect(hasEscapeOwner()).toBe(false);
  });
});
