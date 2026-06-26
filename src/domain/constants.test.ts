import { describe, expect, it } from 'vitest';
import {
  dimsForOrientation, exportDimsForOrientation, HD_SHORT, HEIGHT, PORTRAIT_HEIGHT, PORTRAIT_WIDTH, WIDTH,
} from './constants';
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

describe('exportDimsForOrientation（書き出し寸法・向き＋画質・B5）', () => {
  it('横型: きれい=1920×1080 / 軽い=1280×720', () => {
    expect(exportDimsForOrientation(ORIENTATION.landscape, false)).toEqual({ width: 1920, height: 1080 });
    expect(exportDimsForOrientation(ORIENTATION.landscape, true)).toEqual({ width: 1280, height: 720 });
  });

  it('縦型: きれい=1080×1920 / 軽い=720×1280', () => {
    expect(exportDimsForOrientation(ORIENTATION.portrait, false)).toEqual({ width: 1080, height: 1920 });
    expect(exportDimsForOrientation(ORIENTATION.portrait, true)).toEqual({ width: 720, height: 1280 });
  });

  it('軽い(HD相当)は短辺が HD_SHORT(720) に揃う（向きによらず）', () => {
    const land = exportDimsForOrientation(ORIENTATION.landscape, true);
    const port = exportDimsForOrientation(ORIENTATION.portrait, true);
    expect(Math.min(land.width, land.height)).toBe(HD_SHORT);
    expect(Math.min(port.width, port.height)).toBe(HD_SHORT);
  });
});
