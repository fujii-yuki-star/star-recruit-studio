// 画面の言葉で要素を探す式（#1226・PR #1234 レビュー 🟡で共有へ寄せたもの）。
//
// ⚠️ **検査が無かったので壊した**＝共有へ寄せるときにテンプレートの入れ子を書き損ね、
// `${JSON.stringify(text)}` が**そのままの文字**として埋まった（アプリ側で SyntaxError）。
// **組み立てた式の形を見る検査**があれば、走らせる前に気づけた。
import { describe, expect, it } from "vitest";
import { FIND_BY_TEXT } from "./cdp.mjs";

describe("画面の言葉で要素を探す式", () => {
  // ⚠️ **差し込みが残っていないこと**＝これが今回の壊れ方そのもの。
  it("差し込みが解けている（`${` が残っていない）", () => {
    expect(FIND_BY_TEXT("新しい動画を作る"), "テンプレートの差し込みが文字のまま残っている").not.toContain("${");
  });

  it("探す言葉が埋まっている", () => {
    expect(FIND_BY_TEXT("新しい動画を作る")).toContain('"新しい動画を作る"');
  });

  // ⚠️ **引用符や改行を含む言葉でも壊れない**＝`JSON.stringify` に通しているか。
  it("引用符を含む言葉でも壊れない", () => {
    const e = FIND_BY_TEXT('「動画」を"作る"');
    expect(e).toContain('\\"作る\\"');
    expect(() => new Function(`return ${e.replace("document.querySelectorAll", "[].concat")}`)).not.toThrow();
  });

  // ⚠️ **完全一致を先に見る**＝部分一致だけだと、長いラベルに埋もれた別の要素を押す。
  it("完全一致を先に、部分一致を後に見る", () => {
    const e = FIND_BY_TEXT("保存");
    // ⚠️ **在ることを先に見る**（変異チェックで生き残った）＝`indexOf` は無いと -1 を返すので、
    //   順番だけ見ていると**完全一致を丸ごと外しても緑**になる。
    expect(e, "完全一致で探していない").toContain("=== want");
    expect(e, "部分一致で探していない").toContain("includes(want)");
    expect(e.indexOf("=== want")).toBeLessThan(e.indexOf("includes(want)"));
  });

  // ⚠️ **画面の真ん中へ寄せる**＝スクロールの外にあると、押せても録画に写らない。
  it("見つけたら画面の中へ寄せる", () => {
    expect(FIND_BY_TEXT("保存")).toContain("scrollIntoView");
  });
});
