// 開いたときに、取り込み時に付けるはずの素材の情報を補う（#352 の検証で見つけた）。
// ⚠️ フォルダからの取り込み（起動の引数・ADR-0042）は動画の「音の有無」を持たず、元の音を鳴らす設定が
//   書き出しで**黙って無音**になっていた（`findVideoSlot` は音があると分かっている素材しか鳴らさない）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as assetFsMod from '../../infrastructure/assetFs';
import * as fsMod from '../../infrastructure/projectFs';
import { fillMissingAssetInfo } from './assetImport';
import { useProjectStore } from './projectStore';
import { useTimelineStore } from './timelineStore';
import { findVideoSlots } from '../../renderer/export/findVideoSlot';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../../domain/enums';
import { TIMELINE_SCHEMA_VERSION } from '../../domain/timeline/types';
import { placementOriginalAudio, videoPlacementsOf } from '../../domain/timeline/video';
import type { Asset } from '../../domain/project/types';

vi.mock('./restorePointKeeper', () => ({ keepRestorePoints: vi.fn(async () => {}), restoreToPoint: vi.fn(async () => 0), loadRestorePoints: vi.fn(async () => []) }));

const video: Asset = { assetId: 'asset_mov', assetType: 'video', displayName: '動画.mp4', filePath: 'assets/movie.mp4' };
const photo: Asset = { assetId: 'asset_001', assetType: 'image', displayName: '写真.jpg', filePath: 'assets/photo.jpg' };
const META = { durationSec: 10, hasAudio: true, width: 1280, height: 720 };

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(assetFsMod, 'assetDisplayUrl').mockResolvedValue(null);
});
afterEach(() => { vi.restoreAllMocks(); });

describe('fillMissingAssetInfo', () => {
  it('動画の長さ・音の有無・代表フレームが無ければ補う', async () => {
    vi.spyOn(assetFsMod, 'probeVideo').mockResolvedValue(META);
    vi.spyOn(assetFsMod, 'extractVideoThumbnail').mockResolvedValue('assets/movie_thumb.png');
    const [v] = await fillMissingAssetInfo('proj_1', [video]);
    expect(v).toMatchObject({ metadata: META, thumbnailPath: 'assets/movie_thumb.png' });
  });

  it('持っている素材は同じ物を返す（調べない）', async () => {
    const probe = vi.spyOn(assetFsMod, 'probeVideo').mockResolvedValue(META);
    const thumb = vi.spyOn(assetFsMod, 'extractVideoThumbnail').mockResolvedValue('x.png');
    const full = { ...video, metadata: META, thumbnailPath: 't.png' };
    const sized = { ...photo, metadata: { width: 10, height: 10 } };
    const out = await fillMissingAssetInfo('proj_1', [full, sized]);
    expect(out[0]).toBe(full);
    expect(out[1]).toBe(sized);
    expect(probe).not.toHaveBeenCalled();
    expect(thumb).not.toHaveBeenCalled();
  });

  it('写真は大きさだけ補う（長さ・音の有無は付けない）', async () => {
    vi.spyOn(assetFsMod, 'probeVideo').mockResolvedValue(META);
    const [p] = await fillMissingAssetInfo('proj_1', [photo]);
    expect(p.metadata).toEqual({ width: 1280, height: 720 });
  });

  it('調べられなければ付けない（開くのは止めない）', async () => {
    vi.spyOn(assetFsMod, 'probeVideo').mockRejectedValue(new Error('x'));
    vi.spyOn(assetFsMod, 'extractVideoThumbnail').mockResolvedValue(null);
    const out = await fillMissingAssetInfo('proj_1', [video]);
    expect(out[0]).toBe(video);
  });

  it('音の有無だけ欠けた古い動画も補う（長さはそのまま上書きしない値で揃う）', async () => {
    vi.spyOn(assetFsMod, 'probeVideo').mockResolvedValue(META);
    const [v] = await fillMissingAssetInfo('proj_1', [{ ...video, metadata: { durationSec: 10 }, thumbnailPath: 't.png' }]);
    expect(v.metadata?.hasAudio).toBe(true);
    expect(v.thumbnailPath).toBe('t.png');
  });
});

const SAMPLE = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'docs', 'yuko_recruit_docs', 'fixtures', 'project.sample.json'), 'utf8'));

describe('開くと補われる（両方の形式）', () => {
  beforeEach(() => {
    vi.spyOn(assetFsMod, 'probeVideo').mockResolvedValue(META);
    vi.spyOn(assetFsMod, 'extractVideoThumbnail').mockResolvedValue('assets/movie_thumb.png');
  });

  it('場面形式：元の音を鳴らす設定が書き出しまで届く', async () => {
    const d = structuredClone(SAMPLE);
    d.projectId = 'proj_20261007_201';
    d.assets = [...d.assets, video];
    // 2つ目の場面＝写真の差し込み口（mainVisual）を持つ見た目パターン。
    d.scenes[1].assetRefs = { ...d.scenes[1].assetRefs, mainVisual: 'asset_mov' };
    d.scenes[1].slotClips = { mainVisual: { useOriginalAudio: true } };
    vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(d));
    await useProjectStore.getState().loadProject('proj_20261007_201');
    const st = useProjectStore.getState();
    expect(st.assets.find((a) => a.assetId === 'asset_mov')?.metadata?.hasAudio).toBe(true);
    const tpl = st.templates.find((t) => t.templateId === st.scenes[1].templateId)!;
    const slots = findVideoSlots(st.scenes[1], tpl, (id) => st.assets.find((a) => a.assetId === id));
    expect(slots[0]?.useOriginalAudio, '元の音が黙って落ちる').toBe(true);
  });

  it('タイムライン形式：元の音を鳴らす部品が鳴る', async () => {
    const doc = {
      schemaVersion: TIMELINE_SCHEMA_VERSION, format: PROJECT_FORMAT.timeline, projectId: 'proj_20261007_202', projectName: '動画',
      createdAt: '2026-10-07T00:00:00.000Z', updatedAt: '2026-10-07T00:00:00.000Z',
      videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
      voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
      assets: [video],
      tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }],
      clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001', startSec: 0, durationSec: 5, x: 0, y: 0, w: 1920, h: 1080, assetId: 'asset_mov', useOriginalAudio: true }],
    };
    vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(doc));
    await useTimelineStore.getState().openTimelineProject('proj_20261007_202');
    const d = useTimelineStore.getState().doc!;
    expect(d.assets[0].metadata?.hasAudio).toBe(true);
    expect(d.assets[0].thumbnailPath).toBe('assets/movie_thumb.png');
    expect(placementOriginalAudio(d, videoPlacementsOf(d)[0]), '元の音が黙って落ちる').not.toBeNull();
  });
});
