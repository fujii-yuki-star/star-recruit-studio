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
  alpha6Message, templateSaveMessage, apiKeyMessage, bakeNoteMessage, editBlockedMessage, exportBlockedMessage,
  userFontMissingMessage, userFontUnreadableMessage, bulkVoiceNotFittedMessage, canvasHoldMessage, clipOutsidePlayheadMessage, subtitleOverlapMessage, BAKE_LEAVE_BLOCKED_MESSAGE,
  BRAND_FONT_CLEARED_MESSAGE, BRAND_FONT_CLEAR_FAILED_MESSAGE, BRAND_FONT_NOT_APPLIED_MESSAGE, BRAND_LOGO_NOT_APPLIED_MESSAGE,
  DUCK_MERGED_MESSAGE, DUPLICATE_FAILED_MESSAGE, EXPORT_BLOCKED_IMPORTING_MESSAGE, IMPORT_BLOCKED_EXPORTING_MESSAGE,
  IMPORT_BUSY_MESSAGE, IMPORT_NO_PROJECT_MESSAGE, IMPORT_TIMELINE_OPEN_MESSAGE, LEAVE_BLOCKED_EXPORTING_MESSAGE,
  TIMELINE_SAVE_FAILED_MESSAGE, VOICE_BUSY_EXPORT_MESSAGE, PROJECT_OPEN_FAILED_MESSAGE, PROJECT_DELETE_FAILED_MESSAGE, CAPTURE_FRAME_ASSET_MISSING_MESSAGE } from "./uiLabels";
import { READING_DICT_SYNC_FAILED, READING_DICT_UNREADABLE_FOR_VOICE } from "../infrastructure/voiceProviders/readingDictSync";
import { startupArgErrorMessage } from "../domain/startup/startupMessages";
import { STARTUP_BUSY_MESSAGE, STARTUP_IMPORT_UNREADABLE_MESSAGE, STARTUP_ASSET_MISSING_MESSAGE, STARTUP_OPEN_FAILED_MESSAGE, STARTUP_VOICE_ENGINE_MESSAGE, STARTUP_VOICE_NOT_READY_MESSAGE } from "./hooks/useStartupJob";
import { makeVoicesDoneMessage } from "../domain/startup/startupMessages";
import { PROJECT_NEWER_VERSION_MESSAGE } from "../domain/schemaVersionCompare";
import { READING_DICT_UNREADABLE } from "../infrastructure/readingDictFs";
import { EXPORT_CLEANUP_PENDING_MESSAGE, OTHER_EXPORT_RUNNING_MESSAGE } from "./store/exportLock";
import { PROJECT_SAVE_WOULD_BREAK, RESTORE_FAILED_MESSAGE, RESTORE_POINTS_EMPTY, RESTORE_POINTS_UNREADABLE, restoreOfferMessage, voicesClearedMessage } from "./uiLabels";
import { aiSceneLimitMessage, sceneLimitMessage } from "../domain/project/sceneLimit";

/**
 * 表の行に**見える**すべての行（ゆるい判定）。
 *
 * ⚠️ `readErrorTable` の**厳密な**判定が取りこぼした行を炙り出すために使う（PR #862 レビュー ℹ️1）。
 * 厳密な側は区切りの空白まで固定しているので、書き方が少しゆれた行を**黙って無視**しうる。
 * 拾えていない行は**検査の外に落ちる**＝このテストの趣旨（何も黙って逃がさない）に反する。
 */
function looseErrorRows(): string[] {
  // ⚠️ **退役（`~~CODE~~`）は数えない**＝移す前の判定（`^\|\s*`[A-Z_]+``）と同じ意味にする。
  // 退役の行は等値で守る対象ではない（`15 §6` の流儀＝行は消さず残す）。
  return tableLines().filter((line) => /^`[A-Z_]+`\t/.test(line));
}

/** 表の実体の置き場（`15 §6` が指している先）。 */
const TABLE_PATH = "docs/yuko_recruit_docs/errors/error-state-table.tsv";

/**
 * 表の実体（`errors/error-state-table.tsv`）の行（見出しを除く）。
 *
 * ⚠️ **`15 §6` から移した**（#1090 案C・利用者判断 2026-09-10）＝表は「1行を引く」使い方しか
 * しないのに、`15` を開くと必ず全部ついてきた（`15` の 74% が表だった）。
 * ⚠️ **正典であることは変わらない**＝文言の単一の参照元は、いまもこの表（置き場が変わっただけ）。
 */
