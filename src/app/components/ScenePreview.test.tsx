// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { ScenePreview } from "./ScenePreview";
import type { VideoSlotPlayback } from "./ScenePreview";
import type { ElementAnimation, Scene } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";

// #386・A案＝掛け合いの先頭「間」は字幕なし。プレビュー（ScenePreview）が activeLineIndex<0（間）で
// 行の字幕を描かず、有効行（0以上）では描くことをコンポーネントで検証する（ADR-0014・jsdom）。
// 描画ツリーの後片付けは共通 setup（src/test/setup.ts）の afterEach が行う。
describe("ScenePreview 掛け合いの「間」（#386・A案＝間は字幕なし）", () => {
  const template = {
    schemaVersion: "1.0",
    templateId: "tpl_sub",
    name: "sub",
    category: "opening",
    aspectRatio: "16:9",
    canvas: { width: 1920, height: 1080 },
    layers: [
      { id: "subtitle", type: "subtitle", textKey: "subtitle", x: 240, y: 920, w: 1440, h: 90, zIndex: 50, fontSize: 38 },
    ],
  } as unknown as Template;

  const scene = {
    sceneId: "s1",
    templateId: "tpl_sub",
    sceneType: "opening",
    durationSec: 10,
    texts: {},
    lines: [
      { lineId: "line_001", text: "ゆうこの字幕テスト", startSec: 2, status: "none" },
      { lineId: "line_002", text: "二行目", startSec: 6, status: "none" },
    ],
  } as unknown as Scene;

  it("有効行（activeLineIndex=0）は行の字幕を描く", () => {
    const { container } = render(<ScenePreview scene={scene} template={template} activeLineIndex={0} />);
    expect(container.textContent).toContain("ゆうこの字幕テスト");
  });

  it("間（activeLineIndex<0）は行の字幕を描かない（間は字幕なし・A案）", () => {
    const { container } = render(<ScenePreview scene={scene} template={template} activeLineIndex={-1} />);
    expect(container.textContent).not.toContain("ゆうこの字幕テスト");
  });
});

// #432・仕上がり確認で動画スロットを実映像で再生：再生中のみ video 要素を出す（停止中はサムネSVGのまま）。
describe("ScenePreview 実映像再生（#432）", () => {
  // FREE テンプレの slot 要素＝layoutScene が role='slot' の image item（id=要素id）を作る。
  const freeTemplate = {
    schemaVersion: "1.0", templateId: "tpl_free", name: "free", category: "free",
    aspectRatio: "16:9", canvas: { width: 1920, height: 1080 }, layers: [],
  } as unknown as Template;
  const videoScene = {
    sceneId: "sv", templateId: "tpl_free", sceneType: "opening", durationSec: 8, texts: {},
    freeLayout: [{ id: "slot_1", kind: "slot", assetId: "asset_v", x: 100, y: 100, w: 800, h: 600, fit: "cover", zIndex: 1 }],
  } as unknown as Scene;
  const slot = (over: Partial<VideoSlotPlayback> = {}): VideoSlotPlayback => ({
    slotLayerId: "slot_1", clipUrl: "blob:clip", clipStartSec: 0, speed: 1, fit: "cover",
    useOriginalAudio: true, originalVolume: 0.4, ...over,
  });

  it("再生中＋URL解決済みは video 要素を出す（クリップURL・スロット矩形へ配置）", () => {
    const { container } = render(
      <ScenePreview scene={videoScene} template={freeTemplate} videoPlayback={{ playing: true, muted: false, slots: [slot()] }} />,
    );
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.getAttribute("src")).toBe("blob:clip");
    // スロット矩形（x100/w800 of 1920）へ % 配置。
    expect(video?.style.left).toBe(`${(100 / 1920) * 100}%`);
    expect(video?.style.width).toBe(`${(800 / 1920) * 100}%`);
  });

  it("停止中は video 要素を出さない（従来のサムネSVGのまま）", () => {
    const { container } = render(
      <ScenePreview scene={videoScene} template={freeTemplate} videoPlayback={{ playing: false, muted: false, slots: [slot()] }} />,
    );
    expect(container.querySelector("video")).toBeNull();
  });

  it("URL未解決（clipUrl空）は実映像にせずサムネのまま", () => {
    const { container } = render(
      <ScenePreview scene={videoScene} template={freeTemplate} videoPlayback={{ playing: true, muted: false, slots: [slot({ clipUrl: "" })] }} />,
    );
    expect(container.querySelector("video")).toBeNull();
  });

  it("ミュート中は video もミュート", () => {
    const { container } = render(
      <ScenePreview scene={videoScene} template={freeTemplate} videoPlayback={{ playing: true, muted: true, slots: [slot()] }} />,
    );
    expect(container.querySelector("video")?.muted).toBe(true);
  });

  it("元音声OFFのスロットは video をミュート（元音声を鳴らさない）", () => {
    const { container } = render(
      <ScenePreview scene={videoScene} template={freeTemplate} videoPlayback={{ playing: true, muted: false, slots: [slot({ useOriginalAudio: false })] }} />,
    );
    expect(container.querySelector("video")?.muted).toBe(true);
  });

  it("元音声>100%（例150%）は Web Audio の GainNode で増幅＝書き出しと一致（#432 P2）", () => {
    // jsdom は AudioContext を持たないためモックを差す。gain.value に volume(1.5) が入ることを確認。
    let capturedGain: { gain: { value: number } } | null = null;
    class MockAudioContext {
      destination = {};
      createGain() {
        capturedGain = { gain: { value: 0 }, connect: (n: unknown) => n } as unknown as { gain: { value: number } };
        return capturedGain;
      }
      createMediaElementSource() { return { connect: (n: unknown) => n }; }
      resume() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
    }
    const win = window as unknown as { AudioContext?: unknown };
    const prev = win.AudioContext;
    win.AudioContext = MockAudioContext as unknown as typeof AudioContext;
    try {
      render(
        <ScenePreview scene={videoScene} template={freeTemplate} videoPlayback={{ playing: true, muted: false, slots: [slot({ useOriginalAudio: true, originalVolume: 1.5 })] }} />,
      );
      // 増幅は video.volume(上限1.0)でなく gain(1.5) で作る＝書き出しの volume=1.5 と一致。
      expect(capturedGain).not.toBeNull();
      expect(capturedGain!.gain.value).toBe(1.5);
    } finally {
      win.AudioContext = prev;
    }
  });
});

