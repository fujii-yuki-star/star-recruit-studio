// ユーザー素材ライブラリ（ADR-0035・#260）の保存/読込（Tauri コマンド境界・§4）。
// 保存先は appData/user_assets（全プロジェクト共通＝グローバル）。
// Tauri 非検出時（ブラウザ開発）は空・no-op＝開発フローを止めない（userTemplateFs と同方針）。
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { appDataDir, join } from '@tauri-apps/api/path';
import { isLibraryAssetId, type LibraryAsset } from '../domain/asset/assetLibrary';
import { isAssetType, type AssetType } from '../domain/enums';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * ライブラリの一覧（**実体があるものだけ**が返る）。
 *
 * ⚠️ **形を見てから内部へ渡す**（α-6 出口監査 ℹ️・§2-2）＝目録の `assetType` は手で書き換えられる
 * ファイルから来るのに、そのまま `Asset.assetType` へ流れていた（知らない種類は描画・書き出しで
 * 分岐を外れる）。兄弟（`parseBrandKit`・`parseReadingDictWithDrops`）と同じく**項目ごとに落とす**。
 */
export async function listLibraryAssets(): Promise<LibraryAsset[] | null> {
  // ⚠️ **ブラウザ開発は「0件」で確定**（`null` ではない）＝この環境に棚は無い。
  if (!isTauri()) return [];
  try {
    return (await invoke<unknown[]>('list_library_assets')).flatMap(toLibraryAsset);
  } catch {
    // ⚠️ **「読めなかった」を「1つも無い」にしない**（差分再監査）＝空を返すと画面が
    // 「まだ何も置いていません」と言い、置いてあるものが**消えたように見える**（§2-5）。
    // 持ち込みフォント側（`listUserFonts`）と同じ流儀＝`null` は「まだ分からない」。
    // 一覧が読めなくても画面は開ける（プロジェクトの素材は使える）＝行き止まりにしない。
    return null;
  }
}

/**
 * 目録の1行を受け取れる形か見る（受けられなければ落とす＝黙って内部へ流さない・§2-2）。
 *
 * ⚠️ **直接テストできるように出す**（α-6 出口監査 🟡）＝画面経由のテストはこのモジュールごと
 * モックするので、**この判定はどのテストからも実行されていなかった**（一度実装漏れがあった箇所）。
 */
export function toLibraryAsset(raw: unknown): LibraryAsset[] {
  if (typeof raw !== 'object' || raw === null) return [];
  const e = raw as Record<string, unknown>;
  if (!isLibraryAssetId(e.id)) return [];
  if (typeof e.fileName !== 'string' || e.fileName === '') return [];
  if (typeof e.displayName !== 'string') return [];
  if (!isAssetType(e.assetType)) return [];
  const tags = Array.isArray(e.tags) ? e.tags.filter((t): t is string => typeof t === 'string') : [];
  return [{ id: e.id, fileName: e.fileName, displayName: e.displayName, assetType: e.assetType, tags }];
}

/**
 * 棚の素材の**表示用URL**（#926）。プロジェクトの素材（`assetDisplayUrl`）と**同じ流儀**＝
 * `asset://` を組むだけで、バイトは JS に載せない（ADR-0004・大容量でも重くならない）。
 *
 * ⚠️ **置き場所の組み立ては1か所に寄せられない**＝プロジェクトは `projects/<id>/<相対パス>`、
 * 棚は `user_assets/<ファイル名>`（Rust の `user_assets_dir` と対）。同じ関数にすると
 * **どちらの規則で組むか**を引数で分けることになり、取り違えが起きる。
 *
 * ⚠️ **`null` は「出せない」であって「無い」ではない**＝ブラウザ開発（asset protocol が無い）や
 * 組み立ての失敗。呼ぶ側は**絵を出さないだけ**にして、行そのものは消さない。
 *
 * ⚠️ **`tauri.conf.json` の `assetProtocol.scope` に `$APPDATA/user_assets/*` が要る**（#942・実機で確認）＝
 * scope の外は protocol 側が拒むので、**URL は組めるのに読み込みだけ失敗する**（静かに壊れる）。
 * ⚠️ **`/**` ではなく `/*`**＝`/**` は**直下のファイルに当たらない**。ここの中身は `lib_asset_NNN.<ext>` と
 * `library.json` で**常に直下**なので、`/**` と書くと 403 で絵が1枚も出ない（隣の `projects/**` は
 * `projects/<id>/assets/<file>` と階層があるので当たる＝**見た目をそろえると再発する**）。
 * `src/test/assetScope.test.ts` で固定した。
 * ⚠️ 呼ぶ側は**読み込みに失敗したら絵を消す**（壊れた画像の印を出さない）＝失敗しても行は普通に使える。
 * ⚠️ **この作りゆえ、効かなくなっても静かに絵が無いだけ**になる（#942 で見落とした理由）。
 */