export function tableLines(): string[] {
  const tsv = readFileSync(join(process.cwd(), TABLE_PATH), "utf8");
  return tsv.split("\n").slice(1).filter((l) => l.trim() !== "");
}

/** 表：コード → 「ユーザー向け文言」の列（4列目）。 */
function readErrorTable(): Map<string, string> {
  const rows = new Map<string, string>();
  for (const line of tableLines()) {
    const cells = line.split("\t");
    // code / severity / auto / message / origin → 文言は index 3
    const m = /^`([A-Z_]+)`$/.exec(cells[0] ?? "");
    if (!m) continue; // 退役（`~~CODE~~`）は等値の対象外＝これまでと同じ
    if (cells.length < 4) continue;
    rows.set(m[1], (cells[3] ?? "").trim());
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
    // ⚠️ **上限を差し込むだけ＝返す文は1通り**（#1213）なので、等値で守る
    //（`ASSEMBLED_AT_RUNTIME` へ逃がさない＝逃がすと「実装のどこかに在る」の弱い段になり、
    // しかも `${...}` を含む行は走査で一致しないので**誰にも見られなくなる**）。
    SCENE_LIMIT_REACHED: sceneLimitMessage(),
    // ⚠️ **差し込み口は ` N ` の目印**（#1222）＝実際の場面数が入るので、そのままでは等値で守れない。
    //   `canvasHoldMessage` と同じ流儀（`ASSEMBLED_AT_RUNTIME` へ逃がさない）。
    AI_SCENE_LIMIT_EXCEEDED: aiSceneLimitMessage(" N " as unknown as number),
    EXPORT_CLEANUP_PENDING: EXPORT_CLEANUP_PENDING_MESSAGE,
    EXPORT_OTHER_RUNNING: OTHER_EXPORT_RUNNING_MESSAGE,
    // α-6 で足したぶん（α-6 出口監査 🟡18）＝画面や `infrastructure` に直書きされていて
    // この走査の外にあり、**既に1件ズレていた**（句点の有無）。
    ...alpha6Message,
    // α-7 で足したぶん（#960 レビュー）＝同じ穴を開け直さない。
    ...templateSaveMessage,
    // ⚠️ **接続キーの断りも同じ扱い**（#1131）＝以前は画面へ直書きで、走査（その場に書いた文）
    // だけが守っていた。定数へ出したら**完全一致の側へ載せる**（載せ忘れると、どちらの段でも
    // 守られない「素通り」になる＝実際に `messages.rs` でそうなっていた＝#1129）。
    ...apiKeyMessage,
    // ⚠️ **場面形式の切り出しの断りも等値で守る**（#1155 ⑤）＝タイムライン形式の双子
    // （`TIMELINE_EDIT_FREEZE_ASSET_MISSING`）は `editBlockedMessage` 経由で守られているのに、
    // こちらだけ定数で直書きだった＝**片方だけ守られている**を作らない。
    CAPTURE_FRAME_ASSET_MISSING: CAPTURE_FRAME_ASSET_MISSING_MESSAGE,
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
    // ⚠️ **起動のときに頼まれた仕事の断りも等値で守る**（ADR-0042・#1184）＝画面や hook に直書きで
    // 残すと、**弱い段（実装のどこかに在るか）でしか見られない**＝表と実装のどちらを書き換えても気づけない。
    // ⚠️ **印の綴りが入る文は差し込み口を渡して比べる**（`USER_FONT_MISSING` と同じ流儀）。
    STARTUP_ARG_UNKNOWN: startupArgErrorMessage({ kind: "unknown", flag: " 〔印〕 " }),
    STARTUP_ARG_MISSING_VALUE: startupArgErrorMessage({ kind: "missingValue", flag: " 〔印〕 " }),
    STARTUP_ARG_INCOMPLETE_EXPORT: startupArgErrorMessage({ kind: "incompleteExport", flag: null }),
    STARTUP_ARG_CONFLICTING: startupArgErrorMessage({ kind: "conflicting", flag: null }),
    STARTUP_JOB_BUSY: STARTUP_BUSY_MESSAGE,
    STARTUP_IMPORT_UNREADABLE: STARTUP_IMPORT_UNREADABLE_MESSAGE,
    STARTUP_OPEN_FAILED: STARTUP_OPEN_FAILED_MESSAGE,
    // ⚠️ **頼まれた回だけの断りも表で守る**（#1204）＝ここへ載せないと、
    // **画面を読まない道の断り**が誰にも見張られない（穴を開けた当人が守りも書く）。
    STARTUP_VOICE_NOT_READY: STARTUP_VOICE_NOT_READY_MESSAGE,
    STARTUP_VOICE_ENGINE_NOT_READY: STARTUP_VOICE_ENGINE_MESSAGE,
    STARTUP_ASSET_MISSING: STARTUP_ASSET_MISSING_MESSAGE,
    // ⚠️ **件数が入る文は差し込み口を渡して比べる**（上と同じ流儀）。
    STARTUP_MAKE_VOICES_LEFT: makeVoicesDoneMessage(" N " as unknown as number),
    PROJECT_NEWER_VERSION: PROJECT_NEWER_VERSION_MESSAGE,
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
    // ⚠️ **文言を寄せた置き場は丸ごと読む**（#1129）＝下の `messagesModule()` を参照。
    ...messagesModule(),
  };
}

