import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isExportBusy, useProjectStore } from './projectStore';
import * as fsMod from '../../infrastructure/projectFs';
import { sampleTemplates } from '../../infrastructure/sampleData';
import { MockVoiceProvider } from '../../infrastructure/voiceProviders/mockVoiceProvider';
import type { Scene } from '../../domain/project/types';
import type { Template } from '../../domain/template/types';

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

  it('途中エラーでも先行 generated 行とその音声は保持し、pending 行だけ failed（🔴2）', async () => {
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
    // 1行目は成功・2行目で失敗させる（mid-sequence エラー）。
    const spy = vi.spyOn(MockVoiceProvider.prototype, 'synthesize')
      .mockResolvedValueOnce({ audioDataUrl: 'data:audio/wav;base64,AAAA', durationSec: 1 })
      .mockRejectedValueOnce('合成エラー');
    await useProjectStore.getState().generateNarration('scene_001');
    const st = useProjectStore.getState();
    expect(st.scenes[0].lines?.[0].status).toBe('generated'); // 先行成功は保持（🔴2）
    expect(st.scenes[0].lines?.[1].status).toBe('failed');
    expect(st.narrationAudioById['scene_001/line_001']).toBeTruthy(); // 音声も保持
    expect(useProjectStore.getState().narrationError).toBeTruthy();
    spy.mockRestore();
  });
});

describe('projectStore overlay クリップ（ADR-0018・③(4)）', () => {
  beforeEach(() => {
    useProjectStore.setState({
      meta: { ...useProjectStore.getState().meta, timelineOverlay: undefined },
      past: [], future: [], _historyGroupDepth: 0, saveStatus: 'saved',
    });
  });
  it('addOverlayClip は telop クリップを追加し id を返す（既定 track/尺・未保存に戻る）', () => {
    const id = useProjectStore.getState().addOverlayClip({ anchorSceneId: 'scene_001', text: 'やあ' });
    const clips = useProjectStore.getState().meta.timelineOverlay?.clips ?? [];
    expect(id).toBe('ovclip_001');
    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({ id: 'ovclip_001', track: 'telop', anchorSceneId: 'scene_001', text: 'やあ', startSec: 0, durationSec: 3 });
    expect(useProjectStore.getState().saveStatus).toBe('idle');
  });
  it('updateOverlayClip は該当クリップを部分更新する', () => {
    const id = useProjectStore.getState().addOverlayClip({ text: 'a' });
    useProjectStore.getState().updateOverlayClip(id, { startSec: 4, text: 'b' });
    expect(useProjectStore.getState().meta.timelineOverlay?.clips?.[0]).toMatchObject({ id, startSec: 4, text: 'b' });
  });
  it('removeOverlayClip はクリップを削除する', () => {
    const id = useProjectStore.getState().addOverlayClip({});
    useProjectStore.getState().removeOverlayClip(id);
    expect(useProjectStore.getState().meta.timelineOverlay?.clips).toEqual([]);
  });
  it('overlay 編集は Undo で戻る（meta スナップショット・ADR-0020）', () => {
    const id = useProjectStore.getState().addOverlayClip({ text: 'x' });
    useProjectStore.getState().updateOverlayClip(id, { text: 'y' });
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().meta.timelineOverlay?.clips?.[0].text).toBe('x');
  });
});

