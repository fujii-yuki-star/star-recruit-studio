import { describe, expect, it } from 'vitest';
import type { Orientation, SceneCategory } from '../enums';
import type { Scene } from './types';
import type { Template } from '../template/types';
import { changeScenesOrientation } from './orientationOps';

function tpl(templateId: string, category: SceneCategory, aspectRatio: Orientation): Template {
  return {
    schemaVersion: '1.0',
    templateId,
    name: templateId,
    category,
    aspectRatio,
    canvas: aspectRatio === '9:16' ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 },
    layers: [{ id: 'background', type: 'background', x: 0, y: 0, w: 100, h: 100 }],
  };
}

// 16:9 は opening/photo_intro、9:16 は opening/photo_intro/closing を用意（横型は一部カテゴリのみ＝ADR-0012）。
const templates: Template[] = [
  tpl('opening_16', 'opening', '16:9'),
  tpl('photo_16', 'photo_intro', '16:9'),
  tpl('opening_9', 'opening', '9:16'),
  tpl('photo_9', 'photo_intro', '9:16'),
  tpl('closing_9', 'closing', '9:16'),
];

function scene(sceneId: string, sceneType: SceneCategory, templateId: string, assetRefs: Scene['assetRefs'] = {}): Scene {
  return {
    sceneId,
    partId: 'part_001',
    order: 1,
    sceneType,
    templateId,
    durationSec: 8,
    assetRefs,
    character: { enabled: false, characterId: 'yuko', poseAssetId: null },
    texts: { title: 'タイトル' },
    narration: { text: 'セリフ', status: 'none', voiceId: null, speed: null, pitch: null, intonation: null, voicePath: null },
    warnings: [],
  };
}

describe('changeScenesOrientation（向き変更・B5-b）', () => {
  it('16:9 プロジェクトを縦型へ：全場面が同カテゴリの縦型テンプレへ写像される', () => {
    const scenes = [scene('scene_001', 'opening', 'opening_16'), scene('scene_002', 'photo_intro', 'photo_16')];
    const r = changeScenesOrientation(scenes, templates, '9:16');
    expect(r.scenes.map((s) => s.templateId)).toEqual(['opening_9', 'photo_9']);
    expect(r.changed).toBe(2);
    expect(r.unsupported).toBe(0);
  });

  it('縦→横で変換先が無いカテゴリは原状維持し unsupported に数える', () => {
    const scenes = [scene('scene_001', 'opening', 'opening_9'), scene('scene_002', 'closing', 'closing_9')];
    const r = changeScenesOrientation(scenes, templates, '16:9');
    // opening は 16:9 あり→写像、closing は 16:9 無し→原状維持。
    expect(r.scenes.map((s) => s.templateId)).toEqual(['opening_16', 'closing_9']);
    expect(r.changed).toBe(1);
    expect(r.unsupported).toBe(1);
  });

  it('既に目標向きの場面は変更しない（changed=0・同一参照を保つ）', () => {
    const scenes = [scene('scene_001', 'opening', 'opening_16')];
    const r = changeScenesOrientation(scenes, templates, '16:9');
    expect(r.changed).toBe(0);
    expect(r.unsupported).toBe(0);
    expect(r.scenes[0]).toBe(scenes[0]); // 参照不変
  });

  it('assetRefs・テキスト・セリフは保持される（再フィットは描画側）', () => {
    const refs = { background: 'asset_bg_001', logo: 'asset_logo_001' };
    const scenes = [scene('scene_001', 'opening', 'opening_16', refs)];
    const r = changeScenesOrientation(scenes, templates, '9:16');
    expect(r.scenes[0].templateId).toBe('opening_9');
    expect(r.scenes[0].assetRefs).toEqual(refs);
    expect(r.scenes[0].texts).toEqual({ title: 'タイトル' });
    expect(r.scenes[0].narration.text).toBe('セリフ');
  });
});
