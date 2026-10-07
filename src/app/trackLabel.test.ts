// 列の名前（自動の番号）。⚠️ **画面の上から数える**（#1249）。
//
// 並びは**配列の後ろほど手前**（`11 §7.6`）で、画面は手前を上に出す＝**画面の順は配列の逆**。
// 映像は上へ積み、音は下へ積むので、**音だけ数える向きが逆**になる。
import { describe, expect, it } from "vitest";
import { trackLabel } from "./uiLabels";
import { TRACK_KIND } from "../domain/enums";

const V = (id: string) => ({ id, kind: TRACK_KIND.visual });
const A = (id: string) => ({ id, kind: TRACK_KIND.audio });
/** 画面の上から順に名前を並べる（配列の逆）。 */
const shown = (tracks: { id: string; kind: typeof TRACK_KIND.visual | typeof TRACK_KIND.audio }[]): string[] =>
  [...tracks].reverse().map((t) => trackLabel(tracks, t.id));

describe("列の自動の名前（#1249）", () => {
  it("映像は上ほど大きい番号・音は下ほど大きい番号（業界の型）", () => {
    // 画面＝上から 映像2, 映像1, 音1, 音2
    const tracks = [A("a2"), A("a1"), V("v1"), V("v2")];
    expect(shown(tracks)).toEqual(["映像2", "映像1", "音1", "音2"]);
  });

  // ⚠️ **これが直したかったこと**＝以前は配列の順で数えていたので、音を足すと
  //   **元の列の番号が付け替わった**（実機で `音1` が `音2` に化けた）。
  it("音を足しても、元の音の列の番号が変わらない", () => {
    const before = [A("a1"), V("v1")];
    const 元の名前 = trackLabel(before, "a1");
    const after = [A("a2"), A("a1"), V("v1")]; // 新しい音は配列の先頭（＝画面のいちばん下）へ
    expect(trackLabel(after, "a1"), "元の列の番号が動いた").toBe(元の名前);
    expect(trackLabel(after, "a2")).toBe("音2");
  });

  it("映像を足しても、元の映像の列の番号が変わらない", () => {
    const before = [A("a1"), V("v1")];
    const after = [A("a1"), V("v1"), V("v2")];
    expect(trackLabel(after, "v1")).toBe(trackLabel(before, "v1"));
    expect(trackLabel(after, "v2")).toBe("映像2");
  });

  it("名前が付いていればそれを出す（番号より優先）", () => {
    const tracks = [A("a1"), { ...V("v1"), name: "ゆうこの立ち絵" }];
    expect(trackLabel(tracks, "v1")).toBe("ゆうこの立ち絵");
  });

  it("無い列は空文字（呼ぶ側が落ちない）", () => {
    expect(trackLabel([V("v1")], "nope")).toBe("");
  });
});
