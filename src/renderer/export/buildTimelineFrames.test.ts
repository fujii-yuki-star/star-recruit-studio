// タイムライン形式の全フレーム描画（ADR-0032 決定22・#631）。
// ラスタライズ（canvas）は環境依存なので差し替え、**何を・どの時刻で・何枚描くか**を固定する。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../../domain/enums';
import { FPS } from '../../domain/constants';
import type { TimelineClip, TimelineProject } from '../../domain/timeline/types';
import type { Template } from '../../domain/template/types';
import { TIMELINE_SCHEMA_VERSION } from '../../domain/timeline/types';

vi.mock('./rasterize', () => ({
  svgToPngDataUrl: vi.fn(async (svg: string) => `png:${svg}`),
}));

const { buildTimelineFrames, TIMELINE_FRAMES_DIR } = await import('./buildTimelineFrames');
const { svgToPngDataUrl } = await import('./rasterize');

function textClip(id: string, over: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id,
    kind: TIMELINE_CLIP_KIND.text,
    trackId: 'track_001',
    startSec: 0,
    durationSec: 1,
    x: 100,
    y: 100,
    w: 400,
    h: 80,
    text: 'あ',
    ...over,
  };
}

function voiceClip(id: string, speaker: number, over: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id,
    kind: TIMELINE_CLIP_KIND.voice,
    trackId: 'track_002',
    startSec: 0,
    durationSec: 1,
    voice: { text: 'あ', status: 'generated', voicePath: `voices/${id}.wav`, speaker },
    ...over,
  };
}

function doc(over: Partial<TimelineProject> = {}): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20260729_001',
    projectName: 'テスト',
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
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

const baseOpts = { templateOf: () => undefined, assetSrc: () => undefined, fallbackCredit: 'VOICEVOX:ずんだもん' };

beforeEach(() => {
  vi.mocked(svgToPngDataUrl).mockClear();
});

