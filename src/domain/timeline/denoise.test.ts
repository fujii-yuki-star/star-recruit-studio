// 部品の音のノイズを減らす（ADR-0068・#1479）＝プレビューも書き出しも同じ作り置きを鳴らす。
import { describe, expect, it } from 'vitest';
import { ASSET_TYPE, PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import type { TimelineClip, TimelineProject } from './types';
import { TIMELINE_SCHEMA_VERSION } from './types';
import {
  AUDIO_SOURCE_KIND, audioCuesAt, audioSourceKey, audioSourceKindOf, audioSourcesOf, canDenoise, denoisedCachePath,
  denoiseSourceKey, denoisesClip, playedAudioKeyOfClip,
} from './audio';
import { setClipDenoise, EDIT_BLOCKED } from './edit';
import { timelineAudioRuns } from './export';
import { validateTimelineProject } from '../validation/generated/validators.js';

const rec = (over: Partial<TimelineClip> = {}): TimelineClip =>
  ({ id: 'clip_001', kind: TIMELINE_CLIP_KIND.audio, trackId: 'track_002', startSec: 0, durationSec: 5, assetId: 'asset_001', ...over }) as TimelineClip;
const movie = (over: Partial<TimelineClip> = {}): TimelineClip =>
  ({ id: 'clip_002', kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001', startSec: 1, durationSec: 4, x: 0, y: 0, w: 1920, h: 1080, assetId: 'asset_002', useOriginalAudio: true, sourceStartSec: 2, ...over }) as TimelineClip;

function doc(clips: TimelineClip[]): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20261020_001',
    projectName: 'テスト',
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600, audioAuto: { duckBgm: false } },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [
      { assetId: 'asset_001', assetType: ASSET_TYPE.bgm, displayName: '録音', filePath: 'assets/asset_001.wav', metadata: { durationSec: 30 } },
      { assetId: 'asset_002', assetType: ASSET_TYPE.video, displayName: '取材', filePath: 'assets/asset_002.mp4', metadata: { durationSec: 30, hasAudio: true } },
    ],
    tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.audio }],
    clips,
  };
}

describe('denoisedCachePath（作り置きの場所）', () => {
  // ⚠️ **Rust の `denoised_rel_path` と同じ規則**（向こうにも同じ値の検査がある）。
  it('素材のファイル名から決まる（cache/denoise/<名前>.flac）', () => {
    expect(denoisedCachePath('assets/asset_002.mp4')).toBe('cache/denoise/asset_002.mp4.flac');
    expect(denoisedCachePath('assets\\voice.wav')).toBe('cache/denoise/voice.wav.flac');
  });
});

describe('canDenoise / denoisesClip（どの部品に効くか）', () => {
  it('持ち込みの音と、直接置いた動画に効く', () => {
    const d = doc([rec(), movie()]);
    expect(canDenoise(d, d.clips[0]!)).toBe(true);
    expect(canDenoise(d, d.clips[1]!)).toBe(true);
  });
  it('同梱の曲・読み上げ・止めた絵には効かない', () => {
    const d = doc([]);
    expect(canDenoise(d, rec({ assetId: undefined, bundledBgmId: 'summer-morning' }))).toBe(false);
    expect(canDenoise(d, rec({ kind: TIMELINE_CLIP_KIND.voice, assetId: undefined, voice: { text: 'あ', status: 'none' } }))).toBe(false);
    expect(canDenoise(d, movie({ holdFrame: true }))).toBe(false);
  });
  it('切り替えが立っているときだけ減らす', () => {
    const d = doc([]);
    expect(denoisesClip(d, rec())).toBe(false);
    expect(denoisesClip(d, rec({ denoise: true }))).toBe(true);
  });
});

