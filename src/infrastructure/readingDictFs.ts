// 読み方辞書（ADR-0037・#350）の保存/読込（Tauri コマンド境界・§4）。
// 保存先は appData/readingdict.json（全プロジェクト共通＝グローバル・決定1）。
// Tauri 非検出時（ブラウザ開発）は空・no-op＝開発フローを止めない（userTemplateFs と同方針）。
import { invoke } from '@tauri-apps/api/core';
import type { EngineLinks, ReadingEntry } from '../domain/voice/readingDict';

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
 * 保存されている形かを見る（§2-2＝生のまま内部へ流さない）。
 * 壊れた語は**その語だけ落とす**（1語のせいで辞書全部を失わない）。
 */
export function parseReadingDict(text: string): ReadingDictFile {
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== 'object' || raw === null) return emptyReadingDict();
  const obj = raw as Record<string, unknown>;
  const entries = Array.isArray(obj.entries)
    ? obj.entries.flatMap((v): ReadingEntry[] => {
        if (typeof v !== 'object' || v === null) return [];
        const e = v as Record<string, unknown>;
        if (typeof e.surface !== 'string' || e.surface === '') return [];
        if (typeof e.yomi !== 'string' || e.yomi === '') return [];
        const accentType = typeof e.accentType === 'number' && Number.isInteger(e.accentType) && e.accentType >= 0 ? e.accentType : 0;
        return [{ surface: e.surface, yomi: e.yomi, accentType }];
      })
    : [];
  const links: Record<string, string> = {};
  if (typeof obj.links === 'object' && obj.links !== null) {
    for (const [k, v] of Object.entries(obj.links as Record<string, unknown>)) {
      if (typeof v === 'string' && v !== '') links[k] = v;
    }
  }
  return { version: READING_DICT_VERSION, entries, links };
}

/** 辞書を読む（無ければ空）。 */
export async function loadReadingDict(): Promise<ReadingDictFile> {
  if (!isTauri()) return emptyReadingDict();
  const text = await invoke<string | null>('load_reading_dict');
  if (text == null) return emptyReadingDict();
  try {
    return parseReadingDict(text);
  } catch {
    // 壊れて読めないファイルは**上書きしない**（利用者が直せる余地を残す）＝空として扱うだけ。
    return emptyReadingDict();
  }
}

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

/** 読み込んだ本文から語を取り出す（`links` は無視する＝持ち込まない）。 */
export function readingDictImportEntries(text: string): ReadingEntry[] {
  return parseReadingDict(text).entries;
}

/** 書き出す（利用者が選んだ場所へ）。 */
export async function exportReadingDictTo(path: string, entries: readonly ReadingEntry[]): Promise<void> {
  if (!isTauri()) return;
  await invoke('write_text_file', { path, text: readingDictExportJson(entries) });
}

/** 読み込む（利用者が選んだファイルから）。**足す**のは呼ぶ側（`mergeDict`）。 */
export async function importReadingDictFrom(path: string): Promise<ReadingEntry[]> {
  if (!isTauri()) return [];
  return readingDictImportEntries(await invoke<string>('read_text_file', { path }));
}
