// あなた向け会社説明の一時の動画を組み立てる（β・ADR-0061 決定5・`11 §7.9`）。純粋関数。
//
// 組んだ並び（`compose.ts`）の場面を原本から取り込み（`importScenes`）、最後の場面（`closing.ts`）を足して、
// **場面形式の新しい動画**の文書を作る。ファイルのコピー・保存・声づくり・書き出しは呼ぶ側（画面）。
//
// ⚠️ **原本は書き換えない**（取り込みは新しい場面を作って返す）。
// ⚠️ **向きは1つ**＝最初の場面の動画の向きにそろえ、違う向きの動画の場面は入れない（入れると絵が崩れる＝知らせる）。
// ⚠️ **声の作り直しは単独のナレーションの場面だけ**（判断2）＝掛け合いの場面は元の声とファイルのまま。
//   作り直す場面の元の声のファイルはコピーしない（作り直すので要らない）。
import { createAssetId, createSceneId } from '../project/persistence';
import { NARRATION_STATUS, type Orientation } from '../enums';
import type { Asset, Part, Project, Scene } from '../project/types';
import type { Template } from '../template/types';
import { buildBriefingClosingScene } from './closing';
import { importScenes, type ImportedFile, type ImportedSceneSource } from './importScenes';

/** 一時の動画の中のパート（1つだけ）。 */
export const BRIEFING_PART_ID = 'part_001';

export interface BriefingBuildInput {
  /** 一時の動画の番号（`createBriefingSessionId`）。 */
  projectId: string;
  /** 作った時刻（ISO）。 */
  nowIso: string;
  /** 動画の名前（一覧には出ないが、書き出しの名前などに使う）。 */
  projectName: string;
  /** 組んだ並び（原本の動画と場面の番号）。 */
  picks: readonly { project: Project; sceneId: string }[];
  /** 単独のナレーションの場面を作り直す声（VOICEVOX の話者番号・null＝元の声のまま）。⚠️ `narration.speaker` に書く（ADR-0073）。 */
  speaker: number | null;
  /** 最後の場面の文。 */
  closingText: string;
  /** 最後の場面の「作り方」の一言（`briefingHowText`）。 */
  closingHowText?: string | null;
  /**
   * 最後の場面のロゴの素材を作る（会社の見た目のロゴを使うとき）。`existingAssetIds` と重ならない番号で作って返す。
   * 無い・使わないときは渡さない（または null を返す）。
   */
  makeLogoAsset?: (existingAssetIds: readonly string[]) => Asset | null;
  /** 差し色（会社の色の1つ目）。 */
  accentColor?: string | null;
  /** 使える見た目パターン（最後の場面の器を探す）。 */
  templates: readonly Template[];
}

export interface BriefingBuildResult {
  project: Project;
  /** 原本から名前を変えてコピーするファイル。 */
  files: ImportedFile[];
  /** 声を作り直す場面（単独のナレーション・選んだ声）。 */
  voiceSceneIds: string[];
  sources: ImportedSceneSource[];
  /** 向きが違って入れなかった場面。 */
  skippedOrientation: { projectId: string; sceneId: string }[];
  /** 原本に見つからなかった場面・素材（取り込みの結果のまま）。 */
  missingScenes: { projectId: string; sceneId: string }[];
  missingAssets: { projectId: string; assetId: string }[];
  /** 最後の場面を作れなかった（向きに合う自由配置の器が無い）。 */
  closingMissing: boolean;
  /** 最後の場面に置いたロゴの素材（ファイルのコピーは呼ぶ側）。 */
  logoAsset: Asset | null;
}

/** 単独のナレーション（掛け合いでない・話す文がある）か。 */
function isSoloNarration(scene: Scene): boolean {
  return (scene.lines?.length ?? 0) === 0 && scene.narration.text.trim().length > 0;
}

