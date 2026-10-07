// @vitest-environment jsdom
import { doubleTap } from "../../test/pointer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Scene } from "../../domain/project/types";
import { SceneEditScreen } from "./SceneEditScreen";

// #549 配線：オーバーレイの「編集中」を画面が受け取り ScenePreview の hideItemIds へ渡す＝編集中はSVG側の同じ文字を
// 伏せる（textarea が同じ体裁で同じ位置に出すため、伏せないと二重表示になる）。単体テストは overlay/preview を
// 個別に props 注入で見るので、ここでは「画面経由の実経路」を通して配線の取り違えを検知する。
const freeScene = (): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "free",
    templateId: "free_canvas_v1", durationSec: 8, assetRefs: {},
    character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" }, warnings: [],
    freeLayout: [
      { id: "free_001", kind: "text", x: 100, y: 100, w: 800, h: 200, text: "編集する文字", fontSize: 48 },
      { id: "free_002", kind: "text", x: 100, y: 400, w: 800, h: 200, text: "ほかの文字", fontSize: 48 },
    ],
  }) as unknown as Scene;

/** 2つ目の FREE 場面。`free_NNN` は**場面内一意**なので、別場面にも同じ `free_001` が普通に存在する。 */
const freeSceneB = (): Scene =>
  ({
    ...freeScene(), sceneId: "scene_002", order: 2,
    freeLayout: [{ id: "free_001", kind: "text", x: 100, y: 100, w: 800, h: 200, text: "Bの文字", fontSize: 48 }],
  }) as unknown as Scene;

/** 仕上がりSVG（プレビュー）の中身だけを見る＝右パネルの入力欄や textarea の値と混ざらない。 */
const svgText = () => (document.querySelector('[aria-label="場面の仕上がり"]') as HTMLElement | null)?.textContent ?? "";

describe("SceneEditScreen インライン編集の配線（#549）", () => {
  beforeEach(() => {
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [freeScene()], assets: [], editingSceneId: "scene_001",
      past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
    });
  });

  it("ダブルクリックで編集に入るとSVG側の同じ文字だけ伏せ、抜けると戻る（二重表示にしない）", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(svgText()).toContain("編集する文字"); // 編集前は描かれている

    const el = document.querySelector('[data-free-id="free_001"]') as HTMLElement;
    // 二度押し＝インライン編集へ（実機経路・#525-4）。**時刻は固定**＝間の再描画の速さで判定が変わらない（#645）。
    doubleTap(el);

    // 画面には他にも textbox（動画の名前・右パネル）があるため、要素ボックス内のインライン textarea を直接引く。
    const ta = document.querySelector('[data-free-id="free_001"] textarea') as HTMLTextAreaElement;
    expect(ta).toBeTruthy();
    expect(ta.value).toBe("編集する文字"); // その場編集の入力面
    expect(svgText()).not.toContain("編集する文字"); // 編集中＝SVG からは伏せる（hideItemIds 配線）
    expect(svgText()).toContain("ほかの文字"); // 他の要素は描いたまま

    fireEvent.blur(ta);
    expect(svgText()).toContain("編集する文字"); // 編集を抜けたら戻る
  });
});

// #549 レビュー P2：FREE→FREE の場面切替では overlay はアンマウントしない（同一分岐・key なし／SceneEditScreen も
// 場面切替で再マウントしない＝#207）ため、unmount cleanup だけでは overlay ローカルの editingId が持ち越される。
// free_NNN は**場面内一意**＝ほとんどの FREE 場面が free_001 を持つので、「編集 → 隣の場面カードをクリック」で踏む。
// 残ると (a) 次の場面の同名要素を伏せ続ける＝プレビューだけ消えて書き出しには出る（無言のパリティ乖離・ADR-0001）
//       (b) その要素がテキストならダブルクリックせずに編集モードで開く。
describe("SceneEditScreen 場面切替で編集状態を持ち越さない（#549 レビュー P2）", () => {
  beforeEach(() => {
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001", "scene_002"] }],
      scenes: [freeScene(), freeSceneB()], assets: [], editingSceneId: "scene_001",
      past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
    });
  });

  it("編集中に隣の場面へ切り替えても、同名 free_001 を伏せない・勝手に編集モードにならない", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    const el = document.querySelector('[data-free-id="free_001"]') as HTMLElement;
    doubleTap(el);
    expect(svgText()).not.toContain("編集する文字"); // 場面Aは編集中＝伏せている

    const cards = document.querySelectorAll("button.scene-card");
    fireEvent.click(cards[1]); // 場面B へ切替（overlay はアンマウントされない経路）

    // (a) 場面Bの free_001 は伏せられていない＝プレビューに出る（書き出しと一致）。
    expect(svgText()).toContain("Bの文字");
    // (b) ダブルクリックしていないので編集モードにならない。
    expect(document.querySelector('[data-free-id="free_001"] textarea')).toBeNull();
  });
});
