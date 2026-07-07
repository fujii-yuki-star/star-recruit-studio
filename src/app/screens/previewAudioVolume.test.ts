// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachVolume, closeAudioContext, type AudioCtxRef } from "./previewAudioVolume";

/* eslint-disable @typescript-eslint/no-explicit-any */
const originalAC = (window as any).AudioContext;
afterEach(() => {
  (window as any).AudioContext = originalAC;
  (window as any).webkitAudioContext = undefined;
});

function fakeMedia(): HTMLMediaElement {
  return { volume: 1, muted: false } as unknown as HTMLMediaElement;
}

function mockAudioContext() {
  const gain = { gain: { value: -1 }, connect: vi.fn((d: unknown) => d) };
  const source = { connect: vi.fn(() => gain) };
  const ctx = {
    createMediaElementSource: vi.fn(() => source),
    createGain: vi.fn(() => gain),
    destination: {},
    resume: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
  };
  return { ctx, gain, source };
}

describe("attachVolume（プレビュー音量パリティ・#452 P1）", () => {
  it("≤1.0 は要素の .volume で厳密適用し、Web Audio を使わない。setMuted は .muted を切替", () => {
    const m = fakeMedia();
    const ctxRef: AudioCtxRef = { current: null };
    const ctl = attachVolume(ctxRef, m, 0.3, false);
    expect(m.volume).toBeCloseTo(0.3);
    expect(m.muted).toBe(false);
    expect(ctxRef.current).toBeNull(); // 共有 ctx を張らない
    ctl.setMuted(true);
    expect(m.muted).toBe(true);
    ctl.setMuted(false);
    expect(m.muted).toBe(false);
  });

  it("初期 muted=true（≤1.0）は .muted=true で開始", () => {
    const m = fakeMedia();
    attachVolume({ current: null }, m, 1.0, true);
    expect(m.muted).toBe(true);
  });

  it("AudioContext 不在は 1.0超でも .volume を 1.0 にクランプ（下げ方向のみのフォールバック）", () => {
    (window as any).AudioContext = undefined;
    (window as any).webkitAudioContext = undefined;
    const m = fakeMedia();
    attachVolume({ current: null }, m, 1.5, false);
    expect(m.volume).toBe(1);
  });

  it("1.0超は GainNode で増幅（gain=volume・要素 .volume=1）、setMuted で gain を 0↔volume に", () => {
    const { ctx, gain } = mockAudioContext();
    (window as any).AudioContext = function () { return ctx; };
    const m = fakeMedia();
    const ctxRef: AudioCtxRef = { current: null };
    const ctl = attachVolume(ctxRef, m, 1.5, false);
    expect(gain.gain.value).toBe(1.5); // 書き出しの FFmpeg volume=1.5 と一致
    expect(m.volume).toBe(1); // 素の音量は最大＝最終音量は gain が作る
    expect(ctxRef.current).toBe(ctx as unknown as AudioContext); // 共有 ctx を張った
    ctl.setMuted(true);
    expect(gain.gain.value).toBe(0);
    ctl.setMuted(false);
    expect(gain.gain.value).toBe(1.5);
    closeAudioContext(ctxRef);
    expect(ctx.close).toHaveBeenCalled();
    expect(ctxRef.current).toBeNull();
  });

  it("1.0超で初期 muted=true は gain=0 で開始", () => {
    const { ctx, gain } = mockAudioContext();
    (window as any).AudioContext = function () { return ctx; };
    const ctl = attachVolume({ current: null }, fakeMedia(), 1.5, true);
    expect(gain.gain.value).toBe(0);
    ctl.setMuted(false);
    expect(gain.gain.value).toBe(1.5);
  });
});
