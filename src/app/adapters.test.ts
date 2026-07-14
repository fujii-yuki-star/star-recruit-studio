import { describe, expect, it } from "vitest";
import type { Asset, ElementAnimation, Scene } from "../domain/project/types";
import type { Template } from "../domain/template/types";
import { buildPrecheckItems, sceneToDraftRow } from "./adapters";

const freeTemplate: Template = {
  schemaVersion: "1.0",
  templateId: "free_canvas_v1",
  name: "自由配置",
  category: "free",
  aspectRatio: "16:9",
  canvas: { width: 1920, height: 1080 },
  defaults: { backgroundColor: "#ffffff" },
  layers: [{ id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 }],
};

const assets: Asset[] = [
  { assetId: "asset_001", assetType: "image", displayName: "写真A", filePath: "a.png" },
];

function freeScene(freeLayout: Scene["freeLayout"]): Scene {
  return {
    sceneId: "scene_001",
    partId: "part_001",
    order: 1,
    sceneType: "free",
    templateId: "free_canvas_v1",
    durationSec: 8,
    assetRefs: {},
    character: { enabled: false, characterId: "yuko" },
    texts: {},
    narration: { text: "", status: "generated" },
    warnings: [],
    freeLayout,
  };
}

describe("buildPrecheckItems（自由配置 / ADR-0008 §8 結線）", () => {
  it("FREE 場面が無いプロジェクトでは自由配置の項目を出さない", () => {
    const items = buildPrecheckItems([freeScene(undefined)], assets, [freeTemplate]);
    expect(items.find((i) => i.id === "freeLayout")).toBeUndefined();
  });

  it("freeLayout が空配列でも自由配置の項目を出さない（要素ゼロは対象外）", () => {
    const items = buildPrecheckItems([freeScene([])], assets, [freeTemplate]);
    expect(items.find((i) => i.id === "freeLayout")).toBeUndefined();
  });

  it("問題のある freeLayout（画面外）があると自由配置の項目が warning になる", () => {
    const scene = freeScene([
      { id: "free_001", kind: "shape", x: 3000, y: 0, w: 100, h: 100, shapeType: "rect" },
    ]);
    const item = buildPrecheckItems([scene], assets, [freeTemplate]).find((i) => i.id === "freeLayout");
    expect(item?.severity).toBe("warning");
  });

  it("問題のない freeLayout だけなら自由配置の項目は ok", () => {
    const scene = freeScene([
      { id: "free_001", kind: "slot", x: 100, y: 100, w: 800, h: 600, assetId: "asset_001", fit: "cover" },
    ]);
    const item = buildPrecheckItems([scene], assets, [freeTemplate]).find((i) => i.id === "freeLayout");
    expect(item?.severity).toBe("ok");
  });

  it("freeLayout 経由で使う素材は『使っていない素材』に数えない", () => {
    const scene = freeScene([
      { id: "free_001", kind: "slot", x: 100, y: 100, w: 800, h: 600, assetId: "asset_001", fit: "cover" },
    ]);
    const unused = buildPrecheckItems([scene], assets, [freeTemplate]).find((i) => i.id === "unused");
    expect(unused?.severity).toBe("ok"); // asset_001 は freeLayout で使用済み
  });
});

describe("buildPrecheckItems（通常テンプレへ戻した休眠 freeLayout・ADR-0030・#524 P2）", () => {
  const normalTemplate: Template = {
    schemaVersion: "1.0", templateId: "opening_v1", name: "オープニング", category: "opening",
    aspectRatio: "16:9", canvas: { width: 1920, height: 1080 },
    layers: [{ id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 }],
  };
  // FREE→通常へ戻して休眠している freeLayout（描画されない）を持つ通常場面。素材参照は freeLayout のみ。
  const dormant: Scene["freeLayout"] = [
    { id: "free_001", kind: "slot", x: 100, y: 100, w: 800, h: 600, assetId: "asset_001", fit: "cover" },
  ];
  const normalWithDormant = (): Scene => ({ ...freeScene(dormant), sceneType: "opening", templateId: "opening_v1" });

  it("通常場面に残った休眠 freeLayout は「自由配置の確認」の対象にしない", () => {
    const items = buildPrecheckItems([normalWithDormant()], assets, [normalTemplate]);
    expect(items.find((i) => i.id === "freeLayout")).toBeUndefined();
  });

  it("休眠 freeLayout の素材は「使用中」に数えない（通常場面は assetRefs が実効＝未使用扱い）", () => {
    const unused = buildPrecheckItems([normalWithDormant()], assets, [normalTemplate]).find((i) => i.id === "unused");
    expect(unused?.severity).toBe("warning"); // asset_001 は描画されない＝未使用
  });

  it("同じ freeLayout でも FREE 場面なら従来どおり検査・使用中カウント（休眠ゲートは通常場面のみ）", () => {
    const items = buildPrecheckItems([freeScene(dormant)], assets, [freeTemplate]);
    expect(items.find((i) => i.id === "freeLayout")?.severity).toBe("ok");
    expect(items.find((i) => i.id === "unused")?.severity).toBe("ok"); // asset_001 使用中
  });
});

