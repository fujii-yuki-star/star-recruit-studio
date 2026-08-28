// 素材ファイルの取り込み/読み出し（Tauriコマンド境界）。domain は型のみ、I/Oはここに隔離（CLAUDE.md §4）。
// Tauri 非検出時（ブラウザ開発）は永続化せず null を返す（表示用 data URL はメモリ内で別途保持される）。
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { appDataDir, join } from '@tauri-apps/api/path';
import type { AssetMetadata } from '../domain/project/types';

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** File を data URL(base64) に読み込む（画像の表示＋書き出し用＝ADR-0004 の SVGインライン）。失敗時は reject。 */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

/** 画像(data URL)をプロジェクトに取り込み、プロジェクト相対 filePath を返す。Tauri 非検出時は null（非永続）。 */
export async function importAssetFile(
  projectId: string,
  fileName: string,
  dataUrl: string,
): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string>('import_asset', { projectId, fileName, dataBase64: dataUrl });
}

/**
 * 素材を生バイト（raw IPC body）で取り込む。base64 を経由しないので大きい動画でもメモリを食わない。
 * Tauri v2: payload に Uint8Array、メタ情報は headers で渡す。Tauri 非検出時は null（非永続）。
 */
export async function importAssetBytes(
  projectId: string,
  fileName: string,
  bytes: Uint8Array,
): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string>('import_asset_bytes', bytes, { headers: { projectId, fileName } });
}

/**
 * 元ファイルの絶対パス（ネイティブ「開く」ダイアログで取得）を渡し、Rust がプロジェクトへコピーする。
 * バイトも base64 も JS を経由しない＝大きい動画でもメモリ/IPC を消費しない（真の0コピー）。Tauri 非検出時は null。
 */
export async function importAssetByPath(
  projectId: string,
  fileName: string,
  srcPath: string,
): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string>('import_asset_path', { projectId, fileName, srcPath });
}

/** プロジェクト相対パスの素材を data URL で読む。Tauri 非検出 or 失敗（未配置のサンプル等）時は null。 */
export async function readAssetDataUrl(projectId: string, relPath: string): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<string>('read_asset_data_url', { projectId, relPath });
  } catch {
    return null;
  }
}

/**
 * プロジェクト相対パスの素材を、表示用の asset:// URL（Tauri asset protocol）へ変換する（A3-2）。
 * data URL を JS に常駐させず WebView がディスクから直接ストリームする＝大容量素材でもメモリを食わない。
 * URL を組むだけでディスク読込はしない（実体ロードの可否は tauri.conf の assetProtocol.scope と CSP が決める）。
 * 非 Tauri（ブラウザ開発）は asset protocol が無いので null（表示は呼び出し側のフォールバックに委ねる）。
 */
// appDataDir() は起動中不変なので Promise をキャッシュ（loadProject の素材数分の IPC 往復を避ける・A3-2 レビュー）。
let appDataDirPromise: Promise<string> | null = null;
function cachedAppDataDir(): Promise<string> {
  if (!appDataDirPromise) appDataDirPromise = appDataDir();
  return appDataDirPromise;
}

export async function assetDisplayUrl(projectId: string, relPath: string): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const abs = await join(await cachedAppDataDir(), 'projects', projectId, relPath);
    return convertFileSrc(abs);
  } catch (e) {
    // 他の読み出し関数と同様、原因を残す（画像が出ない時の追跡用・§デバッグ）。
    console.warn('[asset] assetDisplayUrl 失敗:', e);
    return null;
  }
}

/**
 * 音の波形の山（#332）。0.0〜1.0 を `buckets` 個返す（音が無い・読めないときは空）。
 *
 * ⚠️ **素材のバイトを JS に載せない**（ADR-0004・§2-1）＝Rust が PCM を受けて**山だけ**を返す。
 * Web Audio の `decodeAudioData` は**ファイル丸ごとを JS のメモリへ展開する**ので採らない
 *（`exceedsInlineAssetLimit` の趣旨に反する）。
 */