/** 組み立てる。`picks` が空でも最後の場面だけの動画を作る（呼ぶ側が「組めなかった」を知らせるかを決める）。 */
export function buildBriefingProject(input: BriefingBuildInput): BriefingBuildResult | null {
  const first = input.picks[0]?.project;
  if (!first) return null;
  const orientation: Orientation = first.videoSettings.aspectRatio;
  const usable = input.picks.filter((p) => p.project.videoSettings.aspectRatio === orientation);
  const skippedOrientation = input.picks
    .filter((p) => p.project.videoSettings.aspectRatio !== orientation)
    .map((p) => ({ projectId: p.project.projectId, sceneId: p.sceneId }));

  const imported = importScenes(
    { partId: BRIEFING_PART_ID, sceneIds: [], assetIds: [], animationIds: [], startOrder: 1 },
    usable.map((p) => ({ project: p.project, sceneId: p.sceneId })),
  );

  // 声＝単独のナレーションの場面だけ選んだ声で作り直す（元の声のファイルはコピーしない）。
  const voiceSceneIds: string[] = [];
  const scenes = imported.scenes.map((s) => {
    if (input.speaker == null || !isSoloNarration(s)) return s;
    voiceSceneIds.push(s.sceneId);
    return { ...s, narration: { ...s.narration, speaker: input.speaker, voicePath: null, status: NARRATION_STATUS.pending } };
  });
  const dropped = new Set(
    imported.scenes.filter((s) => voiceSceneIds.includes(s.sceneId)).map((s) => s.narration.voicePath).filter((p): p is string => !!p),
  );
  const files = imported.files.filter((f) => !dropped.has(f.toRelPath));

  // 最後の場面（必ず最後・学生は外せない）。
  const logoAsset = input.makeLogoAsset?.(imported.assets.map((a) => a.assetId)) ?? null;
  const closingId = createSceneId(scenes.map((s) => s.sceneId));
  const closing = buildBriefingClosingScene({
    sceneId: closingId,
    partId: BRIEFING_PART_ID,
    order: scenes.length + 1,
    orientation,
    text: input.closingText,
    howText: input.closingHowText ?? null,
    logoAssetId: logoAsset?.assetId ?? null,
    accentColor: input.accentColor,
    templates: input.templates,
  });
  const allScenes = closing ? [...scenes, closing] : scenes;
  const assets = logoAsset ? [...imported.assets, logoAsset] : imported.assets;

  const part: Part = { partId: BRIEFING_PART_ID, title: input.projectName, order: 1, sceneIds: allScenes.map((s) => s.sceneId) };
  const project: Project = {
    schemaVersion: first.schemaVersion,
    ...(first.videoKind ? { videoKind: first.videoKind } : {}),
    projectId: input.projectId,
    projectName: input.projectName,
    purpose: first.purpose,
    createdAt: input.nowIso,
    updatedAt: input.nowIso,
    videoSettings: { ...first.videoSettings },
    ...(first.companyInfo ? { companyInfo: first.companyInfo } : {}),
    ...(first.generalBrief ? { generalBrief: first.generalBrief } : {}),
    voiceSettings: { ...first.voiceSettings },
    ...(first.bgmSettings ? { bgmSettings: first.bgmSettings } : {}),
    assets,
    parts: [part],
    scenes: allScenes,
    ...(imported.animations.length > 0 ? { timelineOverlay: { animations: imported.animations } } : {}),
  };
  return {
    project,
    files,
    voiceSceneIds,
    sources: imported.sources,
    skippedOrientation,
    missingScenes: imported.missingScenes,
    missingAssets: imported.missingAssets,
    closingMissing: closing == null,
    logoAsset,
  };
}

/** 最後の場面のロゴの番号を、取り込んだ素材と重ならないように採る（`makeLogoAsset` を作る側が使う）。 */
export function briefingLogoAssetId(existingAssetIds: readonly string[]): string {
  return createAssetId(existingAssetIds);
}
