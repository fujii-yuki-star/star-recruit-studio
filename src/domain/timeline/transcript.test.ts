// 声を文字にした結果をタイムラインの言葉にする（ADR-0058・#1387）。
import { describe, expect, it } from 'vitest';
import { transcriptCues, transcriptCuts, transcriptLinesOf } from './transcript';

const clip = { startSec: 10, durationSec: 20, speed: undefined };

describe('transcriptLinesOf', () => {
  it('切り出した範囲の秒を、置いた位置へずらす・空の文と前後の空白を落とす', () => {
    expect(transcriptLinesOf(clip, [
      { startSec: 0.3, endSec: 5, text: ' こんにちは。' },
      { startSec: 5, endSec: 6, text: '   ' },
      { startSec: 6, endSec: 9, text: '藤井です' },
    ])).toEqual([
      { startSec: 10.3, endSec: 15, text: 'こんにちは。' },
      { startSec: 16, endSec: 19, text: '藤井です' },
    ]);
  });

  it('速さを反映する（2倍速なら素材の2秒がタイムラインの1秒）', () => {
    expect(transcriptLinesOf({ ...clip, speed: 2 }, [{ startSec: 4, endSec: 8, text: 'あ' }]))
      .toEqual([{ startSec: 12, endSec: 14, text: 'あ' }]);
  });

  it('部品の外へ出た所は切り詰め、出きった区切りは落とす', () => {
    expect(transcriptLinesOf(clip, [
      { startSec: 18, endSec: 25, text: '終わりをはみ出す' },
      { startSec: 21, endSec: 24, text: '外' },
    ])).toEqual([{ startSec: 28, endSec: 30, text: '終わりをはみ出す' }]);
  });
});

describe('transcriptCues', () => {
  it('直した文を使い、空にした行は出さず、時刻順に並べる', () => {
    expect(transcriptCues([
      { startSec: 5, endSec: 6, text: '後' },
      { startSec: 1, endSec: 2, text: ' 前 ' },
      { startSec: 3, endSec: 4, text: '' },
    ])).toEqual([
      { startSec: 1, endSec: 2, text: '前' },
      { startSec: 5, endSec: 6, text: '後' },
    ]);
  });
});

describe('transcriptCuts', () => {
  const fps = 30;
  it('つながる行・1コマ未満の隙間はまとめ、離れた行は別の区間にする', () => {
    const cuts = transcriptCuts([
      { startSec: 1, endSec: 2, text: 'a' },
      { startSec: 2.02, endSec: 3, text: 'b' }, // 隙間 0.02 秒＜1コマ
      { startSec: 5, endSec: 6, text: 'c' },
    ], fps);
    expect(cuts).toEqual([{ startSec: 1, endSec: 3 }, { startSec: 5, endSec: 6 }]);
  });

  it('長い行の中に収まる短い行があっても、長い方の終わりを保つ', () => {
    expect(transcriptCuts([
      { startSec: 1, endSec: 5, text: '長い' },
      { startSec: 2, endSec: 3, text: '中' },
    ], fps)).toEqual([{ startSec: 1, endSec: 5 }]);
  });

  it('コマへ内側に丸める（頭は切り上げ・終わりは切り下げ）', () => {
    const [c] = transcriptCuts([{ startSec: 1.01, endSec: 1.99, text: 'a' }], fps);
    expect(c.startSec).toBeCloseTo(31 / 30);
    expect(c.endSec).toBeCloseTo(59 / 30);
  });

  it('並びが前後していても時刻順に扱い、丸めて長さが無くなった区間は落とす', () => {
    expect(transcriptCuts([
      { startSec: 5, endSec: 6, text: 'c' },
      { startSec: 1, endSec: 2, text: 'a' },
      { startSec: 7.001, endSec: 7.02, text: 'ほんの一瞬' },
    ], fps)).toEqual([{ startSec: 1, endSec: 2 }, { startSec: 5, endSec: 6 }]);
  });
});
