// 作業範囲を消す／詰める（#1193）。⚠️ **押しのけモードではない**（ADR-0034 決定11 は不変）。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimelineStore } from './timelineStore';
import * as fsMod from '../../infrastructure/projectFs';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../../domain/enums';
import { TIMELINE_SCHEMA_VERSION } from '../../domain/timeline/types';
import { EDIT_BLOCKED } from '../../domain/timeline/edit';
import type { TimelineClip, TimelineProject } from '../../domain/timeline/types';

const text = (over: Partial<TimelineClip> = {}): TimelineClip =>
  ({ id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: 4, x: 0, y: 0, w: 100, h: 50, text: 'あ', ...over }) as TimelineClip;

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
    clips: [text({ id: 'clip_001', startSec: 0, durationSec: 4 }), text({ id: 'clip_002', startSec: 6, durationSec: 4 })],
    ...over,
  };
}

async function open(d: TimelineProject): Promise<void> {
  vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(d));
  await useTimelineStore.getState().openTimelineProject(d.projectId);
}

const at = (id: string) => useTimelineStore.getState().doc?.clips.find((c) => c.id === id);

beforeEach(() => {
  vi.restoreAllMocks();
  useTimelineStore.getState().closeTimelineProject();
  useTimelineStore.setState({ editBlocked: null, editNotice: null, rangeInSec: null, rangeOutSec: null });
});

describe('作業範囲を取る', () => {
  it('始まりと終わりを、それぞれ置ける', () => {
    useTimelineStore.getState().setRangeEdge('in', 4);
    useTimelineStore.getState().setRangeEdge('out', 6);
    expect(useTimelineStore.getState().rangeInSec).toBe(4);
    expect(useTimelineStore.getState().rangeOutSec).toBe(6);
  });

  // ⚠️ **勝手に入れ替えない**＝入れ替えると「押した所と違う所が範囲になった」に見える。
  it('逆さまに置いても、置いたとおりに残る', () => {
    useTimelineStore.getState().setRangeEdge('in', 6);
    useTimelineStore.getState().setRangeEdge('out', 4);
    expect(useTimelineStore.getState().rangeInSec).toBe(6);
    expect(useTimelineStore.getState().rangeOutSec).toBe(4);
  });

  it('外せる', () => {
    useTimelineStore.getState().setRangeEdge('in', 4);
    useTimelineStore.getState().clearRange();
    expect(useTimelineStore.getState().rangeInSec).toBeNull();
  });
});

describe('作業範囲を消す', () => {
  it('詰めると、うしろが前へ寄る（1つの取り消しで戻る）', async () => {
    await open(doc());
    const before = useTimelineStore.getState().history.past.length;
    useTimelineStore.getState().setRangeEdge('in', 4);
    useTimelineStore.getState().setRangeEdge('out', 6);
    useTimelineStore.getState().deleteRangeInTimeline(true);
    expect(at('clip_002')?.startSec, '詰まっていない').toBe(4);
    // ⚠️ **1操作＝1つの取り消し**（ADR-0034 決定20）＝消すのと詰めるのを別々に積まない。
    expect(useTimelineStore.getState().history.past.length - before, '取り消しが2つ以上積まれた').toBe(1);
    useTimelineStore.getState().undo();
    expect(at('clip_002')?.startSec, '1回の取り消しで戻らない').toBe(6);
  });

  it('詰めなければ、うしろは動かない', async () => {
    await open(doc({ clips: [text({ id: 'clip_001', startSec: 4.5, durationSec: 1 }), text({ id: 'clip_002', startSec: 6, durationSec: 4 })] }));
    useTimelineStore.getState().setRangeEdge('in', 4);
    useTimelineStore.getState().setRangeEdge('out', 6);
    useTimelineStore.getState().deleteRangeInTimeline(false);
    expect(at('clip_001')).toBeUndefined();
    expect(at('clip_002')?.startSec).toBe(6);
  });

  // ⚠️ **逆さまでも消せる**＝置いたとおりに残しておいて、消すときに小さい方から大きい方へ。
  it('始まりと終わりが逆さまでも、同じ範囲を消す', async () => {
    await open(doc());
    useTimelineStore.getState().setRangeEdge('in', 6);
    useTimelineStore.getState().setRangeEdge('out', 4);
    useTimelineStore.getState().deleteRangeInTimeline(true);
    expect(at('clip_002')?.startSec).toBe(4);
  });

  // ⚠️ **押しても何も起きない、を作らない**（§2-5）。
  it('範囲を取っていなければ、理由を出す', async () => {
    await open(doc());
    useTimelineStore.getState().deleteRangeInTimeline(true);
    expect(useTimelineStore.getState().editBlocked?.reason).toBe(EDIT_BLOCKED.notFound);
  });

  it('消したら、範囲は外れる', async () => {
    await open(doc());
    useTimelineStore.getState().setRangeEdge('in', 4);
    useTimelineStore.getState().setRangeEdge('out', 6);
    useTimelineStore.getState().deleteRangeInTimeline(true);
    expect(useTimelineStore.getState().rangeInSec, '消したのに範囲が残っている').toBeNull();
  });

  // ⚠️ **黙って動かさない**＝利用者が書いた覚えを寄せたなら、そう言う（§2-5）。
  it('消した所にいた目印を寄せたら、知らせる', async () => {
    await open(doc({ markers: [{ id: 'marker_001', timeSec: 5, text: 'ここ' }] }));
    useTimelineStore.getState().setRangeEdge('in', 4);
    useTimelineStore.getState().setRangeEdge('out', 6);
    useTimelineStore.getState().deleteRangeInTimeline(true);
    expect(useTimelineStore.getState().editNotice, '寄せたのに黙っている').toMatch(/目印/);
  });

  it('寄せた目印が無ければ、知らせない', async () => {
    await open(doc({ markers: [{ id: 'marker_001', timeSec: 8, text: 'ここ' }] }));
    useTimelineStore.getState().setRangeEdge('in', 4);
    useTimelineStore.getState().setRangeEdge('out', 6);
    useTimelineStore.getState().deleteRangeInTimeline(true);
    expect(useTimelineStore.getState().editNotice, '寄せていないのに知らせている').toBeNull();
  });
});

describe('詰めないときの断り（PR #1199 レビュー 🟡5）', () => {
  // ⚠️ **押しても何も起きない、を作らない**＝部品が1つも掛かっていない範囲は、
  // 「詰める」なら空白を詰める意味があるが、「詰めない」なら**することが無い**。
  it('部品が無い範囲を、詰めずに消そうとしたら断る', async () => {
    await open(doc({ clips: [text({ id: 'clip_002', startSec: 8, durationSec: 2 })] }));
    useTimelineStore.getState().setRangeEdge('in', 4);
    useTimelineStore.getState().setRangeEdge('out', 6);
    useTimelineStore.getState().deleteRangeInTimeline(false);
    expect(useTimelineStore.getState().editBlocked?.reason, '何も無いのに消せている').toBe(EDIT_BLOCKED.notFound);
  });

  // ⚠️ **詰めるときは断らない**＝空白そのものを詰めるのが目的。
  it('部品が無い範囲でも、詰めるなら通る', async () => {
    await open(doc({ clips: [text({ id: 'clip_002', startSec: 8, durationSec: 2 })] }));
    useTimelineStore.getState().setRangeEdge('in', 4);
    useTimelineStore.getState().setRangeEdge('out', 6);
    useTimelineStore.getState().deleteRangeInTimeline(true);
    expect(useTimelineStore.getState().editBlocked).toBeNull();
    expect(at('clip_002')?.startSec, '詰まっていない').toBe(6);
  });
});
