// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { dragEnd, dragOver, pointerDownAt } from "../../test/pointer";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Scene } from "../../domain/project/types";
import { DraftScreen } from "./DraftScreen";

// #398 再対応：たたき台の台本表も同じ useDragReorder を使う。フックを Pointer Events 版へ置換したので、
// 行の持ち手（⠿）を実操作して store の並びが変わることを固定する（共有フックの回帰防止）。
function scene(id: string, order: number): Scene {
  return {
    sceneId: id, partId: "part_001", order, sceneType: "photo_intro",
    templateId: "photo_left_text_right_yuko_v1", durationSec: 8, assetRefs: {},
    character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" }, warnings: [],
  };
}

describe("DraftScreen 台本表の並び替え（Pointer Events・#398 再対応）", () => {
  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" });
    useProjectStore.getState().newProject();
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001", "scene_002", "scene_003"] }],
      scenes: [scene("scene_001", 1), scene("scene_002", 2), scene("scene_003", 3)],
      status: "ready", warnings: [], saveStatus: "saved",
    });
  });

  /** その要素の「手前半分／後ろ半分」を指せるようにする（jsdom は実寸を持たない）。 */
  const halves = (el: Element) => {
    (el as HTMLElement).getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => undefined }) as DOMRect;
    return { front: { clientX: 20, clientY: 20 }, back: { clientX: 80, clientY: 80 } };
  };

  it("先頭行の持ち手を3行目の**下半分**へドラッグすると [002,003,001] になる", () => {
    render(<DraftScreen onNavigate={vi.fn()} />);
    const gripRows = [...document.querySelectorAll("tbody tr")];
    expect(gripRows).toHaveLength(3);
    const grip = [...gripRows[0].querySelectorAll("span")].find((s) => s.textContent === "⠿");
    expect(grip).toBeTruthy();

    // ⚠️ **どちら半分かで結果が変わる**（#771(c)）＝落とし先は「重なった行」ではなく**すき間**。
    const at = halves(gripRows[2]);
    pointerDownAt(grip as HTMLElement, 1000, { button: 0 });
    dragOver(gripRows[2], at.back); // 3行目の下半分＝末尾のすき間
    dragEnd();

    expect(useProjectStore.getState().scenes.map((s) => s.sceneId)).toEqual([
      "scene_002", "scene_003", "scene_001",
    ]);
  });

  // ⚠️ #714-4 の配線確認：以前は**押した瞬間に掴んだ扱い**で、1〜2px の震えで隣のすき間が確定した。
  it("押した位置からほとんど動いていないときは並び替わらない（震えで確定しない）", () => {
    render(<DraftScreen onNavigate={vi.fn()} />);
    const rows = [...document.querySelectorAll("tbody tr")];
    const grip = [...rows[0].querySelectorAll("span")].find((s) => s.textContent === "⠿");
    halves(rows[2]);
    pointerDownAt(grip as HTMLElement, 1000, { button: 0, clientX: 78, clientY: 78 });
    dragOver(rows[2], { clientX: 80, clientY: 80 }); // 押した所から約 2.8px＝しきい値未満
    dragEnd();
    expect(useProjectStore.getState().scenes.map((s) => s.sceneId)).toEqual([
      "scene_001", "scene_002", "scene_003",
    ]);
  });

  // #771(c)：**同じすき間なら、どちらから来ても同じ結果**（以前は「重なった行」で決めていたので、
  // 前へ動かすとその手前・後ろへ動かすとその後ろ＝同じ手つきが向きで1つずれた）。
  it("**同じすき間なら向きに依らず同じ結果**（1つズレを作らない）", () => {
    render(<DraftScreen onNavigate={vi.fn()} />);
    const rows = () => [...document.querySelectorAll("tbody tr")];
    const gripOf = (el: Element) => [...el.querySelectorAll("span")].find((s) => s.textContent === "⠿") as HTMLElement;

    // ⚠️ **時刻を固定して送る**（`src/test/pointer.ts`）＝1つのテストで2回掴むので、素の `fireEvent` だと
    // 実時刻が乗り、間の再描画しだいで二度押しと見なされうる（`doubleTapGuard`）。
    // 先頭（001）を「2行目の下半分」＝002 と 003 の間へ。
    const at1 = halves(rows()[1]);
    pointerDownAt(gripOf(rows()[0]), 1000, { button: 0 });
    dragOver(rows()[1], at1.back);
    dragEnd();
    expect(useProjectStore.getState().scenes.map((s) => s.sceneId)).toEqual(["scene_002", "scene_001", "scene_003"]);

    // 末尾（003）を「同じすき間」＝いまの 002 と 001 の間へ。手前から来ても後ろから来ても、
    // 「指した2つの間」に入る。
    const at2 = halves(rows()[0]);
    pointerDownAt(gripOf(rows()[2]), 9000, { button: 0 }); // 別の操作＝十分離れた時刻
    dragOver(rows()[0], at2.back);
    dragEnd();
    expect(useProjectStore.getState().scenes.map((s) => s.sceneId)).toEqual(["scene_002", "scene_003", "scene_001"]);
  });
});
