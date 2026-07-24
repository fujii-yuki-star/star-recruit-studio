import { describe, expect, it } from "vitest";
import { MAX_NARRATION_LEN_DEFAULT, MAX_SUBTITLE_LEN_DEFAULT } from "../domain/constants";
import type { Asset, ElementAnimation, FreeElement, Scene } from "../domain/project/types";
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
    // FREE 場面で texts.subtitle を実表示するには字幕要素（読み上げ対象）が要る（ADR-0029・sceneDisplayedSubtitleTexts）。
    const subEl = [{ id: "free_001", kind: "subtitle", x: 0, y: 0, w: 400, h: 80, subtitleSource: { kind: "narration" } }] as unknown as Scene["freeLayout"];
    const a = scn("a", { texts: { subtitle: "短い字幕" }, freeLayout: subEl });
    const b = scn("b", { texts: { subtitle: "あ".repeat(61) }, freeLayout: subEl }); // > 既定60字
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

  // 台本表の「素材」は**動画に出る分**を示す。切替で差し込み先を失った休眠の割当（#547 P3-14 で消さずに残す）を
  // そのまま出すと、動画には映らないのに一覧では「写真あり」＝表示と実挙動がずれる（ADR-0026①）。
  it("差し込み先を失った休眠の割当は素材に出さない（実効使用と同じ規則・#547 P3-14）", () => {
    const photoTemplate = {
      ...freeTemplate, templateId: "photo_v1", name: "写真", category: "photo_intro",
      layers: [{ id: "mainVisual", type: "slot", x: 0, y: 0, w: 1920, h: 1080, zIndex: 1 }],
    } as Template;
    const textTemplate = {
      ...freeTemplate, templateId: "text_v1", name: "メッセージ", category: "message",
      layers: [{ id: "title", type: "text", textKey: "title", x: 0, y: 0, w: 1920, h: 200, zIndex: 1 }],
    } as Template;
    const scene = { ...freeScene(undefined), sceneType: "photo_intro", assetRefs: { mainVisual: "asset_001" } } as Scene;
    const shown = { ...scene, templateId: "photo_v1" } as Scene;
    const dormant = { ...scene, templateId: "text_v1", sceneType: "message" } as Scene;
    expect(sceneToDraftRow(shown, [], [photoTemplate, textTemplate], assets).material).toBe("写真A");
    expect(sceneToDraftRow(dormant, [], [photoTemplate, textTemplate], assets).material).toBe("（未設定）");
  });

  // 立ち絵（ゆうこ）は「素材」ではなく登場人物。素材欄の主役候補に混ぜると、`assetType:'yuko'` は video でないので
  // 「写真」として表情画像の名前が並ぶ（materialType の分岐は video 以外を photo にする）＝写真を入れていない場面が
  // 「写真あり」に見える。同梱の `opening_yuko_right_v1` は背景が必須でないので、ゆうこだけの場面は普通に作れる。
  it("立ち絵だけの場面は素材欄に出さない（ゆうこは写真ではない・#547 P3-14 レビュー）", () => {
    const yukoTemplate = {
      ...freeTemplate, templateId: "opening_v1", name: "オープニング", category: "opening",
      layers: [
        { id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 },
        { id: "yuko", type: "character", x: 0, y: 0, w: 500, h: 700, zIndex: 5 },
      ],
    } as Template;
    const yukoAsset = { assetId: "asset_pose", assetType: "yuko", displayName: "ゆうこ（笑顔）", filePath: "y.png" } as Asset;
    const scene = {
      ...freeScene(undefined), sceneType: "opening", templateId: "opening_v1",
      character: { enabled: true, characterId: "yuko", poseAssetId: "asset_pose" },
    } as Scene;
    const row = sceneToDraftRow(scene, [], [yukoTemplate], [...assets, yukoAsset]);
    expect(row.material).toBe("（未設定）");
    expect(row.materialType).toBe("none");
  });

  it("FREE 場面は自由配置の素材を主役にする（休眠 assetRefs ではなく実効表現・ADR-0030）", () => {
    const sc = { ...freeScene([{ id: "el1", kind: "slot", x: 0, y: 0, w: 10, h: 10, assetId: "asset_001" } as FreeElement]), assetRefs: { mainVisual: "asset_zzz" } } as Scene;
    expect(sceneToDraftRow(sc, [], [freeTemplate], assets).material).toBe("写真A");
  });
});

