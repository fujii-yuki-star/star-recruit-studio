// あなた向け会社説明の流れ（β・ADR-0061 決定3〜5）＝組む → 一時の動画を作る → 開く。
//
// 純粋な部分（絞る・組む・組み立てる）は `domain/briefing/`。ここはファイルの読み書きと store をつなぐだけ。
// ⚠️ **書き出しは書き出しの画面と同じ道**（ADR-0007）＝学生の画面が書き出しの画面を裏で動かす（`BriefingStudentScreen`）。
// ⚠️ **外へ送らない**＝AI は同梱のものだけ（`localAiAssist`）・無ければルールだけで組む（決定4）。
import { composeBriefing, type BriefingCandidate, type BriefingComposition, type BriefingLength } from "../../domain/briefing/compose";
import { buildBriefingProject } from "../../domain/briefing/build";
import { createBriefingSessionId } from "../../domain/briefing/session";
import type { BriefingCatalog } from "../../domain/briefing/catalog";
import { assetFromLibrary } from "../../domain/asset/assetLibrary";
import { parseProjectDoc } from "../../domain/project/persistence";
import { resolveProjectFormat } from "../../domain/projectFormat";
import { PROJECT_FORMAT } from "../../domain/enums";
import type { Asset, Project } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";
import { localAiAssist, localAiAvailable } from "../../infrastructure/aiClient";
import { copyLibraryAssetToProject, listLibraryAssets } from "../../infrastructure/assetLibraryFs";
import { loadBrandKit } from "../../infrastructure/brandKitFs";
import { cleanupBriefingSessions, copyBriefingSessionFiles, createBriefingSession, deleteBriefingSession, listBriefingSessions } from "../../infrastructure/briefingSessionFs";
import { clearLastProjectId, getLastProjectId, listProjectSummaries, loadProjectDoc, saveProjectDoc, setLastProjectId } from "../../infrastructure/projectFs";
import {
  BRIEFING_NO_SCENES_MESSAGE,
  BRIEFING_SESSION_FULL_MESSAGE,
  BRIEFING_SESSION_PREPARE_FAILED_MESSAGE,
} from "../uiLabels";

/** 学生の画面で使う、読めた動画（場面形式だけ）。 */
export async function loadBriefingSources(catalog: BriefingCatalog): Promise<Project[]> {
  const summaries = await listProjectSummaries();
  const out: Project[] = [];
  for (const src of catalog.sources) {
    if (!src.enabled) continue;
    const summary = summaries.find((p) => p.projectId === src.projectId);
    if (!summary || resolveProjectFormat({ format: summary.format }) !== PROJECT_FORMAT.scene) continue;
    try {
      out.push(parseProjectDoc(await loadProjectDoc(src.projectId)));
    } catch (e) {
      // 読めない動画は使わない（登録の画面が「見つかりません」を出す）。学生の前では止めない。
      console.warn("[briefing] 動画を読めませんでした:", src.projectId, e);
    }
  }
  return out;
}

/** 組む（同梱の AI があれば使う・無ければルールだけ）。 */
export async function composeForStudent(
  catalog: BriefingCatalog,
  docs: readonly Project[],
  chosenInterestIds: readonly string[],
  length: BriefingLength,
): Promise<BriefingComposition> {
  const ask = (await localAiAvailable()) ? localAiAssist : undefined;
  const result = await composeBriefing({ catalog, docs, chosenInterestIds, length }, ask);
  if (result.aiProblem) console.info("[briefing] AI の並びを使わずルールで組みました:", result.aiProblem);
  return result;
}

/** 学生の画面の一時の動画づくりで、断るときの文（画面にそのまま出す）。 */
export class BriefingPrepareError extends Error {}

/**
 * 組んだ並びから一時の動画を作り、ファイルを写して保存する。作った動画の番号を返す（開くのは呼ぶ側）。
 *
 * ⚠️ **失敗したら作りかけを消す**（一時の置き場所の中だけ）。
 * ⚠️ **声**＝`speaker` を選んだときだけ、単独のナレーションの場面をその声で作り直す（`narration.speaker`・ADR-0073）。
 *   null＝元の動画の声のまま。掛け合いの場面はいつも元の声（ADR-0061 判断2）。
 */
