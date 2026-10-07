// 書き出しの区間割り（#1203・ADR-0032 決定22 の再検討）。
//
// ⚠️ **ここが甘いと「プレビューと違う動画」が出る**＝倒した区間は FFmpeg が重ねるので、
// SVG でしか描けないもの（色の調整・混ぜ方・回転・薄さ・切り抜き）は**消えます**。
// 条件を1つ緩めるたびに、**その条件の検査を1本足す**（この並びがその1本ずつ）。
import { describe, expect, it } from 'vitest';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import { TIMELINE_SCHEMA_VERSION } from './types';
import type { TimelineClip, TimelineProject } from './types';
import { TALK_BOUNCE_END_SEC } from './talkMotion';
import { bakeFrameTotal, clipIsPassThroughVideo, creditWindowCuts, passThroughRatio, planTimelineExportSegments } from './exportSegments';

const NO_ANIM = (): boolean => false;

function videoClip(over: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'clip_001',
    kind: TIMELINE_CLIP_KIND.slot,
    trackId: 'track_001',
    startSec: 0,
    durationSec: 6,
    x: 0,
    y: 0,
    w: 1920,
    h: 1080,
    assetId: 'asset_mov_001',
    ...over,
  } as TimelineClip;
}

function doc(clips: TimelineClip[], over: Partial<TimelineProject> = {}): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20260917_001',
    projectName: 'テスト',
    createdAt: '2026-09-17T00:00:00.000Z',
    updatedAt: '2026-09-17T00:00:00.000Z',
    // クレジットは出さない設定にしておく（出ている間は倒さない＝別の検査で見る）。
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600, creditDisplay: { mode: 'hidden' } },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [{ assetId: 'asset_mov_001', assetType: 'video', displayName: 'v.mp4', filePath: 'assets/v.mp4' }],
    tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }],
    clips,
    ...over,
  } as TimelineProject;
}

describe('そのまま流せる動画か（1つ緩めるたびに1本足す）', () => {
  it('素の動画クリップは倒せる', () => {
    expect(clipIsPassThroughVideo(videoClip(), NO_ANIM)).toBe(true);
  });

  it('文字クリップは倒せない（動画ではない）', () => {
    expect(clipIsPassThroughVideo(videoClip({ kind: TIMELINE_CLIP_KIND.text }), NO_ANIM)).toBe(false);
  });

  it('素材が入っていなければ倒せない', () => {
    expect(clipIsPassThroughVideo(videoClip({ assetId: undefined }), NO_ANIM)).toBe(false);
  });

  it('⚠️ 動きがあれば倒せない（FFmpeg は固定の位置でしか重ねられない）', () => {
    expect(clipIsPassThroughVideo(videoClip(), (id) => id === 'clip_001')).toBe(false);
  });

  it('⚠️ 回していたら倒せない', () => {
    expect(clipIsPassThroughVideo(videoClip({ rotation: 10 }), NO_ANIM)).toBe(false);
  });

  it('⚠️ 薄くしていたら倒せない', () => {
    expect(clipIsPassThroughVideo(videoClip({ opacity: 0.5 }), NO_ANIM)).toBe(false);
  });

  it('⚠️ フェードが付いていたら倒せない（合成の単位＝ADR-0032 決定19）', () => {
    expect(clipIsPassThroughVideo(videoClip({ fadeInSec: 0.5 }), NO_ANIM)).toBe(false);
    expect(clipIsPassThroughVideo(videoClip({ fadeOutSec: 0.5 }), NO_ANIM)).toBe(false);
  });

  it('⚠️ 切り抜いていたら倒せない', () => {
    expect(clipIsPassThroughVideo(videoClip({ crop: { top: 0.1 } }), NO_ANIM)).toBe(false);
    expect(clipIsPassThroughVideo(videoClip({ cropMode: 'fill' }), NO_ANIM)).toBe(false);
    expect(clipIsPassThroughVideo(videoClip({ cropAlign: { x: 'left' } }), NO_ANIM)).toBe(false);
  });

  // ⚠️ **ここを緩めると、いちばん見つけにくい形で割れる**＝プレビューには色が付き、
  // 書き出しには付かない（ADR-0044 追補1 で場面形式が踏んだのと同じ形）。
  it('⚠️ 色の調整・描画モードが付いていたら倒せない（ADR-0044）', () => {
    expect(clipIsPassThroughVideo(videoClip({ colorAdjust: { brightness: 1.2 } }), NO_ANIM)).toBe(false);
    expect(clipIsPassThroughVideo(videoClip({ blendMode: 'multiply' }), NO_ANIM)).toBe(false);
  });

  it('`normal` と 0 の切り抜きは「無し」と同じ（素の値で倒せなくならない）', () => {
    expect(clipIsPassThroughVideo(videoClip({ blendMode: 'normal', crop: { top: 0 } }), NO_ANIM)).toBe(true);
  });

  // ⚠️ **速さとトリムは倒せる**＝FFmpeg へそのまま渡せる欄がある（`speed` / `clipStartSec`）。
  it('速さとトリムは倒せる（渡せる欄がある）', () => {
    expect(clipIsPassThroughVideo(videoClip({ speed: 1.5, sourceStartSec: 12 }), NO_ANIM)).toBe(true);
  });
});

