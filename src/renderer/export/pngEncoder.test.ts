// @vitest-environment jsdom
// 焼いた canvas を PNG のバイトにする（書き出しの高速化 2026-10-23）。
// ⚠️ 別スレッドが使えない環境では、今までどおり `toDataURL` の PNG を同じバイトで返す。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dataUrlToBytes, encodePngLater } from './pngEncoder';

afterEach(() => vi.restoreAllMocks());

describe('pngEncoder', () => {
  it('data URL のバイトへ戻す（base64 をそのまま解く）', () => {
    expect([...dataUrlToBytes('data:image/png;base64,iVBORw==')]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('別スレッドが使えないときは toDataURL の PNG をそのまま返す（絵は同じ）', async () => {
    // jsdom には Worker・OffscreenCanvas が無い＝受け皿の道を通る。
    expect(typeof OffscreenCanvas).toBe('undefined');
    const canvas = document.createElement('canvas');
    const toDataURL = vi.spyOn(canvas, 'toDataURL').mockReturnValue('data:image/png;base64,iVBORw==');
    const { bytes } = await encodePngLater(canvas);
    expect(toDataURL).toHaveBeenCalledWith('image/png');
    expect([...(await bytes)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});
