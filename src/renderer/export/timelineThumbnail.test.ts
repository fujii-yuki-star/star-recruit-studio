// タイムライン形式の一覧の小さな絵を焼く（2026-10-20 実機）。焼く部分（canvas）は差し替えて、渡す中身を見る。
import { describe, expect, it, vi } from 'vitest';

const raster = vi.hoisted(() => ({ calls: [] as { svg: string; w: number; h: number }[] }));
vi.mock('./rasterize', () => ({
  svgToPngDataUrl: vi.fn(async (svg: string, w: number, h: number) => {
    raster.calls.push({ svg, w, h });
    return 'data:image/png;base64,THUMB';
  }),
}));

import { ASSET_TYPE, PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../../domain/enums';
import { TIMELINE_SCHEMA_VERSION } from '../../domain/timeline/types';
import type { TimelineClip, TimelineProject } from '../../domain/timeline/types';
import { renderTimelineThumbnail, timelineThumbnailKey } from './timelineThumbnail';

function doc(clips: TimelineClip[], aspectRatio: '16:9' | '9:16' = '16:9'): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20261021_001',
    projectName: 't',
    createdAt: '2026-10-21T00:00:00.000Z',
    updatedAt: '2026-10-21T00:00:00.000Z',
    videoSettings: { aspectRatio, fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [
      { assetId: 'asset_001', assetType: ASSET_TYPE.image, displayName: '写真', filePath: 'assets/asset_001.png' },
      { assetId: 'asset_002', assetType: ASSET_TYPE.image, displayName: '使わない写真', filePath: 'assets/asset_002.png' },
    ],
    tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }],
    clips,
  } as TimelineProject;
}
const photo = (startSec: number, x = 0): TimelineClip =>
  ({ id: 'clip_001', kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001', startSec, durationSec: 2, x, y: 0, w: 400, h: 300, assetId: 'asset_001' }) as TimelineClip;
const templateOf = () => undefined;

describe('timelineThumbnailKey', () => {
  it('絵の部品が無ければ null・同じ中身なら同じ印・動かせば変わる', () => {
    expect(timelineThumbnailKey(doc([]), templateOf)).toBeNull();
    const a = timelineThumbnailKey(doc([photo(1)]), templateOf);
    expect(a).not.toBeNull();
    expect(timelineThumbnailKey(doc([photo(1)]), templateOf)).toBe(a);
    expect(timelineThumbnailKey(doc([photo(1, 50)]), templateOf)).not.toBe(a);
  });
});

describe('renderTimelineThumbnail', () => {
  it('描く素材だけ読み、プレビューと同じ描画で小さく焼く（縦横比はキャンバスから）', async () => {
    raster.calls.length = 0;
    const load = vi.fn(async (id: string) => `data:image/png;base64,${id}`);
    const out = await renderTimelineThumbnail(doc([photo(1)], '9:16'), { templateOf, loadAssetSrc: load, templateAssetSrc: () => undefined });
    expect(out).toBe('data:image/png;base64,THUMB');
    expect(load.mock.calls.map((c) => c[0])).toEqual(['asset_001']); // 使わない写真は読まない
    expect(raster.calls[0]!.svg).toContain('data:image/png;base64,asset_001');
    expect([raster.calls[0]!.w, raster.calls[0]!.h]).toEqual([320, 569]); // 縦型でも潰れない
  });

  it('見た目パターンの素材は先に引き、素材を読まない', async () => {
    const load = vi.fn(async () => 'x');
    await renderTimelineThumbnail(doc([photo(0)]), { templateOf, loadAssetSrc: load, templateAssetSrc: (id) => (id === 'asset_001' ? 'data:tpl' : undefined) });
    expect(load).not.toHaveBeenCalled();
  });

  it('描く部品が無ければ焼かない', async () => {
    raster.calls.length = 0;
    expect(await renderTimelineThumbnail(doc([]), { templateOf, loadAssetSrc: async () => undefined, templateAssetSrc: () => undefined })).toBeNull();
    expect(raster.calls).toHaveLength(0);
  });
});