describe('区間に割る', () => {
  it('動画1つだけの並びは、全部そのまま流せる', () => {
    const d = doc([
      videoClip({ id: 'clip_001', startSec: 0, durationSec: 6 }),
      videoClip({ id: 'clip_002', startSec: 6, durationSec: 6 }),
    ]);
    const segs = planTimelineExportSegments(d);
    expect(segs).toEqual([
      { kind: 'video', startSec: 0, endSec: 6, clipId: 'clip_001' },
      { kind: 'video', startSec: 6, endSec: 12, clipId: 'clip_002' },
    ]);
    expect(passThroughRatio(segs)).toBe(1);
  });

  // ⚠️ **重なっていたら倒せない**＝層に割ると合成の単位を跨ぐ（決定22 の理由①）。
  it('重なっている所は焼く', () => {
    const d = doc([
      videoClip({ id: 'clip_001', startSec: 0, durationSec: 6 }),
      videoClip({ id: 'clip_002', trackId: 'track_002', startSec: 3, durationSec: 6 }),
    ], { tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.visual }] });
    const segs = planTimelineExportSegments(d);
    expect(segs).toEqual([
      { kind: 'video', startSec: 0, endSec: 3, clipId: 'clip_001' },
      { kind: 'frames', startSec: 3, endSec: 6 },
      { kind: 'video', startSec: 6, endSec: 9, clipId: 'clip_002' },
    ]);
  });

  // ⚠️ **動かない文字なら倒せる**（ADR-0032 決定22-2 追補・#1205）＝区間の中では顔ぶれが変わらないので、
  // **上に重ねる静止画を1枚**焼けば足りる。⚠️ **実況系はほぼ常に字幕が出ている**ので、
  // ここが倒せないと **30分で1.5時間・一時ファイル50GB超**（実測から計算）になる。
  it('動かない文字が重なっていても倒す（上に1枚焼けば足りる）', () => {
    const d = doc([
      videoClip({ id: 'clip_001', startSec: 0, durationSec: 6 }),
      { id: 'clip_002', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_002', startSec: 2, durationSec: 2,
        x: 0, y: 0, w: 800, h: 100, text: 'あ' } as TimelineClip,
    ], { tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.visual }] });
    expect(planTimelineExportSegments(d).map((s) => s.kind)).toEqual(['video', 'video', 'video']);
  });

  // ⚠️ **動く文字は倒せない**＝1枚の静止画に写せない（キーフレーム）。
  it('動く文字が重なっている所は焼く', () => {
    const d = doc([
      videoClip({ id: 'clip_001', startSec: 0, durationSec: 6 }),
      { id: 'clip_002', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_002', startSec: 2, durationSec: 2,
        x: 0, y: 0, w: 800, h: 100, text: 'あ' } as TimelineClip,
    ], {
      tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.visual }],
      animations: [{ id: 'anim_001', targetId: 'clip_002', keyframes: [{ timeSec: 0, x: 0 }] }],
    } as Partial<TimelineProject>);
    expect(planTimelineExportSegments(d).map((s) => s.kind)).toEqual(['video', 'frames', 'video']);
  });

  // ⚠️ **薄くなっていく文字も倒せない**＝フェードは時間で変わる。
  it('フェードの付いた文字が重なっている所は焼く', () => {
    const d = doc([
      videoClip({ id: 'clip_001', startSec: 0, durationSec: 6 }),
      { id: 'clip_002', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_002', startSec: 2, durationSec: 2,
        x: 0, y: 0, w: 800, h: 100, text: 'あ', fadeInSec: 0.5 } as TimelineClip,
    ], { tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.visual }] });
    expect(planTimelineExportSegments(d).map((s) => s.kind)).toEqual(['video', 'frames', 'video']);
  });

  // ⚠️ **混ぜ方の付いた上乗せは倒せない**＝重ねるのは FFmpeg なので、**混ざり方が消える**（ADR-0044）。
  it('混ぜ方の付いた文字が重なっている所は焼く', () => {
    const d = doc([
      videoClip({ id: 'clip_001', startSec: 0, durationSec: 6 }),
      { id: 'clip_002', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_002', startSec: 2, durationSec: 2,
        x: 0, y: 0, w: 800, h: 100, text: 'あ', blendMode: 'screen' } as TimelineClip,
    ], { tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.visual }] });
    expect(planTimelineExportSegments(d).map((s) => s.kind)).toEqual(['video', 'frames', 'video']);
  });

  // ⚠️ **上乗せが動画なら倒せない**＝中身が毎コマ変わるので、1枚の静止画に写せない
  //（回した小窓の動画を重ねる形＝土台は1つに決まるが、上乗せは静止画にできない）。
  it('回した動画が上に重なっている所は焼く（上乗せが動画）', () => {
    const d = doc([
      videoClip({ id: 'clip_001', startSec: 0, durationSec: 6 }),
      videoClip({ id: 'clip_002', trackId: 'track_002', startSec: 2, durationSec: 2, rotation: 15 }),
    ], { tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.visual }] });
    expect(planTimelineExportSegments(d).map((s) => s.kind)).toEqual(['video', 'frames', 'video']);
  });

  // ⚠️ **動画が2つ重なっていたら倒せない**＝土台が決まらない（層に割ることになる＝決定22 の理由①）。
  it('動画が2つ重なっている所は焼く', () => {
    const d = doc([
      videoClip({ id: 'clip_001', startSec: 0, durationSec: 6 }),
      videoClip({ id: 'clip_002', trackId: 'track_002', startSec: 3, durationSec: 6 }),
    ], { tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.visual }] });
    expect(planTimelineExportSegments(d).map((s) => s.kind)).toEqual(['video', 'frames', 'video']);
  });
  // ⚠️ **音の列は絵に出ない**＝倒せるかどうかに関係しない（関係させると、声を入れた瞬間に効かなくなる）。
  it('音の部品は区間の判定に混ぜない', () => {
    const d = doc([
      videoClip({ id: 'clip_001', startSec: 0, durationSec: 6 }),
      { id: 'clip_009', kind: TIMELINE_CLIP_KIND.audio, trackId: 'track_009', startSec: 0, durationSec: 6,
        assetId: 'asset_mov_001' } as TimelineClip,
    ], { tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_009', kind: TRACK_KIND.audio }] });
    expect(passThroughRatio(planTimelineExportSegments(d))).toBe(1);
  });

  // ⚠️ **隠した部品そのものも絵に出ない**（列ではなく部品の側の印）。
  it('隠した部品も混ぜない', () => {
    const d = doc([
      videoClip({ id: 'clip_001', startSec: 0, durationSec: 6 }),
      videoClip({ id: 'clip_002', trackId: 'track_002', startSec: 0, durationSec: 6, hidden: true }),
    ], { tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.visual }] });
    expect(passThroughRatio(planTimelineExportSegments(d))).toBe(1);
  });

  it('隠した列の部品も混ぜない', () => {
    const d = doc([
      videoClip({ id: 'clip_001', startSec: 0, durationSec: 6 }),
      videoClip({ id: 'clip_002', trackId: 'track_002', startSec: 0, durationSec: 6 }),
    ], { tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.visual, hidden: true }] });
    expect(passThroughRatio(planTimelineExportSegments(d))).toBe(1);
  });

  // ⚠️ **グループごと隠した部品も混ぜない**（PR #1210 レビュー 🟡）＝混ぜると、
  // その部品に付いた動きやフェードのせいで**本来倒せる区間まで焼く方へ倒れる**（遅くなるだけで絵は正しい
  // ＝**気づきにくい**）。判定は共有の `isDrawnClip`（`domain/timeline/video.ts`）を通すこと。
  it('グループごと隠した部品も混ぜない', () => {
    const d = doc([
      videoClip({ id: 'clip_001', startSec: 0, durationSec: 6 }),
      { id: 'clip_009', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_002', startSec: 0, durationSec: 6, text: 'あ', fadeInSec: 1 } as TimelineClip,
    ], {
      tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.visual }],
      groups: [{ id: 'group_001', members: ['clip_009'], hidden: true, transform: { x: 0, y: 0, rotation: 0, scale: 1 } }],
    } as Partial<TimelineProject>);
    expect(passThroughRatio(planTimelineExportSegments(d)), '隠れている文字のフェードで焼く方へ倒れた').toBe(1);
  });

  // ⚠️ **クレジットは上に載る**（ADR-0025）＝出ている間は静止1枚で足りない。
  // ⚠️ **出ている窓だけを焼く**（#352 の45分実測）＝窓の端で割らないと、頭の3秒のために全区間を焼いていた。
  it('クレジットが出ている間だけ焼く（窓の端で割る・最後に出るコマまで焼く）', () => {
    const d = doc([videoClip({ id: 'clip_001', startSec: 0, durationSec: 10 })], {
      videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600,
        creditDisplay: { mode: 'head', seconds: 3 } },
    } as Partial<TimelineProject>);
    // 窓は閉じた区間＝3.000 秒のコマ（90）にも出る → 91 コマ目から流せる
    expect(planTimelineExportSegments(d)).toEqual([
      { kind: 'frames', startSec: 0, endSec: 91 / 30 },
      { kind: 'video', startSec: 91 / 30, endSec: 10, clipId: 'clip_001' },
    ]);
  });

  it('既定（最初と最後）でも、長い動画＋字幕は頭と尻の窓だけを焼く', () => {
    const d = doc([
      videoClip({ id: 'clip_001', startSec: 0, durationSec: 600 }),
      { id: 'clip_002', kind: TIMELINE_CLIP_KIND.subtitle, trackId: 'track_002', startSec: 0, durationSec: 600,
        x: 0, y: 900, w: 1600, h: 120, text: '字幕' } as TimelineClip,
    ], {
      tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.visual }],
      videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    } as Partial<TimelineProject>);
    const segs = planTimelineExportSegments(d);
    expect(segs.map((s) => s.kind)).toEqual(['frames', 'video', 'frames']);
    expect(segs[0].endSec).toBeCloseTo(91 / 30, 9);
    expect(segs[2].startSec).toBeCloseTo(597, 9); // 尻の窓は 597 秒のコマから（閉じた区間）
    expect(passThroughRatio(segs)).toBeGreaterThan(0.98);
  });

  it('ずっと表示・非表示は割らない（見え方が変わらない）', () => {
    expect(creditWindowCuts({ mode: 'always' }, 600, 30)).toEqual([]);
    expect(creditWindowCuts({ mode: 'hidden' }, 600, 30)).toEqual([]);
    expect(creditWindowCuts({ mode: 'tail', seconds: 3 }, 600, 30)).toEqual([17910]);
    expect(creditWindowCuts(undefined, 600, 30)).toEqual([91, 17910]);
    // 尺が窓より短いときは全部に出る＝割らない
    expect(creditWindowCuts({ mode: 'both', seconds: 3 }, 2, 30)).toEqual([]);
  });

  // ⚠️ **グループに付いた動きも見る**＝中の部品に直接付いていなくても動く。
  it('グループが動いていたら、中の部品も焼く', () => {
    const d = doc([videoClip({ id: 'clip_001', startSec: 0, durationSec: 6 })], {
      groups: [{ id: 'group_001', members: ['clip_001'] }],
      animations: [{ id: 'anim_001', targetId: 'group_001', keyframes: [{ timeSec: 0, x: 0 }] }],
    } as Partial<TimelineProject>);
    expect(planTimelineExportSegments(d).map((s) => s.kind)).toEqual(['frames']);
  });

  it('続いている「焼く」区間はまとめる（つなぎ目を増やさない）', () => {
    const d = doc([
      { id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: 3,
        x: 0, y: 0, w: 100, h: 50, text: 'あ' } as TimelineClip,
      { id: 'clip_002', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 3, durationSec: 3,
        x: 0, y: 0, w: 100, h: 50, text: 'い' } as TimelineClip,
    ], {
      // どちらも動く＝焼く区間（動かない文字だけなら1コマで流す＝追補3）。
      animations: [
        { id: 'anim_001', targetId: 'clip_001', keyframes: [{ timeSec: 0, x: 0 }, { timeSec: 3, x: 100 }] },
        { id: 'anim_002', targetId: 'clip_002', keyframes: [{ timeSec: 0, x: 0 }, { timeSec: 3, x: 100 }] },
      ],
    });
    expect(planTimelineExportSegments(d)).toEqual([{ kind: 'frames', startSec: 0, endSec: 6 }]);
  });

  it('何も無ければ区間も無い', () => {
    expect(planTimelineExportSegments(doc([]))).toEqual([]);
  });

  // ⚠️ **境目はコマの格子に乗る**＝乗らないと、つないだ総コマ数が元と食い違う。
  it('境目がコマの格子に乗る', () => {
    const d = doc([
      videoClip({ id: 'clip_001', startSec: 0, durationSec: 2.017 }),
      videoClip({ id: 'clip_002', startSec: 2.017, durationSec: 2 }),
    ]);
    for (const s of planTimelineExportSegments(d)) {
      expect(Number.isInteger(Math.round(s.startSec * 30))).toBe(true);
      expect(Math.abs(s.startSec * 30 - Math.round(s.startSec * 30))).toBeLessThan(1e-9);
      expect(Math.abs(s.endSec * 30 - Math.round(s.endSec * 30))).toBeLessThan(1e-9);
    }
  });
});

