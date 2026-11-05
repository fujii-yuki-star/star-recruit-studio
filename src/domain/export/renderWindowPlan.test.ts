// 書き出しのコマを描く窓を、いくつ足すか（ADR-0070 決定4・追補 2026-11-04）。
import { describe, expect, it } from 'vitest';
import {
  extraRenderWindows,
  RENDER_WINDOW_BYTES,
  RENDER_WINDOW_COMMIT_RESERVE_BYTES,
  RENDER_WINDOW_MAX_EXTRA,
  RENDER_WINDOW_ONE_MIN_TOTAL_BYTES,
  RENDER_WINDOW_TWO_MIN_TOTAL_BYTES,
} from './renderWindowPlan';

const GB = 1024 * 1024 * 1024;
const mem = (totalGb: number, availGb: number, commitGb: number) => ({ totalPhys: totalGb * GB, availPhys: availGb * GB, availCommit: commitGb * GB });

describe('extraRenderWindows', () => {
  it('最低検証機（14コア・16GB）は、いまの空きが少なくても上限まで足す（空きは 0.6GB・確保の余地は十分）', () => {
    expect(extraRenderWindows({ logicalCores: 14, memory: mem(16, 0.6, 8) })).toBe(RENDER_WINDOW_MAX_EXTRA);
  });

  it('積んでいるメモリで数を決める（12GB 以上で2・8GB 以上で1・それ未満は足さない）', () => {
    expect(extraRenderWindows({ logicalCores: 16, memory: { totalPhys: RENDER_WINDOW_TWO_MIN_TOTAL_BYTES, availPhys: 0, availCommit: 20 * GB } })).toBe(2);
    expect(extraRenderWindows({ logicalCores: 16, memory: { totalPhys: RENDER_WINDOW_TWO_MIN_TOTAL_BYTES - 1, availPhys: 0, availCommit: 20 * GB } })).toBe(1);
    expect(extraRenderWindows({ logicalCores: 16, memory: { totalPhys: RENDER_WINDOW_ONE_MIN_TOTAL_BYTES, availPhys: 0, availCommit: 20 * GB } })).toBe(1);
    expect(extraRenderWindows({ logicalCores: 16, memory: { totalPhys: RENDER_WINDOW_ONE_MIN_TOTAL_BYTES - 1, availPhys: 0, availCommit: 20 * GB } })).toBe(0);
  });

  it('確保できる余地が窓のぶんに足りなければ減らす（尽きさせない）', () => {
    const room = (n: number) => RENDER_WINDOW_COMMIT_RESERVE_BYTES + n * RENDER_WINDOW_BYTES;
    expect(extraRenderWindows({ logicalCores: 16, memory: { totalPhys: 32 * GB, availPhys: 0, availCommit: room(2) } })).toBe(2);
    expect(extraRenderWindows({ logicalCores: 16, memory: { totalPhys: 32 * GB, availPhys: 0, availCommit: room(2) - 1 } })).toBe(1);
    expect(extraRenderWindows({ logicalCores: 16, memory: { totalPhys: 32 * GB, availPhys: 0, availCommit: room(1) - 1 } })).toBe(0);
  });

  it('コアが少なければ減らす', () => {
    expect(extraRenderWindows({ logicalCores: 8, memory: mem(16, 4, 16) })).toBe(2);
    expect(extraRenderWindows({ logicalCores: 7, memory: mem(16, 4, 16) })).toBe(1);
    expect(extraRenderWindows({ logicalCores: 4, memory: mem(16, 4, 16) })).toBe(1);
    expect(extraRenderWindows({ logicalCores: 3, memory: mem(16, 4, 16) })).toBe(0);
    expect(extraRenderWindows({ logicalCores: undefined, memory: mem(16, 4, 16) })).toBe(0);
  });

  it('メモリの様子が分からなければ足さない（いままでどおり1窓）', () => {
    expect(extraRenderWindows({ logicalCores: 16, memory: null })).toBe(0);
    expect(extraRenderWindows({ logicalCores: 16, memory: undefined })).toBe(0);
    expect(extraRenderWindows({ logicalCores: 16, memory: { totalPhys: Number.NaN, availPhys: 0, availCommit: 8 * GB } })).toBe(0);
  });
});
