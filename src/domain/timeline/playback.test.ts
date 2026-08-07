// タイムラインの再生位置（ADR-0032・#630）。フレーム格子・終端・退化ケースを固定する。
import { describe, expect, it } from 'vitest';
import { FPS } from '../constants';
import { playbackStartSec, playbackTick, quantizeToFrameSec, seekByFrames } from './playback';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import { TIMELINE_SCHEMA_VERSION } from './types';
import type { TimelineProject } from './types';

describe('playbackTick', () => {
  it('フレーム格子へ落とす（1フレームの間は同じ時刻＝書き出しとずれない）', () => {
    // 30fps なら 1/30≒0.0333 秒刻み。0.02 秒経過はまだ0フレーム目。
    expect(playbackTick(0, 0.02, 10).sec).toBe(0);
    expect(playbackTick(0, 0.04, 10).sec).toBeCloseTo(1 / FPS);
    expect(playbackTick(0, 1, 10).sec).toBeCloseTo(1);
  });

  it('始めた位置からの相対で進む', () => {
    expect(playbackTick(3, 1, 10).sec).toBeCloseTo(4);
  });

  it('尺の終わりで止まる（ループしない＝書き出しと同じ長さで終わる）', () => {
    expect(playbackTick(0, 10, 10)).toEqual({ sec: 10, ended: true });
    expect(playbackTick(9, 5, 10)).toEqual({ sec: 10, ended: true });
  });

  it('終端の判定は量子化の前に行う（1フレーム手前へ丸まって終われない、を作らない）', () => {
    // 尺がフレームの格子に乗っていないとき（5.52 秒＝30fps の格子上に無い）、量子化後の時刻は
    // 5.5 秒に丸まる。丸めた後で終端を見ると「まだ終わっていない」になり、**永久に終われない**。
    expect(playbackTick(0, 5.53, 5.52)).toEqual({ sec: 5.52, ended: true });
    // 格子に乗る尺では丸め前後で差が出ない（この確認だけでは上の取り違えを検出できない）。
    expect(playbackTick(0, 10, 10).ended).toBe(true);
  });

  it('終わる直前はまだ終わっていない', () => {
    const r = playbackTick(0, 9.99, 10);
    expect(r.ended).toBe(false);
    expect(r.sec).toBeLessThan(10);
  });

  it('何も置いていない動画では進まない（押しても暴走しない）', () => {
    expect(playbackTick(0, 5, 0)).toEqual({ sec: 0, ended: true });
  });

  it('経過が戻っても位置は戻らない（時計の揺れで巻き戻らない）', () => {
    expect(playbackTick(3, -1, 10).sec).toBeCloseTo(3);
  });

  it('fps を渡せる（0 以下は既定へ）', () => {
    expect(playbackTick(0, 0.5, 10, 2).sec).toBeCloseTo(0.5);
    expect(playbackTick(0, 0.02, 10, 0).sec).toBe(0); // 既定 30fps 相当
  });
});

describe('playbackStartSec', () => {
  it('途中からはその位置で始める', () => {
    expect(playbackStartSec(3, 10)).toBe(3);
  });

  it('終端にいるときは先頭から始める（押しても動かない、を作らない）', () => {
    expect(playbackStartSec(10, 10)).toBe(0);
    expect(playbackStartSec(99, 10)).toBe(0);
  });

  it('何も置いていない動画では 0', () => {
    expect(playbackStartSec(5, 0)).toBe(0);
  });
});

describe('seekByFrames（矢印キー・#721）', () => {
  const doc = (fps = 30, dur = 10): TimelineProject => ({
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_1', projectName: 't',
    createdAt: '2026-08-06T00:00:00.000Z', updatedAt: '2026-08-06T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [], tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }],
    clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: dur, x: 0, y: 0, w: 10, h: 10, text: 'あ' }],
  });

  it('押した回数ぶんフレームが進む（秒を足し込むと誤差で留まる／飛ぶ）', () => {
    const d = doc();
    let t = 0;
    const frames: number[] = [];
    for (let i = 0; i < 10; i++) { t = seekByFrames(d, t, 1); frames.push(Math.round(quantizeToFrameSec(t, 30) * 30)); }
    // ⚠️ `t += 1/30` だと [1,2,3,4,5,5,6,8,9,10]＝6回目が留まり8回目が飛ぶ（#721 レビューの実測）。
    expect(frames).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('戻ると同じ格子へ戻る（往復してずれない）', () => {
    const d = doc();
    let t = 0;
    for (let i = 0; i < 7; i++) t = seekByFrames(d, t, 1);
    for (let i = 0; i < 7; i++) t = seekByFrames(d, t, -1);
    expect(t).toBe(0);
  });

  it('尺の外へは出ない（前後どちらも収める）', () => {
    const d = doc();
    expect(seekByFrames(d, 0, -1)).toBe(0);
    expect(seekByFrames(d, 10, 1)).toBe(10);
  });

  it('fps が違う動画では、その動画の格子で動く', () => {
    expect(seekByFrames(doc(60), 0, 1)).toBeCloseTo(1 / 60, 10);
    expect(seekByFrames(doc(60), 0, 60)).toBe(1); // 60 フレーム＝1秒
  });
});
