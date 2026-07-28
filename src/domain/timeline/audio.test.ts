// タイムラインの「その瞬間に鳴っている音」（ADR-0032・#630）。時刻から一意に決まることを固定する。
import { describe, expect, it } from 'vitest';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import type { TimelineClip, TimelineProject } from './types';
import { TIMELINE_SCHEMA_VERSION } from './types';
import { audioCuesAt, audioLoops, audioSourceKey, audioSourceKeyOfClip, audioSourcesOf } from './audio';

function clip(id: string, over: Partial<TimelineClip> = {}): TimelineClip {
  return { id, kind: TIMELINE_CLIP_KIND.audio, trackId: 'track_002', startSec: 0, durationSec: 5, ...over };
}

const voiceClip = (id: string, over: Partial<TimelineClip> = {}): TimelineClip =>
  clip(id, { kind: TIMELINE_CLIP_KIND.voice, voice: { text: 'あ', status: 'generated', voicePath: `voices/${id}.wav` }, ...over });

function doc(over: Partial<TimelineProject> = {}): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20260728_001',
    projectName: 'テスト',
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [],
    tracks: [
      { id: 'track_001', kind: TRACK_KIND.visual },
      { id: 'track_002', kind: TRACK_KIND.audio },
      { id: 'track_003', kind: TRACK_KIND.audio },
    ],
    clips: [],
    ...over,
  };
}