describe("buildPrecheckItems（動画の配置 / #434・ADR-0026）", () => {
  const videoAsset: Asset = { assetId: "asset_v", assetType: "video", displayName: "動画", filePath: "assets/v.mp4" };

  it("動画スロットを非表示にした場面（配置できない）は『動画の配置』が要対応で場面つき", () => {
    // 非表示スロット＝findVideoSlots は返すが layoutScene に出ず＝分割失敗＝黙って静止画化してはいけない状態。
    const scene = freeScene([
      { id: "slot_1", kind: "slot", x: 100, y: 100, w: 800, h: 600, assetId: "asset_v", fit: "cover", hidden: true },
    ] as unknown as Scene["freeLayout"]);
    const item = buildPrecheckItems([scene], [...assets, videoAsset], [freeTemplate]).find((i) => i.id === "videoPlacement");
    expect(item?.severity).toBe("action");
    expect(item?.detail).toContain("場面1");
  });

  it("配置できる動画スロットなら『動画の配置』項目は出さない（ノイズ回避）", () => {
    const scene = freeScene([
      { id: "slot_1", kind: "slot", x: 100, y: 100, w: 800, h: 600, assetId: "asset_v", fit: "cover" },
    ]);
    const item = buildPrecheckItems([scene], [...assets, videoAsset], [freeTemplate]).find((i) => i.id === "videoPlacement");
    expect(item).toBeUndefined();
  });
});

describe("buildPrecheckItems（場面の見た目 / テンプレ未解決・Codex 監査 2026-07-13・#434 同流儀）", () => {
  it("見た目（テンプレ）が見つからない場面は『場面の見た目』が要対応で場面つき＋該当場面へ飛ぶ", () => {
    // templateId が templates に無い＝ダングリング（利用者テンプレ削除等）。黙って書き出しから落とさず場面つきで警告する。
    const scene = { ...freeScene(undefined), sceneId: "sX", templateId: "missing" } as Scene;
    const item = buildPrecheckItems([scene], assets, [freeTemplate]).find((i) => i.id === "sceneTemplate");
    expect(item?.severity).toBe("action");
    expect(item?.detail).toContain("場面1");
    expect(item?.action).toBe("直す"); // 「直す」ボタンが出る条件＝action の有無（画面遷移の受け入れ条件をデータ層で固定）
    expect(item?.sceneId).toBe("sX"); // 該当場面へ戻れる導線（#400）
  });

  it("見た目が解決できる場面だけなら『場面の見た目』項目は出さない（ノイズ回避）", () => {
    const item = buildPrecheckItems([freeScene(undefined)], assets, [freeTemplate]).find((i) => i.id === "sceneTemplate");
    expect(item).toBeUndefined();
  });
});

describe("buildPrecheckItems（動画の再生タイミング / #444・ADR-0027 D3）", () => {
  const videoAsset: Asset = { assetId: "asset_v", assetType: "video", displayName: "動画", filePath: "assets/v.mp4" };
  const slotEl = [{ id: "slot_1", kind: "slot", x: 100, y: 100, w: 800, h: 600, assetId: "asset_v", fit: "cover" }] as unknown as Scene["freeLayout"];
  // slot_1 を animEnd 秒まで動かすアニメ（freeScene の durationSec=8）。
  const anim = (endSec: number): ElementAnimation[] =>
    [{ id: "a", sceneId: "scene_001", targetId: "slot_1", keyframes: [{ timeSec: 0, x: -100 }, { timeSec: endSec, x: 0 }] }] as unknown as ElementAnimation[];
  const afterAnimScene = { ...freeScene(slotEl), slotVideoStart: { slot_1: { mode: "afterAnim" } } } as unknown as Scene;

  it("afterAnim × アニメが場面尺いっぱい（settled 無し）は『動画の再生タイミング』が要対応で場面つき", () => {
    // animEnd=8 >= 尺8 → settled 無し＝afterAnim だと動画が一度も再生されない。
    const item = buildPrecheckItems([afterAnimScene], [...assets, videoAsset], [freeTemplate], anim(8)).find((i) => i.id === "videoStartAfterAnim");
    expect(item?.severity).toBe("action");
    expect(item?.detail).toContain("場面1");
  });

  it("settled が残る（animEnd<尺）なら『動画の再生タイミング』項目は出さない（ノイズ回避）", () => {
    const item = buildPrecheckItems([afterAnimScene], [...assets, videoAsset], [freeTemplate], anim(2)).find((i) => i.id === "videoStartAfterAnim");
    expect(item).toBeUndefined();
  });
});

