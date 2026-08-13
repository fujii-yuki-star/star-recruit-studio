import { describe, expect, it } from 'vitest';
import { PER_USE_MAP_KEYS, perUseEntriesFor, prunePerUseMaps, withPerUseEntries } from './perUseMaps';
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

describe('perUseEntriesFor / withPerUseEntries（複製・貼り付けの引き継ぎ・#770）', () => {
  it('元の3項目を取り出して、複製先の id で入れる（設定が落ちた別物にしない）', () => {
    const m = maps();
    const r = withPerUseEntries(m, 'free_002', perUseEntriesFor(m, 'free_001'));
    expect(r.slotFits?.free_002).toEqual(m.slotFits?.free_001);
    expect(r.slotClips?.free_002).toEqual(m.slotClips?.free_001);
    expect(r.slotVideoStart?.free_002).toEqual(m.slotVideoStart?.free_001);
    expect(r.slotClips?.free_001).toEqual(m.slotClips?.free_001); // 元はそのまま
  });

  it('別の場面へ入れられる（貼り付けは元と違う場面のことがある）', () => {
    const src = maps();
    const dest: PerUseMaps = { slotClips: { other: { speed: 4 } } };
    const r = withPerUseEntries(dest, 'free_009', perUseEntriesFor(src, 'free_001'));
    expect(r.slotClips).toEqual({ other: { speed: 4 }, free_009: src.slotClips?.free_001 });
    expect(r.slotFits?.free_009).toEqual(src.slotFits?.free_001);
  });

  it('元が持っていない項目は運ばない（意味のない既定値を書き込まない）', () => {
    const src: PerUseMaps = { slotClips: { free_001: { speed: 2 } } };
    expect(perUseEntriesFor(src, 'free_001')).toEqual({ slotClips: { speed: 2 } });
    const r = withPerUseEntries(src, 'free_002', perUseEntriesFor(src, 'free_001'));
    expect(r.slotFits).toBeUndefined();
    expect(r.slotVideoStart).toBeUndefined();
  });

  it('元が持っていない項目は、貼り先に残っていても落とす（複製に憑依させない）', () => {
    // 新しい id には本来何も無いはずだが、古い動画には孤児エントリが残りうる（#566 より前）。
    // 残すと「元が持っていない設定が複製にだけ効く」＝ADR-0028 D6 の憑依。
    const src: PerUseMaps = { slotClips: { free_001: { speed: 2 } } };
    const dest: PerUseMaps = { slotClips: { free_009: { speed: 8 } }, slotVideoStart: { free_009: { mode: 'delay', delaySec: 9 } } };
    const r = withPerUseEntries(dest, 'free_009', perUseEntriesFor(src, 'free_001'));
    expect(r.slotClips?.free_009).toEqual({ speed: 2 }); // 元の値で上書き
    expect(r.slotVideoStart).toBeUndefined(); // 元が持っていない＝落とす（空になったマップは undefined）
  });

  it('入れるものも消すものも無ければ同一参照を返す（未保存/履歴を無駄に作らない）', () => {
    const m = maps();
    // 貼り先は未使用の id（複製で採る id は常に未使用）＝足すものも落とすものも無い。
    const r = withPerUseEntries(m, 'free_009', perUseEntriesFor(m, 'free_999'));
    expect(r.slotFits).toBe(m.slotFits);
    expect(r.slotClips).toBe(m.slotClips);
    expect(r.slotVideoStart).toBe(m.slotVideoStart);
  });

});

describe('per-use 3マップの足並み（ADR-0028 D6・#770）', () => {
  // D6＝「掃除/複製は3マップ共通のヘルパ1か所」。**どれか1つの関数だけ足し忘れる**のが怖い形なので、
  // 顔ぶれ（PER_USE_MAP_KEYS）を回して「落とす・取り出す→入れる」の全部が各キーを面倒みるか確かめる。
  // マップを増やすと `PER_USE_MAP_KEYS` と下の見本がコンパイルエラーになり、ここが新しいキーも検査し始める。
  const sample: { [K in keyof PerUseMaps]-?: NonNullable<PerUseMaps[K]>[string] } = {
    slotFits: 'cover',
    slotClips: { speed: 2 },
    slotVideoStart: { mode: 'afterAnim' },
  };

  for (const key of Object.keys(PER_USE_MAP_KEYS) as (keyof PerUseMaps)[]) {
    it(`${key}：複製が運び、掃除が落とす`, () => {
      const scene = { [key]: { free_001: sample[key] } } as PerUseMaps;
      const carried = withPerUseEntries(scene, 'free_009', perUseEntriesFor(scene, 'free_001'));
      expect(carried[key]?.['free_009'], `${key} を複製が運んでいない`).toEqual(sample[key]);
      expect(prunePerUseMaps(scene, ['free_001'])[key], `${key} を掃除が落としていない`).toBeUndefined();
    });
  }
});