// #547 P1-3：字幕/セリフの「長すぎ」判定は、テンプレの aiHint が無ければ**正典定数**へ落ちる（生成側 transformPlan と
// 同じ参照元）。閾値を定数から導出して検証する＝将来 定数を変えたとき precheck と生成上限が食い違わないことを固定する
// （直書き 60/120 で検証すると、定数を変えても緑のまま＝ドリフトを見逃す）。テンプレは aiHint 無し（＝既定へ落ちる）。
describe("buildPrecheckItems（字幕/セリフの長さ閾値＝正典定数と同じ参照元・#547 P1-3）", () => {
  const normalTemplate: Template = {
    schemaVersion: "1.0", templateId: "opening_v1", name: "オープニング", category: "opening", aspectRatio: "16:9",
    canvas: { width: 1920, height: 1080 }, defaults: { backgroundColor: "#ffffff" },
    layers: [
      { id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 },
      { id: "subtitle", type: "subtitle", textKey: "subtitle", x: 0, y: 900, w: 1720, h: 80, zIndex: 10 },
    ],
  };
  const textScene = (over: Partial<Scene>): Scene => ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "opening", templateId: "opening_v1",
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "generated" }, warnings: [], ...over,
  } as Scene);
  const item = (s: Scene, id: string) => buildPrecheckItems([s], assets, [normalTemplate]).find((i) => i.id === id)!;

  it("字幕が定数ちょうどは OK・+1 で「短くする」警告", () => {
    expect(item(textScene({ texts: { subtitle: "あ".repeat(MAX_SUBTITLE_LEN_DEFAULT) } }), "subtitle").severity).toBe("ok");
    expect(item(textScene({ texts: { subtitle: "あ".repeat(MAX_SUBTITLE_LEN_DEFAULT + 1) } }), "subtitle").severity).toBe("action");
  });

  it("セリフが定数ちょうどは OK・+1 で長さ警告", () => {
    expect(item(textScene({ narration: { text: "あ".repeat(MAX_NARRATION_LEN_DEFAULT), status: "generated" } }), "line").severity).toBe("ok");
    expect(item(textScene({ narration: { text: "あ".repeat(MAX_NARRATION_LEN_DEFAULT + 1), status: "generated" } }), "line").severity).toBe("warning");
  });

  it("テンプレの aiHint があればそちらが優先（既定へ落ちない）", () => {
    const withHint: Template = { ...normalTemplate, aiHint: { maxSubtitleLength: 5 } as Template["aiHint"] };
    const s = textScene({ texts: { subtitle: "あ".repeat(6) } }); // 既定(60)未満だが hint(5) 超え
    expect(buildPrecheckItems([s], assets, [withHint]).find((i) => i.id === "subtitle")!.severity).toBe("action");
  });

  // #547 P1-3 レビュー：掛け合い（scene.lines）の**行ごとの実効字幕**（subtitleText ?? text）は precheck の
  // 字幕チェックから漏れていた（texts.subtitle しか見ていなかった）＝長い字幕を描画するのに「OK」と断言していた。
  // #569（生成側の行テキスト長の漏れ）とは別＝これは precheck 側の字幕漏れ。ADR-0015/ADR-0026②。
  const dlgLine = (over: Partial<Scene["lines"] extends (infer L)[] | undefined ? L : never>) =>
    ({ lineId: "line_001", text: "短い", status: "none", ...over }) as NonNullable<Scene["lines"]>[number];

  it("掛け合い：行の字幕(subtitleText)が定数ちょうどは OK・+1 で警告（precheck の字幕漏れ）", () => {
    const ok = textScene({ lines: [dlgLine({ subtitleText: "あ".repeat(MAX_SUBTITLE_LEN_DEFAULT) })] });
    expect(item(ok, "subtitle").severity).toBe("ok");
    const over = textScene({ lines: [dlgLine({ subtitleText: "あ".repeat(MAX_SUBTITLE_LEN_DEFAULT + 1) })] });
    expect(item(over, "subtitle").severity).toBe("action");
  });

  it("掛け合い：字幕 OFF の行は長くても対象外・ON なら警告（除外条件そのものの回帰も見る）", () => {
    const long = "あ".repeat(MAX_SUBTITLE_LEN_DEFAULT + 1);
    expect(item(textScene({ lines: [dlgLine({ subtitleText: long, subtitleEnabled: false })] }), "subtitle").severity).toBe("ok");
    expect(item(textScene({ lines: [dlgLine({ subtitleText: long, subtitleEnabled: true })] }), "subtitle").severity).toBe("action");
  });

  // 単独場面も同様に、字幕 OFF（subtitleEnabledDefault===false）なら長くても警告しない（掛け合いの OFF 除外と挙動を
  // 揃える・ADR-0026②）＝描画されない字幕を「長い」と言わない。ON（未指定/true）なら従来どおり警告する。
  it("単独：字幕 OFF は長くても対象外・ON なら警告", () => {
    const long = "あ".repeat(MAX_SUBTITLE_LEN_DEFAULT + 1);
    expect(item(textScene({ texts: { subtitle: long }, subtitleEnabledDefault: false }), "subtitle").severity).toBe("ok");
    expect(item(textScene({ texts: { subtitle: long }, subtitleEnabledDefault: true }), "subtitle").severity).toBe("action");
    expect(item(textScene({ texts: { subtitle: long } }), "subtitle").severity).toBe("action"); // 未指定＝表示（既定 ON）
  });

  it("掛け合い：subtitleText 未指定は行テキストが実効字幕＝字幕上限(60)で判定する（セリフ上限120ではない）", () => {
    // 61文字の line.text：セリフ上限(120)は OK だが、字幕として表示されるので字幕上限(60)で警告する。
    const s = textScene({ lines: [dlgLine({ text: "あ".repeat(MAX_SUBTITLE_LEN_DEFAULT + 1) })] });
    expect(item(s, "subtitle").severity).toBe("action"); // 字幕は長い
    expect(item(s, "line").severity).toBe("ok"); // セリフ(120)は範囲内
  });

  it("複数行のうち1行でも字幕が長ければ警告・全行 OK なら OK（実測の再現＝短い読み上げ+長い subtitleText）", () => {
    const bad = textScene({ lines: [
      dlgLine({ text: "やあ", subtitleText: "短い字幕" }),
      dlgLine({ lineId: "line_002", text: "こんにちは", subtitleText: "あ".repeat(MAX_SUBTITLE_LEN_DEFAULT + 1) }),
    ] });
    expect(item(bad, "subtitle").severity).toBe("action");
    const good = textScene({ lines: [
      dlgLine({ text: "やあ", subtitleText: "短い字幕" }),
      dlgLine({ lineId: "line_002", text: "こんにちは", subtitleText: "こちらも短い" }),
    ] });
    expect(item(good, "subtitle").severity).toBe("ok");
  });
});

