// 切り抜き（#634）。設定の意味（箱の各辺を割合で隠す・中身は動かない）と、描画への効き方を固定する。
import { describe, expect, it } from 'vitest';
import { CROP_MAX } from '../constants';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import { TIMELINE_SCHEMA_VERSION } from './types';
import type { TimelineClip, TimelineProject } from './types';
import { EDIT_BLOCKED, setClipCrop } from './edit';
import { validateTimelineDoc } from './validateTimelineDoc';
import { validateTimelineProject } from '../validation/generated/validators.js';
import { layoutTimelineAt } from '../../renderer/timelineLayout';
import { layoutToSvg } from '../../renderer/sceneSvg';

const clip = (over: Partial<TimelineClip> = {}): TimelineClip => ({
  id: 'clip_001',
  kind: TIMELINE_CLIP_KIND.shape,
  trackId: 'track_001',
  startSec: 0,
  durationSec: 5,
  x: 100,
  y: 200,
  w: 400,
  h: 300,
  fillColor: '#ff0000',
  ...over,
});

function doc(over: Partial<TimelineProject> = {}): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20260730_001',
    projectName: 'テスト',
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [],
    tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }],
    clips: [clip()],
    ...over,
  };
}

const draw = (d: TimelineProject, timeSec = 1): string =>
  layoutToSvg(layoutTimelineAt(d, timeSec, { templateOf: () => undefined }), {});

describe('setClipCrop', () => {
  it('辺ごとに割合で隠せる', () => {
    const r = setClipCrop(doc(), 'clip_001', 'bottom', 0.25);
    expect(r.ok && r.doc.clips[0].crop).toEqual({ bottom: 0.25 });
    expect(r.ok && validateTimelineProject(r.doc)).toBe(true);
  });

  it('0 に戻すとキーごと落ちる（既定と同じ値を書かない）', () => {
    const a = setClipCrop(doc(), 'clip_001', 'bottom', 0.25);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const r = setClipCrop(a.doc, 'clip_001', 'bottom', 0);
    expect(r.ok && r.doc.clips[0].crop).toBeUndefined();
  });

  it('上限へ収める（丸ごと消える設定を作らない）', () => {
    const r = setClipCrop(doc(), 'clip_001', 'top', 2);
    expect(r.ok && r.doc.clips[0].crop?.top).toBe(CROP_MAX);
    expect(r.ok && validateTimelineProject(r.doc)).toBe(true);
  });

  it('反対側と合わせて 1 を超えるときは、いま動かした側を残して反対側を詰める（入力を捨てない）', () => {
    const a = setClipCrop(doc(), 'clip_001', 'top', 0.8);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const r = setClipCrop(a.doc, 'clip_001', 'bottom', 0.5);
    expect(r.ok && r.doc.clips[0].crop).toEqual({ top: 0.49, bottom: 0.5 });
    expect(r.ok && validateTimelineProject(r.doc)).toBe(true);
  });

  it('同じ値なら文書は変わらない', () => {
    const d = doc();
    const r = setClipCrop(d, 'clip_001', 'top', 0);
    expect(r.ok && r.doc).toBe(d);
  });

  it('固定した列では変えられない', () => {
    const d = doc({ tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, locked: true }] });
    const r = setClipCrop(d, 'clip_001', 'top', 0.2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(EDIT_BLOCKED.locked);
  });
});

describe('切り抜きの描画', () => {
  it('切り抜きがなければ余計な要素を出さない（従来の絵と同じ）', () => {
    expect(draw(doc())).not.toContain('clip-path');
    // すべて 0（何も隠さない指定）も同じ＝空の切り抜きを出さない。
    expect(draw(doc({ clips: [clip({ crop: { top: 0, left: 0 } })] }))).not.toContain('clip-path');
  });

  it('箱の各辺を割合で隠す矩形になる（中身は動かない）', () => {
    const d = doc({ clips: [clip({ crop: { top: 0.25, left: 0.5 } })] });
    const svg = draw(d);
    // 箱は x=100,y=200,w=400,h=300 → 左 50%・上 25% を隠す＝x=300,y=275,w=200,h=225。
    expect(svg).toContain('<rect x="300" y="275" width="200" height="225"/>');
    // 中身（図形）自身の位置は変わらない＝隠れるだけ。
    expect(svg).toContain('x="100"');
  });

  it('動かした先で切れる（変形のあとの箱を基準にする）', () => {
    const d = doc({
      clips: [clip({ crop: { left: 0.5 } })],
      animations: [{ id: 'anim_001', targetId: 'clip_001', keyframes: [{ timeSec: 0, x: 200 }] }],
    });
    // x=100 の箱が +200 されて x=300 → 左半分を隠す矩形は x=500 から。
    expect(draw(d)).toContain('<rect x="500"');
  });

  it('薄くしても切り抜きは効く（合成のかたまりを包む）', () => {
    const d = doc({
      clips: [clip({ crop: { top: 0.5 } })],
      animations: [{ id: 'anim_001', targetId: 'clip_001', keyframes: [{ timeSec: 0, opacity: 0.5 }] }],
    });
    const svg = draw(d);
    expect(svg).toContain('clip-path');
    expect(svg).toContain('opacity="0.5"');
  });

  it('まとまりのフェード中でも、切り抜きは持っている部品だけに効く（隣を消さない・落とさない）', () => {
    const other: TimelineClip = {
      id: 'clip_002', kind: TIMELINE_CLIP_KIND.shape, trackId: 'track_002',
      startSec: 0, durationSec: 5, x: 800, y: 100, w: 200, h: 200, fillColor: '#00ff00',
    };
    const d = doc({
      clips: [clip({ crop: { top: 0.5 } }), other],
      tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.visual }],
      groups: [{ id: 'group_001', members: ['clip_001', 'clip_002'], transform: { x: 0, y: 0, rotation: 0, scale: 1 } }],
      animations: [{ id: 'anim_001', targetId: 'group_001', keyframes: [{ timeSec: 0, opacity: 0.5 }] }],
    });
    const svg = draw(d);
    // 切り抜きは残る（黙って落ちない）。
    expect(svg).toContain('clip-path="url(#crop_clip_001)"');
    // 隣の部品（切り抜きなし）は矩形の外にあるが描かれる＝別のクリップに効いていない。
    expect(svg).toContain('x="800"');
    // 切り抜きの中身は薄めるかたまりの内側（かたまりの外で包むと隣まで切れる）。
    expect(svg.indexOf('opacity="0.5"')).toBeLessThan(svg.indexOf('clip-path'));
  });

  it('回っている箱では矩形も同じだけ回す（箱の辺に沿って切る）', () => {
    const d = doc({ clips: [clip({ rotation: 45, crop: { top: 0.5 } })] });
    const svg = draw(d);
    expect(svg).toMatch(/<rect x="100" y="350" width="400" height="150" transform="rotate\(45 300 425\)"\/>/);
  });

  it('壊れたデータ（合計 1 以上）でも絵は丸ごと消さず、検証が知らせる', () => {
    const d = doc({ clips: [clip({ crop: { top: 0.7, bottom: 0.7 } })] });
    expect(draw(d)).toContain('height="1"'); // 1px 残す（縦）
    const wide = doc({ clips: [clip({ crop: { left: 0.7, right: 0.7 } })] });
    expect(draw(wide)).toContain('width="1"'); // 1px 残す（横）
    expect(validateTimelineDoc(d).map((w) => w.code)).toContain('TIMELINE_CROP_HIDES_ALL');
  });
});
