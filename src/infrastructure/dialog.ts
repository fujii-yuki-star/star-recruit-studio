// 保存ダイアログ（Tauriプラグイン境界）。app 層から Tauri 依存を隔離する（CLAUDE.md §4）。
// 呼び出し側は Tauri 検出済み（canExport 等）であること。キャンセル時は null を返す。
import { open, save } from '@tauri-apps/plugin-dialog';
import { AUDIO_FILE_EXTENSIONS, IMAGE_FILE_EXTENSIONS, VIDEO_FILE_EXTENSIONS } from '../domain/asset/assetFile';

/** 動画(MP4)の保存先をネイティブ保存ダイアログで選ぶ。defaultName は拡張子なしの初期ファイル名。キャンセル時は null。 */
export async function showSaveVideoDialog(defaultName: string): Promise<string | null> {
  return save({
    defaultPath: `${defaultName}.mp4`,
    filters: [{ name: '動画', extensions: ['mp4'] }],
  });
}

/**
 * 写真・動画の素材を**複数まとめて**選ぶ（#858）。キャンセル時は空配列。
 *
 * ⚠️ **1つずつしか選べなかった**＝10枚取り込むのに10回ダイアログを開くことになっていた。
 * パスを Rust に渡してコピーする点は変わらない（JS は素材バイトを読まない＝真の0コピー）。
 */
export async function showOpenAssetsDialog(): Promise<string[]> {
  const picked = await open({
    multiple: true,
    directory: false,
    filters: [
      { name: '写真・動画', extensions: [...IMAGE_FILE_EXTENSIONS, ...VIDEO_FILE_EXTENSIONS] },
    ],
  });
  // multiple:true でも 1件のときに string が返る実装があるため、どちらも配列へ正規化する。
  if (Array.isArray(picked)) return picked.filter((p): p is string => typeof p === 'string');
  return typeof picked === 'string' ? [picked] : [];
}

/**
 * **よく使う素材**（ADR-0035）へ置くファイルを選ぶ。写真・動画に加えて**音楽**も選べる。
 *
 * ⚠️ **場面形式の素材の取り込みとは別の口**（α-6 差分再監査）＝あちら（`showOpenAssetsDialog`）は
 * 写真・動画だけで、BGM は BGM の導線から入れる。棚の側は ADR-0035 が**ロゴ・写真・BGM**を
 * 挙げているので、音も選べないと「置けるはずのものが置けない」になる（種類のタブが常に0件）。
 * ⚠️ **タイムライン形式の取り込みもこの口を使う**（差分再監査 4巡目）＝音そのものが置ける部品なので。
 */
export async function showOpenLibraryAssetsDialog(): Promise<string[]> {
  const picked = await open({
    multiple: true,
    directory: false,
    filters: [
      { name: '写真・動画・音楽', extensions: [...IMAGE_FILE_EXTENSIONS, ...VIDEO_FILE_EXTENSIONS, ...AUDIO_FILE_EXTENSIONS] },
    ],
  });
  if (Array.isArray(picked)) return picked.filter((p): p is string => typeof p === 'string');
  return typeof picked === 'string' ? [picked] : [];
}

/** 読み方辞書の書き出し先を選ぶ（ADR-0037 決定8）。キャンセル時は null。 */
export async function showSaveReadingDictDialog(defaultName: string): Promise<string | null> {
  return save({
    defaultPath: `${defaultName}.json`,
    filters: [{ name: '読み方の一覧', extensions: ['json'] }],
  });
}

/** 読み方辞書の読み込み元を選ぶ（ADR-0037 決定8）。キャンセル時は null。 */
export async function showOpenReadingDictDialog(): Promise<string | null> {
  const picked = await open({
    multiple: false,
    directory: false,
    filters: [{ name: '読み方の一覧', extensions: ['json'] }],
  });
  return typeof picked === 'string' ? picked : null;
}

/** 持ち込みフォントのファイルを選ぶ（ADR-0038・#261）。キャンセル時は null。 */
export async function showOpenFontDialog(): Promise<string | null> {
  const picked = await open({
    multiple: false,
    directory: false,
    filters: [{ name: '文字の形', extensions: ['ttf', 'otf', 'woff', 'woff2'] }],
  });
  return typeof picked === 'string' ? picked : null;
}
