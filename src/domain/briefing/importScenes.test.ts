// 登録済みの動画から場面を取り込む（ADR-0061 決定5・β）。
// ⚠️ **取り込む前と後で絵が同じ**ことは、描いた結果（SVG）で比べる（#1336 §7・ADR-0001 と同じ考え方）。
import { describe, expect, it } from 'vitest';
import { FREE_CATEGORY } from '../enums';
import { PROJECT_SCHEMA_VERSION, validateProjectDoc } from '../project/persistence';
import type { Asset, ElementAnimation, Project, Scene } from '../project/types';
import type { Template } from '../template/types';
import { layoutScene } from '../../renderer/layout';
import { layoutToSvg } from '../../renderer/sceneSvg';
import { importScenes, type ImportTarget } from './importScenes';

const normalTemplate: Template = {
  schemaVersion: '1.0',
  templateId: 'tmpl_normal',
  name: '写真と見出し',
  category: 'opening',
  aspectRatio: '16:9',
  canvas: { width: 1920, height: 1080 },
  defaults: { backgroundColor: '#102030' },
  layers: [
    { id: 'background', type: 'background', x: 0, y: 0, w: 1920, h: 1080 },
    { id: 'mainVisual', type: 'slot', x: 100, y: 200, w: 800, h: 600 },
    { id: 'titleText', type: 'text', textKey: 'title', x: 100, y: 860, w: 900, h: 90, fontSize: 60, color: '#ffffff' },
    { id: 'character', type: 'character', x: 1200, y: 300, w: 500, h: 700 },
  ],
};

const freeTemplate: Template = {
  schemaVersion: '1.0',
  templateId: 'tmpl_free',
  name: '自由配置',
  category: FREE_CATEGORY,
  aspectRatio: '16:9',
  canvas: { width: 1920, height: 1080 },
  layers: [{ id: 'background', type: 'background', x: 0, y: 0, w: 1920, h: 1080 }],
};

const templateOf = (id: string): Template => (id === freeTemplate.templateId ? freeTemplate : normalTemplate);

function asset(assetId: string, ext = 'png', over: Partial<Asset> = {}): Asset {
  return { assetId, assetType: 'image', displayName: `${assetId}.${ext}`, filePath: `assets/${assetId}.${ext}`, ...over };
}

function normalScene(sceneId: string, over: Partial<Scene> = {}): Scene {
  return {
    sceneId,
    partId: 'part_001',
    order: 1,
    sceneType: 'opening',
    templateId: normalTemplate.templateId,
    durationSec: 5,
    assetRefs: { background: 'asset_001', mainVisual: 'asset_002' },
    character: { enabled: true, characterId: 'yuko', poseAssetId: 'asset_003' },
    texts: { title: `${sceneId} の見出し` },
    narration: { text: 'こんにちは', status: 'generated', voicePath: `voices/${sceneId}.wav` },
    warnings: [],
    ...over,
  };
}

function freeScene(sceneId: string): Scene {
  return {
    ...normalScene(sceneId),
    sceneType: FREE_CATEGORY,
    templateId: freeTemplate.templateId,
    assetRefs: { background: null },
    character: { enabled: false, characterId: 'yuko' },
    narration: { text: '', status: 'none' },
    lines: [
      { lineId: 'line_001', text: 'はい', speaker: 3, status: 'generated', voicePath: `voices/${sceneId}_line_001.wav` },
      { lineId: 'line_002', text: 'どうぞ', speaker: 2, status: 'none', voicePath: null },
    ],
    freeLayout: [
      { id: 'free_001', kind: 'slot', x: 100, y: 100, w: 600, h: 400, assetId: 'asset_001', fit: 'cover' },
      { id: 'free_002', kind: 'shape', x: 900, y: 100, w: 300, h: 300, shapeType: 'ellipse', fillColor: '#ff8800' },
      { id: 'free_003', kind: 'text', x: 100, y: 700, w: 900, h: 100, text: '自由な文字', fontSize: 48, color: '#ffffff' },
    ],
  };
}

