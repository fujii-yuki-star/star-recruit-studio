// project.json の組立・読込（純粋ロジック）。正典: schemas/project.schema.json / 11_SCHEMA_REFERENCE.md §1,§7。
// 副作用なし。ファイルI/Oは infrastructure/projectFs.ts（Tauriコマンド）へ分離する（CLAUDE.md §4）。
import {
  DEFAULT_TARGET_DURATION_SEC, DEFAULT_VOICE_ID, FPS, HEIGHT,
  NARRATION_VOLUME, VIDEO_HARD_MAX_SEC, WIDTH,
} from '../constants';
import type { Purpose } from '../enums';
import type {
  Asset, BgmSettings, CompanyInfo, Part, Project, Scene,
  ToneSettings, VideoSettings, VoiceSettings,
} from './types';

/** project.json の schemaVersion（正典 §1：初期は "1.0"）。 */
export const PROJECT_SCHEMA_VERSION = '1.0';

/** プロジェクト保存に必要な見出し情報（Asset/Part/Scene 以外）。 */
export interface ProjectHeader {
  projectId: string;
  projectName: string;
  purpose: Purpose;
  createdAt: string;
  updatedAt: string;
  videoSettings: VideoSettings;
  companyInfo: CompanyInfo;
  toneSettings?: ToneSettings;
  voiceSettings: VoiceSettings;
  bgmSettings?: BgmSettings;
}

/** 16:9 / 1920x1080 / 30fps の既定 videoSettings（§7.1.1）。 */
export function defaultVideoSettings(): VideoSettings {
  return {
    aspectRatio: '16:9',
    width: WIDTH,
    height: HEIGHT,
    fps: FPS,
    targetDurationSec: DEFAULT_TARGET_DURATION_SEC,
    maxDurationSec: VIDEO_HARD_MAX_SEC,
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

/** ストアの作業状態を schema 準拠の Project へ組み立てる。 */
export function assembleProject(
  header: ProjectHeader,
  assets: Asset[],
  parts: Part[],
  scenes: Scene[],
): Project {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectId: header.projectId,
    projectName: header.projectName,
    purpose: header.purpose,
    createdAt: header.createdAt,
    updatedAt: header.updatedAt,
    videoSettings: header.videoSettings,
    companyInfo: header.companyInfo,
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

/** 同一メジャー(1.x)はそのまま。将来のメジャー移行時にここで変換する。 */
function migrateProject(project: Project): Project {
  return project;
}
