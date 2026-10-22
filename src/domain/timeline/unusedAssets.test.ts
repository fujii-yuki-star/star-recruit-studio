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

// 文書ごとの作り置き（負荷試験 2026-10-22）＝取り消しの履歴の文書は変わらないので、作り置いた答えを使う。
// ⚠️ 作り置きは**素材の一覧が同じとき**だけ使う＝素材が増えたら数え直す（増えた素材を「使っていない」と取り違えない）。
describe('unusedTimelineAssetIds の作り置き', () => {
  it('同じ文書で素材の一覧が変わったら数え直す', () => {
    const d = doc([photo('asset_001'), photo('asset_004', 'clip_002')]);
    expect(unusedTimelineAssetIds(d)).toEqual(['asset_002', 'asset_0021', 'asset_003']);
    // 同じ文書に素材だけ足す（作り置きは文書ごと）＝鍵が素材の一覧を見ていないと、asset_004 を「使っていない」と取り違える
    d.assets.push({ ...d.assets[0], assetId: 'asset_004', filePath: 'assets/asset_004.png' });
    expect(unusedTimelineAssetIds(d)).toEqual(['asset_002', 'asset_0021', 'asset_003']);
  });

  it('履歴の文書は何度聞いても同じ答え（作り置きを使っても変わらない）', () => {
    const history = [doc([photo('asset_002')]), doc([photo('asset_003')])];
    const now = doc([photo('asset_001')]);
    const first = unusedTimelineAssetIds(now, history);
    expect(unusedTimelineAssetIds(now, history)).toEqual(first);
    expect(first).toEqual(['asset_0021']);
  });
});
