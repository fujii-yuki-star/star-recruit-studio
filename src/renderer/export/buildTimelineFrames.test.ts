// タイムライン形式の全フレーム描画（ADR-0032 決定22・#631）。
// ラスタライズ（canvas）は環境依存なので差し替え、**何を・どの時刻で・何枚描くか**を固定する。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../../domain/enums';
import { FPS } from '../../domain/constants';
import type { TimelineClip, TimelineProject } from '../../domain/timeline/types';
import { TIMELINE_SCHEMA_VERSION } from '../../domain/timeline/types';

vi.mock('./rasterize', () => ({
  svgToPngDataUrl: vi.fn(async (svg: string) => `png:${svg}`),
}));

const { buildTimelineFrames, TIMELINE_FRAMES_DIR } = await import('./buildTimelineFrames');
const { svgToPngDataUrl } = await import('./rasterize');

function textClip(id: string, over: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id,
    kind: TIMELINE_CLIP_KIND.text,
    trackId: 'track_001',
    startSec: 0,
    durationSec: 1,
    x: 100,
    y: 100,
    w: 400,
    h: 80,
    text: 'あ',
    ...over,
  };
}

function voiceClip(id: string, speaker: number, over: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id,
    kind: TIMELINE_CLIP_KIND.voice,
    trackId: 'track_002',
    startSec: 0,
    durationSec: 1,
    voice: { text: 'あ', status: 'generated', voicePath: `voices/${id}.wav`, speaker },
    ...over,
  };
}

function doc(over: Partial<TimelineProject> = {}): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20260729_001',
    projectName: 'テスト',
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [],
    tracks: [
      { id: 'track_001', kind: TRACK_KIND.visual },
      { id: 'track_002', kind: TRACK_KIND.audio },
    ],
    clips: [],
    ...over,
  };
}

const baseOpts = { templateOf: () => undefined, assetSrc: () => undefined, fallbackCredit: 'VOICEVOX:ずんだもん' };

beforeEach(() => {
  vi.mocked(svgToPngDataUrl).mockClear();
});

describe('buildTimelineFrames', () => {
  it('尺ぶんのフレームを描き、書き出しに渡す形で返す', async () => {
    const r = await buildTimelineFrames(doc({ clips: [textClip('clip_001', { durationSec: 1 })] }), baseOpts);
    expect(r.fps).toBe(FPS);
    expect(r.durationSec).toBeCloseTo(1);
    expect(r.framesBase64).toHaveLength(30);
    expect(vi.mocked(svgToPngDataUrl)).toHaveBeenCalledTimes(30);
  });

  it('実寸で焼く（プレビューの表示サイズではなく出力の大きさ）', async () => {
    await buildTimelineFrames(doc({ clips: [textClip('clip_001', { durationSec: 0.1 })] }), baseOpts);
    expect(vi.mocked(svgToPngDataUrl).mock.calls[0].slice(1)).toEqual([1920, 1080]);
  });

  it('出力の大きさを指定できる', async () => {
    await buildTimelineFrames(doc({ clips: [textClip('clip_001', { durationSec: 0.1 })] }), {
      ...baseOpts,
      outputSize: { width: 1280, height: 720 },
    });
    expect(vi.mocked(svgToPngDataUrl).mock.calls[0].slice(1)).toEqual([1280, 720]);
  });

  it('置ける先があればディスクへ逃がす（数千フレームを配列に溜めない）', async () => {
    const staged: number[] = [];
    const r = await buildTimelineFrames(doc({ clips: [textClip('clip_001', { durationSec: 0.2 })] }), {
      ...baseOpts,
      stageFrame: async (_dir, i) => {
        staged.push(i);
      },
    });
    expect(r.framesDir).toBe(TIMELINE_FRAMES_DIR);
    expect(r.framesBase64).toBeUndefined();
    expect(staged).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('フレームごとに違う時刻を描く（動くものが止まって見えない）', async () => {
    // 前半と後半で別の文字を置く＝時刻を見ていなければ全フレーム同じ絵になる。
    const d = doc({
      clips: [textClip('clip_001', { durationSec: 0.5 }), textClip('clip_002', { startSec: 0.5, durationSec: 0.5, trackId: 'track_003', text: 'い' })],
      tracks: [
        { id: 'track_001', kind: TRACK_KIND.visual },
        { id: 'track_003', kind: TRACK_KIND.visual },
        { id: 'track_002', kind: TRACK_KIND.audio },
      ],
    });
    const r = await buildTimelineFrames(d, baseOpts);
    expect(new Set(r.framesBase64).size).toBeGreaterThan(1);
  });

  it('しゃべっている声のキャラをクレジットに焼き込む（場面形式の掛け合いと同じ挙動）', async () => {
    const d = doc({
      clips: [textClip('clip_001', { durationSec: 1 }), voiceClip('clip_002', 2, { startSec: 0.5, durationSec: 0.5 })],
    });
    await buildTimelineFrames(d, baseOpts);
    const svgs = vi.mocked(svgToPngDataUrl).mock.calls.map((c) => c[0]);
    expect(svgs[0]).toContain('VOICEVOX:ずんだもん'); // 誰もしゃべっていない＝既定の声
    expect(svgs[20]).toContain('VOICEVOX:四国めたん'); // speaker=2＝四国めたん（既定のずんだもんと別のキャラ）
  });

  it('中止したらそこで止める（長い動画でも押した中止が効く）', async () => {
    let drawn = 0;
    await expect(
      buildTimelineFrames(doc({ clips: [textClip('clip_001', { durationSec: 10 })] }), {
        ...baseOpts,
        shouldCancel: () => drawn >= 5,
        onProgress: () => undefined,
        stageFrame: async () => {
          drawn += 1;
        },
      }),
    ).rejects.toThrow();
    expect(drawn).toBe(5); // 300 枚描き切らない
  });

  it('進み具合を知らせる（最後は必ず全部ぶん）', async () => {
    const seen: [number, number][] = [];
    await buildTimelineFrames(doc({ clips: [textClip('clip_001', { durationSec: 0.5 })] }), {
      ...baseOpts,
      onProgress: (done, total) => seen.push([done, total]),
    });
    expect(seen[seen.length - 1]).toEqual([15, 15]);
  });
});
