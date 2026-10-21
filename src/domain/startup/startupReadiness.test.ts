// 頼まれた仕事を始めてよいか（#1204）。
//
// ⚠️ **実機で見つかった穴**（2026-09-17・#1194）＝外の AI が読み上げのセリフを書いて書き出すと、
// **−91dB の無音の動画**が**終了コード 0**（成功）で返っていた。
// 公開前チェックの「要対応」を**画面が人に見せて**いたが、**起動の引数で走る回は誰も画面を読まない**。
import { describe, expect, it } from 'vitest';
import { NARRATION_STATUS, TIMELINE_CLIP_KIND } from '../enums';
import type { Scene } from '../project/types';
import type { TimelineClip } from '../timeline/types';
import {
  STARTUP_NOT_READY,
  sceneUngeneratedVoices,
  startupExportNotReady,
  timelineUngeneratedVoices,
} from './startupReadiness';

const voiceClip = (id: string, text: string, status: string): TimelineClip =>
  ({
    id, kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_002', startSec: 0, durationSec: 2,
    voice: { text, status },
  }) as TimelineClip;

const scene = (over: Partial<Scene> = {}): Scene =>
  ({
    sceneId: 'scene_001', partId: 'part_001', order: 1, sceneType: 'photo_intro',
    templateId: 't', durationSec: 8, assetRefs: {},
    character: { enabled: false, characterId: 'yuko' }, texts: {},
    narration: { text: 'あいさつ', status: NARRATION_STATUS.none }, warnings: [],
    ...over,
  }) as Scene;

describe('タイムライン形式：まだ作られていない読み上げ', () => {
  it('作っていないものを数える', () => {
    expect(timelineUngeneratedVoices([
      voiceClip('clip_001', 'あ', NARRATION_STATUS.none),
      voiceClip('clip_002', 'い', NARRATION_STATUS.generated),
    ])).toBe(1);
  });

  // ⚠️ **文が空のものは数えない**＝元から鳴らないので、直しようがない（断ると行き止まりになる）。
  it('文が空のものは数えない', () => {
    expect(timelineUngeneratedVoices([voiceClip('clip_001', '   ', NARRATION_STATUS.none)])).toBe(0);
  });

  it('読み上げ以外の部品は数えない', () => {
    const text = { id: 'clip_009', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: 2, text: 'あ' } as TimelineClip;
    expect(timelineUngeneratedVoices([text])).toBe(0);
  });

  it('全部できていれば 0', () => {
    expect(timelineUngeneratedVoices([voiceClip('clip_001', 'あ', NARRATION_STATUS.generated)])).toBe(0);
  });
});

describe('場面形式：まだ作られていない読み上げ', () => {
  it('作っていない場面を数える', () => {
    expect(sceneUngeneratedVoices([scene(), scene({ sceneId: 'scene_002', narration: { text: 'つぎ', status: NARRATION_STATUS.generated } })])).toBe(1);
  });

  it('文が空の場面は数えない', () => {
    expect(sceneUngeneratedVoices([scene({ narration: { text: '  ', status: NARRATION_STATUS.none } })])).toBe(0);
  });

  it('全部できていれば 0', () => {
    expect(sceneUngeneratedVoices([scene({ narration: { text: 'あ', status: NARRATION_STATUS.generated } })])).toBe(0);
  });
});

describe('頼まれた書き出しを断るか', () => {
  // ⚠️ **ここが `null` を返すと、無音の動画が「成功」で返る**（実機で踏んだ形）。
  it('作っていない声があれば断る', () => {
    expect(startupExportNotReady({ ungeneratedVoices: 1, missingUsedAssets: 0 })).toBe(STARTUP_NOT_READY.voiceNotGenerated);
  });

  // ⚠️ **使っている素材が見つからなければ断る**（PR #1208 レビュー 🟡）＝
  // 止めないと、**その場面が黙って抜けた動画**になる（声の無音化と同じ「黙って別の結果」）。
  it('使っている素材が見つからなければ断る', () => {
    expect(startupExportNotReady({ ungeneratedVoices: 0, missingUsedAssets: 1 })).toBe(STARTUP_NOT_READY.assetMissing);
  });

  it('無ければ始めてよい', () => {
    expect(startupExportNotReady({ ungeneratedVoices: 0, missingUsedAssets: 0 })).toBeNull();
  });
});

// ⚠️ **読めるかを渡すと、作成済みなのに音が読めないものも残りに数える**（通し点検 2026-10-16）＝印だけだと、
//   声のファイルが消えた動画で `--make-voices` が「作りました」（0）と返し、書き出しが断る（外の AI の行き止まり）。
describe('作成済みなのに音が読めない声も数える（読めるかを渡したとき）', () => {
  const gen = (id: string, voicePath?: string): TimelineClip =>
    ({ id, kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_002', startSec: 0, durationSec: 2,
      voice: { text: 'あ', status: NARRATION_STATUS.generated, ...(voicePath ? { voicePath } : {}) } }) as TimelineClip;

  it('タイムライン形式：読めない作成済みと、置き場所の無い作成済みを数える', () => {
    const clips = [gen('clip_001', 'voices/clip_001.wav'), gen('clip_002', 'voices/clip_002.wav'), gen('clip_003')];
    const readable = (key: string) => key === 'voice:voices/clip_002.wav';
    expect(timelineUngeneratedVoices(clips, readable)).toBe(2);
    expect(timelineUngeneratedVoices(clips), '渡さないときは印だけ').toBe(0);
  });

  it('場面形式：単独のセリフは場面 id、掛け合いは行ごとのキーで見る', () => {
    const single = scene({ narration: { text: 'あいさつ', status: NARRATION_STATUS.generated, voicePath: 'voices/scene_001.wav' } });
    const dialogue = scene({
      sceneId: 'scene_002',
      lines: [{ lineId: 'line_001', speaker: 'voicevox_zundamon', text: 'やあ', status: NARRATION_STATUS.generated }],
    } as unknown as Partial<Scene>);
    expect(sceneUngeneratedVoices([single, dialogue], (k) => k === 'scene_001')).toBe(1);
    expect(sceneUngeneratedVoices([single, dialogue], (k) => k === 'scene_002/line_001')).toBe(1);
    expect(sceneUngeneratedVoices([single, dialogue], () => true)).toBe(0);
    expect(sceneUngeneratedVoices([single, dialogue]), '渡さないときは印だけ').toBe(0);
  });
});
