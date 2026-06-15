import { describe, expect, it } from 'vitest';
import {
  PROJECT_SCHEMA_VERSION, assembleProject, createAssetId, createBgmId, createFreeElementId, createPartId,
  createProjectId, createSceneId, defaultVideoSettings, defaultVoiceSettings,
  isSupportedSchemaVersion, parseProjectDoc,
} from './persistence';
import type { ProjectHeader } from './persistence';

function header(overrides: Partial<ProjectHeader> = {}): ProjectHeader {
  return {
    projectId: 'proj_20260612_001',
    projectName: '無題のプロジェクト',
    purpose: 'new_graduate',
    createdAt: '2026-06-12T00:00:00.000Z',
    updatedAt: '2026-06-12T00:00:00.000Z',
    videoSettings: defaultVideoSettings(),
    companyInfo: { companyName: '株式会社サンプル' },
    voiceSettings: defaultVoiceSettings(),
    ...overrides,
  };
}

describe('createProjectId', () => {
  it('同日の既存が無ければ _001', () => {
    expect(createProjectId(new Date(2026, 5, 12), [])).toBe('proj_20260612_001');
  });
  it('同日の最大連番+1を採る（別日のIDは無視）', () => {
    const id = createProjectId(new Date(2026, 5, 12), [
      'proj_20260612_001', 'proj_20260612_004', 'proj_20250101_009',
    ]);
    expect(id).toBe('proj_20260612_005');
  });
  it('採番形式は §2.1 に従う', () => {
    expect(createProjectId(new Date(2026, 0, 3), [])).toMatch(/^proj_\d{8}_\d{3}$/);
  });
});

describe('createAssetId', () => {
  it('既存が無ければ asset_001', () => {
    expect(createAssetId([])).toBe('asset_001');
  });
  it('既存（slug形式含む）と衝突しない最小番号を採る', () => {
    expect(createAssetId(['asset_001', 'asset_002', 'asset_entrance_001'])).toBe('asset_003');
  });
  it('歯抜けの最小番号を埋める', () => {
    expect(createAssetId(['asset_002', 'asset_003'])).toBe('asset_001');
  });
});

describe('createBgmId (§2.1 bgm_{slug}_{NNN})', () => {
  it('slug をファイル名から正規化して採番する', () => {
    expect(createBgmId('Bright Theme', [])).toBe('bgm_bright_theme_001');
  });
  it('slug が空（日本語のみ・空白）なら bgm_{NNN}', () => {
    expect(createBgmId('明るいBGM', [])).toBe('bgm_bgm_001');
    expect(createBgmId('　', [])).toBe('bgm_001');
  });
  it('既存と衝突しない最小番号を採る', () => {
    expect(createBgmId('theme', ['bgm_theme_001'])).toBe('bgm_theme_002');
  });
});

describe('createSceneId / createPartId (§2.1)', () => {
  it('既存が無ければ _001', () => {
    expect(createSceneId([])).toBe('scene_001');
    expect(createPartId([])).toBe('part_001');
  });
  it('既存と衝突しない最小番号を採る', () => {
    expect(createSceneId(['scene_001', 'scene_002'])).toBe('scene_003');
    expect(createPartId(['part_001'])).toBe('part_002');
  });
  it('歯抜けの最小番号を埋める', () => {
    expect(createSceneId(['scene_002', 'scene_003'])).toBe('scene_001');
  });
});

describe('createFreeElementId (§2.1 free_{NNN}・scene 内一意)', () => {
  it('既存が無ければ free_001', () => {
    expect(createFreeElementId([])).toBe('free_001');
  });
  it('既存と衝突しない最小番号を採る', () => {
    expect(createFreeElementId(['free_001', 'free_002'])).toBe('free_003');
  });
});

describe('assembleProject', () => {
  it('schemaVersion を付与し配列を含める', () => {
    const p = assembleProject(header(), [], [], []);
    expect(p.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(p.projectId).toBe('proj_20260612_001');
    expect(p.assets).toEqual([]);
  });
  it('任意フィールドは未指定なら省略する', () => {
    const p = assembleProject(header(), [], [], []);
    expect('toneSettings' in p).toBe(false);
    expect('bgmSettings' in p).toBe(false);
  });
});

describe('parseProjectDoc', () => {
  it('正常な project.json を往復できる', () => {
    const p = assembleProject(header(), [], [], []);
    const back = parseProjectDoc(JSON.stringify(p));
    expect(back.projectId).toBe(p.projectId);
    expect(back.scenes).toEqual([]);
  });
  it('未対応メジャー(2.0)は拒否', () => {
    const doc = { ...assembleProject(header(), [], [], []), schemaVersion: '2.0' };
    expect(() => parseProjectDoc(JSON.stringify(doc))).toThrow();
  });
  it('壊れたJSONは拒否', () => {
    expect(() => parseProjectDoc('{ not json')).toThrow();
  });
  it('必須フィールド欠落は拒否', () => {
    const doc = { ...assembleProject(header(), [], [], []) } as Record<string, unknown>;
    delete doc.scenes;
    expect(() => parseProjectDoc(JSON.stringify(doc))).toThrow();
  });
});

describe('isSupportedSchemaVersion', () => {
  it('1.x は対応・2.0 は非対応', () => {
    expect(isSupportedSchemaVersion('1.0')).toBe(true);
    expect(isSupportedSchemaVersion('1.5')).toBe(true);
    expect(isSupportedSchemaVersion('2.0')).toBe(false);
  });
});
