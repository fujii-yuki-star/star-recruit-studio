import { describe, expect, it } from "vitest";
import {
  EASE_IN,
  EASE_OUT,
  adjacentKeyFrame,
  clickKey,
  easeOps,
  toLinearOps,
  toggleHoldOps,
  hasAnimated,
  keyId,
  liveKeys,
  moveKeysOps,
  movedKeyIds,
  parseKeyId,
  pathLabel,
  propRowsFor,
  removeKeysOps,
  revealAnimated,
  toggleReveal,
  type Reveal,
} from "./keyframes";
import type { Composition, Keyframe, Layer } from "./types";

const kf = (frame: number, value: number | number[], interpolation: Keyframe["interpolation"] = "linear"): Keyframe => ({
  frame,
  value,
  interpolation,
});

const layer = (id: string, extra: Partial<Layer> = {}): Layer => ({
  id,
  name: id,
  type: "solid",
  enabled: true,
  locked: false,
  inFrame: 0,
  outFrame: 100,
  startFrame: 0,
  transform: {
    anchor: { value: [0, 0] },
    position: { keyframes: [kf(0, [0, 0]), kf(10, [100, 0], "hold"), kf(20, [50, 50])] },
    scale: { value: [1, 1] },
    rotation: { keyframes: [kf(5, 0), kf(15, 90)] },
    opacity: { value: 1 },
  },
  ...extra,
});

const comp = (layers: Layer[]): Composition => ({
  id: "cmp_A",
  name: "c",
  width: 100,
  height: 100,
  fps: { num: 30, den: 1 },
  durationFrames: 300,
  layers,
  markers: [],
});

const pos = (frame: number) => ({ layerId: "A", path: "/transform/position" as const, frame });

describe("値の行（MV-0014 決定1）", () => {
  it("▸＝持っている値を全部・U＝キーのある値だけ（タイムリマップも）", () => {
    const l = layer("A");
    expect(propRowsFor(l, "all")).toEqual([
      "/transform/anchor",
      "/transform/position",
      "/transform/scale",
      "/transform/rotation",
      "/transform/opacity",
    ]);
    expect(propRowsFor(l, "animated")).toEqual(["/transform/position", "/transform/rotation"]);
    const v = layer("V", { type: "video", timeRemap: { keyframes: [kf(0, 0), kf(30, 1)] } });
    expect(propRowsFor(v, "animated")).toContain("/timeRemap");
    expect(pathLabel(v, "/timeRemap")).toBe("タイムリマップ");
    expect(pathLabel(l, "/transform/opacity")).toBe("不透明度");
    const still = layer("S", { transform: { position: { value: [0, 0] } } });
    expect(hasAnimated(still)).toBe(false);
    expect(hasAnimated(l)).toBe(true);
  });

  it("▸は開く・閉じる、U は選んだうちキーのあるものだけ開き、全部開いていれば閉じる", () => {
    const c = comp([layer("A"), layer("S", { transform: { position: { value: [0, 0] } } }), layer("B")]);
    const none: ReadonlyMap<string, Reveal> = new Map();
    expect([...toggleReveal(none, "A")]).toEqual([["A", "all"]]);
    expect([...toggleReveal(new Map([["A", "animated"]]), "A")]).toEqual([]);
    const sel = new Set(["A", "S"]);
    const opened = revealAnimated(none, c, sel);
    expect([...opened]).toEqual([["A", "animated"]]);
    expect([...revealAnimated(opened, c, sel)]).toEqual([]);
    // ▸で全部を開いていたものは、U でキーのある値だけに替える
    expect([...revealAnimated(new Map([["A", "all"]]), c, sel)]).toEqual([["A", "animated"]]);
    // 選んだものがどれも開いていなければ開く（ほかのレイヤーの開き方は変えない）
    expect([...revealAnimated(new Map([["B", "all"]]), c, new Set(["A"]))]).toEqual([
      ["B", "all"],
      ["A", "animated"],
    ]);
  });
});

