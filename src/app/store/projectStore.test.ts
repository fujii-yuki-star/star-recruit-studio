import { beforeEach, describe, expect, it } from 'vitest';
import { useProjectStore } from './projectStore';
import { sampleTemplates } from '../../infrastructure/sampleData';
import type { Scene } from '../../domain/project/types';

function scene(id: string, order: number, partId = 'part_001'): Scene {
  return {
    sceneId: id,
    partId,
    order,
    sceneType: 'photo_intro',
    templateId: 'photo_left_text_right_yuko_v1',
    durationSec: 8,
    assetRefs: {},
    character: { enabled: false, characterId: 'yuko' },
    texts: {},
    narration: { text: '', status: 'none' },
    warnings: [],
  };
}

describe('projectStore addScene / removeScene', () => {
  beforeEach(() => {
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: 'part_001', title: 'パート1', order: 1, sceneIds: ['scene_001', 'scene_002'] }],
      scenes: [scene('scene_001', 1), scene('scene_002', 2)],
      saveStatus: 'saved',
    });
  });

  it('addScene は末尾パートに既定テンプレの場面を追加し、新IDを返す', () => {
    const id = useProjectStore.getState().addScene();
    const st = useProjectStore.getState();
    expect(id).toBe('scene_003');
    expect(st.scenes).toHaveLength(3);
    expect(st.scenes[2].sceneId).toBe('scene_003');
    expect(st.scenes[2].partId).toBe('part_001');
    expect(st.scenes[2].order).toBe(3);
    expect(st.scenes[2].templateId).toBe(sampleTemplates[0].templateId);
    expect(st.parts[0].sceneIds).toContain('scene_003');
    expect(st.saveStatus).toBe('idle'); // 変更で未保存に戻る
  });

  it('removeScene は削除し order を 1..N に振り直す（パートからも除く）', () => {
    useProjectStore.getState().removeScene('scene_001');
    const st = useProjectStore.getState();
    expect(st.scenes.map((s) => s.sceneId)).toEqual(['scene_002']);
    expect(st.scenes[0].order).toBe(1); // 再採番
    expect(st.parts[0].sceneIds).toEqual(['scene_002']);
    expect(st.saveStatus).toBe('idle');
  });

  it('removeScene 後に addScene すると歯抜けを避けた新IDを採る', () => {
    const store = useProjectStore.getState();
    store.removeScene('scene_001'); // 残: scene_002
    const id = useProjectStore.getState().addScene();
    expect(id).toBe('scene_001'); // 最小の空き番号
    expect(useProjectStore.getState().scenes.map((s) => s.order)).toEqual([1, 2]);
  });
});
