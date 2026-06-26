// project.json の組立・読込（純粋ロジック）。正典: schemas/project.schema.json / 11_SCHEMA_REFERENCE.md §1,§7。
// 副作用なし。ファイルI/Oは infrastructure/projectFs.ts（Tauriコマンド）へ分離する（CLAUDE.md §4）。
import {
  DEFAULT_TARGET_DURATION_SEC, DEFAULT_VOICE_ID, FPS,
  NARRATION_VOLUME, VIDEO_HARD_MAX_SEC,
} from '../constants';
import { ORIENTATION, VIDEO_KIND } from '../enums';
import type { Purpose, VideoKind } from '../enums';
import { DEFAULT_FONT_ID, isKnownFontId } from '../font/fontCatalog';
import { isKnownBundledBgmId } from '../bgm/bgmCatalog';
import type {
  Asset, BgmSettings, CompanyInfo, GeneralBrief, Part, Project, Scene,
  ToneSettings, VideoSettings, VoiceSettings,
} from './types';

/** project.json の schemaVersion（正典 §1）。1.0→1.1：videoKind/generalBrief・additionalNotes 移送（ADR-0011）。1.1→1.2：videoSettings.width/height を撤廃し aspectRatio を単一の真実に（ADR-0012）。1.2→1.3：videoSettings.fontId（同梱フォント選択）を追加（任意・未指定は既定フォント）。1.3→1.4：bgmSettings.bundledBgmId（標準BGM選択）を追加（任意・未指定は標準BGM未選択）。1.4→1.5：scene.fontId（場面ごとのフォント）を追加（任意・null/未指定は動画全体を継承）。1.5→1.6：FREE 図形種別/枠線（#173）。1.6→1.7：テキストごとのフォント（#178）。1.7→1.8：掛け合い＝scene.lines（NarrationLine[]）＋scene.subtitleEnabledDefault を追加（任意・narration 残置・ADR-0015/#180）。 */
export const PROJECT_SCHEMA_VERSION = '1.8';

/** プロジェクト保存に必要な見出し情報（Asset/Part/Scene 以外）。 */
export interface ProjectHeader {
  projectId: string;
  projectName: string;
  /** 動画の種類（ADR-0011）。省略時は recruit。 */
  videoKind?: VideoKind;
  purpose: Purpose;
  createdAt: string;
  updatedAt: string;
  videoSettings: VideoSettings;
  /** 採用（videoKind=recruit）のとき必須。general では持たない（ADR-0011）。 */
  companyInfo?: CompanyInfo;
  /** 一般・社内発表（videoKind=general）の入力。 */
  generalBrief?: GeneralBrief;
  /** 利用者の自由記述（両用途共通・AIへそのまま送る補足）。 */
  additionalNotes?: string;
  toneSettings?: ToneSettings;
  voiceSettings: VoiceSettings;
  bgmSettings?: BgmSettings;
}

/** 既定 videoSettings（横型16:9・30fps。寸法は aspectRatio から導出＝ADR-0012）。 */
export function defaultVideoSettings(): VideoSettings {
  return {
    aspectRatio: ORIENTATION.landscape,
    fps: FPS,
    targetDurationSec: DEFAULT_TARGET_DURATION_SEC,
    maxDurationSec: VIDEO_HARD_MAX_SEC,
    fontId: DEFAULT_FONT_ID,
  };
}

/** 既定 voiceSettings（ナレーター＝ずんだもん。値域は §7.1）。 */
export function defaultVoiceSettings(): VoiceSettings {
  return {
    defaultVoiceId: DEFAULT_VOICE_ID,
    speed: 1.0,
    pitch: 0.0,
    intonation: 1.0,
    volume: NARRATION_VOLUME,
  };
}

