// @vitest-environment jsdom
// 無音を詰める（#1385）＝探す→候補→選んだ所だけ詰める→取り消し1回で戻る、を store と画面の部品で通す。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useTimelineStore } from './timelineStore';
import * as fsMod from '../../infrastructure/projectFs';
import * as assetFsMod from '../../infrastructure/assetFs';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../../domain/enums';
import { TIMELINE_SCHEMA_VERSION } from '../../domain/timeline/types';
import { SILENCE_BUCKET_SEC } from '../../domain/timeline/silence';
import { SilenceFindPanel } from '../components/SilenceFindPanel';
import { silenceMessage, SILENCE_NONE_FOUND } from '../uiLabels';

vi.mock('./restorePointKeeper', () => ({ keepRestorePoints: vi.fn(async () => {}), restoreToPoint: vi.fn(async () => 0), loadRestorePoints: vi.fn(async () => []) }));

const doc = {
  schemaVersion: TIMELINE_SCHEMA_VERSION, format: PROJECT_FORMAT.timeline, projectId: 'proj_20261008_101', projectName: '録音',
  createdAt: '2026-10-08T00:00:00.000Z', updatedAt: '2026-10-08T00:00:00.000Z',
  videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
  voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
  assets: [
    { assetId: 'asset_001', assetType: 'bgm', displayName: '録音.wav', filePath: 'assets/rec.wav' },
    { assetId: 'asset_002', assetType: 'image', displayName: '写真', filePath: 'assets/p.png', metadata: { width: 10, height: 10 } },
  ],
  tracks: [{ id: 'track_001', kind: TRACK_KIND.audio }, { id: 'track_002', kind: TRACK_KIND.visual }],
  clips: [
    { id: 'clip_001', kind: TIMELINE_CLIP_KIND.audio, trackId: 'track_001', startSec: 0, durationSec: 10, assetId: 'asset_001' },
    { id: 'clip_002', kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_002', startSec: 0, durationSec: 10, x: 0, y: 0, w: 100, h: 100, assetId: 'asset_002' },
  ],
};
/** 0〜2 話す／2〜5 無音／5〜6 話す／6〜9 無音／9〜10 話す。 */
const peaks = Array.from({ length: Math.round(10 / SILENCE_BUCKET_SEC) }, (_, i) => {
  const t = i * SILENCE_BUCKET_SEC;
  return t < 2 || (t >= 5 && t < 6) || t >= 9 ? 0.5 : 0;
});

beforeEach(async () => {
  vi.spyOn(assetFsMod, 'assetDisplayUrl').mockResolvedValue(null);
  vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(doc));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  await useTimelineStore.getState().openTimelineProject('proj_20261008_101');
});
afterEach(() => {
  vi.restoreAllMocks();
  useTimelineStore.getState().closeTimelineProject();
});

describe('findSilencesFor / applySilenceCandidates', () => {
  it('候補を出し、選んだ所だけ詰め、取り消し1回で戻る', async () => {
    vi.spyOn(assetFsMod, 'audioPeaks').mockResolvedValue(peaks);
    await useTimelineStore.getState().findSilencesFor('clip_001');
    const found = useTimelineStore.getState().silenceFind?.candidates;
    expect(found).toHaveLength(2);
    // 2つ目だけ詰める。
    useTimelineStore.getState().applySilenceCandidates([found![1]]);
    const after = useTimelineStore.getState();
    expect(after.silenceFind).toBeNull();
    const len = (d: typeof after.doc) => Math.max(...d!.clips.map((c) => c.startSec + c.durationSec));
    expect(len(after.doc)).toBeCloseTo(10 - (found![1].endSec - found![1].startSec));
    expect(after.editNotice).toContain('1か所');
    useTimelineStore.getState().undo();
    expect(len(useTimelineStore.getState().doc)).toBeCloseTo(10);
  });

  it('音の無い部品は探さずに理由を出す', async () => {
    const peaksSpy = vi.spyOn(assetFsMod, 'audioPeaks').mockResolvedValue(peaks);
    await useTimelineStore.getState().findSilencesFor('clip_002');
    expect(useTimelineStore.getState().editNotice).toBe(silenceMessage.SILENCE_NO_SOUND);
    expect(useTimelineStore.getState().silenceFind).toBeNull();
    expect(peaksSpy).not.toHaveBeenCalled();
  });

  it('音を読めなければ理由を出して閉じる', async () => {
    vi.spyOn(assetFsMod, 'audioPeaks').mockResolvedValue([]);
    await useTimelineStore.getState().findSilencesFor('clip_001');
    expect(useTimelineStore.getState().silenceFind).toBeNull();
    expect(useTimelineStore.getState().editNotice).toBe(silenceMessage.SILENCE_READ_FAILED);
  });

  it('探している間に部品が変わったら候補を使わない', async () => {
    vi.spyOn(assetFsMod, 'audioPeaks').mockImplementation(async () => {
      useTimelineStore.getState().moveClipById('clip_001', { startSec: 1 });
      return peaks;
    });
    await useTimelineStore.getState().findSilencesFor('clip_001');
    expect(useTimelineStore.getState().silenceFind).toBeNull();
    expect(useTimelineStore.getState().editNotice).toBe(silenceMessage.SILENCE_CLIP_CHANGED);
  });

  it('長い素材は窓に分けて測る（1回に返る数に上限がある）', async () => {
    const long = { ...doc, clips: [{ ...doc.clips[0], durationSec: 250 }] };
    vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(long));
    await useTimelineStore.getState().openTimelineProject('proj_20261008_101');
    const spy = vi.spyOn(assetFsMod, 'audioPeaks').mockImplementation(async (_p, _r, buckets) => Array(buckets).fill(0.5));
    await useTimelineStore.getState().findSilencesFor('clip_001');
    expect(spy.mock.calls.map((c) => [c[3], c[4]])).toEqual([[0, 100], [100, 100], [200, 50]]);
  });
});

describe('SilenceFindPanel', () => {
  const cands = [{ startSec: 2.25, endSec: 4.75 }, { startSec: 6.25, endSec: 8.75 }];
  it('既定は全部選ぶ・外した所は詰めない・行を押すとその時刻へ', () => {
    const onApply = vi.fn();
    const onSeek = vi.fn();
    render(<SilenceFindPanel candidates={cands} fps={30} onSeek={onSeek} onApply={onApply} onClose={() => {}} />);
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.every((b) => b.checked)).toBe(true);
    fireEvent.click(boxes[0]);
    fireEvent.click(screen.getByRole('button', { name: /選んだ所を詰める（1か所）/ }));
    expect(onApply).toHaveBeenCalledWith([cands[1]]);
    fireEvent.click(screen.getAllByTitle('この時刻へ移動します')[1]);
    expect(onSeek).toHaveBeenCalledWith(6.25);
  });

  it('見つからなければその旨と閉じるだけ', () => {
    const onClose = vi.fn();
    render(<SilenceFindPanel candidates={[]} fps={30} onSeek={() => {}} onApply={() => {}} onClose={onClose} />);
    expect(screen.getByText(SILENCE_NONE_FOUND)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(onClose).toHaveBeenCalled();
  });
});
