// 読み方辞書を音声ソフトへそろえる（ADR-0037 決定2・決定3b・決定7）。
//
// ⚠️ **呼び口を1つにする**＝合成の入口は4か所あり（場面形式3・タイムライン形式1）、
// それぞれに配線すると**片方だけ漏れる**。`VoicevoxProvider.synthesize` の中で通す＝
// 書き出し前に同梱フォントをそろえる（`loadExportFonts`）と同じ形。
//
// ⚠️ **反映できなかったら黙って作らない**（決定7・§2-5）＝送れないエンジン
//（`--disable_mutable_api` 等）では次の行動を出して断る。誤読のまま成功にしない。
import { getVoicevoxUrl } from '../appSettings';
import { loadReadingDict, saveReadingDict, withLinks } from '../readingDictFs';
import { overwriteEngineWord, syncReadingDict } from './userDict';
import type { DictSyncResult } from './userDict';
import type { ReadingEntry } from '../../domain/voice/readingDict';

/**
 * 辞書のファイルが読めないので声を作らない（差分再監査・ADR-0037 決定7）。
 *
 * ⚠️ **設定画面向けの文言を流用しない**＝あちらは「足す・外すは止めています」で、
 * 声を作ろうとしている人には**いま何が起きたのか**が伝わらない（§2-5＝次の行動を示す）。
 */
export const READING_DICT_UNREADABLE_FOR_VOICE =
  '読み方の一覧を読めませんでした。' +
  'このまま声を作ると、会社名や人名が違う読みになることがあります。' +
  'アプリを開き直してから、もう一度お試しください。';

/**
 * ⚠️ **合成の失敗は「文字列」で投げる**のがこの境界の慣習（Rust の `invoke` が拒否する形）＝
 * 受ける側（`projectStore` / `timelineStore` / 設定画面）が `typeof e === "string"` で見る。
 * `Error` で投げると**この文言が一度も画面に出ず**、「しばらくしてから、もう一度」＝効かない
 * 次の行動に化ける（PR #883 レビュー）。
 */
export const READING_DICT_SYNC_FAILED =
  '読み方を音声ソフトへ反映できませんでした。' +
  '設定の「音声ソフトの接続先」を確かめてから、もう一度お試しください。' +
  '（読み方が反映されないまま声を作ると、会社名や人名が違う読みになります）';

/**
 * **どの接続先に対して**そろえ終わっているか（`null`＝まだ／辞書を編集したら `null` へ戻す）。
 *
 * ⚠️ **接続先ごとに持つ**（PR #883 レビュー）＝1つの真偽値だと、声を1つ作ったあとで
 * 「音声ソフトの接続先」を別のエンジンへ変えても**そろえ直さず**、その辞書に何も映さないまま
 * 声を作ってしまう（ADR-0037 論点2 が (2-A) を退けた理由そのもの）。
 */
let syncedFor: string | null = null;
/** 同時に走らせない（一括作成は行ごとに呼ぶので、毎回 `GET /user_dict` を叩かない）。 */
let inFlight: Promise<void> | null = null;
/** 直近の同期で「黙って上書きしなかった」語（決定3b）＝画面が知らせるために覚えておく。 */
let lastConflicts: DictSyncResult['conflicts'] = [];

/** いまの接続先を表す鍵（未設定は既定の接続先＝空文字で1つに寄せる）。 */
function currentTarget(): string {
  return getVoicevoxUrl() || '';
}

/** 辞書を編集したときに呼ぶ＝次に声を作るときそろえ直す（決定2）。 */
export function markReadingDictChanged(): void {
  syncedFor = null;
}

/** テスト用に状態を戻す（モジュールの状態はファイル内のテスト間で残るため）。 */
export function resetReadingDictSync(): void {
  syncedFor = null;
  inFlight = null;
  lastConflicts = [];
}

/** 直近の同期で黙って上書きしなかった語（決定3b）。画面がこれを出して選ばせる。 */
export function readingDictConflicts(): DictSyncResult['conflicts'] {
  return lastConflicts;
}

/**
 * 読み方辞書をエンジンへそろえる。**そろっていれば何もしない**。
 *
 * ⚠️ **辞書が空で控えも無いときは触らない**＝反映するものが無いので、送れないエンジンでも
 * 声は作れる（この機能を使っていない利用者の書き出しを、新しい検査で止めない）。
 */
export async function ensureReadingDictSynced(): Promise<void> {
  const target = currentTarget();
  if (syncedFor === target) return;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    // ⚠️ **辞書が読めないときの断りは「声を作る」文脈の言葉にする**（差分再監査・§2-5）＝
    // 目録の文言（「足す・外すは止めています」）をそのまま出すと、いましている操作と噛み合わない。
    // 断ること自体は決定7 のとおり（誤読のまま成功にしない）。
    let dict;
    try {
      dict = (await loadReadingDict()).file;
    } catch {
      throw READING_DICT_UNREADABLE_FOR_VOICE;
    }
    if (dict.entries.length === 0 && Object.keys(dict.links).length === 0) {
      syncedFor = target;
      lastConflicts = [];
      return;
    }
    let result: DictSyncResult;
    try {
      result = await syncReadingDict(dict.entries, dict.links);
    } catch {
      // ⚠️ 断る（決定7）。原因ではなく**次の行動**を出す（§2-5）。文字列で投げる理由は上の定数を参照。
      throw READING_DICT_SYNC_FAILED;
    }
    lastConflicts = result.conflicts;
    // 控えが動いたときだけ書く（毎回書かない＝ファイルの更新時刻を無駄に動かさない）。
    if (JSON.stringify(result.links) !== JSON.stringify(dict.links)) {
      await saveReadingDict(withLinks(dict, result.links));
    }
    syncedFor = target;
  })();
  try {
    await inFlight;
  } finally {
    inFlight = null;
  }
}

/**
 * そろえたうえで、**黙って上書きしなかった語**を返す（決定3b）。
 *
 * 画面（設定の「言葉の読み方」）が開いたとき・編集したときに呼ぶ＝**決定2「編集したら即反映」**の
 * 実体でもある。⚠️ **そろえられなくても画面は開ける**＝ここでは投げず、失敗を文字列で返す
 *（声を作る側は `ensureReadingDictSynced` が断る＝止める場所は1つ）。
 */
export async function syncAndCollectConflicts(): Promise<{
  conflicts: DictSyncResult['conflicts'];
  error: string | null;
}> {
  try {
    await ensureReadingDictSynced();
    return { conflicts: readingDictConflicts(), error: null };
  } catch (e) {
    return { conflicts: [], error: typeof e === 'string' ? e : READING_DICT_SYNC_FAILED };
  }
}

/**
 * 利用者が「こちらの読みにする」を選んだ語を、エンジンの語へ上書きする（決定3b）。
 * 上書きした語は**アプリの語になる**ので控えへ入れる（以後は同期で直せるし、外せば消える）。
 */
export async function overwriteConflict(entry: ReadingEntry, uuid: string): Promise<void> {
  const dict = (await loadReadingDict()).file;
  const newUuid = await overwriteEngineWord(entry, uuid);
  await saveReadingDict(withLinks(dict, { ...dict.links, [entry.surface]: newUuid }));
  lastConflicts = lastConflicts.filter((c) => c.entry.surface !== entry.surface);
}
