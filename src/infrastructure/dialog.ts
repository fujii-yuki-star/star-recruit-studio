// 保存ダイアログ（Tauriプラグイン境界）。app 層から Tauri 依存を隔離する（CLAUDE.md §4）。
// 呼び出し側は Tauri 検出済み（canExport 等）であること。キャンセル時は null を返す。
import { open, save } from '@tauri-apps/plugin-dialog';
import { IMAGE_FILE_EXTENSIONS, VIDEO_FILE_EXTENSIONS } from '../domain/asset/assetFile';

/** 動画(MP4)の保存先をネイティブ保存ダイアログで選ぶ。defaultName は拡張子なしの初期ファイル名。キャンセル時は null。 */
export async function showSaveVideoDialog(defaultName: string): Promise<string | null> {
  return save({
    defaultPath: `${defaultName}.mp4`,
    filters: [{ name: '動画', extensions: ['mp4'] }],
  });
}

/**
 * 写真・動画の素材をネイティブの「開く」ダイアログで1つ選び、その絶対パスを返す（キャンセル時は null）。
 * パスを Rust に渡してコピーすることで、JS は素材バイトを一切読まずに取り込める（メモリ最適化＝真の0コピー）。
 */
export async function showOpenAssetDialog(): Promise<string | null> {
  const picked = await open({
    multiple: false,
    directory: false,
    filters: [
      { name: '写真・動画', extensions: [...IMAGE_FILE_EXTENSIONS, ...VIDEO_FILE_EXTENSIONS] },
    ],
  });
  // multiple:false のため string | null。型上の string[] は使わないので正規化する。
  return typeof picked === 'string' ? picked : null;
}
