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
  // ⚠️ **実物と同じ形**（PR #1041/#1042 レビュー 🔴）＝背景が配列の先頭・主役は `mainVisual`。
  //   背景が無いと「背景へは落とせない」抜けが検査に出ない。
  layers: [
    { id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 },
    { id: "mainVisual", type: "slot", slotType: "image", x: 0, y: 0, w: 640, h: 1080, zIndex: 10 },
    { id: "sub", type: "slot", slotType: "video", x: 640, y: 0, w: 640, h: 1080, zIndex: 11 },
    // 写真が入る**2つ目**の口。これが無いと「指した口へ入る」と「押したときの口へ入る」が
    // 同じ結果になり、取り違えを検査できない（変異チェックで生き残った）。
    { id: "extra", type: "slot", slotType: "image", x: 1280, y: 0, w: 640, h: 1080, zIndex: 12 },
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
  for (const g of document.querySelectorAll("[data-ghost]")) g.remove();
  (document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint = () => {
    if (!layerId) return null;
    const shown = document.querySelector(`[data-slot-drop="${layerId}"]`);
    if (shown) return shown;
    // ⚠️ **出ていない枠を指した状態も作れるようにする**＝落とした先の可否を受け側でも見ているか
    //   を確かめるため（枠を出す側でしか見ていないと、枠の出し方を変えた瞬間に穴が空く）。
    const ghost = document.createElement("div");
    ghost.dataset.slotDrop = layerId;
    ghost.dataset.ghost = "1"; // 数える検査に混ざらないよう、次に指したときと片づけで消す
    document.body.appendChild(ghost);
    return ghost;
  };
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
    expect(document.querySelectorAll("[data-slot-drop]").length, "掴んでいるのに出ない").toBe(3); // 写真＝背景・主役・extra
    up();
    expect(document.querySelector("[data-slot-drop]"), "離しても出たまま").toBeNull();
  });

  it("差し込み口の上で離すと、その口へ入る（押したときの「空いている先頭」ではない）", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    pointAt(null);
    down(tile("外観"));
    move();
    pointAt("mainVisual");
    up();
    expect(refs().mainVisual).toBe("asset_001");
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

  // ⚠️ **入れられない口へ落としても、黙って別の口へ入れない**（枠を出す側だけでなく**受け側でも**見る）。
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
    setup({ mainVisual: "asset_001" });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    pointAt(null);
    down(tile("外観"));
    move();
    pointAt("mainVisual");
    up();
    expect(refs().mainVisual, "確認の前に入れ替えている").toBe("asset_001");
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
    expect(refs().mainVisual, "押したときの口へ入っている").toBeUndefined();
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
    expect(refs().mainVisual, "押す道が受けていない").toBe("asset_001");
  });

  // ⚠️ **入れられる口だけを出す**（PR #1042 レビュー 🔴）＝入らない口の枠を出すと
  //   「落とせそうに見えて何も起きない」。
  it("枠は、掴んでいる素材が入れられる口だけ出る", () => {
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    pointAt(null);
    down(tile("紹介動画")); // 動画＝背景（種別を決めていない）と sub（動画だけ）の2つ
    move();
    const ids = [...document.querySelectorAll("[data-slot-drop]")].map((e) => (e as HTMLElement).dataset.slotDrop);
    expect(ids.sort()).toEqual(["background", "sub"]);
  });

  // ⚠️ **空のロゴは `layoutScene` が何も置かない**＝箱が取れないからと落とし先から外すと、
  //   「押せば入るのに掴んで落とせない」になる（層の箱で補う）。
  it("まだ何も入っていないロゴの口へも落とせる", () => {
    const withLogo = {
      ...template,
      templateId: "tmpl_logo",
      layers: [...template.layers, { id: "logo", type: "logo", x: 1700, y: 40, w: 180, h: 90, zIndex: 20 }],
    } as unknown as Template;
    useProjectStore.setState({ templates: [withLogo], scenes: [{ ...scene(), templateId: "tmpl_logo" } as Scene] });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    pointAt(null);
    down(tile("外観"));
    move();
    expect(
      document.querySelector('[data-slot-drop="logo"]'),
      "空のロゴの枠が出ない（描かれないので箱が取れない）",
    ).not.toBeNull();
    pointAt("logo");
    up();
    expect(refs().logo).toBe("asset_001");
  });

  // ⚠️ **背景しか無い見た目もある**（`opening_yuko_right_v1`）＝そこで枠が1つも出ないと、
  //   「押せば入るのに掴んで落とせない」になる（PR #1042 レビュー 🔴）。
  it("背景だけの見た目でも、背景へ落とせる", () => {
    const bgOnly = { ...template, templateId: "tmpl_bg", layers: [template.layers[0]] } as unknown as Template;
    useProjectStore.setState({ templates: [bgOnly], scenes: [{ ...scene(), templateId: "tmpl_bg" } as Scene] });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    pointAt(null);
    down(tile("外観"));
    move();
    expect(document.querySelectorAll("[data-slot-drop]").length, "枠が1つも出ない").toBe(1);
    pointAt("background");
    up();
    expect(refs().background).toBe("asset_001");
  });
});
