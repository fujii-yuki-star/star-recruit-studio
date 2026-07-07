// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ScenePreview } from "./ScenePreview";
import type { VideoSlotPlayback } from "./ScenePreview";
import type { Scene } from "../../domain/project/types";
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
});
