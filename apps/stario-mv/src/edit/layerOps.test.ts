import { describe, expect, it } from "vitest";
import {
  moveOps,
  moveToPlayheadOps,
  rangeSelect,
  removeOps,
  renameOp,
  reorderOps,
  rippleRemoveOps,
  sequenceOps,
  splitOps,
  stackStepOps,
  toggleOp,
  trimInOps,
  withTrial,
  mergePatch,
  trimOutOps,
  trimToPlayheadOps,
} from "./layerOps";
import type { Composition, Layer } from "./types";

const layer = (id: string, inFrame: number, outFrame: number, extra: Partial<Layer> = {}): Layer => ({
  id,
  name: id,
  type: "solid",
  enabled: true,
  locked: false,
  inFrame,
  outFrame,
  startFrame: inFrame,
  ...extra,
});

const comp = (layers: Layer[]): Composition => ({
  id: "cmp_A",
  name: "本編",
  width: 1920,
  height: 1080,
  fps: { num: 30, den: 1 },
  durationFrames: 300,
  layers,
  markers: [],
});

const set = (...ids: string[]): Set<string> => new Set(ids);

describe("ずらす・端を切る（MV-0008 決定4）", () => {
  const c = comp([layer("A", 10, 40), layer("B", 50, 80, { startFrame: 45 }), layer("L", 0, 10, { locked: true })]);

  it("ずらすと inFrame・outFrame・startFrame が同じだけ動く（選んだものだけ・錠は動かさない）", () => {
    expect(moveOps(c, set("B", "L"), -5)).toEqual([
      { op: "updateLayer", layerId: "B", patch: { inFrame: 45, outFrame: 75, startFrame: 40 } },
    ]);
    expect(moveOps(c, set("A"), 0)).toEqual([]);
  });

  it("端を切ると片方の端だけが動き、範囲が空になる・変わらないときは何もしない", () => {
    expect(trimInOps(c, set("A"), 20)).toEqual([{ op: "updateLayer", layerId: "A", patch: { inFrame: 20 } }]);
    expect(trimInOps(c, set("A"), 40)).toEqual([]);
    expect(trimInOps(c, set("A"), 10)).toEqual([]);
    expect(trimOutOps(c, set("A"), 30)).toEqual([{ op: "updateLayer", layerId: "A", patch: { outFrame: 30 } }]);
    expect(trimOutOps(c, set("A"), 10)).toEqual([]);
    expect(trimOutOps(c, set("A"), 40)).toEqual([]);
    expect(trimInOps(c, set("L"), 5)).toEqual([]);
  });

  it("Alt+[・Alt+] は今の時刻で切る（終わりは今の時刻のコマまで見える＝+1）", () => {
    expect(trimToPlayheadOps(c, set("A"), 25, "in")).toEqual([
      { op: "updateLayer", layerId: "A", patch: { inFrame: 25 } },
    ]);
    expect(trimToPlayheadOps(c, set("A"), 25, "out")).toEqual([
      { op: "updateLayer", layerId: "A", patch: { outFrame: 26 } },
    ]);
  });

  it("[・] は長さを変えずに始まり／終わりを今の時刻へ動かす", () => {
    expect(moveToPlayheadOps(c, set("A"), 100, "in")).toEqual([
      { op: "updateLayer", layerId: "A", patch: { inFrame: 100, outFrame: 130, startFrame: 100 } },
    ]);
    // ] ＝今の時刻のコマが最後に見えるコマ（outFrame は含まない）
    expect(moveToPlayheadOps(c, set("A"), 100, "out")).toEqual([
      { op: "updateLayer", layerId: "A", patch: { inFrame: 71, outFrame: 101, startFrame: 71 } },
    ]);
    expect(moveToPlayheadOps(c, set("A"), 10, "in")).toEqual([]);
  });
});

describe("分割・詰める・消す", () => {
  it("分割は今の時刻が内側のレイヤーだけ（端ちょうどは分けない）", () => {
    const c = comp([layer("A", 10, 40), layer("B", 30, 60), layer("C", 40, 50)]);
    expect(splitOps(c, set("A", "B", "C"), 40)).toEqual([{ op: "splitLayer", layerId: "B", frame: 40 }]);
    expect(splitOps(c, set("A"), 10)).toEqual([]);
  });

  it("詰めるは時間の順に隙間なく並べ、いちばん早いものは動かさない", () => {
    const c = comp([layer("C", 200, 210), layer("A", 20, 50), layer("B", 100, 120)]);
    expect(sequenceOps(c, set("A", "B", "C"))).toEqual([
      { op: "updateLayer", layerId: "B", patch: { inFrame: 50, outFrame: 70, startFrame: 50 } },
      { op: "updateLayer", layerId: "C", patch: { inFrame: 70, outFrame: 80, startFrame: 70 } },
    ]);
  });

  it("消すは選んだものだけ（錠は消さない）", () => {
    const c = comp([layer("A", 0, 10), layer("L", 0, 10, { locked: true })]);
    expect(removeOps(c, set("A", "L"))).toEqual([{ op: "removeLayer", layerId: "A" }]);
  });

  it("消して詰めるは、後ろのレイヤーを消した長さの合計だけ前へ（前にあるもの・錠は動かさない）", () => {
    const c = comp([
      layer("pre", 0, 20),
      layer("X", 20, 50),
      layer("mid", 50, 70),
      layer("Y", 70, 80),
      layer("post", 80, 100),
      layer("lock", 90, 95, { locked: true }),
    ]);
    expect(rippleRemoveOps(c, set("X", "Y"))).toEqual([
      { op: "removeLayer", layerId: "X" },
      { op: "removeLayer", layerId: "Y" },
      { op: "updateLayer", layerId: "mid", patch: { inFrame: 20, outFrame: 40, startFrame: 20 } },
      { op: "updateLayer", layerId: "post", patch: { inFrame: 40, outFrame: 60, startFrame: 40 } },
    ]);
    expect(rippleRemoveOps(c, set("lock"))).toEqual([]);
  });
});

