// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import type { Scene } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";
import { SceneEditScreen } from "./SceneEditScreen";

// #550：右パネルの既定表示量を絞る。実測（実ブラウザ・画面高720px）＝
//   通常テンプレ 2518px（3.5画面）→ 1654px（2.3画面）／FREE 要素5つ 5419px（7.5画面）→ 2070px（2.9画面）。
// ①二次的な節を既定で畳む ②FREE は選択要素のカードだけ ③開閉を覚える（画面を往復しても開き直さない）。
const freeTemplate = {
  schemaVersion: "1.0", templateId: "free_canvas_v1", name: "自由配置", category: "free", aspectRatio: "16:9",
  canvas: { width: 1920, height: 1080 }, defaults: { backgroundColor: "#ffffff" },
  layers: [{ id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 }],
} as unknown as Template;
const openingTemplate = {
  schemaVersion: "1.0", templateId: "opening_yuko_right_v1", name: "オープニング", category: "opening", aspectRatio: "16:9",
  canvas: { width: 1920, height: 1080 }, defaults: { backgroundColor: "#ffffff" },
  layers: [
    { id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 },
    { id: "title", type: "text", textKey: "title", x: 160, y: 360, w: 1100, h: 140, zIndex: 30, fontSize: 72 },
  ],
} as unknown as Template;

const scene = (over: Partial<Scene> = {}): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "opening", templateId: "opening_yuko_right_v1",
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: { title: "見出し" },
    narration: { text: "", status: "none" }, warnings: [], ...over,
  }) as unknown as Scene;

const freeScene = (): Scene =>
  scene({
    sceneType: "free", templateId: "free_canvas_v1",
    freeLayout: [
      { id: "free_001", kind: "shape", x: 0, y: 0, w: 100, h: 100, zIndex: 1 },
      { id: "free_002", kind: "shape", x: 200, y: 0, w: 100, h: 100, zIndex: 2 },
      { id: "free_003", kind: "shape", x: 400, y: 0, w: 100, h: 100, zIndex: 3 },
    ],
  } as Partial<Scene>);

const setup = (s: Scene = scene(), t: Template = openingTemplate) => {
  useProjectStore.setState({
    templates: [t, openingTemplate, freeTemplate],
    parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
    scenes: [s], assets: [], editingSceneId: "scene_001",
    past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
  });
  return render(<SceneEditScreen onNavigate={vi.fn()} />);
};

const section = (title: string): HTMLDetailsElement =>
  screen.getByText(title).closest("details") as HTMLDetailsElement;

describe("SceneEditScreen 右パネルの既定表示量（#550）", () => {
  beforeEach(() => {
    localStorage.clear();
    useProjectStore.setState({ past: [], future: [], _historyGroupDepth: 0 });
  });

  // ①：毎回いじる所（文字/掛け合い）は開き、たまにしか触らない所は畳む。
  it("主編集の節は開き、二次的な節は畳んで出す", () => {
    setup();
    expect(section("文字").open).toBe(true);
    expect(section("掛け合い・セリフ").open).toBe(true);
    expect(section("見た目・フォント").open).toBe(false);
    expect(section("使用素材").open).toBe(false);
    expect(section("表示時間").open).toBe(false);
  });

  // ②：要素カードは1枚あたり約580px で要素数に比例していた（実測）。既定で選択中の1枚だけにする。
  it("自由配置は既定で「選択した要素だけ編集」＝未選択なら要素カードを出さない", () => {
    setup(freeScene(), freeTemplate);
    expect(screen.getByRole("switch", { name: "選択した要素だけ編集" })).toHaveAttribute("aria-checked", "true");
    // 未選択のうちは案内だけ＝カード（位置/大きさの欄）は無い。
    expect(screen.getByText(/編集する要素を、上のボタンかプレビューで選んでください/)).toBeTruthy();
    expect(screen.queryByLabelText("横位置")).toBeNull();
  });

  it("要素を選ぶとその1枚だけ出る（他の要素のカードは出ない）", () => {
    setup(freeScene(), freeTemplate);
    const el = document.querySelector('[data-free-id="free_001"]') as HTMLElement;
    fireEvent.pointerDown(el, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(el, { pointerId: 1 });
    expect(screen.getAllByLabelText("横位置")).toHaveLength(1); // 3要素あるがカードは1枚
  });

  it("トグルを切れば全要素のカードが出る（自由度は残す）", () => {
    setup(freeScene(), freeTemplate);
    fireEvent.click(screen.getByRole("switch", { name: "選択した要素だけ編集" }));
    expect(screen.getAllByLabelText("横位置")).toHaveLength(3);
  });

  // ③：場面をまたぐだけなら元から保たれる（節は再マウントされない）。忘れるのは画面の往復＝再マウント。
  // details の `toggle` は**非同期**に発火する（HTML 仕様）＝保存もその後。同期のまま unmount すると
  // 保存前に画面が消えてしまうので待つ（実機では「開く」と「画面を移る」の間に必ず時間がある）。
  it("開閉を覚える＝画面を作り直しても開き直さなくてよい", async () => {
    const { unmount } = setup();
    fireEvent.click(screen.getByText("見た目・フォント")); // 開く
    expect(section("見た目・フォント").open).toBe(true);
    await waitFor(() => expect(localStorage.getItem("sceneEdit.sectionOpen")).not.toBeNull());
    unmount(); // 台本表などへ行って戻る＝画面の再マウント

    setup();
    expect(section("見た目・フォント").open).toBe(true); // 開いたまま
    expect(section("使用素材").open).toBe(false); // 触っていない節は既定のまま
  });

  it("畳んだ節も覚える", async () => {
    const { unmount } = setup();
    fireEvent.click(screen.getByText("文字")); // 既定 open を畳む
    expect(section("文字").open).toBe(false);
    await waitFor(() => expect(localStorage.getItem("sceneEdit.sectionOpen")).not.toBeNull());
    unmount();

    setup();
    expect(section("文字").open).toBe(false);
  });

  // `<details open>` は描画しただけで（非同期に）toggle を発火する。素通しで保存すると「触ってもいない節の
  // 既定値」が固定され、**将来 既定を変えても既存利用者に届かない**。触ったものだけ覚える。
  it("触っていない節は保存しない（既定を将来変えられなくならないように）", async () => {
    setup();
    // マウントしただけでは何も書かない（`<details open>` の toggle 発火を素通しにしていないこと）。
    await new Promise((r) => setTimeout(r, 0));
    expect(localStorage.getItem("sceneEdit.sectionOpen")).toBeNull();
    fireEvent.click(screen.getByText("使用素材"));
    await waitFor(() => expect(JSON.parse(localStorage.getItem("sceneEdit.sectionOpen") ?? "{}")).toEqual({ 使用素材: true }));
  });

  it("「選択した要素だけ編集」の切替も覚える（既定を変えたぶん毎回切り直す手間を作らない）", () => {
    const { unmount } = setup(freeScene(), freeTemplate);
    fireEvent.click(screen.getByRole("switch", { name: "選択した要素だけ編集" })); // OFF にする
    unmount();

    setup(freeScene(), freeTemplate);
    expect(screen.getByRole("switch", { name: "選択した要素だけ編集" })).toHaveAttribute("aria-checked", "false");
  });

  it("壊れた記憶は既定へ倒す（編集を止めない）", () => {
    localStorage.setItem("sceneEdit.sectionOpen", "{壊れた");
    setup();
    expect(section("文字").open).toBe(true);
    expect(section("使用素材").open).toBe(false);
  });
});
