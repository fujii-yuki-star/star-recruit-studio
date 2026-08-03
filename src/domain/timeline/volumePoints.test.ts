import { describe, expect, it } from 'vitest';

import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import { validateTimelineProject } from '../validation/generated/validators.js';
import { audioCuesAt, normalizedVolumePoints, volumeAt, volumeExpr } from './audio';
import { TIMELINE_EXPORT_BLOCK, timelineAudioRuns, timelineExportBlockers } from './export';
import { VOLUME_POINTS_MAX } from '../constants';
import { TIMELINE_SCHEMA_VERSION } from './types';
import type { TimelineClip, TimelineProject } from './types';

const POINTS = [
  { timeSec: 0, volume: 0.2 },
  { timeSec: 4, volume: 1 },
];

const doc = (over: Partial<TimelineClip> = {}): TimelineProject => ({
  schemaVersion: TIMELINE_SCHEMA_VERSION,
  format: PROJECT_FORMAT.timeline,
  projectId: 'proj_20260803_001',
  projectName: 'テスト',
  createdAt: '2026-08-03T00:00:00.000Z',
  updatedAt: '2026-08-03T00:00:00.000Z',
  videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
  voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
  assets: [{ assetId: 'asset_001', assetType: 'bgm', displayName: '曲', filePath: 'assets/a.mp3' }],
  tracks: [{ id: 'track_001', kind: TRACK_KIND.audio }],
  clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.audio, trackId: 'track_001', startSec: 0, durationSec: 8, assetId: 'asset_001', ...over }],
});

describe('normalizedVolumePoints（再生と書き出しが共有する正規化・#512）', () => {
  it('同じ時刻は1つにする（キーフレームと同じ規則＝再生と書き出しが同じ点を採る）', () => {
    expect(normalizedVolumePoints([{ timeSec: 1, volume: 0.9 }, { timeSec: 1, volume: 0.1 }]))
      .toEqual([{ timeSec: 1, volume: 0.1 }]);
  });

  it('並べ替えと値域は入口で済ませる（補間の後に収めると中間の値が変わる）', () => {
    expect(normalizedVolumePoints([{ timeSec: 2, volume: 9 }, { timeSec: 0, volume: -1 }]))
      .toEqual([{ timeSec: 0, volume: 0 }, { timeSec: 2, volume: 1.5 }]);
  });

  it('点が無ければ空（呼び出し側が「変化なし」へ落ちる）', () => {
    expect(normalizedVolumePoints(undefined)).toEqual([]);
  });
});

describe('volumeAt（音量の変化・#512）', () => {
  it('点が無ければ undefined（クリップ一定の音量へ落ちる）', () => {
    expect(volumeAt(undefined, 1)).toBeUndefined();
    expect(volumeAt([], 1)).toBeUndefined();
  });

  it('点の間は線形に変わる', () => {
    expect(volumeAt(POINTS, 0)).toBeCloseTo(0.2, 9);
    expect(volumeAt(POINTS, 2)).toBeCloseTo(0.6, 9);
    expect(volumeAt(POINTS, 4)).toBeCloseTo(1, 9);
  });

  it('点の外は端の値で伸ばす（黙って 0 や 1 に化けない）', () => {
    expect(volumeAt(POINTS, -5)).toBeCloseTo(0.2, 9);
    expect(volumeAt(POINTS, 99)).toBeCloseTo(1, 9);
  });

  it('順序が崩れていても結果は同じ（保存の並びに依存しない）', () => {
    expect(volumeAt([...POINTS].reverse(), 2)).toBeCloseTo(volumeAt(POINTS, 2)!, 9);
  });

  it('同じ時刻に2つあっても有限の値を返す（0 で割らない）', () => {
    const v = volumeAt([{ timeSec: 1, volume: 0.1 }, { timeSec: 1, volume: 0.9 }], 1);
    expect(Number.isFinite(v!)).toBe(true);
  });

  it('同じ時刻の重複は落とす＝並びを変えても同じ値（再生と書き出しが同じ点を採る）', () => {
    const dup = [{ timeSec: 1, volume: 0.1 }, { timeSec: 1, volume: 0.9 }];
    expect(volumeAt(dup, 1)).toBe(volumeAt([...dup].reverse(), 1));
    expect(volumeExpr(dup)).toBe(volumeExpr([...dup].reverse()));
  });

  it('範囲外の音量は保存できる範囲へ収める（schema と同じ 0〜1.5）', () => {
    expect(volumeAt([{ timeSec: 0, volume: 9 }], 0)).toBeLessThanOrEqual(1.5);
    expect(volumeAt([{ timeSec: 0, volume: -1 }], 0)).toBeGreaterThanOrEqual(0);
  });

  it('値域は補間の前に収める（式と同じ順序＝中間の値が食い違わない）', () => {
    const over = [{ timeSec: 0, volume: 0.5 }, { timeSec: 4, volume: 3 }];
    // 0.5 → 1.5（収めてから補間）の中点＝1.0。収める前に補間すると 1.75→1.5 で食い違う。
    expect(volumeAt(over, 2)).toBeCloseTo(1, 9);
    expect(volumeExpr(over)).toContain('(1.5-0.5)');
  });
});

