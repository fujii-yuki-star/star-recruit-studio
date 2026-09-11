// 画面・部品に**直に書かれた文字**へ、実装用語が混じっていないか（§2-3・`16 §1`・`06 §3`）。
//
// ⚠️ **既存の走査は届いていなかった**（UI/UX レビュー 🔴）＝
// `uiLabels.test.ts` の禁止語走査は **`uiLabels.ts` の Record と共有関数**しか見ておらず、
// `uiMessageScan.test.ts` は **「次の行動つきの断り」**しか見ない。
// そのため **`<label>ナレーション音量</label>` のような画面直書きのラベルは、どちらにも掛からなかった**
//（実際に2か所〔音量のラベル・見わたす列の添え字〕が画面に出ていた）。
//
// ⚠️ **見るのは「画面に出る文字」だけ**＝識別子・型・コメント・import は対象外（§2-3 の射程）。
// 完璧な判別はできないので、**日本語を含む文字列**に絞り、そこへ禁止語が入っていないかだけを見る。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
// ⚠️ **拾い方と禁止語は1か所**（`src/test/uiTerms.ts`）＝Rust が返す文を見る門番
// （`src/test/rustUserMessageGuard.test.ts`）も同じものを使う（#1111）。
import { bannedTermsIn, hasJapanese } from "../test/uiTerms";

/**
 * 1つのファイルから、画面に出る文字に混じった禁止語を拾う。
 *
 * ⚠️ **1つの関数にまとめる**（#1111）＝下の「拾い方」の検査が**この道**を通るようにするため。
 * 走る所と自己検査が別の道だと、走る所だけ物差しを狭めても誰も気づかない（変異チェックで露見）。
 */
export function screenTermHitsIn(text: string): { word: string; text: string }[] {
  return bannedTermsIn(text);
}

/** 見つかった禁止語（どのファイルの、どの文か）。 */
interface Hit {
  word: string;
  text: string;
  where: string;
}

/**
 * 走査するファイル（**画面・部品・画面の外枠**＝利用者が見る層）。
 *
 * ⚠️ **走る所と自己検査で二重に書かない**（#1109 ⑤・変異チェックで露見）＝別々に書くと、
 * **走る所だけ棚を減らしても**自己検査は緑のまま（実際にそうなった）。**1つの関数**にして、
 * 下の「走査が届いている」検査も**この道**を通す。
 *
 * ⚠️ **画面の外枠も見る**（実機で発覚 2026-09-10）＝`src/App.tsx` は**上の帯に出る画面名の一覧**を
 * 持っているのに走査の外だった。「プロジェクト」を画面から消したつもりが、**上の帯にだけ残っていた**。
 */
export function screenFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string, recurse: boolean): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (recurse) walk(p, true);
        continue;
      }
      if (!/\.tsx?$/.test(name) || name.includes(".test.")) continue;
      out.push(p);
    }
  };
  // ⚠️ **`src/app` を丸ごと歩く**（#1109 ⑤ レビュー由来 🟡）＝`screens`/`components` だけでは
  // **文言の置き場そのもの**（`src/app/uiLabels.ts`）と `src/app/store/**` が走査の外だった。
  // 前例＝`src/app/uiMessageScan.test.ts` は `src/app` と `src/infrastructure` を丸ごと歩いている。
  walk(join(process.cwd(), "src", "app"), true);
  walk(join(process.cwd(), "src", "infrastructure"), true);
  // 画面の外枠（`src/App.tsx`）＝`src` 直下は入れ子まで行かない（`domain`/`renderer` は描画の層）。
  walk(join(process.cwd(), "src"), false);
  return out;
}

/** 走査の対象（画面と部品＋画面の外枠＝利用者が見る層）。 */
function screenHits(): Hit[] {
  return screenFiles().flatMap((p) =>
    screenTermHitsIn(readFileSync(p, "utf8")).map((h) => ({ ...h, where: basename(p) })),
  );
}

// ⚠️ **出してよいものは、理由を書いて明示的に外す**（黙って落とさない）。
// クレジット表示は技術語が出てよい（ADR-0003・`13 §4`）。
const ALLOWED: Record<string, string> = {
  "AboutScreen.tsx": "クレジット表示は技術語が出てよい（ADR-0003・`13 §4`）",
};