describe('倒せた割合', () => {
  it('区間が無ければ 0（0 で割らない）', () => {
    expect(passThroughRatio([])).toBe(0);
  });

  it('半分倒せていれば 0.5', () => {
    expect(passThroughRatio([
      { kind: 'video', startSec: 0, endSec: 5, clipId: 'clip_001' },
      { kind: 'frames', startSec: 5, endSec: 10 },
    ])).toBe(0.5);
  });
});

// ADR-0032 決定22-2 追補3（#1376）：何も時間で変わらない区間は1コマで流す。
describe('何も時間で変わらない区間は1コマ（#1376）', () => {
  const text = (id: string, startSec: number, durationSec: number, over: Partial<TimelineClip> = {}): TimelineClip =>
    ({ id, kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec, durationSec, x: 0, y: 0, w: 100, h: 50, text: 'あ', ...over }) as TimelineClip;

  it('動かない文字だけの区間は1コマ（出入りごとに別の1コマ＝まとめない）', () => {
    const d = doc([text('clip_001', 0, 3), text('clip_002', 3, 3)]);
    expect(planTimelineExportSegments(d)).toEqual([
      { kind: 'still', startSec: 0, endSec: 3 },
      { kind: 'still', startSec: 3, endSec: 6 },
    ]);
  });

  it('回転・薄さ・色の調整は1コマのまま（時間で変わらない）', () => {
    const d = doc([text('clip_001', 0, 3, { rotation: 30, opacity: 0.5, colorAdjust: { brightness: 0.2 } })]);
    expect(planTimelineExportSegments(d)).toEqual([{ kind: 'still', startSec: 0, endSec: 3 }]);
  });

  it('動き・フェードがあれば毎コマ', () => {
    const anim = doc([text('clip_001', 0, 3)], { animations: [{ id: 'anim_001', targetId: 'clip_001', keyframes: [{ timeSec: 0, x: 0 }, { timeSec: 3, x: 9 }] }] });
    expect(planTimelineExportSegments(anim)).toEqual([{ kind: 'frames', startSec: 0, endSec: 3 }]);
    const fade = doc([text('clip_001', 0, 3, { fadeInSec: 0.5 })]);
    expect(planTimelineExportSegments(fade)).toEqual([{ kind: 'frames', startSec: 0, endSec: 3 }]);
  });

  it('描画モードが付いた部品のある区間は、いまは毎コマ（狭く始める）', () => {
    const d = doc([text('clip_001', 0, 3, { blendMode: 'multiply' })]);
    expect(planTimelineExportSegments(d)).toEqual([{ kind: 'frames', startSec: 0, endSec: 3 }]);
  });

  it('クレジットが出ている区間は毎コマ', () => {
    const d = doc([text('clip_001', 0, 6)], {
      videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600, creditDisplay: { mode: 'head', seconds: 2 } },
    } as Partial<TimelineProject>);
    const segs = planTimelineExportSegments(d);
    expect(segs[0].kind).toBe('frames');
    expect(segs[segs.length - 1]).toEqual({ kind: 'still', startSec: segs[segs.length - 1].startSec, endSec: 6 });
  });

  it('動画が映っている区間は1コマにしない', () => {
    const d = doc([videoClip({ durationSec: 3, rotation: 10 })]);
    expect(planTimelineExportSegments(d)).toEqual([{ kind: 'frames', startSec: 0, endSec: 3 }]);
  });

  // ⚠️ 割り目は「その時刻から映る最初のコマ」＝切り上げ。四捨五入だと 5.635 秒の字幕が 169 コマ目（5.633 秒＝まだ映らない）
  //   で割られ、1コマで流す区間を字幕の無い絵で描いた（作例の漫才で実際に起きた）。
  it('割り目は、その部品が初めて映るコマ（切り上げ）', () => {
    const d = doc([text('clip_001', 0, 5.635), text('clip_002', 5.635, 2.365)]);
    expect(planTimelineExportSegments(d)).toEqual([
      { kind: 'still', startSec: 0, endSec: 170 / 30 },
      { kind: 'still', startSec: 170 / 30, endSec: 8 },
    ]);
  });

  it('焼くコマ数は1コマの区間を1と数える', () => {
    const d = doc([text('clip_001', 0, 3), text('clip_002', 3, 3)]);
    expect(bakeFrameTotal(planTimelineExportSegments(d), 30)).toBe(2);
  });

  // 喋っている間の動き（ADR-0056）＝結んだ声が鳴っている区間だけ動く。
  describe('喋っている間の動き', () => {
    const tracks = [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.audio }];
    const voice = (id: string, startSec: number, durationSec: number): TimelineClip =>
      ({ id, kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_002', startSec, durationSec, voice: { text: 'あ', status: 'none' } }) as TimelineClip;
    const talker = text('clip_001', 0, 4, { talkMotion: { trackId: 'track_002', kind: 'bob' } });

    it('ゆらゆらは声が鳴っている区間だけ毎コマ・割り目は動き始める最初のコマ（切り上げ）', () => {
      // 声は 1.02〜2.013 秒 → 割り目は 31 コマ目（1.0333 秒＝最初に動くコマ）と 61 コマ目（2.0333 秒＝最初に止まるコマ）。
      // ⚠️ 切り捨て・四捨五入だと 30／60 になる（種類は重なりで決めるので絵は正しいが、毎コマの区間が広がる）。
      const d = doc([talker, voice('clip_002', 1.02, 0.993)], { tracks } as Partial<TimelineProject>);
      expect(planTimelineExportSegments(d)).toEqual([
        { kind: 'still', startSec: 0, endSec: 31 / 30 },
        { kind: 'frames', startSec: 31 / 30, endSec: 61 / 30 },
        { kind: 'still', startSec: 61 / 30, endSec: 4 },
      ]);
    });

    // はねるは声の頭の TALK_BOUNCE_END_SEC 秒だけ動く＝声の残りは1コマ（作例の漫才はこれで縮む）。
    it('はねるは声の頭だけ毎コマ', () => {
      const bouncer = text('clip_001', 0, 4, { talkMotion: { trackId: 'track_002', kind: 'bounce' } });
      const d = doc([bouncer, voice('clip_002', 1, 2)], { tracks } as Partial<TimelineProject>);
      const endFrame = Math.ceil((1 + TALK_BOUNCE_END_SEC) * 30);
      expect(planTimelineExportSegments(d)).toEqual([
        { kind: 'still', startSec: 0, endSec: 1 },
        { kind: 'frames', startSec: 1, endSec: endFrame / 30 },
        { kind: 'still', startSec: endFrame / 30, endSec: 4 },
      ]);
    });

    it('はねるでも声が短ければ声の終わりまで', () => {
      const bouncer = text('clip_001', 0, 4, { talkMotion: { trackId: 'track_002', kind: 'bounce' } });
      const d = doc([bouncer, voice('clip_002', 1, 0.1)], { tracks } as Partial<TimelineProject>);
      const segs = planTimelineExportSegments(d);
      expect(segs[1]).toEqual({ kind: 'frames', startSec: 1, endSec: 33 / 30 });
    });

    it('結んだ列を隠していれば動かない＝全部1コマ', () => {
      const hidden = [tracks[0], { ...tracks[1], hidden: true }];
      const d = doc([talker, voice('clip_002', 1, 1)], { tracks: hidden } as Partial<TimelineProject>);
      expect(planTimelineExportSegments(d).every((s) => s.kind === 'still')).toBe(true);
    });

    it('隠した声では動かない', () => {
      const d = doc([talker, { ...voice('clip_002', 1, 1), hidden: true } as TimelineClip], { tracks } as Partial<TimelineProject>);
      expect(planTimelineExportSegments(d).every((s) => s.kind === 'still')).toBe(true);
    });
  });
});
