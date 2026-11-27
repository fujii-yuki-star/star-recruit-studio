import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ANIM_PATHS,
  animAt,
  clampFor,
  colorToHex,
  hexToColor,
  keyFramesOf,
  nextKeyFrame,
  prevKeyFrame,
  propDefsFor,
  setPlainOp,
  setValueOp,
  shiftKeyframesPatch,
  toggleKeyOp,
  toggleStopwatchOp,
  upsertKey,
} from "./props";
import { shiftPatch } from "./layerOps";
import { BLEND_MODES, type Layer } from "./types";

const base = (extra: Partial<Layer> = {}): Layer => ({
  id: "L",
  name: "L",
  type: "solid",
  enabled: true,
  locked: false,
  inFrame: 0,
  outFrame: 100,
  startFrame: 0,
  transform: {
    anchor: { value: [10, 10] },
    position: { value: [100, 50] },
    scale: { value: [1, 1] },
    rotation: { value: 0 },
    opacity: { value: 1 },
  },
  ...extra,
});

const animated = (): Layer =>
  base({
    transform: {
      ...base().transform,
      position: {
        keyframes: [
          { frame: 10, value: [0, 0], interpolation: "linear" },
          { frame: 30, value: [100, 0], interpolation: "hold" },
        ],
      },
    },
  });

describe("固定値とキーフレームを書く（MV-0008 決定5）", () => {
  it("固定値なら固定値を変える・キーフレームなら今の時刻にキーを打つ（あれば置き換えて補間は保つ）", () => {
    expect(setValueOp(base(), "/transform/rotation", 5, 45)).toEqual({
      op: "updateLayer",
      layerId: "L",
      patch: { transform: { rotation: { value: 45 } } },
    });
    expect(setValueOp(animated(), "/transform/position", 20, [50, 5]).patch).toEqual({
      transform: {
        position: {
          keyframes: [
            { frame: 10, value: [0, 0], interpolation: "linear" },
            { frame: 20, value: [50, 5], interpolation: "linear" },
            { frame: 30, value: [100, 0], interpolation: "hold" },
          ],
        },
      },
    });
    expect(setValueOp(animated(), "/transform/position", 30, [9, 9]).patch).toEqual({
      transform: {
        position: {
          keyframes: [
            { frame: 10, value: [0, 0], interpolation: "linear" },
            { frame: 30, value: [9, 9], interpolation: "hold" },
          ],
        },
      },
    });
  });

  it("ストップウォッチ：固定値→今の時刻に今の値のキー1つ／キーフレーム→今の時刻の値の固定値（キーは消す）", () => {
    expect(toggleStopwatchOp(base(), "/transform/opacity", 12, 0.5).patch).toEqual({
      transform: { opacity: { value: null, keyframes: [{ frame: 12, value: 0.5, interpolation: "linear" }] } },
    });
    expect(toggleStopwatchOp(animated(), "/transform/position", 20, [50, 0]).patch).toEqual({
      transform: { position: { value: [50, 0], keyframes: null } },
    });
  });

  it("◆：今の時刻のキーを足す・消す（最後の1つを消すとその値の固定値）・固定値では何もしない", () => {
    expect(toggleKeyOp(base(), "/transform/position", 5, [1, 1])).toBeNull();
    expect(toggleKeyOp(animated(), "/transform/position", 10, [0, 0])?.patch).toEqual({
      transform: { position: { keyframes: [{ frame: 30, value: [100, 0], interpolation: "hold" }] } },
    });
    expect(toggleKeyOp(animated(), "/transform/position", 15, [25, 0])?.patch).toEqual({
      transform: {
        position: {
          keyframes: [
            { frame: 10, value: [0, 0], interpolation: "linear" },
            { frame: 15, value: [25, 0], interpolation: "linear" },
            { frame: 30, value: [100, 0], interpolation: "hold" },
          ],
        },
      },
    });
    const one = base({
      transform: { ...base().transform, rotation: { keyframes: [{ frame: 3, value: 90, interpolation: "linear" }] } },
    });
    expect(toggleKeyOp(one, "/transform/rotation", 3, 90)?.patch).toEqual({
      transform: { rotation: { value: 90, keyframes: null } },
    });
  });

  it("前と次のキー（今の時刻ちょうどのキーは含めない）", () => {
    const a = animAt(animated(), "/transform/position");
    expect(prevKeyFrame(a, 20)).toBe(10);
    expect(nextKeyFrame(a, 20)).toBe(30);
    expect(prevKeyFrame(a, 10)).toBeNull();
    expect(nextKeyFrame(a, 30)).toBeNull();
    expect(nextKeyFrame(a, 10)).toBe(30);
    expect(prevKeyFrame(animAt(base(), "/transform/position"), 50)).toBeNull();
    // 3つ以上でも、いちばん近いもの
    const three = {
      keyframes: [10, 30, 50].map((frame) => ({ frame, value: 0, interpolation: "linear" as const })),
    };
    expect(nextKeyFrame(three, 20)).toBe(30);
    expect(prevKeyFrame(three, 40)).toBe(30);
  });

  it("キーは時刻の順に入れる", () => {
    const ks = upsertKey([{ frame: 30, value: 1, interpolation: "linear" }], 10, 0);
    expect(ks.map((k) => k.frame)).toEqual([10, 30]);
  });
});

