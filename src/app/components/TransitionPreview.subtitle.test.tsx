// @vitest-environment jsdom
// 切替効果プレビューの**端フレームの字幕**（#1152 レビュー由来 🟡・ADR-0001／ADR-0031）。
//
// ⚠️ **`subtitleText` だけ渡していた**＝`subtitleSegment` を渡していなかったので、
// **同時にしゃべる行**（ADR-0031）は `parallelLineIds` が空になり**片方しか出ない**（書き出しは両方出る）。
// FREE 字幕も相手（`allLines`）を解けず、**先頭フレームだけプレビューから消える**。
// 先頭・末尾とも `firstFrameLayoutOptions`／`lastFrameLayoutOptions` の対を通して揃える。
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { TransitionPreview } from "./TransitionPreview";
import { useProjectStore } from "../store/projectStore";
import { NARRATION_STATUS } from "../../domain/enums";
import type { NarrationLine, Scene } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";
import type { BoundaryTransition } from "../../domain/project/sceneTransitions";

const template = {
  schemaVersion: "1.0",
  templateId: "tpl_t",
  name: "t",
  category: "opening",
  aspectRatio: "16:9",
  canvas: { width: 1920, height: 1080 },
  layers: [
    { id: "layer_bg", type: "background", x: 0, y: 0, w: 1920, h: 1080, z: 0, fillColor: "#fff" },
    { id: "layer_sub", type: "subtitle", x: 100, y: 900, w: 1720, h: 120, z: 10 },
  ],
} as unknown as Template;

const boundary: BoundaryTransition = { type: "fade", direction: "left", durationSec: 0.5 };

const mk = (id: string, lines?: NarrationLine[]): Scene =>
  ({
    sceneId: id, partId: "part_001", order: 1, sceneType: "opening", templateId: "tpl_t",
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "ナレ", status: NARRATION_STATUS.none }, warnings: [],
    ...(lines ? { lines } : {}),
  }) as unknown as Scene;

function renderAt(prev: Scene, cur: Scene): string {
  useProjectStore.setState({ scenes: [prev, cur] } as never);
  return render(
    <TransitionPreview prevScene={prev} prevTemplate={template} scene={cur} template={template} boundary={boundary} progress={0.5} />,
  ).container.innerHTML;
}

describe("切替効果プレビューの端フレームの字幕（#1152）", () => {
  // ⚠️ **入る側（B）の先頭フレーム**＝同時にしゃべる2行は、どちらも出る。
  it("入る場面の先頭で同時にしゃべる2行は、両方出る", () => {
    const lines: NarrationLine[] = [
      { lineId: "line_001", text: "ひとりめ", startSec: 0, status: NARRATION_STATUS.none },
      { lineId: "line_002", text: "ふたりめ", startSec: 0, startWithPrevious: true, status: NARRATION_STATUS.none },
    ];
    const out = renderAt(mk("s1"), mk("s2", lines));
    expect(out).toContain("ひとりめ");
    expect(out, "同時の行が片方しか出ていない（相手を渡していない）").toContain("ふたりめ");
  });

  // ⚠️ **出ていく側（A）の末尾フレーム**＝同じ扱い（片側だけ直す形にしない）。
  it("出ていく場面の末尾で同時にしゃべる2行も、両方出る", () => {
    const lines: NarrationLine[] = [
      { lineId: "line_001", text: "さいごのひとり", startSec: 4, status: NARRATION_STATUS.none },
      { lineId: "line_002", text: "さいごのふたり", startSec: 4, startWithPrevious: true, status: NARRATION_STATUS.none },
    ];
    const out = renderAt(mk("s1", lines), mk("s2"));
    expect(out).toContain("さいごのひとり");
    expect(out, "末尾側だけ相手を渡していない").toContain("さいごのふたり");
  });

  // ⚠️ **頭に間がある場面は、入る側で字幕を出さない**（書き出しと同じ）。
  it("入る場面の頭に間があるなら、字幕は出さない", () => {
    const lines: NarrationLine[] = [
      { lineId: "line_001", text: "あとからでるせりふ", startSec: 3, status: NARRATION_STATUS.none },
    ];
    const cur = mk("s2", lines);
    (cur as unknown as { texts: Record<string, string> }).texts = { subtitle: "でないはずのじまく" };
    const out = renderAt(mk("s1"), cur);
    expect(out).not.toContain("あとからでるせりふ");
    expect(out, "場面ぜんたいの字幕が出ている").not.toContain("でないはずのじまく");
  });
});
