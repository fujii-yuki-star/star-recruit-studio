// 再生位置で**絵を止める**（#356 ②・フリーズフレーム）。
import { describe, expect, it } from 'vitest';
import { FREEZE_BLOCKED, freezeFrameAt, freezeFrameIssue, freezeSourceSec } from './freeze';
import { SPLIT_BLOCKED } from './split';
import { volumeAt } from './audio';
import { ASSET_TYPE, PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import { TIMELINE_SCHEMA_VERSION } from './types';
import { validateTimelineProject } from '../validation/generated/validators.js';
import type { Asset } from '../project/types';
import type { TimelineClip, TimelineProject } from './types';

const movie: Asset = {
  assetId: 'asset_001', assetType: ASSET_TYPE.video, displayName: '素材', filePath: 'assets/asset_001.mp4',
};
const still: Asset = {
  assetId: 'asset_002', assetType: ASSET_TYPE.image, displayName: '止めた絵', filePath: 'assets/asset_002.png',
};

function doc(over: Partial<TimelineProject> = {}): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20260914_001',
    projectName: 'テスト',
    createdAt: '2026-09-14T00:00:00.000Z',
    updatedAt: '2026-09-14T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [movie, still],
    tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.audio }],
    clips: [],
    ...over,
  };
}

const video = (over: Partial<TimelineClip> = {}): TimelineClip =>
  ({
    id: 'clip_001', kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001',
    startSec: 0, durationSec: 10, x: 0, y: 0, w: 1920, h: 1080,
    assetId: 'asset_001', useOriginalAudio: true, ...over,
  }) as TimelineClip;

const freeze = (d: TimelineProject, at: number, id = 'clip_001') =>
  freezeFrameAt(d, id, at, 'asset_002', volumeAt);

describe('freezeFrameIssue（そこで止められるか）', () => {
  it('直接置いた動画の中なら止められる', () => {
    expect(freezeFrameIssue(doc({ clips: [video()] }), 'clip_001', 4)).toBeNull();
  });

  // ⚠️ **枠ごと写真に化ける**のを避ける＝押した結果と食い違う（文字も立ち絵も消える）。
  it('見た目パターンのクリップは止められない（枠ごと写真に化ける）', () => {
    const d = doc({
      clips: [{
        id: 'clip_001', kind: TIMELINE_CLIP_KIND.template, trackId: 'track_001',
        startSec: 0, durationSec: 10, x: 0, y: 0, w: 1920, h: 1080, templateId: 'tmpl_001',
      } as TimelineClip],
    });
    expect(freezeFrameIssue(d, 'clip_001', 4)).toBe(FREEZE_BLOCKED.notVideo);
  });

  it('写真は止められない（もう止まっている）', () => {
    expect(freezeFrameIssue(doc({ clips: [video({ assetId: 'asset_002' })] }), 'clip_001', 4))
      .toBe(FREEZE_BLOCKED.notVideo);
  });

  it('文字は止められない', () => {
    const d = doc({
      clips: [{
        id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001',
        startSec: 0, durationSec: 10, x: 0, y: 0, w: 100, h: 50, text: 'あ',
      } as TimelineClip],
    });
    expect(freezeFrameIssue(d, 'clip_001', 4)).toBe(FREEZE_BLOCKED.notVideo);
  });

  // ⚠️ **分ける側の理由をそのまま使う**＝止める形は「分けて、後半を替える」なので、
  // 断る条件を2つに割らない（片方だけ直る形にしない＝§6）。
  it('帯の外では止められない（分ける側の理由をそのまま返す）', () => {
    expect(freezeFrameIssue(doc({ clips: [video()] }), 'clip_001', 99)).toBe(SPLIT_BLOCKED.outside);
  });

  it('固定された列では止められない', () => {
    const d = doc({
      clips: [video()],
      tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, locked: true }, { id: 'track_002', kind: TRACK_KIND.audio }],
    });
    expect(freezeFrameIssue(d, 'clip_001', 4)).toBe(SPLIT_BLOCKED.locked);
  });

  it('見つからないものは止められない', () => {
    expect(freezeFrameIssue(doc({ clips: [video()] }), 'clip_999', 4)).toBe(SPLIT_BLOCKED.notFound);
  });
});

