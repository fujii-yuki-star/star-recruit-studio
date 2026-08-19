import { describe, expect, it } from 'vitest';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import { TIMELINE_SCHEMA_VERSION } from './types';
import type { TimelineClip, TimelineProject } from './types';
import { videoAssetIdOfClip, videoAssetIds, videoClipsOf, videoFrameIndexAt, videoStagePlan } from './video';

const doc = (over: Partial<TimelineProject> = {}): TimelineProject =>
  ({
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20260819_001',
    projectName: 'テスト',
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [
      { assetId: 'asset_001', assetType: 'video', displayName: '紹介ムービー', filePath: 'a.mp4' },
      { assetId: 'asset_002', assetType: 'image', displayName: '写真', filePath: 'b.png' },
    ],
    tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }],
    clips: [],
    ...over,
  }) as TimelineProject;

const slot = (over: Partial<TimelineClip> = {}): TimelineClip =>
  ({
    id: 'clip_001', kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001',
    startSec: 0, durationSec: 10, x: 0, y: 0, w: 1920, h: 1080, assetId: 'asset_001', ...over,
  }) as TimelineClip;

describe('動画を映す部品を見分ける（#512 段1）', () => {
  it('直接置いた動画の素材だけを対象にする', () => {
    const ids = videoAssetIds(doc());
    expect(videoAssetIdOfClip(slot(), ids)).toBe('asset_001');
    expect(videoAssetIdOfClip(slot({ assetId: 'asset_002' }), ids)).toBeNull(); // 写真
    expect(videoAssetIdOfClip(slot({ assetId: undefined }), ids)).toBeNull(); // 空の枠
  });

  // ⚠️ 段1 は**直接置き**だけ＝見た目パターンの差し込み口（`assetRefs`）は段3。
  // ここで拾ってしまうと「映ると思ったのに映らない」を黙って作る。
  it('見た目パターンの差し込み口はまだ対象にしない', () => {
    const ids = videoAssetIds(doc());
    const tmpl = { ...slot(), kind: TIMELINE_CLIP_KIND.template, assetId: undefined, templateId: 'tmpl_001', assetRefs: { background: 'asset_001' } } as TimelineClip;
    expect(videoAssetIdOfClip(tmpl, ids)).toBeNull();
  });

  // ⚠️ **種類を見ないと素通りする**（変異チェックで判明）＝上の材料は `assetId` を持たないので、
  // 種類の判定を外しても落ちなかった。**動画のファイルを音として置いた部品**は `assetId` を持つので、
  // ここで「絵として映る部品」と取り違えると、音の列に絵を出そうとする。
  it('動画のファイルを音として置いた部品は、絵の対象にしない', () => {
    const ids = videoAssetIds(doc());
    const audio = { ...slot(), kind: TIMELINE_CLIP_KIND.audio, assetId: 'asset_001' } as TimelineClip;
    expect(videoAssetIdOfClip(audio, ids)).toBeNull();
  });

  it('文書から動画の部品だけを集める', () => {
    const d = doc({ clips: [slot(), slot({ id: 'clip_002', assetId: 'asset_002' })] });
    expect(videoClipsOf(d).map((c) => c.id)).toEqual(['clip_001']);
  });
});

describe('焼き出す区間（videoStagePlan）', () => {
  it('トリムから、置いた長さぶん、速さ込みで焼く', () => {
    expect(videoStagePlan(slot({ sourceStartSec: 4, durationSec: 6, speed: 2 }), 30)).toEqual({
      sourceStartSec: 4, durationSec: 6, speed: 2, frameCount: 180,
    });
  });

  it('速さの未指定・0以下は等速として扱う（0 で割らない）', () => {
    expect(videoStagePlan(slot(), 30).speed).toBe(1);
    expect(videoStagePlan(slot({ speed: 0 }), 30).speed).toBe(1);
  });

  // ⚠️ 端数は**切り上げ**（`timelineFramePlan` と同じ＝末尾のコマが黙って落ちない）。
  it('端数のコマ数は切り上げる', () => {
    expect(videoStagePlan(slot({ durationSec: 1.01 }), 30).frameCount).toBe(31);
  });
});

describe('出力フレーム → 出すコマ（videoFrameIndexAt）', () => {
  const clip = slot({ startSec: 2, durationSec: 4 });

  it('置いた先頭からのコマ数で出す', () => {
    expect(videoFrameIndexAt(clip, 60, 30, 120)).toBe(0); // 2.0秒＝先頭
    expect(videoFrameIndexAt(clip, 75, 30, 120)).toBe(15); // 2.5秒
  });

  it('生きている区間の外では映らない（終わりの瞬間は含まない）', () => {
    expect(videoFrameIndexAt(clip, 59, 30, 120)).toBeNull(); // 手前
    expect(videoFrameIndexAt(clip, 180, 30, 120)).toBeNull(); // 6.0秒＝ちょうど終わり
    expect(videoFrameIndexAt(clip, 179, 30, 120)).not.toBeNull();
  });

  // ⚠️ **焼けた枚数で頭打ち**＝素材が置いた長さより短くても、無い番号を読みに行かない（最後のコマで止まる）。
  it('焼けた枚数を超えたら最後のコマで止まる', () => {
    expect(videoFrameIndexAt(clip, 179, 30, 10)).toBe(9);
    expect(videoFrameIndexAt(clip, 60, 30, 0)).toBeNull(); // 1枚も焼けていない
  });
});
