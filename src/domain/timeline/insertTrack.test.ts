// 新しい列が**同じ種類のまとまりの中へ**入ること（#1249・ADR-0034 決定1）。
//
// ⚠️ **配列の後ろほど手前**（`11 §7.6`）で、画面は**手前を上**に出す。つまり
// 画面の上から順＝配列を逆から読んだもの。検査は**画面で見える順**に直してから確かめる
//（配列のまま書くと、読む人が毎回逆さにする必要があり、間違いに気づけない）。
import { describe, expect, it } from "vitest";
import { insertTrack } from "./edit";
import { TRACK_KIND } from "../enums";
import type { Track } from "./types";

const t = (id: string, kind: Track["kind"]): Track => ({ id, kind });
const V = (id: string) => t(id, TRACK_KIND.visual);
const A = (id: string) => t(id, TRACK_KIND.audio);
/** 画面の上から順に並べた id（配列の逆）。 */
const shown = (tracks: readonly Track[]): string[] => [...tracks].reverse().map((x) => x.id);

describe("列を足す場所（#1249）", () => {
  it("映像は映像のまとまりの**いちばん上**へ入る", () => {
    const before = [A("a1"), V("v1"), V("v2")]; // 画面＝上から v2, v1, a1
    expect(shown(insertTrack(before, V("v3")))).toEqual(["v3", "v2", "v1", "a1"]);
  });

  it("音は音のまとまりの**いちばん下**へ入る", () => {
    const before = [A("a1"), V("v1")]; // 画面＝上から v1, a1
    expect(shown(insertTrack(before, A("a2")))).toEqual(["v1", "a1", "a2"]);
  });

  // ⚠️ **これが直したかったこと**＝以前は末尾へ足していたので、音が映像より上に乗っていた。
  it("音を足しても、映像より上に来ない", () => {
    const before = [A("a1"), V("v1"), V("v2")];
    const after = shown(insertTrack(before, A("a2")));
    expect(after.indexOf("a2")).toBeGreaterThan(after.indexOf("v1"));
    expect(after.indexOf("a2")).toBeGreaterThan(after.indexOf("v2"));
  });

  it("映像を足しても、音より下に来ない", () => {
    const before = [A("a1"), A("a2"), V("v1")];
    const after = shown(insertTrack(before, V("v2")));
    expect(after.indexOf("v2")).toBeLessThan(after.indexOf("a1"));
    expect(after.indexOf("v2")).toBeLessThan(after.indexOf("a2"));
  });

  it("その種類が1つも無いときも、正しい側へ入る", () => {
    expect(shown(insertTrack([V("v1")], A("a1")))).toEqual(["v1", "a1"]);
    expect(shown(insertTrack([A("a1")], V("v1")))).toEqual(["v1", "a1"]);
    expect(shown(insertTrack([], V("v1")))).toEqual(["v1"]);
  });

  // ⚠️ **いまある並びは組み替えない**＝開いた文書の列を黙って並べ替えない（§2-5）。
  it("すでに混ざっている並びは、そのまま（入れる場所を選ぶだけ）", () => {
    const mixed = [V("v1"), A("a1"), V("v2")]; // 画面＝上から v2, a1, v1（混ざっている）
    const after = insertTrack(mixed, V("v3"));
    // 元の3つの**相対の並びが変わっていない**
    expect(after.filter((x) => x.id !== "v3").map((x) => x.id)).toEqual(["v1", "a1", "v2"]);
  });

  it("元の配列を書き換えない（呼んだ側の並びが黙って変わらない）", () => {
    const before = [A("a1"), V("v1")];
    insertTrack(before, V("v2"));
    expect(before.map((x) => x.id)).toEqual(["a1", "v1"]);
  });
});