function project(projectId: string, scenes: Scene[], assets: Asset[], animations: ElementAnimation[] = []): Project {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    videoKind: 'recruit',
    projectId,
    projectName: projectId,
    purpose: 'company_intro',
    createdAt: '2026-11-05T00:00:00.000Z',
    updatedAt: '2026-11-05T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 120 },
    companyInfo: { companyName: 'テスト株式会社' },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets,
    parts: [{ partId: 'part_001', title: 'はじめ', order: 1, sceneIds: scenes.map((s) => s.sceneId) }],
    scenes,
    ...(animations.length > 0 ? { timelineOverlay: { animations } } : {}),
  } as Project;
}

/** どちらの動画も 001 から番号を振っている（実物と同じ＝必ず重なる）。 */
const projA = project(
  'proj_20261101_001',
  [normalScene('scene_001'), freeScene('scene_002')],
  [asset('asset_001'), asset('asset_002', 'jpg'), asset('asset_003', 'png', { assetType: 'yuko' } as Partial<Asset>)],
  [{ id: 'anim_001', sceneId: 'scene_002', targetId: 'free_002', keyframes: [{ timeSec: 0, x: 0, opacity: 0 }, { timeSec: 2, x: 300, opacity: 1 }] }],
);
const projB = project(
  'proj_20261102_001',
  [normalScene('scene_001', { texts: { title: 'B の見出し' }, bgmSettings: { enabled: true, assetId: 'asset_004', volume: 0.3 } })],
  [
    asset('asset_001', 'jpg'),
    asset('asset_002', 'mp4', { assetType: 'video', thumbnailPath: 'assets/asset_002_poster.png' } as Partial<Asset>),
    asset('asset_003'),
    asset('asset_004', 'mp3', { assetType: 'bgm', thumbnailPath: 'assets/cover.jpg' } as Partial<Asset>),
  ],
);

const empty: ImportTarget = { partId: 'part_001', sceneIds: [], assetIds: [], animationIds: [], startOrder: 1 };

