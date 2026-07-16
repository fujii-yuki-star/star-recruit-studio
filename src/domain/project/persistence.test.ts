import { describe, expect, it } from 'vitest';
import {
  PROJECT_SCHEMA_VERSION, assembleProject, createAssetId, createBgmId, createFreeElementId, createGroupId, createLineId, createOverlayClipId, createPartId,
  createProjectId, createSceneId, defaultVideoSettings, defaultVoiceSettings,
  isSupportedSchemaVersion, parseProjectDoc, projectHeaderFromProject, ProjectLoadError,
} from './persistence';
import type { ProjectHeader } from './persistence';
import type { Part, Scene } from './types';

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

// 正典スキーマ（Scene の必須：sceneId/partId/order/sceneType/templateId/durationSec/assetRefs/character/texts/narration/warnings）を
// 満たす最小 Scene。移行テストで場面を差し替える際に、読込時検証（#416）を通る構造にする（旧版フィールドは overrides で足す）。
function validScene(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sceneId: 'scene_001', partId: 'part_001', order: 1, sceneType: 'opening', templateId: 'tpl_x',
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: 'yuko' }, texts: {},
    narration: { text: '', voiceId: null, status: 'none' }, warnings: [],
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
  it('日本語＋ASCII 混在は ASCII 部分だけが slug になる（明るいBGM → slug=bgm）', () => {
    expect(createBgmId('明るいBGM', [])).toBe('bgm_bgm_001');
  });
  it('slug が空（日本語のみ・空白）なら bgm_{NNN}', () => {
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
  it('番号に隙間があれば最小空き番号を返す', () => {
    expect(createFreeElementId(['free_001', 'free_003'])).toBe('free_002');
  });
  it('999 を超えると4桁になる（pattern ^free_[0-9]{3,}$）', () => {
    const existing = Array.from({ length: 999 }, (_, i) => `free_${String(i + 1).padStart(3, '0')}`);
    expect(createFreeElementId(existing)).toBe('free_1000');
  });
});

describe('createGroupId (§2.1 group_{NNN}・scene/template 内一意・ADR-0022)', () => {
  it('既存が無ければ group_001', () => {
    expect(createGroupId([])).toBe('group_001');
  });
  it('既存と衝突しない最小番号を採る（歯抜けを埋める）', () => {
    expect(createGroupId(['group_001', 'group_003'])).toBe('group_002');
  });
});

describe('createOverlayClipId (§2.1 ovclip_{NNN}・project 内一意・ADR-0018)', () => {
  it('既存が無ければ ovclip_001', () => {
    expect(createOverlayClipId([])).toBe('ovclip_001');
  });
  it('既存と衝突しない最小番号を採る（歯抜けを埋める）', () => {
    expect(createOverlayClipId(['ovclip_001', 'ovclip_003'])).toBe('ovclip_002');
  });
  it('999 を超えると4桁になる（pattern ^ovclip_[0-9]{3,}$）', () => {
    const existing = Array.from({ length: 999 }, (_, i) => `ovclip_${String(i + 1).padStart(3, '0')}`);
    expect(createOverlayClipId(existing)).toBe('ovclip_1000');
  });
});

