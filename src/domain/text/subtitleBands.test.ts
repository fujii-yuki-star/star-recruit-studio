// 字幕帯の積み方・描かれる矩形（ADR-0031）の字体の扱い（ADR-0063）。
import { describe, expect, it } from 'vitest';
import { DEFAULT_LINE_HEIGHT } from '../template/textStyle';
import { SUBTITLE_BAND_PAD_EM, drawnTextRect, stackedSubtitleBands } from './subtitleBands';

const KAITOU = { fontId: 'kaitou-yokoku-gothic', bold: false };
// 幅 420px・100px：見積もり（1em）なら4字が1行、怪盗予告ゴシックでは2行。
const TEXT = '採用社員';

describe('drawnTextRect：描く字体の行数で高さを出す', () => {
  const sub = { x: 0, y: 500, w: 420, h: 100, text: TEXT, fontSize: 100, maxLines: 2, anchorBottom: true, isSubtitle: true };
  it('広い字体では2行ぶんの高さ・上へ伸びる', () => {
    const lh = 100 * DEFAULT_LINE_HEIGHT;
    expect(drawnTextRect(sub).h).toBeCloseTo(lh + 100 * SUBTITLE_BAND_PAD_EM);
    const r = drawnTextRect({ ...sub, textFont: KAITOU });
    expect(r.h).toBeCloseTo(lh * 2 + 100 * SUBTITLE_BAND_PAD_EM);
    expect(r.y).toBeCloseTo(500 - lh);
  });
});

describe('stackedSubtitleBands：描く字体の行数で段を詰める', () => {
  it('広い字体で2行に折れる帯は、その上の帯をもう1行ぶん上へ', () => {
    const lh = 100 * DEFAULT_LINE_HEIGHT;
    const narrow = stackedSubtitleBands([TEXT, TEXT], 800, 420, 100, 2, 0, undefined);
    const wide = stackedSubtitleBands([TEXT, TEXT], 800, 420, 100, 2, 0, KAITOU);
    expect(wide[0]!.top).toBeCloseTo(800 - lh);
    expect(wide[1]!.y).toBeCloseTo(narrow[1]!.y - lh);
  });
});
