// 取り込みの**着地**は「まだ同じ動画を開いているか」で括る（α-6 出口監査 🟡9/🟡21・#762 と同じ照合）。
//
// ⚠️ **待っている間に別の動画を開ける**＝括らないと、コピーの完了が**別の動画へ素材を生やす**。
// 番号は動画ごとに採り直すので `asset_001` は両方に居る＝巻き戻しが**新しい方の別の素材を消す**ことまで起きる。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../infrastructure/assetLibraryFs', () => ({
  listLibraryAssets: vi.fn(),
  copyLibraryAssetToProject: vi.fn(),
}));
// ⚠️ **丸ごと差し替えない**（α-7 出口監査 🟡）＝`reserveAssetId`（番号を使い回さない規則）まで
// 消えると、素材の番号が空き番号を埋める形に戻る＝**前の写真を上書きする**作りをテストが素通しする。
vi.mock('./assetImport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./assetImport')>()),
  probeImageSize: vi.fn(async () => ({ width: 1920, height: 1080 })),
  probeAndThumbVideo: vi.fn(async () => ({})),
}));
vi.mock('../../infrastructure/brandKitFs', () => ({
  loadBrandKit: vi.fn(),
  saveBrandKit: vi.fn(async () => {}),
}));

import { useProjectStore } from './projectStore';
import { copyLibraryAssetToProject, listLibraryAssets } from '../../infrastructure/assetLibraryFs';
import { resetAssetIdReservations, probeImageSize } from './assetImport';
import { loadBrandKit } from '../../infrastructure/brandKitFs';
import { ASSET_TYPE } from '../../domain/enums';

/** 「別の動画を開いた」＝読込・新規と同じく文書の版を進める。 */
function openAnotherProject(): void {
  useProjectStore.setState((s) => ({ _docEpoch: s._docEpoch + 1, assets: [] } as never));
}

beforeEach(() => {
  vi.mocked(listLibraryAssets).mockResolvedValue([
    { id: 'lib_asset_001', fileName: 'lib_asset_001.png', displayName: '会社ロゴ', assetType: ASSET_TYPE.logo, tags: [] },
  ]);
  vi.mocked(loadBrandKit).mockResolvedValue({});
  useProjectStore.setState((st) => ({
    assets: [], assetSrcById: {}, importError: null, isImporting: false,
    meta: { ...st.meta, projectId: 'proj_20260829_0001', videoSettings: { ...st.meta.videoSettings, fontId: undefined } },
  } as never));
  useProjectStore.getState().setExportRun({ phase: 'idle' });
});
afterEach(() => vi.clearAllMocks());

// ⚠️ **番号の予約は起動中ずっと残る**（#712・α-7 出口監査 🟡）＝素材の番号を使い回すと、
// 前の写真を上書きする。テストの間は毎回まっさらにする（**ファイルの直下に置く**＝
// describe の中に入れると、その describe のテストにしか効かない）。
afterEach(() => resetAssetIdReservations());

describe('よく使う素材からの取り込み（🟡9）', () => {
  it('コピーの間に別の動画を開いたら、その動画へ素材を生やさない', async () => {
    vi.mocked(copyLibraryAssetToProject).mockImplementation(async () => {
      openAnotherProject();
      return 'assets/asset_001.png';
    });
    const id = await useProjectStore.getState().importFromLibrary('lib_asset_001');
    expect(id).toBeNull();
    expect(useProjectStore.getState().assets).toHaveLength(0);
  });

  /** ⚠️ **写真も大きさを測る**（🟡10）＝測らないと「ぼやける素材」の注意がこの経路だけ出ない。 */
  it('取り込んだ写真の大きさを測る（ぼやける注意の材料）', async () => {
    vi.mocked(copyLibraryAssetToProject).mockResolvedValue('assets/asset_001.png');
    const id = await useProjectStore.getState().importFromLibrary('lib_asset_001');
    expect(id).toBe('asset_001');
    expect(vi.mocked(probeImageSize)).toHaveBeenCalled();
    expect(useProjectStore.getState().assets[0]?.metadata).toEqual({ width: 1920, height: 1080 });
  });
});

describe('会社の見た目を新しい動画へ（🟡21）', () => {
  it('読み直している間に別の動画を開いたら、その動画の文字の形を変えない', async () => {
    vi.mocked(loadBrandKit).mockImplementation(async () => {
      openAnotherProject();
      return { fontId: 'gen-interface-jp-display' };
    });
    await useProjectStore.getState().applyBrandKitToNew();
    expect(useProjectStore.getState().meta.videoSettings.fontId).toBeUndefined();
  });
});