describe('audioCuesAt', () => {
  it('その時刻に鳴っている音だけを返す（区間は半開＝絵と揃える）', () => {
    const d = doc({ clips: [clip('clip_001', { startSec: 2, durationSec: 3 })] }); // [2, 5)
    expect(audioCuesAt(d, 1.9)).toEqual([]);
    expect(audioCuesAt(d, 2).map((c) => c.clipId)).toEqual(['clip_001']);
    expect(audioCuesAt(d, 4.9).map((c) => c.clipId)).toEqual(['clip_001']);
    expect(audioCuesAt(d, 5)).toEqual([]);
  });

  it('頭出しはクリップの先頭からの秒（途中から再生しても同じ結果になる）', () => {
    const d = doc({ clips: [clip('clip_001', { startSec: 2, durationSec: 5 })] });
    expect(audioCuesAt(d, 4)[0].offsetSec).toBe(2);
  });

  it('素材のトリム（どこから使うか）を頭出しに足す', () => {
    const d = doc({ clips: [clip('clip_001', { startSec: 2, durationSec: 5, sourceStartSec: 10 })] });
    expect(audioCuesAt(d, 4)[0].offsetSec).toBe(12);
  });

  it('速度を掛けた頭出しになり、速度も返す（頭出しだけ合わせるとずれ続ける）', () => {
    const d = doc({ clips: [clip('clip_001', { startSec: 0, durationSec: 10, speed: 2 })] });
    const cue = audioCuesAt(d, 3)[0];
    expect(cue.offsetSec).toBeCloseTo(6); // 3秒経過 × 2倍速
    expect(cue.speed).toBe(2);
  });

  it('速度の指定が無ければ等速', () => {
    expect(audioCuesAt(doc({ clips: [clip('clip_001')] }), 1)[0].speed).toBe(1);
  });

  it('同時に鳴る音は全部返す（別の列で重ねられる）', () => {
    const d = doc({
      clips: [clip('clip_001'), clip('clip_002', { trackId: 'track_003' })],
    });
    expect(audioCuesAt(d, 1).map((c) => c.clipId)).toEqual(['clip_001', 'clip_002']);
  });

  it('隠した列の音は鳴らさない（見えないのに聞こえる、を作らない）', () => {
    const d = doc({
      tracks: [{ id: 'track_002', kind: TRACK_KIND.audio, hidden: true }],
      clips: [clip('clip_001')],
    });
    expect(audioCuesAt(d, 1)).toEqual([]);
  });

  it('隠したクリップ・絵のクリップは対象外', () => {
    const d = doc({
      clips: [
        clip('clip_001', { hidden: true }),
        clip('clip_002', { kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', x: 0, y: 0, w: 10, h: 10, text: 'あ' }),
      ],
    });
    expect(audioCuesAt(d, 1)).toEqual([]);
  });
});

describe('audioCuesAt: 音量とフェード', () => {
  it('音（BGM）の既定は場面形式と同じ 0.25（1.0 にすると4倍の音で鳴る）', () => {
    expect(audioCuesAt(doc({ clips: [clip('clip_001')] }), 1)[0].volume).toBeCloseTo(0.25);
  });

  it('読み上げは動画全体の声の音量を継承する（null=継承・11 §6）', () => {
    const d = doc({
      voiceSettings: { defaultVoiceId: 'voicevox_zundamon', volume: 0.5 },
      clips: [voiceClip('clip_001')],
    });
    expect(audioCuesAt(d, 1)[0].volume).toBeCloseTo(0.5);
    // クリップの指定があればそちらが勝つ。
    const d2 = doc({
      voiceSettings: { defaultVoiceId: 'voicevox_zundamon', volume: 0.5 },
      clips: [voiceClip('clip_001', { volume: 0.9 })],
    });
    expect(audioCuesAt(d2, 1)[0].volume).toBeCloseTo(0.9);
  });

  it('値域を超える指定は正典の上限へ収める（0〜1.5）', () => {
    expect(audioCuesAt(doc({ clips: [clip('clip_001', { volume: 9 })] }), 1)[0].volume).toBe(1.5);
  });

  it('指定した音量をそのまま使う', () => {
    expect(audioCuesAt(doc({ clips: [clip('clip_001', { volume: 0.3 })] }), 1)[0].volume).toBeCloseTo(0.3);
  });

  it('入り口のフェードで少しずつ大きくなる', () => {
    const d = doc({ clips: [clip('clip_001', { durationSec: 10, volume: 1, fadeInSec: 2 })] });
    expect(audioCuesAt(d, 0)[0].volume).toBe(0);
    expect(audioCuesAt(d, 1)[0].volume).toBeCloseTo(0.5);
    expect(audioCuesAt(d, 3)[0].volume).toBe(1);
  });

  it('出口のフェードで少しずつ小さくなる', () => {
    const d = doc({ clips: [clip('clip_001', { durationSec: 10, volume: 1, fadeOutSec: 2 })] });
    expect(audioCuesAt(d, 5)[0].volume).toBe(1);
    expect(audioCuesAt(d, 9)[0].volume).toBeCloseTo(0.5);
  });

  it('長すぎるフェードは尺の半分までに切り詰める（書き出しの BGM ミックスと同じ規則）', () => {
    // 尺2秒に4秒のフェードを両端 → それぞれ1秒に切り詰められ、中央（t=1）で最大になる。
    const d = doc({ clips: [clip('clip_001', { durationSec: 2, volume: 1, fadeInSec: 4, fadeOutSec: 4 })] });
    expect(audioCuesAt(d, 1)[0].volume).toBeCloseTo(1);
    expect(audioCuesAt(d, 0)[0].volume).toBe(0);
    for (const t of [0, 0.5, 1, 1.5, 1.99]) {
      const v = audioCuesAt(d, t)[0].volume;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('音量にフェードが掛かる（指定音量を超えない）', () => {
    const d = doc({ clips: [clip('clip_001', { durationSec: 10, volume: 0.4, fadeInSec: 2 })] });
    expect(audioCuesAt(d, 1)[0].volume).toBeCloseTo(0.2);
    expect(audioCuesAt(d, 5)[0].volume).toBeCloseTo(0.4);
  });
});

describe('audioSourcesOf', () => {
  it('読み上げ・同梱BGM・持ち込みの音を、それぞれの読み方で返す', () => {
    const d = doc({
      clips: [
        voiceClip('clip_001'),
        clip('clip_002', { bundledBgmId: 'found-new-hope' }),
        clip('clip_003', { assetId: 'asset_001' }),
      ],
    });
    expect(audioSourcesOf(d)).toEqual([
      { clipId: 'clip_001', voicePath: 'voices/clip_001.wav' },
      { clipId: 'clip_002', bundledBgmId: 'found-new-hope' },
      { clipId: 'clip_003', assetId: 'asset_001' },
    ]);
  });

  it('まだ作っていない読み上げは音源が無い（鳴らすものが無い）', () => {
    const d = doc({ clips: [clip('clip_001', { kind: TIMELINE_CLIP_KIND.voice, voice: { text: 'あ', status: 'none' } })] });
    expect(audioSourcesOf(d)).toEqual([]);
  });

  it('絵のクリップは対象外', () => {
    const d = doc({ clips: [clip('clip_001', { kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001', assetId: 'asset_001', x: 0, y: 0, w: 1, h: 1 })] });
    expect(audioSourcesOf(d)).toEqual([]);
  });
});

describe('audioSourceKey / audioLoops', () => {
  it('音源は中身で見分ける（同じ曲を使う複数の部品で使い回せる）', () => {
    const d = doc({
      clips: [clip('clip_001', { bundledBgmId: 'found-new-hope' }), clip('clip_002', { bundledBgmId: 'found-new-hope' })],
    });
    const keys = audioSourcesOf(d).map(audioSourceKey);
    expect(keys).toEqual(['bgm:found-new-hope', 'bgm:found-new-hope']); // 同じキー＝1つ読めば足りる
    expect(audioSourceKeyOfClip(d.clips[1])).toBe('bgm:found-new-hope');
  });

  it('音の出どころは種別で決める（優先順で黙って吸収しない＝§8 V25 の語彙と一致）', () => {
    // 読み上げに BGM が重ねて指定されていても、読み上げの音源だけを見る（重複は V25 が警告する）。
    const d = doc({ clips: [voiceClip('clip_001', { bundledBgmId: 'found-new-hope' })] });
    expect(audioSourcesOf(d)).toEqual([{ clipId: 'clip_001', voicePath: 'voices/clip_001.wav' }]);
  });

  it('BGM は素材が短くても鳴り続ける（場面形式と同じ）／読み上げは繰り返さない', () => {
    expect(audioLoops(clip('clip_001'))).toBe(true);
    expect(audioLoops(voiceClip('clip_002'))).toBe(false);
  });
});