describe('freezeSourceSec（どの瞬間を切り出すか）', () => {
  it('帯の頭からの秒を、素材の時刻へ直す', () => {
    expect(freezeSourceSec(video({ startSec: 2, sourceStartSec: 5 }), 6)).toBe(9); // 5 + (6-2)
  });

  // ⚠️ **速さのぶんも進む**＝置いた長さ × 速度 ＝ 使う素材の長さ（`11 §7.6.3.2`）。
  it('速さのぶんも進む（2倍なら素材は倍だけ進んでいる）', () => {
    expect(freezeSourceSec(video({ startSec: 0, sourceStartSec: 0, speed: 2 }), 3)).toBe(6);
  });

  it('頭出しを持っていなくても 0 から数える', () => {
    expect(freezeSourceSec(video(), 4)).toBe(4);
  });
});

describe('freezeFrameAt（止めた絵に替える）', () => {
  it('後半が「止めた絵」になる（前半は動画のまま）', () => {
    const r = freeze(doc({ clips: [video()] }), 4);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [head, tail] = r.doc.clips;
    expect(head!.assetId, '前半まで写真に替えている').toBe('asset_001');
    expect(head!.durationSec).toBe(4);
    expect(tail!.assetId, '後半が止めた絵になっていない').toBe('asset_002');
    expect(tail!.startSec).toBe(4);
    expect(tail!.durationSec).toBe(6);
  });

  // ⚠️ **時間は増やさない**（ADR-0034 決定11＝押しのけは採らない）。
  it('全体の長さは変わらない（押しのけない）', () => {
    const d = doc({ clips: [video()] });
    const r = freeze(d, 4);
    if (!r.ok) return;
    const end = (cs: TimelineClip[]) => Math.max(...cs.map((c) => c.startSec + c.durationSec));
    expect(end(r.doc.clips)).toBe(end(d.clips));
  });

  // ⚠️ **効かない項目を残さない**＝写真に速さ・頭出し・元の音は無い（置いた覚えのない値を作らない）。
  it('止めた絵は、動画だけの項目を持たない', () => {
    const clip = video({ sourceStartSec: 3, speed: 2, useOriginalAudio: true, originalAudioVolume: 0.8 });
    const r = freeze(doc({ clips: [clip] }), 4);
    if (!r.ok) return;
    const tail = r.doc.clips[1]!;
    expect(tail.sourceStartSec).toBeUndefined();
    expect(tail.speed).toBeUndefined();
    expect(tail.useOriginalAudio).toBeUndefined();
    expect(tail.originalAudioVolume).toBeUndefined();
    expect(tail.volumePoints).toBeUndefined();
  });

  it('箱（位置・大きさ）はそのまま引き継ぐ', () => {
    const r = freeze(doc({ clips: [video({ x: 100, y: 200, w: 640, h: 360 })] }), 4);
    if (!r.ok) return;
    const tail = r.doc.clips[1]!;
    expect([tail.x, tail.y, tail.w, tail.h]).toEqual([100, 200, 640, 360]);
  });

  // ⚠️ **止めても動かし続けられる**＝寄る・回す演出は絵が止まってからが本番。
  it('動き（キーフレーム）は分ける側が整えたものを引き継ぐ', () => {
    const d = doc({
      clips: [video()],
      animations: [{ id: 'anim_001', targetId: 'clip_001', keyframes: [{ timeSec: 0, scale: 1 }, { timeSec: 10, scale: 2 }] }],
    });
    const r = freeze(d, 4);
    if (!r.ok) return;
    const tailId = r.doc.clips[1]!.id;
    const forTail = (r.doc.animations ?? []).find((a) => a.targetId === tailId);
    expect(forTail, '止めた絵に動きが引き継がれていない').toBeTruthy();
    expect(forTail!.keyframes[0]!.timeSec, '後半の時刻が自分の先頭からになっていない').toBe(0);
  });

  it('止められない所では、理由を返して文書を変えない', () => {
    const d = doc({ clips: [video()] });
    const r = freeze(d, 99);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe(SPLIT_BLOCKED.outside);
  });

  it('できた文書は正典（schema）に通る', () => {
    const r = freeze(doc({ clips: [video()] }), 4);
    if (!r.ok) return;
    expect(validateTimelineProject(r.doc), JSON.stringify(validateTimelineProject.errors)).toBe(true);
  });
});
