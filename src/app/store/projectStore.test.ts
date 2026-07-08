import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isExportBusy, useProjectStore } from './projectStore';
import * as fsMod from '../../infrastructure/projectFs';
import * as aiClient from '../../infrastructure/aiClient';
import { assembleProject } from '../../domain/project/persistence';
import { sampleTemplates } from '../../infrastructure/sampleData';
import { MockVoiceProvider } from '../../infrastructure/voiceProviders/mockVoiceProvider';
import { MockAiProvider } from '../../infrastructure/aiProviders/mockAiProvider';
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
      exportRun: { phase: 'idle', progress: { done: 0, total: 0 }, resultPath: '', message: '', bgmWarning: '', cancelling: false },
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

  it('開いているプロジェクトを削除したら編集状態を新規化する（自動保存での復活防止・#383）', async () => {
    const delSpy = vi.spyOn(fsMod, 'deleteProjectDoc').mockResolvedValue();
    // proj_open を開いている状態（beforeEach で projectId=proj_open・場面1つ）
    expect(useProjectStore.getState().meta.projectId).toBe('proj_open');
    await useProjectStore.getState().deleteProject('proj_open');
    expect(delSpy).toHaveBeenCalledWith('proj_open');
    // 開いていた文書は新規化される＝以後の自動保存が同じ id を書き戻さない。
    expect(useProjectStore.getState().meta.projectId).toBe('');
    expect(useProjectStore.getState().scenes).toHaveLength(0);
    delSpy.mockRestore();
  });

  it('開いていない別プロジェクトの削除では編集状態を触らない（#383）', async () => {
    const delSpy = vi.spyOn(fsMod, 'deleteProjectDoc').mockResolvedValue();
    await useProjectStore.getState().deleteProject('proj_other'); // 開いているのは proj_open
    expect(useProjectStore.getState().meta.projectId).toBe('proj_open'); // 変わらない
    expect(useProjectStore.getState().scenes).toHaveLength(1); // 場面も残る
    delSpy.mockRestore();
  });

  it('newProject は完了時に exportRun を idle へ戻す（前の結果を持ち越さない）', () => {
    useProjectStore.getState().setExportRun({ phase: 'done', resultPath: 'C:/out.mp4' });
    useProjectStore.getState().newProject(); // idle 中なので実行される
    expect(useProjectStore.getState().exportRun.phase).toBe('idle');
    expect(useProjectStore.getState().exportRun.resultPath).toBe('');
  });

  it('newProject の会社情報は空＝デモ会社を既定にしない（#414・§2-6）', () => {
    useProjectStore.getState().setExportRun({ phase: 'idle' }); // ガードを外す
    useProjectStore.getState().newProject();
    const ci = useProjectStore.getState().meta.companyInfo;
    expect(ci?.companyName).toBe(''); // 「株式会社サンプル」等を入れない
    expect(ci?.industry ?? '').toBe('');
    expect(ci?.strengths ?? []).toEqual([]);
  });

  it('wizardStep は setWizardStep で保持し、newProject で 0 に戻る（#401）', () => {
    useProjectStore.getState().setExportRun({ phase: 'idle' });
    useProjectStore.getState().setWizardStep(3);
    expect(useProjectStore.getState().wizardStep).toBe(3); // 離脱/復帰でステップを復元するため保持
    useProjectStore.getState().newProject();
    expect(useProjectStore.getState().wizardStep).toBe(0); // 新規＝先頭ステップから
  });

  it('書き出し中は loadProject が no-op（loadProjectDoc に到達しない）／idle では読み込み成功＋exportRun リセット', async () => {
    // アプリ自身の直列化で正当な最小プロジェクト JSON を用意（parseProjectDoc/migrate を確実に通す）。
    const validDoc = JSON.stringify(assembleProject(useProjectStore.getState().meta, [], [], []));
    const loadSpy = vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(validDoc);
    const setLastSpy = vi.spyOn(fsMod, 'setLastProjectId').mockImplementation(() => {});

    // 書き出し中：早期 return で loadProjectDoc に到達しない＝切り替えをブロック。
    useProjectStore.getState().setExportRun({ phase: 'rendering' });
    await useProjectStore.getState().loadProject('proj_any');
    expect(loadSpy).not.toHaveBeenCalled();

    // idle（done は非busy）：読み込み成功し、前の結果を持ち越さず exportRun が idle にリセットされる。
    useProjectStore.setState({
      exportRun: { phase: 'done', progress: { done: 0, total: 0 }, resultPath: 'C:/out.mp4', message: '', bgmWarning: '', cancelling: false },
    });
    await useProjectStore.getState().loadProject('proj_any');
    expect(loadSpy).toHaveBeenCalledWith('proj_any');
    expect(useProjectStore.getState().exportRun.phase).toBe('idle');
    expect(useProjectStore.getState().exportRun.resultPath).toBe('');

    loadSpy.mockRestore();
    setLastSpy.mockRestore();
  });
});

