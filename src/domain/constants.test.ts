import { describe, expect, it } from 'vitest';
import { dimsForOrientation, HEIGHT, PORTRAIT_HEIGHT, PORTRAIT_WIDTH, WIDTH } from './constants';
import { ORIENTATION } from './enums';

describe('dimsForOrientation（向き→出力寸法・ADR-0012）', () => {
  it('横型(16:9)はフル寸法を返す', () => {
    expect(dimsForOrientation(ORIENTATION.landscape)).toEqual({ width: WIDTH, height: HEIGHT });
    expect(dimsForOrientation(ORIENTATION.landscape)).toEqual({ width: 1920, height: 1080 });
  });

  it('縦型(9:16)は縦寸法（1080×1920）を返す', () => {
    expect(dimsForOrientation(ORIENTATION.portrait)).toEqual({ width: PORTRAIT_WIDTH, height: PORTRAIT_HEIGHT });
    expect(dimsForOrientation(ORIENTATION.portrait)).toEqual({ width: 1080, height: 1920 });
  });
});
