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
import { bannedTermsIn, hasJapanese, screenTextsIn } from "../test/uiTerms";

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
 * ⚠️ **走る所と自己検査で二重に書かない**（#1026・変異チェックで露見）＝別々に書くと、
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
  // ⚠️ **`src/app` を丸ごと歩く**（#1026 レビュー由来 🟡）＝`screens`/`components` だけでは
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

  // ⚠️ **自己検査も走る所と同じ道を通す**（#1174 レビュー由来 ℹ️）＝ここだけ**自前の正規表現**
  //    （旧方式の写し）で拾っていたので、`screenTextsIn` を狭めても**この検査は緑のまま**だった。
  //    見分けを1か所へ寄せた意味が半分消える（このリポジトリで繰り返している型）。
  it("走査が空振りしていない（日本語を拾えている）", () => {
    // ⚠️ **拾えていないのに緑**を作らない＝走査が壊れたら、下の検査は無条件で通る。
    const sample = readFileSync(join(process.cwd(), "src", "app", "screens", "HomeScreen.tsx"), "utf8");
    const japanese = screenTextsIn(sample).filter((t) => hasJapanese(t));
    expect(japanese.length, "画面から日本語を1つも拾えていない＝走査が壊れている").toBeGreaterThanOrEqual(10);
  });

  // ⚠️ **下限では足りない**（#1142）＝拾い方を1段まるごと外しても、**見つかる数が減るだけ**で
  //    「見つかったものは禁止語を含まない」は成り立つので緑のまま通る（同じ型を #1130 で踏んだ）。
  //    増減したら、そのぶんの対応（新しい文言か、拾い方が狭まったか）を確かめてからこの数を直す。
  // ⚠️ **増えた分と減った分の**両方**を書く**（#1174 レビュー由来 🟡）＝差し引きだけ書くと、
  //    その裏で**取りこぼしが増えていても気づけない**（実際、最初の版は JSX のタグを正規表現と
  //    読んで**画面のラベルを 28 件落として**いたのに、差し引きは +278 で増えて見えていた）。
  // ⚠️ **167 file で 1907 → 2221**（#1142）＝**拾い増し 342／取りこぼし 28**。
  //    取りこぼし 28 はすべて**旧方式の誤検出**＝開発用の記録（`[asset] …`）と、
  //    引用符の対を取り違えて出来ていた**コードの塊**（`s.doc != null);\n  const addDisabled …`）。
  // ⚠️ **2221 → 2222**（#1154）＝「この瞬間を写真にする」の欄に、解いている間の
  //    「動画を読み込んでいます…」を足したぶん（増えた 1 件・減った 0 件）。
  // ⚠️ **2222 → 2225**（#1169）＝呼び名を定数へ寄せたぶん。組み立て（`${…}`）にすると
  //    1つの文が**前後のかけらに割れる**ので、拾える数だけが増える（画面に出る文は変わらない）。
  it("拾えた文言の数が変わっていない（実数で留める）", () => {
    const n = screenFiles().reduce((acc, p) => acc + screenTextsIn(readFileSync(p, "utf8")).length, 0);
    // ⚠️ **+11**＝作業範囲（#1193）＝ボタン4つ＋「範囲をやめる」＋それぞれの説明と、
    //   押す前の断り（「先に…範囲を決めてください」）。⚠️ **どれも画面の言葉**
    //   （`I`/`O`/`Shift+Delete` はキーの名前＝実装用語ではない）。
    // ⚠️ **さらに +1**（PR #1199 レビュー 🟡）＝**範囲の幅がゼロ**のときの断り。
    //   抜けるとドメインの `notFound`（「その部品は…」）が出て、**無関係な言葉が漏れる**。
    // ⚠️ **+15**（ADR-0044・#1192）＝「見え方（色・重ね方）」の欄＝調整4つの名前と、
    //   重ね方の選択肢4つ（「重ねて暗く」「重ねて明るく」「コントラストを強める」「光を足す」）と、
    //   欄の見出し・「重ね方」、それに手引きの文（**太字で割れて 5 かけら**になる）。
    //   ⚠️ **減った分は 0**（数え直して確かめた＝差し引きだけでは取りこぼしが隠れる）。
    // ⚠️ **+1**（#1204）＝声がまだ作られていないときの断り（頼まれた回だけ出る）。
    // ⚠️ **+1**（#1222）＝上限を超えた動画案を取り込まなかったときの見出し
    //（`GENERATE_TOO_LONG_TITLE`＝「作成に失敗」ではない＝作れてはいる）。
    //   ⚠️ **減った分は 0**（数え直して確かめた）。
    // ⚠️ **2265 → 2260**（#1228）＝ゆうこの立ち絵を入れたぶんの差し引き。
    //   足した＝画面側で出す顔を指定した3か所（`pose` の値）と、`data/yukoImages.ts` の絵の道のり。
    //   減った＝同ファイルから**使わない絵を外した**ぶん（原本は `assets/yuko/poses/` に残してある）。
    //   ⚠️ **どれも画面に出る言葉ではない**＝この走査は画面まわりのファイルの文字列を数えるので、
    //   出ない文字でも数に乗る。**数だけ合わせず、増減の中身をここに書いてから**動かすこと。
    // ⚠️ **2260 → 2322**（#1229）＝「使い方」を作り、帯の「準備中」を片づけたぶん。
    //   **足した＝+82**：`data/helpGuide.ts` 57（操作案内の本文）／`screens/HelpScreen.tsx` 9（節の見出し等）／
    //   `screenTitles.ts` 16（`App.tsx` から**移した**画面名。増えたのは「使い方」1つだけ）。
    //   **減った＝-20**：`App.tsx` 22→8（画面名を上へ移した＝-14）／`Sidebar.tsx` 14→8（-6＝
    //   「準備中です」×3・「準備中」×3・「ヘルプ」・「お問い合わせ」・「お知らせ」・「このアプリについて」を外し、
    //   画面名は `SCREEN_TITLES` を引く形にした）。
    //   ⚠️ **差し引きだけで合わせていない**＝旧版（`git show HEAD:`）と新版を同じ拾い方で数え直して、
    //   82 - 14 - 6 = 62 が実測の差（2322-2260）と一致することを確かめた。
    // ⚠️ **2322 → 2323**（#1243 レビュー対応）＝画面の形・動画の種類の名前を `uiLabels.ts` へ寄せ、
    //   案内（`helpGuide.ts`）の文を直したぶん。**旧版（`git show HEAD:`）と新版を同じ拾い方で数え直した**：
    //   `helpGuide.ts` 57→62（外部送信の説明を条件つきに直して1行増えた／選択肢は文言を引く形にしたので
    //   1つの文が「文＋差し込み」に割れる）・`uiLabels.ts` 324→328（名前4つを引き取った）・
    //   `WizardScreen.tsx` 78→74・`DraftScreen.tsx` 48→46・`LooksScreen.tsx` 59→57（写しを外した）。
    //   ＋5 ＋4 −4 −2 −2 = **+1**。
    // ⚠️ **2323 → 2324**（#1244）＝動画案づくりが混み合っているときの文を1つ足した
    //   （`GeneratingScreen`「いま混み合っているので、少し待ってからもう一度お願いしています。…」）。
    expect(n, "拾えた文言の数が変わった（増減とも、対応を確かめてから数を更新する）").toBe(2324);
  });

  it("走査が画面の外枠まで届いている（`src/App.tsx` を見ている）", () => {
    // ⚠️ **実機で気づくまで、ここが走査の外だった**（#1026・2026-09-10）＝
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

  it("画面の名前を「動画」に統一したことを、物差しで留める（#1026）", () => {
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
