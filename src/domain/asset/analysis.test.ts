import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_KIND, analysisKindFor, clipAnalysisSource, filmstripFrames,
  MAX_FILMSTRIP_FRAMES, MAX_WAVEFORM_BUCKETS, waveformBuckets, waveformPoints,
} from './analysis';

describe('waveformBuckets / filmstripFrames（何本・何枚とるか・#332）', () => {
  /**
   * ⚠️ **幅で決める**＝尺で決めると、長い曲を縮めて置いたときに**見えない細かさ**まで測る
   *（測る時間だけ延びて絵は変わらない）。
   */
  it('帯が広いほど細かく取る', () => {
    expect(waveformBuckets(400)).toBeGreaterThan(waveformBuckets(100));
    expect(filmstripFrames(400)).toBeGreaterThan(filmstripFrames(100));
  });

  it('上限で頭打ちにする（細かすぎても見えない）', () => {
    expect(waveformBuckets(100000)).toBe(MAX_WAVEFORM_BUCKETS);
    expect(filmstripFrames(100000)).toBe(MAX_FILMSTRIP_FRAMES);
  });

  // ⚠️ **0 を返さない**＝1本も無いと何も描けない（空の絵を敷いて「壊れている」に見せない）。
  it('細い帯・おかしな幅でも1以上', () => {
    for (const w of [0, 1, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(waveformBuckets(w)).toBeGreaterThanOrEqual(1);
      expect(filmstripFrames(w)).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('analysisKindFor（どちらの絵が要るか）', () => {
  // ⚠️ **動画は両方にしない**＝コマ列と波形が重なるとどちらも読めない。
  it('動画はコマ列・音は波形・それ以外は無し', () => {
    expect(analysisKindFor('video')).toBe('filmstrip');
    expect(analysisKindFor('bgm')).toBe('waveform');
    expect(analysisKindFor('voice')).toBe('waveform');
    expect(analysisKindFor('image')).toBeNull();
    expect(analysisKindFor('yuko')).toBeNull();
  });
});

describe('waveformPoints（帯に敷く形）', () => {
  it('山が無ければ空（空の絵を敷かない）', () => {
    expect(waveformPoints([])).toBe('');
  });

  /**
   * ⚠️ **上下対称**＝音の波形は 0 を中心に振れるものとして見慣れている。片側だけだと
   * 「棒グラフ」に見えて音だと分からない。
   */
  it('上下対称に描く（点は山の2倍）', () => {
    const pts = waveformPoints([1, 0.5]).split(' ');
    expect(pts).toHaveLength(4);
    expect(pts[0]).toBe('0.0000,0.0000');   // 山1 の上
    expect(pts[3]).toBe('0.0000,1.0000');   // 山1 の下
  });

  // ⚠️ **座標系は 0..1**＝帯の幅が変わっても描き直さずに伸びる。
  it('0〜1 に収まる', () => {
    for (const p of waveformPoints([0, 0.3, 1]).split(' ')) {
      const [x, y] = p.split(',').map(Number);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
  });

  // ⚠️ **壊れた値でも描ける**（無音として扱う＝画面を止めない）。
  it('範囲外・数でない値は真ん中（無音）として扱う', () => {
    expect(waveformPoints([2, -1, Number.NaN])).toContain('0.5000');
    expect(waveformPoints([Number.NaN])).toBe('0.5000,0.5000 0.5000,0.5000');
  });

  it('山が1本なら真ん中に置く（0除算にしない）', () => {
    expect(waveformPoints([1])).toBe('0.5000,0.0000 0.5000,1.0000');
  });
});

describe('clipAnalysisSource（帯に敷く絵の出どころ・#332）', () => {
  const assetOf = (id: string) =>
    ({
      asset_bgm: { assetType: 'bgm' as const, filePath: 'assets/asset_001.mp3' },
      asset_video: { assetType: 'video' as const, filePath: 'assets/asset_002.mp4' },
      asset_photo: { assetType: 'image' as const, filePath: 'assets/asset_003.png' },
    })[id];

  /**
   * ⚠️ **音の部品は `kind:'slot'` ではない**（レビュー 🔴）＝素材の差し込みだけを見ていると、
   * **波形が一度も描かれない**（音は `assetId` で持つ・`11 §7.6`）。ここは kind を見ずに
   * `assetId` が指す**素材の種類**で決める。
   */
  it('音の素材は波形・動画はコマ列', () => {
    expect(clipAnalysisSource({ assetId: 'asset_bgm', durationSec: 5 }, assetOf)?.kind).toBe(ANALYSIS_KIND.waveform);
    expect(clipAnalysisSource({ assetId: 'asset_video', durationSec: 5 }, assetOf)?.kind).toBe(ANALYSIS_KIND.filmstrip);
    expect(clipAnalysisSource({ assetId: 'asset_photo', durationSec: 5 }, assetOf)).toBeNull();
  });

  // ⚠️ **読み上げは素材を持たない**＝作成済みの音声を直に指す。
  it('読み上げは作成済みの音声を指す', () => {
    const src = clipAnalysisSource({ voice: { voicePath: 'voices/v1.wav' }, durationSec: 3 }, assetOf);
    expect(src).toMatchObject({ relPath: 'voices/v1.wav', kind: ANALYSIS_KIND.waveform });
  });

  /**
   * ⚠️ **置いた範囲だけを測る**（レビュー 🟡・`11 §7.6.5` と同じ筋）＝素材まるごとを測って帯へ
   * 伸ばすと、**60秒の曲の末尾5秒だけを置いた帯に、曲の頭からの波形**が出る。
   */
  it('切り出しと速さから、素材のどこを測るかを出す', () => {
    const src = clipAnalysisSource({ assetId: 'asset_bgm', durationSec: 5, sourceStartSec: 55, speed: 2 }, assetOf);
    expect(src).toMatchObject({ fromSec: 55, lengthSec: 10 }); // 素材の時間で見る＝5秒×2倍速
  });

  // ⚠️ **同じ素材でも範囲が違えば別の絵**＝鍵に範囲を入れる（per-use と噛み合わせる）。
  it('同じ素材を別の範囲で置いたら鍵が変わる', () => {
    const a = clipAnalysisSource({ assetId: 'asset_bgm', durationSec: 5, sourceStartSec: 0 }, assetOf);
    const b = clipAnalysisSource({ assetId: 'asset_bgm', durationSec: 5, sourceStartSec: 30 }, assetOf);
    expect(a?.key).not.toBe(b?.key);
    expect(a?.relPath).toBe(b?.relPath); // 測る元は同じファイル
  });

  it('おかしな速さ・負の切り出しでも壊れない', () => {
    expect(clipAnalysisSource({ assetId: 'asset_bgm', durationSec: 5, speed: 0 }, assetOf)).toMatchObject({ lengthSec: 5 });
    expect(clipAnalysisSource({ assetId: 'asset_bgm', durationSec: 5, sourceStartSec: -3 }, assetOf)).toMatchObject({ fromSec: 0 });
  });

  it('素材が見つからなければ何も敷かない', () => {
    expect(clipAnalysisSource({ assetId: 'asset_999', durationSec: 5 }, assetOf)).toBeNull();
    expect(clipAnalysisSource({ durationSec: 5 }, assetOf)).toBeNull();
  });
});
