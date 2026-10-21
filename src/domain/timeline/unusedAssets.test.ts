// タイムライン形式の「使っていない素材」（#1480）＝消す判断の根拠なので安全側（取り消しで戻る文書も数える）。
import { describe, expect, it } from 'vitest';
import { ASSET_TYPE, PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import type { TimelineClip, TimelineProject } from './types';
import { TIMELINE_SCHEMA_VERSION } from './types';
import { unusedTimelineAssetIds, withoutAssets } from './unusedAssets';

const asset = (n: string) => ({ assetId: `asset_${n}`, assetType: ASSET_TYPE.image, displayName: `写真${n}`, filePath: `assets/asset_${n}.png` });

function doc(clips: TimelineClip[], over: Partial<TimelineProject> = {}): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20261020_001',
    projectName: 'テスト',
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [asset('001'), asset('002'), asset('0021'), asset('003')],
    tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }],
    clips,
    ...over,
  };
}
const photo = (assetId: string, id = 'clip_001'): TimelineClip =>
  ({ id, kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001', startSec: 0, durationSec: 3, x: 0, y: 0, w: 10, h: 10, assetId }) as TimelineClip;

describe('unusedTimelineAssetIds', () => {
  it('どの部品にも使っていない素材だけ（一覧の並び順）', () => {
    expect(unusedTimelineAssetIds(doc([photo('asset_002')]))).toEqual(['asset_001', 'asset_0021', 'asset_003']);
  });

  // ⚠️ **似た番号を取り違えない**＝`asset_002` を使っていても `asset_0021` は使っていない（引用符ごと探す）。
  it('番号の一部が重なる素材を「使っている」と数えない', () => {
    expect(unusedTimelineAssetIds(doc([photo('asset_0021')]))).not.toContain('asset_0021');
    expect(unusedTimelineAssetIds(doc([photo('asset_0021')]))).toContain('asset_002');
  });

  // ⚠️ **項目を名指しで数えない**＝差し込み口・見た目パターンの中など、どこに入っていても拾う（あとで足した項目も取りこぼさない）。
  it('部品の中のどの項目に入っていても「使っている」', () => {
    const tpl = { id: 'clip_009', kind: TIMELINE_CLIP_KIND.template, trackId: 'track_001', startSec: 0, durationSec: 3, x: 0, y: 0, w: 10, h: 10,
      templateId: 'tmpl_001', assetRefs: { photo: 'asset_003' } } as unknown as TimelineClip;
    expect(unusedTimelineAssetIds(doc([tpl]))).not.toContain('asset_003');
  });

  // ⚠️ **取り消しで戻る文書も数える**＝いまは使っていなくても、取り消すとその素材を使う部品が戻る。
  it('取り消し・やり直しで戻る文書で使っていれば「使っている」', () => {
    const now = doc([]);
    const before = doc([photo('asset_001')]);
    expect(unusedTimelineAssetIds(now, [before])).not.toContain('asset_001');
    expect(unusedTimelineAssetIds(now, [])).toContain('asset_001');
  });

  it('素材の一覧そのものは数えない（自分自身で「使っている」にならない）', () => {
    expect(unusedTimelineAssetIds(doc([]))).toHaveLength(4);
  });
});

describe('withoutAssets', () => {
  it('指した素材を一覧から外す・何も無ければ同じ文書', () => {
    const d = doc([]);
    expect(withoutAssets(d, new Set(['asset_001'])).assets.map((a) => a.assetId)).toEqual(['asset_002', 'asset_0021', 'asset_003']);
    expect(withoutAssets(d, new Set(['asset_999']))).toBe(d);
  });
});
