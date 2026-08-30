// 会社の見た目を**読めなかったとき**は書かせない（差分再監査 3巡目・PR #912 レビュー ℹ️）。
//
// ⚠️ **空に潰すと消える**＝「何も覚えていない」に見せた直後の書き込みが、覚えていた字体・色・ロゴを
// **そのまま上書き**する。目録（`parse_manifest`）も読み方辞書も、同じ状況では断ってファイルを守る。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../infrastructure/brandKitFs', () => ({
  loadBrandKit: vi.fn(),
  saveBrandKit: vi.fn(async () => {}),
}));

import { useProjectStore } from './projectStore';
import { loadBrandKit, saveBrandKit } from '../../infrastructure/brandKitFs';

beforeEach(() => {
  useProjectStore.setState({ brandKit: { fontId: 'gen-interface-jp' }, brandKitUnreadable: false, brandKitError: null } as never);
});
afterEach(() => vi.clearAllMocks());

describe('会社の見た目が読めないとき', () => {
  it('読めなかったら、覚えている中身を空に潰さない', async () => {
    vi.mocked(loadBrandKit).mockResolvedValue(null);
    await useProjectStore.getState().refreshBrandKit();
    expect(useProjectStore.getState().brandKit.fontId).toBe('gen-interface-jp'); // 前の中身のまま
    expect(useProjectStore.getState().brandKitUnreadable).toBe(true);
  });

  it('読めていない間は書かない（理由を出す）', async () => {
    vi.mocked(loadBrandKit).mockResolvedValue(null);
    await useProjectStore.getState().refreshBrandKit();
    const ok = await useProjectStore.getState().updateBrandKit({ fontId: 'kaitou-yokoku-gothic' });
    expect(ok).toBe(false);
    expect(vi.mocked(saveBrandKit)).not.toHaveBeenCalled();
    expect(useProjectStore.getState().brandKitError).toMatch(/読めませんでした/);
  });

  it('読めたら、また書ける', async () => {
    vi.mocked(loadBrandKit).mockResolvedValue({ fontId: 'gen-interface-jp' });
    await useProjectStore.getState().refreshBrandKit();
    expect(useProjectStore.getState().brandKitUnreadable).toBe(false);
    expect(await useProjectStore.getState().updateBrandKit({ fontId: 'kaitou-yokoku-gothic' })).toBe(true);
  });
});
