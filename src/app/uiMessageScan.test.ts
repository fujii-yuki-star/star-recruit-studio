// 画面・外部連携に**直に書かれた「次の行動つきの断り」**が、`15 §6` の表に載っているか（#978）。
//
// ⚠️ **`errorStateTable.test.ts` の走査は `src/domain` の `warn(` だけ**＝
// 「実装にある文言は必ず表にも行がある」の向きは、**手で登録した families のキー**しか回らないので、
// `app/`・`infrastructure/` に直書きされた断りは**表にも検査にも載らない**。
// 同じ形で2度塞いでいる（α-6 🟡18・α-7 🟡）＝**走査を広げないと3度目が来る**。
//
// ⚠️ **見分け方は「次の行動が書いてあるか」**（§2-5）＝断りの文は必ず次の行動で終わる。
// ラベルやボタン名はそう書かないので、これで実用上は分かれる。
// ⚠️ **完璧な判別はできない**＝取りこぼす形（組み立てる文・関数が返す文）は残る。
// そこは `codeMessages()` の登録が受け持つ＝**この検査は「直書きの取りこぼし」だけを見る**。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** 次の行動が書いてある文か（§2-5 の断りの形）。 */
const looksLikeGuidance = (text: string): boolean =>
  /ください|もう一度|選び直/.test(text) && text.length >= 12;

interface Found {
  name: string;
  text: string;
  where: string;
}

/**
 * 1つのファイルの本文から、**断りとして書かれた文**を拾う。
 *
 * ⚠️ **純粋関数として切り出す**＝ディレクトリを歩く形のままだと、
 * 「拾い方を消しても、いまのコードには漏れが無いので緑」になる（実際に変異チェックで緑だった）。
 * ここを直接叩けば、**拾い方そのもの**を検査できる。
 */
