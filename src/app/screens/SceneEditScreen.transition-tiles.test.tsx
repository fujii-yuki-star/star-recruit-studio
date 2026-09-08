// @vitest-environment jsdom
// 画面の切り替えを「絵で選ぶ」（#1032・文章依存を減らす3つの型の①）。
//
// ⚠️ 以前は名前の一覧（`<select>`）で、注釈2文（「※ 上の『切り替えを見る』で確認できます」）に
//    頼っていた＝**選んで再生してみるまで何が起きるか分からない**うえ、**別のボタンを探させて**いた。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import { TRANSITION_TYPE } from "../../domain/enums";
import type { Scene } from "../../domain/project/types";
import { SceneEditScreen } from "./SceneEditScreen";

const scene = (id: string, order: number, over: Partial<Scene> = {}): Scene =>
  ({
    sceneId: id, partId: "part_001", order, sceneType: sampleTemplates[0].category,
    templateId: sampleTemplates[0].templateId, durationSec: 8, assetRefs: {},
    character: { enabled: false, characterId: "yuko" }, texts: { title: `見出し${order}` },
    narration: { text: "", status: "none" }, warnings: [],
    transition: { in: "none", out: "none", durationSec: 0.5 },
    ...over,
  } as unknown as Scene);

/** 2場面。既定は2つ目を選ぶ（＝前の場面があるので切り替えが効く）。 */
const setup = (selectedId = "scene_002", scenes = [scene("scene_001", 1), scene("scene_002", 2)]) => {
  useProjectStore.setState({
    templates: sampleTemplates,
    parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: scenes.map((s) => s.sceneId) }],
    scenes, assets: [], editingSceneId: selectedId,
    past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
  });
  return render(<SceneEditScreen onNavigate={vi.fn()} />);
};

/** 切り替えのタイル（群の中から引く＝画面のほかの「なし」と混ざらない）。 */
const tiles = () => within(screen.getByRole("group", { name: "画面の切り替え" }));
const pick = (name: string) => fireEvent.click(tiles().getByRole("button", { name }));
/** いまの場面の切り替え。 */
const current = () => useProjectStore.getState().scenes[1]!.transition;

describe("画面の切り替えを絵で選ぶ（#1032）", () => {
  beforeEach(() => {
    localStorage.clear();
    useProjectStore.setState({ past: [], future: [], _historyGroupDepth: 0 });
  });

  it("効果は6つ、それぞれ絵つきで並ぶ", () => {
    setup();
    const buttons = tiles().getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "なし", "フェード", "スライド（左へ）", "スライド（右へ）", "スライド（上へ）", "スライド（下へ）",
    ]);
    for (const b of buttons) {
      expect(b.querySelector("svg"), `「${b.getAttribute("aria-label")}」に絵が無い`).toBeTruthy();
    }
  });

  it("選ぶと、その場面の切り替えが変わる", () => {
    setup();
    pick("フェード");
    expect(current()).toMatchObject({ in: TRANSITION_TYPE.fade, out: TRANSITION_TYPE.fade });
  });

  // ⚠️ **4つとも見る**＝1つだけ見ると、他の向きの綴りを壊しても緑のまま（代表だけの検査）。
  it.each([
    ["スライド（左へ）", "left"],
    ["スライド（右へ）", "right"],
    ["スライド（上へ）", "up"],
    ["スライド（下へ）", "down"],
  ])("スライドは向きも入る（%s）", (name, direction) => {
    setup();
    pick(name);
    expect(current()).toMatchObject({ in: TRANSITION_TYPE.slide, out: TRANSITION_TYPE.slide, direction });
  });

  it("いま選んでいる効果に印が付く", () => {
    setup();
    pick("フェード");
    expect(tiles().getByRole("button", { name: "フェード" }).getAttribute("aria-current")).toBe("true");
    expect(tiles().getByRole("button", { name: "なし" }).getAttribute("aria-current")).toBeNull();
  });

  // ⚠️ **注釈を読ませない**＝選んだらその場で見せる（別のボタンを探させない）。
  it("選ぶと、その場で切り替えの再生が始まる", () => {
    setup();
    // 「なし」の間は再生の入口も出ない（再生するものが無い）。
    expect(screen.queryByRole("button", { name: /切り替えを見る/ }), "「なし」なのに再生の入口がある").toBeNull();
    pick("フェード");
    expect(screen.queryByRole("button", { name: /停止/ }), "選んでも再生が始まっていない").toBeTruthy();
  });

  // ⚠️ **押しても何も起きない再生をしない**＝「なし」は切り替えが無い。
  it("「なし」を選んだときは再生しない", () => {
    setup();
    pick("フェード");
    fireEvent.click(screen.getByRole("button", { name: /停止/ }));
    pick("なし");
    expect(screen.queryByRole("button", { name: /停止/ }), "「なし」なのに再生している").toBeNull();
  });

  // ⚠️ **押していないのに動く、を作らない**＝場面を選び直しただけでは再生しない。
  it("場面を選び直しただけでは再生しない", () => {
    const scenes = [
      scene("scene_001", 1),
      scene("scene_002", 2, { transition: { in: "fade", out: "fade", durationSec: 0.5 } } as Partial<Scene>),
    ];
    const { container } = setup("scene_001", scenes);
    const card = [...container.querySelectorAll(".scene-card")][1] as HTMLElement;
    fireEvent.click(card);
    expect(screen.queryByRole("button", { name: /停止/ }), "選び直しただけで再生している").toBeNull();
  });

  // ⚠️ **同じものを選び直しても取り消せるものを積まない**（ADR-0032「何も変わらない操作は積まない」）。
  it("同じ効果を選び直しても、取り消せるものは積まらない", () => {
    setup();
    pick("フェード");
    const before = useProjectStore.getState().past.length;
    pick("フェード");
    expect(useProjectStore.getState().past.length, "同じものを選び直して履歴が増えた").toBe(before);
  });

  // ⚠️ **存在しない選択肢について語らない**＝最初の場面には前からの切り替えが無い。
  it("最初の場面ではタイルを出さず、理由を出す", () => {
    const { container } = setup("scene_001");
    expect(screen.queryByRole("group", { name: "画面の切り替え" }), "最初の場面なのにタイルが出ている").toBeNull();
    expect(container.textContent).toContain("最初の場面のため、前からの切り替えはありません");
  });

  // ⚠️ **注釈が消えたこと**も固定する（この PR の目的そのもの）。
  it("「上の『切り替えを見る』で確認」という注釈は出さない", () => {
    const { container } = setup();
    expect(container.textContent).not.toContain("切り替えを見る」で");
  });
});
