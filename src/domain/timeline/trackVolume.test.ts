// 列ごとの音量とソロ（ADR-0067・#1476）。
import { describe, expect, it } from 'vitest';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import { VOLUME_MAX } from '../constants';
import type { TimelineClip, TimelineProject } from './types';
import { TIMELINE_SCHEMA_VERSION } from './types';
import { activeSoloTrackIds, audioCuesAt, clipGainAt, soloFilteredCues, trackGainOf } from './audio';
import { setTrackVolume } from './edit';
import { timelineAudioRuns } from './export';
import { validateTimelineProject } from '../validation/generated/validators.js';

const bgm = (id: string, over: Partial<TimelineClip> = {}): TimelineClip =>
  ({ id, kind: TIMELINE_CLIP_KIND.audio, trackId: 'track_002', startSec: 0, durationSec: 5, bundledBgmId: 'summer-morning', volume: 0.5, ...over }) as TimelineClip;

function doc(over: Partial<TimelineProject> = {}): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20261020_001',
    projectName: 'テスト',
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600, audioAuto: { duckBgm: false } },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [],
    tracks: [
      { id: 'track_001', kind: TRACK_KIND.visual },
      { id: 'track_002', kind: TRACK_KIND.audio },
      { id: 'track_003', kind: TRACK_KIND.audio },
    ],
    clips: [bgm('clip_001'), bgm('clip_002', { trackId: 'track_003' })],
    ...over,
  };
}

const withTrackVolume = (d: TimelineProject, id: string, volume: number): TimelineProject =>
  ({ ...d, tracks: d.tracks.map((t) => (t.id === id ? { ...t, volume } : t)) });

describe('setTrackVolume（列の音量を直す）', () => {
  it('音の列に入る・値域に収める・null と 100% はキーを消す', () => {
    const d = doc();
    expect(setTrackVolume(d, 'track_002', 0.6).tracks[1]!.volume).toBe(0.6);
    expect(setTrackVolume(d, 'track_002', 9).tracks[1]!.volume).toBe(VOLUME_MAX);
    expect(setTrackVolume(d, 'track_002', -1).tracks[1]!.volume).toBe(0);
    const set = setTrackVolume(d, 'track_002', 0.6);
    expect('volume' in setTrackVolume(set, 'track_002', null).tracks[1]!).toBe(false);
    expect('volume' in setTrackVolume(set, 'track_002', 1).tracks[1]!).toBe(false);
  });

  it('映像の列・無い列では何もしない（同じ文書）', () => {
    const d = doc();
    expect(setTrackVolume(d, 'track_001', 0.5)).toBe(d);
    expect(setTrackVolume(d, 'track_999', 0.5)).toBe(d);
  });

  it('何も変わらなければ同じ文書を返す（取り消しを空振りさせない）', () => {
    const d = setTrackVolume(doc(), 'track_002', 0.6);
    expect(setTrackVolume(d, 'track_002', 0.6)).toBe(d);
    expect(setTrackVolume(doc(), 'track_002', null)).toEqual(doc());
  });

  it('できた文書は正典（schema）に通る', () => {
    const d = setTrackVolume(doc(), 'track_002', 0.6);
    expect(validateTimelineProject(d), JSON.stringify(validateTimelineProject.errors)).toBe(true);
  });
});

describe('trackGainOf（列の倍率）', () => {
  it('未指定・映像の列は 1、音の列は値（値域に収める）', () => {
    expect(trackGainOf(undefined)).toBe(1);
    expect(trackGainOf({ kind: TRACK_KIND.audio })).toBe(1);
    expect(trackGainOf({ kind: TRACK_KIND.audio, volume: 0.4 })).toBe(0.4);
    expect(trackGainOf({ kind: TRACK_KIND.audio, volume: 5 })).toBe(VOLUME_MAX);
    expect(trackGainOf({ kind: TRACK_KIND.visual, volume: 0.4 })).toBe(1);
  });
});