export function guidanceLiteralsIn(
  text: string,
  labels: ReadonlyMap<string, string> = new Map(),
): { name: string; text: string }[] {
  const out: { name: string; text: string }[] = [];
  // ① 名前を付けた定数（`export const NAME = "…"`）。
  for (const m of text.matchAll(/^(?:export )?const ([A-Z_][A-Z_0-9]*)(?::[^=]+)? =\s*(['"])(.+?)\2;?$/gm)) {
    if (looksLikeGuidance(m[3]!)) out.push({ name: m[1]!, text: m[3]! });
  }
  // ② **名前を付けずにその場へ書いた文**（#981 レビュー 🟡）＝定数の形だけを見ていたので、
  // `setError("…")` / `return { error: "…" }` / `throw` に**直に書いた文が漏れていた**。
  // ⚠️ **断りの受け口へ渡しているものに絞る**＝ただ引用符の対を取ると、入力のヒント・見出し・
  // 下書きの中身まで拾ってしまい（実測 86 件）、全部を表へ載せると表の意味が消える
  //（`15 §6` は「エラー・状態」の正典であって、画面の文字すべての一覧ではない）。
  for (const m of text.matchAll(
    /(?:set\w*Error\(|\w*[eE]rror:\s*|throw new \w*Error\(|Message:\s*|\?\?\s*)(['"])((?:[^'"\\r\n]|\.){12,}?)\1/g,
  )) {
    const literal = m[2]!;
    if (!looksLikeGuidance(literal)) continue;
    if (out.some((o) => o.text === literal)) continue; // 定数として既に拾っている
    out.push({ name: `（その場に書いた文）${literal.slice(0, 12)}…`, text: literal });
  }
  // ③ **画面に直に書いた文**（#1051 ③）。①② は**引用符の中**しか見ていないので、
  // `<p>…ください</p>` のように**タグの間へ直に書いた文**はこの段の外だった。
  //
  // ⚠️ **拾う範囲を「断りの器の中」へ絞る**（#1051 の「誤検出を出さない形を先に決める」の答え）。
  // 文の形（`ください` で終わる）だけで拾うと、**入力のヒント・見出し・手順の説明**まで入る
  //（実測 29 件。例：「短い言葉で複数入れてください」は欄のヒントであって断りではない）。
  // **断りは必ず断りの器に入る**（`notice` / `form-error` / `role="alert"`）ので、そこを錠にする（実測 9 件）。
  // ⚠️ **コメントを先に落とす**＝複数行の説明の**続きの行**は `//` で始まらないので、
  // 落とさないとコメントの中の文を拾ってしまう（実測で 8 件混ざった）。
  const body = resolveLabels(stripComments(text), labels);
  for (const m of body.matchAll(
    /(?:className="[^"]*(?:notice|form-error)[^"]*"|role="alert")([\s\S]{0,900}?)(?=\n\s*(?:<\/div>|<\/p>|<\/ul>|<\/span>|\)\}))/g,
  )) {
    for (const line of m[1]!.split("\n")) {
      // ⚠️ **行の中のタグを先に落とす**（PR #1079 レビュー）＝以前は「行が本文で始まる」形だけを
      // 見ていたので、`<span>…ください</span>` のように**1行に収まった断りを取りこぼしていた**。
      // 器の中なので、タグを落としても拾うのは断りの本文だけ。
      const t = line.replace(/<[^>]*>/g, "").trim();
      const inline = t.match(/^([^<>{}"`]+)$/);
      if (!inline) continue;
      const literal = inline[1]!.trim();
      if (!looksLikeGuidance(literal)) continue;
      if (out.some((o) => o.text === literal)) continue;
      out.push({ name: `（画面に直に書いた文）${literal.slice(0, 12)}…`, text: literal });
    }
  }
  return out;
}

/**
 * 画面に埋めた**呼び名の定数**（`{RELINK_ASSET_LABEL}` など）を、その文字へ戻す。
 *
 * ⚠️ **戻さないと、寄せたとたんに見えなくなる**（#1168）＝③ は「行の中に `{` が無い」ことを
 * 器の条件にしているので、**断りの中の言葉を1か所へ寄せる**（同じ呼び名で呼ぶ＝§6）だけで
 * その行が**丸ごと走査の外**へ落ちる。実際に、素材画面の「ファイルを選び直す」を定数へ寄せた回に
 * **素材画面のバナー1件**（`MaterialsScreen.tsx`）が黙って消えた
 *（数を実数で留めていたので赤くなったが、下限のままなら気づけなかった）。
 * ⚠️ **同じ回にもう1件減っていたのは別の原因**（#1168 レビュー 🟡＝当初「2件」と書いたのは誤り）＝
 * 断りの定数を**組み立てる形**（テンプレート）にしたので ① が拾えなくなったもの。
 * そちらは `errorStateTable` が**表と等値**で守る側なので、素の文字列へ戻して解決した。
 * ⚠️ **戻すのは呼び名だけ**＝値の入る差し込み（`{missingAssetIds.length}`）は文が定まらないので、
 * これまでどおり拾わない（表と等値で比べられない）。
 */
function resolveLabels(src: string, labels: ReadonlyMap<string, string>): string {
  return src.replace(/\{([A-Z_][A-Z_0-9]*)\}/g, (whole, name: string) => labels.get(name) ?? whole);
}

/**
 * `uiLabels.ts` の**呼び名**（UPPER_SNAKE の短い文字列）。
 *
 * ⚠️ **断りの文そのものは入れない**＝`*_MESSAGE` は `errorStateTable` が**表と等値**で守る側なので、
 * ここで差し戻すと同じ文を二重に数える。ここが要るのは「画面の言葉を寄せた呼び名」だけ。
 * ⚠️ **見るのは「1行・`"` 引用・`_LABEL` 終わり」だけ**＝`*_NOTE`／`*_TEXT` と名づけたり2行に折ると
 * 同じ穴が空く。**寄せ先は `*_LABEL` と名づける**こと（気づけはする＝実数の `FOUND_COUNT` が減って赤くなる）。
 * ⚠️ **差し戻しはどのファイルにも効く**ので、画面の中に**同名のローカル定数**を置くと、その画面に
 * 出ていない文を拾いうる。**衝突が無いことは下の検査で留める**（#1168 レビュー ℹ️＝
 * 「いまは衝突なし」と書くだけだと、次に衝突したとき `FOUND_COUNT` が動く理由が読めない）。
 */
function labelConstants(): ReadonlyMap<string, string> {
  const src = readFileSync(join(process.cwd(), "src", "app", "uiLabels.ts"), "utf8");
  const map = new Map<string, string>();
  for (const m of src.matchAll(/^export const ([A-Z_][A-Z_0-9]*_LABEL) =\s*"([^"]+)";$/gm)) map.set(m[1]!, m[2]!);
  return map;
}

/**
 * そのファイルが**自分で**持っている呼び名（`const X_LABEL = …`）の名前。
 *
 * ⚠️ **純粋関数として切り出す**＝歩く形のままだと、いま衝突が1つも無いので
 * **拾い方をまるごと外しても緑**になる（`guidanceLiteralsIn` と同じ理由）。
 */
export function localLabelNames(text: string): string[] {
  return [...text.matchAll(/^(?:export )?const ([A-Z_][A-Z_0-9]*_LABEL)\s*(?::[^=]+)?=/gm)].map((m) => m[1]!);
}

/**
 * 説明（コメント）を落とす。JSX の中の説明・ブロックコメント・行コメントの3つ。
 *
 * ⚠️ **行コメントは続きの行が `//` で始まらない**ので、行単位で見るだけでは落としきれない。
 * ここでは断りの器を鍵にするので、器の外にある説明はそもそも拾わない（二重の守り）。
 */
function stripComments(src: string): string {
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

/** `app`・`infrastructure` に**直に書かれた**断りを集める。 */
function directGuidanceConstants(): Found[] {
  const out: Found[] = [];
  const labels = labelConstants();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.tsx?$/.test(name) || name.includes(".test.")) continue;
      for (const f of guidanceLiteralsIn(readFileSync(p, "utf8"), labels)) out.push({ ...f, where: name });
    }
  };
  walk(join(process.cwd(), "src", "app"));
  walk(join(process.cwd(), "src", "infrastructure"));
  return out;
}

/**
 * 表の本文（行の照合ではなく、文が載っているかだけを見る）。
 *
 * ⚠️ **表の実体は `15 §6` から移した**（#1090 案C・2026-09-10）＝
 * `docs/yuko_recruit_docs/errors/error-state-table.tsv`。正典であることは変わらない。
 * ⚠️ **規則の側（`15 §6` 本文）も読む**＝退役の説明など、表の外に書いてある文がある。
 */
const tableText = (): string =>
  readFileSync(join(process.cwd(), "docs", "yuko_recruit_docs", "errors", "error-state-table.tsv"), "utf8") +
  "\n" +
  readFileSync(join(process.cwd(), "docs", "yuko_recruit_docs", "15_ERROR_STATE_MODEL.md"), "utf8");

// ⚠️ **表に載せない**と決めたものは、**理由を書いて明示的に外す**（黙って落とさない）。
// 増やすときは「なぜ表に無くてよいか」を必ず書く（空欄で増やせないよう検査する）。
const NOT_IN_TABLE: Record<string, string> = {
  // ── 断りではない「知らせ・案内」（#1051 ③）──
  // ⚠️ `15 §6` は**エラー・状態の正典**であって、画面の文字すべての一覧ではない。
  // 「何かができなかった」ではない文は、表へ載せると表の意味が薄まる。
  "（画面に直に書いた文）動画に声の表記が入りませ…":
    "クレジットを非表示にしたときの**注意**（ADR-0025）。失敗ではなく、選んだ結果の知らせ",
  "（画面に直に書いた文）送信してよい内容か、もう…":
    "外部送信の前に必ず通す確認の案内（§2-6）。状態ではなく手順",
  "（画面に直に書いた文）このたたき台はゆうこ（A…":
    "たたき台が AI の作ったものであることの知らせ。失敗ではない",
  "（画面に直に書いた文）時間の流れを細かく作ると…":
    "`TIMELINE_OVERLAY_RETIRED` の**次の行動の文**（行は表にある）。知らせ本体と別の行に分かれているだけ",
};

/** いま拾えている断りの数（実測）。 */
// ⚠️ **-2**＝見た目パターンの保存・削除の既定文を `uiLabels` の `templateSaveMessage` へ出したので、
// この走査（その場に書いた文）ではなく **`codeMessages()` の完全一致**（`errorStateTable`）が守る側へ移った。
// ⚠️ **さらに -2**（#1131）＝接続キーの既定文を `uiLabels` の `apiKeyMessage` へ出した。
// 走査（その場に書いた文）から**完全一致で守る側**（`errorStateTable` の `codeMessages`）へ移った。
const FOUND_COUNT = 91;

describe("画面に直書きした断りも、表に載っている（#978）", () => {
  const found = directGuidanceConstants();

  it("走査が空振りしていない（実数で留める）", () => {
    // ⚠️ **拾えていないのに緑**を作らない（走査が壊れたら、下の検査は無条件で通る）。
    // ⚠️ **下限では足りない**（PR #1130 の変異チェックで生き残った）＝`5 以上` にしていたので、
    // **拾い方を1段まるごと外しても緑**だった（見つかる数が減るだけで、見つかったものは表にある）。
    // これは `errorStateTable.test.ts` が「下限ではなく実数で固定する」と決めたのと**同じ型**。
    // 増減したら、そのぶんの対応（表へ足す／外した理由を書く）を確かめてからこの数を直す。
    expect(found.length, "拾えた断りの数が変わった（増減とも、対応を確かめてから数を更新する）").toBe(FOUND_COUNT);
  });

  it("拾った断りは、表に載っているか、理由つきで外してある", () => {
    const md = tableText();
    const missing = found
      .filter((f) => !NOT_IN_TABLE[f.name])
      .filter((f) => !md.includes(f.text.replace(/。$/, "")))
      .map((f) => `${f.name}（${f.where}）: ${f.text}`);
    expect(missing, "表に無い断りがある（`15 §6` へ行を足すか、理由つきで NOT_IN_TABLE へ）").toEqual([]);
  });

  it("外した理由が空でない", () => {
    // ⚠️ **空を見つけられることも見る**（門番の自己検査）＝いま空の行が1つも無いので、
    // 上の行だけだと**判定を緩めても緑**になる（実際に変異チェックで生き残った）。
    const hasReason = (why: string): boolean => why.length > 0;
    expect(hasReason(""), "空の理由を見つけられない").toBe(false);
    for (const [name, why] of Object.entries(NOT_IN_TABLE)) {
      expect(hasReason(why), `${name} を外した理由が書かれていない`).toBe(true);
    }
  });

  // ⚠️ **差し戻しの名前が、画面のローカル定数と衝突していない**（#1168 レビュー ℹ️）＝
  //    `resolveLabels` は**どのファイルの** `{UPPER_SNAKE}` にも効くので、画面の中に同名の
  //    `*_LABEL` を置くと、**その画面に出ていない文**を「拾った断り」として表へ要求しうる。
  it("寄せた呼び名が、画面のローカル定数と衝突していない", () => {
    const shared = new Set(labelConstants().keys());
    const collisions: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!/\.tsx?$/.test(name) || name.includes(".test.")) continue;
        if (p.endsWith(join("src", "app", "uiLabels.ts"))) continue; // 定義元
        for (const n of localLabelNames(readFileSync(p, "utf8"))) if (shared.has(n)) collisions.push(`${name}: ${n}`);
      }
    };
    walk(join(process.cwd(), "src", "app"));
    walk(join(process.cwd(), "src", "infrastructure"));
    expect(collisions, "`uiLabels` と同じ名前のローカル定数がある（差し戻しが別の文に効く）").toEqual([]);
    expect(shared.size, "寄せた呼び名を1つも拾えていない").toBeGreaterThanOrEqual(1);
  });

  // ⚠️ **見つけられることも見る**（`guards-blind-not-red`）＝いま衝突が1つも無いので、
  //    上の検査だけでは**拾い方をまるごと外しても緑**だった（実際に変異チェックで生き残った）。
  it("衝突を見つけられる（拾い方そのものを見る）", () => {
    expect(localLabelNames(`const RELINK_ASSET_LABEL = "別のもの";`)).toEqual(["RELINK_ASSET_LABEL"]);
    expect(localLabelNames(`const DELETE_LABEL: string = "消す";`)).toEqual(["DELETE_LABEL"]);
    // 呼び名でないものは拾わない（`*_MESSAGE` は差し戻しの対象外）
    expect(localLabelNames(`const SOME_MESSAGE = "…ください";`)).toEqual([]);
  });

  it("外したまま実装から消えた行が残っていない（控えが腐らない）", () => {
    const names = new Set(found.map((f) => f.name));
    const stale = Object.keys(NOT_IN_TABLE).filter((n) => !names.has(n));
    expect(stale, "実装から消えたのに外し続けている").toEqual([]);
  });
});

// ⚠️ **拾い方そのものを検査する**（#981 レビュー）＝ディレクトリを歩く形だけだと、
// 「拾い方を消しても、いまのコードには漏れが無いので緑」になる（実際に変異チェックで緑だった）。
describe("断りの拾い方（#981 レビュー）", () => {
  it("名前を付けた定数を拾う", () => {
    const found = guidanceLiteralsIn(`export const X_FAILED = "できませんでした。もう一度お試しください。";`);
    expect(found.map((f) => f.name)).toEqual(["X_FAILED"]);
  });

  it("その場に書いた文も拾う（`setError` / `error:` / `throw`）", () => {
    const cases = [
      `setError("外せませんでした。設定から選び直してください。");`,
      `return { doc, error: "見つかりませんでした。設定から選び直してください。" };`,
      `throw new TimelineLoadError("読み取れませんでした。一覧から選び直してください。");`,
    ];
    for (const src of cases) expect(guidanceLiteralsIn(src), src).toHaveLength(1);
  });

  it("画面に直に書いた文も拾う（断りの器の中だけ）", () => {
    const inNotice = `
      <p className="notice notice-warn" role="alert">
        選んだ範囲に場面がありません。範囲を選び直してください。
      </p>`;
    expect(guidanceLiteralsIn(inNotice)).toHaveLength(1);
  });

  it("1行に収まった断りも拾う（`<span>…</span>` の形）", () => {
    // ⚠️ **この形を取りこぼしていた**（PR #1079 レビュー）＝行が本文で始まる形だけを見ていた。
    // 実際にこれで 7 件の断りが見つかり、表へ行を足すことになった。
    const oneLine = `
      <div className="notice notice-warn" role="alert">
        <span>BGMを再生できませんでした。別のBGMを選ぶか、もう一度お試しください。</span>
      </div>`;
    expect(guidanceLiteralsIn(oneLine)).toHaveLength(1);
  });

  // ⚠️ **寄せた呼び名を戻せることを、拾い方の側で見る**（#1168）＝これが無いと、
  //    「画面の言葉を1か所へ寄せる」たびに走査が黙って狭まる。
  it("埋めた呼び名は、その文字へ戻してから拾う", () => {
    const inNotice = `
      <p className="notice notice-warn" role="alert">
        その素材を選んで「{RELINK_ASSET_LABEL}」から入れ直してください。
      </p>`;
    const labels = new Map([["RELINK_ASSET_LABEL", "ファイルを選び直す"]]);
    expect(guidanceLiteralsIn(inNotice, labels).map((f) => f.text)).toEqual([
      "その素材を選んで「ファイルを選び直す」から入れ直してください。",
    ]);
    // 呼び名を知らなければ、これまでどおり拾わない（差し込みの中身が定まらない）
    expect(guidanceLiteralsIn(inNotice)).toEqual([]);
  });

  it("値の入る差し込みは戻さない（文が定まらないので拾わない）", () => {
    const inNotice = `
      <p className="notice notice-warn" role="alert">
        {count}つの素材が見つかりません。選び直してください。
      </p>`;
    expect(guidanceLiteralsIn(inNotice, new Map([["RELINK_ASSET_LABEL", "ファイルを選び直す"]]))).toEqual([]);
  });

  it("断りの器の外にある文は拾わない（欄のヒント・手順の説明）", () => {
    const hint = `
      <p className="field-hint">
        短い言葉で複数入れてください。あとから直せます。
      </p>`;
    expect(guidanceLiteralsIn(hint)).toEqual([]);
  });

  it("説明（コメント）の中の文は拾わない（続きの行も）", () => {
    const commented = `
      {/* ⚠️ ここでは「もう一度お試しください」とは書かない
          ＝何度押しても直らない行動を勧めることになるので、別の手を出してください。 */}
      <p className="notice" role="alert">何もありません</p>`;
    expect(guidanceLiteralsIn(commented)).toEqual([]);
  });

  it("入力のヒント・見出し・下書きは拾わない（表の意味を薄めない）", () => {
    const cases = [
      `<input placeholder="会社名を入力してください" />`,
      `const HINT = "短い";`,
      `const SAMPLE = { narration: "人物が写っている素材があります。確認してください。" };`,
    ];
    for (const src of cases) expect(guidanceLiteralsIn(src), src).toEqual([]);
  });

  it("同じ文を二重に数えない（定数とその場書きが同じとき）", () => {
    const src = `const A_FAILED = "できませんでした。もう一度お試しください。";\nsetError("できませんでした。もう一度お試しください。");`;
    expect(guidanceLiteralsIn(src)).toHaveLength(1);
  });
});
