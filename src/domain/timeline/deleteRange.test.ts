// 範囲を削除して、必要なら間を詰める（#1193）。
// ⚠️ **押しのけモードではない**＝ADR-0034 決定11 はそのまま（動かすたびに後ろが動く形は入れない）。
import { describe, expect, it } from 'vitest';
import { deleteRange, deleteRangeIssue } from './deleteRange';
import { EDIT_BLOCKED } from './edit';
import { volumeAt } from './audio';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import { TIMELINE_SCHEMA_VERSION } from './types';
import { validateTimelineProject } from '../validation/generated/validators.js';
import type { TimelineClip, TimelineProject } from './types';

function doc(over: Partial<TimelineProject> = {}): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20260917_001',
    projectName: 'テスト',
    createdAt: '2026-09-17T00:00:00.000Z',
    updatedAt: '2026-09-17T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [],
    tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.audio }],
    clips: [],
    ...over,
  };
}

const text = (over: Partial<TimelineClip> = {}): TimelineClip =>
  ({ id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: 10, x: 0, y: 0, w: 100, h: 50, text: 'あ', ...over }) as TimelineClip;

const at = (d: TimelineProject, id: string) => d.clips.find((c) => c.id === id);

describe('範囲の削除', () => {
  it('範囲に丸ごと入っている部品は消える', () => {
    const d = doc({ clips: [text({ id: 'clip_001', startSec: 4.5, durationSec: 1 })] });
    const r = deleteRange(d, { startSec: 4, endSec: 6, closeGap: false }, volumeAt);
    expect(r.ok && r.doc.clips).toHaveLength(0);
    expect(r.ok && r.removedClipCount).toBe(1);
  });

  it('またいでいる部品は、前後だけ残る', () => {
    const r = deleteRange(doc({ clips: [text({ startSec: 0, durationSec: 10 })] }), { startSec: 4, endSec: 6, closeGap: false }, volumeAt);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const spans = r.doc.clips.map((c) => [c.startSec, c.startSec + c.durationSec]).sort((a, b) => a[0] - b[0]);
    expect(spans).toEqual([[0, 4], [6, 10]]);
  });

  // ⚠️ **切れ端は置けない**＝部品には最小の長さ（0.1 秒）がある。
  it('残りが短すぎる側は残さない', () => {
    const r = deleteRange(doc({ clips: [text({ startSec: 3.95, durationSec: 6.05 })] }), { startSec: 4, endSec: 6, closeGap: false }, volumeAt);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.clips.map((c) => [c.startSec, c.startSec + c.durationSec])).toEqual([[6, 10]]);
  });

  // ⚠️ **半分だけ残すと言いかけの声になる**＝読み上げは切れない（`splitClipIssue` が断る）。
  it('読み上げは、掛かっていたら丸ごと消す', () => {
    const voice = {
      id: 'clip_010', kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_002', startSec: 0, durationSec: 10,
      voice: { text: 'あ', status: 'none' },
    } as unknown as TimelineClip;
    const r = deleteRange(doc({ clips: [voice] }), { startSec: 4, endSec: 6, closeGap: false }, volumeAt);
    expect(r.ok && r.doc.clips).toHaveLength(0);
  });

  // ⚠️ **参照切れの帯を作らない**＝読み上げを消したのに字幕が残ると、連動先が居なくなる。
  it('読み上げに連動した字幕も、丸ごと消える', () => {
    const sub = { ...text({ id: 'clip_011', startSec: 0, durationSec: 10 }), voiceClipId: 'clip_010' } as TimelineClip;
    const r = deleteRange(doc({ clips: [sub] }), { startSec: 4, endSec: 6, closeGap: false }, volumeAt);
    expect(r.ok && r.doc.clips).toHaveLength(0);
  });

  it('範囲の外の部品は動かない（詰めないとき）', () => {
    const d = doc({
      clips: [
        text({ id: 'clip_001', startSec: 4.5, durationSec: 1 }),
        text({ id: 'clip_002', startSec: 7, durationSec: 2 }),
      ],
    });
    const r = deleteRange(d, { startSec: 4, endSec: 6, closeGap: false }, volumeAt);
    expect(r.ok && at(r.doc, 'clip_002')?.startSec, '詰めていないのに動いた').toBe(7);
  });
});

