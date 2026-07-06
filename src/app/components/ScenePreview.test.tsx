// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ScenePreview } from "./ScenePreview";
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
