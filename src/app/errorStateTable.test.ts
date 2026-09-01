// `15 §6`（エラーコード表）の**利用者に出す文言**が、実装の文字列と一致していることを機械で守る（#855）。
//
// ⚠️ **目視では6回すり抜けた**＝挙動と正典を直したのに表だけ古いまま、が繰り返し起きている
// （直近は PR #854＝「正典と実装のズレを消す」PR 自身が同じズレを作っていた）。
// 既存の `uiLabels.test.ts` の走査は **§2-3 の禁止語**しか見ておらず、**文言そのものの一致は対象外**
// だったので、機械層は緑のまま通っていた。ここがその穴を塞ぐ。
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  alpha6Message, templateSaveMessage, bakeNoteMessage, editBlockedMessage, exportBlockedMessage,
  userFontMissingMessage, userFontUnreadableMessage,
} from "./uiLabels";
import { READING_DICT_SYNC_FAILED, READING_DICT_UNREADABLE_FOR_VOICE } from "../infrastructure/voiceProviders/readingDictSync";
import { READING_DICT_UNREADABLE } from "../infrastructure/readingDictFs";
import { EXPORT_CLEANUP_PENDING_MESSAGE, OTHER_EXPORT_RUNNING_MESSAGE } from "./store/exportLock";
import { RESTORE_FAILED_MESSAGE, RESTORE_POINTS_EMPTY, RESTORE_POINTS_UNREADABLE, restoreOfferMessage, voicesClearedMessage } from "./uiLabels";

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
    // α-7 で足したぶん（#960 レビュー）＝同じ穴を開け直さない。
    ...templateSaveMessage,
    PROJECT_RESTORE_FAILED: RESTORE_FAILED_MESSAGE,
    RESTORE_POINTS_UNREADABLE,
    RESTORE_POINTS_EMPTY,
    // ⚠️ **件数が入る文は差し込み口を渡して比べる**（`USER_FONT_MISSING` と同じ流儀）。
    RESTORE_VOICES_CLEARED: voicesClearedMessage(" N " as unknown as number),
    // ⚠️ **日時が入る文は差し込み口を渡して比べる**（`USER_FONT_MISSING` と同じ流儀）。
    PROJECT_BACKUP_AVAILABLE: restoreOfferMessage(" 〔日時〕 "),
    READING_DICT_SYNC_FAILED,
    READING_DICT_UNREADABLE,
    READING_DICT_UNREADABLE_FOR_VOICE,
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


/**
 * **本文を動かしながら組み立てる行**（件数・名前・状況で締めが変わる）＝1つの文字列と等値で比べられない。
 *
 * ⚠️ **「比べられない」と「見ていない」は違う**（#354）＝ここに載せた行も、下の
 * 「表の文言が実装のどこかに在る」検査からは外れるが、**理由を書いて明示的に外す**。
 * 何も書かずに外れる行があると、**表だけ古くなっても誰も気づかない**（実際 10 行がそうなっていた）。
 * 新しい行を足したときは、①families に入れて等値で守る ②文言をそのまま実装に持つ
 * ③ここに理由つきで載せる、のどれかを選ぶことになる。
 */
const ASSEMBLED_AT_RUNTIME: Record<string, string> = {
  TEMPLATE_NOT_FOUND: "候補の有無で締めが変わる（`sceneTemplateProblemMessage`）＋出る場所で次の行動が違う＝合計3つ",
  ASSET_FILE_MISSING: "件数と素材名を差し込む（`MaterialsScreen` の一覧と `adapters` の事前確認で別の文）",
  TIMELINE_TEMPLATE_NOT_FOUND: "件数の有無で締めが変わる（`missingTemplateMessage`）",
  TIMELINE_EXPORT_VOLUME_POINTS_TOO_MANY: "分けられる部品の有無で締めが変わる（`volumePointsTooManyMessage`）",
  TIMELINE_AUDIO_SOURCE_MISSING: "件数を差し込む",
  BGM_FILE_BROKEN: "一部の場面か全体かで文が変わる",
  TIMELINE_OVERLAY_RETIRED: "退役の断り＝画面の文と表の要約を分けている（#635）",
};

