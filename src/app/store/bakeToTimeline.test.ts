// 焼き出し（場面形式 → タイムライン形式・ADR-0032・#628）の store 側。片道であること・ファイルを運ぶ順序を固定する。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetProjectIdReservations } from "./assetImport";
import { useProjectStore } from './projectStore';
import * as fsMod from '../../infrastructure/projectFs';
import * as bakeFsMod from '../../infrastructure/bakeFs';
import { sampleTemplates } from '../../infrastructure/sampleData';
import { BAKE_RANGE_KIND, BakeError } from '../../domain/timeline/bake';
import type { Scene } from '../../domain/project/types';
import { validateTimelineProject } from '../../domain/validation/generated/validators.js';

function scene(id: string, order: number, over: Partial<Scene> = {}): Scene {
  return {
    sceneId: id,
    partId: 'part_001',
    order,
    sceneType: 'photo_intro',
    templateId: 'photo_left_text_right_yuko_v1',
    durationSec: 8,
    assetRefs: {},
    character: { enabled: false, characterId: 'yuko' },
    texts: {},
    narration: { text: '', status: 'none' },
    warnings: [],
    ...over,
  };
}

describe('bakeToTimeline / estimateBake', () => {
  beforeEach(() => {
  // ⚠️ **番号の予約はモジュールに残る**（#992 ③＝アプリ起動中は覚えたままが正しい）＝
  // テスト間で持ち越すと、2件目以降の番号がずれる。
  resetProjectIdReservations();
    vi.restoreAllMocks();
    // 新しい id は作成日から採るので、時計を固定して期待値を決定的にする。
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 28, 12, 0, 0));
    useProjectStore.setState({
      templates: sampleTemplates,
      meta: { ...useProjectStore.getState().meta, projectId: 'proj_20260701_001', projectName: '元の動画' },
      assets: [{ assetId: 'asset_001', assetType: 'image', displayName: '写真', filePath: 'assets/asset_001.png' }],
      parts: [{ partId: 'part_001', title: 'パート1', order: 1, sceneIds: ['scene_001'] }],
      scenes: [scene('scene_001', 1, { assetRefs: { mainVisual: 'asset_001' } })],
      saveStatus: 'saved',
    });
    vi.spyOn(fsMod, 'listProjectSummaries').mockResolvedValue([{ projectId: 'proj_20260701_001', projectName: '元の動画', updatedAt: '' }]);
    vi.spyOn(fsMod, 'saveProjectDoc').mockResolvedValue('path');
    vi.spyOn(bakeFsMod, 'copyBakedFiles').mockResolvedValue(undefined);
    vi.spyOn(bakeFsMod, 'bakeSizeBytes').mockResolvedValue(1234);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('新しい id で保存し、元のプロジェクトは開いたまま変わらない（片道・決定16）', async () => {
    const before = JSON.stringify(useProjectStore.getState().scenes);
    const r = await useProjectStore.getState().bakeToTimeline({ kind: BAKE_RANGE_KIND.whole }, '焼いた動画');

    expect(r.projectId).toBe('proj_20260728_001'); // 元とは別の新規
    expect(useProjectStore.getState().meta.projectId).toBe('proj_20260701_001'); // 開いているのは元のまま
    expect(JSON.stringify(useProjectStore.getState().scenes)).toBe(before);

    const saved = vi.mocked(fsMod.saveProjectDoc).mock.calls.find((c) => c[0] === 'proj_20260728_001')!;
    const doc = JSON.parse(saved[1]) as Record<string, unknown>;
    expect(doc.format).toBe('timeline');
    expect(doc.sourceProjectId).toBe('proj_20260701_001');
    expect(doc.projectName).toBe('焼いた動画');
  });

  it('文書を保存する前に素材を運ぶ（途中で失敗しても素材の無いプロジェクトを残さない）', async () => {
    const order: string[] = [];
    vi.mocked(bakeFsMod.copyBakedFiles).mockImplementation(async () => { order.push('copy'); });
    vi.mocked(fsMod.saveProjectDoc).mockImplementation(async (id) => { order.push(`save:${id}`); return 'path'; });

    await useProjectStore.getState().bakeToTimeline({ kind: BAKE_RANGE_KIND.whole }, '焼いた動画');

    // 元の保存（焼く前）→ 素材のコピー → 焼いた文書の保存
    expect(order).toEqual(['save:proj_20260701_001', 'copy', 'save:proj_20260728_001']);
    expect(vi.mocked(bakeFsMod.copyBakedFiles).mock.calls[0].slice(0, 2)).toEqual(['proj_20260701_001', 'proj_20260728_001']);
    expect(vi.mocked(bakeFsMod.copyBakedFiles).mock.calls[0][2]).toContain('assets/asset_001.png');
  });

  it('見積りでは新しい id を発行しない（番号を飛ばさない）', async () => {
    const r = await useProjectStore.getState().estimateBake({ kind: BAKE_RANGE_KIND.whole });
    expect(r.bytes).toBe(1234);
    expect(fsMod.listProjectSummaries).not.toHaveBeenCalled();
    expect(fsMod.saveProjectDoc).not.toHaveBeenCalled();
    // 容量は**元のプロジェクト**のファイルを測る（まだコピーしていない）
    expect(vi.mocked(bakeFsMod.bakeSizeBytes).mock.calls[0][0]).toBe('proj_20260701_001');
  });

  it('スキーマに適合しない結果は保存しない（一覧に出るのに開けない動画を作らない）', async () => {
    // durationSec>0 は schema の要求（exclusiveMinimum）。壊れた場面から焼くと未適合になる。
    useProjectStore.setState({ scenes: [scene('scene_001', 1, { durationSec: 0 })] });
    await expect(useProjectStore.getState().bakeToTimeline({ kind: BAKE_RANGE_KIND.whole }, '焼いた動画')).rejects.toThrow(BakeError);
    // 焼いた文書は保存されていない（走るのは元の保存だけ）。
    expect(vi.mocked(fsMod.saveProjectDoc).mock.calls.every((c) => c[0] === 'proj_20260701_001')).toBe(true);
  });

  // #811＝焼き出しの採番が壊れて id が重なったとき、**適合チェックは素通りする**（配列をまたいだ
  // id の一意は JSON Schema の語彙に無い）。重なった文書は読む側の引き当てが別のものに効くので、
  // 一覧に出るのに絵が変わる動画を作らない＝門をここにも置く。
  it('id が重なった結果は保存しない（適合チェックは通ってしまうため）', async () => {
    const real = useProjectStore.getState()._bake;
    useProjectStore.setState({
      _bake: (range, name, id) => {
        const r = real(range, name, id);
        return { ...r, doc: { ...r.doc, tracks: [...r.doc.tracks, { ...r.doc.tracks[0] }] } };
      },
    });
    // ⚠️ **適合はしている**＝止めているのが重複の門であることを確かめる（schema の門で止まったのでは意味が違う）。
    const broken = useProjectStore.getState()._bake({ kind: BAKE_RANGE_KIND.whole }, '焼いた動画', 'proj_20260728_001').doc;
    expect(validateTimelineProject(broken)).toBe(true);

    try {
      // ⚠️ **型まで見る**＝素の `Error` に戻ると、画面が理由を出し分けられず「空き容量を確かめて」に
      // 化ける（言われたとおりにしても直らない・PR #820 レビュー）。
      await expect(useProjectStore.getState().bakeToTimeline({ kind: BAKE_RANGE_KIND.whole }, '焼いた動画')).rejects.toThrow(BakeError);
      expect(vi.mocked(fsMod.saveProjectDoc).mock.calls.every((c) => c[0] === 'proj_20260701_001')).toBe(true);
    } finally {
      useProjectStore.setState({ _bake: real }); // 途中で落ちても差し替えを次のテストへ漏らさない
    }
  });

  it('持っていけないものは見積りでも焼いた後でも同じ内容を返す（同じ変換を共有）', async () => {
    useProjectStore.setState({
      scenes: [scene('scene_001', 1, { slotVideoStart: { mainVisual: { mode: 'afterAnim' } } })],
    });
    const est = await useProjectStore.getState().estimateBake({ kind: BAKE_RANGE_KIND.whole });
    const done = await useProjectStore.getState().bakeToTimeline({ kind: BAKE_RANGE_KIND.whole, }, '焼いた動画');
    expect(est.notes).toEqual([{ code: 'BAKE_VIDEO_START_TIMING_SKIPPED', sceneNumbers: [1] }]);
    expect(done.notes).toEqual(est.notes);
  });
});
