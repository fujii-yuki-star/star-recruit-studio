// ブランドキットの適用（ADR-0036 決定2・決定3・#351）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../infrastructure/brandKitFs', () => ({
  loadBrandKit: vi.fn(),
  saveBrandKit: vi.fn(async () => {}),
}));

import { useProjectStore } from './projectStore';
import { loadBrandKit } from '../../infrastructure/brandKitFs';
import { ASSET_TYPE } from '../../domain/enums';
import type { Asset } from '../../domain/project/types';

const logo: Asset = {
  assetId: 'asset_001',
  assetType: ASSET_TYPE.logo,
  displayName: 'ロゴ',
  filePath: 'assets/asset_001.png',
};

const importFromLibrary = vi.fn(async () => 'asset_002');

function setProject(over: { fontId?: string; assets?: Asset[]; scenes?: unknown[] } = {}): void {
  const meta = useProjectStore.getState().meta;
  useProjectStore.setState({
    meta: { ...meta, videoSettings: { ...meta.videoSettings, fontId: over.fontId } },
    assets: over.assets ?? [],
    scenes: (over.scenes ?? []) as never,
    importFromLibrary,
  } as never);
}

beforeEach(() => {
  importFromLibrary.mockClear();
  vi.mocked(loadBrandKit).mockResolvedValue({});
  useProjectStore.getState().setExportRun({ phase: 'idle' });
  setProject();
});
afterEach(() => vi.clearAllMocks());

describe('applyBrandKit（既存の動画へ「明示操作で」適用し直す＝決定3）', () => {
  it('覚えているフォントを入れる', async () => {
    useProjectStore.setState({ brandKit: { fontId: 'kaitou-yokoku-gothic' } } as never);
    setProject({ fontId: 'gen-interface-jp' });
    await useProjectStore.getState().applyBrandKit();
    expect(useProjectStore.getState().meta.videoSettings.fontId).toBe('kaitou-yokoku-gothic');
  });

  it('知らないフォントは入れない（開けない字体を既定にしない）', async () => {
    useProjectStore.setState({ brandKit: { fontId: 'my-font' } } as never);
    setProject({ fontId: 'gen-interface-jp' });
    await useProjectStore.getState().applyBrandKit();
    expect(useProjectStore.getState().meta.videoSettings.fontId).toBe('gen-interface-jp');
  });

  /** ⚠️ **ロゴは「足す」だけで置き換えない**（§2-5＝作り込みを消さない）。 */
  it('ロゴを持っていなければ足す', async () => {
    useProjectStore.setState({ brandKit: { logoLibraryAssetId: 'lib_asset_001' } } as never);
    setProject({ assets: [] });
    await useProjectStore.getState().applyBrandKit();
    expect(importFromLibrary).toHaveBeenCalledWith('lib_asset_001');
  });

  it('ロゴを持っていれば置き換えない', async () => {
    useProjectStore.setState({ brandKit: { logoLibraryAssetId: 'lib_asset_001' } } as never);
    setProject({ assets: [logo] });
    await useProjectStore.getState().applyBrandKit();
    expect(importFromLibrary).not.toHaveBeenCalled();
  });

  /**
   * ⚠️ **フォントだけ変わる場面でも、ロゴは置き換えない**。
   * 上のケースは「何も変わらない」ので早い段階で戻ってしまい、**ロゴの枝を通らない**
   *（変異チェックで生き残った＝テストが枝を踏んでいなかった）。フォントの変更を混ぜて通す。
   */
  it('フォントは変わるがロゴは持っている＝ロゴだけ置き換えない', async () => {
    useProjectStore.setState({
      brandKit: { fontId: 'kaitou-yokoku-gothic', logoLibraryAssetId: 'lib_asset_001' },
    } as never);
    setProject({ fontId: 'gen-interface-jp', assets: [logo] });
    await useProjectStore.getState().applyBrandKit();
    expect(useProjectStore.getState().meta.videoSettings.fontId).toBe('kaitou-yokoku-gothic');
    expect(importFromLibrary).not.toHaveBeenCalled();
  });

  /** ⚠️ **何も変わらないなら履歴を積まない**（「取り消す」が空振りしない）。 */
  it('何も変わらないなら履歴を積まない', async () => {
    useProjectStore.setState({ brandKit: { fontId: 'gen-interface-jp' } } as never);
    setProject({ fontId: 'gen-interface-jp' });
    const before = useProjectStore.getState().past.length;
    await useProjectStore.getState().applyBrandKit();
    expect(useProjectStore.getState().past).toHaveLength(before);
  });

  it('変わるときは取り消せる（履歴を積む）', async () => {
    useProjectStore.setState({ brandKit: { fontId: 'kaitou-yokoku-gothic' } } as never);
    setProject({ fontId: 'gen-interface-jp' });
    const before = useProjectStore.getState().past.length;
    await useProjectStore.getState().applyBrandKit();
    expect(useProjectStore.getState().past.length).toBeGreaterThan(before);
  });

  /** ⚠️ 書き出し中は文書を固定する（設定した意味どおりの MP4 にする・#570 P1）。 */
  it('書き出し中は何もしない', async () => {
    useProjectStore.setState({ brandKit: { fontId: 'kaitou-yokoku-gothic' } } as never);
    setProject({ fontId: 'gen-interface-jp' });
    useProjectStore.getState().setExportRun({ phase: 'rendering' });
    await useProjectStore.getState().applyBrandKit();
    expect(useProjectStore.getState().meta.videoSettings.fontId).toBe('gen-interface-jp');
    useProjectStore.getState().setExportRun({ phase: 'idle' });
  });
});

describe('applyBrandKitToNew（新しい動画へ焼き込む＝決定2）', () => {
  it('覚えているフォントとロゴを入れる', async () => {
    vi.mocked(loadBrandKit).mockResolvedValue({ fontId: 'kaitou-yokoku-gothic', logoLibraryAssetId: 'lib_asset_001' });
    await useProjectStore.getState().applyBrandKitToNew();
    expect(useProjectStore.getState().meta.videoSettings.fontId).toBe('kaitou-yokoku-gothic');
    expect(importFromLibrary).toHaveBeenCalledWith('lib_asset_001');
  });

  /** ⚠️ **読み直してから使う**＝設定画面で変えた直後でも新しい動画に効く。 */
  it('キットを読み直してから使う', async () => {
    useProjectStore.setState({ brandKit: {} } as never);
    vi.mocked(loadBrandKit).mockResolvedValue({ fontId: 'kaitou-yokoku-gothic' });
    await useProjectStore.getState().applyBrandKitToNew();
    expect(loadBrandKit).toHaveBeenCalled();
    expect(useProjectStore.getState().meta.videoSettings.fontId).toBe('kaitou-yokoku-gothic');
  });

  it('何も覚えていなければ何もしない', async () => {
    setProject({ fontId: 'gen-interface-jp' });
    await useProjectStore.getState().applyBrandKitToNew();
    expect(useProjectStore.getState().meta.videoSettings.fontId).toBe('gen-interface-jp');
    expect(importFromLibrary).not.toHaveBeenCalled();
  });

  /** ⚠️ **新しい動画にはロゴの有無に関わらず入れる**（既存への適用と違い、まっさらだから）。 */
  it('新しい動画ではロゴの有無を見ない（まっさらなので必ず入れる）', async () => {
    vi.mocked(loadBrandKit).mockResolvedValue({ logoLibraryAssetId: 'lib_asset_001' });
    setProject({ assets: [logo] });
    await useProjectStore.getState().applyBrandKitToNew();
    expect(importFromLibrary).toHaveBeenCalledWith('lib_asset_001');
  });
});
