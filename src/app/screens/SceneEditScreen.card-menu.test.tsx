// @vitest-environment jsdom
//
// 場面カードの右クリックメニュー（#772 候補6）。
//
// ⚠️ **複製・削除が「欄の外」にあった**＝別の欄の最下部にあり、カードを選んでから探しに行くことになる
//（#768 が列で解いたのと同じ形）。カードの上で完結させる。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import type { Scene } from "../../domain/project/types";
import { SceneEditScreen } from "./SceneEditScreen";

const scene = (id: string, order: number): Scene =>
  ({
    sceneId: id, partId: "part_001", order, sceneType: "opening", templateId: "opening_yuko_right_v1",
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" }, warnings: [],
  }) as unknown as Scene;

describe("SceneEditScreen 場面カードの右クリック（#772 候補6）", () => {
  const removeScene = vi.fn();
  const duplicateScene = vi.fn(() => "scene_009");

  beforeEach(() => {
    removeScene.mockClear();
    duplicateScene.mockClear();
    useProjectStore.setState({
      scenes: [scene("scene_001", 1), scene("scene_002", 2)],
      parts: [{ partId: "part_001", title: "本編", order: 1, sceneIds: ["scene_001", "scene_002"] }],
      assets: [], editingSceneId: "scene_001",
      past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
      removeScene, duplicateScene,
    });
  });

  const cards = (): HTMLElement[] => [...document.querySelectorAll(".scene-card")] as HTMLElement[];
  /**
   * ⚠️ **メニューの中だけを見る**＝同じ文言のボタンが**欄の側にもある**（複製・削除は両方に置く＝
   * 右クリックを知らない人の道を塞がない）。画面全体から探すと、**欄の側を掴んで**メニューの
   * 出来を確かめられない（実際それで「押せるはず」の判定に化けた）。
   */
  const menuItem = (name: string): HTMLElement =>
    within(document.querySelector('[role="menu"]') as HTMLElement).getByRole("menuitem", { name });

  it("カードを右クリックするとメニューが出て、複製できる", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(cards()[0], { clientX: 10, clientY: 10 });
    fireEvent.click(menuItem("この場面を複製"));
    expect(duplicateScene).toHaveBeenCalledWith("scene_001");
  });

  /**
   * ⚠️ **右クリックしたカードを「選んでから」開く**＝別のカードを右クリックしたのに、
   * 選択中のカードに効く、を作らない。
   *
   * ⚠️ **このテストは「対象の取り違え」を単独では捕まえられない**（変異チェックで確認）＝
   * 右クリックが選択も動かすので、`sceneMenu.sceneId` と `selected.sceneId` は**同じ値になる**。
   * つまり実装をどちらで書いても緑になる。ここで固定しているのは
   * **「右クリックしたカードが選ばれ、そのカードに効く」という一連の挙動**であって、
   * 実装がどちらの変数を読むかではない（実装は `sceneMenu.sceneId` を読む＝将来
   * 「右クリックで選択しない」に変えても壊れない側）。
   */
  it("右クリックしたカードが選ばれ、そのカードに効く", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(cards()[1], { clientX: 10, clientY: 10 });
    expect(cards()[1].className).toContain("selected"); // 右クリックで選ばれた
    fireEvent.click(menuItem("この場面を複製"));
    expect(duplicateScene).toHaveBeenCalledWith("scene_002");
  });

  // ⚠️ **削除は確認を挟む**（`06 §2-1`）＝メニューからだけ確認なしで消えると、同じ操作で挙動が割れる
  //（ADR-0026②）。確認は**メニューと同じ重なり**に出す＝欄を閉じていても見える。
  it("削除は確認を挟む（押しただけでは消えない）", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(cards()[0], { clientX: 10, clientY: 10 });
    fireEvent.click(menuItem("この場面を削除"));
    expect(removeScene).not.toHaveBeenCalled(); // まだ消えない
    expect(screen.getByText("この場面を削除しますか？")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "削除する" }));
    expect(removeScene).toHaveBeenCalledWith("scene_001");
  });

  it("確認をやめれば消えない", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(cards()[0], { clientX: 10, clientY: 10 });
    fireEvent.click(menuItem("この場面を削除"));
    fireEvent.click(screen.getByRole("button", { name: "やめる" }));
    expect(removeScene).not.toHaveBeenCalled();
    expect(screen.queryByText("この場面を削除しますか？")).toBeNull();
  });

  /**
   * ⚠️ **最後の1つは消せない**＝`scenes: []` になると選択の解決（`scenes[0]`）が `undefined` になり、
   * その後の参照で落ちる。押せなくするだけでなく**理由を添える**（§2-5）。
   *
   * ⚠️ **両方の経路を見る**（PR #868 レビュー 🔴）＝最初はメニュー側だけにガードを入れ、
   * コメントには「欄の側と同じ条件」と書いていたが**欄の側には無かった**（ADR-0026② を掲げた
   * PR 自身が原則を破っていた）。**メニュー側だけのテストでは、この割れを検出できない。**
   */
  it("場面が1つだけのときは**欄の側も**削除を押せず、理由が出る", () => {
    useProjectStore.setState({
      scenes: [scene("scene_001", 1)],
      parts: [{ partId: "part_001", title: "本編", order: 1, sceneIds: ["scene_001"] }],
    });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    const panelDelete = screen.getByRole("button", { name: "この場面を削除" });
    expect(panelDelete).toBeDisabled();
    expect(panelDelete.getAttribute("title")).toContain("最後の1つ");
  });

  it("場面が1つだけのときは削除を押せず、理由が出る", () => {
    useProjectStore.setState({
      scenes: [scene("scene_001", 1)],
      parts: [{ partId: "part_001", title: "本編", order: 1, sceneIds: ["scene_001"] }],
    });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(cards()[0], { clientX: 10, clientY: 10 });
    const del = menuItem("この場面を削除");
    expect(del).toBeDisabled();
    expect(del.getAttribute("title")).toContain("最後の1つ");
  });
});
