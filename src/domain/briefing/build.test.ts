// あなた向け会社説明の一時の動画を組み立てる（ADR-0061 決定5）。
import { describe, expect, it } from 'vitest';
import { FREE_CATEGORY } from '../enums';
import { PROJECT_SCHEMA_VERSION, validateProjectDoc } from '../project/persistence';
import type { Asset, Project, Scene } from '../project/types';
import type { Template } from '../template/types';
import { sampleTemplates } from '../../infrastructure/sampleData';
import { BRIEFING_PART_ID, briefingLogoAssetId, buildBriefingProject, type BriefingBuildInput } from './build';
import { BRIEFING_CLOSING_DURATION_SEC } from '../constants';

function scene(sceneId: string, over: Partial<Scene> = {}): Scene {
  return {
    sceneId,
    partId: 'part_001',
    order: 1,
    sceneType: 'message',
    templateId: 'message_yuko_v1',
    durationSec: 8,
    assetRefs: { background: 'asset_001' },
    character: { enabled: true, characterId: 'yuko', poseAssetId: null },
    texts: { title: `${sceneId} の見出し` },
    narration: { text: `${sceneId} のセリフ`, voiceId: 'voicevox_metan', status: 'generated', voicePath: `voices/${sceneId}.wav` },
    warnings: [],
    ...over,
  };
}

function dialog(sceneId: string): Scene {
  return scene(sceneId, {
    narration: { text: '', status: 'none' },
    lines: [{ lineId: 'line_001', text: 'はい', speaker: 3, status: 'generated', voicePath: `voices/${sceneId}_line_001.wav` }],
  });
}

function asset(assetId: string): Asset {
  return { assetId, assetType: 'image', displayName: `${assetId}.png`, filePath: `assets/${assetId}.png` } as Asset;
}

function project(projectId: string, scenes: Scene[], aspectRatio: '16:9' | '9:16' = '16:9'): Project {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    videoKind: 'recruit',
    projectId,
    projectName: projectId,
    purpose: 'company_intro',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    videoSettings: { aspectRatio, fps: 30, targetDurationSec: 60, maxDurationSec: 120 },
    companyInfo: { companyName: 'テスト株式会社' },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [asset('asset_001')],
    parts: [{ partId: 'part_001', title: 'はじめ', order: 1, sceneIds: scenes.map((s) => s.sceneId) }],
    scenes,
  } as Project;
}

const A = project('proj_20261101_001', [scene('scene_001'), dialog('scene_002')]);
const B = project('proj_20261102_001', [scene('scene_001')]);
const PORTRAIT = project('proj_20261103_001', [scene('scene_001')], '9:16');

function input(over: Partial<BriefingBuildInput> = {}): BriefingBuildInput {
  return {
    projectId: 'proj_20261105_901',
    nowIso: '2026-11-05T10:00:00.000Z',
    projectName: 'あなた向けの会社説明',
    picks: [
      { project: B, sceneId: 'scene_001' },
      { project: A, sceneId: 'scene_002' },
      { project: A, sceneId: 'scene_001' },
    ],
    voiceId: 'voicevox_zundamon',
    closingText: 'すたりおで作りました。',
    templates: sampleTemplates,
    ...over,
  };
}

