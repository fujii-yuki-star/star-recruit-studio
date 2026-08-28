// 音の自動処理（#257 ダッキング／#259 ノーマライズ・ADR-0032 追補4）。
import { describe, expect, it } from 'vitest';
import {
  applyDucking,
  AUDIO_AUTO_DEFAULT,
  duckingFactorPoints,
  fitSpeechSpans,
  mergeSpeechSpans,
  OLD_PROJECT_AUDIO_AUTO,
  resolveAudioAuto,
  type SpeechSpan,
} from './audioAuto';

const sp = (startSec: number, endSec: number): SpeechSpan => ({ startSec, endSec });
const s = resolveAudioAuto({ duckDepth: 0.5, duckAttackSec: 0.2, duckReleaseSec: 0.4 });

describe('resolveAudioAuto', () => {
  it('未指定は既定（両方する）', () => {
    expect(resolveAudioAuto(undefined)).toEqual(AUDIO_AUTO_DEFAULT);
  });

  /** ⚠️ **既に作った動画の音を変えない**＝読み込んだ古い動画には「しない」が書き込まれる。 */
  it('前の版のファイルに書き込む値は「両方しない」', () => {
    const r = resolveAudioAuto(OLD_PROJECT_AUDIO_AUTO);
    expect(r.duckBgm).toBe(false);
    expect(r.normalize).toBe(false);
  });

  it('範囲外は収める（手で書いたファイル・別の版の値）', () => {
    const r = resolveAudioAuto({ duckDepth: 5, duckAttackSec: -1, targetLufs: 0 });
    expect(r.duckDepth).toBe(1);
    expect(r.duckAttackSec).toBe(0);
    expect(r.targetLufs).toBe(-8);
  });

  it('false は既定に化けない（明示の「しない」を尊重）', () => {
    expect(resolveAudioAuto({ duckBgm: false }).duckBgm).toBe(false);
    expect(resolveAudioAuto({ normalize: false }).normalize).toBe(false);
  });
});

describe('mergeSpeechSpans', () => {
  /** ⚠️ 掛け合いの行間で BGM が上下すると耳障り＝下げっぱなしが本来の挙動。 */
  it('間が狭い区間はひとまとめにする', () => {
    expect(mergeSpeechSpans([sp(0, 2), sp(2.3, 4)], 0.5)).toEqual([sp(0, 4)]);
  });

  it('間が広ければまとめない', () => {
    expect(mergeSpeechSpans([sp(0, 2), sp(5, 6)], 0.5)).toEqual([sp(0, 2), sp(5, 6)]);
  });

  it('並びが前後していても正しくまとめる（入力順に依存しない）', () => {
    expect(mergeSpeechSpans([sp(5, 6), sp(0, 2), sp(2.1, 3)], 0.5)).toEqual([sp(0, 3), sp(5, 6)]);
  });

  it('入れ子の区間は外側に吸収する', () => {
    expect(mergeSpeechSpans([sp(0, 10), sp(2, 3)], 0)).toEqual([sp(0, 10)]);
  });

  it('長さ0の区間は数えない', () => {
    expect(mergeSpeechSpans([sp(1, 1)], 0.5)).toEqual([]);
  });
});