/** proj_{YYYYMMDD}_{NNN}（§2.1）。同日の既存IDから次の連番を採る。 */
export function createProjectId(now: Date, existingIds: readonly string[]): string {
  const prefix = `proj_${formatYmd(now)}_`;
  let max = 0;
  for (const id of existingIds) {
    if (!id.startsWith(prefix)) continue;
    const n = Number(id.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/** asset_NNN を発行する（§2.1）。既存IDと衝突しない最小の3桁連番。 */
export function createAssetId(existingIds: readonly string[]): string {
  const used = new Set(existingIds);
  let n = 1;
  let id = `asset_${String(n).padStart(3, '0')}`;
  while (used.has(id)) {
    n += 1;
    id = `asset_${String(n).padStart(3, '0')}`;
  }
  return id;
}

/**
 * bgm_{slug}_{NNN} を発行する（§2.1）。slug は表示名/ファイル名を `[a-z0-9_]` に正規化したもの。
 * slug が空（日本語のみ等）のときは `bgm_{NNN}`。既存IDと衝突しない最小の3桁連番。
 */
export function createBgmId(slug: string, existingIds: readonly string[]): string {
  const cleaned = slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const base = cleaned ? `bgm_${cleaned}` : 'bgm';
  const used = new Set(existingIds);
  let n = 1;
  let id = `${base}_${String(n).padStart(3, '0')}`;
  while (used.has(id)) {
    n += 1;
    id = `${base}_${String(n).padStart(3, '0')}`;
  }
  return id;
}

/** scene_NNN / part_NNN を発行する共通ロジック（§2.1）。既存と衝突しない最小の3桁連番。 */
function nextNumberedId(prefix: string, existingIds: readonly string[]): string {
  const used = new Set(existingIds);
  let n = 1;
  let id = `${prefix}_${String(n).padStart(3, '0')}`;
  while (used.has(id)) {
    n += 1;
    id = `${prefix}_${String(n).padStart(3, '0')}`;
  }
  return id;
}

/** scene_NNN を発行する（§2.1）。 */
export function createSceneId(existingIds: readonly string[]): string {
  return nextNumberedId('scene', existingIds);
}

/** part_NNN を発行する（§2.1）。 */
export function createPartId(existingIds: readonly string[]): string {
  return nextNumberedId('part', existingIds);
}

/** free_NNN を発行する（§2.1・FREE 自由配置要素 id・scene 内一意）。 */
export function createFreeElementId(existingIds: readonly string[]): string {
  return nextNumberedId('free', existingIds);
}

/** line_NNN を発行する（§2.1・セリフ行 id・scene 内一意・ADR-0015）。 */
export function createLineId(existingIds: readonly string[]): string {
  return nextNumberedId('line', existingIds);
}

/** ストアの作業状態を schema 準拠の Project へ組み立てる。 */
export function assembleProject(
  header: ProjectHeader,
  assets: Asset[],
  parts: Part[],
  scenes: Scene[],
): Project {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    videoKind: header.videoKind ?? VIDEO_KIND.recruit,
    projectId: header.projectId,
    projectName: header.projectName,
    purpose: header.purpose,
    createdAt: header.createdAt,
    updatedAt: header.updatedAt,
    videoSettings: header.videoSettings,
    ...(header.companyInfo ? { companyInfo: header.companyInfo } : {}),
    ...(header.generalBrief ? { generalBrief: header.generalBrief } : {}),
    ...(header.additionalNotes ? { additionalNotes: header.additionalNotes } : {}),
    ...(header.toneSettings ? { toneSettings: header.toneSettings } : {}),
    voiceSettings: header.voiceSettings,
    ...(header.bgmSettings ? { bgmSettings: header.bgmSettings } : {}),
    assets,
    parts,
    scenes,
  };
}

/** 1.x は対応。未対応メジャー（2.0 等）は読込拒否（§1）。 */
export function isSupportedSchemaVersion(version: string): boolean {
  return version.startsWith('1.');
}

/** 読込失敗（次の行動を示すユーザー向け文言を message に持つ）。 */
export class ProjectLoadError extends Error {}

/** 文字列(JSON) → Project。schemaVersion と最低限の構造を検証する。 */
export function parseProjectDoc(text: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectLoadError('プロジェクトファイルを読み取れませんでした。別のプロジェクトを選んでください。');
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new ProjectLoadError('プロジェクトの内容が正しくありません。別のプロジェクトを選んでください。');
  }
  const doc = raw as Record<string, unknown>;
  const version = doc.schemaVersion;
  if (typeof version !== 'string' || !isSupportedSchemaVersion(version)) {
    throw new ProjectLoadError('このプロジェクトは新しい形式のため開けません。アプリを更新してください。');
  }
  for (const key of ['projectId', 'projectName', 'purpose'] as const) {
    if (typeof doc[key] !== 'string') {
      throw new ProjectLoadError('プロジェクトの必須情報が欠けています。別のプロジェクトを選んでください。');
    }
  }
  for (const key of ['assets', 'parts', 'scenes'] as const) {
    if (!Array.isArray(doc[key])) {
      throw new ProjectLoadError('プロジェクトの必須情報が欠けています。別のプロジェクトを選んでください。');
    }
  }
  return migrateProject(doc as unknown as Project);
}

/** 読込時に旧バージョン(1.0〜1.7)を現行(1.8)へ移行する。
 *  1.0→1.1: videoKind 既定 recruit・companyInfo.additionalNotes をトップレベルへ移送（ADR-0011）。
 *  1.1→1.2: videoSettings.width/height を除去（aspectRatio を単一の真実に＝ADR-0012）。
 *  1.2→1.3: videoSettings.fontId を補完（同梱フォント選択・未指定は既定フォント）。
 *  1.3→1.4: bgmSettings.bundledBgmId を検証（未知の id は標準BGM未選択へ落とす・追加は任意フィールド）。
 *  1.4→1.5: 未知の scene.fontId を継承（未指定）へ落とす（場面ごとのフォント・追加は任意フィールド）。
 *  1.5→1.6: FREE 図形の種別追加（rounded_rect/triangle/star/arrow/speech_bubble）＋枠線（strokeColor/strokeWidth）。
 *          いずれも後方互換の任意追加のため、版番号の付け替え以外の変換は不要（#173）。
 *  1.6→1.7: テキストごとのフォント（FreeElement.fontId＋scene.textFontIds）。後方互換の任意追加＝変換不要（#178）。
 *  1.7→1.8: 掛け合い（scene.lines＝NarrationLine[]＋scene.subtitleEnabledDefault）。後方互換の任意追加＝変換不要（ADR-0015/#180）。 */
function migrateProject(project: Project): Project {
  const next: Project = {
    ...project,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    videoKind: project.videoKind ?? VIDEO_KIND.recruit,
  };
  // 旧 companyInfo.additionalNotes をトップレベル additionalNotes へ移送し、companyInfo からは除去する。
  const ci = project.companyInfo as Record<string, unknown> | undefined;
  if (ci && typeof ci.additionalNotes === 'string') {
    if (next.additionalNotes === undefined) next.additionalNotes = ci.additionalNotes;
    const rest = { ...ci };
    delete rest.additionalNotes;
    next.companyInfo = rest as unknown as CompanyInfo;
  }
  // 1.1→1.2: videoSettings から width/height を除去（寸法は aspectRatio から導出＝ADR-0012）。
  const vs = project.videoSettings as unknown as Record<string, unknown> | undefined;
  if (vs && ('width' in vs || 'height' in vs)) {
    const cleaned = { ...vs };
    delete cleaned.width;
    delete cleaned.height;
    next.videoSettings = cleaned as unknown as VideoSettings;
  }
  // 1.2→1.3: videoSettings.fontId を補完（未指定/不明は既定フォント＝同梱フォント選択の追加）。
  const vsFont = (next.videoSettings ?? {}) as unknown as Record<string, unknown>;
  if (!isKnownFontId(vsFont.fontId)) {
    next.videoSettings = { ...vsFont, fontId: DEFAULT_FONT_ID } as unknown as VideoSettings;
  }
  // 1.3→1.4: 未知の bundledBgmId（旧版・破損）は標準BGM未選択へ落とす（assetId/なしへフォールバック）。
  const bgm = next.bgmSettings as Record<string, unknown> | undefined;
  if (bgm && bgm.bundledBgmId != null && !isKnownBundledBgmId(bgm.bundledBgmId)) {
    const cleaned = { ...bgm };
    delete cleaned.bundledBgmId;
    next.bgmSettings = cleaned as unknown as BgmSettings;
  }
  // 1.4→1.5: 未知の scene.fontId（旧版・破損）は継承（未指定）へ落とす。null は継承の明示なので保持。
  if (Array.isArray(next.scenes)) {
    next.scenes = next.scenes.map((sc) => {
      const f = (sc as unknown as Record<string, unknown>).fontId;
      if (f != null && !isKnownFontId(f)) {
        const cleaned = { ...sc } as unknown as Record<string, unknown>;
        delete cleaned.fontId;
        return cleaned as unknown as Scene;
      }
      return sc;
    });
  }
  return next;
}
