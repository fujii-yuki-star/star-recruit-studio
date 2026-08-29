// 読み方辞書（ADR-0037・#350）の保存/読込（Tauri コマンド境界・§4）。
// 保存先は appData/readingdict.json（全プロジェクト共通＝グローバル・決定1）。
// Tauri 非検出時（ブラウザ開発）は空・no-op＝開発フローを止めない（userTemplateFs と同方針）。
import { invoke } from '@tauri-apps/api/core';
import { isValidYomi, splitMorae, type EngineLinks, type ReadingEntry } from '../domain/voice/readingDict';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** 版（形が変わったときに上げる。いまは初版のみ＝移行は不要）。 */
export const READING_DICT_VERSION = 1;

/**
 * 保存する形。
 *
 * ⚠️ **`entries`（正典）と `links`（控え）を分けて持つ**（決定3b を構造で守る）＝
 * `links` は「いま繋がっているエンジンでの `word_uuid`」で、別PCへ移す・エンジンを入れ直すと通用しない。
 * **書き出し（決定8）は `entries` だけを書く**ので、控えが混ざりようがない。
 */
export interface ReadingDictFile {
  version: number;
  entries: ReadingEntry[];
  links: Record<string, string>;
}

/** 空の辞書（初回起動・ブラウザ開発）。 */
export function emptyReadingDict(): ReadingDictFile {
  return { version: READING_DICT_VERSION, entries: [], links: {} };
}

/**
 * 保存されている形かを見る（§2-2＝生のまま内部へ流さない）。**落とした語の数も返す**。
 *
 * ⚠️ **読みがカタカナかまで見る**（PR #883 レビュー）＝手で書いたファイル・別の版が書いた
 * ファイルを読み込むと、そのまま保存されて**次の合成で音声ソフトが拒否**し、決定7 と噛み合って
 * **以後すべての声作成が止まる**（しかも案内は「接続先を確かめてください」＝原因と無関係）。
 * ⚠️ **下がる場所も音の粒の数へ収める**（範囲外は拒否される）。
 * 落とした語は**数を返して知らせる**＝黙って消さない（§2-5）。
 */
export function parseReadingDictWithDrops(text: string): { file: ReadingDictFile; dropped: number } {
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== 'object' || raw === null) return { file: emptyReadingDict(), dropped: 0 };
  const obj = raw as Record<string, unknown>;
  let dropped = 0;
  const entries = Array.isArray(obj.entries)
    ? obj.entries.flatMap((v): ReadingEntry[] => {
        if (typeof v !== 'object' || v === null) { dropped += 1; return []; }
        const e = v as Record<string, unknown>;
        if (typeof e.surface !== 'string' || e.surface === '') { dropped += 1; return []; }
        if (typeof e.yomi !== 'string' || !isValidYomi(e.yomi)) { dropped += 1; return []; }
        const raw2 = e.accentType;
        // 下がる場所は音の粒の数まで（範囲外は音声ソフトが拒否する）。数でなければ 0（下がらない）。
        const max = splitMorae(e.yomi).length;
        const accentType =
          typeof raw2 === 'number' && Number.isInteger(raw2) && raw2 >= 0 ? Math.min(raw2, max) : 0;
        return [{ surface: e.surface, yomi: e.yomi, accentType }];
      })
    : [];
  const links: Record<string, string> = {};
  if (typeof obj.links === 'object' && obj.links !== null) {
    for (const [k, v] of Object.entries(obj.links as Record<string, unknown>)) {
      if (typeof v === 'string' && v !== '') links[k] = v;
    }
  }
  return { file: { version: READING_DICT_VERSION, entries, links }, dropped };
}

/** 落とした数が要らないときの入口（保存ファイルの読込）。 */
export function parseReadingDict(text: string): ReadingDictFile {
  return parseReadingDictWithDrops(text).file;
}

/**
 * 辞書を読む（無ければ空）。
 *
 * ⚠️ **壊れて読めないファイルは断る**（α-6 出口監査 🟡19 のレビュー・目録〔`parse_manifest`〕と同じ流儀）＝
 * 空として返すと、画面が「1つも無い」を見せ、次の保存が**その空で丸ごと上書き**して登録した読みが全部消える
 *（元のコメントは「上書きしない」と書いていたが、そうなっていなかった）。断れば書き込みが走らないので、
 * **壊れたファイルはそのまま残る**（利用者が直せる余地）。壊れた**語**は `parseReadingDictWithDrops` が
 * 1件ずつ落として数を返す＝丸ごと捨てるのは「JSON ですら無い」ときだけ。
 */
export async function loadReadingDict(): Promise<ReadingDictFile> {
  if (!isTauri()) return emptyReadingDict();
  const text = await invoke<string | null>('load_reading_dict');
  if (text == null) return emptyReadingDict();
  try {
    return parseReadingDict(text);
  } catch {
    throw READING_DICT_UNREADABLE;
  }
}

/**
 * 読めなかったときの断り（§2-5＝次の行動を示す）。⚠️ **中身を失わないよう書き込みも止める**。
 */
export const READING_DICT_UNREADABLE =
  '読み方の一覧を読めませんでした。中身を失わないよう、足す・外すは止めています。アプリを開き直してください。';

/** 辞書を書く（丸ごと置き換え）。 */
export async function saveReadingDict(dict: ReadingDictFile): Promise<void> {
  if (!isTauri()) return;
  await invoke('save_reading_dict', { dictJson: JSON.stringify({ ...dict, version: READING_DICT_VERSION }, null, 2) });
}

/** 控えだけを差し替えて保存する（同期のあとに呼ぶ）。 */
export function withLinks(dict: ReadingDictFile, links: EngineLinks): ReadingDictFile {
  return { ...dict, links: { ...links } };
}

/** 書き出す本文（決定8）。**控えを含めない**＝渡した先で通用せず、失敗の原因にしかならない。 */
export function readingDictExportJson(entries: readonly ReadingEntry[]): string {
  return JSON.stringify({ version: READING_DICT_VERSION, entries }, null, 2);
}

/**
 * 読み込んだ本文から語を取り出す（`links` は無視する＝持ち込まない）。
 * **形が違って入れられなかった数**も返す＝黙って消さない（§2-5）。
 */
export function readingDictImportEntries(text: string): { entries: ReadingEntry[]; dropped: number } {
  const r = parseReadingDictWithDrops(text);
  return { entries: r.file.entries, dropped: r.dropped };
}

/** 書き出す（利用者が選んだ場所へ）。 */
export async function exportReadingDictTo(path: string, entries: readonly ReadingEntry[]): Promise<void> {
  if (!isTauri()) return;
  await invoke('export_reading_dict', { path, dictJson: readingDictExportJson(entries) });
}

/** 読み込む（利用者が選んだファイルから）。**足す**のは呼ぶ側（`mergeDict`）。 */
export async function importReadingDictFrom(path: string): Promise<{ entries: ReadingEntry[]; dropped: number }> {
  if (!isTauri()) return { entries: [], dropped: 0 };
  return readingDictImportEntries(await invoke<string>('import_reading_dict', { path }));
}
