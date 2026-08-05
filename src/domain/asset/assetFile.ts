// アップロードされたファイル名から素材種別・拡張子を判定する純粋ロジック（CLAUDE.md §4：domain は副作用なし）。
// 取り込み可能な形式の正典が未確定のため、ここを取り込み判定の単一の参照元とする（MVP・§2-7）。
import { ASSET_TYPE, type AssetType } from '../enums';
import { MAX_INLINE_ASSET_BYTES } from '../constants';
import { createAssetId } from '../project/persistence';
import type { Asset } from '../project/types';

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

/**
 * 取り込むファイルの名前から、素材1つぶんの中身と保存先のファイル名を決める（#712）。
 *
 * **同じ導出を取り込み経路ごとに書かない**（§2-7）。以前は `projectStore` の `addAsset` と
 * `addAssetByPath` に同じ7行が2つあり、タイムライン形式の取り込みを足すと4つになるところだった。
 *
 * `name` は**ファイル名でもパスでもよい**（`/` と `\` の両方で末尾を取る）＝ネイティブの「開く」が
 * 返す絶対パスをそのまま渡せる。拡張子が無ければ種別ごとの既定を使う（保存先に拡張子が要る）。
 */
export function newAssetFrom(
  name: string,
  existingIds: readonly string[],
  /** 採番済みの番号を使う（呼び出し側が「使い回さない」規則で採ったとき＝#712 レビュー）。 */
  reservedId?: string,
): { asset: Asset; fileName: string } {
  const namePart = name.split(/[/\\]/).pop() ?? name;
  const assetId = reservedId ?? createAssetId(existingIds);
  const assetType = detectAssetType(namePart);
  const ext = fileExtension(namePart) || (assetType === ASSET_TYPE.video ? 'mp4' : 'png');
  const parts = namePart.split('.');
  const baseName = parts.length > 1 ? parts.slice(0, -1).join('.') : namePart;
  const fileName = `${assetId}.${ext}`;
  return {
    asset: {
      assetId,
      assetType,
      // 名前が空/空白だけでも**一覧で選べる名前**にする（無名の行を作らない）。
      displayName: baseName.trim() || '新しい素材',
      filePath: `assets/${fileName}`,
    },
    fileName,
  };
}
