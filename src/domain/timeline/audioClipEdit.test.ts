// 音のクリップの編集（速さ・トリム・音量・フェード／音を置く）＝#634 の「中位」。
import { describe, expect, it } from 'vitest';
import { CLIP_SPEED_MAX, CLIP_SPEED_MIN, VOLUME_MAX } from '../constants';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import { TIMELINE_SCHEMA_VERSION } from './types';
import type { TimelineClip, TimelineProject } from './types';
import { addAudioClip, EDIT_BLOCKED, setVisualClipContent, setClipFade, setClipOriginalAudioVolume, setClipSourceStart, setClipSpeed, setClipUseOriginalAudio, setClipVolume } from './edit';
import { timelineAudioRuns } from './export';
import { audioCuesAt } from './audio';
import { validateTimelineProject } from '../validation/generated/validators.js';

const bgm = (over: Partial<TimelineClip> = {}): TimelineClip => ({
  id: 'clip_001',
  kind: TIMELINE_CLIP_KIND.audio,
  trackId: 'track_002',
  startSec: 0,
  durationSec: 10,
  bundledBgmId: 'found-new-hope',
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
    tracks: [
      { id: 'track_001', kind: TRACK_KIND.visual },
      { id: 'track_002', kind: TRACK_KIND.audio },
    ],
    clips: [bgm()],
    ...over,
  };
}

