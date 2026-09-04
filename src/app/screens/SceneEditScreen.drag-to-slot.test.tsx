// @vitest-environment jsdom
// 素材を**掴んでプレビューの差し込み口へ落とす**（#1030 ②・ADR-0034 決定2＝二重導線）。
//
// ⚠️ **押す道は残っている**（#1030 ①）＝**ドラッグでしかできない操作は作らない**（決定19）。
// ⚠️ **`elementFromPoint` は jsdom が実装していない**ので、当たり判定の相手を差し替える。
//    ここで確かめられるのは「**指の下にある差し込み口へ入れる／外なら何もしない**」までで、
//    **枠が見えている位置と一致しているか**は実機（本文の未検証）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useProjectStore } from "../store/projectStore";
import type { Scene } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";
import { SceneEditScreen } from "./SceneEditScreen";

const template = {
  schemaVersion: "1.0", templateId: "tmpl_a", name: "本文", category: "body", aspectRatio: "16:9",
  canvas: { width: 1920, height: 1080 }, defaults: { backgroundColor: "#ffffff" },
  layers: [
    { id: "main", type: "slot", slotType: "image", x: 0, y: 0, w: 640, h: 1080, zIndex: 1 },
    { id: "sub", type: "slot", slotType: "video", x: 640, y: 0, w: 640, h: 1080, zIndex: 2 },
    // 写真が入る**2つ目**の口。これが無いと「指した口へ入る」と「押したときの口へ入る」が
    // 同じ結果になり、取り違えを検査できない（変異チェックで生き残った）。
    { id: "extra", type: "slot", slotType: "image", x: 1280, y: 0, w: 640, h: 1080, zIndex: 3 },
  ],
} as unknown as Template;

const scene = (assetRefs: Record<string, string> = {}): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "body", templateId: "tmpl_a",
    durationSec: 8, assetRefs, character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" }, warnings: [],
  }) as unknown as Scene;

const asset = (assetId: string, displayName: string, assetType = "image") =>
  ({ assetId, assetType, displayName, filePath: `${assetId}.png` }) as never;

function setup(assetRefs: Record<string, string> = {}) {
  useProjectStore.setState({
    templates: [template],
    parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
    scenes: [scene(assetRefs)],
    assets: [asset("asset_001", "外観"), asset("asset_002", "紹介動画", "video")],
    editingSceneId: "scene_001",
    past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
  });
}

/**
 * 指の下にある差し込み口を差し替える（`null`＝どの口でもない場所）。
 *
 * ⚠️ **jsdom は `elementFromPoint` を持っていない**ので `vi.spyOn` では差し替えられない
 * （「そんな property は無い」で落ちる）。**自分で生やす**。
 */
function pointAt(layerId: string | null) {
  (document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint = () =>
    layerId ? document.querySelector(`[data-slot-drop="${layerId}"]`) : null;
}

const tile = (name: string) => screen.getByRole("button", { name: new RegExp(name) });
const refs = () => useProjectStore.getState().scenes[0].assetRefs;
const down = (el: HTMLElement) => fireEvent.pointerDown(el, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
const move = (x = 200, y = 200) => fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: x, clientY: y });
const up = (x = 200, y = 200) => fireEvent.pointerUp(window, { pointerId: 1, clientX: x, clientY: y });

beforeEach(() => {
  vi.restoreAllMocks();
  setup();
});

describe("掴んで差し込み口へ落とす（#1030 ②）", () => {
  it("落とし先の目印は、掴んでいる間だけ出る", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(document.querySelector("[data-slot-drop]"), "掴む前から出ている").toBeNull();
    pointAt(null);
    down(tile("外観"));
    move();
    expect(document.querySelectorAll("[data-slot-drop]").length, "掴んでいるのに出ない").toBe(3);
    up();
    expect(document.querySelector("[data-slot-drop]"), "離しても出たまま").toBeNull();
  });

  it("差し込み口の上で離すと、その口へ入る（押したときの「空いている先頭」ではない）", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    pointAt(null);
    down(tile("外観"));
    move();
    pointAt("main");
    up();
    expect(refs().main).toBe("asset_001");
  });

  // ⚠️ **寄せない**（ADR-0034 決定10）＝置けない所で離したら**元へ戻す**（勝手に近い口へ入れない）。
  it("差し込み口の外で離したら何もしない", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    pointAt(null);
    down(tile("外観"));
    move();
    up();
    expect(refs()).toEqual({});
  });

  // ⚠️ **入れられない口へ落としても、黙って別の口へ入れない**。
  it("写真を「動画だけの差し込み口」へ落としても何もしない", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    pointAt(null);
    down(tile("外観"));
    move();
    pointAt("sub"); // sub は slotType: video
    up();
    expect(refs()).toEqual({});
  });

  // ⚠️ **入っている口へ落としたら、入れ替える前に確認**（押す道と同じ扱い）。
  it("入っている口へ落とすと、入れ替える前に確認を出す", () => {
    setup({ main: "asset_001" });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    pointAt(null);
    down(tile("外観"));
    move();
    pointAt("main");
    up();
    expect(refs().main, "確認の前に入れ替えている").toBe("asset_001");
    expect(screen.getByText(/入れ替えますか/)).toBeInTheDocument();
  });

  // ⚠️ **落とし先は「指した口」**＝押したときに選ばれる口（空いている先頭＝`main`）ではない。
  it("押したときの口ではなく、指した口へ入る", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    pointAt(null);
    down(tile("外観"));
    move();
    pointAt("extra"); // 空いている先頭は `main`。指したのは `extra`。
    up();
    expect(refs().extra, "指した口へ入っていない").toBe("asset_001");
    expect(refs().main, "押したときの口へ入っている").toBeUndefined();
  });

  // ⚠️ **掴まずに離した＝押しただけ**＝押す道（`onClick`）が受ける（二重に入らない）。
  it("動かさずに離したら、指の下の口ではなく押す道が受ける", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    // 指の下は `extra`（＝落としていれば `extra` へ入る）だが、**動かしていない**ので落ちない。
    pointAt("extra");
    const t = tile("外観");
    down(t);
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 10 });
    expect(refs(), "掴んでいないのに落ちた").toEqual({});
    fireEvent.click(t);
    expect(refs().main, "押す道が受けていない").toBe("asset_001");
  });

  it("入れられない素材は掴めない", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    pointAt(null);
    down(tile("紹介動画")); // 動画は sub（動画だけの口）に入るので掴める
    move();
    expect(document.querySelectorAll("[data-slot-drop]").length).toBe(3);
  });
});
