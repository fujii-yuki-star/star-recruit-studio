// 再生位置で**絵を止める**（#356 ②）＝分けて、後半をそのコマで止める（ADR-0065）。
//
// ⚠️ **ファイルを作らない**＝切り出しも待ちも無い（取り消しで残るファイル＝ADR-0064 の発端を断つ）。
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTimelineStore } from './timelineStore';
import * as fsMod from '../../infrastructure/projectFs';
import * as assetFsMod from '../../infrastructure/assetFs';
import { EDIT_BLOCKED } from '../../domain/timeline/edit';
import { ASSET_TYPE, PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../../domain/enums';
import { TIMELINE_SCHEMA_VERSION } from '../../domain/timeline/types';
import type { TimelineClip, TimelineProject } from '../../domain/timeline/types';

function doc(over: Partial<TimelineProject> = {}): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20260914_001',
    projectName: 'テスト',
    createdAt: '2026-09-14T00:00:00.000Z',
    updatedAt: '2026-09-14T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [{ assetId: 'asset_001', assetType: ASSET_TYPE.video, displayName: '素材', filePath: 'assets/asset_001.mp4' }],
    tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.audio }],
    clips: [{
      id: 'clip_001', kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001',
      startSec: 0, durationSec: 10, x: 0, y: 0, w: 1920, h: 1080, assetId: 'asset_001',
    } as TimelineClip],
    ...over,
  };
}

async function open(d: TimelineProject): Promise<void> {
  vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(d));
  await useTimelineStore.getState().openTimelineProject(d.projectId);
}

beforeEach(() => {
  vi.restoreAllMocks();
  useTimelineStore.setState({ exportRun: { phase: 'idle', percent: 0, message: null, cancelling: false }, isImporting: false, editBlocked: null });
  useTimelineStore.getState().closeTimelineProject();
  vi.spyOn(assetFsMod, 'assetDisplayUrl').mockResolvedValue('asset://frame.png');
});

describe('freezeSelectedClip（この瞬間で絵を止める）', () => {
  it('後半がそのコマで止まり、素材もファイルも増えない', async () => {
    const extract = vi.spyOn(assetFsMod, 'extractVideoFrame');
    await open(doc());
    useTimelineStore.setState({ selectedClipIds: ['clip_001'] });
    await useTimelineStore.getState().freezeSelectedClip(4);
    const cur = useTimelineStore.getState().doc!;
    expect(cur.clips).toHaveLength(2);
    expect(cur.clips[0]!.holdFrame, '前半まで止めている').toBeUndefined();
    expect(cur.clips[1]!.holdFrame, '後半が止まっていない').toBe(true);
    expect(cur.clips[1]!.assetId, '別の素材に替えている').toBe('asset_001');
    expect(cur.assets, '素材が増えている').toHaveLength(1);
    expect(extract, 'ファイルを切り出している').not.toHaveBeenCalled();
  });

  // ⚠️ **待たない**＝同期で終わる（押したらすぐ止まる・取り込み中の断りも要らない）。
  it('取り込み中でも止められる（待つものが無い）', async () => {
    await open(doc());
    useTimelineStore.setState({ selectedClipIds: ['clip_001'], isImporting: true });
    await useTimelineStore.getState().freezeSelectedClip(4);
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(2);
  });

  it('動画でない部品は断る', async () => {
    await open(doc({
      clips: [{
        id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001',
        startSec: 0, durationSec: 10, x: 0, y: 0, w: 100, h: 50, text: 'あ',
      } as TimelineClip],
    }));
    useTimelineStore.setState({ selectedClipIds: ['clip_001'] });
    await useTimelineStore.getState().freezeSelectedClip(4);
    expect(useTimelineStore.getState().editBlocked?.reason).toBe(EDIT_BLOCKED.freezeNotVideo);
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(1);
  });

  it('帯の外では断る', async () => {
    await open(doc());
    useTimelineStore.setState({ selectedClipIds: ['clip_001'] });
    await useTimelineStore.getState().freezeSelectedClip(99);
    expect(useTimelineStore.getState().editBlocked?.reason).toBe(EDIT_BLOCKED.splitOutside);
  });

  // ⚠️ **止めた絵を選び直す**（#1136 レビュー由来 🟡）＝「分ける」と同じ規則。
  it('止めた絵を選び直す（分ける側と同じ規則）', async () => {
    await open(doc());
    useTimelineStore.setState({ selectedClipIds: ['clip_001'] });
    await useTimelineStore.getState().freezeSelectedClip(4);
    const cur = useTimelineStore.getState();
    expect(cur.selectedClipIds).toEqual([cur.doc!.clips[1]!.id]);
  });

  // ⚠️ **1回の操作＝1つの取り消し**（ADR-0034 決定20）。
  it('取り消し1回で、流れる動画に戻る', async () => {
    await open(doc());
    const before = useTimelineStore.getState().doc!;
    useTimelineStore.setState({ selectedClipIds: ['clip_001'] });
    await useTimelineStore.getState().freezeSelectedClip(4);
    useTimelineStore.getState().undo();
    expect(useTimelineStore.getState().doc!.clips).toEqual(before.clips);
  });

  // ⚠️ **書き出し中は文書を変えない**（`commit` が断る＝他の編集と同じ門）。
  it('書き出し中は止めない', async () => {
    await open(doc());
    useTimelineStore.setState({ selectedClipIds: ['clip_001'], exportRun: { phase: 'encoding', percent: 0, message: null, cancelling: false } });
    await useTimelineStore.getState().freezeSelectedClip(4);
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(1);
  });

  // ⚠️ **画面だけに門があると、store を直に叩く道で素通りする**（#1136 レビュー由来 ℹ️）。
  it('ファイルが見つからない動画は断る', async () => {
    await open(doc());
    useTimelineStore.setState({ selectedClipIds: ['clip_001'], missingAssetIds: ['asset_001'] });
    await useTimelineStore.getState().freezeSelectedClip(4);
    expect(useTimelineStore.getState().editBlocked?.reason).toBe(EDIT_BLOCKED.freezeAssetMissing);
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(1);
  });

  it('1つだけ選んでいないときは何もしない', async () => {
    await open(doc());
    useTimelineStore.setState({ selectedClipIds: [] });
    await useTimelineStore.getState().freezeSelectedClip(4);
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(1);
    expect(useTimelineStore.getState().editBlocked).toBeNull();
  });
});

describe('setSelectedClipHoldFrame（止めるのをやめる）', () => {
  it('やめると流れる動画に戻り、取り消すとまた止まる', async () => {
    await open(doc());
    useTimelineStore.setState({ selectedClipIds: ['clip_001'] });
    await useTimelineStore.getState().freezeSelectedClip(4);
    useTimelineStore.getState().setSelectedClipHoldFrame(false);
    expect(useTimelineStore.getState().doc!.clips[1]!.holdFrame).toBeUndefined();
    useTimelineStore.getState().undo();
    expect(useTimelineStore.getState().doc!.clips[1]!.holdFrame).toBe(true);
  });

  it('やめた部品をもう一度止められる', async () => {
    await open(doc());
    useTimelineStore.setState({ selectedClipIds: ['clip_001'] });
    useTimelineStore.getState().setSelectedClipHoldFrame(true);
    expect(useTimelineStore.getState().doc!.clips[0]!.holdFrame).toBe(true);
  });
});
