import { describe, expect, it } from 'vitest';
import { prunePerUseMaps } from './perUseMaps';
import type { PerUseMaps } from './perUseMaps';

// ADR-0028 D6：スロットが消滅したら per-use の3マップ（slotFits/slotClips/slotVideoStart）とも当該キーを掃除する。
const maps = (): PerUseMaps => ({
  slotFits: { free_001: 'cover', free_002: 'contain' },
  slotClips: { free_001: { speed: 2 }, free_002: { startSec: 1 } },
  slotVideoStart: { free_001: { mode: 'delay', delaySec: 1 }, free_002: { mode: 'afterAnim' } },
});

describe('prunePerUseMaps（per-use マップの掃除・ADR-0028 D6）', () => {
  it('消えたスロットのキーを3マップとも落とす', () => {
    const r = prunePerUseMaps(maps(), ['free_001']);
    expect(r.slotFits).toEqual({ free_002: 'contain' });
    expect(r.slotClips).toEqual({ free_002: { startSec: 1 } });
    expect(r.slotVideoStart).toEqual({ free_002: { mode: 'afterAnim' } });
  });

  it('複数まとめて落とせる', () => {
    const r = prunePerUseMaps(maps(), ['free_001', 'free_002']);
    expect(r.slotFits).toBeUndefined();
    expect(r.slotClips).toBeUndefined();
    expect(r.slotVideoStart).toBeUndefined();
  });

  it('全部消えたら undefined（意味のない {} を永続化しない）', () => {
    const r = prunePerUseMaps({ slotClips: { free_001: { speed: 2 } } }, ['free_001']);
    expect(r.slotClips).toBeUndefined();
  });

  it('関係ないキーは触らない（休眠している通常配置のキーを巻き込まない）', () => {
    // ADR-0030 の非破壊往復で、FREE 場面にも通常テンプレのスロット（layer.id）が休眠しうる。
    const m: PerUseMaps = { slotClips: { mainVisual: { speed: 2 }, free_001: { speed: 3 } } };
    expect(prunePerUseMaps(m, ['free_001']).slotClips).toEqual({ mainVisual: { speed: 2 } });
  });

  it('変化が無ければ同一参照を返す（未保存/履歴を無駄に作らない）', () => {
    const m = maps();
    const r = prunePerUseMaps(m, ['free_999']);
    expect(r.slotFits).toBe(m.slotFits);
    expect(r.slotClips).toBe(m.slotClips);
    expect(r.slotVideoStart).toBe(m.slotVideoStart);
  });

  it('空の removedIds は素通し（同一参照）', () => {
    const m = maps();
    const r = prunePerUseMaps(m, []);
    expect(r.slotClips).toBe(m.slotClips);
  });

  it('マップが未設定でも壊れない', () => {
    expect(prunePerUseMaps({}, ['free_001'])).toEqual({ slotFits: undefined, slotClips: undefined, slotVideoStart: undefined });
  });
});
