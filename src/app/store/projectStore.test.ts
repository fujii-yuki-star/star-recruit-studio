import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isExportBusy, useProjectStore } from './projectStore';
import * as fsMod from '../../infrastructure/projectFs';
import * as assetFsMod from '../../infrastructure/assetFs';
import * as userTemplateFsMod from '../../infrastructure/userTemplateFs';
import * as aiClient from '../../infrastructure/aiClient';
import { assembleProject } from '../../domain/project/persistence';
import { sampleTemplates } from '../../infrastructure/sampleData';
import { MockVoiceProvider } from '../../infrastructure/voiceProviders/mockVoiceProvider';
import { MockAiProvider } from '../../infrastructure/aiProviders/mockAiProvider';
import type { Asset, Scene } from '../../domain/project/types';
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

  it('addScene は末尾パートに場面を追加し（見た目は末尾場面を引き継ぐ・#528）、新IDを返す', () => {
    const id = useProjectStore.getState().addScene();
    const st = useProjectStore.getState();
    expect(id).toBe('scene_003');
    expect(st.scenes).toHaveLength(3);
    expect(st.scenes[2].sceneId).toBe('scene_003');
    expect(st.scenes[2].partId).toBe('part_001');
    expect(st.scenes[2].order).toBe(3);
    // 末尾場面（scene_002＝photo_intro）の見た目を引き継ぐ＝先頭テンプレ（opening）固定にしない（#528）。
    expect(st.scenes[2].templateId).toBe('photo_left_text_right_yuko_v1');
    expect(st.scenes[2].sceneType).toBe('photo_intro');
    expect(st.parts[0].sceneIds).toContain('scene_003');
    expect(st.saveStatus).toBe('idle'); // 変更で未保存に戻る
  });

  it('場面が無いときの addScene は先頭テンプレを使う（#528 フォールバック）', () => {
    useProjectStore.setState({ scenes: [], parts: [] });
    useProjectStore.getState().addScene();
    const st = useProjectStore.getState();
    expect(st.scenes[0].templateId).toBe(sampleTemplates[0].templateId);
    expect(st.scenes[0].sceneType).toBe(sampleTemplates[0].category);
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

  it('deleteUserTemplate は参照中の場面を標準（同カテゴリ・同じ向き）へ置換し孤立参照を残さない（#458・§9）', async () => {
    const scene = {
      sceneId: 'scene_001', partId: 'part_001', order: 1, sceneType: 'opening', templateId: 'user_tmpl_001',
      durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: 'yuko' }, texts: {},
      narration: { text: '', status: 'none' }, warnings: [],
    } as unknown as Scene;
    const meta = useProjectStore.getState().meta;
    useProjectStore.setState({
      templates: [...sampleTemplates, userTmpl('user_tmpl_001')], // カテゴリ opening・16:9
      scenes: [scene],
      meta: { ...meta, videoSettings: { ...meta.videoSettings, aspectRatio: '16:9' } },
      saveStatus: 'saved',
    });
    const ok = await useProjectStore.getState().deleteUserTemplate('user_tmpl_001');
    const st = useProjectStore.getState();
    expect(ok).toBe(true);
    const newId = st.scenes[0].templateId;
    expect(newId).not.toBe('user_tmpl_001'); // 孤立参照を残さない
    const alt = st.templates.find((t) => t.templateId === newId);
    expect(alt?.category).toBe('opening'); // 同カテゴリ
    expect(alt?.aspectRatio).toBe('16:9'); // 同じ向き
    expect(st.saveStatus).toBe('idle'); // 置換＝未保存（保存で永続化）
  });

  it('registerTemplateAsset は非 Tauri で null（表示用src も変えない）', async () => {
    useProjectStore.setState({ templateAssetSrcById: {} });
    const id = await useProjectStore.getState().registerTemplateAsset({} as File);
    expect(id).toBeNull();
    expect(useProjectStore.getState().templateAssetSrcById).toEqual({});
  });

  // #570 P1 レビュー：書き出し中は見た目パターン（＝場面が使う templateId）とその既定素材を固定する。使用中テンプレを
  // 保存/削除すると MP4(開始時 snap の見た目) と 保存/仕上がり確認(新) が食い違う（15§4・ADR-0026④＝α-4 パリティ）。
  describe('書き出し中は見た目パターンを固定（#570 P1 レビュー）', () => {
    const BUSY = /書き出しが終わるまで/;
    afterEach(() => { useProjectStore.getState().setExportRun({ phase: 'idle' }); useProjectStore.setState({ isTemplateMutating: false }); });

    it('saveUserTemplate は書き出し中 no-op＋案内（一覧に反映しない）', async () => {
      useProjectStore.setState({ templates: [...sampleTemplates], templateError: null });
      useProjectStore.getState().setExportRun({ phase: 'rendering' });
      const before = useProjectStore.getState().templates.length;
      await useProjectStore.getState().saveUserTemplate(userTmpl('user_tmpl_099'));
      expect(useProjectStore.getState().templates).toHaveLength(before); // 追加されない
      expect(useProjectStore.getState().templateError).toMatch(BUSY);
    });

    it('deleteUserTemplate は書き出し中 no-op＋案内（使用中の場面を標準へ置換しない）／false を返す', async () => {
      useProjectStore.setState({
        templates: [...sampleTemplates, userTmpl('user_tmpl_001')],
        scenes: [{ ...scene('scene_001', 1), templateId: 'user_tmpl_001' }],
        templateError: null,
      });
      useProjectStore.getState().setExportRun({ phase: 'encoding' });
      const ok = await useProjectStore.getState().deleteUserTemplate('user_tmpl_001');
      expect(ok).toBe(false);
      expect(useProjectStore.getState().templates.some((t) => t.templateId === 'user_tmpl_001')).toBe(true); // 消えない
      expect(useProjectStore.getState().scenes[0].templateId).toBe('user_tmpl_001'); // 置換されない＝MP4 と一致
      expect(useProjectStore.getState().templateError).toMatch(BUSY);
    });

    it('registerTemplateAsset は書き出し中 no-op＋案内（null）', async () => {
      useProjectStore.setState({ templateAssetSrcById: {}, templateError: null });
      useProjectStore.getState().setExportRun({ phase: 'rendering' });
      const id = await useProjectStore.getState().registerTemplateAsset({} as File);
      expect(id).toBeNull();
      expect(useProjectStore.getState().templateError).toMatch(BUSY);
    });

    it('addTemplatePack（取り込みパック）も書き出し中 no-op＋案内（同 id 上書きを止める）', () => {
      useProjectStore.setState({ templates: [...sampleTemplates], templateError: null });
      useProjectStore.getState().setExportRun({ phase: 'rendering' });
      const before = useProjectStore.getState().templates.length;
      useProjectStore.getState().addTemplatePack([userTmpl('user_tmpl_pack_1')]);
      expect(useProjectStore.getState().templates).toHaveLength(before); // 追加/上書きしない
      expect(useProjectStore.getState().templateError).toMatch(BUSY);
    });

    // 非同期境界の排他（#570 P1 レビュー）：保存は最初の await 前に isTemplateMutating を立てる＝書き出し開始側がこれを
    // 見て止まる（isImporting と対称）。「保存を押す→完了前に書き出す」で MP4(旧)と一覧/保存(新)が食い違うのを防ぐ。
    it('saveUserTemplate は保存中 isTemplateMutating を立て、完了後に戻す（保存はファイル/一覧まで完走）', async () => {
      useProjectStore.setState({ templates: [...sampleTemplates], isTemplateMutating: false });
      useProjectStore.getState().setExportRun({ phase: 'idle' });
      let resolveSave: () => void = () => {};
      const spy = vi.spyOn(userTemplateFsMod, 'saveUserTemplate').mockReturnValue(new Promise<void>((r) => { resolveSave = () => r(); }));
      const p = useProjectStore.getState().saveUserTemplate(userTmpl('user_tmpl_flag'));
      expect(useProjectStore.getState().isTemplateMutating).toBe(true); // 保存中は排他が立つ＝ExportScreen がこれを見て止まる
      resolveSave();
      await p;
      expect(useProjectStore.getState().isTemplateMutating).toBe(false); // 完了で戻す
      expect(useProjectStore.getState().templates.some((t) => t.templateId === 'user_tmpl_flag')).toBe(true); // 一覧まで完走（中断しない）
      spy.mockRestore();
    });

    // 自己再入ガード（#570 レビュー・correctness）：進行中の見た目変更は1本だけ＝flag を真の相互排他に保つ。無いと2本目の
    // finally が先に flag を落とし、その隙に書き出しが割り込む（MP4(旧)・保存/画面(新)の食い違い＝#547 P2-1 が防ぎたい不整合）。
    it('保存中の二重 saveUserTemplate は2本目を捨てる（進行中は1本・flag は1本目に対応し続ける）', async () => {
      useProjectStore.setState({ templates: [...sampleTemplates], isTemplateMutating: false });
      useProjectStore.getState().setExportRun({ phase: 'idle' });
      let resolveSave: () => void = () => {};
      const spy = vi.spyOn(userTemplateFsMod, 'saveUserTemplate').mockReturnValue(new Promise<void>((r) => { resolveSave = () => r(); }));
      const p1 = useProjectStore.getState().saveUserTemplate(userTmpl('user_tmpl_a'));
      expect(useProjectStore.getState().isTemplateMutating).toBe(true); // 1本目が進行中
      await useProjectStore.getState().saveUserTemplate(userTmpl('user_tmpl_b')); // 2本目：進行中ゆえ即 return（await 前）
      expect(spy).toHaveBeenCalledTimes(1); // ファイル書き込みは1本目だけ＝2本目は素通りしない
      expect(useProjectStore.getState().isTemplateMutating).toBe(true); // 2本目の早期 return では flag を落とさない＝1本目に対応
      resolveSave();
      await p1;
      expect(useProjectStore.getState().isTemplateMutating).toBe(false); // 1本目の完了で戻る
      spy.mockRestore();
    });

    // finally の解除（#570 レビュー）：保存が失敗しても flag を戻す＝書き出しが永久にブロックされない。次の行動も出す（§2-5）。
    it('saveUserTemplate が失敗しても isTemplateMutating を戻し、案内を出す（finally）', async () => {
      useProjectStore.setState({ templates: [...sampleTemplates], isTemplateMutating: false, templateError: null });
      useProjectStore.getState().setExportRun({ phase: 'idle' });
      const spy = vi.spyOn(userTemplateFsMod, 'saveUserTemplate').mockRejectedValue(new Error('disk full'));
      await useProjectStore.getState().saveUserTemplate(userTmpl('user_tmpl_fail'));
      expect(useProjectStore.getState().isTemplateMutating).toBe(false); // 失敗でも finally で戻す
      expect(useProjectStore.getState().templateError).toMatch(/保存できませんでした/); // 次の行動（もう一度お試しください）
      expect(useProjectStore.getState().templates.some((t) => t.templateId === 'user_tmpl_fail')).toBe(false); // 失敗＝一覧に入らない
      spy.mockRestore();
    });
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

  it('書き出し中は undo が no-op＝進行中の書き出しが変わった scenes を読むのを防ぐ（#379/#413・全画面ショートカット化の追随）', () => {
    useProjectStore.setState({ past: [], future: [] }); // 履歴をクリアしてから1手だけ積む
    useProjectStore.getState().removeScene('scene_001'); // idle なので実行＝past に1手
    expect(useProjectStore.getState().scenes).toHaveLength(0);
    expect(useProjectStore.getState().past.length).toBe(1); // 戻せる状態
    // 書き出し中：undo を弾く（場面が復活しない＝進行中書き出しの scenes を変えない）。
    useProjectStore.getState().setExportRun({ phase: 'rendering' });
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().scenes).toHaveLength(0); // no-op
    expect(useProjectStore.getState().past.length).toBe(1); // 履歴も消費しない
    // idle に戻せば通常どおり undo で復活（ガードが idle を妨げない）。
    useProjectStore.getState().setExportRun({ phase: 'idle' });
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().scenes).toHaveLength(1);
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

  it('書き出し中は「開いているプロジェクト」の改名を弾く／別プロジェクトの改名は許可（project.json の lost-update 防止・#570 レビュー）', async () => {
    useProjectStore.getState().setExportRun({ phase: 'rendering' });
    const validDoc = JSON.stringify(assembleProject(useProjectStore.getState().meta, [], [], []));
    const load = vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(validDoc);
    const save = vi.spyOn(fsMod, 'saveProjectDoc').mockResolvedValue('proj_other/project.json');
    const beforeName = useProjectStore.getState().meta.projectName;
    await useProjectStore.getState().renameProject('proj_open', '新しい名前'); // 開いている＝書き出し中の保存と同一 project.json を取り合う
    expect(load).not.toHaveBeenCalled(); // read-modify-write に到達しない＝保存の更新を消さない
    expect(save).not.toHaveBeenCalled();
    expect(useProjectStore.getState().meta.projectName).toBe(beforeName); // 凍結中の meta も触らない
    await useProjectStore.getState().renameProject('proj_other', '別名'); // 開いていない別プロジェクトは書き出しと無関係＝許可
    expect(save).toHaveBeenCalledTimes(1);
    const [savedId, savedJson] = save.mock.calls[0];
    expect(savedId).toBe('proj_other');
    expect(JSON.parse(savedJson).projectName).toBe('別名'); // 許可側は新しい名前が実際に書き戻される（no-op でなく完走）
    load.mockRestore(); save.mockRestore();
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

// #547 P2-1：素材の追加/削除/差し替え/編集も書き出し中はブロックする（#379 の素材版・ADR-0026②）。プロジェクト切替
// (loadProject 等)は #379 でガード済みなのに素材編集だけ漏れていた。書き出しは素材リストをスナップショットして進むので
// 追加/削除/メタ編集は進行中の書き出しに波及しないが、画像/BGM の同一パス上書き（setAssetImage/setBgm）は書き出しが
// disk から読むファイルと競合しうる（実害）＝一貫して固定する。ガードは無言 no-op でなく案内(importError/bgmError)を出す
// ＝素材画面以外（場面編集/ウィザードも importError 表示）からの操作でも「押しても効かない」を避ける（ADR-0026④）。
describe('projectStore 書き出し中は素材編集を弾く（#547 P2-1・ADR-0026②）', () => {
  const asset = (id: string): Asset => ({ assetId: id, assetType: 'image', displayName: id, filePath: `assets/${id}.png` });
  const BUSY_MSG = /書き出しが終わるまで/; // ガードが出す案内（無言 no-op でない＝ADR-0026④）
  beforeEach(() => {
    useProjectStore.setState({
      meta: { ...useProjectStore.getState().meta, projectId: 'proj_open' },
      assets: [asset('asset_001')],
      assetSrcById: { asset_001: 'data:image/png;base64,x' },
      importError: null,
      exportRun: { phase: 'idle', progress: { done: 0, total: 0 }, resultPath: '', message: '', bgmWarning: '', cancelling: false },
    });
  });
  // 書き出し中フェーズを次の describe へ漏らさない（startBlank 等は #379 で exportRun ガード＝leak すると後続が no-op で落ちる）。
  afterEach(() => useProjectStore.getState().setExportRun({ phase: 'idle' }));

  it('書き出し中は removeAsset が no-op＋案内を出す／idle では消える', () => {
    useProjectStore.getState().setExportRun({ phase: 'rendering' });
    useProjectStore.getState().removeAsset('asset_001');
    expect(useProjectStore.getState().assets).toHaveLength(1); // no-op
    expect(useProjectStore.getState().assetSrcById.asset_001).toBeDefined(); // src も落とさない
    expect(useProjectStore.getState().importError).toMatch(BUSY_MSG); // 無言でない
    useProjectStore.getState().setExportRun({ phase: 'idle' });
    useProjectStore.getState().removeAsset('asset_001');
    expect(useProjectStore.getState().assets).toHaveLength(0); // idle では通常どおり消える
  });

  it('書き出し中は updateAsset が no-op（保存も idle にしない）＋案内／idle では反映', () => {
    useProjectStore.getState().setExportRun({ phase: 'encoding' });
    useProjectStore.setState({ saveStatus: 'saved' });
    useProjectStore.getState().updateAsset('asset_001', (a) => ({ ...a, displayName: 'changed' }));
    expect(useProjectStore.getState().assets[0].displayName).toBe('asset_001'); // no-op
    expect(useProjectStore.getState().saveStatus).toBe('saved'); // 未保存(idle)にも倒さない
    expect(useProjectStore.getState().importError).toMatch(BUSY_MSG);
    useProjectStore.getState().setExportRun({ phase: 'idle' });
    useProjectStore.getState().updateAsset('asset_001', (a) => ({ ...a, displayName: 'changed' }));
    expect(useProjectStore.getState().assets[0].displayName).toBe('changed'); // idle では反映
  });

  it('書き出し中は addAssetByPath が no-op＋案内／idle では素材を増やす（ガード反転も検知）', async () => {
    useProjectStore.getState().setExportRun({ phase: 'rendering' });
    await useProjectStore.getState().addAssetByPath('/some/where/photo.png');
    expect(useProjectStore.getState().assets).toHaveLength(1); // 増えない（ガードが最初に返る）
    expect(useProjectStore.getState().importError).toMatch(BUSY_MSG);
    // idle 対照：非 Tauri でも楽観追加は走る（importAssetByPath は null 返しでもストア追加は残る）＝ガード条件反転を検知。
    useProjectStore.getState().setExportRun({ phase: 'idle' });
    await useProjectStore.getState().addAssetByPath('/some/where/photo.png');
    expect(useProjectStore.getState().assets.length).toBeGreaterThan(1);
  });

  it('書き出し中は setAssetImage/addAsset が no-op＋案内（file に触れる前に返る）', async () => {
    useProjectStore.getState().setExportRun({ phase: 'rendering' });
    useProjectStore.setState({ importError: null });
    await useProjectStore.getState().setAssetImage('asset_001', {} as File); // ガードが最初＝File は読まない
    // 案内を検証する（node は FileReader 未定義で filePath/isImporting はガード有無に依らず不変＝判別力が無いため案内で見る）。
    expect(useProjectStore.getState().importError).toMatch(BUSY_MSG); // ガードを外すと別メッセージ/未設定になり red
    expect(useProjectStore.getState().assets[0].filePath).toBe('assets/asset_001.png'); // 差し替わらない
    expect(useProjectStore.getState().isImporting).toBe(false); // 取り込みにも入らない
    useProjectStore.setState({ importError: null });
    await useProjectStore.getState().addAsset({} as File);
    expect(useProjectStore.getState().assets).toHaveLength(1); // 増えない
    expect(useProjectStore.getState().importError).toMatch(BUSY_MSG);
  });

  it('書き出し中は setBgm が no-op＋BGM 用の案内（bgmError）', async () => {
    useProjectStore.getState().setExportRun({ phase: 'rendering' });
    useProjectStore.setState({ bgmError: null });
    await useProjectStore.getState().setBgm({ name: 'song.mp3', dataUrl: 'data:audio/mp3;base64,x' });
    expect(useProjectStore.getState().assets.some((a) => a.assetType === 'bgm')).toBe(false); // BGM は入らない
    expect(useProjectStore.getState().bgmError).toMatch(BUSY_MSG); // BGM ピッカーが見せる案内
  });

  // #570 P1 レビュー：標準BGMの選択・音量・オンオフ（updateBgmSettings/setBundledBgm）も書き出し中は固定する。
  it('書き出し中は updateBgmSettings / setBundledBgm が no-op＋BGM案内（設定だけ変わって効かないを防ぐ）', () => {
    useProjectStore.getState().setExportRun({ phase: 'encoding' });
    useProjectStore.setState({
      bgmError: null,
      meta: { ...useProjectStore.getState().meta, bgmSettings: { enabled: true, volume: 0.25, bundledBgmId: undefined, assetId: null } },
    });
    useProjectStore.getState().updateBgmSettings({ volume: 0.5 });
    expect(useProjectStore.getState().meta.bgmSettings?.volume).toBe(0.25); // no-op（音量は変わらない）
    expect(useProjectStore.getState().bgmError).toMatch(BUSY_MSG);
    useProjectStore.setState({ bgmError: null });
    useProjectStore.getState().setBundledBgm('bundled_x' as never);
    expect(useProjectStore.getState().meta.bgmSettings?.bundledBgmId).toBeUndefined(); // no-op（曲は変わらない）
    expect(useProjectStore.getState().bgmError).toMatch(BUSY_MSG);
  });
});

// #570 P1 レビュー：取り込みと書き出し開始の相互排他。取り込みは最初の await 前に isImporting を立て、書き込み直前に
// 再チェックする。書き出し側（ExportScreen）は開始前に isImporting を見て止まる（別ファイルのコンポーネントテストで検証）。
describe('projectStore 取り込み↔書き出しの相互排他（#570 P1）', () => {
  const BUSY_MSG = /書き出しが終わるまで/;
  beforeEach(() => {
    useProjectStore.setState({
      meta: { ...useProjectStore.getState().meta, projectId: 'proj_open' },
      assets: [{ assetId: 'asset_001', assetType: 'image', displayName: 'A', filePath: 'assets/asset_001.png' }],
      assetSrcById: { asset_001: 'data:image/png;base64,x' },
      importError: null,
      isImporting: false,
      exportRun: { phase: 'idle', progress: { done: 0, total: 0 }, resultPath: '', message: '', bgmWarning: '', cancelling: false },
    });
  });
  afterEach(() => { useProjectStore.getState().setExportRun({ phase: 'idle' }); useProjectStore.setState({ isImporting: false }); });

  it('取り込みは最初の await の前に isImporting を立て、待機中に書き出しが始まったら上書きせず戻る（残り窓）', async () => {
    // fileToDataUrl を保留にして「取り込みの await 中」を作る（deferred mock＝競合の再現）。
    let resolveRead!: (v: string) => void;
    const spy = vi.spyOn(assetFsMod, 'fileToDataUrl').mockReturnValue(new Promise<string>((r) => { resolveRead = r; }));
    const p = useProjectStore.getState().setAssetImage('asset_001', {} as File); // fileToDataUrl で待機
    expect(useProjectStore.getState().isImporting).toBe(true); // 最初の await の前にロック取得済み（書き出し側はこれを見て止まる）
    // 待機中に書き出しが始まる（開始チェックをすり抜けた残り窓）。
    useProjectStore.getState().setExportRun({ phase: 'rendering' });
    resolveRead('data:image/png;base64,NEW');
    await p;
    expect(useProjectStore.getState().assets[0].filePath).toBe('assets/asset_001.png'); // 同一パスを上書きしていない
    expect(useProjectStore.getState().importError).toMatch(BUSY_MSG); // 黙って壊さず理由を出す（ADR-0026④）
    expect(useProjectStore.getState().isImporting).toBe(false); // ロックは解放
    spy.mockRestore();
  });
});

// #570 P1 レビュー：素材/BGM だけでなく**全ての文書編集**（場面・音声・構成）を書き出し中は固定する（15§4・ADR-0026④）。
// 書き出しは開始時スナップショットで進むので、編集すると「画面/保存は新・MP4 は旧」の不一致になる。UI はバナー/無効化で理由を示す。
describe('projectStore 書き出し中は文書編集を固定（#570 P1・15§4）', () => {
  beforeEach(() => {
    useProjectStore.setState({
      scenes: [scene('scene_001', 1)],
      parts: [{ partId: 'part_001', title: 'p', order: 1, sceneIds: ['scene_001'] }],
      past: [], future: [],
      exportRun: { phase: 'idle', progress: { done: 0, total: 0 }, resultPath: '', message: '', bgmWarning: '', cancelling: false },
    });
  });
  afterEach(() => useProjectStore.getState().setExportRun({ phase: 'idle' }));

  it('updateScene は書き出し中 no-op／idle では反映（場面内容が MP4 と食い違わない）', () => {
    useProjectStore.getState().setExportRun({ phase: 'rendering' });
    useProjectStore.getState().updateScene('scene_001', (sc) => ({ ...sc, durationSec: 99 }));
    expect(useProjectStore.getState().scenes[0].durationSec).toBe(8); // no-op
    useProjectStore.getState().setExportRun({ phase: 'idle' });
    useProjectStore.getState().updateScene('scene_001', (sc) => ({ ...sc, durationSec: 99 }));
    expect(useProjectStore.getState().scenes[0].durationSec).toBe(99); // idle では反映
  });

  it('updateVoiceSettings（読み上げ音量）は書き出し中 no-op／idle では反映', () => {
    useProjectStore.getState().updateVoiceSettings({ volume: 0.7 }); // idle（beforeEach）で設定
    expect(useProjectStore.getState().meta.voiceSettings?.volume).toBe(0.7);
    useProjectStore.getState().setExportRun({ phase: 'encoding' });
    useProjectStore.getState().updateVoiceSettings({ volume: 0.2 });
    expect(useProjectStore.getState().meta.voiceSettings?.volume).toBe(0.7); // no-op（0.2 にならない）
  });

  it('場面構成（addScene/removeScene）も書き出し中は固定＝MP4 の場面と食い違わない', () => {
    useProjectStore.getState().setExportRun({ phase: 'rendering' });
    expect(useProjectStore.getState().addScene()).toBe(''); // 追加しない（sentinel）
    expect(useProjectStore.getState().scenes).toHaveLength(1);
    useProjectStore.getState().removeScene('scene_001');
    expect(useProjectStore.getState().scenes).toHaveLength(1); // 消えない
  });

  // 全20の文書編集アクションは同型の1行ガード。代表テストで「書き出し中は pushHistory 前に返る＝履歴を積まない」を一括検証
  // （ガードを外すと各アクションが pushHistory して past が伸び red 化＝回帰検知・#570 P1 レビュー tests）。
  it.each<[string, () => void]>([
    ['updateScene', () => useProjectStore.getState().updateScene('scene_001', (sc) => ({ ...sc, durationSec: 5 }))],
    ['moveScene', () => useProjectStore.getState().moveScene('scene_001', 'up')],
    ['moveSceneToIndex', () => useProjectStore.getState().moveSceneToIndex('scene_001', 0)],
    ['duplicateScene', () => { useProjectStore.getState().duplicateScene('scene_001'); }],
    ['splitScene', () => { useProjectStore.getState().splitScene('scene_001', 1); }],
    ['addAnimation', () => { useProjectStore.getState().addAnimation('scene_001', 'el_1', []); }],
    ['updateAnimation', () => useProjectStore.getState().updateAnimation('anim_1', [])],
    ['removeAnimation', () => useProjectStore.getState().removeAnimation('anim_1')],
    ['removeAnimationsForElements', () => useProjectStore.getState().removeAnimationsForElements('scene_001', ['el_1'])],
    ['addOverlayClip', () => { useProjectStore.getState().addOverlayClip({ track: 'telop' }); }],
    ['updateOverlayClip', () => useProjectStore.getState().updateOverlayClip('clip_1', { startSec: 1 })],
    ['removeOverlayClip', () => useProjectStore.getState().removeOverlayClip('clip_1')],
    ['applyProjectInfo', () => useProjectStore.getState().applyProjectInfo({ companyInfo: { name: 'x' } } as never)],
    ['changeOrientation', () => { useProjectStore.getState().changeOrientation('9:16'); }],
    ['setFontId', () => useProjectStore.getState().setFontId('gen-interface-jp' as never)],
    ['setProjectName', () => useProjectStore.getState().setProjectName('x')],
    ['updateVoiceSettings', () => useProjectStore.getState().updateVoiceSettings({ volume: 0.4 })],
  ])('%s は書き出し中に履歴を積まない＝ガードが pushHistory 前に返る', (_name, act) => {
    useProjectStore.setState({ past: [] });
    useProjectStore.getState().setExportRun({ phase: 'rendering' });
    act();
    expect(useProjectStore.getState().past).toHaveLength(0); // ガードで文書に触れず返る（idle なら pushHistory で past が伸びる）
  });

  // 音声生成も固定（#570 P1 レビュー・履歴外＝pushHistory 走査の外）。書き出しは snapNarration を使うので、書き出し中に
  // 声を作ると「保存/プレビューには入るが今のMP4には入らない」＝バナー「編集できません」と矛盾する。
  it('generateNarration / generateAllNarrations は書き出し中 no-op（声を作らない）', async () => {
    useProjectStore.setState({ scenes: [{ ...scene('scene_001', 1), narration: { text: 'こんにちは', status: 'none' } }] });
    useProjectStore.getState().setExportRun({ phase: 'rendering' });
    await useProjectStore.getState().generateNarration('scene_001');
    expect(useProjectStore.getState().scenes[0].narration.status).toBe('none'); // 生成しない（ガードが最初に返る）
    await useProjectStore.getState().generateAllNarrations();
    expect(useProjectStore.getState().scenes[0].narration.status).toBe('none');
    expect(useProjectStore.getState().isGeneratingNarration).toBe(false); // 一括生成にも入らない
  });

  it('generate（動画案生成）は書き出し中 no-op（生成を始めない）', async () => {
    useProjectStore.setState({ scenes: [], status: 'ready' });
    useProjectStore.getState().setExportRun({ phase: 'rendering' });
    await useProjectStore.getState().generate();
    expect(useProjectStore.getState().status).not.toBe('generating'); // 開始しない（ガードが status チェックの直後で返る）
    expect(useProjectStore.getState().scenes).toHaveLength(0);
  });

  // 「生成開始→（残り窓で）書き出し開始→生成完了」の往復（deferred synthesize）。開始チェックをすり抜けても、完了側が
  // 書き出し中を再確認して音声を書き込まない＝無音MP4/「保存だけ新」の不整合を防ぐ（#570 P1 レビュー・完了側の再確認）。
  it('声作成中に書き出しが始まり合成が完了しても、音声を書き込まず none へ戻す', async () => {
    useProjectStore.setState({
      scenes: [{ ...scene('scene_001', 1), narration: { text: 'こんにちは', status: 'none' } }],
      narrationAudioById: {}, isGeneratingNarration: false,
      exportRun: { phase: 'idle', progress: { done: 0, total: 0 }, resultPath: '', message: '', bgmWarning: '', cancelling: false },
    });
    let resolveSynth: (v: unknown) => void = () => {};
    const synthP = new Promise((r) => { resolveSynth = r; });
    const spy = vi.spyOn(MockVoiceProvider.prototype, 'synthesize').mockReturnValue(synthP as never);
    const genP = useProjectStore.getState().generateNarration('scene_001'); // 開始＝synth 待ちで pending（開始時は idle なので top ガードは通る）
    expect(useProjectStore.getState().scenes[0].narration.status).toBe('pending');
    useProjectStore.getState().setExportRun({ phase: 'rendering' }); // 合成 in-flight 中に書き出しが始まる（すり抜けた残り窓）
    resolveSynth({ audioDataUrl: 'data:audio/wav;base64,AAAA', durationSec: 1 }); // 裏で合成完了
    await genP;
    expect(useProjectStore.getState().narrationAudioById['scene_001']).toBeUndefined(); // 音声を書き込まない
    expect(useProjectStore.getState().scenes[0].narration.status).toBe('none'); // 作り直せるよう none へ
    spy.mockRestore();
  });

  // 掛け合い（scene.lines）でも完了側で書き込まないことを固定（#570 P2 レビュー・単一だけでなく行ごと経路も）。
  it('掛け合いでも：声作成中に書き出しが始まり合成完了しても、行の音声を書き込まず none へ戻す', async () => {
    useProjectStore.setState({
      scenes: [{ ...scene('scene_001', 1), narration: { text: '', status: 'none' }, lines: [{ lineId: 'line_001', text: 'こんにちは', status: 'none' }] }],
      narrationAudioById: {}, isGeneratingNarration: false,
      exportRun: { phase: 'idle', progress: { done: 0, total: 0 }, resultPath: '', message: '', bgmWarning: '', cancelling: false },
    });
    let resolveSynth: (v: unknown) => void = () => {};
    const synthP = new Promise((r) => { resolveSynth = r; });
    const spy = vi.spyOn(MockVoiceProvider.prototype, 'synthesize').mockReturnValue(synthP as never);
    const genP = useProjectStore.getState().generateNarration('scene_001'); // 行が pending（開始時 idle＝top ガードは通る）
    expect(useProjectStore.getState().scenes[0].lines?.[0].status).toBe('pending');
    useProjectStore.getState().setExportRun({ phase: 'rendering' }); // 合成 in-flight 中に書き出しが始まる
    resolveSynth({ audioDataUrl: 'data:audio/wav;base64,AAAA', durationSec: 1 });
    await genP;
    expect(useProjectStore.getState().narrationAudioById['scene_001/line_001']).toBeUndefined(); // 行の音声を書き込まない
    expect(useProjectStore.getState().scenes[0].lines?.[0].status).toBe('none'); // 行を none へ戻す
    spy.mockRestore();
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

  it('空プロジェクトにし、status を ready にする（idle にしない・draftFromAi=false）', () => {
    useProjectStore.setState({
      status: 'idle',
      draftFromAi: true, // 直前が AI 生成でも白紙化で false に落ちること
      scenes: [{ sceneId: 'scene_001' } as never],
      parts: [{ partId: 'part_001', title: 'P', order: 1, sceneIds: ['scene_001'] } as never],
    });
    useProjectStore.getState().newBlankProject();
    const st = useProjectStore.getState();
    expect(st.scenes).toEqual([]);
    expect(st.parts).toEqual([]);
    expect(st.status).toBe('ready'); // idle にしない＝マウント時の自動生成を発火させない
    expect(st.draftFromAi).toBe(false); // 白紙は AI 由来でない（#467）
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

describe('projectStore startManualEdit（生成失敗からの手動作成リカバリ・#393 P1）', () => {
  it('status を error→ready にし aiError を消す。入力済みメタ/素材は残す（draftFromAi=false）', () => {
    useProjectStore.setState({
      status: 'error',
      aiError: '生成に失敗しました',
      draftFromAi: true,
      meta: { ...useProjectStore.getState().meta, companyInfo: { name: '入力済みの会社' } as never },
      assets: [{ assetId: 'asset_001' } as never],
    });
    const seqBefore = useProjectStore.getState()._generationSeq;
    useProjectStore.getState().startManualEdit();
    const st = useProjectStore.getState();
    expect(st.status).toBe('ready'); // error のままにしない＝たたき台が「場面を追加」導線を出す
    expect(st.aiError).toBeNull();
    expect(st.draftFromAi).toBe(false); // 手動作成＝AI 由来でない（#467）
    expect(st.meta.companyInfo).toEqual({ name: '入力済みの会社' }); // 入力は残す
    expect(st.assets).toHaveLength(1); // 取り込んだ素材は残す
    expect(st._generationSeq).toBe(seqBefore + 1); // in-flight 生成を無効化＝後から AI 案に上書きされない（P2）
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

describe('projectStore 履歴グループ（#389・連続編集を1履歴にまとめる）', () => {
  beforeEach(() => {
    useProjectStore.setState({ past: [], future: [], _historyGroupDepth: 0, _historyGroupPending: false });
  });

  it('begin→複数 pushHistory→end で履歴は1件だけ増える（最初の変更で記録・以降 no-op）', () => {
    const st = useProjectStore.getState();
    st.beginHistoryGroup();
    st.pushHistory();
    st.pushHistory();
    st.pushHistory();
    st.endHistoryGroup();
    // 3回でなく1回だけ（最初の pushHistory で記録・以降 no-op）＝1キーストローク毎に積まない。
    expect(useProjectStore.getState().past).toHaveLength(1);
    expect(useProjectStore.getState()._historyGroupDepth).toBe(0); // グループは閉じている
  });

  it('begin→（変更なし）→end では履歴を消費しない（未変更 focus/pointerdown で積まない・#389 レビュー）', () => {
    const st = useProjectStore.getState();
    st.beginHistoryGroup();
    st.endHistoryGroup();
    // pushHistory が一度も呼ばれない＝snapshot は遅延記録なので past は増えない（Undo が「何もしない」を生まない）。
    expect(useProjectStore.getState().past).toHaveLength(0);
    expect(useProjectStore.getState()._historyGroupDepth).toBe(0);
  });

  it('グループ外の pushHistory は都度積まれる（従来どおり・グループ化しない編集は1操作=1履歴）', () => {
    useProjectStore.getState().pushHistory();
    useProjectStore.getState().pushHistory();
    expect(useProjectStore.getState().past).toHaveLength(2);
  });
});

// #547：見た目が見つからない場面は**自動置換しない**（黙って中身が減った動画を出さない）。
// 代わりに「まとめて標準にする」を利用者の明示操作として提供する＝押したときだけ、まとめて標準へ寄せる。
describe('applyStandardLookToUnresolvedScenes（まとめて標準にする・#547）', () => {
  const unresolved = (id: string) => ({ ...scene(id, 1), sceneId: id, templateId: 'missing_tmpl' }) as Scene;

  beforeEach(() => {
    useProjectStore.setState({
      templates: [...sampleTemplates],
      meta: { ...useProjectStore.getState().meta, videoSettings: { ...useProjectStore.getState().meta.videoSettings, aspectRatio: '16:9' } },
      past: [], future: [],
    });
    useProjectStore.getState().setExportRun({ phase: 'idle' });
  });

  it('見つからない場面だけ標準へ寄せ、直した場面番号を返す（解決済みは触らない）', () => {
    const ok = { ...scene('scene_ok', 2), templateId: sampleTemplates[0].templateId } as Scene;
    useProjectStore.setState({ scenes: [unresolved('scene_ng'), ok] });
    const r = useProjectStore.getState().applyStandardLookToUnresolvedScenes();
    expect(r.fixed).toEqual([1]); // 場面番号（1始まり）＝公開前チェックの数え方
    expect(r.unfixable).toEqual([]);
    const after = useProjectStore.getState().scenes;
    // 直した場面は解決できる見た目になっている（＝もう「見つからない」ではない）。
    expect(useProjectStore.getState().templates.some((t) => t.templateId === after[0].templateId)).toBe(true);
    expect(after[1].templateId).toBe(ok.templateId); // 解決済みは不変
  });

  // マイ見た目の層 id は標準に無いことが多く、寄せると写真の割り当てが外れる。件数だけ返すと
  // 「直った」ように見えて中身が減ったまま書き出せる（#547 が防ぎたい失敗そのもの）。
  it('動画に出なくなった中身のある場面を返す（直った件数だけを見せない）', () => {
    const ng = { ...unresolved('scene_ng'), assetRefs: { layer_001: 'asset_001' } } as Scene;
    useProjectStore.setState({ scenes: [ng] });
    const r = useProjectStore.getState().applyStandardLookToUnresolvedScenes();
    expect(r.fixed).toEqual([1]);
    expect(r.lostContent).toEqual([1]); // 入れ直しが要る場面として返る
    expect(useProjectStore.getState().scenes[0].assetRefs.layer_001).toBeUndefined();
  });

  it('当て先が無い場面は unfixable で返す（押した後も項目が残る理由を出せる）', () => {
    // 縦向きに切り替えると、横向き前提の場面種別に合う標準が無くなる組み合わせを作る。
    const ng = { ...unresolved('scene_ng'), sceneType: 'photo_intro' } as Scene;
    useProjectStore.setState({
      scenes: [ng],
      templates: sampleTemplates.filter((t) => t.category !== 'photo_intro'), // 写真紹介の標準を外す
    });
    const r = useProjectStore.getState().applyStandardLookToUnresolvedScenes();
    expect(r.fixed).toEqual([]);
    expect(r.unfixable).toEqual([1]);
  });

  it('種類の違う未解決場面を、それぞれ自分の種類の標準へ寄せる（一律に同じ見た目にしない）', () => {
    const opening = { ...unresolved('scene_op'), sceneType: 'opening' } as Scene;
    const photo = { ...unresolved('scene_ph'), sceneType: 'photo_intro' } as Scene;
    useProjectStore.setState({ scenes: [opening, photo] });
    const r = useProjectStore.getState().applyStandardLookToUnresolvedScenes();
    expect(r.fixed).toEqual([1, 2]);
    const [a, b] = useProjectStore.getState().scenes;
    const catOf = (id: string) => useProjectStore.getState().templates.find((t) => t.templateId === id)?.category;
    expect(catOf(a.templateId)).toBe('opening');
    expect(catOf(b.templateId)).toBe('photo_intro');
    expect(a.templateId).not.toBe(b.templateId); // 別々の見た目が当たっている
  });

  it('直る場面・中身が減る場面・直せない場面が混在しても、場面番号を取り違えない', () => {
    const ok = { ...scene('scene_ok', 1), templateId: sampleTemplates[0].templateId } as Scene; // 場面1：解決済み
    const losing = { ...unresolved('scene_lose'), sceneType: 'opening', assetRefs: { layer_001: 'asset_001' } } as Scene; // 場面2
    const nofix = { ...unresolved('scene_nofix'), sceneType: 'photo_intro' } as Scene; // 場面3：当て先を外す
    useProjectStore.setState({
      scenes: [ok, losing, nofix],
      templates: sampleTemplates.filter((t) => t.category !== 'photo_intro'),
    });
    const r = useProjectStore.getState().applyStandardLookToUnresolvedScenes();
    expect(r.fixed).toEqual([2]);
    expect(r.lostContent).toEqual([2]);
    expect(r.unfixable).toEqual([3]);
    expect(useProjectStore.getState().scenes[0].templateId).toBe(ok.templateId); // 解決済みは不変
    expect(useProjectStore.getState().scenes[2].templateId).toBe('missing_tmpl'); // 直せない場面も不変
  });

  it('取り消せる（1回の操作＝1履歴）', () => {
    useProjectStore.setState({ scenes: [unresolved('scene_ng')] });
    useProjectStore.getState().applyStandardLookToUnresolvedScenes();
    expect(useProjectStore.getState().past).toHaveLength(1); // 1操作＝1履歴（pushHistory の重複を捉える）
    expect(useProjectStore.getState().scenes[0].templateId).not.toBe('missing_tmpl');
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().scenes[0].templateId).toBe('missing_tmpl'); // 元へ戻る
  });

  it('直せる場面が無ければ履歴を積まない（空の取り消しを作らない）', () => {
    const ok = { ...scene('scene_ok', 1), templateId: sampleTemplates[0].templateId } as Scene;
    useProjectStore.setState({ scenes: [ok], past: [] });
    expect(useProjectStore.getState().applyStandardLookToUnresolvedScenes().fixed).toEqual([]);
    expect(useProjectStore.getState().past).toHaveLength(0);
  });

  it('書き出し中は何もしない（文書編集を固定・#570）', () => {
    useProjectStore.setState({ scenes: [unresolved('scene_ng')] });
    useProjectStore.getState().setExportRun({ phase: 'rendering' });
    expect(useProjectStore.getState().applyStandardLookToUnresolvedScenes().fixed).toEqual([]);
    expect(useProjectStore.getState().scenes[0].templateId).toBe('missing_tmpl'); // 変わらない
    useProjectStore.getState().setExportRun({ phase: 'idle' });
  });
});
