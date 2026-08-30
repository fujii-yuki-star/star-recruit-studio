// タイムライン形式の「よく使う素材から取り込む」（差分再監査 5巡目）。
//
// ⚠️ **場面形式と同じ結果になること**を実装ごと通して固定する（片方だけモックで済ませない）＝
// 棚の名前・種類・タグを引き継ぐ（ADR-0035 決定3）／一覧を読んでいる間に別の動画を開いたら入れない／
// 成否は「足した番号」で見る（件数の増減では見ない）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../infrastructure/assetLibraryFs', () => ({
  listLibraryAssets: vi.fn(),
  copyLibraryAssetToProject: vi.fn(),
}));
vi.mock('./assetImport', async (orig) => ({
  // 採番（`reserveAssetId`）は本物を通す＝番号を使い回さない規則ごと検証する。
  ...(await orig<typeof import('./assetImport')>()),
  probeImageSize: vi.fn(async () => ({ width: 1920, height: 1080 })),
  probeAndThumbVideo: vi.fn(async () => ({})),
}));
vi.mock('../../infrastructure/projectFs', () => ({
  assetDisplayUrl: vi.fn(async () => 'asset://x'),
  saveTimelineProjectDoc: vi.fn(async () => {}),
}));

import { useTimelineStore } from './timelineStore';
import { copyLibraryAssetToProject, listLibraryAssets } from '../../infrastructure/assetLibraryFs';
import { ASSET_TYPE } from '../../domain/enums';
import type { TimelineProject } from '../../domain/timeline/types';

const doc = (projectId: string): TimelineProject => ({
  format: 'timeline', schemaVersion: '1.10', projectId, projectName: 'タイムライン動画',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 300 },
  assets: [], tracks: [], clips: [],
} as unknown as TimelineProject);

beforeEach(() => {
  vi.mocked(listLibraryAssets).mockResolvedValue([
    { id: 'lib_asset_003', fileName: 'lib_asset_003.png', displayName: '会社ロゴ', assetType: ASSET_TYPE.logo, tags: ['採用'] },
  ]);
  vi.mocked(copyLibraryAssetToProject).mockResolvedValue('assets/asset_001.png');
  useTimelineStore.setState({
    doc: doc('proj_t1'), isImporting: false, importError: null,
    exportRun: { phase: 'idle' }, past: [], future: [],
  } as never);
});
afterEach(() => vi.clearAllMocks());

describe('タイムラインの棚からの取り込み', () => {
  it('棚の名前・種類・タグを引き継ぐ（機械の番号を素材名にしない）', async () => {
    const ok = await useTimelineStore.getState().importFromLibrary('lib_asset_003');
    expect(ok).toBe(true);
    const added = useTimelineStore.getState().doc!.assets[0];
    expect(added.displayName).toBe('会社ロゴ');
    expect(added.assetType).toBe(ASSET_TYPE.logo);
    expect(added.tags).toEqual(['採用']);
    expect(added.assetId).toMatch(/^asset_\d{3}$/);
  });

  it('一覧を読んでいる間に別の動画を開いたら、そちらへ入れない', async () => {
    vi.mocked(listLibraryAssets).mockImplementation(async () => {
      useTimelineStore.setState({ doc: doc('proj_t2') } as never);
      return [{ id: 'lib_asset_003', fileName: 'lib_asset_003.png', displayName: '会社ロゴ', assetType: ASSET_TYPE.logo, tags: [] }];
    });
    const ok = await useTimelineStore.getState().importFromLibrary('lib_asset_003');
    expect(ok).toBe(false);
    expect(useTimelineStore.getState().doc!.assets).toEqual([]);
    expect(copyLibraryAssetToProject).not.toHaveBeenCalled();
  });

  it('動画を開いていなければ取り込まない（画面が塞ぐ前の守り）', async () => {
    useTimelineStore.setState({ doc: null } as never);
    expect(await useTimelineStore.getState().importFromLibrary('lib_asset_003')).toBe(false);
    expect(copyLibraryAssetToProject).not.toHaveBeenCalled();
  });

  it('一覧を読めなかったら、次の行動を出して取り込まない', async () => {
    vi.mocked(listLibraryAssets).mockResolvedValue(null);
    expect(await useTimelineStore.getState().importFromLibrary('lib_asset_003')).toBe(false);
    expect(useTimelineStore.getState().importError).toContain('開き直して');
    expect(useTimelineStore.getState().doc!.assets).toEqual([]);
  });

  it('棚に無い素材は、探す先を示して断る', async () => {
    expect(await useTimelineStore.getState().importFromLibrary('lib_asset_999')).toBe(false);
    expect(useTimelineStore.getState().importError).toContain('一覧を開き直して');
  });

  it('コピーに失敗したら「取り込めた」と言わない', async () => {
    vi.mocked(copyLibraryAssetToProject).mockRejectedValue(new Error('boom'));
    expect(await useTimelineStore.getState().importFromLibrary('lib_asset_003')).toBe(false);
    expect(useTimelineStore.getState().doc!.assets).toEqual([]);
  });
});