describe('projectStore autoGenerateIfSafe（#384・§2-6：自動生成が送信前確認を迂回しない）', () => {
  const realGenerate = useProjectStore.getState().generate;
  afterEach(() => {
    useProjectStore.setState({ generate: realGenerate }); // 上書きした generate を戻す
  });

  it('外部送信になる構成（実プロバイダ）では自動生成しない＝送信前確認を迂回しない', async () => {
    const genSpy = vi.fn(async () => {});
    useProjectStore.setState({ status: 'idle', generate: genSpy });
    const willSpy = vi.spyOn(aiClient, 'willSendExternally').mockResolvedValue(true);
    await useProjectStore.getState().autoGenerateIfSafe();
    expect(genSpy).not.toHaveBeenCalled(); // 端末外へ送らない
    willSpy.mockRestore();
  });

  it('外部送信にならない（Mock）かつ idle なら自動生成する（直接landの利便性は維持）', async () => {
    const genSpy = vi.fn(async () => {});
    useProjectStore.setState({ status: 'idle', generate: genSpy });
    const willSpy = vi.spyOn(aiClient, 'willSendExternally').mockResolvedValue(false);
    await useProjectStore.getState().autoGenerateIfSafe();
    expect(genSpy).toHaveBeenCalledTimes(1);
    willSpy.mockRestore();
  });

  it('既に生成済み/生成中（status !== idle）なら Mock でも自動生成しない', async () => {
    const genSpy = vi.fn(async () => {});
    useProjectStore.setState({ status: 'ready', generate: genSpy });
    const willSpy = vi.spyOn(aiClient, 'willSendExternally').mockResolvedValue(false);
    await useProjectStore.getState().autoGenerateIfSafe();
    expect(genSpy).not.toHaveBeenCalled();
    willSpy.mockRestore();
  });

  it('外部送信判定が失敗（鍵ストアにアクセス不能等）したら fail-closed で自動生成しない＋reject しない（#384 レビュー）', async () => {
    const genSpy = vi.fn(async () => {});
    useProjectStore.setState({ status: 'idle', generate: genSpy });
    const willSpy = vi.spyOn(aiClient, 'willSendExternally').mockRejectedValue(new Error('keyring fail'));
    // unhandled rejection にせず正常終了する（void 呼び出しでも安全）。
    await expect(useProjectStore.getState().autoGenerateIfSafe()).resolves.toBeUndefined();
    // 判定不能→送らない（§2-6 厳守）。素通りして generate() を呼ばない＝再判定成功時の自動送信も起きない。
    expect(genSpy).not.toHaveBeenCalled();
    willSpy.mockRestore();
  });
});

describe('projectStore newBlankProject（白紙から作る・#393）', () => {
  const realGenerate = useProjectStore.getState().generate;
  afterEach(() => {
    useProjectStore.setState({ generate: realGenerate });
  });

  it('空プロジェクトにし、status を ready にする（idle にしない）', () => {
    useProjectStore.setState({
      status: 'idle',
      scenes: [{ sceneId: 'scene_001' } as never],
      parts: [{ partId: 'part_001', title: 'P', order: 1, sceneIds: ['scene_001'] } as never],
    });
    useProjectStore.getState().newBlankProject();
    const st = useProjectStore.getState();
    expect(st.scenes).toEqual([]);
    expect(st.parts).toEqual([]);
    expect(st.status).toBe('ready'); // idle にしない＝マウント時の自動生成を発火させない
  });

  it('白紙化の後は autoGenerateIfSafe が生成しない（Mock でも status!==idle）＝AI 送信を誘発しない（§2-6）', async () => {
    useProjectStore.getState().newBlankProject();
    const genSpy = vi.fn(async () => {});
    useProjectStore.setState({ generate: genSpy });
    const willSpy = vi.spyOn(aiClient, 'willSendExternally').mockResolvedValue(false); // Mock（送信なし）でも
    await useProjectStore.getState().autoGenerateIfSafe();
    expect(genSpy).not.toHaveBeenCalled();
    willSpy.mockRestore();
  });
});

