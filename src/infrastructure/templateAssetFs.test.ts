import { describe, expect, it } from 'vitest';
import { deleteTemplateAsset, fileExt, importTemplateAsset, loadTemplateAssetUrls } from './templateAssetFs';

describe('fileExt', () => {
  it('ファイル名の拡張子（小文字）を優先、無ければ mime、どちらも無ければ png', () => {
    expect(fileExt('bg.PNG', 'image/png')).toBe('png');
    expect(fileExt('photo.jpeg', '')).toBe('jpeg');
    expect(fileExt('noext', 'image/webp')).toBe('webp');
    expect(fileExt('', '')).toBe('png');
  });
});

describe('templateAssetFs（非 Tauri は no-op／空）', () => {
  it('loadTemplateAssetUrls は非 Tauri で空オブジェクト', async () => {
    expect(await loadTemplateAssetUrls()).toEqual({});
  });
  it('importTemplateAsset は非 Tauri で null（File に触れず短絡）', async () => {
    expect(await importTemplateAsset({} as File, [])).toBeNull();
  });
  it('deleteTemplateAsset は非 Tauri で例外を投げない', async () => {
    await expect(deleteTemplateAsset('tmpl_asset_001')).resolves.toBeUndefined();
  });
});
