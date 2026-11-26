import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schema from "../../../../docs/stario_mv_docs/schemas/mv-project.schema.json";
import minimal from "../../../../docs/stario_mv_docs/schemas/examples/minimal.json";

/**
 * γ の正典（MV-0001）の形の検査。⚠️ **schema が「通さない」と書いたものを本当に通さないか**を、
 * 正しい見本を1か所だけ壊して確かめる（壊した見本が通ったら schema の穴）。
 */
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
addFormats(ajv);
const validate = ajv.compile(schema);

type Json = Record<string, unknown>;
const clone = (): Json => structuredClone(minimal) as Json;
const firstComp = (doc: Json): Json => (doc.compositions as Json[])[0];
const layer = (doc: Json, i: number): Json => (firstComp(doc).layers as Json[])[i];
const textLayer = (doc: Json): Json => layer(doc, 0);
const solidLayer = (doc: Json): Json => layer(doc, 1);

describe("MV-0001 project.json の形", () => {
  it("見本（いちばん小さい動画）は通る", () => {
    expect(validate(minimal), JSON.stringify(validate.errors)).toBe(true);
  });

  const broken: [string, (doc: Json) => void][] = [
    ["形式の目印が違う（α の動画と取り違えない）", (d) => { d.format = "timeline"; }],
    ["ID の頭が種類と合わない", (d) => { textLayer(d).id = "cmp_01JDQ0000000000000000000Y1"; }],
    ["ID に使えない文字（L）が入っている", (d) => { textLayer(d).id = "lyr_01JDQ0000000000000000000L1"; }],
    ["固定値とキーフレームを両方持つ", (d) => { ((textLayer(d).transform as Json).opacity as Json).value = 1; }],
    ["固定値・キーフレーム・式のどれも無い", (d) => { (textLayer(d).transform as Json).rotation = {}; }],
    ["知らない項目をレイヤーに足す", (d) => { textLayer(d).zIndex = 3; }],
    ["文字のレイヤーが素材を指す", (d) => { textLayer(d).assetId = "ast_01JDQ0000000000000000000A1"; }],
    ["文字のレイヤーに文字が無い", (d) => { delete textLayer(d).text; }],
    ["映像のレイヤーが素材を指さない", (d) => { const l = solidLayer(d); l.type = "video"; delete l.solid; }],
    ["単色でないレイヤーが単色の中身を持つ", (d) => { solidLayer(d).type = "adjustment"; }],
    ["色が 0〜1 の外", (d) => { firstComp(d).background = [0, 0, 0, 2]; }],
    ["エフェクトの種類の名前が決まりの外", (d) => { ((solidLayer(d).effects as Json[])[0]).type = "blur"; }],
    ["つなぎに知らない項目", (d) => { ((solidLayer(d).transform as Json).opacity as Json).links = [{ kind: "audio", amount: 1, gain: 2 }]; }],
    ["キーフレームの進み方が決まりの外", (d) => { (((textLayer(d).transform as Json).opacity as Json).keyframes as Json[])[0].interpolation = "ease"; }],
    ["fps が分数でない", (d) => { firstComp(d).fps = 30; }],
    ["素材をコピーしたのに assets/ の外を指す", (d) => { d.assets = [{ id: "ast_01JDQ0000000000000000000A1", kind: "image", name: "x", source: { mode: "copied", path: "C:/x.png" } }]; }],
  ];
  for (const [name, breakIt] of broken) {
    it(`通さない：${name}`, () => {
      const doc = clone();
      breakIt(doc);
      expect(validate(doc)).toBe(false);
    });
  }
});
