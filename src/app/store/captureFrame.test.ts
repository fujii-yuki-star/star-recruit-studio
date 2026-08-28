// 動画から静止画を切り出す（#349）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../infrastructure/assetFs', async (orig) => ({
  ...(await orig<typeof import('../../infrastructure/assetFs')>()),
  extractVideoFrame: vi.fn(),
  assetDisplayUrl: vi.fn(async () => 'asset://frame.png'),
}));

import { useProjectStore } from './projectStore';
import { extractVideoFrame } from '../../infrastructure/assetFs';
import { ASSET_TYPE } from '../../domain/enums';
import type { Asset } from '../../domain/project/types';

const video: Asset = {
  assetId: 'asset_001',
  assetType: ASSET_TYPE.video,
  displayName: '会社紹介',
  filePath: 'assets/asset_001.mp4',
};

function setup(over: Partial<{ assets: Asset[]; projectId: string }> = {}): void {
  const meta = useProjectStore.getState().meta;
  useProjectStore.setState({
    assets: over.assets ?? [video],
    meta: { ...meta, projectId: over.projectId ?? 'proj_20260828_001' },
    importError: null,
    isImporting: false,
  } as never);
}

beforeEach(() => {
  setup();
  vi.mocked(extractVideoFrame).mockResolvedValue('assets/asset_002.png');
});
afterEach(() => vi.clearAllMocks());

describe('captureVideoFrame', () => {
  it('切り出した絵を普通の写真素材として足す', async () => {
    const id = await useProjectStore.getState().captureVideoFrame('asset_001', 30);
    expect(id).toBe('asset_002');
    const added = useProjectStore.getState().assets.find((a) => a.assetId === 'asset_002');
    expect(added).toMatchObject({
      assetType: ASSET_TYPE.image,
      displayName: '会社紹介（0:30）', // 一覧で見分けられる名前（#349）
      filePath: 'assets/asset_002.png',
    });
  });

  it('切り出しの結果のパスを使う（Rust が返した場所を信じる）', async () => {
    vi.mocked(extractVideoFrame).mockResolvedValue('assets/別の場所.png');
    await useProjectStore.getState().captureVideoFrame('asset_001', 0);
    const list = useProjectStore.getState().assets;
    expect(list[list.length - 1].filePath).toBe('assets/別の場所.png');
  });

  it('表示用の絵を読み込む（一覧にすぐ出る）', async () => {
    await useProjectStore.getState().captureVideoFrame('asset_001', 0);
    expect(useProjectStore.getState().assetSrcById.asset_002).toBe('asset://frame.png');
  });

  /**
   * ⚠️ **できてから一覧へ足す**（取り込みの楽観追加と違う）＝切り出しは失敗しうる（尺の外・壊れた動画）ので、
   * 先に足すと**中身の無い素材**が一瞬見えてから消える。
   */
  it('失敗したら素材を増やさず、理由を出す', async () => {
    vi.mocked(extractVideoFrame).mockRejectedValue('その時間には映像がありませんでした。');
    const id = await useProjectStore.getState().captureVideoFrame('asset_001', 999);
    expect(id).toBeNull();
    expect(useProjectStore.getState().assets).toHaveLength(1);
    expect(useProjectStore.getState().importError).toContain('その時間には映像がありません');
  });

  it('動画でない素材は切り出さない（次の行動を出す）', async () => {
    setup({ assets: [{ ...video, assetType: ASSET_TYPE.image }] });
    expect(await useProjectStore.getState().captureVideoFrame('asset_001', 0)).toBeNull();
    expect(useProjectStore.getState().importError).toContain('先に動画を取り込んで');
    expect(extractVideoFrame).not.toHaveBeenCalled();
  });

  /** ⚠️ 保存前のプロジェクトでは元の動画がまだフォルダに無い。 */
  it('プロジェクトが保存されていなければ切り出さない', async () => {
    setup({ projectId: '' });
    expect(await useProjectStore.getState().captureVideoFrame('asset_001', 0)).toBeNull();
    expect(extractVideoFrame).not.toHaveBeenCalled();
  });

  it('取り込み中は断る（二重に走らせない）', async () => {
    useProjectStore.setState({ isImporting: true });
    expect(await useProjectStore.getState().captureVideoFrame('asset_001', 0)).toBeNull();
    expect(extractVideoFrame).not.toHaveBeenCalled();
  });

  /** ⚠️ 書き出し中は文書を固定する（設定した意味どおりの MP4 にする・#570 P1）。 */
  it('書き出し中は断る', async () => {
    useProjectStore.getState().setExportRun({ phase: 'rendering' });
    expect(await useProjectStore.getState().captureVideoFrame('asset_001', 0)).toBeNull();
    expect(extractVideoFrame).not.toHaveBeenCalled();
    useProjectStore.getState().setExportRun({ phase: 'idle' });
  });

  it('終わったら取り込み中の印を必ず下ろす（失敗しても固まらない）', async () => {
    vi.mocked(extractVideoFrame).mockRejectedValue('だめ');
    await useProjectStore.getState().captureVideoFrame('asset_001', 0);
    expect(useProjectStore.getState().isImporting).toBe(false);
  });
});
