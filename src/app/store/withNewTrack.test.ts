// 列の無い所へ落とすと、新しい列を作って置く（#1478・ADR-0049 と同じ規則）。
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTimelineStore } from './timelineStore';
import * as fsMod from '../../infrastructure/projectFs';
import { EDIT_BLOCKED } from '../../domain/timeline/edit';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../../domain/enums';
import { TIMELINE_SCHEMA_VERSION } from '../../domain/timeline/types';
import type { TimelineClip, TimelineProject } from '../../domain/timeline/types';

function doc(): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20261020_001',
    projectName: 'テスト',
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [],
    tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.audio }],
    clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: 4, x: 0, y: 0, w: 10, h: 10, text: 'あ' } as TimelineClip],
  };
}

async function open(d: TimelineProject): Promise<void> {
  vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(d));
  await useTimelineStore.getState().openTimelineProject(d.projectId);
}

beforeEach(() => {
  vi.restoreAllMocks();
  useTimelineStore.getState().closeTimelineProject();
});

describe('withNewTrack（新しい列を作って置く）', () => {
  it('足した列へ運び、取り消し1回で列も部品も元へ戻る', async () => {
    await open(doc());
    const before = useTimelineStore.getState().doc!;
    useTimelineStore.getState().withNewTrack(TRACK_KIND.visual, (id) => useTimelineStore.getState().moveClipById('clip_001', { startSec: 2, trackId: id }));
    const now = useTimelineStore.getState().doc!;
    expect(now.tracks).toHaveLength(3);
    const added = now.tracks.find((t) => !before.tracks.some((o) => o.id === t.id))!;
    expect(added.kind).toBe(TRACK_KIND.visual);
    expect(now.clips[0]).toMatchObject({ trackId: added.id, startSec: 2 });
    useTimelineStore.getState().undo();
    expect(useTimelineStore.getState().doc).toEqual(before);
  });

  // ⚠️ **置けなかったら列も足さない**＝空の列だけが増える、を作らない。理由は置く側が立てたまま出す。
  it('置けなかったら列を足さず、取り消しの履歴にも残さない（理由は残す）', async () => {
    await open(doc());
    const before = useTimelineStore.getState();
    useTimelineStore.getState().withNewTrack(TRACK_KIND.visual, (id) => useTimelineStore.getState().moveClipById('clip_999', { startSec: 2, trackId: id }));
    const after = useTimelineStore.getState();
    expect(after.doc).toEqual(before.doc);
    expect(after.history.past).toHaveLength(before.history.past.length);
    expect(after.editBlocked?.reason).toBe(EDIT_BLOCKED.notFound);
  });

  it('書き出し中は足さない（ほかの編集と同じ）', async () => {
    await open(doc());
    useTimelineStore.setState({ exportRun: { phase: 'encoding', percent: 0, message: null, cancelling: false } });
    const place = vi.fn();
    useTimelineStore.getState().withNewTrack(TRACK_KIND.visual, place);
    expect(place).not.toHaveBeenCalled();
    expect(useTimelineStore.getState().doc!.tracks).toHaveLength(2);
    useTimelineStore.setState({ exportRun: { phase: 'idle', percent: 0, message: null, cancelling: false } });
  });
});
