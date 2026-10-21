// @vitest-environment jsdom
/* global Element, document */ // jsdom の画面（scripts の lint は node の名前しか知らない）
// 画面の言葉で要素を探す式を、実際の部品に当てて確かめる（#1228 の下見で足した「名前で探す」）。
import { beforeEach, describe, expect, it } from "vitest";
import { FIND_BY_TEXT } from "./cdp.mjs";

const run = (text) => (0, eval)(FIND_BY_TEXT(text));

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
  document.body.innerHTML = `
    <button id="use">この動画で使う</button>
    <button id="icon" aria-label="「新しいタイムライン」の縦の版を作る"><svg></svg></button>
    <button id="long">「新しいタイムライン」の縦の版を作るときの説明</button>
    <button id="save">保存</button>
    <button id="saveas">保存して閉じる</button>`;
});

describe("FIND_BY_TEXT（実際の部品で）", () => {
  it("文字の完全一致を先に当てる", () => {
    expect(run("保存").id).toBe("save");
  });
  it("文字の無いボタンは名前の完全一致で当てる（名前を含む長い文字のボタンより先）", () => {
    expect(run("「新しいタイムライン」の縦の版を作る").id).toBe("icon");
  });
  it("どちらでも当たらなければ文字の部分一致", () => {
    expect(run("縦の版を作るときの").id).toBe("long");
    expect(run("見つからない言葉")).toBeNull();
  });
  // ⚠️ **畳んだ道具より、描かれている「…」の項目を当てる**（ADR-0048 追補 2026-10-21）＝畳んだボタンは
  //   `display: none` で DOM に残り、文字の完全一致で先に当たって押せない所を押しにいった。
  it("描かれている物を先に当てる（同じ名前の隠れたボタンより、見えている項目）", () => {
    document.body.innerHTML = `
      <button id="folded">目印を置く</button>
      <div role="menu"><button id="item" role="menuitem">目印を置く</button></div>`;
    document.getElementById("item").getClientRects = () => ({ length: 1 });
    expect(run("目印を置く").id).toBe("item");
  });
});
