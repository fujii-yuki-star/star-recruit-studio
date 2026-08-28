import { describe, expect, it } from 'vitest';
import {
  CREDIT_MODE, CREDIT_SECONDS_MAX, CREDIT_SECONDS_MIN, creditClipboardText, creditVisibleAt,
  DEFAULT_CREDIT_MODE, DEFAULT_CREDIT_SECONDS, resolveCreditDisplay,
} from './creditDisplay';

describe('resolveCreditDisplay（既定で埋める・#359）', () => {
  // ⚠️ **既定は「最初と最後」**（ADR-0025 の利用者決定）＝設定していない動画の見え方が変わらない。
  it('未指定なら最初と最後・3秒', () => {
    expect(resolveCreditDisplay(undefined)).toEqual({ mode: DEFAULT_CREDIT_MODE, seconds: DEFAULT_CREDIT_SECONDS });
    expect(DEFAULT_CREDIT_MODE).toBe(CREDIT_MODE.both);
  });

  it('秒は範囲に収める', () => {
    expect(resolveCreditDisplay({ seconds: 0 }).seconds).toBe(CREDIT_SECONDS_MIN);
    expect(resolveCreditDisplay({ seconds: 999 }).seconds).toBe(CREDIT_SECONDS_MAX);
  });

  // ⚠️ **壊れた値でも止めない**＝クレジットが出ないより既定で出るほうが安全（規約）。
  it('壊れた値は既定へ倒す', () => {
    expect(resolveCreditDisplay({ mode: 'nope' as never }).mode).toBe(DEFAULT_CREDIT_MODE);
    expect(resolveCreditDisplay({ seconds: Number.NaN }).seconds).toBe(DEFAULT_CREDIT_SECONDS);
  });
});

describe('creditVisibleAt（その時刻に出すか）', () => {
  const total = 60;
  const at = (mode: string, t: number, seconds = 3) =>
    creditVisibleAt({ mode: mode as never, seconds }, total, t);

  it('常に表示はいつでも出す', () => {
    for (const t of [0, 30, 60]) expect(at(CREDIT_MODE.always, t)).toBe(true);
  });

  it('非表示はいつでも出さない', () => {
    for (const t of [0, 30, 60]) expect(at(CREDIT_MODE.hidden, t)).toBe(false);
  });

  it('最初の数秒だけ', () => {
    expect(at(CREDIT_MODE.head, 0)).toBe(true);
    expect(at(CREDIT_MODE.head, 3)).toBe(true);   // 境界は含む
    expect(at(CREDIT_MODE.head, 3.1)).toBe(false);
    expect(at(CREDIT_MODE.head, 59)).toBe(false);
  });

  it('最後の数秒だけ', () => {
    expect(at(CREDIT_MODE.tail, 57)).toBe(true);  // 境界は含む
    expect(at(CREDIT_MODE.tail, 60)).toBe(true);
    expect(at(CREDIT_MODE.tail, 56.9)).toBe(false);
    expect(at(CREDIT_MODE.tail, 0)).toBe(false);
  });

  it('最初と最後は両端', () => {
    expect(at(CREDIT_MODE.both, 1)).toBe(true);
    expect(at(CREDIT_MODE.both, 59)).toBe(true);
    expect(at(CREDIT_MODE.both, 30)).toBe(false);
  });

  /**
   * ⚠️ **尺が短いときは切れ目を作らない**＝`尺 <= N` だと先頭と末尾が重なるので、
   * 途中で一瞬消える、が起きない。
   */
  it('尺が数秒より短ければ、ずっと出る', () => {
    expect(creditVisibleAt({ mode: CREDIT_MODE.both, seconds: 5 }, 4, 2)).toBe(true);
    expect(creditVisibleAt({ mode: CREDIT_MODE.head, seconds: 5 }, 4, 3.9)).toBe(true);
  });

  // ⚠️ **尺が分からないときは出す側へ倒す**＝クレジットが出ない動画を作らない（規約）。
  it('尺が分からない・時刻が壊れていれば出す', () => {
    expect(creditVisibleAt({ mode: CREDIT_MODE.both }, 0, 1)).toBe(true);
    expect(creditVisibleAt({ mode: CREDIT_MODE.both }, 60, Number.NaN)).toBe(true);
  });

  // ⚠️ **ただし「非表示」は尺が分からなくても出さない**＝利用者が選んだことを覆さない。
  it('非表示は尺が分からなくても出さない', () => {
    expect(creditVisibleAt({ mode: CREDIT_MODE.hidden }, 0, 1)).toBe(false);
  });
});

describe('creditClipboardText（貼り付ける文）', () => {
  // ⚠️ **毎回同じ文**＝貼り直すたびに順が変わると差分が読めない。
  it('重複を消して並びを決める', () => {
    expect(creditClipboardText(['VOICEVOX:春日部つむぎ', 'VOICEVOX:ずんだもん', 'VOICEVOX:ずんだもん']))
      .toBe('VOICEVOX:ずんだもん\nVOICEVOX:春日部つむぎ');
  });

  it('空なら空文字', () => {
    expect(creditClipboardText([])).toBe('');
  });
});