/**
 * `src-tauri/src/messages.rs` の定数を**丸ごと**拾う（#1129）。
 *
 * ⚠️ **手挙げをやめた**＝`messages.rs` は「文言は1か所」（§6）のために作った置き場なのに、
 * ここへ**1本ずつ登録する**形だったので、**足しただけでは表と結ばれなかった**
 *（着手時は 16 本のうち **13 本**が表に無い状態で、機械では見えなかった＝#263 と同じ壊れ方）。
 * 丸ごと読めば、**足した瞬間に「表へ行を足せ」と言われる**。
 *
 * ⚠️ **2行に割れた形も拾う**＝`rustfmt` は長い定数を
 * `pub const X: &str =\n    "…";` と改行するので、1行だけを見る正規表現だと**17 本中 12 本を
 * 取りこぼす**（そしてその取りこぼしは「見つからない」ではなく「**黙って少ない**」になる）。
 * ⚠️ **この数も検査で留める**（下の「1行の形と2行の形の数」）＝書いた主張を数えずに置かない。
 *
 * ⚠️ **拾えない書き方**（正直に書く・#1129 レビュー由来 ℹ️）＝`pub(crate) const` /
 * `concat!` で組む定数 / `&'static str` の表記は**黙って拾われない**（本数の実数固定も
 * 「見つかった数」を留めるだけなので、拾われない形が増えても赤くならない）。
 * いまの 16 本はすべて `pub const NAME: &str = "…";` なので実害は無いが、
 * **そう書き続けること**がこの門番の前提になっている。
 */
export function messagesModule(): Record<string, string> {
  const src = readFileSync(join(process.cwd(), "src-tauri/src/messages.rs"), "utf8");
  return messagesIn(src);
}

/** 拾い方そのもの（走査と自己検査が同じ道を通る）。 */
export function messagesIn(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of src.matchAll(/pub const ([A-Z_][A-Z_0-9]*): &str =\s*"((?:[^"\\]|\\.)*)";/g)) {
    out[m[1]!] = m[2]!;
  }
  return out;
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
  DROP_REJECTED: "件数と、通らなかったファイル名を差し込む（#1026 ②）",
  // ⚠️ **足りない量が連続の値**（#1211）＝「約 3.2GB」の数は入力の大きさで決まり、` N ` のような
  // 目印に落とせない（`" N "` 方式は件数＝整数だから使えている）。しかも**どこが足りないか**で
  // 3通りに分かれる（作る場所／保存先／両方）。
  // ⚠️ **弱い段へ落ちるぶんは、別の検査で補っている**＝`domain/export/diskPlan.test.ts` が
  // 「やれること3つが並ぶ」「技術用語を出さない」「切り上げる」を留め、
  // `app/userFacingError.test.ts` が「関門を通る文である」（句点を落とすと静かに潰れる）を留めている。
  EXPORT_DISK_FULL: "足りない量（連続の値）と、どこが足りないか（作る場所／保存先／両方）で文が変わる（#1211）",
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
    // ⚠️ **引用符は両方**（#1051）＝`uiLabels` は `"`、`domain` は `'` を使う（層で流儀が違う）。
    const plain = /^\s*(?:(?:"[^"]*"|'[^']*')\s*\+?\s*)+$/.test(body);
    // 中身は**どちらの引用符でも**取り出す（片方だけ見ると `null` に落ちて誤って赤くなる）。
    const parts = [...body.matchAll(/"([^"]*)"|'([^']*)'/g)].map((x) => x[1] ?? x[2] ?? '');
    out.push({ name, literal: plain ? parts.join('') : null });
  }
  return out;
}

