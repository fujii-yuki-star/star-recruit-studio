// キーフレームの編集（ADR-0032・#634）。置く・直す・外すの不変条件を固定する。
import { describe, expect, it } from 'vitest';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import { TIMELINE_SCHEMA_VERSION } from './types';
import type { TimelineClip, TimelineProject } from './types';
import { EDIT_BLOCKED } from './edit';
import { animationOriginSec, clearKeyframes, keyframeTimeAt, removeKeyframe, setKeyframe } from './keyframeEdit';
import { validateTimelineProject } from '../validation/generated/validators.js';
import { interpolateKeyframes } from '../project/keyframes';

const clip = (id: string, over: Partial<TimelineClip> = {}): TimelineClip => ({
  id,
  kind: TIMELINE_CLIP_KIND.text,
  trackId: 'track_001',
  startSec: 2,
  durationSec: 4,
  x: 0,
  y: 0,
  w: 100,
  h: 50,
  text: 'あ',
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
    clips: [clip('clip_001')],
    ...over,
  };
}

const kfs = (d: TimelineProject, targetId = 'clip_001') =>
  d.animations?.find((a) => a.targetId === targetId)?.keyframes ?? [];

describe('setKeyframe', () => {
  it('置くと動きができる（プロパティは渡したものだけ）', () => {
    const r = setKeyframe(doc(), 'clip_001', 0, { x: 100, opacity: 0.5 });
    expect(r.ok && kfs(r.doc)).toEqual([{ timeSec: 0, x: 100, opacity: 0.5 }]);
  });

  it('同じ時刻へ置き直すと1つのまま（渡したプロパティだけ差し替える）', () => {
    const first = setKeyframe(doc(), 'clip_001', 1, { x: 100, opacity: 0.5 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const r = setKeyframe(first.doc, 'clip_001', 1, { x: 200 });
    expect(r.ok && kfs(r.doc)).toEqual([{ timeSec: 1, x: 200, opacity: 0.5 }]);
  });

  it('時刻の順に並ぶ（あとから前へ置いても）', () => {
    const a = setKeyframe(doc(), 'clip_001', 3, { x: 300 });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const b = setKeyframe(a.doc, 'clip_001', 1, { x: 100 });
    expect(b.ok && kfs(b.doc).map((k) => k.timeSec)).toEqual([1, 3]);
  });

  it('対象の長さの外には置かない（動画に効かない位置を作らない）', () => {
    const r = setKeyframe(doc(), 'clip_001', 99, { x: 1 });
    expect(r.ok && kfs(r.doc)[0].timeSec).toBe(4); // クリップの長さ
    const r2 = setKeyframe(doc(), 'clip_001', -5, { x: 1 });
    expect(r2.ok && kfs(r2.doc)[0].timeSec).toBe(0);
  });

  it('null を渡すとそのプロパティを外す', () => {
    const a = setKeyframe(doc(), 'clip_001', 0, { x: 100, opacity: 0.5 });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const r = setKeyframe(a.doc, 'clip_001', 0, { opacity: null });
    expect(r.ok && kfs(r.doc)).toEqual([{ timeSec: 0, x: 100 }]);
  });

  it('プロパティが1つも残らないキーフレームは落とす（空の器を残さない）', () => {
    const a = setKeyframe(doc(), 'clip_001', 0, { x: 100 });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const r = setKeyframe(a.doc, 'clip_001', 0, { x: null });
    expect(r.ok && r.doc.animations).toBeUndefined();
  });

  it('濃さは 0〜1・大きさは 0 より大きい値へ収める（保存できない文書を作らない）', () => {
    const r = setKeyframe(doc(), 'clip_001', 0, { opacity: 5, scale: -2 });
    expect(r.ok && kfs(r.doc)[0]).toMatchObject({ opacity: 1, scale: 0.01 });
    expect(r.ok && validateTimelineProject(r.doc)).toBe(true); // scale:0 は schema が拒む
  });

  it('傾きは丸めない（値は「足す度」＝逆回転・複数回転に意味がある）', () => {
    const r = setKeyframe(doc(), 'clip_001', 0, { rotation: -180 });
    expect(r.ok && kfs(r.doc)[0].rotation).toBe(-180);
    const r2 = setKeyframe(doc(), 'clip_001', 0, { rotation: 720 });
    expect(r2.ok && kfs(r2.doc)[0].rotation).toBe(720);
    expect(r2.ok && validateTimelineProject(r2.doc)).toBe(true);
  });

  it('同じ値を置き直しても文書は変わらない（取り消しが空振りしない）', () => {
    const a = setKeyframe(doc(), 'clip_001', 1, { x: 100 });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const b = setKeyframe(a.doc, 'clip_001', 1, { x: 100 });
    expect(b.ok && b.doc).toBe(a.doc);
  });

  it('イージングも置ける', () => {
    const r = setKeyframe(doc(), 'clip_001', 0, { x: 1, easing: 'ease-in-out' });
    expect(r.ok && kfs(r.doc)[0].easing).toBe('ease-in-out');
  });

  it('グループも対象にできる（時刻の起点は所属クリップのいちばん早い開始秒）', () => {
    const d = doc({
      clips: [clip('clip_001', { startSec: 5 }), clip('clip_002', { startSec: 2, trackId: 'track_002' })],
      tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.visual }],
      groups: [{ id: 'group_001', members: ['clip_001', 'clip_002'], transform: { x: 0, y: 0, rotation: 0, scale: 1 } }],
    });
    expect(animationOriginSec(d, 'group_001')).toBe(2);
    const r = setKeyframe(d, 'group_001', 100, { x: 1 });
    // 起点 2 秒・いちばん遅い終わり 9 秒＝長さ 7 秒へ収まる。
    expect(r.ok && kfs(r.doc, 'group_001')[0].timeSec).toBe(7);
  });

  it('無い対象には置けない', () => {
    const r = setKeyframe(doc(), 'clip_999', 0, { x: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(EDIT_BLOCKED.notFound);
  });

  it('固定した列の部品には置けない', () => {
    const d = doc({ tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, locked: true }] });
    const r = setKeyframe(d, 'clip_001', 0, { x: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(EDIT_BLOCKED.locked);
  });

  it('置いた文書はスキーマに適合する', () => {
    const r = setKeyframe(doc(), 'clip_001', 0, { x: 100, easing: 'ease-in-out' });
    expect(r.ok && validateTimelineProject(r.doc)).toBe(true);
  });

  it('置いた動きは描画の補間へそのまま渡る（プレビュー＝書き出しの器を共有）', () => {
    const a = setKeyframe(doc(), 'clip_001', 0, { x: 0 });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const b = setKeyframe(a.doc, 'clip_001', 4, { x: 400 });
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(interpolateKeyframes(kfs(b.doc), 2).x).toBeCloseTo(200);
  });
});

describe('removeKeyframe / clearKeyframes', () => {
  const withTwo = () => {
    const a = setKeyframe(doc(), 'clip_001', 0, { x: 0 });
    if (!a.ok) throw new Error('setup');
    const b = setKeyframe(a.doc, 'clip_001', 4, { x: 400 });
    if (!b.ok) throw new Error('setup');
    return b.doc;
  };

  it('1つ外せる', () => {
    const r = removeKeyframe(withTwo(), 'clip_001', 4);
    expect(r.ok && kfs(r.doc).map((k) => k.timeSec)).toEqual([0]);
  });

  it('最後の1つを外すと動き自体が消える', () => {
    const a = removeKeyframe(withTwo(), 'clip_001', 4);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const r = removeKeyframe(a.doc, 'clip_001', 0);
    expect(r.ok && r.doc.animations).toBeUndefined();
  });

  it('無い時刻を外しても文書は変わらない', () => {
    const d = withTwo();
    const r = removeKeyframe(d, 'clip_001', 2);
    expect(r.ok && r.doc).toBe(d);
  });

  it('まとめて外せる', () => {
    const r = clearKeyframes(withTwo(), 'clip_001');
    expect(r.ok && r.doc.animations).toBeUndefined();
  });

  it('固定した列では外せない', () => {
    const d = { ...withTwo(), tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, locked: true }] };
    expect(removeKeyframe(d, 'clip_001', 0).ok).toBe(false);
    expect(clearKeyframes(d, 'clip_001').ok).toBe(false);
  });

  it('ほかの部品の動きは触らない', () => {
    const base = withTwo();
    const d: TimelineProject = {
      ...base,
      clips: [...base.clips, clip('clip_002', { trackId: 'track_002' })],
      tracks: [...base.tracks, { id: 'track_002', kind: TRACK_KIND.visual }],
    };
    const a = setKeyframe(d, 'clip_002', 0, { opacity: 0.2 });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const r = clearKeyframes(a.doc, 'clip_002');
    expect(r.ok && kfs(r.doc, 'clip_001').map((k) => k.timeSec)).toEqual([0, 4]);
  });
});