describe('再生への効き方（#512）', () => {
  it('その時刻の音量で鳴る（クリップ一定の値ではなく点列から採る）', () => {
    const d = doc({ volumePoints: POINTS, volume: 0.05 });
    expect(validateTimelineProject(d)).toBe(true);
    expect(audioCuesAt(d, 2)[0].volume).toBeCloseTo(0.6, 6);
    expect(audioCuesAt(d, 0)[0].volume).toBeCloseTo(0.2, 6);
  });

  it('フェードはその上に掛かる（「基準×フェード係数」の形は変えない）', () => {
    const d = doc({ volumePoints: [{ timeSec: 0, volume: 1 }, { timeSec: 8, volume: 1 }], fadeInSec: 2 });
    // 1秒地点＝フェードイン半ば＝基準1×0.5。
    expect(audioCuesAt(d, 1)[0].volume).toBeCloseTo(0.5, 6);
  });

  it('点が無ければ従来どおりクリップ一定の音量', () => {
    expect(audioCuesAt(doc({ volume: 0.3 }), 2)[0].volume).toBeCloseTo(0.3, 6);
  });
});

describe('volumeExpr（書き出しの式・#512 段3）', () => {
  it('点が無ければ undefined（従来どおり一定値の音量で出す）', () => {
    expect(volumeExpr(undefined)).toBeUndefined();
    expect(volumeExpr([])).toBeUndefined();
  });

  it('点列から線形の式を組む（先頭・末尾は端の値で伸ばす＝volumeAt と同じ規則）', () => {
    expect(volumeExpr(POINTS)).toBe('lt(t,0)*0.2+gte(t,0)*lt(t,4)*(0.2+(1-0.2)*(t-0)/4)+gte(t,4)*1');
  });

  it('点が1つなら全区間その値（先頭・末尾の伸ばしだけになる）', () => {
    expect(volumeExpr([{ timeSec: 2, volume: 0.5 }])).toBe('lt(t,2)*0.5+gte(t,2)*0.5');
  });

  it('同じ時刻が2つ並んでも 0 で割らない', () => {
    const e = volumeExpr([{ timeSec: 1, volume: 0.1 }, { timeSec: 1, volume: 0.9 }]);
    expect(e).not.toContain('/0');
  });

  it('並びが崩れていても同じ式になる（保存の並びに依存しない）', () => {
    expect(volumeExpr([...POINTS].reverse())).toBe(volumeExpr(POINTS));
  });

  it('点を増やしても括弧が深くならない（入れ子だと ffmpeg が式を解析できなくなる）', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ timeSec: i * 0.5, volume: (i % 4) / 4 }));
    const e = volumeExpr(many)!;
    expect(maxParenDepth(e)).toBe(maxParenDepth(volumeExpr(POINTS)!));
    // 項の数は点の数に比例して増える（区間 199 ＋ 先頭 ＋ 末尾）。
    expect(e.split('+gte(t,').length - 1).toBe(200);
  });

  it('数は短く書く（引き算で出る 0.19999999999999998 のような桁を式に持ち込まない）', () => {
    const e = volumeExpr([{ timeSec: 0.1, volume: 0.1 }, { timeSec: 0.3, volume: 0.7 }])!;
    // 0.3 - 0.1 は浮動小数では 0.19999999999999998。長い桁のまま書くと式が倍近く長くなる。
    expect(e).toContain('/0.2)');
    expect(e).not.toMatch(/\d{15}/);
  });
});

/** 式のいちばん深い括弧の段数（点を増やしたときに深くならないことを見るため）。 */
function maxParenDepth(expr: string): number {
  let depth = 0;
  let max = 0;
  for (const ch of expr) {
    if (ch === '(') max = Math.max(max, (depth += 1));
    else if (ch === ')') depth -= 1;
  }
  return max;
}

describe('書き出しへの効き方（#512 段3）', () => {
  it('点があれば式を渡す（再生と同じ点列から組んだもの）', () => {
    const runs = timelineAudioRuns(doc({ volumePoints: POINTS, volume: 0.05 }));
    expect(runs[0].volumeExpr).toBe(volumeExpr(POINTS));
  });

  it('点が無ければ式を持たない（従来どおり一定値の音量で出る）', () => {
    const runs = timelineAudioRuns(doc({ volume: 0.3 }));
    expect(runs[0]).not.toHaveProperty('volumeExpr');
    expect(runs[0].volume).toBeCloseTo(0.3, 6);
  });

  it('フェードは式と別に渡す（FFmpeg 側で上に掛かる＝再生と同じ「基準×フェード係数」）', () => {
    const runs = timelineAudioRuns(doc({ volumePoints: POINTS, fadeInSec: 2, fadeOutSec: 1 }));
    expect(runs[0]).toMatchObject({ fadeInSec: 2, fadeOutSec: 1 });
    expect(runs[0].volumeExpr).toBeDefined();
  });
});

describe('点の数の上限（#512・FFmpeg が式を解析できる範囲）', () => {
  const points = (n: number) => Array.from({ length: n }, (_, i) => ({ timeSec: i * 0.1, volume: 0.5 }));

  it('上限までは書き出せる', () => {
    const d = doc({ volumePoints: points(VOLUME_POINTS_MAX) });
    expect(validateTimelineProject(d)).toBe(true);
    expect(timelineExportBlockers(d)).toEqual([]);
  });

  it('上限を超えたら書き出す前に断る（渡してから落ちると「もう一度」しか出せない）', () => {
    const d = doc({ volumePoints: points(VOLUME_POINTS_MAX + 1) });
    expect(timelineExportBlockers(d)).toEqual([
      { code: TIMELINE_EXPORT_BLOCK.volumePointsTooMany, clipIds: ['clip_001'] },
    ]);
  });

  it('数えるのは重複を落とした後（同じ時刻の点は式に出ないので上限に当てない）', () => {
    const dup = [...points(VOLUME_POINTS_MAX), ...points(VOLUME_POINTS_MAX)];
    expect(timelineExportBlockers(doc({ volumePoints: dup }))).toEqual([]);
  });
});
