// 窓の外から落としたファイルを並びへ置く（ADR-0049）。
import { describe, expect, it } from 'vitest';
import { fileDropHoverIssue, placeDroppedAssets, trackKindForAssetType } from './fileDropPlacement';
import { ASSET_TYPE, PROJECT_FORMAT, TRACK_KIND } from '../enums';
import { EDIT_BLOCKED } from './edit';
import { TIMELINE_SCHEMA_VERSION } from './types';
import type { TimelineProject } from './types';

function doc(over: Partial<TimelineProject> = {}): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20260929_001',
    projectName: 'テスト',
    createdAt: '2026-09-29T00:00:00.000Z',
    updatedAt: '2026-09-29T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [
      { assetId: 'asset_001', assetType: ASSET_TYPE.image, displayName: 'a', filePath: 'assets/a.png' },
      { assetId: 'asset_002', assetType: ASSET_TYPE.image, displayName: 'b', filePath: 'assets/b.png' },
      { assetId: 'asset_003', assetType: ASSET_TYPE.bgm, displayName: 'c', filePath: 'assets/c.mp3', metadata: { durationSec: 7 } },
    ],
    tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.audio }],
    clips: [],
    ...over,
  } as TimelineProject;
}

const clipsOn = (d: TimelineProject, trackId: string) =>
  d.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.startSec - b.startSec);