describe("掴んでいる途中の帯の見え方", () => {
  it("試しの直す編集を順に当て（消す・並べ替えは当てない）、元は変えない", () => {
    const ls = [layer("A", 0, 10), layer("B", 10, 20)];
    const shown = withTrial(ls, [
      { op: "updateLayer", layerId: "B", patch: { inFrame: 15, outFrame: 25, startFrame: 15 } },
      { op: "updateLayer", layerId: "B", patch: { name: "新" } },
      { op: "removeLayer", layerId: "A" },
      { op: "moveLayer", layerId: "B", index: 0 },
    ]);
    expect(shown.map((l) => [l.id, l.inFrame, l.outFrame, l.startFrame, l.name])).toEqual([
      ["A", 0, 10, 0, "A"],
      ["B", 15, 25, 15, "新"],
    ]);
    expect(ls[1].inFrame).toBe(10);
    // 片方の端だけ（切る）
    expect(withTrial(ls, [{ op: "updateLayer", layerId: "A", patch: { outFrame: 5 } }])[0]).toMatchObject({ inFrame: 0, outFrame: 5 });
  });
});

describe("JSON Merge Patch（Rust の取引と同じ当て方）", () => {
  it("null は消す・入れ子はまぜる・並びは置き換える・元は変えない", () => {
    const t = { a: 1, b: { c: 2, d: 3 }, e: [1, 2] };
    expect(mergePatch(t, { a: null, b: { c: 9 }, e: [3], f: { g: 1 } })).toEqual({ b: { c: 9, d: 3 }, e: [3], f: { g: 1 } });
    expect(t).toEqual({ a: 1, b: { c: 2, d: 3 }, e: [1, 2] });
    expect(mergePatch({ a: 1 }, { a: { b: null, c: 1 } })).toEqual({ a: { c: 1 } });
  });
});

describe("重なりの順・切り替え・選択", () => {
  const ids = ["A", "B", "C", "D"];
  const c = comp(ids.map((id) => layer(id, 0, 10)));

  it("Ctrl+] は1つ手前へ・Ctrl+[ は1つ奥へ（まとめて動かしても互いを追い越さない）", () => {
    expect(stackStepOps(c, set("B", "C"), "forward")).toEqual([
      { op: "moveLayer", layerId: "B", index: 0 },
      { op: "moveLayer", layerId: "C", index: 1 },
    ]);
    expect(stackStepOps(c, set("B", "C"), "backward")).toEqual([
      { op: "moveLayer", layerId: "C", index: 3 },
      { op: "moveLayer", layerId: "B", index: 2 },
    ]);
    // いちばん手前のかたまりは動かない
    expect(stackStepOps(c, set("A", "B"), "forward")).toEqual([]);
    expect(stackStepOps(c, set("D"), "backward")).toEqual([]);
  });

  it("名前の列で並べ替える（同じ所・範囲の外は丸める）", () => {
    expect(reorderOps(c, "D", 1)).toEqual([{ op: "moveLayer", layerId: "D", index: 1 }]);
    expect(reorderOps(c, "D", 3)).toEqual([]);
    expect(reorderOps(c, "A", 99)).toEqual([{ op: "moveLayer", layerId: "A", index: 3 }]);
    expect(reorderOps(c, "none", 0)).toEqual([]);
  });

  it("目・ソロ・錠を切り替え、名前は空と同じ名前なら変えない", () => {
    const l = layer("A", 0, 10);
    expect(toggleOp(l, "enabled")).toEqual({ op: "updateLayer", layerId: "A", patch: { enabled: false } });
    expect(toggleOp(l, "solo")).toEqual({ op: "updateLayer", layerId: "A", patch: { solo: true } });
    expect(toggleOp({ ...l, solo: true }, "solo")).toEqual({ op: "updateLayer", layerId: "A", patch: { solo: false } });
    expect(toggleOp(l, "locked")).toEqual({ op: "updateLayer", layerId: "A", patch: { locked: true } });
    expect(renameOp(l, " 新しい名前 ")).toEqual({ op: "updateLayer", layerId: "A", patch: { name: "新しい名前" } });
    expect(renameOp(l, "  ")).toBeNull();
    expect(renameOp(l, "A")).toBeNull();
  });

  it("Shift の範囲選択は、基点から並びの間を全部（上下どちらへも）", () => {
    expect(rangeSelect(c, "B", "D")).toEqual(["B", "C", "D"]);
    expect(rangeSelect(c, "D", "B")).toEqual(["B", "C", "D"]);
    expect(rangeSelect(c, "none", "C")).toEqual(["C"]);
  });
});
