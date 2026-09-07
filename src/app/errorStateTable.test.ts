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
  userFontMissingMessage, userFontUnreadableMessage, bulkVoiceNotFittedMessage, canvasHoldMessage, clipOutsidePlayheadMessage, subtitleOverlapMessage, BAKE_LEAVE_BLOCKED_MESSAGE,
  BRAND_FONT_CLEARED_MESSAGE, BRAND_FONT_CLEAR_FAILED_MESSAGE, BRAND_FONT_NOT_APPLIED_MESSAGE, BRAND_LOGO_NOT_APPLIED_MESSAGE,
  DUCK_MERGED_MESSAGE, DUPLICATE_FAILED_MESSAGE, EXPORT_BLOCKED_IMPORTING_MESSAGE, IMPORT_BLOCKED_EXPORTING_MESSAGE,
  IMPORT_BUSY_MESSAGE, IMPORT_NO_PROJECT_MESSAGE, IMPORT_TIMELINE_OPEN_MESSAGE, LEAVE_BLOCKED_EXPORTING_MESSAGE,
  TIMELINE_SAVE_FAILED_MESSAGE, VOICE_BUSY_EXPORT_MESSAGE, PROJECT_OPEN_FAILED_MESSAGE, PROJECT_DELETE_FAILED_MESSAGE,
} from "./uiLabels";
import { READING_DICT_SYNC_FAILED, READING_DICT_UNREADABLE_FOR_VOICE } from "../infrastructure/voiceProviders/readingDictSync";
import { READING_DICT_UNREADABLE } from "../infrastructure/readingDictFs";
import { EXPORT_CLEANUP_PENDING_MESSAGE, OTHER_EXPORT_RUNNING_MESSAGE } from "./store/exportLock";
import { PROJECT_SAVE_WOULD_BREAK, RESTORE_FAILED_MESSAGE, RESTORE_POINTS_EMPTY, RESTORE_POINTS_UNREADABLE, restoreOfferMessage, voicesClearedMessage } from "./uiLabels";

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
    // ⚠️ **`+` を含む文は等値で守る**（#982）＝「実装のどこかに在る」の走査は
    // 文字列の継ぎ目（`+`）を落とすので、`Ctrl+Z` のような**本文に `+` を含む文**は
    // `CtrlZ` になって一致しない。等値の側へ載せれば、そもそも走査に頼らない。
    PROJECT_SAVE_WOULD_BREAK,
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
    BAKE_LEAVE_BLOCKED: BAKE_LEAVE_BLOCKED_MESSAGE,
    RESTORE_VOICES_CLEARED: voicesClearedMessage(" N " as unknown as number),
    // ⚠️ **形式ごとの文も表で守る**（#991）＝片方だけ表に載せると、もう片方が黙ってずれる。
    RESTORE_VOICES_CLEARED_TIMELINE: voicesClearedMessage(" N " as unknown as number, "timeline"),
    // ⚠️ **日時が入る文は差し込み口を渡して比べる**（`USER_FONT_MISSING` と同じ流儀）。
    PROJECT_BACKUP_AVAILABLE: restoreOfferMessage(" 〔日時〕 "),
    READING_DICT_SYNC_FAILED,
    READING_DICT_UNREADABLE,
    READING_DICT_UNREADABLE_FOR_VOICE,
    // ⚠️ **件数が入る文は `N` を差し込んで比べる**（表は読みやすさのため ` N ` と空白つきで書く）。
    USER_FONT_MISSING: userFontMissingMessage(" N "),
    USER_FONT_UNREADABLE: userFontUnreadableMessage(" N "),
    // ⚠️ **秒が入る文も差し込み口を渡して比べる**（上と同じ流儀）＝#996。
    TIMELINE_CLIP_OUTSIDE_PLAYHEAD: clipOutsidePlayheadMessage(0, 0),
    // ⚠️ **件数が入る文は差し込み口を渡して比べる**（上と同じ流儀）＝#1014。
    TIMELINE_SUBTITLE_OVERLAP: subtitleOverlapMessage(" N " as unknown as number),
    // ⚠️ **画面のローカル定数のままにしない**（PR #1056 レビュー 🟡）＝ここへ載せないと
    // **弱い段**（実装のどこかに在るか）でしか守られず、片方だけ書き換えても気づけない。
    PROJECT_OPEN_FAILED: PROJECT_OPEN_FAILED_MESSAGE,
    PROJECT_DELETE_FAILED: PROJECT_DELETE_FAILED_MESSAGE,
    // ⚠️ **理由 × 単体/まとめて＝6通りを、6行として等値で守る**（#1012）＝1つの行に畳むと
    // **どれか1通りだけ書き換えても気づけない**（この関数はまさに「言い方が2か所にあると
    // 片方だけ直す」を畳むために作ったもの＝畳んだ先で同じ穴を開けない）。
    // ⚠️ **`ASSEMBLED_AT_RUNTIME` との線引き**（PR #1048 レビュー 🟡）＝**返す文が有限個に
    // 打ち切れるか**で決める。ここは `reason` が3値の union・`count` は有無の2値なので**6通りで尽きる**
    // ＝1つずつ書ける。件数や名前を差し込むだけの文（`userFontMissingMessage` 等）も、差し込み口を
    // ` N ` のような目印にすれば1通りに落ちるので等値で守れる。**候補の有無や状況で締めが変わる**もの
    //（`sceneTemplateProblemMessage`・`missingTemplateMessage` 等）は組み合わせが表の行と1対1にならない
    // ので、あちらへ理由つきで載せる。
    TIMELINE_CANVAS_HOLD_TRACK: canvasHoldMessage("track"),
    TIMELINE_CANVAS_HOLD_TRACK_MANY: canvasHoldMessage("track", " N " as unknown as number),
    TIMELINE_CANVAS_HOLD_ANIMATION: canvasHoldMessage("animation"),
    TIMELINE_CANVAS_HOLD_ANIMATION_MANY: canvasHoldMessage("animation", " N " as unknown as number),
    TIMELINE_CANVAS_HOLD_GROUP: canvasHoldMessage("group"),
    TIMELINE_CANVAS_HOLD_GROUP_MANY: canvasHoldMessage("group", " N " as unknown as number),
    // ⚠️ **走査の外にあった文言をまとめて載せる**（#1012 の3つ目）＝ここへ載せていない文言は
    // 「表だけ古くなったら落ちる」の**弱い段**（実装のどこかに在るか）でしか見られておらず、
    // **表と実装のどちらを書き換えても気づけない**。`uiLabels.ts` の `*_MESSAGE` **14件すべて**が
    // その状態だった（行は前からあるのに、等値では守られていなかった）。
    // ⚠️ **コードの名前は表の側に合わせる**（PR #1048 レビュー 🟡）＝`DUCK_MERGED` /
    // `DUPLICATE_FAILED` / `EXPORT_BLOCKED_VOICE_BUSY` は表に前からある行で、新しい名前で
    // 足すと**同じ文言が2行**になる＝このPRが問題にしている「片方だけ直る」を正典に作ってしまう。
    // 下の「取りこぼしを構造で止める」検査が、次に足したぶんをここへ載せさせる。
    BRAND_FONT_CLEARED: BRAND_FONT_CLEARED_MESSAGE,
    BRAND_FONT_CLEAR_FAILED: BRAND_FONT_CLEAR_FAILED_MESSAGE,
    BRAND_FONT_NOT_APPLIED: BRAND_FONT_NOT_APPLIED_MESSAGE,
    BRAND_LOGO_NOT_APPLIED: BRAND_LOGO_NOT_APPLIED_MESSAGE,
    DUCK_MERGED: DUCK_MERGED_MESSAGE,
    DUPLICATE_FAILED: DUPLICATE_FAILED_MESSAGE,
    EXPORT_BLOCKED_IMPORTING: EXPORT_BLOCKED_IMPORTING_MESSAGE,
    IMPORT_BLOCKED_EXPORTING: IMPORT_BLOCKED_EXPORTING_MESSAGE,
    IMPORT_BUSY: IMPORT_BUSY_MESSAGE,
    IMPORT_NO_PROJECT: IMPORT_NO_PROJECT_MESSAGE,
    IMPORT_TIMELINE_OPEN: IMPORT_TIMELINE_OPEN_MESSAGE,
    LEAVE_BLOCKED_EXPORTING: LEAVE_BLOCKED_EXPORTING_MESSAGE,
    TIMELINE_SAVE_FAILED: TIMELINE_SAVE_FAILED_MESSAGE,
    EXPORT_BLOCKED_VOICE_BUSY: VOICE_BUSY_EXPORT_MESSAGE,
    // ⚠️ **名前が入る文は差し込み口を渡して比べる**（`USER_FONT_MISSING` と同じ流儀）＝#1045。
    // ⚠️ **`ASSEMBLED_AT_RUNTIME` へは移さない**（PR #1049 レビュー ℹ️・意図的）＝画面に出るのは
    // 「この文（固定）＋出た理由の文」だが、**理由の文はそれぞれ表に行があり等値で守られている**。
    // ここを外すと**土台の文だけが誰にも見られなくなる**＝守りが減る。組み立てであることは表の由来欄に書いた。
    TIMELINE_BULK_VOICE_NOT_FITTED: bulkVoiceNotFittedMessage([" 〇〇 "]),
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
  // ⚠️ **`lib.rs` だけを読まない**（PR #1036 レビュー 🟡）＝文言は他のモジュールにもある。
  // `voicevox.rs` の時間切れの2文は、載せないと**弱い段**（「実装のどこかに在る」）でしか
  // 守られず、**表と実装のどちらかだけ書き換えても気づけない**（#263 の再発）。
  const vv = readFileSync(join(process.cwd(), "src-tauri/src/voicevox.rs"), "utf8");
  const pickIn = (src: string, re: RegExp): string => {
    const m = re.exec(src);
    if (!m) throw new Error(`Rust 側の文言が見つかりません: ${re}`);
    return m[1];
  };
  const pick = (re: RegExp): string => pickIn(rs, re);
  return {
    VOICE_TIMEOUT: pickIn(vv, /const VOICE_TIMEOUT_MESSAGE: &str =\s*"([^"]+)"/),
    ENGINE_TIMEOUT: pickIn(vv, /const ENGINE_TIMEOUT_MESSAGE: &str =\s*"([^"]+)"/),
    USER_FONT_IMPORT_FAILED: pick(/return Err\("(このファイルは文字の形として読み込めません。[^"]*)"\.to_string\(\)\)/),
    // `{what}` は「よく使う素材」「取り込んだ文字の形」のどちらかが入る＝表は〔…〕で両方を書くので、
    // 差し込みの手前までを比べる（`format!` の中身をそのまま取り出す）。
    MANIFEST_UNREADABLE: pick(/format!\("\{what\}(の一覧を読めませんでした。[^"]*)"\)/),
    // ⚠️ **Rust 側に足した文も表と結ぶ**（α-7 再監査 ℹ️）＝走査は TS の文言だけなので、
    // ここへ登録しないと**表と実装のズレが機械では見えない**（#263 で足した文が漏れていた）。
    RESTORE_WRITE_FAILED: pick(/const RESTORE_WRITE_FAILED: &str =\s*"([^"]+)"/),
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
  TIMELINE_EXPORT_AUDIO_UNREADABLE: "音源の種類（読み上げ／同梱の曲／取り込んだ素材）で次の行動が変わる（#1064）",
  TIMELINE_AUDIO_SOURCE_MISSING: "件数を差し込む",
  BGM_FILE_BROKEN: "一部の場面か全体かで文が変わる",
  TIMELINE_OVERLAY_RETIRED: "退役の断り＝画面の文と表の要約を分けている（#635）",
  IMPORT_CANCELLED: "入った件数を差し込む（0件のときは件数を言わない＝#1024 ③）",
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