/**
 * 文末の「。」の**あるなしを吸う**（比べる前に落とす）。
 *
 * ⚠️ **「既存行がすべて句点を落とす形」は嘘になっていた**（#1129 レビュー由来 ℹ️）＝
 * #1118・#1130・#1129 で足した行を含め、いまは **38 行以上**が句点つきで書かれている。
 * どちらでも通るのでテストは緑のままだが、**注記だけが古い**と次の人が書き方に迷う。
 * 表の作法は「どちらでもよい（ここが吸う）」。
 */
const norm = (s: string): string => s.replace(/。$/, "").trim();

describe("`messages.rs` を丸ごと拾う（#1129）", () => {
  it("拾えた本数を実数で留める（黙って減らない）", () => {
    // ⚠️ **下限にしない**＝PR #1130 で「下限だと拾い方を1段外しても緑」を実際に踏んだ。
    // 増えたら、そのぶん表へ行を足してからこの数を直す。
    // ⚠️ **+6**（#1244）＝動画案づくりの断りを**次の行動ごとに6つへ分けた**（混雑／使いすぎ／接続先が無い／鍵が通らない／内容が受け付けられない／それ以外）。
    //   以前は1文が全部を受けており、**待っても直らない失敗にまで「時間をおいて」と言っていた**。
    expect(Object.keys(messagesModule()).length, "`messages.rs` の定数の数が変わった").toBe(23);
  });

  it("1行の形と2行の形の数（書いた主張を数えて出す）", () => {
    // ⚠️ **注記（`15 §6.0`）に「17 本中 12 本」と書いた**＝書いたのに検査していない主張を残さない
    //（レビューで「10 本」という**実測と違う数**を書いていたのが見つかった）。
    // ⚠️ **このコメントの数も古くなっていた**（#1162 レビュー由来 ℹ️）＝下の `expect` は 17/12 で
    // 正しいのに、**コメントだけ 16/11 のまま**だった（`verify-claims-in-comments` の型）。
    const src = readFileSync(join(process.cwd(), "src-tauri/src/messages.rs"), "utf8");
    const oneLine = [...src.matchAll(/pub const [A-Z_0-9]+: &str = "/g)].length;
    const all = Object.keys(messagesIn(src)).length;
    // ⚠️ **+6**（#1244）＝動画案づくりの断りを**次の行動ごとに6つへ分けた**（混雑／使いすぎ／接続先が無い／鍵が通らない／内容が受け付けられない／それ以外）。
    //   以前は1文が全部を受けており、**待っても直らない失敗にまで「時間をおいて」と言っていた**。
    expect(all, "定数の数が変わった").toBe(23);
    // ⚠️ **+6**（#1244）＝足した6つは、いずれも1行で書いている（文が長いので折り返さない）。
    expect(oneLine, "1行で書かれた定数の数が変わった").toBe(11);
    expect(all - oneLine, "`rustfmt` が改行した定数の数が変わった＝拾い方が効いている範囲").toBe(12);
  });

  it("**2行に割れた形**も拾う（`rustfmt` は長い定数を改行する）", () => {
    // ⚠️ **1行だけを見る形だと 17 本中 12 本を取りこぼす**＝しかもそれは「見つからない」ではなく
    // 「**黙って少ない**」になる（表と結ばれていない定数が、静かに増える）。
    expect(messagesIn('pub const A: &str = "あ。";')).toEqual({ A: "あ。" });
    expect(messagesIn('pub const B: &str =\n    "い。";')).toEqual({ B: "い。" });
    // 中に引用符を含む形（`\"`）も1本として拾う（途中で切れない）。
    expect(messagesIn(String.raw`pub const C: &str = "「う」と\"え\"。";`).C).toBe(String.raw`「う」と\"え\"。`);
  });

  it("定数でないものは拾わない（誤検出は門番の信用を落とす）", () => {
    expect(messagesIn('const PRIVATE: &str = "あ。";')).toEqual({});
    expect(messagesIn('pub const N: usize = 3;')).toEqual({});
    expect(messagesIn('pub const lower: &str = "あ。";')).toEqual({});
  });

  it("複数あっても全部拾う（最初の1つで止まらない）", () => {
    expect(messagesIn('pub const A: &str = "あ。";\npub const B: &str = "い。";')).toEqual({ A: "あ。", B: "い。" });
  });
});

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
    // ⚠️ 文言は**4列目**を位置で取っているので、セルの中にタブが入ると**別の列を文言として読む**。
    // 件数は減らないので上のテストでは気づけない＝ここで見る（5列＝タブは4本）。
    const wrong = tableLines()
      .filter((line) => (line.match(/\t/g) ?? []).length !== 4)
      .map((line) => line.slice(0, 60));
    expect(wrong).toEqual([]);
  });

  it("表の行数を実数で留める（黙って減っていない）", () => {
    // ⚠️ **移したときに落ちていないことを、数で留める**（#1090 案C）＝
    // `15 §6` から移す前の実測は **189 行**（うち退役 3）。増やすなら、この数も一緒に動かす。
    // ⚠️ **+3**＝画面から「開く」を頼んだときの3つの断り（#1118・`messages.rs`）。
    // ⚠️ **+14**＝関門へ寄せたときの**既定の文**（#1123／PR #1130）。走査（`uiMessageScan`）が
    //   `?? "…"` の形を**構造的に素通り**していたので、表に載っていなかった
    //（3件は #1123 より前からある＝`BrandKitSection` / `SaveStatusBadge` / `TimelineProjectScreen`）。
    // ⚠️ **+13**＝`messages.rs` の定数（#1129）。手挙げをやめて**丸ごと走査**へ変えたので、
    //   これ以降は**足した瞬間にここが赤くなる**（登録漏れが起きない）。
    // ⚠️ **+2**＝接続キーの「確かめられなかった」2文（#1131）。
    // ⚠️ **+1**＝`KEYRING_UNAVAILABLE`（#1131）。
    // ⚠️ **+1**＝`TIMELINE_EDIT_MARKER_EXISTS`（#1149 ①＝目印を動かす先に別の目印がいるとき）。
    // ⚠️ **+1**＝`TIMELINE_MARKER_DUPLICATE_TIME`（#1155 ③＝`11 §8` V33・読み込んだ文書の検証）。
    // ⚠️ **+1**＝`CAPTURE_FRAME_ASSET_MISSING`（#1155 ⑤＝場面形式の切り出しも押す前に断る）。
    // ⚠️ **+2**＝`STARTUP_VOICE_NOT_READY`／`STARTUP_MAKE_VOICES_LEFT`（#1204＝
    //   **画面を読まない道**〔起動の引数〕で、公開前チェックの「要対応」を誰も見ていなかった）。
    // ⚠️ **+6**（#1244）＝断りを次の行動ごとに6行へ分けた（うち1行は、以前は表に無かった既定の文）。
    expect(tableLines().length, "表の行数が変わった（増減したら数も直す）").toBe(255);
  });


  /**
   * `*_MESSAGE`（素の文字列）を置いている**すべてのファイル**（#1051・PR #1065 レビュー 🟡）。
   *
   * ⚠️ **一覧で持たない**＝新しいファイルへ置いた人が**一覧への追加を忘れても緑のまま**通る
   *（このPR自身が直そうとしている「載せ忘れを構造で止められない」形そのもの）。`src` を歩く。
   * ⚠️ **検査のファイルは除く**（`sourceBlob` と同じ流儀＝fixture を拾わない）。
   */
  const messageConstFiles = (): string[] => {
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p2 = join(dir, name);
        if (statSync(p2).isDirectory()) walk(p2);
        else if (/\.tsx?$/.test(name) && !name.includes(".test.")) out.push(p2);
      }
    };
    walk(join(process.cwd(), "src"));
    return out;
  };

  /**
   * **組み立てる文言のうち、表と1対1で結べないもの**（#1051）。⚠️ **理由を書く**。
   * `ASSEMBLED_AT_RUNTIME`（表の行を外す側）とは別＝こちらは**関数の側**を外す。
   */
  const MESSAGE_FN_EXEMPT: Record<string, string> = {
    // ── 状況で締めが変わる（1つの行に対して複数の文）＝等値では守れない ──
    lockedTrackMessage: "やろうとしたこと（中身を変える／削除する）で締めが変わる",
    hiddenTrackDuplicateMessage: "共有の断りが使えない場面だけの文（複製は必ず元の列に作る）",
    volumePointsTooManyMessage: "分けられる部品の有無で締めが変わる",
    audioUnreadableMessage: "音源の種類（読み上げ／同梱の曲／取り込んだ素材）で次の行動が変わる",
    missingTemplateMessage: "件数の有無で締めが変わる",
    sceneTemplateProblemMessage: "候補の有無で締めが変わる（3段の出し分け）",
    subtitleOverflowMessage: "原因（同時に出しすぎ／1帯が大きい）で次の行動が変わる",
    silentSubtitleMessage: "出ない理由（`SubtitleSilentReason`）ごとに次の行動が変わる",
    assetTooLargeMessage: "画面ごとに次の行動が違う（別の取り込み方があるか）＝`15 §6` も①②で書いている",
    noScenesMessage: "4画面で共有し、画面ごとに次の行動が違う",
    standardLookResultMessage: "直った数・直せなかった数の組み合わせで文が変わる",
    freeSwitchConfirmMessage: "動画に出なくなる中身の件数と種類で文が変わる",
    // ⚠️ **名前は受け取っていない**（PR #1065 レビュー 🟡＝私の分類が実装と食い違っていた）＝
    //   3つの数（変わる／出なくなる／直せない）で**最大4つの節が有無で組み合わさる**。
    deleteLookConfirmMessage: "3つの数で節の有無が変わる（名前は受け取らない）",
    // ── 押せない理由・進み具合の知らせ（`15 §6` の「エラー・状態」の行とは別のもの） ──
    // ⚠️ **表に載せる筋のものではない**＝どれも「いまはこうだから押せない」を**その場で**言うもので、
    //   状態の一覧（`15 §6`）に対応する行を持たない（持たせると、表が画面の文字の一覧になる）。
    bulkVoiceRunningNotice: "走っている件数を差し込む進み具合の知らせ（状態の行ではない）",
    bulkVoiceDisabledReason: "押せない理由を状況で選ぶ（形式ごとの呼び名も差し込む）",
    standardLookButtonReason: "押せない理由を状況で選ぶ",
    subtitleOverflowPrecheckDetail: "公開前チェックの詳しい説明（原因ごとに変わる）",
    swallowedByNextPrecheckDetail: "同上（次の場面に飲まれる場面の説明）",
    omittedAssetsNote: "送信前確認で「送らなかったもの」を件数つきで添える",
    // ── 外から来た文字列を運ぶ（この関数は文言を持たない） ──
    importErrorMessage: "取り込み側が返した理由を関門（`userFacingMessage`）越しに出す（持っているのは既定の1文だけ・#1123）",
    generateFailedMessage: "作成側が返した理由をそのまま出す",
    resolveExportBlockedMessage: "状況から**既にある文**を選んで返すだけ（自分では持たない）",
    // ── 名前・件数を差し込むだけ（表は代表の1文を持つ）＝等値へ寄せられる余地あり ──
    importPartlyFailedMessage: "件数と名前を差し込むだけ＝等値へ寄せる余地あり",
    droppedRejectMessage: "同上（落とせない形式が混ざったとき＝`DROP_REJECTED`）",
    libraryPartlyFailedMessage: "同上（よく使う素材の側）",
    importCancelledMessage: "入った件数で言い方が変わる（0件のときは件数を言わない）",
    // ⚠️ **等値へ寄せるには、先に表へ行を足す必要がある**（同レビュー）＝いまは表に対応する行が無い
    //   （`clipClampedMessage` は `ASSET_FILE_MISSING` の由来欄で触れられているだけ）。
    assetTypeMismatchMessage: "種類（動画／音／写真）×形式（場面／タイムライン）＝6通り。表に行が無い",
    clipClampedMessage: "件数×形式。表に行が無い（由来欄で触れているだけ）",
  };

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

  /**
   * **組み立てる文言（`*Message` の関数）も、どちらかで見られている**（#1051）。
   *
   * ⚠️ **`*_MESSAGE`（素の文字列）だけを見ていた**＝関数で組み立てる文言は**この段の外**で、
   * 弱い段（実装のどこかに在るか）でしか守られていなかった。**名前で線を引く**＝
   * `*Message` は断り・知らせ、それ以外（`*Label`・`format*`・`*Text`）は**ラベルや書式**なので対象外。
   */
  // ⚠️ **外した控えが腐らないようにする**（PR #1065 レビュー 🟡）＝`ASSEMBLED_AT_RUNTIME` には
  //    同じ検査があるのに、こちらには無かった（消えた関数を外し続けても気づけない）。
  it("外したまま実装から消えた関数が残っていない", () => {
    const src = readFileSync(join(process.cwd(), "src/app/uiLabels.ts"), "utf8");
    const gone = (keys: string[]): string[] => keys.filter((n) => !src.includes(`export function ${n}(`));
    expect(gone(Object.keys(MESSAGE_FN_EXEMPT)), "実装から消えたのに外し続けている").toEqual([]);
    // ⚠️ **見つけられることも見る**＝いま腐りが1つも無いので、上の行だけでは
    //   「見つけられない実装」でも緑になる（門番の枝を直接見る）。
    expect(gone(["thisFunctionDoesNotExist"]), "腐りを見つけられない").toEqual(["thisFunctionDoesNotExist"]);
  });

  it("`uiLabels` の断り・知らせの関数は、等値で守るか、理由つきで外してある", () => {
    const src = readFileSync(join(process.cwd(), "src/app/uiLabels.ts"), "utf8");
    // ⚠️ **`*Message` だけでは足りない**（PR #1065 レビュー 🟡）＝`*Reason`／`*Notice`／`*Detail`／`*Note`
    //   という名前の**断り・知らせ**が実在し、命名規約1つの外側に同じ穴が残っていた。
    const names = [...src.matchAll(/export function ([a-z][A-Za-z0-9_]*(?:Message|Reason|Notice|Detail|Note))\s*\(/g)].map((m) => m[1]);
    expect(names.length, "1つも拾えていない＝走査が壊れている").toBeGreaterThanOrEqual(15);
    // ⚠️ **線引きそのものを固定する**（PR #1065 レビュー 🟡）＝`*Message` だけへ戻しても、
    //   外してあるものが外してあるだけなら**緑のまま**通る（狭まったことに気づけない）。
    expect(names, "`*Reason` を見ていない").toContain("bulkVoiceDisabledReason");
    expect(names, "`*Notice` を見ていない").toContain("bulkVoiceRunningNotice");
    expect(names, "`*Detail` を見ていない").toContain("subtitleOverflowPrecheckDetail");
    expect(names, "`*Note` を見ていない").toContain("omittedAssetsNote");
    const guarded = new Set([...Object.keys(codeMessages()), ...Object.keys(ASSEMBLED_AT_RUNTIME)]);
    const body = readFileSync(join(process.cwd(), "src/app/errorStateTable.test.ts"), "utf8");
    // 等値で守るときは `codeMessages()` の中で呼ぶ（＝この検査ファイルに名前が出る）。
    const unguarded = names.filter((n) => !body.includes(`${n}(`) && !guarded.has(n) && !(n in MESSAGE_FN_EXEMPT));
    expect(unguarded, "`codeMessages()` へ載せるか、理由つきで `MESSAGE_FN_EXEMPT` へ").toEqual([]);
  });

  // ⚠️ **この段が見るのは `uiLabels.ts` の `*_MESSAGE` だけ**（PR #1048 レビュー ℹ️）＝関数で
  //    組み立てる文言・画面やほかの層に直書きした文字列は**この段の外**（弱い段でしか守られていない）。
  //    「これで全部守られている」と読まれないように書き残す。射程を広げるのは別で追う。
  // ⚠️ **エスケープを含む文言は取り違えうる**＝ソースの文字をそのまま読むので、改行の記号（\n）を含む文言を
  //    足すと**実際の値と別の文字列**として拾う。ただし拾い方が崩れれば `literal: null` に落ち、
  //    `MESSAGE_EXEMPT` に無ければ**赤くなる**（黙って通らない＝失敗の向きは安全側）。
  it("`*_MESSAGE` は、必ず等値で守られている（載せ忘れたら落ちる）", () => {
    // ⚠️ **`uiLabels.ts` の外も見る**（#1051）＝`domain`・`store` にも `*_MESSAGE` があり、
    //   そこは**弱い段でしか守られていなかった**（`PROJECT_NEWER_VERSION_MESSAGE` ほか）。
    const found = messageConstFiles().flatMap((f) => messageConstsOf(readFileSync(f, "utf8")));
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
  // ⚠️ **見る範囲そのものを固定する**（#1051）＝ファイルを1つに戻しても、載っているものが
  //    載っているだけなら**緑のまま**通る（範囲が狭まったことに気づけない）。
  it("`uiLabels` の外の `*_MESSAGE` も拾っている（見る範囲が狭まったら落ちる）", () => {
    const names = messageConstFiles().flatMap((f) => messageConstsOf(readFileSync(f, "utf8")).map((x) => x.name));
    expect(names, "`domain` の断りを見ていない").toContain("PROJECT_NEWER_VERSION_MESSAGE");
    expect(names, "`store` の断りを見ていない").toContain("OTHER_EXPORT_RUNNING_MESSAGE");
  });

  it("組み立てた文は「中身を取れない」として拾う（門番の枝を直接見る）", () => {
    const fixture = [
      'export const A_MESSAGE = "あ" + "い";',
      "export const B_MESSAGE = `${name}を読み込めません`;",
      'export const C_MESSAGE = "「や、め、る」は。区切りを含む";',
      // ⚠️ **引用符は両方**（#1051）＝層で流儀が違う。
      "export const D_MESSAGE =\n  'ひとえの引用符でも読む';",
      // ⚠️ **混ざった連結**（同レビュー ℹ️）＝1つの式の中で二重と単の引用符が混ざっても取り違えない。
      "export const E_MESSAGE = \"ふた\" + 'えの';",
    ].join("\n");
    expect(messageConstsOf(fixture)).toEqual([
      { name: "A_MESSAGE", literal: "あい" },
      { name: "B_MESSAGE", literal: null },
      { name: "C_MESSAGE", literal: "「や、め、る」は。区切りを含む" },
      { name: "D_MESSAGE", literal: "ひとえの引用符でも読む" },
      { name: "E_MESSAGE", literal: "ふたえの" },
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
    // ⚠️ **表の実体を見る**（#1090 案C で `15 §6` から `errors/error-state-table.tsv` へ移した）。
    const flat = tableLines().join("\n").replace(/\s/g, "");
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
    // ⚠️ **+3**＝`OPEN_NOT_ALLOWED` / `OPEN_GONE` / `OPEN_FAILED`（#1118）。
    // どれも `rustMessages()` へ登録したので、表と実装の食い違いは機械で見える。
    // ⚠️ **+14**＝関門へ寄せたときの既定の文（#1123／PR #1130）。こちらは TS 側の走査
    //（`uiMessageScan`）が文面で突き合わせる（`codeMessages()` への登録は無いので 84 は動かない）。
    // ⚠️ **+13**＝`messages.rs` の定数（#1129）。`rustMessages()` が丸ごと読むので、
    //   文面のズレも機械で見える（`codeMessages()` への登録は無いので 84 は動かない）。
    // ⚠️ **+2**＝`API_KEY_SAVED_UNVERIFIED` / `API_KEY_DELETED_UNVERIFIED`（#1131）。
    // ⚠️ **+2**＝#1204（上と同じ2行）。
    // ⚠️ **+6**（#1244）＝上と同じ6行。
    expect(readErrorTable().size, "表の行数が変わった（増減とも、対応を確かめてから数を更新する）").toBe(252);
    expect(
      Object.keys(codeMessages()).length,
      "完全一致で守れている件数が変わった（退役なら数を下げ、追加なら families へ載っているか確かめる）",
      // ⚠️ **+2**＝見た目パターンの保存・削除の既定文（#1129 レビュー由来 🟡）。
      //   `projectStore` の直書きをやめて `templateSaveMessage` へ出したので、
      //   **その場に書いた文の走査**から**完全一致で守る側**へ移った（守りは強くなる）。
      // ⚠️ **+5**＝接続キーの5文（#1131）。2つは既定文（直書きから定数へ）、
      //   3つは新設（「できたが確かめられなかった」2つ＋「入った時点で確かめられない」1つ
      //   ＝案内の先で黙らないため＝#1134 レビュー由来）。
      // ⚠️ **+4**＝#356 ② の断り4つ（`FREEZE_NOT_VIDEO` / `FREEZE_FAILED` /
      //   `FREEZE_ASSET_MISSING` / `FREEZE_CHANGED`。うち3つは #1136 レビュー由来）。
      //   ⚠️ **「+5」と書いて4つしか挙げていなかった**（α 出口監査の申し送り）＝実差分も 91→95 の +4。
      //   ⚠️ **1件ずつ確かめて数を直す**＝「+1」と書いたまま数だけ動かすと、次の人が
      //   1件しか確かめずに済ませる（実際にそう書いていた＝レビュー指摘）。
      // ⚠️ **+1**＝`TIMELINE_EDIT_MARKER_EXISTS`（#1149 ①）。
      // ⚠️ **+1**＝`CAPTURE_FRAME_ASSET_MISSING`（#1155 ⑤＝タイムライン形式の双子と揃えた）。
      // ⚠️ **+7**＝起動のときに頼まれた仕事の断り（ADR-0042・#1184）＝引数4通り＋開いている／読めない／開けない。
    // ⚠️ **+2**＝#1204＝頼まれた回だけの断り2件。
    ).toBe(110);
  });
});