// #547 P1-3 レビュー（FREE）：FREE 場面の字幕は字幕**要素**の subtitleSource（読み上げ/全部/話者）で実表示が決まる。
// texts.subtitle だけ／掛け合い行だけを見ると、FREE 字幕対象を無視して見逃し・誤警告する（実測の回帰）。
// sceneDisplayedSubtitleTexts に寄せ、描画（layoutScene）と同じ経路で長さを判定する（ADR-0029・ADR-0026②③）。
describe("buildPrecheckItems（FREE 字幕の対象別の長さ判定・#547 P1-3 レビュー・ADR-0029）", () => {
  const long = "あ".repeat(MAX_SUBTITLE_LEN_DEFAULT + 1);
  const subEl = (over: Record<string, unknown> = {}): FreeElement =>
    ({ id: "free_001", kind: "subtitle", x: 0, y: 0, w: 400, h: 80, ...over }) as unknown as FreeElement;
  const free = (over: Partial<Scene>): Scene => ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "free", templateId: "free_canvas_v1",
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "generated" }, warnings: [], ...over,
  } as Scene);
  const sev = (s: Scene) => buildPrecheckItems([s], [], [freeTemplate]).find((i) => i.id === "subtitle")?.severity;

  it("読み上げ対象：texts.subtitle を実表示＝長ければ警告（掛け合いでも・回帰の再現）", () => {
    // 短い行テキスト＋長い texts.subtitle＋FREE 字幕対象=読み上げ → 画面には texts.subtitle が出る。
    const s = free({
      texts: { subtitle: long },
      lines: [{ lineId: "line_001", text: "短い", subtitleText: "短", status: "none" }] as Scene["lines"],
      freeLayout: [subEl({ subtitleSource: { kind: "narration" } })],
    });
    expect(sev(s)).toBe("action");
  });

  it("読み上げ対象：texts.subtitle が短ければ、行字幕が長くても OK（表示されない行字幕で誤警告しない）", () => {
    const s = free({
      texts: { subtitle: "みじかい" },
      lines: [{ lineId: "line_001", text: long, status: "none" }] as Scene["lines"], // 行字幕は長いが読み上げ対象では非表示
      freeLayout: [subEl({ subtitleSource: { kind: "narration" } })],
    });
    expect(sev(s)).toBe("ok");
  });

  it("全部対象：いずれかの行字幕が長ければ警告", () => {
    const s = free({
      lines: [
        { lineId: "line_001", text: "やあ", status: "none" },
        { lineId: "line_002", text: long, status: "none" },
      ] as Scene["lines"],
      freeLayout: [subEl({ subtitleSource: { kind: "allLines" } })],
    });
    expect(sev(s)).toBe("action");
  });

  it("話者対象：対象話者の行だけ見る（他話者の長い行では警告しない）", () => {
    const base = (over: Partial<Scene>) => free({
      freeLayout: [subEl({ subtitleSource: { kind: "speaker", speaker: { kind: "catalog", speaker: 3 } } })],
      ...over,
    });
    const targetLong = base({ lines: [
      { lineId: "line_001", text: long, speaker: 3, status: "none" },
    ] as Scene["lines"] });
    expect(sev(targetLong)).toBe("action"); // 対象話者(3)の行が長い
    const otherLong = base({ lines: [
      { lineId: "line_001", text: "短い", speaker: 3, status: "none" },
      { lineId: "line_002", text: long, speaker: 2, status: "none" }, // 別話者＝この要素は表示しない
    ] as Scene["lines"] });
    expect(sev(otherLong)).toBe("ok");
  });

  it("字幕 OFF は対象外（読み上げ対象・subtitleEnabledDefault=false）", () => {
    const s = free({
      texts: { subtitle: long }, subtitleEnabledDefault: false,
      freeLayout: [subEl({ subtitleSource: { kind: "narration" } })],
    });
    expect(sev(s)).toBe("ok");
  });

  it("字幕要素が無ければ判定対象なし（texts.subtitle が長くても OK＝表示されない）", () => {
    const s = free({ texts: { subtitle: long } }); // subtitle 要素なし＝FREE では字幕は描画されない
    expect(sev(s)).toBe("ok");
  });

  it("対象未設定（字幕欄を足した直後の既定）：単独場面は読み上げ＝長い texts.subtitle で警告", () => {
    // createFreeElement は subtitleSource を設定しない（PR-C）。追加直後の既定解決も実表示と一致させる。
    const s = free({ texts: { subtitle: long }, freeLayout: [subEl()] }); // subEl() = subtitleSource 未設定
    expect(sev(s)).toBe("action");
  });
});