describe('duckingFactorPoints', () => {
  it('しない設定なら点を作らない', () => {
    expect(duckingFactorPoints([sp(1, 2)], { startSec: 0, endSec: 10 }, resolveAudioAuto({ duckBgm: false }))).toEqual([]);
  });

  it('下げ幅0なら点を作らない（何も変わらない式を作らない）', () => {
    expect(duckingFactorPoints([sp(1, 2)], { startSec: 0, endSec: 10 }, resolveAudioAuto({ duckDepth: 0 }))).toEqual([]);
  });

  it('区間の前で下がり始め、後で戻る（4点）', () => {
    expect(duckingFactorPoints([sp(2, 4)], { startSec: 0, endSec: 10 }, s)).toEqual([
      { timeSec: 1.8, volume: 1 },
      { timeSec: 2, volume: 0.5 },
      { timeSec: 4, volume: 0.5 },
      { timeSec: 4.4, volume: 1 },
    ]);
  });

  it('音の先頭から声が鳴っていれば、最初から下がっている', () => {
    const pts = duckingFactorPoints([sp(0, 3)], { startSec: 0, endSec: 10 }, s);
    expect(pts[0]).toEqual({ timeSec: 0, volume: 0.5 });
  });

  /**
   * ⚠️ **式は端の値で外挿する**＝先頭の点が下がった値だと、**その前もずっと下がった**音になる。
   * 「下がるまでの時間 0」のときだけ先頭の点が下がった値になりうる（時間があれば手前に 1 の点が立つ）。
   */
  it('下がるまでの時間が0でも、区間より前は下がらない（先頭に 1 の点を足す）', () => {
    const zero = resolveAudioAuto({ duckDepth: 0.5, duckAttackSec: 0, duckReleaseSec: 0.4 });
    const pts = duckingFactorPoints([sp(2, 4)], { startSec: 0, endSec: 10 }, zero);
    expect(pts[0]).toEqual({ timeSec: 0, volume: 1 });
    expect(pts[1]).toEqual({ timeSec: 2, volume: 0.5 });
  });

  it('この音の中の秒に直す（BGM が途中から始まっても合う）', () => {
    const pts = duckingFactorPoints([sp(12, 14)], { startSec: 10, endSec: 20 }, s);
    // 先頭が 1 なら 0 秒の点は足さない（式は端の値で外挿するので同じ意味＝点を無駄に増やさない）。
    expect(pts.map((p) => p.timeSec)).toEqual([1.8, 2, 4, 4.4]);
    expect(pts[0].volume).toBe(1);
  });

  it('この音に掛からない区間は無視する', () => {
    expect(duckingFactorPoints([sp(100, 101)], { startSec: 0, endSec: 10 }, s)).toEqual([]);
  });

  it('音の端をはみ出す区間は端で止める', () => {
    const pts = duckingFactorPoints([sp(9, 20)], { startSec: 0, endSec: 10 }, s);
    expect(pts[pts.length - 1].timeSec).toBe(10);
  });

  it('近い区間はまとめて1つの下がりにする（間で上げない）', () => {
    const pts = duckingFactorPoints([sp(2, 3), sp(3.2, 4)], { startSec: 0, endSec: 10 }, s);
    expect(pts).toHaveLength(4);
    expect(pts[2]).toEqual({ timeSec: 4, volume: 0.5 });
  });
});

describe('applyDucking', () => {
  it('倍率が無ければ元のまま', () => {
    expect(applyDucking(undefined, 0.4, [])).toEqual([]);
    expect(applyDucking([{ timeSec: 0, volume: 0.3 }], 0.4, [])).toEqual([{ timeSec: 0, volume: 0.3 }]);
  });

  it('一定音量に倍率を掛ける', () => {
    const f = [{ timeSec: 0, volume: 1 }, { timeSec: 1, volume: 0.5 }];
    expect(applyDucking(undefined, 0.4, f)).toEqual([
      { timeSec: 0, volume: 0.4 },
      { timeSec: 1, volume: 0.2 },
    ]);
  });

  /** ⚠️ **両方の折れ点を残す**＝どちらかの点だけで刻むと、もう一方の折れが丸まる。 */
  it('元の点列と倍率の折れ点を両方持つ', () => {
    const base = [{ timeSec: 0, volume: 1 }, { timeSec: 4, volume: 0 }];
    const f = [{ timeSec: 2, volume: 0.5 }];
    const r = applyDucking(base, 1, f);
    expect(r.map((p) => p.timeSec)).toEqual([0, 2, 4]);
    // 2秒での元の値は 0.5（線形）× 倍率 0.5 ＝ 0.25。
    expect(r[1].volume).toBeCloseTo(0.25, 6);
  });

  it('音量の上限を超えない（手で書いた値との掛け算）', () => {
    expect(applyDucking(undefined, 1.5, [{ timeSec: 0, volume: 1 }])[0].volume).toBe(1.5);
  });
});

describe('fitSpeechSpans（点の上限に収める）', () => {
  it('もともと収まっていればまとめない', () => {
    const r = fitSpeechSpans([sp(0, 1), sp(5, 6)], s, 60);
    expect(r.spans).toHaveLength(2);
    expect(r.merged).toBe(false);
  });

  /**
   * ⚠️ **黙って点を捨てない**＝捨てるとその区間だけ下がらなくなる（下げ忘れ）。
   * まとめるのは「下げっぱなしにする」方向なので、下げ忘れは起きない。
   */
  it('多すぎるときはまとめて収め、まとめたことを返す', () => {
    const many = Array.from({ length: 40 }, (_, i) => sp(i * 10, i * 10 + 5));
    const r = fitSpeechSpans(many, s, 60);
    expect(r.spans.length * 4 + 1).toBeLessThanOrEqual(60);
    expect(r.merged).toBe(true);
    // まとめた結果は元の全区間を覆う（下げ忘れが無い）。
    expect(r.spans[0].startSec).toBe(0);
    expect(r.spans[r.spans.length - 1].endSec).toBe(395);
  });

  it('区間が1つならそれ以上まとめない（無限に回らない）', () => {
    expect(fitSpeechSpans([sp(0, 1)], s, 1).spans).toHaveLength(1);
  });
});