/**
 * **domain が出す断りのコード**（`warn('CODE', '文言', …)`）を、本文から拾う。
 *
 * ⚠️ **ここが走査の外にあった**（α-7 出口監査 🟡）＝`codeMessages()` はコード側の**定数**しか見ないので、
 * `warn('SCENE_TYPE_FALLBACK', '不明な場面種別を調整しました', …)` のように**その場で書いた文**は
 * 表に無くても誰も気づかない。実際に `SCENE_TYPE_FALLBACK` は表に1行も無く、
 * `POSE_FALLBACK` は**2つ目の文**（「ゆうこの素材が見つかりません」）が表から漏れていた。
 * ⚠️ **1つのコードが複数の文を持つ**（出る場面で言うことが違う）ので、**コードと文の組**で拾う。
 */
function domainWarnMessages(): {
  found: { code: string; message: string; where: string }[];
  /** 見つけた `warn(` 呼び出しすべて（解けたかどうかに関わらず）。 */
  seen: { code: string; where: string }[];
} {
  const out: { code: string; message: string; where: string }[] = [];
  const seen: { code: string; where: string }[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.ts$/.test(name) && !name.includes(".test.")) {
        const text = readFileSync(p, "utf8");
        // ⚠️ **名前で渡された文言も解く**（α-7 出口監査 🟡）＝
        // `warn('TEXT_OVERFLOW', TRANSFORM_WARNING.NARRATION_TOO_LONG, …)` のように定数で渡す形は、
        // その場に文字が無いので**素通り**していた＝**この検査自身が、塞いだのと同じ穴を持っていた**。
        const consts = new Map<string, string>();
        for (const m of text.matchAll(/^\s{2}([A-Z_][A-Z_0-9]*):\s*$/gm)) consts.set(m[1], "");
        for (const m of text.matchAll(/^\s{2}([A-Z_][A-Z_0-9]*):\s*(['"])(.+?)\2,?$/gm)) consts.set(m[1], m[3]);
        // ⚠️ **解けなかったものを黙って捨てない**（#971 レビュー 🟡）＝
        // 定数を**別のファイル**へ切り出す／テンプレートリテラルで書く、のどちらでも
        // `consts` から引けず、**検査から静かに消える**（今回塞いだのと**3回目の同じ形**）。
        // 呼び出しの総数と、解けた数が合うかを外で見る。
        // ⚠️ **引用符の種類で見落とさない**（α-7 再監査 🔴）＝`'` だけを見ていたので、
        // `warn("CODE", "文言")` と**ダブルクォートで書いた1件が、数にも入らず素通り**した
        //（このリポジトリに引用符を揃える設定は無い）＝**4回目の同じ形**。
        // **数える側（`seen`）にも引用符を書かない**＝ここが漏れると、下の件数チェックも一緒に黙る。
        for (const m of text.matchAll(/warn\(\s*['"]([A-Z_]+)['"]/g)) seen.push({ code: m[1], where: name });
        for (const m of text.matchAll(/warn\(\s*['"]([A-Z_]+)['"]\s*,\s*(?:(['"])(.+?)\2|[A-Za-z_$][\w$]*\.([A-Z_][A-Z_0-9]*))/g)) {
          const message = m[3] ?? consts.get(m[4] ?? "");
          if (message) out.push({ code: m[1], message, where: name });
        }
      }
    }
  };
  walk(join(process.cwd(), "src", "domain"));
  return { found: out, seen };
}


/**
 * `uiLabels` の `*_MESSAGE` を、名前と（**素の文字列なら**）中身に分けて拾う（#1012）。
 *
 * ⚠️ **組み立てた文（テンプレート）は `null` を返す**＝等値では守れないので、呼び出し側に
 * **理由つきで外させる**ため。黙って飛ばすと、そこだけ誰も見ていない状態に戻る。
 */
export function messageConstsOf(src: string): { name: string; literal: string | null }[] {
  const out: { name: string; literal: string | null }[] = [];
  for (const m of src.matchAll(/export const ([A-Z0-9_]+_MESSAGE)\s*=\s*([\s\S]*?);$/gm)) {
    const [, name, body] = m;
    const plain = /^\s*(?:"[^"]*"\s*\+?\s*)+$/.test(body);
    out.push({ name, literal: plain ? [...body.matchAll(/"([^"]*)"/g)].map((x) => x[1]).join("") : null });
  }
  return out;
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
   * **載せ忘れを構造で止める**（#1012）。
   *
   * ⚠️ **この走査は「載せたものは表にもある」を見る**＝`codeMessages()` へ載せていない文言は
   * **存在ごと見えない**（弱い段の「実装のどこかに在る」でしか守られず、表と実装のどちらを
   * 書き換えても気づけない）。実際に `canvasHoldMessage` の6通りと `*_MESSAGE` の3件が
   * **表に1行も無い**まま残っていた。人が気づく形にせず、**次に足した文言が自動でここへ呼ばれる**ようにする。
   */
  const MESSAGE_EXEMPT: Record<string, string> = {
    // ⚠️ **外すときは理由を書く**（`ASSEMBLED_AT_RUNTIME` と同じ流儀）＝空欄で外すと、
    // 次に読む人は「書き忘れ」と読む。いまは1件も外していない。
  };

  // ⚠️ **この段が見るのは `uiLabels.ts` の `*_MESSAGE` だけ**（PR #1048 レビュー ℹ️）＝関数で
  //    組み立てる文言・画面やほかの層に直書きした文字列は**この段の外**（弱い段でしか守られていない）。
  //    「これで全部守られている」と読まれないように書き残す。射程を広げるのは別で追う。
  // ⚠️ **エスケープを含む文言は取り違えうる**＝ソースの文字をそのまま読むので、改行の記号（\n）を含む文言を
  //    足すと**実際の値と別の文字列**として拾う。ただし拾い方が崩れれば `literal: null` に落ち、
  //    `MESSAGE_EXEMPT` に無ければ**赤くなる**（黙って通らない＝失敗の向きは安全側）。
  it("`uiLabels` の `*_MESSAGE` は、必ず等値で守られている（載せ忘れたら落ちる）", () => {
    const found = messageConstsOf(readFileSync(join(process.cwd(), "src/app/uiLabels.ts"), "utf8"));
    const guarded = new Set(Object.values(codeMessages()).map(norm));
    // ⚠️ **「中身を取れなかった」も見逃さない**＝組み立てた文（テンプレート）は等値で守れないので、
    // **理由つきで外させる**（黙って素通りさせると、そこだけ誰も見ていない状態に戻る）。
    const unreadable = found.filter((f) => f.literal == null && !(f.name in MESSAGE_EXEMPT)).map((f) => f.name);
    expect(unreadable, "素の文字列でない `*_MESSAGE` は、理由つきで `MESSAGE_EXEMPT` へ").toEqual([]);
    const unguarded = found
      .filter((f) => f.literal != null && !(f.name in MESSAGE_EXEMPT) && !guarded.has(norm(f.literal)))
      .map((f) => f.name);
    expect(unguarded, "`codeMessages()` に載っていない文言がある（表と実装のズレが機械では見えない）").toEqual([]);
  });

  // ⚠️ **門番そのものを見る**（`guard-gets-holes`）＝いまの `uiLabels.ts` に「組み立てた文」が
  //    1つも無いので、上の検査だけでは**その枝が本当に働くか分からない**（外しても緑のまま）。
  it("組み立てた文は「中身を取れない」として拾う（門番の枝を直接見る）", () => {
    const fixture = [
      'export const A_MESSAGE = "あ" + "い";',
      "export const B_MESSAGE = `${name}を読み込めません`;",
      'export const C_MESSAGE = "「や、め、る」は。区切りを含む";',
    ].join("\n");
    expect(messageConstsOf(fixture)).toEqual([
      { name: "A_MESSAGE", literal: "あい" },
      { name: "B_MESSAGE", literal: null },
      { name: "C_MESSAGE", literal: "「や、め、る」は。区切りを含む" },
    ]);
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


  /**
   * domain が出す断りも、表に載っていること（α-7 出口監査 🟡）。
   *
   * ⚠️ **文まで見る**＝コードだけ見ると、**同じコードで別の文**（出る場面で言うことが違う）が
   * 漏れていても気づけない。実際 `POSE_FALLBACK` はそれで漏れていた。
   */
  it("domain が出す断りの文が、表のどこかに在る", () => {
    const md = readFileSync(join(process.cwd(), "docs/yuko_recruit_docs/15_ERROR_STATE_MODEL.md"), "utf8");
    const flat = md.replace(/\s/g, "");
    const missing = domainWarnMessages().found
      .filter(({ message }) => !flat.includes(message.replace(/\s/g, "")))
      .map(({ code, message, where }) => `${code}（${where}）: ${message}`);
    // ⚠️ **どちらを直すかは人が決める**（文を変えたのか、表に足し忘れたのか）ので、両方を出す。
    expect([...new Set(missing)].join("\n")).toBe("");
  });

  it("domain の断りを1つも拾えていない、が起きない（走査が壊れたら落ちる）", () => {
    const { found, seen } = domainWarnMessages();
    expect(seen.length).toBeGreaterThanOrEqual(20);
    expect(new Set(seen.map((f) => f.code)).size).toBeGreaterThanOrEqual(15);
    // ⚠️ **解けなかったものが1つも無い**＝これが本体（黙って検査から消えるのを防ぐ）。
    const unresolved = seen.length - found.length;
    expect(unresolved, "文言を解けなかった `warn(` がある（別ファイルの定数・テンプレートリテラル）").toBe(0);
  });

  it("守れている件数が黙って減らない（対象の families を外すと落ちる）", () => {
    // ⚠️ **下限ではなく実数で固定する**（#978）＝下限（表 80／families 34）は実測（106／51）から
    // 遠く離れており、**`exportBlockedMessage`（6件）＋`bakeNoteMessage`（2件）＋α-6/α-7 の追加分を
    // まとめて外しても緑のまま**通った＝「families を外すと落ちる」というこのテストの名前が嘘だった。
    // 外れた行は弱い段（「文言がソースに在る」）へ落ちて素通りするので、**気づけない**。
    // ⚠️ **増えても落ちる**＝そのぶん表と実装の対応を1件ずつ確かめて数を更新する
    //（「増えるぶんには構わない」で通すと、**足したのに検査へ載っていない**行が混ざる）。
    expect(readErrorTable().size, "表の行数が変わった（増減とも、対応を確かめてから数を更新する）").toBe(175);
    expect(
      Object.keys(codeMessages()).length,
      "完全一致で守れている件数が変わった（退役なら数を下げ、追加なら families へ載っているか確かめる）",
    ).toBe(82);
  });
});
