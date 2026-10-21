// 使っていない素材を片づける（#1480）＝一覧から外し、ファイルはごみ箱へ・取り消しでは戻らない（履歴からも外す）。
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTimelineStore } from './timelineStore';
import * as fsMod from '../../infrastructure/projectFs';
import * as assetFsMod from '../../infrastructure/assetFs';
import { ASSET_TYPE, PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../../domain/enums';
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
    assets: [
      { assetId: 'asset_001', assetType: ASSET_TYPE.video, displayName: '使う動画', filePath: 'assets/asset_001.mp4', thumbnailPath: 'assets/asset_001_thumb.png' },
      { assetId: 'asset_002', assetType: ASSET_TYPE.video, displayName: '使わない動画', filePath: 'assets/asset_002.mp4', thumbnailPath: 'assets/asset_002_thumb.png' },
    ],
    tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }],
    clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001', startSec: 0, durationSec: 3, x: 0, y: 0, w: 10, h: 10, assetId: 'asset_001' } as TimelineClip],
  };
}

async function open(d: TimelineProject): Promise<void> {
  vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(d));
  await useTimelineStore.getState().openTimelineProject(d.projectId);
}

let trash: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.restoreAllMocks();
  useTimelineStore.getState().closeTimelineProject();
  trash = vi.spyOn(assetFsMod, 'trashProjectFiles').mockResolvedValue(2);
});

describe('removeUnusedTimelineAssets', () => {
  it('使っていない素材を一覧から外し、本体と小さな絵をごみ箱へ', async () => {
    await open(doc());
    useTimelineStore.getState().removeUnusedTimelineAssets(['asset_002']);
    expect(useTimelineStore.getState().doc!.assets.map((a) => a.assetId)).toEqual(['asset_001']);
    expect(trash).toHaveBeenCalledWith('proj_20261020_001', ['assets/asset_002.mp4', 'assets/asset_002_thumb.png']);
    expect(useTimelineStore.getState().saveStatus).toBe('idle'); // 保存される
  });

  // ⚠️ **いまも使っていないものだけ**＝確認の間に置いた素材を消さない。
  it('使っている素材は渡されても外さない', async () => {
    await open(doc());
    useTimelineStore.getState().removeUnusedTimelineAssets(['asset_001', 'asset_002']);
    expect(useTimelineStore.getState().doc!.assets.map((a) => a.assetId)).toEqual(['asset_001']);
    expect(trash.mock.calls[0]![1]).not.toContain('assets/asset_001.mp4');
  });

  // ⚠️ **取り消しで戻る文書が使っていれば外さない**＝取り消すと、ファイルの無い部品が戻ってくる。
  it('取り消すと使う部品が戻る素材は外さない', async () => {
    await open(doc());
    useTimelineStore.getState().addVisualClip({ kind: TIMELINE_CLIP_KIND.slot, assetId: 'asset_002', trackId: 'track_001' });
    useTimelineStore.getState().undo(); // いまは使っていないが、やり直しで戻る
    useTimelineStore.getState().removeUnusedTimelineAssets(['asset_002']);
    expect(useTimelineStore.getState().doc!.assets).toHaveLength(2);
    expect(trash).not.toHaveBeenCalled();
  });

  // ⚠️ **取り消しの履歴には載せず、履歴の文書からも外す**＝ファイルはごみ箱なので、取り消して一覧だけ戻ると「見つかりません」になる。
  it('取り消しでは戻らない（履歴の文書からも外れている）', async () => {
    await open(doc());
    useTimelineStore.getState().moveClipById('clip_001', { startSec: 1 }); // 履歴を1つ作る
    useTimelineStore.getState().removeUnusedTimelineAssets(['asset_002']);
    useTimelineStore.getState().undo();
    expect(useTimelineStore.getState().doc!.assets.map((a) => a.assetId)).toEqual(['asset_001']);
  });

  it('書き出し中・取り込み中は外さない', async () => {
    await open(doc());
    useTimelineStore.setState({ isImporting: true });
    useTimelineStore.getState().removeUnusedTimelineAssets(['asset_002']);
    expect(useTimelineStore.getState().doc!.assets).toHaveLength(2);
    useTimelineStore.setState({ isImporting: false, exportRun: { phase: 'encoding', percent: 0, message: null, cancelling: false } });
    useTimelineStore.getState().removeUnusedTimelineAssets(['asset_002']);
    expect(useTimelineStore.getState().doc!.assets).toHaveLength(2);
    useTimelineStore.setState({ exportRun: { phase: 'idle', percent: 0, message: null, cancelling: false } });
  });
});
