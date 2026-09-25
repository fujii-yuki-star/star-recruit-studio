// 同梱するチュートリアル映像の目録と、実際に置いてあるファイルが食い違わないこと（#1229・ADR-0046 ①）。
//
// ⚠️ **「目録に書いたのに入っていない」を画面で気づけない**＝再生を押して初めて黙って何も出ない
//（`<video>` は読み込めなくても例外を投げない）。**置き場所を実際に読む**。
//
// ⚠️ **突き合わせは「作った値」でも叩く**（PR #1243 レビュー 🟡）＝目録はまだ空なので、
// 実物だけを見ると**0件どうしの比較**にしかならず、**比較の仕組みが一度も動かない**
//（`.sort()` を外そうが重複の見方を変えようが緑のまま＝このリポジトリで繰り返している
// 「見えていないのに緑」）。仕組みは `catalogMismatch` に出してあるので、直接叩ける。
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { catalogMismatch, TUTORIAL_VIDEOS, TUTORIAL_VIDEO_DIR, tutorialVideoSrc } from "./tutorialVideos";

const dir = join(process.cwd(), "public", TUTORIAL_VIDEO_DIR);
/** ⚠️ `.gitkeep` は置き場所を git に残すための印で、映像ではない。 */
const filesThere = (): string[] => readdirSync(dir).filter((f) => !f.startsWith("."));

describe("目録と置き場所の突き合わせ（作った値で叩く）", () => {
  it("そろっていれば、食い違いは1つも出ない", () => {
    const got = catalogMismatch([{ id: "a", file: "a.mp4" }, { id: "b", file: "b.mp4" }], ["b.mp4", "a.mp4"]);
    expect(got).toEqual({ missing: [], unlisted: [], duplicateIds: [], duplicateFiles: [] });
  });

  it("目録にあるのに置いていないものを、名指しで出す", () => {
    const got = catalogMismatch([{ id: "a", file: "a.mp4" }, { id: "b", file: "b.mp4" }], ["a.mp4"]);
    expect(got.missing).toEqual(["b.mp4"]);
    expect(got.unlisted).toEqual([]);
  });

  it("置いてあるのに目録に無いものを、名指しで出す", () => {
    const got = catalogMismatch([{ id: "a", file: "a.mp4" }], ["a.mp4", "z.mp4"]);
    expect(got.unlisted).toEqual(["z.mp4"]);
    expect(got.missing).toEqual([]);
  });

  // ⚠️ **両方向を1回で出す**＝片方で止めると、もう片方が隠れたまま直したつもりになる。
  it("足りないものと余っているものは、同時に出る", () => {
    const got = catalogMismatch([{ id: "a", file: "a.mp4" }], ["z.mp4"]);
    expect(got.missing).toEqual(["a.mp4"]);
    expect(got.unlisted).toEqual(["z.mp4"]);
  });

  it("重なった名札・ファイル名を出す（重なりは1つずつ挙げる）", () => {
    const got = catalogMismatch(
      [{ id: "a", file: "x.mp4" }, { id: "a", file: "x.mp4" }, { id: "a", file: "y.mp4" }],
      ["x.mp4", "y.mp4"],
    );
    expect(got.duplicateIds).toEqual(["a"]);
    expect(got.duplicateFiles).toEqual(["x.mp4"]);
  });

  // ⚠️ **並び順で結果が変わらない**＝読み取る順（`readdirSync`）は環境で変わりうるので、
  // 並べずに返すと**同じ状態なのに落ちたり落ちなかったりする**検査になる。
  // ⚠️ **「答えが空の場合」で確かめない**（変異チェックで露見）＝空どうしは並べても並べなくても等しいので、
  // **2件以上が、読み取り順とは違う順で入っている**場合を見る。
  it("足りないものは、目録の並びに関わらず名前の順で出る", () => {
    const got = catalogMismatch([{ id: "z", file: "z.mp4" }, { id: "a", file: "a.mp4" }], []);
    expect(got.missing).toEqual(["a.mp4", "z.mp4"]);
  });

  it("余っているものは、読み取り順に関わらず名前の順で出る", () => {
    const got = catalogMismatch([], ["z.mp4", "a.mp4"]);
    expect(got.unlisted).toEqual(["a.mp4", "z.mp4"]);
  });

  it("並び順が違っても同じ答えになる", () => {
    const cat = [{ id: "b", file: "b.mp4" }, { id: "a", file: "a.mp4" }];
    expect(catalogMismatch(cat, ["a.mp4", "b.mp4"])).toEqual(catalogMismatch(cat, ["b.mp4", "a.mp4"]));
  });
});

describe("同梱するチュートリアル映像（#1229）", () => {
  it("置き場所そのものが在る（映像を足すときに作り忘れない）", () => {
    expect(existsSync(dir), `${dir} が無い`).toBe(true);
    expect(statSync(dir).isDirectory()).toBe(true);
  });

  // ⚠️ **目録が空のうちは、この検査は「何も無いこと」しか言っていない**（上の節が仕組みを見ている）。
  // 最初の映像を入れた回に、ここが本当に効く。
  it("目録と置いてあるファイルが食い違わない", () => {
    expect(catalogMismatch(TUTORIAL_VIDEOS, filesThere())).toEqual({
      missing: [], unlisted: [], duplicateIds: [], duplicateFiles: [],
    });
  });

  it("再生する道は置き場所の下を指す", () => {
    const v = { id: "x", title: "題", desc: "説明", file: "a.mp4", durationLabel: "1分" };
    expect(tutorialVideoSrc(v)).toBe(`/${TUTORIAL_VIDEO_DIR}/a.mp4`);
  });
});