// `appDataDir()` は起動中は変わらないので控える（素材の数だけ IPC を往復しない＝
// プロジェクト素材側〔`assetFs.cachedAppDataDir`〕と同じ流儀・PR #939 レビュー ℹ️）。
let appDataDirPromise: Promise<string> | null = null;
function cachedAppDataDir(): Promise<string> {
  if (!appDataDirPromise) appDataDirPromise = appDataDir();
  return appDataDirPromise;
}

export async function libraryAssetDisplayUrl(fileName: string): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return convertFileSrc(await join(await cachedAppDataDir(), 'user_assets', fileName));
  } catch (e) {
    // 絵が出ないときに追える形にする（他の読み出しと同じ流儀）。
    console.warn('[library] libraryAssetDisplayUrl 失敗:', e);
    return null;
  }
}

/**
 * **これまでに使った id**（外したものを含む）。**採番だけ**に使う（α-6 出口監査 🟡8）。
 * ⚠️ **一覧は使えない**＝実体があるものだけを返すので、最大番号を外すと同じ番号が再発行される。
 */
export async function usedLibraryAssetIds(): Promise<string[]> {
  // ⚠️ **失敗を握りつぶさない**（PR #904 レビュー）＝`[]` を返すと採番が 001 から採り直しになり、
  // **いま直したばかりの「番号の使い回し」が別経路で再現する**。置く側が理由を出して断る（§2-5）。
  if (!isTauri()) return [];
  return invoke<string[]>('used_library_asset_ids');
}

/** 素材をライブラリへ置く（利用者が選んだファイルをコピーする）。失敗は文言つきで投げる（§2-5）。 */
export async function addLibraryAsset(
  assetId: string,
  displayName: string,
  assetType: string,
  tags: readonly string[],
  srcPath: string,
): Promise<LibraryAsset> {
  return invoke<LibraryAsset>('add_library_asset', {
    assetId,
    displayName,
    assetType,
    tags: [...tags],
    srcPath,
  });
}

/**
 * ライブラリの素材を**プロジェクトへコピー**する（ADR-0035 決定3）。保存された相対パスを返す。
 * ⚠️ **参照ではなくコピー**＝別PCへ移しても全プロジェクトが同時に欠損しない（ADR-0024 決定6）。
 */
export async function copyLibraryAssetToProject(
  libraryAssetId: string,
  projectId: string,
  fileName: string,
): Promise<string> {
  return invoke<string>('copy_library_asset_to_project', { libraryAssetId, projectId, fileName });
}

/** ライブラリの素材を消す。⚠️ **既に取り込んだプロジェクトには影響しない**（コピーなので）。 */
export async function deleteLibraryAsset(assetId: string): Promise<void> {
  if (!isTauri()) return;
  await invoke('delete_library_asset', { assetId });
}

/** ライブラリの素材の名前・タグを直す（実体は触らない）。 */
export async function updateLibraryAsset(
  assetId: string,
  displayName: string,
  tags: readonly string[],
  /** 種類（差分再監査）。**ロゴはファイル名から判らない**ので、置いたあとに選ぶ。省略＝変えない。 */
  assetType?: AssetType,
): Promise<void> {
  if (!isTauri()) return;
  await invoke('update_library_asset', { assetId, displayName, tags: [...tags], assetType: assetType ?? null });
}
