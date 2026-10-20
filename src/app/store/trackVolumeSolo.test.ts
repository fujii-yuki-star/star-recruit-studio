// 列の音量とソロ（ADR-0067・#1476）＝音量は文書の編集（取り消せる）、ソロは編集中の聞き方だけ（文書を変えない）。
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTimelineStore } from './timelineStore';
import * as fsMod from '../../infrastructure/projectFs';
import { PROJECT_FORMAT, TRACK_KIND } from '../../domain/enums';
import { TIMELINE_SCHEMA_VERSION } from '../../domain/timeline/types';
import type { TimelineProject } from '../../domain/timeline/types';
import { trackVolumeFromPercentText } from '../trackVolumeInput';

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
    clips: [],
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

describe('setTrackVolume（列の音量）', () => {
  it('文書に入り、取り消し1回で戻る', async () => {
    await open(doc());
    useTimelineStore.getState().setTrackVolume('track_002', 0.6);
    expect(useTimelineStore.getState().doc!.tracks[1]!.volume).toBe(0.6);
    useTimelineStore.getState().undo();
    expect(useTimelineStore.getState().doc!.tracks[1]!.volume).toBeUndefined();
  });
});

describe('toggleTrackSolo（ソロ）', () => {
  it('付け外しできる・複数の列をソロにできる・映像の列は付かない', async () => {
    await open({ ...doc(), tracks: [...doc().tracks, { id: 'track_003', kind: TRACK_KIND.audio }] });
    const s = useTimelineStore.getState();
    s.toggleTrackSolo('track_002');
    s.toggleTrackSolo('track_003');
    s.toggleTrackSolo('track_001');
    expect(useTimelineStore.getState().soloTrackIds).toEqual(['track_002', 'track_003']);
    useTimelineStore.getState().toggleTrackSolo('track_002');
    expect(useTimelineStore.getState().soloTrackIds).toEqual(['track_003']);
  });

  // ⚠️ **文書を変えない**＝取り消しに積まない・保存しない（書き出しに効かない）。
  it('文書も取り消しの履歴も変えない', async () => {
    await open(doc());
    const before = useTimelineStore.getState();
    before.toggleTrackSolo('track_002');
    const after = useTimelineStore.getState();
    expect(after.doc).toBe(before.doc);
    expect(after.history).toBe(before.history);
  });

  it('動画を閉じると外れる（開き直したら全部鳴る）', async () => {
    await open(doc());
    useTimelineStore.getState().toggleTrackSolo('track_002');
    useTimelineStore.getState().closeTimelineProject();
    expect(useTimelineStore.getState().soloTrackIds).toEqual([]);
  });
});

describe('trackVolumeFromPercentText（列の頭の欄の読み方）', () => {
  it('% を倍率へ・空と読めない値は標準へ戻す（null）', () => {
    expect(trackVolumeFromPercentText('80')).toBe(0.8);
    expect(trackVolumeFromPercentText(' 150 ')).toBe(1.5);
    expect(trackVolumeFromPercentText('')).toBeNull();
    expect(trackVolumeFromPercentText('abc')).toBeNull();
  });
});
