// タイムラインの書き出しの並べ方（ADR-0032 決定22・#631）。全フレーム描画と音の配置を固定する。
import { describe, expect, it } from 'vitest';
import { FPS } from '../constants';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import type { TimelineClip, TimelineProject } from './types';
import { TIMELINE_SCHEMA_VERSION } from './types';
import { TIMELINE_EXPORT_BLOCK, frameTimeAt, timelineAudioRuns, timelineExportBlockers, timelineFramePlan } from './export';
import { frameTimeSec } from './persistence';

function clip(id: string, over: Partial<TimelineClip> = {}): TimelineClip {
  return { id, kind: TIMELINE_CLIP_KIND.audio, trackId: 'track_002', startSec: 0, durationSec: 5, ...over };
}

const voiceClip = (id: string, over: Partial<TimelineClip> = {}): TimelineClip =>
  clip(id, { kind: TIMELINE_CLIP_KIND.voice, voice: { text: 'あ', status: 'generated', voicePath: `voices/${id}.wav` }, ...over });

function doc(over: Partial<TimelineProject> = {}): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20260728_001',
    projectName: 'テスト',
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [],
    tracks: [
      { id: 'track_001', kind: TRACK_KIND.visual },
      { id: 'track_002', kind: TRACK_KIND.audio },
    ],
    clips: [],
    ...over,
  };
}