describe('buildTimelineFrames', () => {
  it('置いた写真が実際に絵として焼かれる（#716＝解いた src が SVG まで届く）', async () => {
    // 立ち絵を落として動画から消えた（#716 レビュー）のと同型＝**運ぶ経路のどこかが切れると絵だけ消える**。
    // 渡した src が `<image>` の中身になるところまでを通しで見る。
    const slot = {
      id: 'clip_001', kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001', startSec: 0, durationSec: 1,
      x: 0, y: 0, w: 1920, h: 1080, assetId: 'asset_001',
    } as unknown as TimelineClip;
    await buildTimelineFrames(doc({ clips: [slot] }), {
      ...baseOpts,
      assetSrc: (id) => (id === 'asset_001' ? 'data:image/png;base64,PHOTO' : undefined),
    });
    const svg = vi.mocked(svgToPngDataUrl).mock.calls[0][0];
    expect(svg).toContain('data:image/png;base64,PHOTO');
    expect(svg).toContain('<image');
  });

  it('尺ぶんのフレームを描き、書き出しに渡す形で返す', async () => {
    const r = await buildTimelineFrames(doc({ clips: [textClip('clip_001', { durationSec: 1 })] }), baseOpts);
    expect(r.fps).toBe(FPS);
    expect(r.durationSec).toBeCloseTo(1);
    expect(r.framesBase64).toHaveLength(30);
    expect(vi.mocked(svgToPngDataUrl)).toHaveBeenCalledTimes(30);
  });

  /**
   * クレジットの見せ方（ADR-0025・#359）。
   *
   * ⚠️ **タイムライン形式は毎フレーム描くので秒どおり**＝場面形式（場面ごとにしか切り替えられない）
   * とはずれ方が違う。この違いは `15 §3` に書いてある。
   */
  it('「最初と最後」なら、真ん中のコマにはクレジットを描かない（#359）', async () => {
    const d = doc({ clips: [textClip('clip_001', { durationSec: 10 })] });
    await buildTimelineFrames(
      { ...d, videoSettings: { ...d.videoSettings, creditDisplay: { mode: 'both', seconds: 1 } } },
      baseOpts,
    );
    const svgs = vi.mocked(svgToPngDataUrl).mock.calls.map((c) => c[0]);
    expect(svgs[0]).toContain('VOICEVOX');                       // 先頭
    expect(svgs[Math.floor(svgs.length / 2)]).not.toContain('VOICEVOX'); // 真ん中
    expect(svgs[svgs.length - 1]).toContain('VOICEVOX');          // 末尾
  });

  it('「動画には出さない」ならどのコマにも描かない（#359）', async () => {
    const d = doc({ clips: [textClip('clip_001', { durationSec: 1 })] });
    await buildTimelineFrames(
      { ...d, videoSettings: { ...d.videoSettings, creditDisplay: { mode: 'hidden' } } },
      baseOpts,
    );
    for (const c of vi.mocked(svgToPngDataUrl).mock.calls) expect(c[0]).not.toContain('VOICEVOX');
  });

  // ⚠️ **設定していない動画の見え方を変えない**（既定＝最初と最後・3秒）。
  it('設定していなければ従来どおり描く（#359）', async () => {
    await buildTimelineFrames(doc({ clips: [textClip('clip_001', { durationSec: 1 })] }), baseOpts);
    expect(vi.mocked(svgToPngDataUrl).mock.calls[0][0]).toContain('VOICEVOX');
  });

  it('実寸で焼く（プレビューの表示サイズではなく出力の大きさ）', async () => {
    await buildTimelineFrames(doc({ clips: [textClip('clip_001', { durationSec: 0.1 })] }), baseOpts);
    expect(vi.mocked(svgToPngDataUrl).mock.calls[0].slice(1)).toEqual([1920, 1080]);
  });

  it('出力の大きさを指定できる', async () => {
    await buildTimelineFrames(doc({ clips: [textClip('clip_001', { durationSec: 0.1 })] }), {
      ...baseOpts,
      outputSize: { width: 1280, height: 720 },
    });
    expect(vi.mocked(svgToPngDataUrl).mock.calls[0].slice(1)).toEqual([1280, 720]);
  });

  it('置ける先があればディスクへ逃がす（数千フレームを配列に溜めない）', async () => {
    const staged: number[] = [];
    const r = await buildTimelineFrames(doc({ clips: [textClip('clip_001', { durationSec: 0.2 })] }), {
      ...baseOpts,
      stageFrame: async (_dir, i) => {
        staged.push(i);
      },
    });
    expect(r.framesDir).toBe(TIMELINE_FRAMES_DIR);
    expect(r.framesBase64).toBeUndefined();
    expect(staged).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('フレームごとに違う時刻を描く（動くものが止まって見えない）', async () => {
    // 前半と後半で別の文字を置く＝時刻を見ていなければ全フレーム同じ絵になる。
    const d = doc({
      clips: [textClip('clip_001', { durationSec: 0.5 }), textClip('clip_002', { startSec: 0.5, durationSec: 0.5, trackId: 'track_003', text: 'い' })],
      tracks: [
        { id: 'track_001', kind: TRACK_KIND.visual },
        { id: 'track_003', kind: TRACK_KIND.visual },
        { id: 'track_002', kind: TRACK_KIND.audio },
      ],
    });
    const r = await buildTimelineFrames(d, baseOpts);
    expect(new Set(r.framesBase64).size).toBeGreaterThan(1);
  });

  it('しゃべっている声のキャラをクレジットに焼き込む（場面形式の掛け合いと同じ挙動）', async () => {
    const d = doc({
      clips: [textClip('clip_001', { durationSec: 1 }), voiceClip('clip_002', 2, { startSec: 0.5, durationSec: 0.5 })],
    });
    await buildTimelineFrames(d, baseOpts);
    const svgs = vi.mocked(svgToPngDataUrl).mock.calls.map((c) => c[0]);
    expect(svgs[0]).toContain('VOICEVOX:ずんだもん'); // 誰もしゃべっていない＝既定の声
    expect(svgs[20]).toContain('VOICEVOX:四国めたん'); // speaker=2＝四国めたん（既定のずんだもんと別のキャラ）
  });

  it('中止したらそこで止める（長い動画でも押した中止が効く）', async () => {
    let drawn = 0;
    await expect(
      buildTimelineFrames(doc({ clips: [textClip('clip_001', { durationSec: 10 })] }), {
        ...baseOpts,
        shouldCancel: () => drawn >= 5,
        onProgress: () => undefined,
        stageFrame: async () => {
          drawn += 1;
        },
      }),
    ).rejects.toThrow();
    expect(drawn).toBe(5); // 300 枚描き切らない
  });

  it('進み具合を知らせる（最後は必ず全部ぶん）', async () => {
    const seen: [number, number][] = [];
    await buildTimelineFrames(doc({ clips: [textClip('clip_001', { durationSec: 0.5 })] }), {
      ...baseOpts,
      onProgress: (done, total) => seen.push([done, total]),
    });
    expect(seen[seen.length - 1]).toEqual([15, 15]);
  });
});

// #512 段1＝**動画は実フレームを差し込む**。素材 id ではなく**部品ごと**に差し替えるので、
// 同じ動画を別の時刻へ2つ置いても**それぞれのコマ**が出る。
describe('動画の実フレーム（#512 段1）', () => {
  const videoDoc = (): TimelineProject =>
    doc({
      assets: [{ assetId: 'asset_v', assetType: 'video', displayName: '動画', filePath: 'v.mp4' }],
      clips: [
        { id: 'clip_a', kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001', startSec: 0, durationSec: 1, x: 0, y: 0, w: 100, h: 100, assetId: 'asset_v' } as TimelineClip,
        { id: 'clip_b', kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_002', startSec: 0, durationSec: 1, x: 200, y: 0, w: 100, h: 100, assetId: 'asset_v', sourceStartSec: 5 } as TimelineClip,
      ],
      tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.visual }],
    });

  it('部品ごとに別のコマ列へ焼き出し、フレームごとに差し替える', async () => {
    const staged: string[] = [];
    await buildTimelineFrames(videoDoc(), {
      templateOf: () => undefined,
      assetSrc: () => 'data:image/png;base64,SRC',
      fallbackCredit: 'クレジット',
      stageVideo: async (v) => { staged.push(`${v.clipId}@${v.sourceStartSec}->${v.dirName}`); return 30; },
      readVideoFrame: async (dirName, frameIndex) => `data:frame:${dirName}#${frameIndex}`,
    });
    // ⚠️ **トリムを渡す**＋**置き場を部品ごとに分ける**（同じ動画を2つ置いても混ざらない）。
    expect(staged).toEqual([
      'clip_a@0->timeline_frames_v_clip_a',
      'clip_b@5->timeline_frames_v_clip_b',
    ]);
    // 1フレーム目の SVG に、**それぞれの部品のコマ**が入っている（素材の src ではない）。
    // ⚠️ **それぞれのコマが別々に入っている**ことまで見る（レビュー指摘）＝1件目を両方へ返す
    // 取り違えでも `data:frame:` は含まれてしまい、変異が生き残る。
    const first = vi.mocked(svgToPngDataUrl).mock.calls[0][0];
    expect(first).toContain('timeline_frames_v_clip_a#0');
    expect(first).toContain('timeline_frames_v_clip_b#0');
    expect(first).not.toContain('base64,SRC');
  });

  // ⚠️ **1つの部品に差し込み口ぶんの動画がありうる**（#512 段3）＝置き場所ごとに別のコマ列へ焼き、
  // **その枠のアイテムだけ**差し替える。部品 id で差し替えると、隣の枠まで同じコマで塗ってしまう。
  it('差し込み口ごとに別のコマ列へ焼き出し、その枠だけ差し替える', async () => {
    const template = {
      schemaVersion: '1.0', templateId: 'tmpl_001', name: 'テンプレ', category: 'photo_intro',
      aspectRatio: '16:9', canvas: { width: 1920, height: 1080 },
      layers: [
        { id: 'left', type: 'slot', x: 0, y: 0, w: 960, h: 1080 },
        { id: 'right', type: 'slot', x: 960, y: 0, w: 960, h: 1080 },
      ],
    } as unknown as Template;
    const d = doc({
      assets: [
        { assetId: 'asset_v', assetType: 'video', displayName: '動画', filePath: 'v.mp4' },
        { assetId: 'asset_p', assetType: 'image', displayName: '写真', filePath: 'p.png' },
      ],
      clips: [{
        id: 'clip_t', kind: TIMELINE_CLIP_KIND.template, trackId: 'track_001',
        startSec: 0, durationSec: 1, templateId: 'tmpl_001',
        assetRefs: { left: 'asset_v', right: 'asset_p' },
      } as TimelineClip],
    });
    const staged: string[] = [];
    await buildTimelineFrames(d, {
      templateOf: () => template,
      assetSrc: () => 'data:image/png;base64,SRC',
      fallbackCredit: 'クレジット',
      stageVideo: async (v) => { staged.push(`${v.assetId}->${v.dirName}`); return 30; },
      readVideoFrame: async (dirName, frameIndex) => `data:frame:${dirName}#${frameIndex}`,
    });
    // 動画の枠だけ焼き出す（写真の枠は焼かない）。
    expect(staged).toEqual(['asset_v->timeline_frames_v_clip_t_left']);
    const first = vi.mocked(svgToPngDataUrl).mock.calls[0][0];
    expect(first).toContain('timeline_frames_v_clip_t_left#0'); // 動画の枠は実フレーム
    expect(first).toContain('base64,SRC'); // ⚠️ 写真の枠はそのまま（コマで塗り潰さない）
  });

  // ⚠️ **焼き出す口を渡さないと灰色の枠が焼き込まれる**（レビュー 🟡＝以前は「静止のまま」と書いていたが、
  // 直置き動画は静止画〔代表フレーム〕を要求しないので `assetSrc` でも解けない＝**成り立たない安全性**を
  // 固定していた）。落ちはしないが**絵は出ない**＝書き出しの入口は必ず両方を渡すこと。
  it('焼き出す口が無ければ灰色の枠になる（黙って良い絵にはならない）', async () => {
    const r = await buildTimelineFrames(videoDoc(), {
      templateOf: () => undefined,
      // 本番と同じ＝直置き動画の id は解けない（`timelineImageAssetIds` から外れている）。
      assetSrc: () => undefined,
      fallbackCredit: 'クレジット',
    });
    expect(r.fps).toBe(FPS);
    const first = vi.mocked(svgToPngDataUrl).mock.calls[0][0];
    expect(first).not.toContain('data:frame:'); // 実フレームは入らない
  });
});
