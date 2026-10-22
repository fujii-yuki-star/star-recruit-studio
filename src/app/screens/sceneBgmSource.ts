// 場面形式の書き出しで、BGM の1区間の音をどこから渡すか（負荷・耐久の点検 2026-10-22）。
//
// ⚠️ **自分の BGM は中身を読まずパスで渡す**＝前は data URL（`readAssetDataUrl`）にしていたので、
//   数百 MB の WAV を選ぶとアプリが落ちうる。FFmpeg はプロジェクトのファイルを直接読む（動画の元の音と同じ道）。
// ⚠️ 同梱の曲は今までどおり中身で渡す（アプリに入っている小さなファイル・プロジェクトの外にある）。
import { bgmById } from "../../domain/bgm/bgmCatalog";
import { fileExtension } from "../../domain/asset/assetFile";

/** 渡す音（`BgmRunInput` の音源の部分）。 */
export interface SceneBgmSource {
  audioBase64: string;
  audioPath?: string;
  fileExt: string;
}

/** 読み方（差し替えて検査できるように渡す）。 */
export interface SceneBgmSourceIo {
  readBundledBgmDataUrl: (id: string) => Promise<string | undefined>;
  missingAssetFiles: (projectId: string, relPaths: string[]) => Promise<string[]>;
}

const DEFAULT_EXT = "mp3";

/**
 * 1区間の音を決める。**読めない・見つからないときは null**＝呼ぶ側は前と同じく「その区間は無音で続け、
 * 完了時に知らせる」（書き出しを止めない）。
 */
export async function sceneBgmSource(
  clip: { bundledBgmId: string | null; assetId: string | null },
  assets: readonly { assetId: string; filePath: string }[],
  projectId: string | null | undefined,
  io: SceneBgmSourceIo,
): Promise<SceneBgmSource | null> {
  if (clip.bundledBgmId) {
    const audioBase64 = await io.readBundledBgmDataUrl(clip.bundledBgmId);
    if (!audioBase64) return null;
    return { audioBase64, fileExt: fileExtension(bgmById(clip.bundledBgmId)?.fileName ?? "") || DEFAULT_EXT };
  }
  if (!clip.assetId || !projectId) return null;
  const a = assets.find((x) => x.assetId === clip.assetId);
  if (!a) return null;
  if ((await io.missingAssetFiles(projectId, [a.filePath])).length > 0) return null;
  return { audioBase64: "", audioPath: a.filePath, fileExt: fileExtension(a.filePath) || DEFAULT_EXT };
}
