import { describe, expect, it } from 'vitest';
import {
  PROJECT_SCHEMA_VERSION, assembleProject, createProjectId,
  defaultVideoSettings, defaultVoiceSettings, isSupportedSchemaVersion,
  parseProjectDoc,
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
