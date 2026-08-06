// 書き出しに渡す素材の絵（#716）。**表示用の URL を渡さない**という不変条件を、ここで固定する。
import { describe, expect, it, vi, afterEach } from 'vitest';
import { createExportSrcResolver, resolveExportSrcMap } from './assetExportSrc';
import * as assetFsMod from '../../infrastructure/assetFs';
import type { Asset } from '../../domain/project/types';

const photo: Asset = { assetId: 'asset_001', assetType: 'image', displayName: '写真', filePath: 'assets/asset_001.png' };
const movie: Asset = { assetId: 'asset_002', assetType: 'video', displayName: '動画', filePath: 'assets/asset_002.mp4', thumbnailPath: 'assets/thumb_002.png' };
const bgm: Asset = { assetId: 'asset_003', assetType: 'bgm', displayName: '曲', filePath: 'assets/asset_003.mp3' };

const make = (over: Partial<Parameters<typeof createExportSrcResolver>[0]> = {}) =>
  createExportSrcResolver({ projectId: 'proj_1', assets: [photo, movie, bgm], templateAssetSrcById: { tmpl_asset_001: 'data:image/png;base64,TMPL' }, ...over });

afterEach(() => { vi.restoreAllMocks(); });

describe('createExportSrcResolver（書き出しで描ける絵に解く）', () => {
  it('写真は本体を data URL にする（表示用の `asset://` を返さない）', async () => {
    const read = vi.spyOn(assetFsMod, 'readAssetDataUrl').mockResolvedValue('data:image/png;base64,PHOTO');
    await expect(make()('asset_001')).resolves.toBe('data:image/png;base64,PHOTO');
    expect(read).toHaveBeenCalledWith('proj_1', 'assets/asset_001.png');
  });

  it('動画は本体でなく代表フレームを返す（大容量を載せない）', async () => {
    const read = vi.spyOn(assetFsMod, 'readAssetDataUrl').mockResolvedValue('data:image/png;base64,THUMB');
    await expect(make()('asset_002')).resolves.toBe('data:image/png;base64,THUMB');
    expect(read).toHaveBeenCalledWith('proj_1', 'assets/thumb_002.png'); // 本体（.mp4）ではない
  });

  it('代表フレームが無い動画は返さない（本体を載せて代用しない）', async () => {
    const read = vi.spyOn(assetFsMod, 'readAssetDataUrl').mockResolvedValue('data:image/png;base64,X');
    const r = createExportSrcResolver({ projectId: 'proj_1', assets: [{ ...movie, thumbnailPath: undefined }], templateAssetSrcById: {} });
    await expect(r('asset_002')).resolves.toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });

  it('見た目パターンの既定素材は、そのまま返す（既に data URL）', async () => {
    const read = vi.spyOn(assetFsMod, 'readAssetDataUrl');
    await expect(make()('tmpl_asset_001')).resolves.toBe('data:image/png;base64,TMPL');
    expect(read).not.toHaveBeenCalled(); // ディスクを読みに行かない
  });

  it('この動画が持っていない素材・動画を開いていないときは返さない', async () => {
    await expect(make()('asset_999')).resolves.toBeUndefined();
    await expect(make({ projectId: undefined })('asset_001')).resolves.toBeUndefined();
  });

  it('読めなかったときは返さない（読めない絵を描いたことにしない）', async () => {
    vi.spyOn(assetFsMod, 'readAssetDataUrl').mockResolvedValue(null);
    await expect(make()('asset_001')).resolves.toBeUndefined();
  });
});

describe('resolveExportSrcMap（まとめて解く）', () => {
  it('解けたものだけを持つ（解けなかった id は**キーごと**入らない）', async () => {
    const resolve = vi.fn(async (id: string) => (id === 'a' ? 'data:1' : undefined));
    const map = await resolveExportSrcMap(['a', 'b'], resolve);
    // ⚠️ `toEqual` は値が undefined のキーを無視するので、**キーの一覧**で見る
    //（`{a:'data:1', b: undefined}` も `toEqual({a:'data:1'})` を通ってしまう）。
    expect(Object.keys(map)).toEqual(['a']);
    expect(map).toEqual({ a: 'data:1' });
  });

  it('渡された id のぶんだけ解く（使っていない素材を読まない）', async () => {
    const resolve = vi.fn(async () => 'data:1');
    await resolveExportSrcMap(['a', 'b'], resolve);
    expect(resolve).toHaveBeenCalledTimes(2);
  });
});