describe('間を詰める', () => {
  const close = (d: TimelineProject) => deleteRange(d, { startSec: 4, endSec: 6, closeGap: true }, volumeAt);

  it('うしろが詰まる（AAAA[要らない]BBBB → AAAABBBB）', () => {
    const d = doc({ clips: [text({ id: 'clip_001', startSec: 0, durationSec: 4 }), text({ id: 'clip_002', startSec: 6, durationSec: 4 })] });
    const r = close(d);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(at(r.doc, 'clip_001')?.startSec).toBe(0);
    expect(at(r.doc, 'clip_002')?.startSec, '詰まっていない').toBe(4);
  });

  // ⚠️ **ほかの列も一緒に寄る**＝片方だけ詰めると、映像と音の時間がずれる。
  it('列をまたいで、同じだけ寄る', () => {
    const d = doc({ clips: [text({ id: 'clip_001', startSec: 8, durationSec: 2 }), text({ id: 'clip_002', trackId: 'track_002', startSec: 8, durationSec: 2 })] });
    const r = close(d);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(at(r.doc, 'clip_001')?.startSec).toBe(6);
    expect(at(r.doc, 'clip_002')?.startSec, '列によって寄り方が違う').toBe(6);
  });

  // ⚠️ **目印も付いてくる**＝付いてこないと、既にある目印が全部**別の場面**を指す（ADR-0026④）。
  it('うしろの目印も、同じだけ寄る', () => {
    const r = close(doc({ markers: [{ id: 'marker_001', timeSec: 8, text: 'ここ' }] }));
    expect(r.ok && r.doc.markers?.[0]?.timeSec).toBe(6);
  });

  // ⚠️ **黙って消さない**＝利用者が書いた覚えを捨てない。寄せた数を返して、呼ぶ側が知らせる。
  it('消した範囲の中の目印は、切れ目へ寄せて数を返す', () => {
    const r = close(doc({ markers: [{ id: 'marker_001', timeSec: 5, text: 'ここ' }] }));
    expect(r.ok && r.doc.markers?.[0]?.timeSec).toBe(4);
    expect(r.ok && r.clampedMarkerCount).toBe(1);
  });

  it('範囲より前の目印は動かない', () => {
    const r = close(doc({ markers: [{ id: 'marker_001', timeSec: 2, text: 'ここ' }] }));
    expect(r.ok && r.doc.markers?.[0]?.timeSec).toBe(2);
    expect(r.ok && r.clampedMarkerCount).toBe(0);
  });

  // ⚠️ **空白そのものを詰めるのが目的**＝部品が1つも掛かっていなくても断らない。
  it('部品が無い空白でも詰められる', () => {
    const r = close(doc({ clips: [text({ id: 'clip_002', startSec: 6, durationSec: 2 })] }));
    expect(r.ok && at(r.doc, 'clip_002')?.startSec).toBe(4);
  });

  it('詰めた結果が、正典の形として通る', () => {
    const d = doc({
      clips: [text({ id: 'clip_001', startSec: 0, durationSec: 4 }), text({ id: 'clip_002', startSec: 6, durationSec: 4 })],
      markers: [{ id: 'marker_001', timeSec: 8, text: 'ここ' }],
    });
    const r = close(d);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(validateTimelineProject(r.doc), JSON.stringify(validateTimelineProject.errors)).toBe(true);
  });
});

describe('断り（押す前に見る）', () => {
  it('範囲が逆さま・幅ゼロなら断る', () => {
    expect(deleteRangeIssue(doc(), { startSec: 6, endSec: 4, closeGap: false })).toBe(EDIT_BLOCKED.notFound);
    expect(deleteRangeIssue(doc(), { startSec: 4, endSec: 4, closeGap: false })).toBe(EDIT_BLOCKED.notFound);
  });

  // ⚠️ **押しても何も起きない、を作らない**（§2-5）。
  it('何も掛かっていなければ断る（詰めないとき）', () => {
    expect(deleteRangeIssue(doc(), { startSec: 4, endSec: 6, closeGap: false })).toBe(EDIT_BLOCKED.notFound);
  });

  it('固定された列が対象にあれば断る', () => {
    const d = doc({ tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, locked: true }], clips: [text({ startSec: 0, durationSec: 10 })] });
    expect(deleteRangeIssue(d, { startSec: 4, endSec: 6, closeGap: false })).toBe(EDIT_BLOCKED.lockedSelection);
  });

  // ⚠️ **詰めるのは文書全体に効く**＝固定した列の中身まで動くので、1つでもあれば断る。
  it('詰めるときは、対象外の列が固定されていても断る', () => {
    const d = doc({
      tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.audio, locked: true }],
      clips: [text({ startSec: 0, durationSec: 10 })],
    });
    expect(deleteRangeIssue(d, { startSec: 4, endSec: 6, closeGap: true })).toBe(EDIT_BLOCKED.lockedSelection);
  });
});

describe('列を選んで消す（詰めないとき）', () => {
  // ⚠️ **選んだ列だけ**＝選んでいない列の中身まで消えると、見えていない所が黙って変わる（ADR-0026④）。
  it('選んだ列の部品だけが消える', () => {
    const d = doc({
      clips: [
        text({ id: 'clip_001', trackId: 'track_001', startSec: 4.5, durationSec: 1 }),
        text({ id: 'clip_002', trackId: 'track_002', startSec: 4.5, durationSec: 1 }),
      ],
    });
    const r = deleteRange(d, { startSec: 4, endSec: 6, trackIds: ['track_001'], closeGap: false }, volumeAt);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.clips.map((c) => c.id), '選んでいない列まで消している').toEqual(['clip_002']);
  });

  // ⚠️ **詰めるときは列を選べない**＝選べると、ほかの列と時間がずれ、詰めて前へ来た部品が重なる（V24）。
  it('詰めるときは、列を選んでも全部が対象になる', () => {
    const d = doc({
      clips: [
        text({ id: 'clip_001', trackId: 'track_001', startSec: 4.5, durationSec: 1 }),
        text({ id: 'clip_002', trackId: 'track_002', startSec: 4.5, durationSec: 1 }),
      ],
    });
    const r = deleteRange(d, { startSec: 4, endSec: 6, trackIds: ['track_001'], closeGap: true }, volumeAt);
    expect(r.ok && r.doc.clips, '選ばなかった列が残っている＝詰めると重なる').toHaveLength(0);
  });
});