describe("buildPrecheckItems（#400・項目 action が該当場面へ飛ぶ sceneId）", () => {
  const videoAsset: Asset = { assetId: "asset_v", assetType: "video", displayName: "動画", filePath: "assets/v.mp4" };
  const scn = (id: string, over: Partial<Scene> = {}): Scene => ({ ...freeScene([]), sceneId: id, ...over });

  it("声が無い項目は最初の該当場面 id を持つ（場面1固定でない）", () => {
    // 本文がある未生成場面のみ対象（sceneNeedsVoice＝本文空は「声不要」）。
    const a = scn("a", { narration: { text: "セリフ", status: "generated" } });
    const b = scn("b", { narration: { text: "セリフ", status: "none" } });
    const voice = buildPrecheckItems([a, b], assets, [freeTemplate]).find((i) => i.id === "voice");
    expect(voice?.severity).toBe("action");
    expect(voice?.sceneId).toBe("b"); // 2つ目が最初の該当
  });

  it("字幕が長い項目は最初の該当場面 id を持つ（action で飛べる項目）", () => {
    const a = scn("a", { texts: { subtitle: "短い字幕" } });
    const b = scn("b", { texts: { subtitle: "あ".repeat(61) } }); // > 既定60字
    const sub = buildPrecheckItems([a, b], assets, [freeTemplate]).find((i) => i.id === "subtitle");
    expect(sub?.severity).toBe("action");
    expect(sub?.sceneId).toBe("b");
  });

  it("掛け合い場面：全行生成済みなら声チェックは ok（narration.status を見ない・#403 P1）", () => {
    const dlg = scn("d", {
      narration: { text: "", status: "none" }, // narration.status は none のまま（掛け合いは更新されない）
      lines: [
        { lineId: "line_001", text: "やあ", status: "generated" },
        { lineId: "line_002", text: "こんにちは", status: "generated" },
      ],
    } as Partial<Scene>);
    const voice = buildPrecheckItems([dlg], assets, [freeTemplate]).find((i) => i.id === "voice");
    expect(voice?.severity).toBe("ok"); // 全行生成済み＝声OK（従来は narration.status=none で要対応のまま残った）
  });

  it("掛け合い場面：未生成行があれば声チェックは要対応で該当場面", () => {
    const dlg = scn("d", {
      narration: { text: "", status: "none" },
      lines: [
        { lineId: "line_001", text: "やあ", status: "generated" },
        { lineId: "line_002", text: "まだ", status: "none" },
      ],
    } as Partial<Scene>);
    const voice = buildPrecheckItems([dlg], assets, [freeTemplate]).find((i) => i.id === "voice");
    expect(voice?.severity).toBe("action");
    expect(voice?.sceneId).toBe("d");
  });

  it("内容に該当場面の番号を列挙する（どの場面か示す・#403）", () => {
    const a = scn("a", { narration: { text: "x", status: "generated" } });
    const b = scn("b", { narration: { text: "x", status: "none" } });
    const c = scn("c", { narration: { text: "x", status: "none" } });
    const voice = buildPrecheckItems([a, b, c], assets, [freeTemplate]).find((i) => i.id === "voice");
    expect(voice?.detail).toContain("場面2・3"); // 2つ目・3つ目
  });

  it("該当場面が多いときは先頭8件＋「ほかN件」に丸める", () => {
    const scenes = Array.from({ length: 10 }, (_, i) => scn(`s${i}`, { narration: { text: "x", status: "none" } }));
    const voice = buildPrecheckItems(scenes, assets, [freeTemplate]).find((i) => i.id === "voice");
    expect(voice?.detail).toContain("ほか2件"); // 10件 → 先頭8＋ほか2
  });

  it("問題が無い（ok）項目は sceneId を持たない", () => {
    const a = scn("a", { narration: { text: "", status: "generated" } });
    const voice = buildPrecheckItems([a], assets, [freeTemplate]).find((i) => i.id === "voice");
    expect(voice?.severity).toBe("ok");
    expect(voice?.sceneId).toBeUndefined();
  });

  it("動画の配置は最初の配置不能場面 id を持つ", () => {
    const ok = freeScene([{ id: "slot_1", kind: "slot", x: 0, y: 0, w: 100, h: 100, assetId: "asset_v", fit: "cover" }]);
    const bad = { ...freeScene([{ id: "slot_1", kind: "slot", x: 0, y: 0, w: 100, h: 100, assetId: "asset_v", fit: "cover", hidden: true } as unknown as NonNullable<Scene["freeLayout"]>[number]]), sceneId: "bad" } as Scene;
    const item = buildPrecheckItems([{ ...ok, sceneId: "ok1" } as Scene, bad], [...assets, videoAsset], [freeTemplate]).find((i) => i.id === "videoPlacement");
    expect(item?.sceneId).toBe("bad");
  });
});

describe("sceneToDraftRow（見た目バッジの §2-3 フォールバック・#387）", () => {
  it("見た目パターンが見つかればその名前を出す", () => {
    expect(sceneToDraftRow(freeScene(undefined), [], [freeTemplate], []).look).toBe("自由配置");
  });

  it("見つからない場合は内部ID（tmpl_*）を出さず日本語定型に落とす", () => {
    const row = sceneToDraftRow(freeScene(undefined), [], [], []); // templates 空＝解決不能
    expect(row.look).toBe("見た目が見つかりません");
    expect(row.look).not.toContain("free_canvas_v1"); // 内部IDが UI に漏れない（§2-3）
  });
});
