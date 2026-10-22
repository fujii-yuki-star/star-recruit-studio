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
  /** 音源を外して `load()` した＝読み込んだ音を手放した（`releaseAudio`）。 */
  released = false;
  removeAttribute(name: string): void {
    if (name === "src") this.src = "";
  }
  load(): void {
    if (this.src === "") this.released = true;
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
    expect(MockAudio.instances[0].released, "止めた音の音源を手放していない").toBe(true);
    expect(MockAudio.instances[1].released).toBe(false);
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
    expect(a.released, "画面を離れても音源を掴んだまま").toBe(true);
  });

  it("再生終了（onended）で playingKey が戻る（ボタンが再生に戻る）", () => {
    const { result } = renderHook(() => useAudioPreview());
    act(() => result.current.play("a", "url-a"));
    act(() => MockAudio.instances[0].onended?.());
    expect(result.current.playingKey).toBeNull();
  });
});

// ⚠️ **止めた後の「再生を打ち切られた」は失敗ではない**（負荷・耐久の点検 2026-10-22）＝止めると鳴らし始めの
//   約束が打ち切られて断られる。それを「鳴らせませんでした」と案内すると、押し替えただけで失敗の案内が出る。
describe("止めた音の打ち切りを失敗と言わない", () => {
  it("鳴らし始める前に別の音へ替えても、前の音の案内を出さない", async () => {
    let rejectFirst: (e: Error) => void = () => {};
    let first = true;
    vi.spyOn(MockAudio.prototype, "play").mockImplementation(function (this: MockAudio) {
      this.paused = false;
      if (!first) return Promise.resolve();
      first = false;
      return new Promise<void>((_r, rej) => { rejectFirst = rej; });
    });
    const onError = vi.fn();
    const { result } = renderHook(() => useAudioPreview());
    act(() => result.current.play("a", "url-a", onError));
    act(() => result.current.play("b", "url-b"));
    await act(async () => { rejectFirst(new Error("AbortError")); await Promise.resolve(); });
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.playingKey).toBe("b");
  });
});
