import { describe, expect, it } from 'vitest';
import { dimsForOrientation, HEIGHT, PORTRAIT_HEIGHT, PORTRAIT_WIDTH, WIDTH } from './constants';

describe('dimsForOrientation（向き→出力寸法・ADR-0012）', () => {
  it('16:9 は横型フル寸法を返す', () => {
    expect(dimsForOrientation('16:9')).toEqual({ width: WIDTH, height: HEIGHT });
    expect(dimsForOrientation('16:9')).toEqual({ width: 1920, height: 1080 });
  });

  it('9:16 は縦型寸法（1080×1920）を返す', () => {
    expect(dimsForOrientation('9:16')).toEqual({ width: PORTRAIT_WIDTH, height: PORTRAIT_HEIGHT });
    expect(dimsForOrientation('9:16')).toEqual({ width: 1080, height: 1920 });
  });
});