describe('projectStore 要素アニメーション（④・ADR-0019 (1c)）', () => {
  beforeEach(() => {
    useProjectStore.setState({
      meta: { ...useProjectStore.getState().meta, timelineOverlay: undefined },
      past: [], future: [], _historyGroupDepth: 0, saveStatus: 'saved',
    });
  });
  const fadeKfs = [{ timeSec: 0, opacity: 0 }, { timeSec: 0.6, opacity: 1 }];
  it('addAnimation は anim を追加し id を返す（sceneId/targetId/keyframes・未保存に戻る）', () => {
    const id = useProjectStore.getState().addAnimation('scene_001', 'free_001', fadeKfs);
    const anims = useProjectStore.getState().meta.timelineOverlay?.animations ?? [];
    expect(id).toBe('anim_001');
    expect(anims).toHaveLength(1);
    expect(anims[0]).toMatchObject({ id: 'anim_001', sceneId: 'scene_001', targetId: 'free_001', keyframes: fadeKfs });
    expect(useProjectStore.getState().saveStatus).toBe('idle');
  });
  it('updateAnimation はキーフレームを差し替える（所要秒変更）', () => {
    const id = useProjectStore.getState().addAnimation('scene_001', 'free_001', fadeKfs);
    const next = [{ timeSec: 0, opacity: 0 }, { timeSec: 1.5, opacity: 1 }];
    useProjectStore.getState().updateAnimation(id, next);
    expect(useProjectStore.getState().meta.timelineOverlay?.animations?.[0].keyframes).toEqual(next);
  });
  it('removeAnimation は該当アニメを削除する（動きをやめる）', () => {
    const id = useProjectStore.getState().addAnimation('scene_001', 'free_001', fadeKfs);
    useProjectStore.getState().removeAnimation(id);
    expect(useProjectStore.getState().meta.timelineOverlay?.animations).toEqual([]);
  });
  it('アニメ編集は Undo で戻る（meta スナップショット・ADR-0020）', () => {
    const id = useProjectStore.getState().addAnimation('scene_001', 'free_001', fadeKfs);
    useProjectStore.getState().removeAnimation(id);
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().meta.timelineOverlay?.animations).toHaveLength(1);
  });
  it('clips と animations は同じ timelineOverlay に共存できる', () => {
    useProjectStore.getState().addOverlayClip({ text: 'telop' });
    useProjectStore.getState().addAnimation('scene_001', 'free_001', fadeKfs);
    const ov = useProjectStore.getState().meta.timelineOverlay;
    expect(ov?.clips).toHaveLength(1);
    expect(ov?.animations).toHaveLength(1);
  });
});

describe('projectStore アニメの場面複製/分割引き継ぎ・孤児掃除（④・ADR-0019 レビュー対応）', () => {
  const fadeKfs = [{ timeSec: 0, opacity: 0 }, { timeSec: 0.6, opacity: 1 }];
  beforeEach(() => {
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: 'part_001', title: 'p', order: 1, sceneIds: ['scene_001'] }],
      scenes: [{ ...scene('scene_001', 1), durationSec: 8, narration: { text: 'あいうえお。かきくけこ。', status: 'none' } } as Scene],
      meta: {
        ...useProjectStore.getState().meta,
        timelineOverlay: { animations: [{ id: 'anim_001', sceneId: 'scene_001', targetId: 'free_001', keyframes: fadeKfs }] },
      },
      past: [], future: [], _historyGroupDepth: 0, saveStatus: 'saved',
    });
  });
  it('duplicateScene は元場面のアニメを新場面へ複製（新id・sceneId 差し替え・targetId 保持）', () => {
    const newId = useProjectStore.getState().duplicateScene('scene_001');
    const anims = useProjectStore.getState().meta.timelineOverlay?.animations ?? [];
    expect(anims).toHaveLength(2);
    expect(anims.find((a) => a.sceneId === newId)).toMatchObject({ id: 'anim_002', targetId: 'free_001' });
  });
  it('splitScene は後半場面（新id）へもアニメを引き継ぐ', () => {
    const newId = useProjectStore.getState().splitScene('scene_001', 6);
    expect(newId).not.toBe(''); // 分割成立
    const anims = useProjectStore.getState().meta.timelineOverlay?.animations ?? [];
    expect(anims.some((a) => a.sceneId === newId && a.targetId === 'free_001')).toBe(true);
  });
  it('removeAnimationsForElements は該当要素のアニメを掃除（対象なしは no-op）', () => {
    useProjectStore.getState().removeAnimationsForElements('scene_001', ['free_999']);
    expect(useProjectStore.getState().meta.timelineOverlay?.animations).toHaveLength(1); // 対象なし＝不変
    useProjectStore.getState().removeAnimationsForElements('scene_001', ['free_001']);
    expect(useProjectStore.getState().meta.timelineOverlay?.animations).toEqual([]);
  });
});

describe('projectStore テンプレ既定素材（ADR-0021）', () => {
  const userTmpl = (templateId: string, assetId?: string): Template => ({
    schemaVersion: '1.0', templateId, name: templateId, category: 'opening', aspectRatio: '16:9',
    canvas: { width: 1920, height: 1080 },
    layers: [{ id: 'background', type: 'background', x: 0, y: 0, w: 1920, h: 1080, ...(assetId ? { assetId } : {}) }],
  });

  it('deleteUserTemplate はテンプレ削除時に所有素材の表示用src も掃除する（無関係な素材は残す）', async () => {
    useProjectStore.setState({
      templates: [...sampleTemplates, userTmpl('user_tmpl_001', 'tmpl_asset_001')],
      templateAssetSrcById: { tmpl_asset_001: 'data:image/png;base64,AAA', tmpl_asset_002: 'data:image/png;base64,BBB' },
    });
    const ok = await useProjectStore.getState().deleteUserTemplate('user_tmpl_001');
    const st = useProjectStore.getState();
    expect(ok).toBe(true);
    expect(st.templates.some((t) => t.templateId === 'user_tmpl_001')).toBe(false);
    expect(st.templateAssetSrcById).toEqual({ tmpl_asset_002: 'data:image/png;base64,BBB' }); // 所有のみ掃除
  });

  it('registerTemplateAsset は非 Tauri で null（表示用src も変えない）', async () => {
    useProjectStore.setState({ templateAssetSrcById: {} });
    const id = await useProjectStore.getState().registerTemplateAsset({} as File);
    expect(id).toBeNull();
    expect(useProjectStore.getState().templateAssetSrcById).toEqual({});
  });
});