describe('列の音量は再生と書き出しの両方に効く（ADR-0067 決定1）', () => {
  it('再生：その列の音だけ倍率が掛かる', () => {
    const d = withTrackVolume(doc(), 'track_002', 0.5);
    const cues = audioCuesAt(d, 1);
    expect(cues.find((q) => q.clipId === 'clip_001')!.volume).toBeCloseTo(0.25, 9); // 0.5 × 0.5
    expect(cues.find((q) => q.clipId === 'clip_002')!.volume).toBeCloseTo(0.5, 9); // 別の列はそのまま
  });

  // ⚠️ **部品の音量の線は部品の設定のまま**（業界の型＝部品の音量とミキサーは別）。
  it('部品の音量の線（clipGainAt）には入れない', () => {
    const d = withTrackVolume(doc(), 'track_002', 0.5);
    expect(clipGainAt(d.clips[0]!, d, 1)).toBeCloseTo(0.5, 9);
  });

  it('書き出し：一定の音量にも、音量の変化の式にも同じ倍率が掛かる（再生と一致）', () => {
    const pts = [{ timeSec: 0, volume: 0.2 }, { timeSec: 4, volume: 0.8 }];
    const d = withTrackVolume(doc({ clips: [bgm('clip_001'), bgm('clip_002', { trackId: 'track_002', startSec: 5, volumePoints: pts })] }), 'track_002', 0.5);
    const { runs } = timelineAudioRuns(d);
    const plain = runs.find((r) => r.clipId === 'clip_001')!;
    expect(plain.volume).toBeCloseTo(audioCuesAt(d, 1).find((q) => q.clipId === 'clip_001')!.volume, 9);
    const pointed = runs.find((r) => r.clipId === 'clip_002')!;
    // 式の中の値が半分になっている（0.2→0.1・0.8→0.4）。
    expect(pointed.volumeExpr).toContain('*0.1');
    expect(pointed.volumeExpr).toContain('*0.4');
    expect(pointed.volumeExpr).not.toContain('*0.8');
  });

  it('列の音量が無ければ書き出しは今までと同じ', () => {
    const { runs } = timelineAudioRuns(doc());
    expect(runs.find((r) => r.clipId === 'clip_001')!.volume).toBe(0.5);
  });
});

describe('ソロ（ADR-0067 決定2＝編集中の聞き方だけ）', () => {
  it('ソロの列の音だけ残す', () => {
    const d = doc();
    expect(soloFilteredCues(d, audioCuesAt(d, 1), ['track_003']).map((q) => q.clipId)).toEqual(['clip_002']);
  });

  it('ソロが無ければそのまま', () => {
    const d = doc();
    expect(soloFilteredCues(d, audioCuesAt(d, 1), []).map((q) => q.clipId)).toEqual(['clip_001', 'clip_002']);
  });

  // ⚠️ **消した列の id を残したまま見ない**＝残った id のせいで全部が鳴らなくなる。
  it('消した列・映像の列のソロは数えない（全部が無音にならない）', () => {
    const d = doc();
    expect(activeSoloTrackIds(d, ['track_999'])).toBeNull();
    expect(activeSoloTrackIds(d, ['track_001'])).toBeNull();
    expect(soloFilteredCues(d, audioCuesAt(d, 1), ['track_999']).map((q) => q.clipId)).toEqual(['clip_001', 'clip_002']);
    expect([...activeSoloTrackIds(d, ['track_999', 'track_002'])!]).toEqual(['track_002']);
  });
});

// ⚠️ **掛けたあとで値域へ収める**（PR レビュー 🟡）＝上限の掛け方を再生と書き出しで割らない。
describe('部品の音量 × 列の音量が上限を超えるとき', () => {
  it('再生も書き出しも 1.5 で止まる（点のある部品・無い部品とも）', () => {
    const pts = [{ timeSec: 0, volume: 1.2 }, { timeSec: 4, volume: 1.2 }];
    const d = withTrackVolume(doc({ clips: [bgm('clip_001', { volume: 1.2 }), bgm('clip_002', { trackId: 'track_002', startSec: 5, volumePoints: pts })] }), 'track_002', 1.5);
    expect(audioCuesAt(d, 1).find((q) => q.clipId === 'clip_001')!.volume).toBe(VOLUME_MAX);
    const { runs } = timelineAudioRuns(d);
    expect(runs.find((r) => r.clipId === 'clip_001')!.volume).toBe(VOLUME_MAX);
    expect(runs.find((r) => r.clipId === 'clip_002')!.volumeExpr).not.toContain('1.8');
  });
});
