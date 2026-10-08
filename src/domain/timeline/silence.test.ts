// 無音・長い間を見つけて、まとめて詰める（#1385）。
import { describe, expect, it } from 'vitest';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import { TIMELINE_SCHEMA_VERSION } from './types';
import type { TimelineClip, TimelineProject } from './types';
import { volumeAt } from './audio';
import {
  SILENCE_ABS_PEAK, SILENCE_KEEP_SEC, applySilenceCuts, silenceCandidates, silenceSourceOf, silentRunsFromPeaks,
} from './silence';

const B = 0.05;
/** その秒から映る最初のコマ（30fps）＝候補の割り目はコマに乗る。 */
const up = (sec: number): number => Math.ceil(sec * 30 - 1e-9) / 30;
/** その秒より前で最後のコマ（終わりは内側へ丸める＝読み上げの頭を巻き込まない）。 */
const down = (sec: number): number => Math.floor(sec * 30 + 1e-9) / 30;
/** 秒の区間ごとに大きさを決めた山を作る（`[秒, 大きさ]` の並び・最後まで）。 */
function peaksOf(totalSec: number, loud: [number, number][]): number[] {
  const n = Math.round(totalSec / B);
  return Array.from({ length: n }, (_, i) => {
    const t = i * B;
    return loud.some(([a, b]) => t >= a && t < b) ? 0.5 : 0;
  });
}

function doc(clips: TimelineClip[]): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION, format: PROJECT_FORMAT.timeline, projectId: 'proj_20261008_001', projectName: 'x',
    createdAt: '2026-10-08T00:00:00.000Z', updatedAt: '2026-10-08T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [{ assetId: 'asset_001', assetType: 'bgm', displayName: '録音', filePath: 'assets/rec.wav' }],
    tracks: [{ id: 'track_001', kind: TRACK_KIND.audio }, { id: 'track_002', kind: TRACK_KIND.audio }],
    clips,
  };
}
const rec = (over: Partial<TimelineClip> = {}): TimelineClip =>
  ({ id: 'clip_001', kind: TIMELINE_CLIP_KIND.audio, trackId: 'track_001', startSec: 0, durationSec: 10, assetId: 'asset_001', ...over }) as TimelineClip;

describe('silentRunsFromPeaks', () => {
  it('小さい所の続きを区間にする（終わりまで続く無音も）', () => {
    expect(silentRunsFromPeaks([0.5, 0, 0, 0.5, 0], 1)).toEqual([{ fromSec: 1, toSec: 3 }, { fromSec: 4, toSec: 5 }]);
  });
  it('いちばん大きい音の1割未満は無音（大きく録った音に雑音が乗っていても拾う）', () => {
    // 最大 0.5 → 0.05 未満は無音（-34dB＝0.02 より大きい雑音 0.03 も無音に数える＝大きい方の基準）。
    expect(silentRunsFromPeaks([0.5, 0.019, 0.03, 0.06], 1)).toEqual([{ fromSec: 1, toSec: 3 }]);
  });
  it('小さく録った音でも -34dB 未満は無音（割合だけで見ると雑音を音に数えてしまう）', () => {
    // 最大 0.1 → 割合の基準は 0.01。雑音 0.015 は -34dB（0.02）未満なので無音。
    expect(silentRunsFromPeaks([0.1, 0.015, 0.1], 1)).toEqual([{ fromSec: 1, toSec: 2 }]);
  });
  it('全部が無音なら全体（大きさの基準は下限 -34dB）', () => {
    expect(silentRunsFromPeaks([0, SILENCE_ABS_PEAK / 2], 1)).toEqual([{ fromSec: 0, toSec: 2 }]);
  });
});

