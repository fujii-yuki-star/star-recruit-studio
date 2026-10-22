// ノイズを減らした作り置きをそろえる（ADR-0068）＝作れたら鳴らす・作れなければ理由を残す（黙って無音にしない）。
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTimelineStore } from './timelineStore';
import * as fsMod from '../../infrastructure/projectFs';
import * as assetFsMod from '../../infrastructure/assetFs';
import { ASSET_TYPE, PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../../domain/enums';
import { TIMELINE_SCHEMA_VERSION } from '../../domain/timeline/types';
import type { TimelineClip, TimelineProject } from '../../domain/timeline/types';

function doc(denoise: boolean): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20261020_001',
    projectName: 'テスト',
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [{ assetId: 'asset_001', assetType: ASSET_TYPE.bgm, displayName: '録音', filePath: 'assets/asset_001.wav', metadata: { durationSec: 30 } }],
    tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.audio }],
    clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.audio, trackId: 'track_002', startSec: 0, durationSec: 5, assetId: 'asset_001', ...(denoise ? { denoise: true } : {}) } as TimelineClip],
  };
}

async function open(d: TimelineProject): Promise<void> {
  vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(d));
  await useTimelineStore.getState().openTimelineProject(d.projectId);
}

beforeEach(() => {
  vi.restoreAllMocks();
  useTimelineStore.getState().closeTimelineProject();
  vi.spyOn(assetFsMod, 'audioPlayUrl').mockResolvedValue('data:audio/wav;base64,AAA');
  vi.spyOn(assetFsMod, 'assetDisplayUrl').mockImplementation(async (_p, rel) => `asset://${rel}`);
});

describe('ノイズを減らした作り置き（ADR-0068）', () => {
  it('作り置きをそろえて、その場所を鳴らす（元の素材は読まない）', async () => {
    const ensure = vi.spyOn(assetFsMod, 'ensureDenoisedAudio').mockResolvedValue('cache/denoise/asset_001.wav.flac');
    await open(doc(true));
    await useTimelineStore.getState().ensureAudioSrcs();
    expect(ensure).toHaveBeenCalledWith('proj_20261020_001', 'assets/asset_001.wav');
    // 読み直すたびに別の URL（`?t=`）＝作り直した音を古いまま鳴らさない。
    expect(useTimelineStore.getState().audioSrcByKey['denoise:asset_001']).toMatch(/^asset:\/\/cache\/denoise\/asset_001\.wav\.flac\?t=\d+$/);
    expect(useTimelineStore.getState().audioSrcByKey['asset:asset_001']).toBeUndefined();
    expect(useTimelineStore.getState().denoiseFailedKeys).toEqual([]);
  });

  // ⚠️ **黙って無音にしない**＝作れなかったことを覚え、画面が「外して元の音で」と出す。
  it('作れなければ覚える（画面が理由と次の行動を出す）', async () => {
    vi.spyOn(assetFsMod, 'ensureDenoisedAudio').mockResolvedValue(null);
    await open(doc(true));
    await useTimelineStore.getState().ensureAudioSrcs();
    expect(useTimelineStore.getState().denoiseFailedKeys).toEqual(['denoise:asset_001']);
  });

  it('切り替えが無ければ作り置きは作らない', async () => {
    const ensure = vi.spyOn(assetFsMod, 'ensureDenoisedAudio').mockResolvedValue('x');
    await open(doc(false));
    await useTimelineStore.getState().ensureAudioSrcs();
    expect(ensure).not.toHaveBeenCalled();
    expect(useTimelineStore.getState().audioSrcByKey['asset:asset_001']).toBeTruthy();
  });

  // ⚠️ **入れ直したら作り直しを試す**（PR レビュー ℹ️）＝前に作れなかった印が残ると、外して入れ直しても試さず知らせも消えない。
  it('作れなかった後に外して入れ直すと、もう一度試す', async () => {
    let canMake = false; // 初めは作れない → 直ったあとは作れる
    const ensure = vi.spyOn(assetFsMod, 'ensureDenoisedAudio').mockImplementation(async () => (canMake ? 'cache/denoise/asset_001.wav.flac' : null));
    await open(doc(true));
    await useTimelineStore.getState().ensureAudioSrcs();
    // 開いたときの読み込みが先に走っていることがある＝終わるのを待つ。
    await vi.waitFor(() => expect(useTimelineStore.getState().denoiseFailedKeys).toEqual(['denoise:asset_001']));
    canMake = true;
    const callsBefore = ensure.mock.calls.length;
    useTimelineStore.setState({ selectedClipIds: ['clip_001'] });
    useTimelineStore.getState().setSelectedClipDenoise(false);
    useTimelineStore.getState().setSelectedClipDenoise(true);
    expect(useTimelineStore.getState().denoiseFailedKeys).toEqual([]);
    await useTimelineStore.getState().ensureAudioSrcs();
    expect(ensure.mock.calls.length, 'もう一度試していない').toBeGreaterThan(callsBefore);
    expect(useTimelineStore.getState().audioSrcByKey['denoise:asset_001']).toContain('cache/denoise/asset_001.wav.flac');
  });
});