describe("キーの選択（MV-0014 決定2）", () => {
  it("名前は往復できる・今もあるキーだけ残す", () => {
    expect(parseKeyId(keyId(pos(10)))).toEqual(pos(10));
    expect(parseKeyId("A|/transform/position|x")).toBeNull();
    const c = comp([layer("A")]);
    expect(liveKeys(c, [keyId(pos(10)), keyId(pos(11)), keyId({ ...pos(10), layerId: "Z" })])).toEqual([pos(10)]);
  });

  it("素で押す＝それだけ（選ばれていれば変えない）・Ctrl／Shift＝足す・外す", () => {
    const s = new Set(["a", "b"]);
    expect(clickKey(s, "c", false)).toEqual(["c"]);
    expect(clickKey(s, "a", false)).toEqual(["a", "b"]);
    expect(clickKey(s, "c", true)).toEqual(["a", "b", "c"]);
    expect(clickKey(s, "a", true)).toEqual(["b"]);
  });
});

describe("キーを動かす・消す（MV-0014 決定2）", () => {
  it("まとめて同じだけ動かす・補間と値はそのまま・時刻の順に並べ直す", () => {
    const c = comp([layer("A")]);
    expect(moveKeysOps(c, [pos(0), pos(10)], 3)).toEqual([
      {
        op: "updateLayer",
        layerId: "A",
        patch: { transform: { position: { keyframes: [kf(3, [0, 0]), kf(13, [100, 0], "hold"), kf(20, [50, 50])] } } },
      },
    ]);
    expect(moveKeysOps(c, [pos(0)], 0)).toEqual([]);
    // 後ろへ追い越すと並びが替わる
    const op = moveKeysOps(c, [pos(0)], 25)[0] as unknown as { patch: { transform: { position: { keyframes: Keyframe[] } } } };
    expect(op.patch.transform.position.keyframes.map((k) => k.frame)).toEqual([10, 20, 25]);
  });

  it("動かした先に同じ値の別のキーがあれば置き換える（AE と同じ）・別の値のキーは同じ操作にまとめる", () => {
    const c = comp([layer("A")]);
    const ops = moveKeysOps(c, [pos(10), { layerId: "A", path: "/transform/rotation", frame: 5 }], 10);
    expect(ops).toEqual([
      {
        op: "updateLayer",
        layerId: "A",
        patch: {
          transform: {
            position: { keyframes: [kf(0, [0, 0]), kf(20, [100, 0], "hold")] },
            rotation: { keyframes: [kf(15, 0)] },
          },
        },
      },
    ]);
    expect(movedKeyIds(c, [pos(10)], 10)).toEqual([keyId(pos(20))]);
  });

  it("錠のかかったレイヤーのキーは動かさない・消さない（選択も動かさない）", () => {
    const c = comp([layer("A", { locked: true })]);
    expect(moveKeysOps(c, [pos(0)], 3)).toEqual([]);
    expect(removeKeysOps(c, [pos(0)])).toEqual([]);
    expect(movedKeyIds(c, [pos(0)], 3)).toEqual([keyId(pos(0))]);
  });

  it("消す・全部消したら最後のキーの値の固定値に戻す", () => {
    const c = comp([layer("A")]);
    expect(removeKeysOps(c, [pos(10)])).toEqual([
      {
        op: "updateLayer",
        layerId: "A",
        patch: { transform: { position: { keyframes: [kf(0, [0, 0]), kf(20, [50, 50])] } } },
      },
    ]);
    expect(removeKeysOps(c, [pos(0), pos(10), pos(20)])).toEqual([
      { op: "updateLayer", layerId: "A", patch: { transform: { position: { value: [50, 50], keyframes: null } } } },
    ]);
    expect(removeKeysOps(c, [pos(7)])).toEqual([]);
  });
});

type PosOp = { patch: { transform: { position: { keyframes: Keyframe[] } } } };
const posKeys = (ops: unknown[]): Keyframe[] => (ops[0] as PosOp).patch.transform.position.keyframes;