describe('silenceCandidates', () => {
  it('両端を残し、短い間（1秒未満）は候補にしない・コマに乗せる', () => {
    // 0〜2 話す／2〜5 無音／5〜5.8 話す／5.8〜6.6 無音（短い）／6.6〜10 話す
    const p = peaksOf(10, [[0, 2], [5, 5.8], [6.6, 10]]);
    expect(silenceCandidates(doc([rec()]), rec(), p, B)).toEqual([{ startSec: up(2 + SILENCE_KEEP_SEC), endSec: down(5 - SILENCE_KEEP_SEC) }]);
  });

  it('置いた位置と速さを反映する（素材の秒 → タイムラインの秒）', () => {
    const clip = rec({ startSec: 3, durationSec: 5, speed: 2 }); // 素材 10 秒ぶんを 5 秒で
    const p = peaksOf(10, [[0, 2], [6, 10]]); // 素材 2〜6 秒が無音 → タイムライン 4〜6 秒
    expect(silenceCandidates(doc([clip]), clip, p, B)).toEqual([{ startSec: up(4 + SILENCE_KEEP_SEC), endSec: down(6 - SILENCE_KEEP_SEC) }]);
  });

  it('読み上げが鳴っている所は外す（隠した読み上げは数えない）', () => {
    const p = peaksOf(10, [[0, 1], [9, 10]]); // 1〜9 無音 → 1.25〜8.75
    const voice = { id: 'clip_002', kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_002', startSec: 4, durationSec: 1, voice: { text: 'あ', status: 'none' } } as TimelineClip;
    expect(silenceCandidates(doc([rec(), voice]), rec(), p, B)).toEqual([
      { startSec: up(1.25), endSec: 4 }, { startSec: 5, endSec: down(8.75) },
    ]);
    // ⚠️ 読み上げの頭がコマの途中（4.01 秒）でも、消す範囲に読み上げを入れない（入れると読み上げと字幕が丸ごと消える）。
    const odd = { ...voice, startSec: 4.01 } as TimelineClip;
    const c2 = silenceCandidates(doc([rec(), odd]), rec(), p, B);
    expect(c2[0].endSec).toBeLessThanOrEqual(4.01);
    expect(c2[1].startSec).toBeGreaterThanOrEqual(5.01);
    const hidden = { ...voice, hidden: true } as TimelineClip;
    expect(silenceCandidates(doc([rec(), hidden]), rec(), p, B)).toEqual([{ startSec: up(1.25), endSec: down(8.75) }]);
  });
});

describe('applySilenceCuts', () => {
  it('まとめて詰める（後ろから当てる＝前の候補の時刻がずれない）', () => {
    const d = doc([rec({ durationSec: 10 })]);
    const r = applySilenceCuts(d, [{ startSec: 1, endSec: 2 }, { startSec: 5, endSec: 7 }], volumeAt);
    if (!r.ok) throw new Error('詰められない');
    expect(r.applied).toBe(2);
    // 10 秒 − 1 − 2 ＝ 7 秒ぶん（3つに分かれて詰まる）。⚠️ **残った素材の範囲**で見る＝前から当てると
    //   2つ目の候補が1秒ずれて、素材の 6〜8 秒を消してしまう（長さの合計は同じなので長さでは見分けられない）。
    const pieces = [...r.doc.clips].sort((a, b) => a.startSec - b.startSec)
      .map((c) => [c.sourceStartSec ?? 0, (c.sourceStartSec ?? 0) + c.durationSec].map((v) => Math.round(v * 100) / 100));
    expect(pieces).toEqual([[0, 1], [2, 5], [7, 10]]);
    const total = r.doc.clips.reduce((a, c) => a + c.durationSec, 0);
    expect(total).toBeCloseTo(7);
    expect(Math.max(...r.doc.clips.map((c) => c.startSec + c.durationSec))).toBeCloseTo(7);
  });

  it('1つでも当てられなければ何も変えない（固定した列）', () => {
    const d = { ...doc([rec()]), tracks: [{ id: 'track_001', kind: TRACK_KIND.audio, locked: true }] } as TimelineProject;
    expect(applySilenceCuts(d, [{ startSec: 1, endSec: 2 }], volumeAt).ok).toBe(false);
  });
});

describe('silenceSourceOf', () => {
  const withVideo = (hasAudio: boolean | undefined): TimelineProject => ({
    ...doc([]),
    assets: [{ assetId: 'asset_mov', assetType: 'video', displayName: 'v', filePath: 'assets/v.mp4', ...(hasAudio == null ? {} : { metadata: { hasAudio } }) }],
  });
  const vclip = { id: 'clip_009', kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001', startSec: 0, durationSec: 4, assetId: 'asset_mov', sourceStartSec: 2, speed: 1.5 } as TimelineClip;
  it('音が入っていると分かっている動画は、置いた範囲（素材の秒）を返す', () => {
    expect(silenceSourceOf(withVideo(true), vclip)).toEqual({ relPath: 'assets/v.mp4', fromSec: 2, lengthSec: 6 });
  });
  it('音の無い動画・分からない動画は探さない', () => {
    expect(silenceSourceOf(withVideo(false), vclip)).toBeNull();
    expect(silenceSourceOf(withVideo(undefined), vclip)).toBeNull();
  });
  it('素材の長さを越えて測らない（越えた所は音が無く、山1つが短くなって時刻が縮む）', () => {
    const d = withVideo(true);
    d.assets[0].metadata = { hasAudio: true, durationSec: 5 };
    expect(silenceSourceOf(d, vclip)?.lengthSec).toBe(3); // 素材 5 秒・使い始め 2 秒 → 残り 3 秒（置いた長さ 6 秒より短い）
  });
  it('音の素材はそのまま・素材を持たない部品は探さない', () => {
    expect(silenceSourceOf(doc([rec()]), rec())?.relPath).toBe('assets/rec.wav');
    expect(silenceSourceOf(doc([rec()]), rec({ assetId: undefined }))).toBeNull();
  });
});
