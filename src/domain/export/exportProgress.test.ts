import { describe, expect, it } from 'vitest';
import { exportEncodePercent, exportPhaseLabel } from './exportProgress';

describe('exportEncodePercent（#376）', () => {
  it('encode は step/total を 80→92 に按分する', () => {
    expect(exportEncodePercent({ phase: 'encode', step: 0, total: 4 })).toBe(80);
    expect(exportEncodePercent({ phase: 'encode', step: 2, total: 4 })).toBe(86);
    expect(exportEncodePercent({ phase: 'encode', step: 4, total: 4 })).toBe(92);
  });

  it('encode の total=0（想定外）は基準 80% にフォールバック', () => {
    expect(exportEncodePercent({ phase: 'encode', step: 0, total: 0 })).toBe(80);
  });

  it('step>total でも上限 92% を超えない（クランプ）', () => {
    expect(exportEncodePercent({ phase: 'encode', step: 9, total: 4 })).toBe(92);
  });

  it('後段は段階的に上がる（join<telop<bgm・いずれも<100）', () => {
    const join = exportEncodePercent({ phase: 'join', step: 0, total: 0 });
    const telop = exportEncodePercent({ phase: 'telop', step: 0, total: 0 });
    const bgm = exportEncodePercent({ phase: 'bgm', step: 0, total: 0 });
    expect(join).toBeLessThan(telop);
    expect(telop).toBeLessThan(bgm);
    expect(bgm).toBeLessThan(100);
    expect(join).toBeGreaterThanOrEqual(92);
  });
});

describe('exportPhaseLabel（§2-3：技術用語を出さない）', () => {
  it('各段の文言（テロップ→字幕・非技術）', () => {
    expect(exportPhaseLabel({ phase: 'encode', step: 1, total: 1 })).toBe('映像を作成しています');
    expect(exportPhaseLabel({ phase: 'encode', step: 2, total: 4 })).toBe('映像を作成しています（2/4）');
    expect(exportPhaseLabel({ phase: 'join', step: 0, total: 0 })).toBe('つなぎ合わせています');
    expect(exportPhaseLabel({ phase: 'telop', step: 0, total: 0 })).toBe('字幕を重ねています');
    expect(exportPhaseLabel({ phase: 'bgm', step: 0, total: 0 })).toBe('BGMを合わせています');
  });

  it('encode 文言に技術用語（テロップ/エンコード/フレーム）を含まない', () => {
    const s = exportPhaseLabel({ phase: 'telop', step: 0, total: 0 });
    expect(s).not.toMatch(/テロップ|エンコード|フレーム|encode/);
  });
});
