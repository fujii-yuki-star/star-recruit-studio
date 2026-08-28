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

  /**
   * ⚠️ **できなかったら「反映しました」と言わせない**（PR #888 レビュー 🟡・§2-5）＝
   * ロゴの取り込みは失敗しうる（置き場から消えている等）。理由は設定画面には出ないので、返り値で運ぶ。
   */
  it('ロゴを取り込めなければ、できなかったことと理由を返す', async () => {
    importFromLibrary.mockResolvedValueOnce(null as never);
    useProjectStore.setState({ brandKit: { logoLibraryAssetId: 'lib_asset_001' } } as never);
    setProject({ assets: [] });
    useProjectStore.setState({ importError: 'この素材は見つかりませんでした。' } as never);
    const r = await useProjectStore.getState().applyBrandKit();
    expect(r.ok).toBe(false);
    expect(r.error).toContain('見つかりませんでした');
  });

  it('取り込めたときはできたことを返す', async () => {
    useProjectStore.setState({ brandKit: { logoLibraryAssetId: 'lib_asset_001' } } as never);
    setProject({ assets: [] });
    expect(await useProjectStore.getState().applyBrandKit()).toEqual({ ok: true, error: null });
  });

  it('何も変わらないときも「できた」を返す（押せない状態を作らない）', async () => {
    useProjectStore.setState({ brandKit: {} } as never);
    expect(await useProjectStore.getState().applyBrandKit()).toEqual({ ok: true, error: null });
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

/**
 * ⚠️ **どの入口から新しく作っても効く**（PR #888 レビュー 🔴）。
 * 当初は「白紙から作る」にだけ入れており、**AI で作る主経路（ウィザード）に効いていなかった**。
 * どちらも `newProject` を通るので、そこに置いて両方を固定する。
 */
describe('新しく作る入口（#888 レビュー 🔴＝主経路に効いていなかった）', () => {
  it('AI で作る主経路（newProject）でも会社の見た目が入る', async () => {
    vi.mocked(loadBrandKit).mockResolvedValue({ fontId: 'kaitou-yokoku-gothic' });
    setProject({ fontId: 'gen-interface-jp' });
    useProjectStore.getState().newProject();
    // `newProject` は投げっぱなしで呼ぶので、着地を待つ。
    await vi.waitFor(() =>
      expect(useProjectStore.getState().meta.videoSettings.fontId).toBe('kaitou-yokoku-gothic'),
    );
  });

  it('白紙から作る（newBlankProject）でも入る', async () => {
    vi.mocked(loadBrandKit).mockResolvedValue({ fontId: 'kaitou-yokoku-gothic' });
    setProject({ fontId: 'gen-interface-jp' });
    useProjectStore.getState().newBlankProject();
    await vi.waitFor(() =>
      expect(useProjectStore.getState().meta.videoSettings.fontId).toBe('kaitou-yokoku-gothic'),
    );
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
