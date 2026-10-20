// タイムライン形式の動画の一覧の絵（2026-10-20 実機＝タイムライン形式だけ絵が無かった）＝保存・開いたときに焼き、中身が同じなら焼き直さない。
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./restorePointKeeper', () => ({ keepRestorePoints: vi.fn(async () => {}), restoreToPoint: vi.fn(async () => 0), loadRestorePoints: vi.fn(async () => []) }));
vi.mock('../../renderer/export/rasterize', () => ({ svgToPngDataUrl: vi.fn(async () => 'data:image/png;base64,THUMB') }));

import { useTimelineStore } from './timelineStore';
import * as fsMod from '../../infrastructure/projectFs';
import * as assetFsMod from '../../infrastructure/assetFs';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../../domain/enums';
import { TIMELINE_SCHEMA_VERSION } from '../../domain/timeline/types';
import type { TimelineClip, TimelineProject } from '../../domain/timeline/types';

function doc(): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20261021_001',
    projectName: '絵の確認',
    createdAt: '2026-10-21T00:00:00.000Z',
    updatedAt: '2026-10-21T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [{ assetId: 'asset_001', assetType: 'image', displayName: '写真', filePath: 'assets/asset_001.png' }],
    tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }],
    clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001', startSec: 0, durationSec: 3, x: 0, y: 0, w: 400, h: 300, assetId: 'asset_001' } as TimelineClip],
  };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 0));
};

let thumb: ReturnType<typeof vi.spyOn>;
let read: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  vi.restoreAllMocks();
  useTimelineStore.getState().closeTimelineProject();
  vi.spyOn(fsMod, 'saveProjectDoc').mockResolvedValue(undefined as never);
  thumb = vi.spyOn(fsMod, 'saveProjectThumbnail').mockResolvedValue(undefined);
  read = vi.spyOn(assetFsMod, 'readAssetDataUrl').mockResolvedValue('data:image/png;base64,PHOTO');
});

describe('タイムライン形式の一覧の絵', () => {
  it('開いたときに焼き、中身が同じなら保存しても焼き直さない・動かしたら焼き直す', async () => {
    vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(doc()));
    await useTimelineStore.getState().openTimelineProject('proj_20261021_001');
    await flush();
    expect(thumb).toHaveBeenCalledTimes(1);
    expect(thumb.mock.calls[0]![0]).toBe('proj_20261021_001');
    expect(read).toHaveBeenCalledWith('proj_20261021_001', 'assets/asset_001.png');

    await useTimelineStore.getState().saveTimelineProject();
    await flush();
    expect(thumb).toHaveBeenCalledTimes(1); // 変わっていない＝焼かない

    useTimelineStore.getState().moveClipById('clip_001', { startSec: 1 });
    await useTimelineStore.getState().saveTimelineProject();
    await flush();
    expect(thumb).toHaveBeenCalledTimes(2);
  });

  // ⚠️ **描いている間に消しても、消した後に書かない**（PR レビュー 🔴＝`preview.png` だけのフォルダが復活する）。
  it('描いている最中に消すと、消す側はその回を待ち、絵は書かない', async () => {
    let release: (v: string) => void = () => {};
    read.mockImplementation(() => new Promise((r) => { release = r; }));
    vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(doc()));
    await useTimelineStore.getState().openTimelineProject('proj_20261021_001');
    await flush(); // 素材を読んでいる最中で止まっている
    const handoff = useTimelineStore.getState().discardDeletedProject('proj_20261021_001');
    let landed = false;
    void handoff.pending?.then(() => { landed = true; });
    await flush();
    expect(landed).toBe(false); // 描いている回の着地を待つ
    release('data:image/png;base64,PHOTO');
    await flush();
    expect(landed).toBe(true);
    expect(thumb).not.toHaveBeenCalled();
  });

  it('消せなかった動画（消した番号を使い回した新しい動画も）は、開けばまた絵を作れる', async () => {
    vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(doc()));
    useTimelineStore.getState().discardDeletedProject('proj_20261021_001'); // 開いていない動画
    await useTimelineStore.getState().openTimelineProject('proj_20261021_001');
    await flush();
    expect(thumb).toHaveBeenCalledTimes(1);
  });

  // ⚠️ **どの動画の印かまで見る**＝複製した直後は中身が同じ＝印だけで比べると、複製した側の絵が一度も作られない（場面形式の PR #889 と同じ）。
  it('中身が同じ別の動画（複製した直後）でも、その動画の絵を作る', async () => {
    // ⚠️ 前の検査が焼いた印（モジュールの中に残る）と当たらない番号にする。
    const a = { ...doc(), projectId: 'proj_20261021_003' };
    const b = { ...doc(), projectId: 'proj_20261021_004' };
    const load = vi.spyOn(fsMod, 'loadProjectDoc');
    load.mockResolvedValueOnce(JSON.stringify(a));
    await useTimelineStore.getState().openTimelineProject(a.projectId);
    await flush();
    load.mockResolvedValueOnce(JSON.stringify(b));
    await useTimelineStore.getState().openTimelineProject(b.projectId);
    await flush();
    expect(thumb.mock.calls.map((c: unknown[]) => c[0])).toEqual(['proj_20261021_003', 'proj_20261021_004']);
  });
});
