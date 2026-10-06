// 字幕ファイル（.srt／.vtt）の書き出し（ADR-0055 決定4・#1351）。Tauri コマンド境界（§4）。
// 中身（時刻と文字）は domain が組み立てる。ここは保存先を選ばせて書くだけ。
import { invoke } from '@tauri-apps/api/core';
import { formatSubtitleFile, SUBTITLE_FILE_KIND, subtitleFileKindOfPath } from '../domain/subtitle/subtitleFile';
import type { SubtitleCue } from '../domain/subtitle/subtitleFile';
import { showSaveSubtitleDialog } from './dialog';

/** 書き出した結果（`cancelled`＝保存先を選ばずに閉じた）。失敗は例外で返す。 */
export type SubtitleFileSaveResult = { saved: true; count: number } | { saved: false };

/**
 * 保存先を選ばせて字幕を書く。
 * ⚠️ 拡張子が付かずに返ってきたら `.srt` を足す（書き込みの口は `.srt`／`.vtt` しか受けない＝足さないと断られる）。
 */
export async function saveSubtitleFile(cues: readonly SubtitleCue[], defaultName: string): Promise<SubtitleFileSaveResult> {
  const picked = await showSaveSubtitleDialog(defaultName);
  if (!picked) return { saved: false };
  const kind = subtitleFileKindOfPath(picked);
  const path = kind ? picked : `${picked}.${SUBTITLE_FILE_KIND.srt}`;
  await invoke('write_subtitle_file', { path, text: formatSubtitleFile(cues, kind ?? SUBTITLE_FILE_KIND.srt) });
  return { saved: true, count: cues.length };
}
