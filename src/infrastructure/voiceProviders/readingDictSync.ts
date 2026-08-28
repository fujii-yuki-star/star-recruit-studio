// 声を作る直前に読み方辞書をそろえる（ADR-0037 決定2・決定7）。
//
// ⚠️ **呼び口を1つにする**＝合成の入口は5か所あり（場面形式3・タイムライン形式2）、
// それぞれに配線すると**片方だけ漏れる**。`VoicevoxProvider.synthesize` の中で通す＝
// 書き出し前に同梱フォントをそろえる（`loadExportFonts`）と同じ形。
//
// ⚠️ **反映できなかったら黙って作らない**（決定7・§2-5）＝送れないエンジン
//（`--disable_mutable_api` 等）では次の行動を出して断る。誤読のまま成功にしない。
import { loadReadingDict, saveReadingDict, withLinks } from '../readingDictFs';
import { syncReadingDict } from './userDict';
import type { DictSyncResult } from './userDict';

/** このセッションでそろえ終わっているか（辞書を編集したら false へ戻す）。 */
let synced = false;
/** 同時に走らせない（一括作成は行ごとに呼ぶので、毎回 `GET /user_dict` を叩かない）。 */
let inFlight: Promise<void> | null = null;
/** 直近の同期で「黙って上書きしなかった」語（決定3b）＝画面が知らせるために覚えておく。 */
let lastConflicts: DictSyncResult['conflicts'] = [];

/** 辞書を編集したときに呼ぶ＝次に声を作るときそろえ直す（決定2「編集したら即反映」の受け皿）。 */
export function markReadingDictChanged(): void {
  synced = false;
}

/** テスト用に状態を戻す（モジュールの状態はファイル内のテスト間で残るため）。 */
export function resetReadingDictSync(): void {
  synced = false;
  inFlight = null;
  lastConflicts = [];
}

/** 直近の同期で黙って上書きしなかった語。 */
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
  if (synced) return;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const dict = await loadReadingDict();
    if (dict.entries.length === 0 && Object.keys(dict.links).length === 0) {
      synced = true;
      lastConflicts = [];
      return;
    }
    let result: DictSyncResult;
    try {
      result = await syncReadingDict(dict.entries, dict.links);
    } catch (e) {
      // ⚠️ 断る（決定7）。原因ではなく**次の行動**を出す（§2-5）。
      throw new Error(
        `読み方を音声ソフトへ反映できませんでした。${e instanceof Error ? e.message : ''}` +
          '\n設定の「音声ソフトの接続先」を確かめてから、もう一度お試しください。' +
          '\n（読み方が反映されないまま声を作ると、会社名や人名が違う読みになります）',
        { cause: e },
      );
    }
    lastConflicts = result.conflicts;
    // 控えが動いたときだけ書く（毎回書かない＝ファイルの更新時刻を無駄に動かさない）。
    if (JSON.stringify(result.links) !== JSON.stringify(dict.links)) {
      await saveReadingDict(withLinks(dict, result.links));
    }
    synced = true;
  })();
  try {
    await inFlight;
  } finally {
    inFlight = null;
  }
}