describe('projectStore editingSceneId（#400・場面編集の遷移ペイロード）', () => {
  it('setEditingSceneId で場面 id を保持し、null でクリアできる（既定は null）', () => {
    useProjectStore.setState({ editingSceneId: null });
    expect(useProjectStore.getState().editingSceneId).toBeNull(); // 既定＝先頭場面フォールバック
    useProjectStore.getState().setEditingSceneId('scene_007');
    expect(useProjectStore.getState().editingSceneId).toBe('scene_007'); // 遷移元が指定した場面
    useProjectStore.getState().setEditingSceneId(null);
    expect(useProjectStore.getState().editingSceneId).toBeNull();
  });

  it('一度きりのペイロード：消費（読み取り→破棄）後は残留せず、次の未指定遷移で先頭場面に落ちる（#400 レビュー）', () => {
    // 遷移元が場面7を指定
    useProjectStore.getState().setEditingSceneId('scene_007');
    // SceneEditScreen マウント相当：初期化子で読み、直後に破棄する（consume-once）
    const consumed = useProjectStore.getState().editingSceneId;
    useProjectStore.getState().setEditingSceneId(null);
    expect(consumed).toBe('scene_007'); // 捕捉できている
    // 破棄後、editingSceneId を set しない別導線（主要CTA・タイムライン等）で再度開く相当
    expect(useProjectStore.getState().editingSceneId).toBeNull(); // 残留しない＝初期化子は "" → 先頭場面へ
  });
});

describe('projectStore 書き出し中の破壊操作ガード（#379）', () => {
  beforeEach(() => {
    useProjectStore.setState({
      meta: { ...useProjectStore.getState().meta, projectId: 'proj_open' },
      scenes: [scene('scene_001', 1)],
      exportRun: { phase: 'idle', progress: { done: 0, total: 0 }, resultPath: '', message: '', bgmWarning: '' },
    });
  });

  it('isExportBusy は rendering/encoding のみ真', () => {
    expect(isExportBusy('idle')).toBe(false);
    expect(isExportBusy('rendering')).toBe(true);
    expect(isExportBusy('encoding')).toBe(true);
    expect(isExportBusy('done')).toBe(false);
    expect(isExportBusy('error')).toBe(false);
  });

  it('書き出し中は newProject が no-op（場面を破壊しない）／idle では実行される', () => {
    useProjectStore.getState().setExportRun({ phase: 'encoding' });
    useProjectStore.getState().newProject();
    expect(useProjectStore.getState().scenes).toHaveLength(1); // 破壊されない
    // idle に戻せば通常どおり新規化（場面クリア）
    useProjectStore.getState().setExportRun({ phase: 'idle' });
    useProjectStore.getState().newProject();
    expect(useProjectStore.getState().scenes).toHaveLength(0);
  });

  it('書き出し中は「開いているプロジェクト」の削除を弾く／別プロジェクトの削除は許可', async () => {
    useProjectStore.getState().setExportRun({ phase: 'rendering' });
    const spy = vi.spyOn(fsMod, 'deleteProjectDoc').mockResolvedValue();
    await useProjectStore.getState().deleteProject('proj_open'); // 開いている＝書き出し対象
    expect(spy).not.toHaveBeenCalled(); // ディスク削除まで到達しない
    await useProjectStore.getState().deleteProject('proj_other'); // 別プロジェクトは安全＝許可
    expect(spy).toHaveBeenCalledWith('proj_other');
    spy.mockRestore();
  });

  it('newProject/loadProject は完了時に exportRun を idle へ戻す（前の結果を持ち越さない）', () => {
    useProjectStore.getState().setExportRun({ phase: 'done', resultPath: 'C:/out.mp4' });
    useProjectStore.getState().newProject(); // idle 中なので実行される
    expect(useProjectStore.getState().exportRun.phase).toBe('idle');
    expect(useProjectStore.getState().exportRun.resultPath).toBe('');
  });
});