describe('動き方（イージング・#262）', () => {
  it('自由なカーブを置ける（保存できる形）', () => {
    const r = setKeyframe(doc(), 'clip_001', 1, { x: 10, easing: { bezier: [0.25, 1.6, 0.75, -0.6] } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.animations?.[0].keyframes[0].easing).toEqual({ bezier: [0.25, 1.6, 0.75, -0.6] });
    expect(validateTimelineProject(r.doc)).toBe(true);
  });

  it('カーブの横の制御点は 0〜1 へ収める（時間が戻る形は保存できない）', () => {
    const r = setKeyframe(doc(), 'clip_001', 1, { x: 10, easing: { bezier: [1.5, 0.2, -0.5, 0.8] } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.animations?.[0].keyframes[0].easing).toEqual({ bezier: [1, 0.2, 0, 0.8] });
    // 収めないと schema が拒む＝自動保存が黙って行われなくなる。
    expect(validateTimelineProject(r.doc)).toBe(true);
  });

  it('縦の制御点は丸めない（行き過ぎて戻る動きを消さない）', () => {
    const r = setKeyframe(doc(), 'clip_001', 1, { x: 10, easing: { bezier: [0.3, 3, 0.7, -2] } });
    expect(r.ok && r.doc.animations?.[0].keyframes[0].easing).toEqual({ bezier: [0.3, 3, 0.7, -2] });
  });
});

// 置ける位置か（`keyframeTimeAt`）。**音量の変化（`volumePointTimeAt`）と対の作り**にする（ADR-0026②）。
// ⚠️ **終わりちょうども置ける**（区間は閉じている）＝描画の生存判定（半開）を流用すると終端に置けず、
// 「ここまでに動き終わる」到達点が作れない。**同じ誤りを音量の変化で実機で踏んで直している**（#512）のに、
// こちらは境界ちょうどを1つも突いておらず、`>` を `>=` に変えても全テストが緑だった（#814）。
describe('keyframeTimeAt（置ける位置か・#814）', () => {
  const d = doc(); // clip_001＝2秒から4秒間（2.0〜6.0）

  it('終わりちょうども置ける（「ここまでに動き終わる」到達点を置けなくしない）', () => {
    expect(keyframeTimeAt(d, 'clip_001', 6)).toBe(4);
  });

  it('始まりちょうども置ける', () => {
    expect(keyframeTimeAt(d, 'clip_001', 2)).toBe(0);
  });

  it('部品の外は置けない', () => {
    expect(keyframeTimeAt(d, 'clip_001', 1.9)).toBeNull();
    expect(keyframeTimeAt(d, 'clip_001', 6.1)).toBeNull();
  });

  it('返す秒はそのまま setKeyframe に渡せる（切り詰められない＝同じ規則）', () => {
    const r = setKeyframe(d, 'clip_001', keyframeTimeAt(d, 'clip_001', 6)!, { x: 100 });
    expect(r.ok && kfs(r.doc)).toEqual([{ timeSec: 4, x: 100 }]);
  });

  // まとまりは**所属クリップの最後の終わり**まで＝起点も長さもクリップ1つとは違う。
  it('まとまりでも終わりちょうどまで置ける（起点は最も早い開始秒）', () => {
    const g = doc({
      clips: [clip('clip_001'), clip('clip_002', { startSec: 5, durationSec: 3 })], // 2.0〜6.0 と 5.0〜8.0
      groups: [{ id: 'group_001', members: ['clip_001', 'clip_002'], transform: { x: 0, y: 0, rotation: 0, scale: 1 } }],
    });
    expect(keyframeTimeAt(g, 'group_001', 2)).toBe(0);   // 起点＝最も早い開始秒
    expect(keyframeTimeAt(g, 'group_001', 8)).toBe(6);   // 終わり＝最後の終わり
    expect(keyframeTimeAt(g, 'group_001', 8.1)).toBeNull();
    expect(keyframeTimeAt(g, 'group_001', 1.9)).toBeNull();
  });

  it('丸めの都合で右端ちょうどが外れない（案内どおりの秒で置ける）', () => {
    // (0.1 + 0.2) - 0.1 は 0.20000000000000004＝長さ 0.2 を超える。式を変えないと右端が外れる。
    const tiny = doc({ clips: [clip('clip_001', { startSec: 0.1, durationSec: 0.2 })] });
    expect(keyframeTimeAt(tiny, 'clip_001', 0.30000000000000004)).toBe(0.2);
  });
});