describe("補間の切り替え（MV-0014 決定3）", () => {
  // 0 直線・10 止める・20 直線（取っ手つき）
  const withEase = (): Composition =>
    comp([
      layer("A", {
        transform: {
          position: {
            keyframes: [kf(0, [0, 0]), kf(10, [100, 0], "hold"), { ...kf(20, [50, 50], "bezier"), easeOut: [0.1, 0.2] }],
          },
        },
      }),
    ]);

  it("Ctrl+Alt+H＝全部止めるなら直線へ・そうでなければ全部止める（取っ手は外す）", () => {
    const c = withEase();
    expect(posKeys(toggleHoldOps(c, [pos(0), pos(20)])).map((k) => k.interpolation)).toEqual(["hold", "hold", "hold"]);
    expect(posKeys(toggleHoldOps(c, [pos(0), pos(20)]))[2]).toEqual(kf(20, [50, 50], "hold"));
    expect(posKeys(toggleHoldOps(c, [pos(10)])).map((k) => k.interpolation)).toEqual(["linear", "linear", "bezier"]);
    expect(toggleHoldOps(c, [pos(7)])).toEqual([]);
    expect(toggleHoldOps(comp([layer("A", { locked: true })]), [pos(0)])).toEqual([]);
  });

  it("Ctrl を押しながら◆＝直線に戻す（取っ手も外す）", () => {
    expect(posKeys(toLinearOps(withEase(), [pos(20)]))[2]).toEqual(kf(20, [50, 50]));
  });

  it("F9＝出は曲線と easeOut・入りは easeIn と前の直線のキーを曲線に（前が止めるなら変えない）", () => {
    const c = comp([layer("A")]);
    // 0 直線・10 止める・20 直線
    const both = posKeys(easeOps(c, [pos(20)], "both"));
    expect(both[2]).toEqual({ ...kf(20, [50, 50], "bezier"), easeOut: EASE_OUT, easeIn: EASE_IN });
    expect(both[1].interpolation).toBe("hold");
    const mid = posKeys(easeOps(comp([layer("A", { transform: { position: { keyframes: [kf(0, 0), kf(10, 1), kf(20, 2)] } } })]), [pos(10)], "both"));
    expect(mid[0]).toEqual(kf(0, 0, "bezier"));
    expect(mid[1]).toEqual({ ...kf(10, 1, "bezier"), easeOut: EASE_OUT, easeIn: EASE_IN });
    expect(mid[2]).toEqual(kf(20, 2));
    // 入りだけ＝そのキーの出は変えない・出だけ＝前のキーは変えない
    const inOnly = posKeys(easeOps(comp([layer("A", { transform: { position: { keyframes: [kf(0, 0), kf(10, 1), kf(20, 2)] } } })]), [pos(10)], "in"));
    expect(inOnly[1]).toEqual({ ...kf(10, 1), easeIn: EASE_IN });
    expect(inOnly[0].interpolation).toBe("bezier");
    const outOnly = posKeys(easeOps(comp([layer("A", { transform: { position: { keyframes: [kf(0, 0), kf(10, 1), kf(20, 2)] } } })]), [pos(10)], "out"));
    expect(outOnly[1]).toEqual({ ...kf(10, 1, "bezier"), easeOut: EASE_OUT });
    expect(outOnly[0]).toEqual(kf(0, 0));
    // 最初のキーの入り＝前が無い（そのキーだけ）
    expect(posKeys(easeOps(c, [pos(0)], "in"))[0]).toEqual({ ...kf(0, [0, 0]), easeIn: EASE_IN });
  });
});

describe("J／K（MV-0014 決定4）", () => {
  const c = (): Composition =>
    comp([
      layer("A"),
      layer("B", {
        transform: { opacity: { keyframes: [kf(3, 0), kf(40, 1)] } },
        timeRemap: { keyframes: [kf(50, 0), kf(60, 1)] },
      }),
    ]);
  it("選んだレイヤー（無ければ全部）の、キーのある全部の値（タイムリマップも）", () => {
    expect(adjacentKeyFrame(c(), new Set(), 10, 1)).toBe(15);
    expect(adjacentKeyFrame(c(), new Set(), 10, -1)).toBe(5);
    expect(adjacentKeyFrame(c(), new Set(["B"]), 10, 1)).toBe(40);
    expect(adjacentKeyFrame(c(), new Set(["B"]), 40, 1)).toBe(50);
    expect(adjacentKeyFrame(c(), new Set(["B"]), 3, -1)).toBeNull();
    expect(adjacentKeyFrame(c(), new Set(["A"]), 20, 1)).toBeNull();
  });
});
