// @vitest-environment jsdom
/* global Element, document, window */ // jsdom の画面（scripts の lint は node の名前しか知らない）
// 撮影のときのスクロールを「ゆっくり滑らせる」差し替えを、実際の部品に当てて確かめる（2026-10-16 利用者の指摘）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GLIDE_REMAINING_MS, GLIDE_SCROLL_INSTALL, easeInOut, glideDurationMs } from "./glideScroll.mjs";

describe("glideDurationMs / easeInOut", () => {
  it("短い距離でも 0.6 秒は掛け、長くても 1.4 秒で止める", () => {
    expect(glideDurationMs(0)).toBe(600);
    expect(glideDurationMs(500)).toBe(750);
    expect(glideDurationMs(-500)).toBe(750);
    expect(glideDurationMs(10_000)).toBe(1400);
  });
  it("始めと終わりはゆっくり・端はちょうど 0 と 1", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBe(0.5);
    expect(easeInOut(0.1)).toBeLessThan(0.1);
    expect(easeInOut(0.9)).toBeGreaterThan(0.9);
    expect(easeInOut(2)).toBe(1);
  });
});

/** 縦にスクロールする欄（高さ 200・中身 1000）と、その中の押す相手（欄の上端から `top` の位置）。 */
function setup(top) {
  document.body.innerHTML = `<div id="box" style="overflow-y:auto"><button id="hit">この動画で使う</button></div>`;
  const box = document.getElementById("box");
  const hit = document.getElementById("hit");
  Object.defineProperty(box, "scrollHeight", { value: 1000, configurable: true });
  Object.defineProperty(box, "clientHeight", { value: 200, configurable: true });
  box.scrollTop = 0;
  Object.defineProperty(box, "scrollTo", { value: (/** @type {ScrollToOptions} */ o) => { box.scrollTop = o.top ?? 0; } });
  Object.defineProperty(box, "getBoundingClientRect", { value: () => ({ top: 0, bottom: 200, left: 0, right: 300 }) });
  Object.defineProperty(hit, "getBoundingClientRect", {
    value: () => ({ top: top - box.scrollTop, bottom: top - box.scrollTop + 20, left: 10, right: 110 }),
  });
  return { box, hit };
}

describe("GLIDE_SCROLL_INSTALL（実際の部品で）", () => {
  const original = Element.prototype.scrollIntoView;
  beforeEach(() => {
    vi.useFakeTimers();
    Reflect.deleteProperty(window, "__tutGlideInstalled");
    Element.prototype.scrollIntoView = () => {};
    (0, eval)(GLIDE_SCROLL_INSTALL);
  });
  afterEach(() => {
    vi.useRealTimers();
    Element.prototype.scrollIntoView = original;
  });

  it("一瞬で飛ばず、途中を通ってから相手を欄の中央へ入れる", () => {
    const { box, hit } = setup(600);
    hit.scrollIntoView({ block: "center" });
    // 中央へ来るには 600+10-100=510 動く。最初の一コマではまだほとんど動いていない。
    expect(box.scrollTop).toBeLessThan(10);
    const dur = glideDurationMs(510);
    vi.advanceTimersByTime(dur / 2);
    expect(box.scrollTop).toBeGreaterThan(100);
    expect(box.scrollTop).toBeLessThan(450);
    expect((0, eval)(GLIDE_REMAINING_MS)).toBeGreaterThan(0);
    vi.advanceTimersByTime(dur);
    expect(box.scrollTop).toBeCloseTo(510, 0);
    vi.advanceTimersByTime(100);
    expect((0, eval)(GLIDE_REMAINING_MS)).toBe(0);
  });

  it("見えている相手は動かさない（中央でなくても）", () => {
    // ⚠️ 欄を途中まで下げておく＝一番上だと「中央へ寄せる」動きが範囲の端で 0 に丸められ、見分けられない。
    const { box, hit } = setup(450);
    box.scrollTop = 300; // 相手は欄の中の 150〜170＝見えているが中央（100）ではない
    hit.scrollIntoView({ block: "center" });
    vi.advanceTimersByTime(2000);
    expect(box.scrollTop).toBe(300);
    expect((0, eval)(GLIDE_REMAINING_MS)).toBe(0);
  });

  it("動かせる範囲を越えて動かさない（欄の一番下）", () => {
    const { box, hit } = setup(990);
    hit.scrollIntoView();
    vi.advanceTimersByTime(3000);
    expect(box.scrollTop).toBe(800);
  });

  it("2回入れても1回分だけ（差し替えを重ねない）", () => {
    expect((0, eval)(GLIDE_SCROLL_INSTALL)).toBe("already");
    const patched = Element.prototype.scrollIntoView;
    (0, eval)(GLIDE_SCROLL_INSTALL);
    expect(Element.prototype.scrollIntoView).toBe(patched);
  });
});
