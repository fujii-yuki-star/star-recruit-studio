// 撮影の引数と台本の読み取り（#1226・PR #1234 レビュー 🟡）。
import { describe, expect, it } from "vitest";
import { checkRecordLog, checkPlan, parseOutDir } from "./plan.mjs";

describe("出力先の読み取り", () => {
  it("`--out` があればそれを使う", () => {
    expect(parseOutDir(["--out", "foo"])).toBe("foo");
  });

  it("無ければ既定", () => {
    expect(parseOutDir([])).toBe("tutorial-out");
  });

  // ⚠️ **印の無い引数を出力先にしない**（変異チェックで生き残った）＝`[]` だけで見ていると、
  //   `rest[0]` を返す実装でも**緑になる**（そこが元の穴だった）。
  it("印の無い引数は出力先にしない", () => {
    expect(parseOutDir(["nanika"]), "第1引数を出力先にしている").toBe("tutorial-out");
  });

  // ⚠️ **これが元の穴**＝`… plan.json --dry` が `--dry` という名前のフォルダを作っていた。
  it("知らない印は断る（黙って別の所へ書かない）", () => {
    expect(() => parseOutDir(["--dry"])).toThrow(/知らない印/);
  });

  it("`--out` のあとが空なら断る", () => {
    expect(() => parseOutDir(["--out"])).toThrow(/出力フォルダがありません/);
  });

  it("`--out` の値が印に見えても、値として受ける", () => {
    expect(parseOutDir(["--out", "--strange"])).toBe("--strange");
  });
});

describe("台本の読み取り", () => {
  it("正しい台本は通る", () => {
    expect(() => checkPlan({ steps: [{ clickText: "押す" }, { waitMs: 100 }] })).not.toThrow();
  });

  // ⚠️ **これが元の穴**＝打ち間違いが無言で消え、短いままの録画に `✓` が出ていた。
  it("`clickText` の打ち間違いを断る", () => {
    expect(() => checkPlan({ steps: [{ clickTest: "押す" }] })).toThrow(/1 段目/);
  });

  it("何段目かを言う（どこを直せばよいか分かる）", () => {
    expect(() => checkPlan({ steps: [{ clickText: "a" }, { clickText: "b" }, { nope: 1 }] })).toThrow(/3 段目/);
  });

  it("`steps` が無い／配列でないなら断る", () => {
    expect(() => checkPlan({})).toThrow(/steps/);
    expect(() => checkPlan({ steps: "押す" })).toThrow(/steps/);
  });

  it("段が0なら断る（録っても何も起きない）", () => {
    expect(() => checkPlan({ steps: [] })).toThrow(/段が1つもありません/);
  });

  it("`waitMs` が数でなければ断る", () => {
    expect(() => checkPlan({ steps: [{ waitMs: "500" }] })).toThrow(/数ではありません/);
  });
});

// ⚠️ **録る側にだけ門番があった**（PR #1237 再レビュー ℹ️）＝記録は素通しで、欠けていると
// ffmpeg のエラー文で落ちて**原因が読めない**（`totalSec` が無いと `NaN` の比較が全部 false）。
describe("録った記録の受け取り", () => {
  const view = { offsetX: 8, offsetY: 31, scale: 1, width: 1280, height: 800 };
  const ok = () => ({ video: "a.mp4", view: { ...view }, totalSec: 10, fps: 15, steps: [{ atSec: 3, x: 100, y: 200 }] });

  it("揃っていれば、そのまま返す", () => {
    expect(checkRecordLog(ok()).totalSec).toBe(10);
  });

  it("欠けている所を名指しで言う", () => {
    for (const key of ["video", "view", "totalSec", "fps", "steps"]) {
      const log = ok();
      delete log[key];
      expect(() => checkRecordLog(log), `${key} が無くても通る`).toThrow(new RegExp(key));
    }
  });

  it("秒になっていなければ落とす（`-t undefined` にしない）", () => {
    expect(() => checkRecordLog({ ...ok(), totalSec: "10" })).toThrow(/totalSec/);
    expect(() => checkRecordLog({ ...ok(), totalSec: 0 })).toThrow(/totalSec/);
  });

  // ⚠️ **在るけれど壊れている**を見る＝欠落だけ見ていると、`0` や文字列が素通りする
  //   （焼く側は端数を丸めるのに `fps` を使うので、0 だと時間軸が1コマずれる）。
  it("コマ数が数でなければ落とす（在るけれど壊れている）", () => {
    expect(() => checkRecordLog({ ...ok(), fps: 0 })).toThrow(/fps/);
    expect(() => checkRecordLog({ ...ok(), fps: "15" })).toThrow(/fps/);
  });

  it("画面の対応が数でなければ落とす", () => {
    expect(() => checkRecordLog({ ...ok(), view: { ...view, offsetY: null } })).toThrow(/view\.offsetY/);
  });

  // ⚠️ **隣の欄も見る**＝壊れて入っていると `totalSec - NaN` が NaN になり、
  //   `totalSec <= 0` は NaN 比較で false＝素通りして ffmpeg のエラー文で落ちる。
  it("使える所の始まりが壊れていれば落とす", () => {
    expect(() => checkRecordLog({ ...ok(), usableFromSec: "2.7" })).toThrow(/usableFromSec/);
    expect(() => checkRecordLog({ ...ok(), usableFromSec: -1 })).toThrow(/usableFromSec/);
    expect(() => checkRecordLog({ ...ok(), usableFromSec: 10 })).toThrow(/usableFromSec/);
  });

  // ⚠️ **無くてもよい**＝#1226 の旧い記録には無い（あるときだけ見る）。
  it("使える所の始まりが無くても通す（旧い記録）", () => {
    expect(checkRecordLog(ok()).usableFromSec).toBeUndefined();
  });

  it("押した段が空なら落とす（焼いても何も出ない）", () => {
    expect(() => checkRecordLog({ ...ok(), steps: [] })).toThrow(/1つもありません/);
  });

  it("段の座標が数でなければ落とす", () => {
    expect(() => checkRecordLog({ ...ok(), steps: [{ atSec: 3, x: 100 }] })).toThrow(/`y`/);
  });

  // ⚠️ **録画の外を指す段**＝焼いてもそこにコマが無い（取り出しで落ちて原因が読めない）。
  it("録画の外を指す段は落とす", () => {
    expect(() => checkRecordLog({ ...ok(), steps: [{ atSec: 99, x: 1, y: 2 }] })).toThrow(/録画の外/);
  });
});
