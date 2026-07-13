// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachVolume, closeAudioContext, type AudioCtxRef } from "./previewAudioVolume";
import { VOLUME_MAX } from "../../domain/constants";

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
  const gain = { gain: { value: -1 }, connect: vi.fn((d: unknown) => d), disconnect: vi.fn() };
  const source = { connect: vi.fn(() => gain), disconnect: vi.fn() };
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

describe("setVolume（再生中の即時反映・#465/#392）", () => {
  it("要素経路（Web Audio 不可）は setVolume を 0〜1.0 にクランプ（>1.0 は下げ方向のみ・頭出ししない）", () => {
    (window as any).AudioContext = undefined;
    (window as any).webkitAudioContext = undefined;
    const m = fakeMedia();
    const ctl = attachVolume({ current: null }, m, 0.3, false);
    ctl.setVolume(0.8);
    expect(m.volume).toBeCloseTo(0.8); // ≤1.0 内の変更はその場で反映
    ctl.setVolume(1.5);
    expect(m.volume).toBe(1); // Web Audio 不可なので 1.0 フォールバック（下げ方向のみ一致）
    ctl.setVolume(-0.2);
    expect(m.volume).toBe(0); // 下限クランプ
  });

  it("要素経路→GainNode：100%超へ跨ぐと張り直さずその場で GainNode へ載せ替える（頭出ししない・#465 レビュー P1）", () => {
    const { ctx, gain } = mockAudioContext();
    (window as any).AudioContext = function () { return ctx; };
    const m = fakeMedia();
    const ctxRef: AudioCtxRef = { current: null };
    const ctl = attachVolume(ctxRef, m, 0.3, false); // 開始は要素経路（≤1.0）
    expect(ctxRef.current).toBeNull(); // まだ Web Audio を張っていない
    expect(m.volume).toBeCloseTo(0.3);
    ctl.setVolume(1.2); // 100%超へ＝その場で GainNode 化（要素は同じ＝currentTime を保つ＝頭出ししない）
    expect(ctx.createMediaElementSource).toHaveBeenCalledTimes(1); // 載せ替えは一度きり（張り直しでない）
    expect(ctxRef.current).toBe(ctx as unknown as AudioContext);
    expect(gain.gain.value).toBe(1.2);
    expect(m.volume).toBe(1); // 要素は等倍で素通し、最終音量は gain
  });

  it("一度 GainNode 化したら 100%以下へ戻しても要素へ戻さず gain で素通しする（#465 P2「GainNode化後は維持」）", () => {
    const { ctx, gain } = mockAudioContext();
    (window as any).AudioContext = function () { return ctx; };
    const ctl = attachVolume({ current: null }, fakeMedia(), 1.5, false); // 最初から GainNode
    ctl.setVolume(0.4); // ≤1.0 へ戻す
    expect(ctx.createMediaElementSource).toHaveBeenCalledTimes(1); // source の再生成なし（要素へ戻さない）
    expect(gain.gain.value).toBe(0.4); // gain が 0〜1.5 を素通し
  });

  it("GainNode 経路は setVolume を gain へ即時反映し 0.0〜1.5 にクランプする（§2-7）", () => {
    const { ctx, gain } = mockAudioContext();
    (window as any).AudioContext = function () { return ctx; };
    const ctl = attachVolume({ current: null }, fakeMedia(), 1.5, false);
    ctl.setVolume(1.2);
    expect(gain.gain.value).toBe(1.2); // 書き出しと同じ増幅係数を即時反映
    ctl.setVolume(2); // 上限超は正典の 1.5 にクランプ（直書きしない）
    expect(gain.gain.value).toBe(VOLUME_MAX);
    ctl.setVolume(-1); // 下限
    expect(gain.gain.value).toBe(0);
  });

  it("GainNode 経路：muted 中の setVolume は gain=0 を保ち、unmute で最新音量に復帰", () => {
    const { ctx, gain } = mockAudioContext();
    (window as any).AudioContext = function () { return ctx; };
    const ctl = attachVolume({ current: null }, fakeMedia(), 1.5, false);
    ctl.setMuted(true);
    expect(gain.gain.value).toBe(0);
    ctl.setVolume(1.2); // ミュート中は保持のみ（鳴らさない）
    expect(gain.gain.value).toBe(0);
    ctl.setMuted(false);
    expect(gain.gain.value).toBe(1.2); // 復帰時は最新音量
  });

  it("要素経路：muted 中の setVolume は .volume を更新しても .muted は解けない", () => {
    (window as any).AudioContext = undefined;
    const m = fakeMedia();
    const ctl = attachVolume({ current: null }, m, 0.3, false);
    ctl.setMuted(true);
    ctl.setVolume(0.7);
    expect(m.volume).toBeCloseTo(0.7);
    expect(m.muted).toBe(true); // 音量変更でミュートは解けない
  });
});

describe("dispose（置換/停止時に共有 ctx からグラフを切る・#465 P2）", () => {
  it("GainNode 経路は dispose で source/gain を切断する（古いノードを残さない）", () => {
    const { ctx, gain, source } = mockAudioContext();
    (window as any).AudioContext = function () { return ctx; };
    const ctl = attachVolume({ current: null }, fakeMedia(), 1.5, false);
    ctl.dispose();
    expect(source.disconnect).toHaveBeenCalled();
    expect(gain.disconnect).toHaveBeenCalled();
  });

  it("要素経路は dispose しても何もしない（Web Audio 未使用）", () => {
    (window as any).AudioContext = undefined;
    const ctl = attachVolume({ current: null }, fakeMedia(), 0.3, false);
    expect(() => ctl.dispose()).not.toThrow();
  });
});