describe("ずらすとキーも一緒に動く（AE の型）", () => {
  it("キーのある値だけ同じだけずらし、範囲と素材の時刻と一緒に差分にする", () => {
    const l = base({
      transform: {
        ...animated().transform,
        opacity: { keyframes: [{ frame: 0, value: 0, interpolation: "linear" }] },
      },
    });
    expect(shiftPatch(l, 5)).toEqual({
      inFrame: 5,
      outFrame: 105,
      startFrame: 5,
      transform: {
        position: {
          keyframes: [
            { frame: 15, value: [0, 0], interpolation: "linear" },
            { frame: 35, value: [100, 0], interpolation: "hold" },
          ],
        },
        opacity: { keyframes: [{ frame: 5, value: 0, interpolation: "linear" }] },
      },
    });
    expect(shiftKeyframesPatch(l, 0)).toEqual({});
    expect(shiftKeyframesPatch(base(), 5)).toEqual({});
  });

  it("帯の下の◆＝全部の値のキーのフレーム（重ねない・時刻の順）", () => {
    const l = base({
      transform: {
        ...animated().transform,
        rotation: { keyframes: [{ frame: 30, value: 0, interpolation: "linear" }, { frame: 5, value: 1, interpolation: "linear" }] },
      },
    });
    expect(keyFramesOf(l)).toEqual([5, 10, 30]);
    expect(keyFramesOf(base())).toEqual([]);
  });
});

describe("値の欄の行と、そのほか", () => {
  it("図形の四角は大きさと角の丸み・楕円は大きさだけ・ほかは変形だけ", () => {
    const labels = (l: Layer): string[] => propDefsFor(l).map((d) => d.label);
    expect(labels(base())).toEqual(["アンカー", "位置", "大きさ", "回転", "不透明度"]);
    expect(labels(base({ type: "shape", shape: { kind: "rectangle" } }))).toContain("角の丸み");
    expect(labels(base({ type: "shape", shape: { kind: "ellipse" } }))).toContain("大きさ（図形）");
    expect(labels(base({ type: "shape", shape: { kind: "ellipse" } }))).not.toContain("角の丸み");
    expect(labels(base({ type: "shape", shape: { kind: "path" } }))).not.toContain("大きさ（図形）");
  });

  it("不透明度は 0〜1・角の丸みは 0 以上に収める（ほかは収めない）", () => {
    expect(clampFor("/transform/opacity", [1.4])).toEqual([1]);
    expect(clampFor("/transform/opacity", [-1])).toEqual([0]);
    expect(clampFor("/shape/cornerRadius", [-3])).toEqual([0]);
    expect(clampFor("/transform/position", [-30, 2000])).toEqual([-30, 2000]);
  });

  it("動かせない値は、その場所だけの差分", () => {
    expect(setPlainOp(base(), "/text/fontSize", 48).patch).toEqual({ text: { fontSize: 48 } });
    expect(setPlainOp(base(), "/blendMode", "screen").patch).toEqual({ blendMode: "screen" });
  });

  it("色と #rrggbb を行き来する（不透明度は保つ）", () => {
    expect(colorToHex([1, 0.5, 0, 1])).toBe("#ff8000");
    expect(colorToHex([2, -1, 0, 1])).toBe("#ff0000");
    expect(hexToColor("#ff8000", 0.3)).toEqual([1, 0.502, 0, 0.3]);
    expect(hexToColor("red", 1)).toBeNull();
  });

  it("動かせる値の場所は Rust（edit.rs の ANIM_PATHS）と同じ並び・描画モードは schema と同じ並び", () => {
    const rust = readFileSync("src-tauri/src/edit.rs", "utf8");
    const block = /pub const ANIM_PATHS: &\[&str\] = &\[([\s\S]*?)\];/.exec(rust)?.[1] ?? "";
    expect([...block.matchAll(/"([^"]+)"/g)].map((m) => m[1])).toEqual([...ANIM_PATHS]);
    const schema = JSON.parse(readFileSync("../../docs/stario_mv_docs/schemas/mv-project.schema.json", "utf8")) as {
      $defs: { BlendMode: { enum: string[] } };
    };
    expect([...BLEND_MODES]).toEqual(schema.$defs.BlendMode.enum);
  });
});
