// 保存ダイアログ（Tauriプラグイン境界）。app 層から Tauri 依存を隔離する（CLAUDE.md §4）。
// 呼び出し側は Tauri 検出済み（canExport 等）であること。キャンセル時は null を返す。
import { save } from '@tauri-apps/plugin-dialog';

/** 動画(MP4)の保存先をネイティブ保存ダイアログで選ぶ。defaultName は拡張子なしの初期ファイル名。キャンセル時は null。 */
export async function showSaveVideoDialog(defaultName: string): Promise<string | null> {
  return save({
    defaultPath: `${defaultName}.mp4`,
    filters: [{ name: '動画', extensions: ['mp4'] }],
  });
}