// #547 P3-9：置いたのに何も表示しない字幕を、書き出し前に場面つきで知らせる（黙って出ないまま MP4 にしない・ADR-0026④）。
describe("buildPrecheckItems（表示されない字幕・#547 P3-9）", () => {
  const subEl = (over: Record<string, unknown> = {}): FreeElement =>
    ({ id: "free_001", kind: "subtitle", x: 0, y: 0, w: 400, h: 80, ...over }) as unknown as FreeElement;
  const free = (over: Partial<Scene>): Scene => ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "free", templateId: "free_canvas_v1",
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "generated" }, warnings: [], ...over,
  } as Scene);
  const silent = (scenes: Scene[]) => buildPrecheckItems(scenes, [], [freeTemplate]).find((i) => i.id === "silentSubtitle");

  it("出ない字幕がある場面を挙げ、その場面へ戻す導線を出す", () => {
    const s = free({ texts: {}, freeLayout: [subEl({ subtitleSource: { kind: "narration" } })] }); // 文が空＝出ない
    const it0 = silent([s]);
    expect(it0?.severity).toBe("action");
    expect(it0?.detail).toContain("場面1");
    expect(it0?.sceneId).toBe("scene_001"); // 「直す」で該当場面を開く（#400 と同じ流儀）
  });

  it("字幕が出ていれば項目自体を出さない（通常プロジェクトにノイズを足さない）", () => {
    const s = free({ texts: { subtitle: "ようこそ" }, freeLayout: [subEl({ subtitleSource: { kind: "narration" } })] });
    expect(silent([s])).toBeUndefined();
  });

  it("字幕を置いていない場面だけなら項目を出さない", () => {
    expect(silent([free({ texts: { subtitle: "ようこそ" } })])).toBeUndefined();
  });

  // 判定は場面編集の手がかりと同じ単一の参照元（subtitleSilentReason）＝画面で「出ない」と言われた場面がここにも並ぶ。
  it("場面の字幕オフ・対象話者の不在も拾う（複数場面は番号を並べる）", () => {
    const off = free({ sceneId: "scene_001", texts: { subtitle: "ようこそ" }, subtitleEnabledDefault: false, freeLayout: [subEl({ subtitleSource: { kind: "narration" } })] });
    const noSpeaker = free({
      sceneId: "scene_002",
      lines: [{ lineId: "line_001", text: "やあ", speaker: 3, status: "none" }] as Scene["lines"],
      freeLayout: [subEl({ subtitleSource: { kind: "speaker", speaker: { kind: "catalog", speaker: 2 } } })],
    });
    expect(silent([off, noSpeaker])?.detail).toContain("場面1・2");
  });

  // 書き出しは止めない（字幕が1つ出ないだけで動画は作れる）＝ハードブロッカーと混ぜない（#547 P2-5）。
  it("書き出しは止めない（blocksExport を立てない）", () => {
    const s = free({ texts: {}, freeLayout: [subEl({ subtitleSource: { kind: "narration" } })] });
    expect(silent([s])?.blocksExport).toBeUndefined();
  });
});

