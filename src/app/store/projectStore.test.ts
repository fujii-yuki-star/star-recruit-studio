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

  it('編集系アクションは saveStatus を "idle" に戻す（編集＝未保存）', () => {
    const reset = (fn: () => void) => {
      useProjectStore.setState({ saveStatus: 'saved' });
      fn();
      expect(useProjectStore.getState().saveStatus).toBe('idle');
    };
    const s = useProjectStore.getState();
    reset(() => s.updateScene('scene_001', (sc) => ({ ...sc, durationSec: 10 })));
    reset(() => s.updateAsset('asset_x', (a) => a)); // 対象なしでも set は走り idle に
    reset(() => s.removeAsset('asset_x'));
    reset(() => s.updateVoiceSettings({ speed: 1.1 }));
    reset(() => s.updateBgmSettings({ volume: 0.3 }));
  });

  it('applyProjectInfo は meta の purpose/companyInfo を更新し saveStatus を idle に', () => {
    useProjectStore.setState({ saveStatus: 'saved' });
    useProjectStore
      .getState()
      .applyProjectInfo({ purpose: 'engineer', companyInfo: { companyName: 'A社', industry: 'IT' } });
    const m = useProjectStore.getState().meta;
    expect(m.purpose).toBe('engineer');
    expect(m.companyInfo).toEqual({ companyName: 'A社', industry: 'IT' });
    expect(useProjectStore.getState().saveStatus).toBe('idle');
  });
});

describe('projectStore generateNarration 再入ガード', () => {
  it('全場面生成中（isGeneratingNarration）は個別呼び出しを弾く（fromBulk 無し）', async () => {
    useProjectStore.setState({
      scenes: [{ ...scene('scene_001', 1), narration: { text: 'こんにちは', status: 'none' } }],
      isGeneratingNarration: true,
    });
    await useProjectStore.getState().generateNarration('scene_001');
    // ガードで早期 return＝pending にも遷移しない（合成は走らない）。
    expect(useProjectStore.getState().scenes[0].narration.status).toBe('none');
  });

  it('既に pending の場面は二重起動しない', async () => {
    useProjectStore.setState({
      scenes: [{ ...scene('scene_001', 1), narration: { text: 'こんにちは', status: 'pending' } }],
      isGeneratingNarration: false,
    });
    await useProjectStore.getState().generateNarration('scene_001');
    expect(useProjectStore.getState().scenes[0].narration.status).toBe('pending'); // 変化しない
  });
});

describe('projectStore generateNarration 掛け合い（行ごと・ADR-0015 PR-C2）', () => {
  it('明示 lines は行ごとに合成し、各行 generated＋行キー(sceneId/lineId)で音声を持つ', async () => {
    useProjectStore.setState({
      scenes: [{
        ...scene('scene_001', 1),
        lines: [
          { lineId: 'line_001', text: 'やあ', speaker: 3, status: 'none' },
          { lineId: 'line_002', text: 'どうも', speaker: 2, status: 'none' },
        ],
      }],
      narrationAudioById: {},
      isGeneratingNarration: false,
    });
    await useProjectStore.getState().generateNarration('scene_001');
    const st = useProjectStore.getState();
    expect(st.scenes[0].lines?.map((l) => l.status)).toEqual(['generated', 'generated']);
    expect(st.narrationAudioById['scene_001/line_001']).toBeTruthy();
    expect(st.narrationAudioById['scene_001/line_002']).toBeTruthy();
  });

  it('fromBulk は生成済み行を再合成しない（🔴1：生成済みは据え置き・音声を作らない）', async () => {
    useProjectStore.setState({
      scenes: [{
        ...scene('scene_001', 1),
        lines: [
          { lineId: 'line_001', text: 'やあ', status: 'generated' },
          { lineId: 'line_002', text: 'どうも', status: 'none' },
        ],
      }],
      narrationAudioById: {},
      isGeneratingNarration: false,
    });
    await useProjectStore.getState().generateNarration('scene_001', { fromBulk: true });
    const st = useProjectStore.getState();
    expect(st.scenes[0].lines?.map((l) => l.status)).toEqual(['generated', 'generated']);
    // 生成済みの line_001 は対象外＝音声は作られない。未生成の line_002 のみ合成される。
    expect(st.narrationAudioById['scene_001/line_001']).toBeUndefined();
    expect(st.narrationAudioById['scene_001/line_002']).toBeTruthy();
  });
});
