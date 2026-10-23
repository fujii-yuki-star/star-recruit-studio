// 書き出しのコマを描く窓を、いくつ足すか（ADR-0070 決定4）。
import { describe, expect, it } from 'vitest';
import { extraRenderWindows, RENDER_WINDOW_BYTES, RENDER_WINDOW_MAX_EXTRA, RENDER_WINDOW_RESERVE_BYTES } from './renderWindowPlan';

const GB = 1024 * 1024 * 1024;
const roomFor = (n: number) => RENDER_WINDOW_RESERVE_BYTES + n * RENDER_WINDOW_BYTES;

describe('extraRenderWindows', () => {
  it('コアもメモリも十分なら上限まで（最低検証機＝14コア・空き約6GB）', () => {
    expect(extraRenderWindows({ logicalCores: 14, availableBytes: 6 * GB })).toBe(RENDER_WINDOW_MAX_EXTRA);
  });

  it('メモリの空きで減らす（窓1つぶんずつ・残しておく空きは使わない）', () => {
    expect(extraRenderWindows({ logicalCores: 16, availableBytes: roomFor(2) })).toBe(2);
    expect(extraRenderWindows({ logicalCores: 16, availableBytes: roomFor(2) - 1 })).toBe(1);
    expect(extraRenderWindows({ logicalCores: 16, availableBytes: roomFor(1) - 1 })).toBe(0);
    expect(extraRenderWindows({ logicalCores: 16, availableBytes: 1 * GB })).toBe(0);
  });

  it('コアが少なければ減らす', () => {
    expect(extraRenderWindows({ logicalCores: 8, availableBytes: 16 * GB })).toBe(2);
    expect(extraRenderWindows({ logicalCores: 7, availableBytes: 16 * GB })).toBe(1);
    expect(extraRenderWindows({ logicalCores: 4, availableBytes: 16 * GB })).toBe(1);
    expect(extraRenderWindows({ logicalCores: 3, availableBytes: 16 * GB })).toBe(0);
    expect(extraRenderWindows({ logicalCores: undefined, availableBytes: 16 * GB })).toBe(0);
  });

  it('空きが分からなければ足さない（いままでどおり1窓）', () => {
    expect(extraRenderWindows({ logicalCores: 16, availableBytes: null })).toBe(0);
    expect(extraRenderWindows({ logicalCores: 16, availableBytes: undefined })).toBe(0);
    expect(extraRenderWindows({ logicalCores: 16, availableBytes: Number.NaN })).toBe(0);
  });
});