// #444/ADR-0027：動画スロットの再生開始タイミング。d>0 は代表フレームで待ってから再生（hold-then-play）。
// jsdom は loadedmetadata を自動発火しないので手動 dispatch で start() を走らせ、play/pause を spy で観測する。
describe("ScenePreview 再生開始タイミング（#444・delay は d 秒待つ）", () => {
  const freeTemplate = {
    schemaVersion: "1.0", templateId: "tpl_free", name: "free", category: "free",
    aspectRatio: "16:9", canvas: { width: 1920, height: 1080 }, layers: [],
  } as unknown as Template;
  const baseScene = {
    sceneId: "sv", templateId: "tpl_free", sceneType: "opening", durationSec: 8, texts: {},
    freeLayout: [{ id: "slot_1", kind: "slot", assetId: "asset_v", x: 100, y: 100, w: 800, h: 600, fit: "cover", zIndex: 1 }],
  } as unknown as Scene;
  const slot: VideoSlotPlayback = { slotLayerId: "slot_1", clipUrl: "blob:clip", clipStartSec: 0, speed: 1, fit: "cover", useOriginalAudio: false };
  // slot_1 を動かすアニメ（animEnd=2）＝窓 W=min(尺8,2)=2。
  const anims = [{ id: "a", sceneId: "sv", targetId: "slot_1", keyframes: [{ timeSec: 0, x: -100 }, { timeSec: 2, x: 0 }] }] as unknown as ElementAnimation[];

  const renderAndStart = (scene: Scene): HTMLVideoElement => {
    const { container } = render(
      <ScenePreview scene={scene} template={freeTemplate} animations={anims} timeSec={0}
        videoPlayback={{ playing: true, muted: false, slots: [slot] }} />,
    );
    const video = container.querySelector("video")!;
    video.dispatchEvent(new Event("loadedmetadata")); // start() を走らせる
    return video;
  };

  it("delay（途中から）：d 秒は再生せず待ち、経過後に再生する", () => {
    vi.useFakeTimers();
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    try {
      renderAndStart({ ...baseScene, slotVideoStart: { slot_1: { mode: "delay", delaySec: 1 } } } as unknown as Scene);
      expect(pause).toHaveBeenCalled(); // 代表フレームで静止
      expect(play).not.toHaveBeenCalled(); // まだ再生しない
      vi.advanceTimersByTime(1000); // d=1s 経過
      expect(play).toHaveBeenCalled(); // 再生開始
    } finally {
      play.mockRestore(); pause.mockRestore(); vi.useRealTimers();
    }
  });

  it("遅延なし（withAnim/未設定）は即再生（従来）", () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    try {
      renderAndStart(baseScene); // slotVideoStart 無し＝withAnim＝d=0
      expect(play).toHaveBeenCalled();
    } finally {
      play.mockRestore();
    }
  });
});