describe('場面の取り込み（ADR-0061 決定5）', () => {
  it('検査に使う動画は、正典の形を満たしている（簡略化した形で検査しない）', () => {
    expect(validateProjectDoc(projA).errors).toEqual([]);
    expect(validateProjectDoc(projB).errors).toEqual([]);
  });

  it('2本の動画の重なる番号を付け替え、並べた順に並ぶ', () => {
    const r = importScenes(empty, [
      { project: projA, sceneId: 'scene_002' },
      { project: projB, sceneId: 'scene_001' },
      { project: projA, sceneId: 'scene_001' },
    ]);
    expect(r.scenes.map((s) => s.sceneId)).toEqual(['scene_001', 'scene_002', 'scene_003']);
    expect(r.scenes.map((s) => s.order)).toEqual([1, 2, 3]);
    expect(r.sources).toEqual([
      { sceneId: 'scene_001', sourceProjectId: projA.projectId, sourceSceneId: 'scene_002' },
      { sceneId: 'scene_002', sourceProjectId: projB.projectId, sourceSceneId: 'scene_001' },
      { sceneId: 'scene_003', sourceProjectId: projA.projectId, sourceSceneId: 'scene_001' },
    ]);
    const ids = r.assets.map((a) => a.assetId);
    expect(new Set(ids).size).toBe(ids.length);
    // B の場面が指す素材は B の素材（同じ番号の A の素材ではない）。
    const bScene = r.scenes[1];
    const bBg = r.assets.find((a) => a.assetId === bScene.assetRefs.background);
    expect(bBg?.filePath.endsWith('.jpg')).toBe(true);
    expect(r.files).toContainEqual({ fromProjectId: projB.projectId, fromRelPath: 'assets/asset_001.jpg', toRelPath: bBg!.filePath });
  });

  it('同じ動画の同じ素材は1回だけ持っていく（2つの場面が同じ写真を使っても1つ）', () => {
    const r = importScenes(empty, [
      { project: projA, sceneId: 'scene_001' },
      { project: projA, sceneId: 'scene_002' },
    ]);
    // A の asset_001 は場面1の背景と場面2の自由配置の枠の両方が使う。
    expect(r.scenes[0].assetRefs.background).toBe(r.scenes[1].freeLayout?.[0].assetId);
    expect(r.assets.filter((a) => a.displayName === 'asset_001.png')).toHaveLength(1);
    expect(r.files.filter((f) => f.fromRelPath === 'assets/asset_001.png')).toHaveLength(1);
  });

  it('取り込み先にある番号と重ねない', () => {
    const r = importScenes(
      { partId: 'part_002', sceneIds: ['scene_001'], assetIds: ['asset_001', 'asset_002'], animationIds: ['anim_001'], startOrder: 2 },
      [{ project: projA, sceneId: 'scene_002' }],
    );
    expect(r.scenes[0].sceneId).toBe('scene_002');
    expect(r.scenes[0].partId).toBe('part_002');
    expect(r.scenes[0].order).toBe(2);
    expect(r.assets.map((a) => a.assetId)).toEqual(['asset_003']);
    expect(r.animations.map((a) => a.id)).toEqual(['anim_002']);
  });

  it('声のファイルは新しい場面の名前でコピーする（作っていない行は運ばない）', () => {
    const r = importScenes({ ...empty, sceneIds: ['scene_001', 'scene_002'] }, [
      { project: projA, sceneId: 'scene_001' },
      { project: projA, sceneId: 'scene_002' },
    ]);
    expect(r.scenes[0].narration.voicePath).toBe('voices/scene_003.wav');
    expect(r.scenes[1].lines?.[0].voicePath).toBe('voices/scene_004_line_001.wav');
    expect(r.scenes[1].lines?.[1].voicePath).toBeNull();
    expect(r.files).toContainEqual({ fromProjectId: projA.projectId, fromRelPath: 'voices/scene_001.wav', toRelPath: 'voices/scene_003.wav' });
    expect(r.files).toContainEqual({ fromProjectId: projA.projectId, fromRelPath: 'voices/scene_002_line_001.wav', toRelPath: 'voices/scene_004_line_001.wav' });
    expect(r.files.some((f) => f.toRelPath === '')).toBe(false);
  });

  it('代表フレームも新しい素材の番号でコピーする（頭が素材の番号なら頭だけ・違う名前なら番号_thumb）', () => {
    const r = importScenes({ ...empty, assetIds: ['asset_001'] }, [{ project: projB, sceneId: 'scene_001' }]);
    const video = r.assets.find((a) => a.assetType === 'video');
    expect(video?.filePath).toBe(`assets/${video?.assetId}.mp4`);
    expect(video?.thumbnailPath).toBe(`assets/${video?.assetId}_poster.png`);
    expect(r.files).toContainEqual({ fromProjectId: projB.projectId, fromRelPath: 'assets/asset_002_poster.png', toRelPath: video!.thumbnailPath! });
    const bgm = r.assets.find((a) => a.assetType === 'bgm');
    expect(bgm?.thumbnailPath).toBe(`assets/${bgm?.assetId}_thumb.jpg`);
  });

  it('場面の BGM の素材も付け替える', () => {
    const r = importScenes(empty, [{ project: projB, sceneId: 'scene_001' }]);
    const bgm = r.assets.find((a) => a.assetType === 'bgm');
    expect(r.scenes[0].bgmSettings).toEqual({ enabled: true, assetId: bgm?.assetId, volume: 0.3 });
    expect(r.files).toContainEqual({ fromProjectId: projB.projectId, fromRelPath: 'assets/asset_004.mp3', toRelPath: bgm!.filePath });
  });

  it('動きは新しい番号・新しい場面へ付け替え、対象の要素はそのまま', () => {
    const r = importScenes({ ...empty, sceneIds: ['scene_001'] }, [{ project: projA, sceneId: 'scene_002' }]);
    expect(r.animations).toHaveLength(1);
    expect(r.animations[0]).toMatchObject({ id: 'anim_001', sceneId: 'scene_002', targetId: 'free_002' });
  });

  it('動画の素材でない番号（同梱の立ち絵など）は付け替えない・一覧に無い素材の番号は誰とも重ならない番号へ', () => {
    const odd = project(
      'proj_20261103_001',
      [normalScene('scene_001', { character: { enabled: true, characterId: 'yuko', poseAssetId: 'yuko_smile_001' }, assetRefs: { background: 'asset_009', mainVisual: null } })],
      [],
    );
    const r = importScenes({ ...empty, assetIds: ['asset_001'] }, [{ project: odd, sceneId: 'scene_001' }]);
    expect(r.scenes[0].character.poseAssetId).toBe('yuko_smile_001');
    expect(r.scenes[0].assetRefs.mainVisual).toBeNull();
    expect(r.scenes[0].assetRefs.background).toBe('asset_002');
    expect(r.missingAssets).toEqual([{ projectId: odd.projectId, assetId: 'asset_009' }]);
    expect(r.assets).toEqual([]);
  });

  it('動画に無い場面は取り込まず、知らせる', () => {
    const r = importScenes(empty, [{ project: projA, sceneId: 'scene_099' }, { project: projB, sceneId: 'scene_001' }]);
    expect(r.missingScenes).toEqual([{ projectId: projA.projectId, sceneId: 'scene_099' }]);
    expect(r.scenes.map((s) => s.sceneId)).toEqual(['scene_001']);
  });

  it('原本は書き換えない', () => {
    const before = JSON.stringify([projA, projB]);
    importScenes(empty, [{ project: projA, sceneId: 'scene_002' }, { project: projB, sceneId: 'scene_001' }]);
    expect(JSON.stringify([projA, projB])).toBe(before);
  });

  it('取り込んで組んだ動画は、正典の形を満たす', () => {
    const r = importScenes(empty, [
      { project: projA, sceneId: 'scene_002' },
      { project: projB, sceneId: 'scene_001' },
      { project: projA, sceneId: 'scene_001' },
    ]);
    const session = project('proj_20261105_001', r.scenes, r.assets, r.animations);
    expect(validateProjectDoc(session).errors).toEqual([]);
  });

  /**
   * ⚠️ **取り込む前と後で絵が同じ**（#1336 §7）＝付け替えた番号が描いた結果に漏れないか、描いて比べる。
   * 素材の絵は「どの動画のどのファイルか」で決まる＝原本はその動画の素材から、取り込み後はコピーしたファイルの出どころから引く。
   */
  it('取り込む前と後で、描いた絵が同じ（動きの途中も）', () => {
    const picks = [
      { project: projA, sceneId: 'scene_002' },
      { project: projB, sceneId: 'scene_001' },
      { project: projA, sceneId: 'scene_001' },
    ];
    const r = importScenes(empty, picks);
    const fileSrc = (projectId: string, rel: string): string => `file://${projectId}/${rel}`;
    const origin = new Map(r.files.map((f) => [f.toRelPath, fileSrc(f.fromProjectId, f.fromRelPath)]));
    picks.forEach((pick, i) => {
      const src = pick.project.scenes.find((s) => s.sceneId === pick.sceneId)!;
      const dst = r.scenes[i];
      const srcAnims = (pick.project.timelineOverlay?.animations ?? []).filter((a) => a.sceneId === src.sceneId);
      const dstAnims = r.animations.filter((a) => a.sceneId === dst.sceneId);
      for (const timeSec of [0, 1, 2]) {
        const before = layoutToSvg(layoutScene(src, templateOf(src.templateId), { timeSec, animations: srcAnims }), {
          assetSrc: (id) => {
            const a = pick.project.assets.find((x) => x.assetId === id);
            return a ? fileSrc(pick.project.projectId, a.filePath) : id ?? undefined;
          },
        });
        const after = layoutToSvg(layoutScene(dst, templateOf(dst.templateId), { timeSec, animations: dstAnims }), {
          assetSrc: (id) => {
            const a = r.assets.find((x) => x.assetId === id);
            return a ? origin.get(a.filePath) : id ?? undefined;
          },
        });
        expect(after, `${pick.project.projectId}/${pick.sceneId} の ${timeSec} 秒`).toBe(before);
      }
    });
  });
});