describe('projectStore 生成のキャンセル（#402）', () => {
  beforeEach(() => {
    useProjectStore.setState({ templates: sampleTemplates });
  });

  it('cancelGeneration は世代を進め、下書きがあれば ready・無ければ idle に戻す', () => {
    useProjectStore.setState({ scenes: [scene('scene_001', 1)], status: 'generating', _generationSeq: 5 });
    useProjectStore.getState().cancelGeneration();
    expect(useProjectStore.getState()._generationSeq).toBe(6); // 世代を進めて in-flight を無効化
    expect(useProjectStore.getState().status).toBe('ready'); // 既存の下書きは残す
    useProjectStore.setState({ scenes: [], status: 'generating' });
    useProjectStore.getState().cancelGeneration();
    expect(useProjectStore.getState().status).toBe('idle'); // 下書きなし＝未生成へ
  });

  it('生成中にキャンセルすると、裏で完走しても場面を置き換えない（#402）', async () => {
    const existing = [scene('scene_001', 1)];
    useProjectStore.setState({ scenes: existing, parts: [], status: 'idle', _generationSeq: 0 });
    // generateVideoPlan（= MockAiProvider）を制御可能な保留 Promise にして、完了タイミングを操る。
    let resolvePlan: (v: unknown) => void = () => {};
    const planPromise = new Promise((r) => { resolvePlan = r; });
    const spy = vi.spyOn(MockAiProvider.prototype, 'generateVideoPlan').mockReturnValue(planPromise as never);

    const genP = useProjectStore.getState().generate(); // 開始（planPromise 待ちで止まる）
    expect(useProjectStore.getState().status).toBe('generating');

    useProjectStore.getState().cancelGeneration(); // ユーザーがキャンセル（世代が進む）
    resolvePlan({}); // 裏で生成が完走
    await genP;

    expect(useProjectStore.getState().scenes).toBe(existing); // 既存の下書きのまま＝置き換わらない
    expect(useProjectStore.getState().status).toBe('ready'); // cancel が設定した状態を維持（error にもならない）
    spy.mockRestore();
  });

  it('キャンセル後に再度 generate すると正常に反映される（世代が現行なら破棄しない）', async () => {
    useProjectStore.setState({ scenes: [], parts: [], status: 'idle', _generationSeq: 0 });
    const spy = vi.spyOn(MockAiProvider.prototype, 'generateVideoPlan');
    // 1回目：キャンセルで破棄
    useProjectStore.getState().cancelGeneration(); // seq を進めておく（前回のキャンセル相当）
    await useProjectStore.getState().generate(); // Mock は即解決＝現行世代で反映される
    expect(useProjectStore.getState().status).toBe('ready'); // 正常に生成される
    expect(useProjectStore.getState().scenes.length).toBeGreaterThan(0);
    spy.mockRestore();
  });

  it('キャンセルせず newProject しても、裏で完走した旧生成が新しい状態を上書きしない（#402 レビュー）', async () => {
    useProjectStore.setState({ scenes: [scene('scene_001', 1)], parts: [], status: 'idle', _generationSeq: 0, exportRun: { phase: 'idle', progress: { done: 0, total: 0 }, resultPath: '', message: '', bgmWarning: '', cancelling: false } });
    let resolvePlan: (v: unknown) => void = () => {};
    const planPromise = new Promise((r) => { resolvePlan = r; });
    const spy = vi.spyOn(MockAiProvider.prototype, 'generateVideoPlan').mockReturnValue(planPromise as never);

    const genP = useProjectStore.getState().generate(); // 生成開始（保留）
    expect(useProjectStore.getState().status).toBe('generating');
    // キャンセルを押さずにホーム経由で新規作成（newProject も世代を進める）
    useProjectStore.getState().newProject();
    expect(useProjectStore.getState().scenes).toHaveLength(0); // 新規＝空

    resolvePlan({}); // 旧生成が裏で完走
    await genP;
    // 新規プロジェクトの空状態が旧生成結果で上書きされない。
    expect(useProjectStore.getState().scenes).toHaveLength(0);
    expect(useProjectStore.getState().status).toBe('idle'); // newProject の状態のまま（ready にならない）
    spy.mockRestore();
  });
});

describe('projectStore プロジェクト名の入力防御（80字上限・#411／#416 と対）', () => {
  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: 'idle' });
    useProjectStore.getState().newProject();
  });

  it('setProjectName は 80字超を切り詰めて保持する（schema の projectName maxLength と一致＝不正な保存を作らない）', () => {
    useProjectStore.getState().setProjectName('あ'.repeat(120));
    expect(useProjectStore.getState().meta.projectName).toHaveLength(80);
  });

  it('80字以内はそのまま保持する', () => {
    useProjectStore.getState().setProjectName('短いプロジェクト名');
    expect(useProjectStore.getState().meta.projectName).toBe('短いプロジェクト名');
  });
});