describe('createLineId (§2.1 line_{NNN}・scene 内一意・ADR-0015)', () => {
  it('既存が無ければ line_001', () => {
    expect(createLineId([])).toBe('line_001');
  });
  it('既存と衝突しない最小番号を採る', () => {
    expect(createLineId(['line_001', 'line_002'])).toBe('line_003');
  });
  it('番号に隙間があれば最小空き番号を返す', () => {
    expect(createLineId(['line_001', 'line_003'])).toBe('line_002');
  });
  it('999 を超えると4桁になる（pattern ^line_[0-9]{3,}$）', () => {
    const existing = Array.from({ length: 999 }, (_, i) => `line_${String(i + 1).padStart(3, '0')}`);
    expect(createLineId(existing)).toBe('line_1000');
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
  it('videoKind を付与し（既定 recruit）generalBrief は指定時のみ（ADR-0011）', () => {
    const p = assembleProject(header(), [], [], []);
    expect(p.videoKind).toBe('recruit');
    expect('generalBrief' in p).toBe(false);
    const g = assembleProject(
      header({ videoKind: 'general', companyInfo: undefined, generalBrief: { title: '四半期報告', keyPoints: ['売上120%'], targetAudience: '全社員' } }),
      [], [], [],
    );
    expect(g.videoKind).toBe('general');
    expect(g.generalBrief?.title).toBe('四半期報告');
    expect(g.generalBrief?.targetAudience).toBe('全社員'); // ADR-0011 #12: 対象視聴者
    // general では companyInfo を出力しない（schema if/then/else の not:required を満たす・ADR-0011）。
    expect('companyInfo' in g).toBe(false);
  });
});

describe('projectHeaderFromProject（assembleProject の逆・#324）', () => {
  it('任意フィールド（timelineOverlay・toneSettings）を取りこぼさず round-trip する', () => {
    const overlay: ProjectHeader['timelineOverlay'] = { clips: [{ id: 'ovclip_001', track: 'telop', anchorSceneId: 'scene_001', startSec: 1, durationSec: 2, text: 'x' }] };
    const p = assembleProject(header({ toneSettings: { tone: 'やわらか' }, timelineOverlay: overlay }), [], [], []);
    const back = projectHeaderFromProject(p);
    // 読込時に store が meta を組む経路の縮図：overlay 等のヘッダ系フィールドが消えない。
    expect(back.timelineOverlay).toEqual(overlay);
    expect(back.toneSettings).toEqual({ tone: 'やわらか' });
    // ヘッダ→Project→ヘッダ→Project が一致（フィールド取りこぼしの検出）。
    expect(assembleProject(back, [], [], [])).toEqual(p);
  });
});

describe('parseProjectDoc', () => {
  it('正常な project.json を往復できる', () => {
    const p = assembleProject(header(), [], [], []);
    const back = parseProjectDoc(JSON.stringify(p));
    expect(back.projectId).toBe(p.projectId);
    expect(back.scenes).toEqual([]);
  });
  it('掛け合い：scene.lines を持つ project が往復で保持される（1.8・ADR-0015）', () => {
    const scene = {
      sceneId: 'scene_001', partId: 'part_001', order: 1, sceneType: 'opening', templateId: 'tpl',
      durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: 'yuko' }, texts: {},
      narration: { text: '', status: 'none' },
      lines: [
        { lineId: 'line_001', text: 'やあ', speaker: 3, status: 'none' },
        { lineId: 'line_002', text: 'どうも', speaker: 2, status: 'none' },
      ],
      warnings: [],
    };
    const doc = { ...assembleProject(header(), [], [], []), scenes: [scene] } as Record<string, unknown>;
    const back = parseProjectDoc(JSON.stringify(doc));
    expect(back.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(back.scenes[0].lines?.map((l) => l.speaker)).toEqual([3, 2]);
  });
  it('同時開始：先頭行のフラグと startWithPrevious×startSec の併存を読込時に正規化する（ADR-0031・実装が無視する状態を残さない）', () => {
    const scene = {
      sceneId: 'scene_001', partId: 'part_001', order: 1, sceneType: 'opening', templateId: 'tpl',
      durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: 'yuko' }, texts: {},
      narration: { text: '', status: 'none' },
      lines: [
        { lineId: 'line_001', text: 'A', startWithPrevious: true, status: 'none' }, // 先頭＝同時にする相手がいない→落とす
        { lineId: 'line_002', text: 'B', startWithPrevious: true, startSec: 3, status: 'none' }, // 併存 startSec→落とす
      ],
      warnings: [],
    };
    const doc = { ...assembleProject(header(), [], [], []), scenes: [scene] } as Record<string, unknown>;
    const back = parseProjectDoc(JSON.stringify(doc));
    expect(back.scenes[0].lines?.[0].startWithPrevious).toBeUndefined(); // 先頭の休眠フラグは落ちる
    expect(back.scenes[0].lines?.[1].startWithPrevious).toBe(true); // 2行目は保持
    expect(back.scenes[0].lines?.[1].startSec).toBeUndefined(); // 併存 startSec は落ちる
  });
  it('FREE 回転：rotation を持つ旧版(1.8)が 1.9 へ移行し rotation を保持する（#208）', () => {
    const scene = {
      sceneId: 'scene_001', partId: 'part_001', order: 1, sceneType: 'free', templateId: 'free_canvas_v1',
      durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: 'yuko' }, texts: {},
      narration: { text: '', status: 'none' },
      freeLayout: [{ id: 'free_001', kind: 'shape', x: 10, y: 10, w: 100, h: 100, rotation: 45 }],
      warnings: [],
    };
    const doc = { ...assembleProject(header(), [], [], []), schemaVersion: '1.8', scenes: [scene] } as Record<string, unknown>;
    const back = parseProjectDoc(JSON.stringify(doc));
    expect(back.schemaVersion).toBe(PROJECT_SCHEMA_VERSION); // 1.8→現行へ昇格（任意追加＝変換不要）
    expect(back.scenes[0].freeLayout?.[0].rotation).toBe(45);
  });
  it('FREE text 体裁：lineHeight/textAlign を持つ旧版(1.9)が移行し保持する（#209）', () => {
    const scene = {
      sceneId: 'scene_001', partId: 'part_001', order: 1, sceneType: 'free', templateId: 'free_canvas_v1',
      durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: 'yuko' }, texts: {},
      narration: { text: '', status: 'none' },
      freeLayout: [{ id: 'free_001', kind: 'text', x: 0, y: 0, w: 100, h: 50, text: 'a', lineHeight: 1.8, textAlign: 'right', strokeColor: '#000000', strokeWidth: 2 }],
      warnings: [],
    };
    const doc = { ...assembleProject(header(), [], [], []), schemaVersion: '1.9', scenes: [scene] } as Record<string, unknown>;
    const back = parseProjectDoc(JSON.stringify(doc));
    expect(back.schemaVersion).toBe(PROJECT_SCHEMA_VERSION); // 1.9→現行へ昇格
    expect(back.scenes[0].freeLayout?.[0]).toMatchObject({ lineHeight: 1.8, textAlign: 'right' });
  });
  it('FREE 非表示/ロック：hidden/locked を持つ旧版(1.10)が移行し保持する（#210）', () => {
    const scene = {
      sceneId: 'scene_001', partId: 'part_001', order: 1, sceneType: 'free', templateId: 'free_canvas_v1',
      durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: 'yuko' }, texts: {},
      narration: { text: '', status: 'none' },
      freeLayout: [{ id: 'free_001', kind: 'shape', x: 0, y: 0, w: 100, h: 100, hidden: true, locked: true }],
      warnings: [],
    };
    const doc = { ...assembleProject(header(), [], [], []), schemaVersion: '1.10', scenes: [scene] } as Record<string, unknown>;
    const back = parseProjectDoc(JSON.stringify(doc));
    expect(back.schemaVersion).toBe(PROJECT_SCHEMA_VERSION); // 1.10→1.11 へ昇格
    expect(back.scenes[0].freeLayout?.[0]).toMatchObject({ hidden: true, locked: true });
  });
  it('要素のグループ化：groups を持つ旧版(1.13)が移行し保持する（ADR-0022・#304）', () => {
    const scene = {
      sceneId: 'scene_001', partId: 'part_001', order: 1, sceneType: 'free', templateId: 'free_canvas_v1',
      durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: 'yuko' }, texts: {},
      narration: { text: '', status: 'none' },
      freeLayout: [{ id: 'free_001', kind: 'shape', x: 0, y: 0, w: 100, h: 100 }],
      groups: [{ id: 'group_001', members: ['free_001'], transform: { x: 10, y: 0, rotation: 0, scale: 1 } }],
      warnings: [],
    };
    const doc = { ...assembleProject(header(), [], [], []), schemaVersion: '1.13', scenes: [scene] } as Record<string, unknown>;
    const back = parseProjectDoc(JSON.stringify(doc));
    expect(back.schemaVersion).toBe(PROJECT_SCHEMA_VERSION); // 1.13→1.14 へ昇格
    expect(back.scenes[0].groups?.[0]).toMatchObject({ id: 'group_001', members: ['free_001'] });
  });
  it('タイムライン層：timelineOverlay を持つ旧版(1.14)が移行し保持する（ADR-0018）', () => {
    const overlay = { clips: [{ id: 'ovclip_001', track: 'telop', anchorSceneId: 'scene_001', startSec: 1, durationSec: 2, text: '補足' }] };
    const doc = { ...assembleProject(header(), [], [], []), schemaVersion: '1.14', timelineOverlay: overlay } as Record<string, unknown>;
    const back = parseProjectDoc(JSON.stringify(doc));
    expect(back.schemaVersion).toBe(PROJECT_SCHEMA_VERSION); // 1.14→現行へ昇格（任意追加＝変換不要）
    expect(back.timelineOverlay).toEqual(overlay);
  });
  it('場面ごとBGM：scene.bgmSettings を持つ旧版(1.15)が移行し保持する（ADR-0018 ③(7)）', () => {
    const scene = {
      sceneId: 'scene_001', partId: 'part_001', order: 1, sceneType: 'intro', templateId: 'tpl_v1',
      durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: 'yuko' }, texts: {},
      narration: { text: '', status: 'none' }, warnings: [],
      bgmSettings: { enabled: true, bundledBgmId: 'found-new-hope', volume: 0.3, loop: true },
    };
    const doc = { ...assembleProject(header(), [], [], []), schemaVersion: '1.15', scenes: [scene] } as Record<string, unknown>;
    const back = parseProjectDoc(JSON.stringify(doc));
    expect(back.schemaVersion).toBe(PROJECT_SCHEMA_VERSION); // 1.15→現行へ昇格（任意追加＝変換不要）
    expect(back.scenes[0].bgmSettings).toEqual({ enabled: true, bundledBgmId: 'found-new-hope', volume: 0.3, loop: true });
  });
  it('キーフレーム：timelineOverlay.animations を持つ旧版(1.16)が移行し保持する（ADR-0019 ④）', () => {
    const animations = [{ id: 'anim_001', sceneId: 'scene_001', targetId: 'free_001', keyframes: [{ timeSec: 0, opacity: 0 }, { timeSec: 2, opacity: 1, easing: 'ease-in-out' }] }];
    const doc = { ...assembleProject(header(), [], [], []), schemaVersion: '1.16', timelineOverlay: { animations } } as Record<string, unknown>;
    const back = parseProjectDoc(JSON.stringify(doc));
    expect(back.schemaVersion).toBe(PROJECT_SCHEMA_VERSION); // 1.16→現行へ昇格（任意追加＝変換不要）
    expect(back.timelineOverlay?.animations).toEqual(animations);
  });
  it('動画スロット再生開始：scene.slotVideoStart を持つ旧版(1.17)が移行し保持する（ADR-0027・#444）', () => {
    const scene = {
      sceneId: 'scene_001', partId: 'part_001', order: 1, sceneType: 'intro', templateId: 'tpl_v1',
      durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: 'yuko' }, texts: {},
      narration: { text: '', status: 'none' }, warnings: [],
      slotVideoStart: { mainVisual: { mode: 'afterAnim' }, sub: { mode: 'delay', delaySec: 0.6 } },
    };
    const doc = { ...assembleProject(header(), [], [], []), schemaVersion: '1.17', scenes: [scene] } as Record<string, unknown>;
    const back = parseProjectDoc(JSON.stringify(doc));
    expect(back.schemaVersion).toBe(PROJECT_SCHEMA_VERSION); // 1.17→1.18 へ昇格（任意追加＝変換不要・欠落=withAnim）
    expect(back.scenes[0].slotVideoStart).toEqual({ mainVisual: { mode: 'afterAnim' }, sub: { mode: 'delay', delaySec: 0.6 } });
  });
  it('クリップ per-use 上書き：scene.slotClips を持つ旧版(1.18)が移行し保持する（ADR-0028・#472）', () => {
    const scene = {
      sceneId: 'scene_001', partId: 'part_001', order: 1, sceneType: 'intro', templateId: 'tpl_v1',
      durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: 'yuko' }, texts: {},
      narration: { text: '', status: 'none' }, warnings: [],
      slotClips: { mainVisual: { startSec: 1, endSec: 5, speed: 1.5, useOriginalAudio: true, originalAudioVolume: 0.4 } },
    };
    const doc = { ...assembleProject(header(), [], [], []), schemaVersion: '1.18', scenes: [scene] } as Record<string, unknown>;
    const back = parseProjectDoc(JSON.stringify(doc));
    expect(back.schemaVersion).toBe(PROJECT_SCHEMA_VERSION); // 1.18→1.19 へ昇格（任意追加＝変換不要・欠落は asset.clip 継承）
    expect(back.scenes[0].slotClips).toEqual({ mainVisual: { startSec: 1, endSec: 5, speed: 1.5, useOriginalAudio: true, originalAudioVolume: 0.4 } });
  });
  it('FREE 背景帯：scene.freeLayout の FreeElement.background を持つ旧版(1.22)が移行し保持する（#529）', () => {
    const scene = {
      sceneId: 'scene_001', partId: 'part_001', order: 1, sceneType: 'free', templateId: 'free_canvas_v1',
      durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: 'yuko' }, texts: {},
      narration: { text: '', status: 'none' }, warnings: [],
      freeLayout: [
        { id: 'free_001', kind: 'text', x: 0, y: 0, w: 200, h: 60, text: 'あ', background: { enabled: true, color: '#112233', opacity: 0.4, radius: 8 } },
        { id: 'free_002', kind: 'subtitle', x: 0, y: 80, w: 400, h: 80, background: { enabled: false } },
      ],
    };
    const doc = { ...assembleProject(header(), [], [], []), schemaVersion: '1.22', scenes: [scene] } as Record<string, unknown>;
    const back = parseProjectDoc(JSON.stringify(doc));
    expect(back.schemaVersion).toBe(PROJECT_SCHEMA_VERSION); // 1.22→1.23 へ昇格（任意追加＝変換不要）
    expect(back.scenes[0].freeLayout).toEqual(scene.freeLayout); // 背景帯を取りこぼさず保持（migrateProject のスプレッド保持）
  });
  it('videoKind 省略の旧データ(1.0)は recruit に移行して読める（ADR-0011）', () => {
    const doc = { ...assembleProject(header(), [], [], []), schemaVersion: '1.0' } as Record<string, unknown>;
    delete doc.videoKind;
    const back = parseProjectDoc(JSON.stringify(doc));
    expect(back.videoKind).toBe('recruit');
    expect(back.schemaVersion).toBe(PROJECT_SCHEMA_VERSION); // 1.0→現行 schemaVersion へ昇格する
  });
  it('旧 companyInfo.additionalNotes をトップレベルへ移送する（ADR-0011 移行）', () => {
    const doc = {
      ...assembleProject(header(), [], [], []),
      schemaVersion: '1.0',
      companyInfo: { companyName: '株式会社サンプル', additionalNotes: '誠実な社風を伝えたい' },
    } as Record<string, unknown>;
    delete doc.videoKind;
    const back = parseProjectDoc(JSON.stringify(doc));
    expect(back.additionalNotes).toBe('誠実な社風を伝えたい');
    expect((back.companyInfo as unknown as Record<string, unknown>).additionalNotes).toBeUndefined();
  });
  it('旧 videoSettings.width/height を 1.2 移行で除去する（ADR-0012）', () => {
    const doc = {
      ...assembleProject(header(), [], [], []),
      schemaVersion: '1.1',
      videoSettings: { aspectRatio: '16:9', width: 1920, height: 1080, fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    } as Record<string, unknown>;
    const back = parseProjectDoc(JSON.stringify(doc));
    expect(back.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect('width' in back.videoSettings).toBe(false);
    expect('height' in back.videoSettings).toBe(false);
    expect(back.videoSettings.aspectRatio).toBe('16:9');
  });
  it('width/height が既に無い 1.1 文書は aspectRatio を保持して 1.2 に昇格する（移行の冪等性）', () => {
    const doc = {
      ...assembleProject(header(), [], [], []),
      schemaVersion: '1.1',
      videoSettings: { aspectRatio: '9:16', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    } as Record<string, unknown>;
    const back = parseProjectDoc(JSON.stringify(doc));
    expect(back.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(back.videoSettings.aspectRatio).toBe('9:16');
    expect('width' in back.videoSettings).toBe(false);
  });
  it('1.2 文書で fontId 未指定なら既定フォントを補完して 1.3 へ昇格する（同梱フォント選択）', () => {
    const doc = {
      ...assembleProject(header(), [], [], []),
      schemaVersion: '1.2',
      videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    } as Record<string, unknown>;
    const back = parseProjectDoc(JSON.stringify(doc));
    expect(back.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(back.videoSettings.fontId).toBe('gen-interface-jp'); // DEFAULT_FONT_ID
  });
  it('未知の fontId は移行で既定フォントへ補正する', () => {
    const doc = {
      ...assembleProject(header(), [], [], []),
      schemaVersion: '1.2',
      videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600, fontId: 'old-font' },
    } as Record<string, unknown>;
    const back = parseProjectDoc(JSON.stringify(doc));
    expect(back.videoSettings.fontId).toBe('gen-interface-jp');
  });
  it('既知の fontId は移行で上書きしない（冪等）', () => {
    const doc = {
      ...assembleProject(header(), [], [], []),
      videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600, fontId: 'kaitou-yokoku-gothic' },
    } as Record<string, unknown>;
    const back = parseProjectDoc(JSON.stringify(doc));
    expect(back.videoSettings.fontId).toBe('kaitou-yokoku-gothic');
  });
  it('1.3 文書で bundledBgmId 未指定でも 1.4 へ昇格できる（標準BGMは任意・未選択）', () => {
    const doc = {
      ...assembleProject(header(), [], [], []),
      schemaVersion: '1.3',
    } as Record<string, unknown>;
    const back = parseProjectDoc(JSON.stringify(doc));
    expect(back.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect('bgmSettings' in back).toBe(false); // 任意フィールドは未指定のまま
  });
  it('既知の bundledBgmId（標準BGM）は移行で保持する', () => {
    const doc = {
      ...assembleProject(header(), [], [], []),
      schemaVersion: '1.3',
      bgmSettings: { enabled: true, bundledBgmId: 'summer-morning' },
    } as Record<string, unknown>;
    const back = parseProjectDoc(JSON.stringify(doc));
    expect(back.bgmSettings?.bundledBgmId).toBe('summer-morning');
  });
  it('未知の bundledBgmId は移行で標準BGM未選択へ落とす（自分のBGM/なしへフォールバック）', () => {
    const doc = {
      ...assembleProject(header(), [], [], []),
      schemaVersion: '1.3',
      bgmSettings: { enabled: true, bundledBgmId: 'old-track', assetId: 'bgm_x_001' },
    } as Record<string, unknown>;
    const back = parseProjectDoc(JSON.stringify(doc));
    expect(back.bgmSettings?.bundledBgmId).toBeUndefined();
    expect(back.bgmSettings?.assetId).toBe('bgm_x_001'); // 自分のBGM は残す
  });
  it('1.4 文書で scene.fontId 未指定でも 1.5 へ昇格できる（場面フォントは任意・継承）', () => {
    const doc = {
      ...assembleProject(header(), [], [], []),
      schemaVersion: '1.4',
    } as Record<string, unknown>;
    const back = parseProjectDoc(JSON.stringify(doc));
    expect(back.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
  });
  it('既知の scene.fontId は保持・未知は継承(未指定)へ落とす・null は保持（1.4→1.5）', () => {
    const doc = {
      ...assembleProject(header(), [], [], []),
      schemaVersion: '1.4',
      scenes: [
        validScene({ sceneId: 'scene_001', fontId: 'kaitou-yokoku-gothic' }),
        validScene({ sceneId: 'scene_002', fontId: 'old-font' }),
        validScene({ sceneId: 'scene_003', fontId: null }),
        validScene({ sceneId: 'scene_004' }),
      ],
    } as Record<string, unknown>;
    const back = parseProjectDoc(JSON.stringify(doc));
    const byId = (id: string) =>
      (back.scenes as unknown as Array<Record<string, unknown>>).find((s) => s.sceneId === id)!;
    expect(byId('scene_001').fontId).toBe('kaitou-yokoku-gothic');
    expect('fontId' in byId('scene_002')).toBe(false); // 未知 → 落とす（継承）
    expect(byId('scene_003').fontId).toBeNull(); // null=継承 を保持
    expect('fontId' in byId('scene_004')).toBe(false); // 未指定のまま
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

  // 読込時スキーマ検証（#416・11 §8 V2）。構造破損（型不正・必須欠落）は拒否、内容制約違反は読み込む（作りかけを弾かない）。
  describe('読込時スキーマ検証（#416）', () => {
    // 拒否は「ProjectLoadError かつ §2-5 文言」まで固定する（生 TypeError を UI に出さない・#416 P1/P2）。
    const expectLoadReject = (doc: unknown): void => {
      let err: unknown;
      try {
        parseProjectDoc(JSON.stringify(doc));
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(ProjectLoadError);
      expect((err as Error).message).toContain('別のプロジェクトを選んでください');
    };

    it('場面の型不正（durationSec が文字列）は読込拒否', () => {
      expectLoadReject({ ...assembleProject(header(), [], [], [validScene({ durationSec: 'abc' }) as unknown as Scene]) });
    });
    it('場面の必須欠落（partId 無し）は読込拒否', () => {
      const scene = validScene();
      delete scene.partId;
      expectLoadReject({ ...assembleProject(header(), [], [], [scene as unknown as Scene]) });
    });
    it('videoSettings の必須欠落（fps 無し）は読込拒否', () => {
      const doc = { ...assembleProject(header(), [], [], []) } as Record<string, unknown>;
      const vs = { ...(doc.videoSettings as Record<string, unknown>) };
      delete vs.fps;
      doc.videoSettings = vs;
      expectLoadReject(doc);
    });
    it('videoSettings が非オブジェクト（"bad"）でも生 TypeError にせず読込拒否（#416 P1）', () => {
      const doc = { ...assembleProject(header(), [], [], []), videoSettings: 'bad' } as Record<string, unknown>;
      expectLoadReject(doc);
    });
    it('scenes に null 要素があっても生 TypeError にせず読込拒否（#416 P1）', () => {
      const doc = { ...assembleProject(header(), [], [], []), scenes: [null] } as Record<string, unknown>;
      expectLoadReject(doc);
    });
    it('内容制約違反（companyName 空＝作りかけの新規）は拒否せず読み込む', () => {
      const doc = { ...assembleProject(header({ companyInfo: { companyName: '' } }), [], [], []) };
      expect(() => parseProjectDoc(JSON.stringify(doc))).not.toThrow();
    });
    it('内容制約違反（projectName 80字超＝#411 の入力防御対象）は拒否せず読み込む', () => {
      const doc = { ...assembleProject(header({ projectName: 'あ'.repeat(120) }), [], [], []) };
      expect(() => parseProjectDoc(JSON.stringify(doc))).not.toThrow();
    });
    it('正常な完全プロジェクトは読み込める（回帰なし）', () => {
      const doc = { ...assembleProject(header(), [], [{ partId: 'part_001', title: 'p', order: 1, sceneIds: ['scene_001'] } as unknown as Part], [validScene() as unknown as Scene]) };
      expect(() => parseProjectDoc(JSON.stringify(doc))).not.toThrow();
    });
  });
});

describe('isSupportedSchemaVersion', () => {
  it('1.x は対応・2.0 は非対応', () => {
    expect(isSupportedSchemaVersion('1.0')).toBe(true);
    expect(isSupportedSchemaVersion('1.5')).toBe(true);
    expect(isSupportedSchemaVersion('2.0')).toBe(false);
  });
});