export async function audioPeaks(
  projectId: string,
  relPath: string,
  buckets: number,
  /** 素材のどこから測るか（秒）。 */
  fromSec = 0,
  /** 何秒ぶん測るか（`0`＝最後まで）。 */
  lengthSec = 0,
): Promise<number[]> {
  if (!isTauri()) return [];
  try {
    return await invoke<number[]>('audio_peaks', { projectId, relPath, buckets, fromSec, lengthSec });
  } catch (e) {
    console.warn('[asset] audioPeaks 失敗:', e);
    return [];
  }
}

/**
 * 動画のコマ列（#332）。**横に並べた PNG 1枚**を作り、表示用の URL を返す（作れなければ `null`）。
 *
 * ⚠️ **無くても編集はできる**＝失敗しても `null` を返すだけで、画面は止めない（§2-5＝求めることが無い）。
 */
export async function videoFilmstrip(
  projectId: string,
  relPath: string,
  frames: number,
  fromSec = 0,
  lengthSec = 0,
): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const rel = await invoke<string>('video_filmstrip', { projectId, relPath, frames, fromSec, lengthSec });
    return rel ? await assetDisplayUrl(projectId, rel) : null;
  } catch (e) {
    console.warn('[asset] videoFilmstrip 失敗:', e);
    return null;
  }
}

/**
 * 渡したプロジェクト相対パスのファイルを消す（#348）。消せた数を返す。
 *
 * ⚠️ **消せなくても失敗にしない**＝素材はもう文書から外れており、残ったファイルは次の取り込みで
 * 上書きされるだけの無害な余り。ここで利用者に何か求めても**やることが無い**（§2-5）。
 * テンプレ素材の孤立掃除（ADR-0021・`#299`）と同じ流儀。
 */
export async function deleteProjectFiles(projectId: string, relPaths: string[]): Promise<number> {
  if (!isTauri() || relPaths.length === 0) return 0;
  try {
    return await invoke<number>('delete_project_files', { projectId, relPaths });
  } catch (e) {
    console.warn('[asset] deleteProjectFiles 失敗:', e);
    return 0;
  }
}

/**
 * 渡した素材のうち、**実体が見つからないもの**の相対パスを返す（#347）。
 *
 * ⚠️ **見つからないものだけ**を返す（全件の真偽表だと素材が増えるほど無駄が増える）。
 * ⚠️ **アプリの外（ブラウザ）では空を返す**＝そこにはプロジェクトフォルダが無いので、
 * 「全部見つからない」と言うと**嘘の警告**になる（§2-5＝実行しても直らない案内を出さない）。
 * 調べられなかったときも空（黙って「壊れている」と言わない）。
 */
export async function missingAssetFiles(projectId: string, relPaths: string[]): Promise<string[]> {
  if (!isTauri() || relPaths.length === 0) return [];
  try {
    return await invoke<string[]>('missing_asset_files', { projectId, relPaths });
  } catch (e) {
    console.warn('[asset] missingAssetFiles 失敗:', e);
    return [];
  }
}

/** 動画素材のメタ情報（長さ・音声有無・解像度）を取得する。Tauri 非検出 or 失敗時は null。 */
export async function probeVideo(projectId: string, relPath: string): Promise<AssetMetadata | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<AssetMetadata>('probe_video', { projectId, relPath });
  } catch {
    return null;
  }
}

/** 動画の代表フレームを PNG で書き出し、その相対パスを返す（確認画面/一覧のサムネ用）。失敗時は null。 */
export async function extractVideoThumbnail(
  projectId: string,
  relPath: string,
): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<string>('extract_video_thumbnail', { projectId, relPath });
  } catch {
    return null;
  }
}

/**
 * 動画の**その瞬間**を静止画として切り出し、素材フォルダへ保存して相対パスを返す（#349）。
 *
 * ⚠️ **サムネ（`extractVideoThumbnail`）と違って失敗を握りつぶさない**＝あちらは
 * 「無くても一覧が出る」best-effort だが、こちらは**利用者が押した操作**なので、
 * できなかったら次の行動を出して知らせる（§2-5）。文言は Rust が返す。
 */
export async function extractVideoFrame(
  projectId: string,
  relPath: string,
  atSec: number,
  outFileName: string,
): Promise<string> {
  return invoke<string>('extract_video_frame', { projectId, relPath, atSec, outFileName });
}