describe("画面に直書きした文字に、実装用語が混じっていない（§2-3）", () => {
  it("免除は1件だけ（増やすときは、この数も一緒に動かす）", () => {
    // ⚠️ **無制限の抜け道になっていた**（レビュー由来 🟡）＝`ALLOWED` に1行足すだけで、
    // そのファイルの違反が**全部**消える。改名を黙って戻せる道が、走査の棚とは別に残っていた。
    // ⚠️ **実数で留める**＝増やすなら、なぜ免除してよいかを書いたうえでこの数も動かす。
    expect(Object.keys(ALLOWED)).toEqual(["AboutScreen.tsx"]);
  });

  it("走査が空振りしていない（日本語を拾えている）", () => {
    // ⚠️ **拾えていないのに緑**を作らない＝走査が壊れたら、下の検査は無条件で通る。
    const sample = readFileSync(join(process.cwd(), "src", "app", "screens", "HomeScreen.tsx"), "utf8");
    const code = sample.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const japanese = [...code.matchAll(/(['"])((?:[^'"\\\r\n]|\\.)+)\1/g)].filter((m) => hasJapanese(m[2]!));
    expect(japanese.length, "画面から日本語を1つも拾えていない＝走査が壊れている").toBeGreaterThanOrEqual(10);
  });

  it("走査が画面の外枠まで届いている（`src/App.tsx` を見ている）", () => {
    // ⚠️ **実機で気づくまで、ここが走査の外だった**（#1109 ⑤・2026-09-10）＝
    // `src/App.tsx` は**上の帯に出る画面名の一覧**を持っているのに見ていなかったので、
    // 「プロジェクト」を画面から消したつもりが**上の帯にだけ残っていた**。
    // ⚠️ **走査そのものを見る**＝外しても、いまのコードに違反が無い限り赤くならない。
    const walked = screenFiles().map((p) => basename(p));
    expect(walked, "画面（screens）を1つも見ていない").toContain("HomeScreen.tsx");
    expect(walked, "部品（components）を1つも見ていない").toContain("Sidebar.tsx");
    expect(walked, "画面の外枠（`src/App.tsx`）を見ていない").toContain("App.tsx");
    // ⚠️ **入れ子の部品まで届いているか**（レビュー由来 🟡）＝上の3つは**再帰しなくても**見つかる
    // 位置にあるので、再帰を止めても緑のままだった。**下の階層のファイル**で留める。
    expect(walked, "入れ子の部品（`components/layout/`）を見ていない").toContain("PanelLayoutView.tsx");
  });

  it("禁止語が画面に出ていない", () => {
    const bad = screenHits()
      .filter((h) => !ALLOWED[h.where])
      .map((h) => `${h.where}: 「${h.word}」← ${h.text}`);
    expect(bad, "画面に出す言葉を `16 §1`／`06 §3` の置き換え表に合わせてください").toEqual([]);
  });
});

// ⚠️ **拾い方そのものを検査する**（#981 で学んだ形）＝
// ディレクトリを歩く形だけだと、拾い方を消しても「いまのコードに漏れが無いので緑」になる。
describe("拾い方（画面の直書き）", () => {
  it("JSX のテキストを拾う", () => {
    expect(screenTermHitsIn(`<label>ナレーション音量</label>`)).toHaveLength(1);
  });

  it("画面の名前を「動画」に統一したことを、物差しで留める（#1109 ⑤）", () => {
    // ⚠️ **一覧から語を落とすと、改名が黙って戻せる**（変異チェックで生き残った）。
    expect(screenTermHitsIn(`<span>保存済みのプロジェクトは一覧から</span>`).map((h) => h.word)).toEqual(["プロジェクト"]);
    expect(screenTermHitsIn(`<span>保存済みの動画は一覧から</span>`)).toEqual([]);
  });

  it("文字列リテラルを拾う（属性・データの値）", () => {
    expect(screenTermHitsIn(`const LANES = [{ sub: "ナレーション" }];`)).toHaveLength(1);
    expect(bannedTermsIn(`<span title="ナレーションの設定" />`)).toHaveLength(1);
  });

  it("開発用の記録は拾わない（画面に出ない＝誤検出にしない）", () => {
    // ⚠️ 走査を `src/app` 丸ごとへ広げたら、記録の文で赤くなった（レビュー由来 🟡の対応で判明）。
    expect(screenTermHitsIn('console.warn("[timeline] 保存内容がスキーマに未適合:", e);')).toEqual([]);
    // ⚠️ **記録を落としても、その外側の文は残す**＝落としすぎると本物を見逃す。
    expect(
      screenTermHitsIn('console.warn("[x] スキーマに未適合");\nconst t = "ナレーション音量";').map((h) => h.word),
    ).toEqual(["ナレーション"]);
    // ⚠️ **括弧の釣り合いを数える**＝中で組み立てていても、その呼び出しの終わりまで落とす。
    expect(screenTermHitsIn('console.error("[x]", String(1), `スキーマ`);')).toEqual([]);
  });

  it("コメントは拾わない（説明文に実装用語が出てよい）", () => {
    expect(bannedTermsIn(`// ナレーションの音量を持つ\nconst x = 1;`)).toEqual([]);
    expect(bannedTermsIn(`/** ナレーション（内部用語） */\nconst y = 2;`)).toEqual([]);
  });

  it("識別子は拾わない（日本語を含まないもの）", () => {
    expect(bannedTermsIn(`const narrationVolume = 1; type NarrationLine = {};`)).toEqual([]);
  });

  it("同じ文を二重に数えない", () => {
    expect(bannedTermsIn(`<b>ナレーション音量</b>\n<i>ナレーション音量</i>`)).toHaveLength(1);
  });
});
