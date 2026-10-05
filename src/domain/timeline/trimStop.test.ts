// 端を引きすぎたら限界で止める（ADR-0034 追補 2026-10-05）・素材の外へは伸ばさない（#1331）。
import { describe, expect, it } from 'vitest';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import { TIMELINE_SCHEMA_VERSION } from './types';
import type { TimelineClip, TimelineProject } from './types';
import { EDIT_BLOCKED, trimClip, trimStopSec } from './edit';

function doc(clips: TimelineClip[], over: Partial<TimelineProject> = {}): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20261005_001',
    projectName: 'テスト',
    createdAt: '2026-10-05T00:00:00.000Z',
    updatedAt: '2026-10-05T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [
      { assetId: 'asset_v', assetType: 'video', displayName: '動画', filePath: 'v.mp4', metadata: { durationSec: 6 } },
      { assetId: 'asset_a', assetType: 'audio', displayName: '音', filePath: 'a.mp3', metadata: { durationSec: 6 } },
    ],
    tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.audio }],
    clips,
    ...over,
  } as TimelineProject;
}

const text = (over: Partial<TimelineClip> = {}): TimelineClip =>
  ({ id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: 3, x: 0, y: 0, w: 10, h: 10, text: 'あ', ...over }) as TimelineClip;
const video = (over: Partial<TimelineClip> = {}): TimelineClip =>
  ({ id: 'clip_v', kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001', startSec: 5, durationSec: 3, x: 0, y: 0, w: 10, h: 10, assetId: 'asset_v', sourceStartSec: 1, ...over }) as TimelineClip;
const audio = (over: Partial<TimelineClip> = {}): TimelineClip =>
  ({ id: 'clip_a', kind: TIMELINE_CLIP_KIND.audio, trackId: 'track_002', startSec: 0, durationSec: 4, assetId: 'asset_a', sourceStartSec: 0, ...over }) as TimelineClip;

describe('trimStopSec（端は限界で止める）', () => {
  it('置けるならそのまま（止まらない）', () => {
    const d = doc([text(), text({ id: 'clip_002', startSec: 5 })]);
    expect(trimStopSec(d, 'clip_001', 'end', 4)).toEqual({ sec: 4, stopped: false });
  });

  it('右の端は隣の帯の始まりにぴったり止まる', () => {
    const d = doc([text(), text({ id: 'clip_002', startSec: 5 })]);
    expect(trimStopSec(d, 'clip_001', 'end', 9)).toEqual({ sec: 5, stopped: true });
  });

  it('左の端は前の帯の終わりにぴったり止まる', () => {
    const d = doc([text(), text({ id: 'clip_002', startSec: 5 })]);
    expect(trimStopSec(d, 'clip_002', 'start', 0)).toEqual({ sec: 3, stopped: true });
  });

  it('止まった位置は、確定（trimClip）でも置ける', () => {
    const d = doc([text(), text({ id: 'clip_002', startSec: 5 })]);
    const st = trimStopSec(d, 'clip_001', 'end', 9);
    expect(trimClip(d, 'clip_001', 'end', st.sec).ok).toBe(true);
  });

  it('動画は素材の終わりで止まる（使い始め 1秒・実尺 6秒＝長さ 5秒まで）', () => {
    const d = doc([video({ startSec: 0 })]);
    const st = trimStopSec(d, 'clip_v', 'end', 10);
    expect(st.stopped).toBe(true);
    expect(st.sec).toBeCloseTo(5, 4);
  });

  it('動画の左の端は素材の頭で止まる（中身をずらさない）', () => {
    const d = doc([video()]);
    const st = trimStopSec(d, 'clip_v', 'start', 0);
    expect(st.stopped).toBe(true);
    expect(st.sec).toBeCloseTo(4, 4); // 使い始め 1秒ぶんだけ前へ
  });

  it('固定した列の帯は、今の端のまま（止まって動かない）', () => {
    const d = doc([text()], { tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, locked: true }, { id: 'track_002', kind: TRACK_KIND.audio }] });
    expect(trimStopSec(d, 'clip_001', 'end', 9)).toEqual({ sec: 3, stopped: true });
  });
});

describe('素材の外へは伸ばさない（#1331）', () => {
  it('動画の右の端を素材の終わりより先へ伸ばすと断る', () => {
    const r = trimClip(doc([video({ startSec: 0 })]), 'clip_v', 'end', 7);
    expect(r.ok ? null : r.reason).toBe(EDIT_BLOCKED.trimPastSourceEnd);
  });

  it('動画の左の端を素材の頭より前へ伸ばすと断る', () => {
    const r = trimClip(doc([video()]), 'clip_v', 'start', 3);
    expect(r.ok ? null : r.reason).toBe(EDIT_BLOCKED.trimBeforeSource);
  });

  it('音も同じ（右は実尺まで）', () => {
    const r = trimClip(doc([audio()]), 'clip_a', 'end', 7);
    expect(r.ok ? null : r.reason).toBe(EDIT_BLOCKED.trimPastSourceEnd);
    expect(trimClip(doc([audio()]), 'clip_a', 'end', 6).ok).toBe(true);
  });

  it('既に素材より長い部品を縮めるのは通す（伸ばすときだけ見る）', () => {
    const long = audio({ durationSec: 8 }); // 実尺 6秒より長い（速さの変更などで起きうる）
    expect(trimClip(doc([long]), 'clip_a', 'end', 7).ok).toBe(true);
    const r = trimClip(doc([long]), 'clip_a', 'end', 9);
    expect(r.ok ? null : r.reason).toBe(EDIT_BLOCKED.trimPastSourceEnd);
  });

  it('速さを見て数える（2倍速なら 6秒の素材は 3秒ぶん）', () => {
    const r = trimClip(doc([audio({ speed: 2, durationSec: 2 })]), 'clip_a', 'end', 3.5);
    expect(r.ok ? null : r.reason).toBe(EDIT_BLOCKED.trimPastSourceEnd);
    expect(trimClip(doc([audio({ speed: 2, durationSec: 2 })]), 'clip_a', 'end', 3).ok).toBe(true);
  });

  it('実尺が分からない素材は断らない（分からないことを理由にしない）', () => {
    const d = doc([video({ startSec: 0 })]);
    d.assets[0] = { ...d.assets[0], metadata: {} } as never;
    expect(trimClip(d, 'clip_v', 'end', 20).ok).toBe(true);
  });

  it('文字・図形は長さの限界が無い', () => {
    expect(trimClip(doc([text()]), 'clip_001', 'end', 100).ok).toBe(true);
  });
});
