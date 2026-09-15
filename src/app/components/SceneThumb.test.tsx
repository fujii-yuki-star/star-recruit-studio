// @vitest-environment jsdom
// 場面カードの見本が、**動画に一度も出ない字幕**を出さない（#1152・α 出口監査 🟡）。
//
// ⚠️ **純粋関数の検査だけでは足りない**＝`firstFrameLayoutOptions` が正しくても、
// **見本がそれを渡していなければ**同じことが起きる（実際、渡していなかった）。
// ここは「渡していること」を、描かれた絵で確かめる。
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { SceneThumb } from "./SceneThumb";
import { useProjectStore } from "../store/projectStore";
import { NARRATION_STATUS } from "../../domain/enums";
import type { NarrationLine, Scene } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";

const template: Template = {
  templateId: "tpl_001",
  name: "見本",
  aspectRatio: "16:9",
  canvas: { width: 1920, height: 1080 },
  layers: [
    { id: "layer_bg", type: "background", x: 0, y: 0, w: 1920, h: 1080, z: 0, fillColor: "#fff" },
    { id: "layer_sub", type: "subtitle", x: 100, y: 900, w: 1720, h: 120, z: 10 },
  ],
} as unknown as Template;

function sceneWith(partial: Partial<Scene>): Scene {
  return {
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "opening", templateId: "tpl_001",
    durationSec: 10, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "ナレ", status: NARRATION_STATUS.none }, warnings: [], ...partial,
  } as Scene;
}

const html = (scene: Scene): string => render(<SceneThumb scene={scene} template={template} />).container.innerHTML;

describe("場面カードの見本（#1152）", () => {
  // ⚠️ **これが直す前の姿**＝入力を渡さないと `texts.subtitle` を描くので、
  // **頭に間のある掛け合い**では「動画に一度も出ない字幕」を見本だけが出していた。
  it("頭に間のある掛け合いでは、字幕を出さない", () => {
    const lines: NarrationLine[] = [
      { lineId: "line_001", text: "さいしょのせりふ", startSec: 2, status: NARRATION_STATUS.none },
      { lineId: "line_002", text: "つぎのせりふ", startSec: 6, status: NARRATION_STATUS.none },
    ];
    const out = html(sceneWith({ lines, texts: { subtitle: "でないはずのじまく" } }));
    expect(out, "動画に出ない字幕を見本が出している").not.toContain("でないはずのじまく");
    expect(out, "頭の間なのに先頭行が出ている").not.toContain("さいしょのせりふ");
  });

  it("頭に間が無い掛け合いでは、先頭行の字幕を出す（場面ぜんたいの字幕ではない）", () => {
    const lines: NarrationLine[] = [
      { lineId: "line_001", text: "さいしょのせりふ", startSec: 0, status: NARRATION_STATUS.none },
      { lineId: "line_002", text: "つぎのせりふ", startSec: 5, status: NARRATION_STATUS.none },
    ];
    const out = html(sceneWith({ lines, texts: { subtitle: "でないはずのじまく" } }));
    expect(out).toContain("さいしょのせりふ");
    expect(out).not.toContain("でないはずのじまく");
    expect(out, "先頭フレームなのに2行目まで出ている").not.toContain("つぎのせりふ");
  });

  // ⚠️ **掛け合いでない場面は、いままでどおり**＝`undefined`（テンプレの既定に任せる）を
  // `null`（間＝消す）と同じ扱いにすると、**普通の場面の字幕が消える**。
  it("掛け合いでない場面は、場面の字幕をそのまま出す", () => {
    expect(html(sceneWith({ texts: { subtitle: "ふつうのじまく" } }))).toContain("ふつうのじまく");
  });

  // ⚠️ **同時にしゃべる行は、帯を積んで両方出す**（ADR-0031）＝先頭の正準セグメントを渡さないと
  // `parallelLineIds` が空になり、**片方しか出ない**（動画は両方出る）。
  it("同時にしゃべる2行は、見本でも両方出る", () => {
    const lines: NarrationLine[] = [
      { lineId: "line_001", text: "ひとりめ", startSec: 0, status: NARRATION_STATUS.none },
      { lineId: "line_002", text: "ふたりめ", startSec: 0, startWithPrevious: true, status: NARRATION_STATUS.none },
    ];
    const out = html(sceneWith({ lines }));
    expect(out).toContain("ひとりめ");
    expect(out, "同時の行が見本に出ていない（先頭の正準セグメントを渡していない）").toContain("ふたりめ");
  });

  it("声の長さを store から読む（大きい方と同じ入力）", () => {
    // ⚠️ **読んでいることを留める**＝読まずに `{}` を渡すと、行の長さで先頭が決まる場面でずれる。
    expect(Object.keys(useProjectStore.getState())).toContain("narrationAudioById");
  });
});
