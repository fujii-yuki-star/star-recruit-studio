// 拡張パック（ADR-0060）を入れる・外す・使っている動画を数える。画面（設定の「拡張パック」）が呼ぶ。
// ⚠️ **入れる前に見せる**＝`inspectPackFile` で manifest を読み、画面が中身・発行者・権利を見せてから `installInspectedPack`。
import {
  PACK_PROBLEM,
  packInstallProblem,
  parsePackManifest,
  projectUsesPack, projectUsesPackVoice,
  type ExtensionPackManifest,
  type PackProblem,
} from '../../domain/pack/extensionPack';
import { getAppVersion } from '../../infrastructure/appInfo';
import { inspectPack, installPack, uninstallPack } from '../../infrastructure/packFs';
import { listProjectSummaries, loadProjectDoc } from '../../infrastructure/projectFs';
import {
  PACK_INVALID_MESSAGE,
  PACK_MISSING_LICENSE_MESSAGE,
  PACK_UNLISTED_MESSAGE,
  packAppTooOldMessage,
  packOlderThanInstalledMessage,
  PACK_VOICE_CONFLICT_MESSAGE,
  packVoiceNotAllowedMessage,
} from '../uiLabels';
import { userFacingMessage } from '../userFacingError';
import { useProjectStore } from './projectStore';

/** 入れられない理由を画面の文へ（網羅＝種類が増えたら型で気づく）。 */
export function packProblemMessage(p: PackProblem): string {
  switch (p.kind) {
    case PACK_PROBLEM.invalid:
      return PACK_INVALID_MESSAGE;
    case PACK_PROBLEM.unlistedContent:
      return PACK_UNLISTED_MESSAGE;
    case PACK_PROBLEM.missingLicense:
      return PACK_MISSING_LICENSE_MESSAGE;
    case PACK_PROBLEM.appTooOld:
      return packAppTooOldMessage(p.minAppVersion);
    case PACK_PROBLEM.olderThanInstalled:
      return packOlderThanInstalledMessage(p.installedVersion);
    case PACK_PROBLEM.voiceConflict:
      return PACK_VOICE_CONFLICT_MESSAGE;
    case PACK_PROBLEM.voiceNotAllowed:
      return packVoiceNotAllowedMessage(p.character);
  }
}

/** Rust の断りを画面の文へ（Rust は `messages.rs` の文を返す）。読めなければ「読める形でない」に倒す。 */
function rustMessage(e: unknown): string {
  return userFacingMessage(e, 'pack') ?? PACK_INVALID_MESSAGE;
}

/** 版の問題（新しいアプリが要る・入っている版より古い）と、入っている版（更新なら）。 */
async function versionCheck(manifest: ExtensionPackManifest): Promise<{ problem: PackProblem | null; installedVersion: string | null }> {
  const installed = useProjectStore.getState().packs.find((p) => p.packId === manifest.packId) ?? null;
  const appVersion = (await getAppVersion()) || manifest.minAppVersion;
  return { problem: packInstallProblem(manifest, appVersion, installed?.version ?? null), installedVersion: installed?.version ?? null };
}

/**
 * 選んだファイルの中を見る（展開しない）。
 * ⚠️ **版の問題もここで断る**（2026-10-16 実機）＝以前は中身を見せて「入れる」を押させてから「新しいアプリが要る」と断っていた。
 * 更新（同じパックが入っている）なら、入っている版を添える（見せる画面が「入れ替える」と言えるように）。
 */
export async function inspectPackFile(
  path: string,
): Promise<{ ok: true; manifest: ExtensionPackManifest; raw: string; installedVersion: string | null } | { ok: false; message: string }> {
  let raw: string;
  try {
    raw = await inspectPack(path);
  } catch (e) {
    return { ok: false, message: rustMessage(e) };
  }
  const parsed = parsePackManifest(raw);
  if (!parsed.ok) return { ok: false, message: packProblemMessage(parsed.problem) };
  const { problem, installedVersion } = await versionCheck(parsed.manifest);
  if (problem) return { ok: false, message: packProblemMessage(problem) };
  return { ok: true, manifest: parsed.manifest, raw, installedVersion };
}

/**
 * 見せた後に入れる。版を確かめ、照合して置き、読み直す。
 * ⚠️ **アプリの版が分からない**（ブラウザでの開発中）ときは版を見ない＝入れる道そのものが Tauri だけなので実害はない。
 */
export async function installInspectedPack(
  path: string,
  manifest: ExtensionPackManifest,
  /** 見せた manifest の文字そのもの（Rust が zip の中と突き合わせる）。 */
  raw: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  // 見せたあとに別のパックを入れた・外したこともあるので、入れる直前にもう一度見る。
  const { problem } = await versionCheck(manifest);
  if (problem) return { ok: false, message: packProblemMessage(problem) };
  try {
    await installPack(path, manifest.packId, raw);
  } catch (e) {
    return { ok: false, message: rustMessage(e) };
  }
  await useProjectStore.getState().loadPacks();
  return { ok: true };
}

/** このパックの見た目パターンを使っている動画の数（外す前に知らせる）。読めない動画は数えない。 */
export async function countVideosUsingPack(packId: string): Promise<number> {
  // 声（段階3）は番号で指すので、文字の頭では探せない＝manifest の番号で探す。
  const manifest = useProjectStore.getState().packs.find((m) => m.packId === packId);
  let n = 0;
  for (const s of await listProjectSummaries()) {
    try {
      const raw = await loadProjectDoc(s.projectId);
      if (projectUsesPack(raw, packId) || (manifest != null && projectUsesPackVoice(raw, manifest))) n += 1;
    } catch {
      // 読めない動画は数えない（外す判断の知らせなので、数え漏れは「少なめ」に倒れるだけ）
    }
  }
  return n;
}

/** 外して読み直す。 */
export async function removeInstalledPack(packId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await uninstallPack(packId);
  } catch (e) {
    return { ok: false, message: rustMessage(e) };
  }
  await useProjectStore.getState().loadPacks();
  return { ok: true };
}
