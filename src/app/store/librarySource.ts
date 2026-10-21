// 素材の棚から動画へ入れるときの「出どころ」（ADR-0035 の棚＋ADR-0060 段階2b の拡張パックの音楽）。
//
// ⚠️ **両方の形式の取り込みがここを通る**（場面形式 `projectStore.importFromLibrary`／タイムライン形式 `timelineStore.importFromLibrary`）＝
//   出どころの見分けと断りの文を1か所に置く。形式ごとに書くと、片方だけパックの音楽を受けない（ADR-0026②）。
// ⚠️ **パックの音楽も動画へコピーする**（ADR-0060 決定5）＝動画の中の素材は普通の `asset_NNN`。パックを外しても鳴る。
import type { LibraryAsset } from '../../domain/asset/assetLibrary';
import { ASSET_TYPE } from '../../domain/enums';
import { isPackScopedId, packBgms, type ExtensionPackManifest } from '../../domain/pack/extensionPack';
import { copyLibraryAssetToProject, listLibraryAssets } from '../../infrastructure/assetLibraryFs';
import { copyPackFileToProject } from '../../infrastructure/packFs';
import { LIBRARY_ASSET_MISSING_MESSAGE, LIBRARY_LIST_UNREADABLE_MESSAGE } from '../uiLabels';

/** 入っているパックの音楽を、棚の行と同じ形にする（棚の画面と取り込みが同じ形で扱えるように）。 */
export function packBgmLibraryAssets(manifests: readonly ExtensionPackManifest[]): LibraryAsset[] {
  return packBgms(manifests).map((b) => ({
    id: b.id,
    fileName: b.file.split('/').pop() ?? b.file,
    displayName: b.displayName,
    assetType: ASSET_TYPE.bgm,
    tags: [],
  }));
}

export interface LibrarySource {
  lib: LibraryAsset;
  /** 動画の素材の置き場へコピーし、動画の中の相対パスを返す。 */
  copy: (projectId: string, fileName: string) => Promise<string>;
}

/** 棚の行の id（またはパックの音楽の id）から、取り込みの出どころを引く。見つからなければ利用者向けの理由。 */
export async function resolveLibrarySource(
  id: string,
  manifests: readonly ExtensionPackManifest[],
): Promise<{ ok: true; source: LibrarySource } | { ok: false; error: string }> {
  if (isPackScopedId(id)) {
    const bgm = packBgms(manifests).find((b) => b.id === id);
    const lib = packBgmLibraryAssets(manifests).find((a) => a.id === id);
    if (!bgm || !lib) return { ok: false, error: LIBRARY_ASSET_MISSING_MESSAGE };
    return { ok: true, source: { lib, copy: (projectId, fileName) => copyPackFileToProject(bgm.packId, bgm.file, projectId, fileName) } };
  }
  // ⚠️ **「読めなかった」と「1つも無い」を分ける**（差分再監査 2巡目・§2-5）＝`null` を潰して
  // 「見つかりませんでした」に丸めると、**置いてあるのに置いていないかのような案内**になる。
  const list = await listLibraryAssets();
  if (list == null) return { ok: false, error: LIBRARY_LIST_UNREADABLE_MESSAGE };
  const lib = list.find((a) => a.id === id);
  if (!lib) return { ok: false, error: LIBRARY_ASSET_MISSING_MESSAGE };
  return { ok: true, source: { lib, copy: (projectId, fileName) => copyLibraryAssetToProject(id, projectId, fileName) } };
}
