// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAudioPreview } from "./useAudioPreview";

// jsdom は HTMLMediaElement.play を実装しないため、最小の Audio モックで play/pause と onended を検証する。
class MockAudio {
  src: string;
  paused = true;
  onended: (() => void) | null = null;
  static instances: MockAudio[] = [];
  constructor(src: string) {
    this.src = src;
    MockAudio.instances.push(this);
  }
  play(): Promise<void> {
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
}

beforeEach(() => {
  MockAudio.instances = [];
  vi.stubGlobal("Audio", MockAudio as unknown as typeof Audio);
});
afterEach(() => vi.unstubAllGlobals());

describe("useAudioPreview（試し聞きの停止制御・#388）", () => {
  it("play で再生開始し playingKey を持つ", () => {
    const { result } = renderHook(() => useAudioPreview());
    act(() => result.current.play("a", "url-a"));
    expect(result.current.playingKey).toBe("a");
    expect(MockAudio.instances).toHaveLength(1);
    expect(MockAudio.instances[0].paused).toBe(false);
  });

  it("同じ key をもう一度 play すると停止（トグル）", () => {
    const { result } = renderHook(() => useAudioPreview());
    act(() => result.current.play("a", "url-a"));
    act(() => result.current.play("a", "url-a"));
    expect(result.current.playingKey).toBeNull();
    expect(MockAudio.instances[0].paused).toBe(true);
  });

  it("別 key を play すると前を止めて切り替える（連打・別操作で重ならない）", () => {
    const { result } = renderHook(() => useAudioPreview());
    act(() => result.current.play("a", "url-a"));
    act(() => result.current.play("b", "url-b"));
    expect(result.current.playingKey).toBe("b");
    expect(MockAudio.instances[0].paused).toBe(true); // a は停止
    expect(MockAudio.instances[1].paused).toBe(false); // b は再生
  });

  it("stop で停止する", () => {
    const { result } = renderHook(() => useAudioPreview());
    act(() => result.current.play("a", "url-a"));
    act(() => result.current.stop());
    expect(result.current.playingKey).toBeNull();
    expect(MockAudio.instances[0].paused).toBe(true);
  });

  it("アンマウント（画面遷移）で停止＝別画面で鳴り続けない", () => {
    const { result, unmount } = renderHook(() => useAudioPreview());
    act(() => result.current.play("a", "url-a"));
    const a = MockAudio.instances[0];
    unmount();
    expect(a.paused).toBe(true);
  });

  it("再生終了（onended）で playingKey が戻る（ボタンが再生に戻る）", () => {
    const { result } = renderHook(() => useAudioPreview());
    act(() => result.current.play("a", "url-a"));
    act(() => MockAudio.instances[0].onended?.());
    expect(result.current.playingKey).toBeNull();
  });
});