// #547 P2-5：残っていると書き出しが**必ず失敗する**項目だけに blocksExport を立て、公開前チェックの主ボタンを止める根拠にする。
// 立てる条件は書き出し側の停止条件と対（buildExportScenes の templateUnresolvedError／videoUnplaceableError／afterAnim 判定）。
// 「直せば良くなる」警告（声が未作成・字幕が長い）に立てると「出せるのに押せない」になるので、そこは立てないことも固定する。
describe("buildPrecheckItems（書き出しを止める項目の判別・#547 P2-5）", () => {
  const videoAsset: Asset = { assetId: "asset_v", assetType: "video", displayName: "動画", filePath: "assets/v.mp4" };
  const blockingIds = (items: ReturnType<typeof buildPrecheckItems>): string[] =>
    items.filter((i) => i.blocksExport).map((i) => i.id);

  it("見た目が見つからない場面＝書き出しを止める（templateUnresolvedError と対）", () => {
    const scene = { ...freeScene(undefined), templateId: "missing" } as Scene;
    expect(blockingIds(buildPrecheckItems([scene], assets, [freeTemplate]))).toEqual(["sceneTemplate"]);
  });

  it("動画を配置できない場面＝書き出しを止める（videoUnplaceableError と対）", () => {
    const scene = freeScene([
      { id: "slot_1", kind: "slot", x: 100, y: 100, w: 800, h: 600, assetId: "asset_v", fit: "cover", hidden: true },
    ] as unknown as Scene["freeLayout"]);
    expect(blockingIds(buildPrecheckItems([scene], [...assets, videoAsset], [freeTemplate]))).toEqual(["videoPlacement"]);
  });

  it("afterAnim × アニメが場面尺いっぱい＝書き出しを止める", () => {
    const slotEl = [{ id: "slot_1", kind: "slot", x: 100, y: 100, w: 800, h: 600, assetId: "asset_v", fit: "cover" }] as unknown as Scene["freeLayout"];
    const anim = [{ id: "a", sceneId: "scene_001", targetId: "slot_1", keyframes: [{ timeSec: 0, x: -100 }, { timeSec: 8, x: 0 }] }] as unknown as ElementAnimation[];
    const scene = { ...freeScene(slotEl), slotVideoStart: { slot_1: { mode: "afterAnim" } } } as unknown as Scene;
    expect(blockingIds(buildPrecheckItems([scene], [...assets, videoAsset], [freeTemplate], anim))).toEqual(["videoStartAfterAnim"]);
  });

  it("声が未作成・字幕が長い は止めない（直せば良くなる警告＝出せるのに押せない、を作らない）", () => {
    // FREE は字幕要素があって初めて texts.subtitle が表示される（ADR-0029）＝置かないと「長すぎ」判定に載らない。
    const scene = {
      ...freeScene([{ id: "sub_1", kind: "subtitle", x: 100, y: 900, w: 1000, h: 100 }] as unknown as Scene["freeLayout"]),
      narration: { text: "よみあげ", status: "none" },
      texts: { subtitle: "あ".repeat(MAX_SUBTITLE_LEN_DEFAULT + 10) },
    } as unknown as Scene;
    const items = buildPrecheckItems([scene], assets, [freeTemplate]);
    // 該当する警告自体は出ている（出ていないと下の「止めない」が空振りになる）。
    expect(items.find((i) => i.id === "voice")?.severity).toBe("action");
    expect(items.find((i) => i.id === "subtitle")?.severity).toBe("action");
    expect(blockingIds(items)).toEqual([]); // どれも書き出しは止めない
  });

  it("問題の無いプロジェクトは止める項目ゼロ", () => {
    expect(blockingIds(buildPrecheckItems([freeScene(undefined)], assets, [freeTemplate]))).toEqual([]);
  });
});