/**
 * **正典に行はあるが、その文言をどこにも出していない**行。
 *
 * ⚠️ **「出していない」を書き残す**（#354）＝文言の欄を空にしただけだと、次に読む人は
 * 「書き忘れ」と読む。**出していないことが分かっている**のか、まだ誰も見ていないのかを分ける。
 */
const NOT_SURFACED: Record<string, string> = {
  // ⚠️ **いまは空**＝`NARRATION_EMPTY` は #962 で**退役**にした（出していないうえ、
  // セリフの無い場面は成り立つので、そもそも警告すべきものではなかった）。
  // 退役の行は `~~コード~~` と書くので、この表の読み取りからは自然に外れる。
};

/** 実装のどこかに文言が在るかを見るための、全ソースの中身（テストは除く）。 */
function sourceBlob(): string {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|rs)$/.test(name) && !name.includes(".test.")) files.push(p);
    }
  };
  walk(join(process.cwd(), "src"));
  walk(join(process.cwd(), "src-tauri/src"));
  // ⚠️ **空白と、文字列を継ぐ記号を落とす**＝`"..." + "..."` と改行で折った文言を組み直す。
  // ⚠️ **括弧は落とさない**＝落とすと関数の引数ごと消えて、文言そのものが消える。
  return files.map((p) => readFileSync(p, "utf8")).join("\n").replace(/[\s"\u0027\u0060+]/g, "");
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


  /**
   * **どの行も、必ずどれかの方法で見られている**（#354）。
   *
   * ⚠️ **表の100行のうち52行が、どの検査にも掛かっていなかった**＝コード側の families から
   * 突き合わせる形だったので、**表にだけ行があってコードと離れても緑**のまま通っていた。
   * 実際に10行が古いままで、うち1行は §2-3 の禁止語（「ログ」）を含み、
   * 1行は「バージョン」のまま＝**正典が実装より古く、しかも規約違反の文を載せていた**。
   */
  it("表の文言は、必ず実装のどこかに在る（表だけ古くなったら落ちる）", () => {
    const blob = sourceBlob();
    const cellText = (v: string): string =>
      v.replace(/\*\*/g, "").replace(/〔[^〕]*〕/g, "").replace(/\s/g, "").replace(/。$/, "");
    const noParen = (v: string): string => v.replace(/[（(][^）)]*[）)]/g, "");
    const stale: string[] = [];
    for (const [code, cell] of readErrorTable()) {
      if (code in codeMessages() || code in rustMessages()) continue; // 等値で見ている行
      if (code in ASSEMBLED_AT_RUNTIME) continue; // 理由つきで外した行
      if (code in NOT_SURFACED) continue; // まだ出していないと分かっている行
      if (!cell || cell === "—") continue;
      // ①② で複数の文が入る行は、**それぞれ**が実装に在ることを見る（片方だけ古い、を通さない）。
      const variants = cell.split(/[①②③④]/).map(cellText).filter((v) => v.length >= 8);
      // ⚠️ **括弧を外した結果が空になる行を素通りさせない**＝`includes("")` は必ず真になるので、
      // 丸ごと注記の行が「在る」と判定されてしまう（自分で書いてから気づいた）。
      const missing = variants.filter((v) => {
        const bare = noParen(v);
        return !blob.includes(v) && !(bare.length >= 8 && blob.includes(bare));
      });
      if (missing.length > 0) stale.push(`${code}\n  表: ${missing.join(" ／ ")}`);
    }
    // ⚠️ **表と実装のどちらが新しいかは機械には分からない**ので、表の側を出して人が確かめる。
    expect(stale.join("\n\n")).toBe("");
  });

  it("理由つきで外した行は、いまも表に在る（消えた行の言い訳が残らない）", () => {
    const rows = readErrorTable();
    expect([...Object.keys(ASSEMBLED_AT_RUNTIME), ...Object.keys(NOT_SURFACED)].filter((c) => !rows.has(c))).toEqual([]);
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
