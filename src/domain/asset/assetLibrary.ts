// ユーザー素材ライブラリ（ADR-0035・#260）の純粋な部分（§7 テスト対象）。
//
// ⚠️ **持ち込みは「コピー」**（決定3）＝取り込むときに `asset_NNN` を採番し直して複製するので、
// **`lib_asset_NNN` は `project.json` に現れない**（`project.schema` は不変）。
// 参照にしない理由＝別PCへ移すと**全プロジェクトが同時に欠損**し、再リンク（#347）の対象が跳ね上がる。
// ⚠️ **タグはコピー時に持ち込む**（書き戻さない）＝ライブラリ側の分類とプロジェクト側の分類は別物。
import { createAssetId } from '../project/persistence';
import type { AssetType } from '../enums';
import type { Asset } from '../project/types';

/**
 * ライブラリの素材の id の形。`asset_NNN` と同じ流儀の3桁ゼロ詰め（`11 §2`）。
 * ⚠️ **Rust の `is_library_asset_id` と一致させる**（片方だけ変えると保存できるのに読めない）。
 */
export const LIBRARY_ASSET_ID_RE = /^lib_asset_[0-9]{3,}$/;

/**
 * ⚠️ **同じ規則が Rust 側（`is_library_asset_id`）にもある**（PR #887 レビュー 🟡）。
 * Rust 側はパストラバーサル防止を兼ねるので落とせず、こちらは採番に要る。
 * **片方だけ変えると保存できるのに読めない**ので、テストが**同じ入力で同じ答えになる**ことを固定する。
 * ここに置くのは「テストが見る入力の一覧」＝規則そのものは上の正規表現が持つ。
 */
export const LIBRARY_ASSET_ID_SAMPLES: readonly string[] = [
  'lib_asset_001',
  'lib_asset_1000',
  'lib_asset_1', // 3桁ゼロ詰めでない
  'lib_asset_00a', // 数字でない
  'xlib_asset_001', // 前に付いている
  'lib_asset_001x', // 後ろに付いている
  'lib_asset_', // 番号が無い
  'asset_001', // 別の採番
  '', // 空
];

/** ライブラリの素材1つぶん（Rust の `LibraryAsset` と対応）。 */
export interface LibraryAsset {
  id: string;
  fileName: string;
  displayName: string;
  assetType: AssetType;
  tags: string[];
}

/** ライブラリの素材の id か（形だけを見る＝ファイルがあるかは別の話）。 */
export function isLibraryAssetId(id: unknown): id is string {
  return typeof id === 'string' && LIBRARY_ASSET_ID_RE.test(id);
}

/**
 * 次のライブラリ id を採る（既存の最大＋1・3桁ゼロ詰め）。
 * ⚠️ **消した番号は使い回さない**＝`existingIds` には **これまでに使った番号**（外したものを含む＝
 * `usedLibraryAssetIds()`）を渡すこと。**一覧は渡さない**（実体があるものだけなので最大番号を外すと
 * 同じ番号が再発行され、その番号を指している動画が黙って別のものになる＝α-6 出口監査 🟡8）。
 */
export function createLibraryAssetId(existingIds: readonly string[]): string {
  const max = existingIds.reduce((m, id) => {
    const n = isLibraryAssetId(id) ? Number(id.slice('lib_asset_'.length)) : 0;
    return Number.isInteger(n) && n > m ? n : m;
  }, 0);
  return `lib_asset_${String(max + 1).padStart(3, '0')}`;
}

/**
 * ライブラリの素材から、**プロジェクトの素材**を作る（コピーの受け皿）。
 *
 * ⚠️ **`asset_NNN` を採番し直す**＝ライブラリの id はプロジェクトに残さない（決定3）。
 * ⚠️ **タグは持ち込む**（決定＝コピー時に持ち込む・書き戻さない）。
 */
export function assetFromLibrary(
  lib: LibraryAsset,
  existingIds: readonly string[],
): { asset: Asset; fileName: string } {
  const assetId = createAssetId(existingIds);
  const ext = lib.fileName.split('.').pop() ?? 'bin';
  const fileName = `${assetId}.${ext}`;
  return {
    asset: {
      assetId,
      assetType: lib.assetType,
      displayName: lib.displayName,
      filePath: `assets/${fileName}`,
      ...(lib.tags.length > 0 ? { tags: [...lib.tags] } : {}),
    },
    fileName,
  };
}

/**
 * タグと名前で絞り込む（#260 の「タグで探せる」＝足りなかったのはここ）。
 *
 * ⚠️ **タグは「すべて含む」で絞る**（AND）＝タグを足すほど candidates が狭まる、が直感に合う。
 * 名前は**部分一致・大小を区別しない**。空の条件は素通し（何も選んでいない＝全部見せる）。
 */
export function filterLibraryAssets(
  items: readonly LibraryAsset[],
  query: { text?: string; tags?: readonly string[]; assetType?: AssetType | null },
): LibraryAsset[] {
  const text = (query.text ?? '').trim().toLowerCase();
  const tags = query.tags ?? [];
  return items.filter((a) => {
    if (query.assetType && a.assetType !== query.assetType) return false;
    if (text !== '' && !a.displayName.toLowerCase().includes(text)) return false;
    return tags.every((t) => a.tags.includes(t));
  });
}

/** 一覧にあるタグを重複なく並べる（絞り込みの選択肢に使う。並びは出現順＝入れた順に見える）。 */
export function libraryTags(items: readonly LibraryAsset[]): string[] {
  const out: string[] = [];
  for (const a of items) for (const t of a.tags) if (!out.includes(t)) out.push(t);
  return out;
}
