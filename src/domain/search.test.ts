// 一覧を言葉で絞り込む共通規則（#1031 レビュー）。
//
// ⚠️ **同じ「探す」が画面で別挙動になっていた**＝素材は「前後の空白と大文字小文字を無視・
//    空白で区切った語は全部含む」なのに、見た目パターンの一覧は素の `includes` だった。
import { describe, expect, it } from "vitest";
import { matchesSearchWords } from "./search";

describe("言葉で絞り込む（共通規則）", () => {
  it("空の言葉は絞らない（空欄なのに0件、を作らない）", () => {
    expect(matchesSearchWords(["会社の外観"], "")).toBe(true);
    expect(matchesSearchWords(["会社の外観"], "   ")).toBe(true);
  });

  it("部分一致で当たる", () => {
    expect(matchesSearchWords(["会社の外観"], "外観")).toBe(true);
    expect(matchesSearchWords(["会社の外観"], "社屋")).toBe(false);
  });

  it("大文字小文字は区別しない（ローマ字の名前で当たらない、を作らない）", () => {
    expect(matchesSearchWords(["Logo White"], "logo")).toBe(true);
    expect(matchesSearchWords(["logo white"], "LOGO")).toBe(true);
  });

  it("前後の空白は無視する", () => {
    expect(matchesSearchWords(["会社の外観"], "  外観  ")).toBe(true);
  });

  // ⚠️ **足すほど狭くなる**（AND）＝空白を入れた途端に0件、を作らない。
  it("空白で区切った語は全部含む（AND）", () => {
    expect(matchesSearchWords(["Logo White"], "logo white")).toBe(true);
    expect(matchesSearchWords(["Logo White"], "logo black")).toBe(false);
  });

  it("見る先は複数あってよい（名前とタグの両方など）", () => {
    expect(matchesSearchWords(["logo.png", "ロゴ"], "ロゴ")).toBe(true);
    expect(matchesSearchWords(["logo.png", "ロゴ"], "logo ロゴ")).toBe(true);
  });

  it("語をまたいで当たる（つないだ1本の文として見る）", () => {
    expect(matchesSearchWords(["会社", "外観"], "会社 外観")).toBe(true);
  });
});
