// アップロードされたファイル名から素材種別・拡張子を判定する純粋ロジック（CLAUDE.md §4：domain は副作用なし）。
// 取り込み可能な形式の正典が未確定のため、ここを取り込み判定の単一の参照元とする（MVP・§2-7）。
import { ASSET_TYPE, type AssetType } from '../enums';
import { MAX_INLINE_ASSET_BYTES } from '../constants';

/** 取り込みを「動画」として扱う拡張子（小文字・ドットなし）。 */
export const VIDEO_FILE_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv'] as const;

/** 取り込みを「画像」として扱う拡張子（小文字・ドットなし）。表示可能な静止画形式（ダイアログの絞り込み用）。 */
export const IMAGE_FILE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif'] as const;

/** ファイル名末尾の拡張子を小文字・英数字のみで返す（無ければ ''）。 */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return '';
  return name
    .slice(dot + 1)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** ファイル名から素材種別を判定する（動画拡張子なら video、ほかは image）。 */
export function detectAssetType(name: string): Extract<AssetType, 'image' | 'video'> {
  return (VIDEO_FILE_EXTENSIONS as readonly string[]).includes(fileExtension(name))
    ? ASSET_TYPE.video
    : ASSET_TYPE.image;
}

/**
 * 取り込み時にメモリへ展開（data URL/生バイト）してよいサイズ上限を超えるか（#48・A3）。
 * true の素材は base64/バイトを JS に載せず、ネイティブ「開く」のパス0コピー取り込みへ誘導する（OOM 保険）。
 */
export function exceedsInlineAssetLimit(bytes: number): boolean {
  return bytes > MAX_INLINE_ASSET_BYTES;
}
