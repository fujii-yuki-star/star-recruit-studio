// よく使う素材から取り込むときの**再入ガード**（差分再監査 ℹ️）。
//
// ⚠️ **旗を最初の `await` より後で立てると、その窓では2本とも門を通る**＝両方が同じ `assets` から
// **同じ `asset_NNN`** を採り、同じファイル名で上書きコピーして、`assets` に**同じ id が2件**並ぶ
//（保存時の検査は警告だけで通る）。旗は最初の `await` より前に立て、早期 return では必ず下ろす。
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';

vi.mock('../../infrastructure/assetLibraryFs', () => ({
  listLibraryAssets: vi.fn(),
  importLibraryAssetToProject: vi.fn(async () => 'assets/asset_001.png'),
}));

import { useProjectStore } from './projectStore';
import { listLibraryAssets } from '../../infrastructure/assetLibraryFs';
import { IMPORT_BUSY_MESSAGE } from '../uiLabels';

beforeEach(() => {
  useProjectStore.setState((st) => ({
    assets: [], assetSrcById: {}, importError: null, isImporting: false,
    meta: { ...st.meta, projectId: 'proj_20260830_001' },
  }) as never);
  useProjectStore.getState().setExportRun({ phase: 'idle' });
});
afterEach(() => vi.clearAllMocks());

describe('importFromLibrary の再入ガード', () => {
  it('一覧を読んでいる間に始まった2本目は断る（同じ番号を2回採らない）', async () => {
    let release: (v: unknown) => void = () => {};
    vi.mocked(listLibraryAssets).mockImplementationOnce(() => new Promise((res) => { release = res; }) as never);

    const first = useProjectStore.getState().importFromLibrary('lib_asset_001');
    // ⚠️ ここが窓＝旗が最初の `await` より後だと、2本目も門を通ってしまう。
    const second = await useProjectStore.getState().importFromLibrary('lib_asset_001');

    expect(second).toBeNull();
    expect(useProjectStore.getState().importError).toBe(IMPORT_BUSY_MESSAGE);
    release(null); // 1本目は「一覧を読めなかった」で終わる
    await first;
  });

  it('読めずに終わっても旗を下ろす（以後の取り込みが通らなくなる、を作らない）', async () => {
    vi.mocked(listLibraryAssets).mockResolvedValueOnce(null);
    expect(await useProjectStore.getState().importFromLibrary('lib_asset_001')).toBeNull();
    expect(useProjectStore.getState().isImporting).toBe(false);
  });

  it('素材が見つからなくても旗を下ろす', async () => {
    vi.mocked(listLibraryAssets).mockResolvedValueOnce([]);
    expect(await useProjectStore.getState().importFromLibrary('lib_asset_001')).toBeNull();
    expect(useProjectStore.getState().isImporting).toBe(false);
  });
});
