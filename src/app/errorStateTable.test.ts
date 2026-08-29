// `15 §6`（エラーコード表）の**利用者に出す文言**が、実装の文字列と一致していることを機械で守る（#855）。
//
// ⚠️ **目視では6回すり抜けた**＝挙動と正典を直したのに表だけ古いまま、が繰り返し起きている
// （直近は PR #854＝「正典と実装のズレを消す」PR 自身が同じズレを作っていた）。
// 既存の `uiLabels.test.ts` の走査は **§2-3 の禁止語**しか見ておらず、**文言そのものの一致は対象外**
// だったので、機械層は緑のまま通っていた。ここがその穴を塞ぐ。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  alpha6Message, bakeNoteMessage, editBlockedMessage, exportBlockedMessage,
  userFontMissingMessage, userFontUnreadableMessage,
} from "./uiLabels";
import { READING_DICT_SYNC_FAILED } from "../infrastructure/voiceProviders/readingDictSync";
import { READING_DICT_UNREADABLE } from "../infrastructure/readingDictFs";
import { EXPORT_CLEANUP_PENDING_MESSAGE, OTHER_EXPORT_RUNNING_MESSAGE } from "./store/exportLock";

/**
 * 表の行に**見える**すべての行（ゆるい判定）。
 *
 * ⚠️ `readErrorTable` の**厳密な**判定が取りこぼした行を炙り出すために使う（PR #862 レビュー ℹ️1）。
 * 厳密な側は区切りの空白まで固定しているので、書き方が少しゆれた行を**黙って無視**しうる。
 * 拾えていない行は**検査の外に落ちる**＝このテストの趣旨（何も黙って逃がさない）に反する。
 */
function looseErrorRows(): string[] {
  const md = readFileSync(join(process.cwd(), "docs/yuko_recruit_docs/15_ERROR_STATE_MODEL.md"), "utf8");
  return md.split("\n").filter((line) => /^\|\s*`[A-Z_]+`/.test(line));
}

/** `15 §6` の表：コード → 「ユーザー向け文言」の列（4列目）。 */
function readErrorTable(): Map<string, string> {
  const md = readFileSync(join(process.cwd(), "docs/yuko_recruit_docs/15_ERROR_STATE_MODEL.md"), "utf8");
  const rows = new Map<string, string>();
  for (const line of md.split("\n")) {
    const m = /^\| `([A-Z_]+)` \|/.exec(line);
    if (!m) continue;
    const cells = line.split("|");
    // | code | severity | 既定の自動対応 | ユーザー向け文言 | 由来 |  → 文言は index 4
    if (cells.length < 5) continue;
    rows.set(m[1], (cells[4] ?? "").trim());
  }
  return rows;
}

/**
 * コード側の「表と1対1で結べる」文言。
 *
 * ⚠️ **締めが状況で変わる文は入れない**＝`lockedTrackMessage`（動かす/中身/削除）・
 * `volumePointsTooManyMessage`（分けられる部品の有無）・`missingTemplateMessage`（件数）・
 * `hiddenTrackDuplicateMessage` は**1つの表の行に対して複数の文**を返すので、等値では守れない。
 * それらは `uiLabels.test.ts` の禁止語走査が引き続き見ている（守り方が違うだけで対象外ではない）。
 */
function codeMessages(): Record<string, string> {
  return {
    ...editBlockedMessage,
    ...exportBlockedMessage,
    ...bakeNoteMessage,
    EXPORT_CLEANUP_PENDING: EXPORT_CLEANUP_PENDING_MESSAGE,
    EXPORT_OTHER_RUNNING: OTHER_EXPORT_RUNNING_MESSAGE,
    // α-6 で足したぶん（α-6 出口監査 🟡18）＝画面や `infrastructure` に直書きされていて
    // この走査の外にあり、**既に1件ズレていた**（句点の有無）。
    ...alpha6Message,
    READING_DICT_SYNC_FAILED,
    READING_DICT_UNREADABLE,
    // ⚠️ **件数が入る文は `N` を差し込んで比べる**（表は読みやすさのため ` N ` と空白つきで書く）。
    USER_FONT_MISSING: userFontMissingMessage(" N "),
    USER_FONT_UNREADABLE: userFontUnreadableMessage(" N "),
  };
}

/**
 * **Rust 側**に直書きされている利用者向け文言（コードから import できない）。
 *
 * ⚠️ **読み飛ばさない**（α-6 出口監査 🟡18）＝「TS から参照できないから対象外」にすると、
 * 表と実装のズレが**Rust 側だけ**残る（`import_user_font` の断りは実際に画面へ出る）。
 * ソースを読んで literal を取り出し、同じように突き合わせる。
 */