const textClip = (id: string, over: Partial<TimelineClip> = {}): TimelineClip =>
  clip(id, { kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', x: 0, y: 0, w: 10, h: 10, text: 'あ', ...over });

describe('timelineFramePlan（全フレーム描画・決定22）', () => {
  it('尺ぶんのフレームを描き、出力の尺はフレーム数から導く（映像と音の長さが食い違わない）', () => {
    const p = timelineFramePlan(doc({ clips: [textClip('clip_001', { durationSec: 5 })] }));
    expect(p).toEqual({ fps: FPS, frameCount: 150, durationSec: 5 });
  });

  it('端数の尺でも、出力の尺はフレーム数と一致する', () => {
    const p = timelineFramePlan(doc({ clips: [textClip('clip_001', { durationSec: 5.52 })] }));
    expect(p.frameCount).toBe(166); // 5.52 × 30 = 165.6 → 166
    expect(p.durationSec).toBeCloseTo(166 / FPS);
  });

  it('端数は切り上げる＝末尾が切れない（四捨五入だと語尾が落ちる尺）', () => {
    const p = timelineFramePlan(doc({ clips: [textClip('clip_001', { durationSec: 5.505 })] }));
    expect(p.frameCount).toBe(166); // 165.15 を四捨五入すると 165＝5.5 秒で末尾 5ms が落ちる
    expect(p.durationSec).toBeGreaterThanOrEqual(5.505);
  });

  it('切り上げても最後のフレームの時刻は尺の中に入る（空白のフレームを増やさない）', () => {
    for (const durationSec of [5.505, 5.52, 5, 0.001]) {
      const p = timelineFramePlan(doc({ clips: [textClip('clip_001', { durationSec })] }));
      expect(frameTimeAt(p.frameCount - 1, p.fps)).toBeLessThan(durationSec);
    }
  });

  it('何も置いていない動画は 0 フレーム（呼び出し側が書き出しを止める）', () => {
    expect(timelineFramePlan(doc()).frameCount).toBe(0);
  });

  it('とても短い動画でも1フレームは描く（空のMP4を作らない）', () => {
    expect(timelineFramePlan(doc({ clips: [textClip('clip_001', { durationSec: 0.001 })] })).frameCount).toBe(1);
  });
});

describe('frameTimeAt', () => {
  it('どのフレームも同じ絵を二度描かない（連番の時刻が必ず1フレームぶん進む）', () => {
    // 123 番は「掛け算の誤差で1つ前へ落ちる」代表（123/30*30 = 122.99999999999999）。
    for (const i of [0, 1, 29, 30, 122, 123, 124, 151, 999]) {
      expect(frameTimeAt(i, FPS)).toBeCloseTo(i / FPS);
      expect(frameTimeAt(i + 1, FPS) - frameTimeAt(i, FPS)).toBeCloseTo(1 / FPS);
    }
  });

  it('総当たりで、どの番号も同じ時刻を返さない（フレームの取りこぼし・重複が無い）', () => {
    for (const fps of [24, 25, 30, 60]) {
      const seen = new Set<number>();
      for (let i = 0; i < 4000; i += 1) {
        const t = frameTimeAt(i, fps);
        expect(seen.has(t)).toBe(false);
        seen.add(t);
      }
    }
  });

  it('描画時刻（`frameTimeSec`）と同じ値になる時刻がある＝経路がずれていない', () => {
    const d = doc({ clips: [textClip('clip_001', { durationSec: 5 })] });
    // 途中のフレームは、再生で同じ時刻を指したときの描画時刻と一致する。
    expect(frameTimeSec(d, frameTimeAt(60, FPS))).toBeCloseTo(frameTimeAt(60, FPS));
  });
});

describe('timelineAudioRuns', () => {
  it('置く位置・長さ・音源を返す', () => {
    const d = doc({ clips: [voiceClip('clip_001', { startSec: 2, durationSec: 3 })] });
    expect(timelineAudioRuns(d)).toEqual([
      {
        clipId: 'clip_001',
        sourceKey: 'voice:voices/clip_001.wav',
        fileExt: 'wav',
        delaySec: 2,
        playSec: 3,
        sourceStartSec: 0,
        speed: 1,
        volume: 1,
        fadeInSec: 0,
        fadeOutSec: 0,
        loop: false,
      },
    ]);
  });

  it('読み上げは繰り返さない／BGM は繰り返す（言葉が二重に鳴らない）', () => {
    const d = doc({ clips: [voiceClip('clip_001'), clip('clip_002', { bundledBgmId: 'found-new-hope' })] });
    expect(timelineAudioRuns(d).map((r) => r.loop)).toEqual([false, true]);
  });

  it('音量は再生と同じ解決（BGM の既定は 0.25）', () => {
    const d = doc({ clips: [clip('clip_001', { bundledBgmId: 'found-new-hope' })] });
    expect(timelineAudioRuns(d)[0].volume).toBeCloseTo(0.25);
  });

  it('読み上げは動画全体の声の音量を継承する', () => {
    const d = doc({
      voiceSettings: { defaultVoiceId: 'voicevox_zundamon', volume: 0.5 },
      clips: [voiceClip('clip_001')],
    });
    expect(timelineAudioRuns(d)[0].volume).toBeCloseTo(0.5);
  });

  it('フェードは尺の半分までに切り詰めて渡す（再生と同じ規則）', () => {
    const d = doc({ clips: [clip('clip_001', { durationSec: 2, fadeInSec: 4, fadeOutSec: 4, bundledBgmId: 'found-new-hope' })] });
    expect(timelineAudioRuns(d)[0]).toMatchObject({ fadeInSec: 1, fadeOutSec: 1 });
  });

  it('速度を変えても、鳴らす長さは置いた長さのまま（素材側で長く読む）', () => {
    const d = doc({ clips: [clip('clip_001', { durationSec: 3, speed: 2, bundledBgmId: 'found-new-hope' })] });
    expect(timelineAudioRuns(d)[0].playSec).toBeCloseTo(3);
  });

  it('素材のトリムと速度を渡す', () => {
    const d = doc({ clips: [clip('clip_001', { sourceStartSec: 10, speed: 2, bundledBgmId: 'found-new-hope' })] });
    expect(timelineAudioRuns(d)[0]).toMatchObject({ sourceStartSec: 10, speed: 2 });
  });

  it('隠した列・隠したクリップの音は置かない（再生と同じ判定を通す）', () => {
    const hiddenTrack = doc({
      tracks: [{ id: 'track_002', kind: TRACK_KIND.audio, hidden: true }],
      clips: [voiceClip('clip_001')],
    });
    expect(timelineAudioRuns(hiddenTrack)).toEqual([]);
    const hiddenClip = doc({ clips: [voiceClip('clip_001', { hidden: true })] });
    expect(timelineAudioRuns(hiddenClip)).toEqual([]);
  });

  it('まだ作っていない読み上げは置かない（音源が無い）', () => {
    const d = doc({ clips: [clip('clip_001', { kind: TIMELINE_CLIP_KIND.voice, voice: { text: 'あ', status: 'none' } })] });
    expect(timelineAudioRuns(d)).toEqual([]);
  });

  it('絵のクリップは音として置かない', () => {
    expect(timelineAudioRuns(doc({ clips: [textClip('clip_001')] }))).toEqual([]);
  });
});

describe('timelineExportBlockers（書き出す前に止める理由）', () => {
  const videoAsset = {
    assetId: 'asset_video_001',
    assetType: 'video' as const,
    displayName: '会社紹介',
    filePath: 'assets/a.mp4',
  };

  it('置いたものがあれば止めない', () => {
    expect(timelineExportBlockers(doc({ clips: [textClip('clip_001')] }))).toEqual([]);
  });

  it('何も置いていなければ止める', () => {
    expect(timelineExportBlockers(doc())).toEqual([{ code: TIMELINE_EXPORT_BLOCK.empty, clipIds: [] }]);
  });

  it('動画の素材を置いていたら止める（静止画＋無音の動画を成功として出さない）', () => {
    const d = doc({
      assets: [videoAsset],
      clips: [textClip('clip_001', { kind: TIMELINE_CLIP_KIND.slot, assetId: 'asset_video_001' })],
    });
    expect(timelineExportBlockers(d)).toEqual([
      { code: TIMELINE_EXPORT_BLOCK.videoAsset, clipIds: ['clip_001'] },
    ]);
  });

  it('枠の差し込み口に入れた動画・立ち絵として入れた動画も見つける', () => {
    const inSlot = doc({
      assets: [videoAsset],
      clips: [textClip('clip_001', { kind: TIMELINE_CLIP_KIND.template, assetRefs: { bg: 'asset_video_001' } })],
    });
    expect(timelineExportBlockers(inSlot)[0].clipIds).toEqual(['clip_001']);
    const asPose = doc({
      assets: [videoAsset],
      clips: [
        textClip('clip_001', {
          kind: TIMELINE_CLIP_KIND.template,
          character: { enabled: true, characterId: 'yuko', poseAssetId: 'asset_video_001' },
        }),
      ],
    });
    expect(timelineExportBlockers(asPose)[0].clipIds).toEqual(['clip_001']);
  });

  it('持っているだけで使っていない動画素材では止めない（消し忘れで書き出せなくならない）', () => {
    const d = doc({ assets: [videoAsset], clips: [textClip('clip_001')] });
    expect(timelineExportBlockers(d)).toEqual([]);
  });
});

describe('音源ファイルの拡張子', () => {
  it('同梱BGM・持ち込みの音・読み上げで、実際のファイルに合わせる', () => {
    const d = doc({
      assets: [{ assetId: 'asset_001', assetType: 'bgm', displayName: '曲', filePath: 'assets/song.M4A' }],
      clips: [
        clip('clip_001', { bundledBgmId: 'found-new-hope' }),
        clip('clip_002', { assetId: 'asset_001', startSec: 10 }),
        voiceClip('clip_003', { startSec: 20 }),
      ],
    });
    expect(timelineAudioRuns(d).map((r) => r.fileExt)).toEqual(['mp3', 'm4a', 'wav']);
  });

  it('拡張子が判らないときも空にしない（形式を判定できる手がかりを渡す）', () => {
    const d = doc({
      assets: [{ assetId: 'asset_001', assetType: 'bgm', displayName: '曲', filePath: 'assets/song' }],
      clips: [clip('clip_001', { assetId: 'asset_001' })],
    });
    expect(timelineAudioRuns(d)[0].fileExt).toBe('mp3');
  });
});

describe('見た目が見つからない部品（書き出しを止める）', () => {
  const tmplClip = (id: string, templateId: string): TimelineClip =>
    clip(id, { kind: TIMELINE_CLIP_KIND.template, trackId: 'track_001', templateId, x: 0, y: 0, w: 100, h: 100 });

  it('読み込めている見た目が渡されたとき、見つからない部品があれば止める', () => {
    const d = doc({ clips: [tmplClip('clip_001', 'tmpl_missing')] });
    expect(timelineExportBlockers(d, { knownTemplateIds: new Set(['tmpl_001']) })).toEqual([
      { code: TIMELINE_EXPORT_BLOCK.templateUnresolved, clipIds: ['clip_001'] },
    ]);
  });

  it('見つかっていれば止めない', () => {
    const d = doc({ clips: [tmplClip('clip_001', 'tmpl_001')] });
    expect(timelineExportBlockers(d, { knownTemplateIds: new Set(['tmpl_001']) })).toEqual([]);
  });

  it('判定材料が無いときは見ない（嘘の理由を出さない）', () => {
    const d = doc({ clips: [tmplClip('clip_001', 'tmpl_missing')] });
    expect(timelineExportBlockers(d)).toEqual([]);
  });
});