describe('鳴らす音の出どころ（プレビュー）', () => {
  it('ノイズを減らす部品は作り置きを読む（元の素材は読まない）', () => {
    const d = doc([rec({ denoise: true }), movie({ denoise: true })]);
    const srcs = audioSourcesOf(d);
    expect(srcs.map(audioSourceKey)).toEqual(['denoise:asset_001', 'denoise:asset_002']);
    expect(audioSourceKindOf(srcs[0]!)).toBe(AUDIO_SOURCE_KIND.denoise);
    expect(playedAudioKeyOfClip(d, d.clips[0]!)).toBe(denoiseSourceKey('asset_001'));
    expect(playedAudioKeyOfClip(d, d.clips[1]!)).toBe(denoiseSourceKey('asset_002'));
  });

  it('切り替えが無ければ今までどおり（動画は音の出どころに並ばない）', () => {
    const d = doc([rec(), movie()]);
    expect(audioSourcesOf(d).map(audioSourceKey)).toEqual(['asset:asset_001']);
    expect(playedAudioKeyOfClip(d, d.clips[1]!)).toBeNull();
  });

  // ⚠️ **動画の元の音は `<video>` の代わりに音の側で鳴らす**＝同じ時刻・速さ・音量（書き出しと同じ解決）。
  it('ノイズを減らす動画の元の音を、同じ頭出し・速さで鳴らす', () => {
    const d = doc([movie({ denoise: true, speed: 2, originalAudioVolume: 0.5 })]);
    const cue = audioCuesAt(d, 2).find((q) => q.clipId === 'clip_002')!;
    expect(cue).toEqual({ clipId: 'clip_002', offsetSec: 2 + (2 - 1) * 2, volume: 0.5, speed: 2 });
    expect(audioCuesAt(d, 0.5).find((q) => q.clipId === 'clip_002')).toBeUndefined(); // まだ始まっていない
    expect(audioCuesAt(doc([movie({ denoise: true, useOriginalAudio: false })]), 2)).toEqual([]); // 元の音を流さない動画
    expect(audioCuesAt(doc([movie()]), 2)).toEqual([]); // 減らさない動画は `<video>` が鳴らす
  });

  // ⚠️ **描かれるかは書き出しと同じ述語**（PR レビュー 🔴）＝まとまりごと隠した動画は書き出しで鳴らないので、プレビューでも鳴らさない。
  it('まとまりごと隠した動画・隠した部品・隠した列は鳴らさない', () => {
    const grouped = { ...doc([movie({ denoise: true })]), groups: [{ id: 'group_001', members: ['clip_002'], transform: { x: 0, y: 0, scale: 1, rotation: 0 }, hidden: true }] } as TimelineProject;
    expect(audioCuesAt(grouped, 2)).toEqual([]);
    expect(audioCuesAt(doc([movie({ denoise: true, hidden: true })]), 2)).toEqual([]);
    const hiddenTrack = { ...doc([movie({ denoise: true })]), tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, hidden: true }, { id: 'track_002', kind: TRACK_KIND.audio }] };
    expect(audioCuesAt(hiddenTrack, 2)).toEqual([]);
  });
});

describe('書き出し（作り置きをパスで渡す）', () => {
  it('音の部品と動画の元の音の両方が作り置きのパスを渡す（プレビューと同じファイル）', () => {
    const d = doc([rec({ denoise: true }), movie({ denoise: true })]);
    const { runs } = timelineAudioRuns(d);
    expect(runs).toHaveLength(2); // 動画を音の部品として二重に並べない
    expect(runs.find((r) => r.clipId === 'clip_001')).toMatchObject({ sourceKey: 'denoise:asset_001', assetPath: 'cache/denoise/asset_001.wav.flac', fileExt: 'flac' });
    expect(runs.find((r) => r.clipId === 'clip_002')).toMatchObject({ sourceKey: 'denoise:asset_002', assetPath: 'cache/denoise/asset_002.mp4.flac', fileExt: 'flac', sourceStartSec: 2 });
  });

  it('切り替えが無ければ今までどおり（元の素材）', () => {
    const { runs } = timelineAudioRuns(doc([rec(), movie()]));
    expect(runs.find((r) => r.clipId === 'clip_001')).toMatchObject({ sourceKey: 'asset:asset_001', fileExt: 'wav' });
    expect(runs.find((r) => r.clipId === 'clip_001')!.assetPath).toBeUndefined();
    expect(runs.find((r) => r.clipId === 'clip_002')).toMatchObject({ assetPath: 'assets/asset_002.mp4', fileExt: 'mp4' });
  });
});

describe('setClipDenoise（切り替え）', () => {
  it('付け外しできる・外すとキーを消す・できた文書は schema に通る', () => {
    const d = doc([rec()]);
    const on = setClipDenoise(d, 'clip_001', true);
    expect(on.ok && on.doc.clips[0]!.denoise).toBe(true);
    if (!on.ok) return;
    expect(validateTimelineProject(on.doc), JSON.stringify(validateTimelineProject.errors)).toBe(true);
    const off = setClipDenoise(on.doc, 'clip_001', false);
    expect(off.ok && 'denoise' in off.doc.clips[0]!).toBe(false);
  });
  it('効かない部品・固定した列・同じ状態', () => {
    const d = doc([rec({ assetId: undefined, bundledBgmId: 'summer-morning' })]);
    expect(setClipDenoise(d, 'clip_001', true)).toEqual({ ok: false, reason: EDIT_BLOCKED.contentField });
    const locked = { ...doc([rec()]), tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.audio, locked: true }] };
    expect(setClipDenoise(locked, 'clip_001', true)).toEqual({ ok: false, reason: EDIT_BLOCKED.locked });
    const same = doc([rec()]);
    expect(setClipDenoise(same, 'clip_001', false)).toEqual({ ok: true, doc: same });
  });
});