describe('placeDroppedAssets（窓の外から落とした素材を置く・ADR-0049）', () => {
  it('落とした列・落とした時刻から、前から順に隙間なく並べる', () => {
    const r = placeDroppedAssets(doc(), { assetIds: ['asset_001', 'asset_002'], trackId: 'track_001', startSec: 3 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const on = clipsOn(r.doc, 'track_001');
    expect(on.map((c) => c.assetId)).toEqual(['asset_001', 'asset_002']);
    expect(on[0].startSec).toBe(3);
    expect(on[1].startSec, '2件目が前の部品の終わりから始まらない').toBe(on[0].startSec + on[0].durationSec);
    expect(r.placedIds).toEqual(on.map((c) => c.id));
  });

  it('音は音の列へ（素材の長さで置く）', () => {
    const r = placeDroppedAssets(doc(), { assetIds: ['asset_003'], trackId: 'track_002', startSec: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [c] = clipsOn(r.doc, 'track_002');
    expect(c.startSec).toBe(1);
    expect(c.durationSec).toBe(7);
  });

  // ⚠️ **既存の別の列へは入れない**（ADR-0034 決定10）＝新しい列なら指した時刻は守られる。
  it('種類の合わない素材は、その種類の新しい列へ同じ時刻から置く', () => {
    const d = doc();
    const r = placeDroppedAssets(d, { assetIds: ['asset_001', 'asset_003'], trackId: 'track_001', startSec: 2 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.tracks.length).toBe(3);
    const newTrack = r.doc.tracks.find((t) => !d.tracks.some((o) => o.id === t.id))!;
    expect(newTrack.kind).toBe(TRACK_KIND.audio);
    expect(clipsOn(r.doc, newTrack.id)[0].startSec).toBe(2);
    expect(clipsOn(r.doc, 'track_002'), '既存の音の列へ勝手に入れた').toEqual([]);
  });

  it('列の無い所へ落としたら、種類ごとに新しい列を1本ずつ作る', () => {
    const d = doc();
    const r = placeDroppedAssets(d, { assetIds: ['asset_001', 'asset_003', 'asset_002'], trackId: null, startSec: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const added = r.doc.tracks.filter((t) => !d.tracks.some((o) => o.id === t.id));
    expect(added.map((t) => t.kind).sort()).toEqual([TRACK_KIND.audio, TRACK_KIND.visual].sort());
    const visual = added.find((t) => t.kind === TRACK_KIND.visual)!;
    expect(clipsOn(r.doc, visual.id).map((c) => c.assetId), '写真2つが同じ新しい列に並ばない').toEqual(['asset_001', 'asset_002']);
  });

  // ⚠️ **全か無か**（ADR-0034 決定15）。
  it('1件でも置けなければ何も置かない（理由を返す）', () => {
    const d = doc({ clips: [{ id: 'clip_001', kind: 'text', trackId: 'track_001', startSec: 6, durationSec: 3, x: 0, y: 0, w: 1, h: 1, text: 'x' }] as TimelineProject['clips'] });
    // 1件目は 0〜5秒で置けるが、2件目（5〜10秒）が 6秒の帯と重なる。
    const r = placeDroppedAssets(d, { assetIds: ['asset_001', 'asset_002'], trackId: 'track_001', startSec: 0 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe(EDIT_BLOCKED.overlap);
  });

  it('固定した列へは置かない（理由は置く関数と同じ）', () => {
    const r = placeDroppedAssets(doc({ tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, locked: true }] }), { assetIds: ['asset_001'], trackId: 'track_001', startSec: 0 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe(EDIT_BLOCKED.locked);
  });

  it('無い列・無い素材・空は断る', () => {
    expect(placeDroppedAssets(doc(), { assetIds: ['asset_001'], trackId: 'track_404', startSec: 0 }).ok).toBe(false);
    expect(placeDroppedAssets(doc(), { assetIds: ['asset_404'], trackId: 'track_001', startSec: 0 }).ok).toBe(false);
    expect(placeDroppedAssets(doc(), { assetIds: [], trackId: 'track_001', startSec: 0 }).ok).toBe(false);
  });

  it('負の時刻は 0 から', () => {
    const r = placeDroppedAssets(doc(), { assetIds: ['asset_001'], trackId: 'track_001', startSec: -2 });
    expect(r.ok && clipsOn(r.doc, 'track_001')[0].startSec).toBe(0);
  });

  it('音（BGM・読み上げ）は音の列、それ以外は映像の列', () => {
    expect(trackKindForAssetType(ASSET_TYPE.bgm)).toBe(TRACK_KIND.audio);
    expect(trackKindForAssetType(ASSET_TYPE.voice)).toBe(TRACK_KIND.audio);
    for (const t of [ASSET_TYPE.image, ASSET_TYPE.video, ASSET_TYPE.logo, ASSET_TYPE.yuko]) expect(trackKindForAssetType(t)).toBe(TRACK_KIND.visual);
  });
});

// 運んでいる間の「置けない」（#1272）＝必ず断られる時だけ。
describe('fileDropHoverIssue（運んでいる間の置けない・#1272）', () => {
  const on = (over: Partial<TimelineProject>) => doc(over);
  const clip = { id: 'clip_001', kind: 'text', trackId: 'track_001', startSec: 2, durationSec: 2, x: 0, y: 0, w: 1, h: 1, text: 'x' };
  const img = [ASSET_TYPE.image];

  it('部品の上は重なり・部品の終わりちょうどからは置ける（端が接するのは可）', () => {
    const d = on({ clips: [clip] as TimelineProject['clips'] });
    expect(fileDropHoverIssue(d, { trackId: 'track_001', startSec: 3, assetTypes: img })).toBe(EDIT_BLOCKED.overlap);
    expect(fileDropHoverIssue(d, { trackId: 'track_001', startSec: 4, assetTypes: img })).toBeNull();
  });

  it('固定・出さない列は、空いていても置けない', () => {
    expect(fileDropHoverIssue(on({ tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, locked: true }] }), { trackId: 'track_001', startSec: 0, assetTypes: img }))
      .toBe(EDIT_BLOCKED.locked);
    expect(fileDropHoverIssue(on({ tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, hidden: true }] }), { trackId: 'track_001', startSec: 0, assetTypes: img }))
      .toBe(EDIT_BLOCKED.hiddenTrack);
  });

  it('種類の合う素材が無ければ断らない（全部が新しい列へ行く）・列の無い所も断らない', () => {
    const d = on({ tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, locked: true }], clips: [clip] as TimelineProject['clips'] });
    expect(fileDropHoverIssue(d, { trackId: 'track_001', startSec: 3, assetTypes: [ASSET_TYPE.bgm] })).toBeNull();
    expect(fileDropHoverIssue(d, { trackId: null, startSec: 3, assetTypes: img })).toBeNull();
    expect(fileDropHoverIssue(d, { trackId: 'track_001', startSec: 3, assetTypes: [] }), '種類が分からないのに断った').toBeNull();
  });

  it('混ざっていれば、合う素材のぶんで断る', () => {
    const d = on({ clips: [clip] as TimelineProject['clips'] });
    expect(fileDropHoverIssue(d, { trackId: 'track_001', startSec: 3, assetTypes: [ASSET_TYPE.bgm, ASSET_TYPE.image] })).toBe(EDIT_BLOCKED.overlap);
  });

  // ⚠️ **断る色なのに置けてしまう**を作らない＝断ると言った所では、実際に置く関数も同じ理由で断る。
  it('断ると言った所では、置く関数も同じ理由で断る', () => {
    const cases: { d: TimelineProject; startSec: number; assetId: string; type: typeof ASSET_TYPE.image | typeof ASSET_TYPE.bgm; trackId: string }[] = [
      { d: on({ clips: [clip] as TimelineProject['clips'] }), startSec: 3, assetId: 'asset_001', type: ASSET_TYPE.image, trackId: 'track_001' },
      { d: on({ clips: [clip] as TimelineProject['clips'] }), startSec: 2, assetId: 'asset_001', type: ASSET_TYPE.image, trackId: 'track_001' },
      { d: on({ tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.audio, locked: true }] }), startSec: 0, assetId: 'asset_003', type: ASSET_TYPE.bgm, trackId: 'track_002' },
    ];
    for (const c of cases) {
      const hover = fileDropHoverIssue(c.d, { trackId: c.trackId, startSec: c.startSec, assetTypes: [c.type] });
      expect(hover).not.toBeNull();
      const placed = placeDroppedAssets(c.d, { assetIds: [c.assetId], trackId: c.trackId, startSec: c.startSec });
      expect(placed).toEqual({ ok: false, reason: hover });
    }
  });
});