export async function prepareBriefingVideo(input: {
  catalog: BriefingCatalog;
  docs: readonly Project[];
  picks: readonly BriefingCandidate[];
  templates: readonly Template[];
  /** 学生が選んだ声（VOICEVOX の話者番号）・null＝元の声のまま。 */
  speaker: number | null;
  now: Date;
}): Promise<string> {
  const byId = new Map(input.docs.map((d) => [d.projectId, d]));
  const picks = input.picks
    .map((c) => ({ project: byId.get(c.projectId), sceneId: c.sceneId }))
    .filter((p): p is { project: Project; sceneId: string } => p.project != null);
  if (picks.length === 0) throw new BriefingPrepareError(BRIEFING_NO_SCENES_MESSAGE);

  const taken = [...(await listProjectSummaries()).map((p) => p.projectId), ...(await listBriefingSessions())];
  const projectId = createBriefingSessionId(input.now, taken);
  if (!projectId) throw new BriefingPrepareError(BRIEFING_SESSION_FULL_MESSAGE);
  await createBriefingSession(projectId);
  try {
    const kit = await loadBrandKit().catch(() => null);
    // 会社の見た目のロゴ（登録で「置く」のとき）。⚠️ 見つからなくても締めの場面は作る（ロゴ無し）。
    let logo: { libId: string; fileName: string; asset: Asset } | null = null;
    const libId = input.catalog.closing.useBrandLogo ? kit?.logoLibraryAssetId : undefined;
    const lib = libId ? (await listLibraryAssets())?.find((a) => a.id === libId) : undefined;
    const built = buildBriefingProject({
      projectId,
      nowIso: input.now.toISOString(),
      projectName: "あなた向けの会社説明",
      picks,
      speaker: input.speaker,
      closingText: input.catalog.closing.text,
      makeLogoAsset: lib
        ? (ids) => {
            const made = assetFromLibrary(lib, ids);
            logo = { libId: lib.id, fileName: made.fileName, asset: made.asset };
            return made.asset;
          }
        : undefined,
      accentColor: kit?.colors?.[0] ?? null,
      templates: input.templates,
    });
    if (!built) throw new BriefingPrepareError(BRIEFING_NO_SCENES_MESSAGE);
    const copied = await copyBriefingSessionFiles(projectId, built.files);
    if (copied.missing.length > 0) console.warn("[briefing] 元の動画に無いファイル:", copied.missing);
    let project = built.project;
    const placed = logo as { libId: string; fileName: string; asset: Asset } | null;
    if (placed) {
      try {
        const relPath = await copyLibraryAssetToProject(placed.libId, projectId, placed.fileName);
        project = { ...project, assets: project.assets.map((a) => (a.assetId === placed.asset.assetId ? { ...a, filePath: relPath } : a)) };
      } catch (e) {
        console.warn("[briefing] ロゴを写せませんでした（ロゴ無しで続けます）:", e);
      }
    }
    await saveProjectDoc(projectId, JSON.stringify(project, null, 2));
    return projectId;
  } catch (e) {
    await deleteBriefingSession(projectId).catch(() => {});
    if (e instanceof BriefingPrepareError) throw e;
    console.error("[briefing] 一時の動画を作れませんでした:", e);
    throw new BriefingPrepareError(BRIEFING_SESSION_PREPARE_FAILED_MESSAGE);
  }
}

/**
 * 一時の動画を開く間、「次に開く動画」を書き換えない（一時の動画は 24 時間で消える＝次の起動で開けなくなる）。
 * `open` が終わったら元の値に戻す。
 */
export async function withLastProjectKept<T>(open: () => Promise<T>): Promise<T> {
  const last = getLastProjectId();
  try {
    return await open();
  } finally {
    if (last) setLastProjectId(last);
    else clearLastProjectId();
  }
}

/** 24 時間を過ぎた一時の動画を消す（失敗しても止めない）。 */
export async function cleanupStaleBriefingSessions(): Promise<void> {
  try {
    await cleanupBriefingSessions();
  } catch (e) {
    console.warn("[briefing] 古い一時の動画を片づけられませんでした:", e);
  }
}