describe('addAudioClip', () => {
  it('同梱BGMを音の列へ置ける', () => {
    const r = addAudioClip(doc({ clips: [] }), { bundledBgmId: 'summer-morning', trackId: 'track_002', startSec: 3 });
    expect(r.ok && r.doc.clips[0]).toMatchObject({
      kind: TIMELINE_CLIP_KIND.audio, bundledBgmId: 'summer-morning', trackId: 'track_002', startSec: 3,
    });
    expect(r.ok && validateTimelineProject(r.doc)).toBe(true);
  });

  it('持ち込んだ音の素材も置ける', () => {
    const d = doc({
      clips: [],
      assets: [{ assetId: 'asset_001', assetType: 'bgm', displayName: '曲', filePath: 'assets/a.mp3' }],
    });
    const r = addAudioClip(d, { assetId: 'asset_001', trackId: 'track_002', startSec: 0 });
    expect(r.ok && r.doc.clips[0].assetId).toBe('asset_001');
  });

  it('無い素材は置けない', () => {
    const r = addAudioClip(doc({ clips: [] }), { assetId: 'asset_999', trackId: 'track_002', startSec: 0 });
    expect(r.ok).toBe(false);
  });

  it('音の出どころを2つ渡したら置かない（黙って一方を選ばない）', () => {
    const d = doc({ clips: [], assets: [{ assetId: 'asset_001', assetType: 'bgm', displayName: '曲', filePath: 'a.mp3' }] });
    expect(addAudioClip(d, { bundledBgmId: 'summer-morning', assetId: 'asset_001', trackId: 'track_002', startSec: 0 }).ok).toBe(false);
    expect(addAudioClip(d, { trackId: 'track_002', startSec: 0 }).ok).toBe(false);
  });

  it('映像の列・固定した列・重なる場所には置けない', () => {
    const d = doc({ clips: [] });
    expect(addAudioClip(d, { bundledBgmId: 'summer-morning', trackId: 'track_001', startSec: 0 }).ok).toBe(false);
    const locked = doc({ clips: [], tracks: [{ id: 'track_002', kind: TRACK_KIND.audio, locked: true }] });
    expect(addAudioClip(locked, { bundledBgmId: 'summer-morning', trackId: 'track_002', startSec: 0 }).ok).toBe(false);
    const r = addAudioClip(doc(), { bundledBgmId: 'summer-morning', trackId: 'track_002', startSec: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(EDIT_BLOCKED.overlap);
  });
});

describe('setClipSpeed', () => {
  it('速さを変えても長さは変わらない（素材のどれだけを流すかが変わる）', () => {
    const r = setClipSpeed(doc(), 'clip_001', 2);
    expect(r.ok && r.doc.clips[0]).toMatchObject({ speed: 2, durationSec: 10 });
  });

  it('等速に戻すと値を持たない（既定と同じ値を書かない）', () => {
    const a = setClipSpeed(doc(), 'clip_001', 2);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const r = setClipSpeed(a.doc, 'clip_001', 1);
    expect(r.ok && r.doc.clips[0].speed).toBeUndefined();
  });

  it('範囲へ収める（0 以下は保存できない文書になる）', () => {
    const slow = setClipSpeed(doc(), 'clip_001', 0);
    expect(slow.ok && slow.doc.clips[0].speed).toBe(CLIP_SPEED_MIN);
    expect(slow.ok && validateTimelineProject(slow.doc)).toBe(true);
    const fast = setClipSpeed(doc(), 'clip_001', 99);
    expect(fast.ok && fast.doc.clips[0].speed).toBe(CLIP_SPEED_MAX);
  });

  it('同じ値なら文書は変わらない', () => {
    const d = doc();
    const same = setClipSpeed(d, 'clip_001', 1);
    expect(same.ok && same.doc).toBe(d);
  });

  it('再生と書き出しの両方へ同じ値が渡る（聞いた音と書き出した音が一致する）', () => {
    const r = setClipSpeed(doc(), 'clip_001', 2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(audioCuesAt(r.doc, 1)[0].speed).toBe(2);
    expect(timelineAudioRuns(r.doc)[0].speed).toBe(2);
  });

  it('固定した列では変えられない', () => {
    const d = doc({ tracks: [{ id: 'track_002', kind: TRACK_KIND.audio, locked: true }] });
    const r = setClipSpeed(d, 'clip_001', 2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(EDIT_BLOCKED.locked);
  });
});

describe('setClipSourceStart', () => {
  it('素材の途中から使える（再生の頭出しと書き出しの切り出しに同じ値が渡る）', () => {
    const r = setClipSourceStart(doc(), 'clip_001', 30);
    expect(r.ok && r.doc.clips[0].sourceStartSec).toBe(30);
    if (!r.ok) return;
    expect(audioCuesAt(r.doc, 0)[0].offsetSec).toBe(30);
    expect(timelineAudioRuns(r.doc)[0].sourceStartSec).toBe(30);
  });

  it('0 に戻すと値を持たない／負にはしない', () => {
    const a = setClipSourceStart(doc(), 'clip_001', 30);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const back = setClipSourceStart(a.doc, 'clip_001', 0);
    expect(back.ok && back.doc.clips[0].sourceStartSec).toBeUndefined();
    const neg = setClipSourceStart(doc(), 'clip_001', -5);
    expect(neg.ok && neg.doc.clips[0].sourceStartSec).toBeUndefined();
  });
});

describe('setClipVolume / setClipFade', () => {
  it('音量を変えられる（範囲へ収める）', () => {
    const r = setClipVolume(doc(), 'clip_001', 9);
    expect(r.ok && r.doc.clips[0].volume).toBe(VOLUME_MAX);
    expect(r.ok && validateTimelineProject(r.doc)).toBe(true);
  });

  it('null で「動画全体に合わせる」へ戻せる（継承）', () => {
    const a = setClipVolume(doc(), 'clip_001', 0.8);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const r = setClipVolume(a.doc, 'clip_001', null);
    expect(r.ok && r.doc.clips[0].volume).toBeUndefined();
    // 継承＝BGM の既定音量で鳴る。
    expect(r.ok && audioCuesAt(r.doc, 1)[0].volume).toBeCloseTo(0.25);
  });

  it('フェードを前後それぞれ付けられる（0 で外れる）', () => {
    const a = setClipFade(doc(), 'clip_001', 'in', 2);
    expect(a.ok && a.doc.clips[0].fadeInSec).toBe(2);
    if (!a.ok) return;
    const b = setClipFade(a.doc, 'clip_001', 'out', 3);
    expect(b.ok && b.doc.clips[0]).toMatchObject({ fadeInSec: 2, fadeOutSec: 3 });
    if (!b.ok) return;
    const off = setClipFade(b.doc, 'clip_001', 'in', 0);
    expect(off.ok && off.doc.clips[0].fadeInSec).toBeUndefined();
  });

  it('フェードは書き出しでも尺の半分までに切り詰められる（再生と同じ規則）', () => {
    const r = setClipFade(doc({ clips: [bgm({ durationSec: 2 })] }), 'clip_001', 'in', 5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(timelineAudioRuns(r.doc)[0].fadeInSec).toBe(1);
  });
});

// 動画の**元の音**（#512 段2）。音のクリップの設定とは別物なので、断り方も別に持つ。
describe('setClipUseOriginalAudio / setClipOriginalAudioVolume', () => {
  const videoDoc = (over: Partial<TimelineClip> = {}, hasAudio: boolean | undefined = true): TimelineProject =>
    doc({
      assets: [{
        assetId: 'asset_v', assetType: 'video', displayName: '紹介', filePath: 'v.mp4',
        ...(hasAudio == null ? {} : { metadata: { hasAudio } }),
      }],
      clips: [{
        id: 'clip_001', kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001',
        startSec: 0, durationSec: 10, x: 0, y: 0, w: 1920, h: 1080, assetId: 'asset_v', ...over,
      } as TimelineClip],
    } as Partial<TimelineProject>);

  it('鳴らす・やめるを切り替えられる（やめたらキーごと落とす）', () => {
    const on = setClipUseOriginalAudio(videoDoc(), 'clip_001', true);
    expect(on.ok && on.doc.clips[0].useOriginalAudio).toBe(true);
    expect(on.ok && validateTimelineProject(on.doc)).toBe(true);
    if (!on.ok) return;
    const off = setClipUseOriginalAudio(on.doc, 'clip_001', false);
    // 既定と同じ値は書かない（他の編集操作と同じ規則）。
    expect(off.ok && off.doc.clips[0].useOriginalAudio).toBeUndefined();
  });

  it('音量を変えられ、null で標準へ戻せる', () => {
    const a = setClipOriginalAudioVolume(videoDoc(), 'clip_001', 0.9);
    expect(a.ok && a.doc.clips[0].originalAudioVolume).toBe(0.9);
    expect(a.ok && validateTimelineProject(a.doc)).toBe(true);
    if (!a.ok) return;
    const b = setClipOriginalAudioVolume(a.doc, 'clip_001', null);
    expect(b.ok && b.doc.clips[0].originalAudioVolume).toBeUndefined();
  });

  it('音量は保存できる範囲へ収める（schema の上限と同じ）', () => {
    const r = setClipOriginalAudioVolume(videoDoc(), 'clip_001', 9);
    expect(r.ok && r.doc.clips[0].originalAudioVolume).toBe(VOLUME_MAX);
    expect(r.ok && validateTimelineProject(r.doc)).toBe(true);
  });

  // ⚠️ **音の部品の断り（`notAudio`）を流用しない**＝「音や読み上げの部品で変えてください」は
  // 動画の話をしていないので、従っても直らない（§2-5）。
  it('音の入っていない動画では、動画むけの理由で断る', () => {
    const r = setClipUseOriginalAudio(videoDoc({}, false), 'clip_001', true);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe(EDIT_BLOCKED.noOriginalAudio);
    expect(!r.ok && r.reason).not.toBe(EDIT_BLOCKED.notAudio);
  });

  it('動画ではない部品でも、動画むけの理由で断る', () => {
    const r = setClipUseOriginalAudio(doc(), 'clip_001', true); // 既定の文書は BGM
    expect(!r.ok && r.reason).toBe(EDIT_BLOCKED.noOriginalAudio);
  });

  it('固定した列では変えられない', () => {
    const d = videoDoc();
    const locked = { ...d, tracks: d.tracks.map((t) => (t.id === 'track_001' ? { ...t, locked: true } : t)) };
    expect(setClipUseOriginalAudio(locked, 'clip_001', true).ok).toBe(false);
    const r = setClipOriginalAudioVolume(locked, 'clip_001', 0.5);
    expect(!r.ok && r.reason).toBe(EDIT_BLOCKED.locked);
  });

  // ⚠️ **素材を差し替えたら設定は落とす**（レビュー ℹ️）＝残すと、写真へ替えて欄が消えている間に
  // 設定だけ生き残り、別の音入り動画を入れた瞬間に**頼んでいない音が鳴り出す**。
  it('素材を差し替えると、元の音の設定は落ちる', () => {
    const d = {
      ...videoDoc({ useOriginalAudio: true, originalAudioVolume: 0.9 }),
      assets: [
        { assetId: 'asset_v', assetType: 'video', displayName: '紹介', filePath: 'v.mp4', metadata: { hasAudio: true } },
        { assetId: 'asset_w', assetType: 'video', displayName: '別の動画', filePath: 'w.mp4', metadata: { hasAudio: true } },
      ],
    } as TimelineProject;
    const r = setVisualClipContent(d, 'clip_001', { assetId: 'asset_w' });
    expect(r.ok && r.doc.clips[0].assetId).toBe('asset_w');
    expect(r.ok && r.doc.clips[0].useOriginalAudio).toBeUndefined();
    expect(r.ok && r.doc.clips[0].originalAudioVolume).toBeUndefined();
  });

  it('同じ素材を置き直しただけなら、元の音の設定は残る', () => {
    const d = videoDoc({ useOriginalAudio: true });
    const r = setVisualClipContent(d, 'clip_001', { assetId: 'asset_v', fit: 'contain' });
    expect(r.ok && r.doc.clips[0].useOriginalAudio).toBe(true);
  });

  // ⚠️ **何も変わらない操作は同じ文書を返す**（取り消しに空の1手を積まない＝他の操作と同じ規則）。
  it('同じ値を置き直しても文書は変わらない', () => {
    const d = videoDoc({ useOriginalAudio: true, originalAudioVolume: 0.5 });
    const a = setClipUseOriginalAudio(d, 'clip_001', true);
    expect(a.ok && a.doc).toBe(d);
    const b = setClipOriginalAudioVolume(d, 'clip_001', 0.5);
    expect(b.ok && b.doc).toBe(d);
  });
});