function rustMessages(): Record<string, string> {
  const rs = readFileSync(join(process.cwd(), "src-tauri/src/lib.rs"), "utf8");
  const pick = (re: RegExp): string => {
    const m = re.exec(rs);
    if (!m) throw new Error(`Rust 側の文言が見つかりません: ${re}`);
    return m[1];
  };
  return {
    USER_FONT_IMPORT_FAILED: pick(/return Err\("(このファイルは文字の形として読み込めません。[^"]*)"\.to_string\(\)\)/),
    // `{what}` は「よく使う素材」「取り込んだ文字の形」のどちらかが入る＝表は〔…〕で両方を書くので、
    // 差し込みの手前までを比べる（`format!` の中身をそのまま取り出す）。
    MANIFEST_UNREADABLE: pick(/format!\("\{what\}(の一覧を読めませんでした。[^"]*)"\)/),
  };
}

/** 表は文末の「。」を落とす流儀（`EXPORT_OTHER_RUNNING` ほか既存行がすべてこの形）。 */
const norm = (s: string): string => s.replace(/。$/, "").trim();

describe("15 §6 の表と実装の一致（#855）", () => {
  it("表の文言と実装の文字列が一致する（片方だけ直したら落ちる）", () => {
    const rows = readErrorTable();
    const mismatched: string[] = [];
    for (const [code, message] of Object.entries(codeMessages())) {
      const cell = rows.get(code);
      if (cell == null) continue; // 表に無い件は次のテストが見る
      if (norm(cell) !== norm(message)) {
        mismatched.push(`${code}\n  表  : ${cell}\n  実装: ${message}`);
      }
    }
    // ⚠️ **どちらが新しいかは機械には分からない**ので、両方を並べて出す（直す先を人が決める）。
    expect(mismatched.join("\n\n")).toBe("");
  });

  it("実装にある文言は、必ず表にも行がある（足したのに正典へ書き忘れたら落ちる）", () => {
    const rows = readErrorTable();
    const missing = [...Object.keys(codeMessages()), ...Object.keys(rustMessages())].filter((code) => !rows.has(code));
    expect(missing).toEqual([]);
  });

  /**
   * ⚠️ **Rust 側の文言も同じ扱い**（α-6 出口監査 🟡18）＝「TS から import できないから対象外」に
   * すると、表と実装のズレが**Rust 側だけ**残る（この2つは実際に画面へ出る）。
   */
  it("Rust に直書きされた文言も表と一致する", () => {
    const rows = readErrorTable();
    const mismatched: string[] = [];
    for (const [code, message] of Object.entries(rustMessages())) {
      const cell = rows.get(code);
      if (cell == null) continue;
      // 表は〔よく使う素材／取り込んだ文字の形〕のように差し込みを書くので、その後ろを比べる。
      const tail = norm(cell).replace(/^.*?〕/, "");
      if (tail !== norm(message)) mismatched.push(`${code} / 表: ${tail} / 実装: ${message}`);
    }
    expect(mismatched.join(" | ")).toBe("");
  });

  it("表の行を1つも取りこぼしていない（拾えない行は検査の外に落ちる）", () => {
    // ⚠️ **下限のしきい値だけでは足りない**（PR #862 レビュー ℹ️1）＝書き方のゆれた行を厳密な
    // 判定が拾えなくても、件数が下限を割らなければ緑のまま通る。**行に見えるものは全部拾えている**
    // ことを直接見る。
    expect(readErrorTable().size).toBe(looseErrorRows().length);
  });

  it("どの行も列が5つ（セルの中に区切りが紛れると、読む列がずれる）", () => {
    // ⚠️ 文言は**4列目**を位置で取っているので、セルの中に `|` が入ると**別の列を文言として読む**。
    // 件数は減らないので上のテストでは気づけない＝ここで見る（`| a | b | c | d | e |` は区切り6本）。
    const wrong = looseErrorRows()
      .filter((line) => (line.match(/\|/g) ?? []).length !== 6)
      .map((line) => line.slice(0, 60));
    expect(wrong).toEqual([]);
  });

  it("守れている件数が黙って減らない（対象の families を外すと落ちる）", () => {
    // 増えるぶんには構わないので下限で見る。
    expect(readErrorTable().size).toBeGreaterThanOrEqual(80);
    // ⚠️ **下限は減ることがある**＝断りが**退役**すると対象も減る（#809 で2件退役）。
    // 「増えるぶんには構わない」の趣旨は変わらないので、退役のたびに下限を実態へ合わせる
    //（合わせないと、**守れている件数が減っていないのに赤**になり、門番を信用しなくなる）。
    expect(Object.keys(codeMessages()).length).toBeGreaterThanOrEqual(34);
  });
});