describe('一時の動画を組み立てる', () => {
  it('並べた順に場面を取り込み、最後に締めの場面を足す（正典の形を満たす・原本は変えない）', () => {
    const before = JSON.stringify([A, B]);
    const r = buildBriefingProject(input())!;
    const p = r.project;
    expect(validateProjectDoc(p).errors).toEqual([]);
    expect(p.projectId).toBe('proj_20261105_901');
    expect([p.createdAt, p.updatedAt]).toEqual(['2026-11-05T10:00:00.000Z', '2026-11-05T10:00:00.000Z']);
    expect(p.scenes.map((s) => s.texts.title ?? '')).toEqual(['scene_001 の見出し', 'scene_002 の見出し', 'scene_001 の見出し', '']);
    expect(p.scenes.map((s) => s.order)).toEqual([1, 2, 3, 4]);
    expect(p.parts).toEqual([{ partId: BRIEFING_PART_ID, title: 'あなた向けの会社説明', order: 1, sceneIds: p.scenes.map((s) => s.sceneId) }]);
    const closing = p.scenes.at(-1)!;
    expect(closing.sceneType).toBe(FREE_CATEGORY);
    expect(closing.durationSec).toBe(BRIEFING_CLOSING_DURATION_SEC);
    expect(closing.freeLayout?.some((e) => e.text === 'すたりおで作りました。')).toBe(true);
    expect(new Set(p.scenes.map((s) => s.sceneId)).size).toBe(4);
    expect(r.closingMissing).toBe(false);
    expect(JSON.stringify([A, B])).toBe(before);
  });

  it('声は単独のナレーションの場面だけ選んだ声で作り直す（その元の声はコピーしない）・掛け合いは元のまま', () => {
    const r = buildBriefingProject(input())!;
    const [s1, s2, s3] = r.project.scenes;
    expect(r.voiceSceneIds).toEqual([s1.sceneId, s3.sceneId]);
    for (const s of [s1, s3]) expect(s.narration).toMatchObject({ voiceId: 'voicevox_zundamon', voicePath: null, status: 'pending' });
    expect(s2.lines?.[0].voicePath).toBe(`voices/${s2.sceneId}_line_001.wav`);
    const to = r.files.map((f) => f.toRelPath);
    expect(to).toContain(`voices/${s2.sceneId}_line_001.wav`);
    expect(to.some((t) => t === `voices/${s1.sceneId}.wav` || t === `voices/${s3.sceneId}.wav`)).toBe(false);
    expect(to.some((t) => t.startsWith('assets/'))).toBe(true);
  });

  it('話す文の無い場面（絵だけ）は声を作らない', () => {
    const silent = project('proj_20261104_001', [scene('scene_001', { narration: { text: '  ', status: 'none' } })]);
    const r = buildBriefingProject(input({ picks: [{ project: silent, sceneId: 'scene_001' }] }))!;
    expect(r.voiceSceneIds).toEqual([]);
    expect(r.project.scenes[0].narration).toEqual({ text: '  ', status: 'none' });
  });

  it('声を選ばなければ、元の声とファイルのまま', () => {
    const r = buildBriefingProject(input({ voiceId: null }))!;
    expect(r.voiceSceneIds).toEqual([]);
    const s1 = r.project.scenes[0];
    expect(s1.narration).toMatchObject({ voiceId: 'voicevox_metan', status: 'generated', voicePath: `voices/${s1.sceneId}.wav` });
    expect(r.files.map((f) => f.toRelPath)).toContain(`voices/${s1.sceneId}.wav`);
  });

  it('向きは最初の場面の動画にそろえ、違う向きの場面は入れずに知らせる', () => {
    const r = buildBriefingProject(input({ picks: [{ project: A, sceneId: 'scene_001' }, { project: PORTRAIT, sceneId: 'scene_001' }] }))!;
    expect(r.skippedOrientation).toEqual([{ projectId: PORTRAIT.projectId, sceneId: 'scene_001' }]);
    expect(r.project.scenes).toHaveLength(2);
    expect(r.project.videoSettings.aspectRatio).toBe('16:9');
    const portrait = buildBriefingProject(input({ picks: [{ project: PORTRAIT, sceneId: 'scene_001' }] }))!;
    expect(portrait.project.videoSettings.aspectRatio).toBe('9:16');
    expect(portrait.project.scenes.at(-1)?.templateId).toBe('free_portrait_v1');
  });

  it('ロゴは取り込んだ素材と重ならない番号で足し、締めの場面に置く', () => {
    let seen: readonly string[] = [];
    const r = buildBriefingProject(
      input({
        makeLogoAsset: (ids) => {
          seen = ids;
          return { ...asset(briefingLogoAssetId(ids)), displayName: 'ロゴ.png' };
        },
      }),
    )!;
    const imported = r.project.assets.filter((a) => a !== r.logoAsset).map((a) => a.assetId);
    expect(seen).toEqual(imported);
    expect(imported).not.toContain(r.logoAsset?.assetId);
    expect(r.project.assets).toContain(r.logoAsset);
    expect(r.project.scenes.at(-1)?.freeLayout?.some((e) => e.assetId === r.logoAsset?.assetId)).toBe(true);
    expect(validateProjectDoc(r.project).errors).toEqual([]);
  });

  it('向きに合う自由配置の器が無ければ、締めの場面を作れなかったと知らせる・場面が無ければ組まない', () => {
    const noFree: Template[] = sampleTemplates.filter((t) => t.category !== FREE_CATEGORY);
    const r = buildBriefingProject(input({ templates: noFree }))!;
    expect(r.closingMissing).toBe(true);
    expect(r.project.scenes).toHaveLength(3);
    expect(buildBriefingProject(input({ picks: [] }))).toBeNull();
  });
});
