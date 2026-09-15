// 目印のふるまい（#356 ①・#1149・ADR-0040）＝store まで通した形で見る。
//
// ⚠️ **純粋関数だけでは足りない**＝「押しても無反応」「履歴の空振り」「再生中に押せるか」は
// **呼ぶ側**の作りで決まる（`markers.ts` は同じ文書を返すだけ）。
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../renderer/export/rasterize', () => ({ svgToPngDataUrl: vi.fn(async () => 'data:image/png;base64,X') }));

import { useTimelineStore } from './timelineStore';
import * as fsMod from '../../infrastructure/projectFs';
import { EDIT_BLOCKED } from '../../domain/timeline/edit';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../../domain/enums';
import { TIMELINE_SCHEMA_VERSION } from '../../domain/timeline/types';
import type { TimelineProject } from '../../domain/timeline/types';

function doc(over: Partial<TimelineProject> = {}): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20260915_001',
    projectName: 'テスト',
    createdAt: '2026-09-15T00:00:00.000Z',
    updatedAt: '2026-09-15T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [],
    tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.audio }],
    clips: [{
      id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001',
      startSec: 0, durationSec: 20, x: 0, y: 0, w: 10, h: 10, text: 'あ',
    }],
    ...over,
  };
}

async function open(d: TimelineProject): Promise<void> {
  vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(d));
  await useTimelineStore.getState().openTimelineProject(d.projectId);
}

beforeEach(() => {
  vi.restoreAllMocks();
  useTimelineStore.getState().closeTimelineProject();
  useTimelineStore.setState({
    exportRun: { phase: 'idle', percent: 0, message: null, cancelling: false },
    isImporting: false, editBlocked: null, isPlaying: false,
  });
});

describe('目印を置く（#1149 ①・ADR-0040）', () => {
  it('置いたら、再生位置をその目印の時刻へ寄せる（「いまここ」の印が付く）', async () => {
    await open(doc());
    // ⚠️ **格子に乗らない位置**から置く＝寄せていなければ一致しない。
    useTimelineStore.setState({ playheadSec: 4.017 });
    useTimelineStore.getState().addMarkerAtPlayhead();
    const st = useTimelineStore.getState();
    expect(st.doc!.markers).toHaveLength(1);
    expect(st.playheadSec, '目印の時刻へ寄っていない').toBe(st.doc!.markers![0]!.timeSec);
  });

  // ⚠️ **二度押しで「押しても無反応」を作らない**＝目印は押すと再生位置がそこへ跳ぶのが主導線なので、
  // 跳んだ直後にもう一度置こうとする筋を普通に踏む。
  it('同じ時刻で二度押しても増えず、その目印が選ばれた状態になる', async () => {
    await open(doc());
    useTimelineStore.setState({ playheadSec: 4.017 });
    useTimelineStore.getState().addMarkerAtPlayhead();
    const first = useTimelineStore.getState().doc!.markers![0]!;
    useTimelineStore.getState().addMarkerAtPlayhead();
    const st = useTimelineStore.getState();
    expect(st.doc!.markers, '同じ時刻に2つできている').toHaveLength(1);
    expect(st.playheadSec).toBe(first.timeSec);
  });

  // ⚠️ **再生中も置ける**（ADR-0040＝利用者判断）＝業界の型で主用途は「見ながら置く」。
  it('再生中でも置ける（止めもしない）', async () => {
    await open(doc());
    useTimelineStore.setState({ isPlaying: true, playheadSec: 3 });
    useTimelineStore.getState().addMarkerAtPlayhead();
    expect(useTimelineStore.getState().doc!.markers, '再生中に置けていない').toHaveLength(1);
  });
});

describe('目印を動かす（#1149 ①②）', () => {
  const twoMarkers = () => doc({ markers: [{ id: 'marker_001', timeSec: 3 }, { id: 'marker_002', timeSec: 7 }] });

  // ⚠️ **押しても無反応を作らない**＝動かす先に別の目印がいるときは理由を出す。
  it('動かす先に別の目印がいるときは、理由を出す', async () => {
    await open(twoMarkers());
    useTimelineStore.setState({ playheadSec: 7 });
    useTimelineStore.getState().moveMarkerToPlayhead('marker_001');
    const st = useTimelineStore.getState();
    expect(st.editBlocked?.reason, '黙って何もしていない').toBe(EDIT_BLOCKED.markerExists);
    expect(st.doc!.markers!.find((m) => m.id === 'marker_001')!.timeSec, '動いてしまっている').toBe(3);
  });

  // ⚠️ **取り消しが空振りしない**＝何も変わらないのに履歴が積まれると、`Ctrl+Z` で画面が変わらず、
  // 押し続けると**取り消しでしか戻せない編集が押し出される**。
  it('もうそこに居る目印を「ここへ動かす」と、履歴が積まれない', async () => {
    await open(twoMarkers());
    useTimelineStore.setState({ playheadSec: 3 });
    const before = useTimelineStore.getState().history.past.length;
    useTimelineStore.getState().moveMarkerToPlayhead('marker_001');
    expect(useTimelineStore.getState().history.past.length, '空振りで履歴が積まれた').toBe(before);
  });

  it('本当に動かすときは履歴に積む', async () => {
    await open(twoMarkers());
    useTimelineStore.setState({ playheadSec: 5 });
    const before = useTimelineStore.getState().history.past.length;
    useTimelineStore.getState().moveMarkerToPlayhead('marker_001');
    expect(useTimelineStore.getState().history.past.length).toBe(before + 1);
    expect(useTimelineStore.getState().doc!.markers!.find((m) => m.id === 'marker_001')!.timeSec).toBe(5);
  });

  it('同じメモを書き直しても履歴が積まれない', async () => {
    await open(doc({ markers: [{ id: 'marker_001', timeSec: 3, text: 'あ' }] }));
    const before = useTimelineStore.getState().history.past.length;
    useTimelineStore.getState().setMarkerTextFor('marker_001', 'あ');
    expect(useTimelineStore.getState().history.past.length, '空振りで履歴が積まれた').toBe(before);
  });

  it('無い目印を消しても履歴が積まれない', async () => {
    await open(doc({ markers: [{ id: 'marker_001', timeSec: 3 }] }));
    const before = useTimelineStore.getState().history.past.length;
    useTimelineStore.getState().removeMarkerById('marker_999');
    expect(useTimelineStore.getState().history.past.length, '空振りで履歴が積まれた').toBe(before);
  });
});
