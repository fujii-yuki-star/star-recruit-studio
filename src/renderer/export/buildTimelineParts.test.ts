// 区間ごとの組み立て（#1203）。**焼かずに実動画を流す**所と、**焼く**所の切り替えを固定する。
//
// ⚠️ **ここが甘いと「プレビューと違う動画」が出る**＝倒した区間は FFmpeg が重ねるので、
// 下に敷く絵の取り方・素材のどこから使うかがずれると、**そのまま焼き込まれる**。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../../domain/enums';
import type { TimelineClip, TimelineProject } from '../../domain/timeline/types';
import { TIMELINE_SCHEMA_VERSION } from '../../domain/timeline/types';

vi.mock('./rasterize', () => ({
  svgToPngDataUrl: vi.fn(async (svg: string) => `png:${svg}`),
}));

const { buildTimelineParts, buildVideoPart, framesDirForSegment } = await import('./buildTimelineParts');
const { svgToPngDataUrl } = await import('./rasterize');

const baseOpts = { templateOf: () => undefined, assetSrc: () => 'data:image/png;base64,A', fallbackCredit: 'VOICEVOX:ずんだもん' };

function slot(id: string, startSec: number, over: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id, kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001', startSec, durationSec: 2,
    x: 0, y: 0, w: 1920, h: 1080, assetId: 'asset_v', ...over,
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
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600, creditDisplay: { mode: 'hidden' } },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [{ assetId: 'asset_v', assetType: 'video', displayName: 'v.mp4', filePath: 'assets/v.mp4' }],
    tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }],
    clips,
    ...over,
  } as TimelineProject;
}

beforeEach(() => vi.mocked(svgToPngDataUrl).mockClear());

describe('framesDirForSegment', () => {
  // ⚠️ **区間ごとに分ける**＝同じ名前だと、後の区間が前の区間のコマを上書きする。
  it('区間ごとに違う名前になる', () => {
    const names = [0, 1, 2, 3].map(framesDirForSegment);
    expect(new Set(names).size).toBe(4);
  });

  it('英数字と `_` だけ（置き場の名前の決まりを通る）', () => {
    for (const n of [0, 1, 9, 100].map(framesDirForSegment)) expect(/^[A-Za-z0-9_]+$/.test(n)).toBe(true);
  });
});

describe('実動画をそのまま流す区間の組み立て', () => {
  it('素の動画なら組める（下に敷く絵は1枚だけ焼く）', async () => {
    const d = doc([slot('clip_001', 0)]);
    const part = await buildVideoPart(d, { kind: 'video', startSec: 0, endSec: 2, clipId: 'clip_001' }, baseOpts);
    expect(part?.video?.clipId).toBe('clip_001');
    expect(part?.durationSec).toBe(2);
    // ⚠️ **上の層も必ず出す**＝渡さないと Rust が断る（実機で見つけた＝`video without above png`）。
    expect(part?.video?.abovePngBase64, '上の層を出していない').toBeTruthy();
    expect(vi.mocked(svgToPngDataUrl).mock.calls, '焼くのは下と上の2枚だけ').toHaveLength(2);
  });

  // ⚠️ **下と上を取り違えない**＝取り違えると、**不透明な背景が動画の上に載って**動画が隠れる。
  it('下は不透明（背景あり）・上は透過（背景なし）', async () => {
    const part = await buildVideoPart(doc([slot('clip_001', 0)]), { kind: 'video', startSec: 0, endSec: 2, clipId: 'clip_001' }, baseOpts);
    // 差し替えた焼き係は `png:<svg>` を返すので、中身をそのまま見られる。
    expect(part?.video?.belowPngBase64, '下の層に背景が無い').toContain('<rect');
    expect(part?.video?.abovePngBase64, '上の層に背景が入っている（動画が隠れる）').not.toContain('<rect');
  });

  // ⚠️ **置き場所は分け方の結果から採る**＝取らないと、**画面の左上に寄った動画**が出る。
  it('動画の置き場所は、実際に描いた矩形と同じ', async () => {
    const d = doc([slot('clip_001', 0, { x: 120, y: 60, w: 800, h: 450 })]);
    const part = await buildVideoPart(d, { kind: 'video', startSec: 0, endSec: 2, clipId: 'clip_001' }, baseOpts);
    expect({ x: part?.video?.slotX, y: part?.video?.slotY, w: part?.video?.slotW, h: part?.video?.slotH })
      .toEqual({ x: 120, y: 60, w: 800, h: 450 });
  });

  // ⚠️ **下に敷く絵から、その部品は外す**＝外さないと**動画が二重に写る**
  //（静止画の上に同じ動画が重なる＝止まった絵が透けて見える）。
  it('下に敷く絵に、その部品は入っていない', async () => {
    const d = doc([slot('clip_001', 0)]);
    await buildVideoPart(d, { kind: 'video', startSec: 0, endSec: 2, clipId: 'clip_001' }, baseOpts);
    const svg = vi.mocked(svgToPngDataUrl).mock.calls[0]?.[0] as string;
    expect(svg).not.toContain('clip_001');
    expect(svg, '素材の絵まで敷いている').not.toContain('data:image/png;base64,A');
  });

  // ⚠️ **区間がクリップの途中で切れることがある**＝素材の頭から使うと、**別の場面が出る**。
  it('区間がクリップの途中から始まるとき、素材のその位置から使う', async () => {
    const d = doc([slot('clip_001', 0, { durationSec: 6, sourceStartSec: 10 })]);
    const part = await buildVideoPart(d, { kind: 'video', startSec: 2, endSec: 4, clipId: 'clip_001' }, baseOpts);
    expect(part?.video?.clipStartSec).toBeCloseTo(12, 6);
    expect(part?.video?.clipEndSec).toBeCloseTo(14, 6);
  });

  it('速さが付いていれば、素材の進み方もそのぶん', async () => {
    const d = doc([slot('clip_001', 0, { durationSec: 6, speed: 2 })]);
    const part = await buildVideoPart(d, { kind: 'video', startSec: 2, endSec: 4, clipId: 'clip_001' }, baseOpts);
    expect(part?.video?.clipStartSec).toBeCloseTo(4, 6);
    expect(part?.video?.clipEndSec).toBeCloseTo(8, 6);
    expect(part?.video?.speed).toBe(2);
  });

  // ⚠️ **中身が複数層のものは1枚の矩形へ写せない**＝組めなければ `undefined` を返し、呼ぶ側が焼く。
  it('中身が複数層のクリップは組まない（素材の id は持っていても）', async () => {
    const tmpl = {
      id: 'clip_009', kind: TIMELINE_CLIP_KIND.template, trackId: 'track_001', startSec: 0, durationSec: 2,
      x: 0, y: 0, w: 1920, h: 1080, templateId: 'tmpl_x', texts: { title: 'あ' },
      // ⚠️ **素材の id をわざと持たせる**＝持たせないと、**素材が無い**方の関門で先に弾かれ、
      // 「層が複数だから弾いた」を検査したつもりで**別の関門を検査していた**（実際にそうなっていた）。
      assetId: 'asset_v',
    } as unknown as TimelineClip;
    const template = {
      schemaVersion: '1.0', templateId: 'tmpl_x', name: 'x', category: 'photo_intro', aspectRatio: '16:9',
      canvas: { width: 1920, height: 1080 },
      layers: [
        // ⚠️ **先頭を「絵」にしておく**＝先頭が絵でないと、枚数を数えない変異が
        // 「次の関門（絵かどうか）」に隠れて**生き残る**（実際に生き残った）。
        { id: 'photo', type: 'slot', slotType: 'photo', x: 0, y: 0, w: 1920, h: 1080 },
        { id: 'title', type: 'text', textKey: 'title', x: 10, y: 10, w: 100, h: 50, fontSize: 40 },
      ],
    };
    const part = await buildVideoPart(
      doc([tmpl]),
      { kind: 'video', startSec: 0, endSec: 2, clipId: 'clip_009' },
      { ...baseOpts, templateOf: (id) => (id === 'tmpl_x' ? (template as never) : undefined) },
    );
    expect(part).toBeUndefined();
  });

  it('その部品が見つからなければ組まない', async () => {
    const part = await buildVideoPart(doc([slot('clip_001', 0)]), { kind: 'video', startSec: 0, endSec: 2, clipId: 'clip_404' }, baseOpts);
    expect(part).toBeUndefined();
  });
});

describe('区間を順に組み立てる', () => {
  it('動画だけの並びは、1枚も焼かない', async () => {
    const parts = await buildTimelineParts(doc([slot('clip_001', 0), slot('clip_002', 2)]), baseOpts);
    expect(parts).toHaveLength(2);
    expect(parts.every((p) => p.video != null)).toBe(true);
    expect(parts.every((p) => p.framesDir == null)).toBe(true);
  });

  // ⚠️ **組めなかった区間は焼く方へ倒す**＝倒せるはずだった所を**黙って通さない**。
  it('組めなかった区間は焼く', async () => {
    const d = doc([slot('clip_001', 0, { colorAdjust: { brightness: 1.4 } })]);
    const parts = await buildTimelineParts(d, { ...baseOpts, stageFrame: async () => {} });
    expect(parts).toHaveLength(1);
    expect(parts[0].video).toBeUndefined();
    expect(parts[0].framesDir).toBeTruthy();
  });

  it('つないだ長さが、元の尺と同じ', async () => {
    const d = doc([slot('clip_001', 0), slot('clip_002', 2, { rotation: 15 }), slot('clip_003', 4)]);
    const parts = await buildTimelineParts(d, { ...baseOpts, stageFrame: async () => {} });
    expect(parts.reduce((a, p) => a + p.durationSec, 0)).toBeCloseTo(6, 6);
  });

  // ⚠️ **進み具合は「全部で何枚焼くか」で数える**＝区間ごとに 0 から数え直すと、
  // バーが行ったり来たりする（倒せた区間は1枚も焼かないので、なおさら飛ぶ）。
  it('進み具合は、焼く総数に対して増えていく', async () => {
    const seen: { done: number; total: number }[] = [];
    const d = doc([
      slot('clip_001', 0, { rotation: 15 }),
      slot('clip_002', 2),
      slot('clip_003', 4, { rotation: 15 }),
    ]);
    await buildTimelineParts(d, { ...baseOpts, stageFrame: async () => {}, onProgress: (done, total) => seen.push({ done, total }) });
    expect(seen.every((x) => x.total === 120), '焼く総数がぶれている').toBe(true);
    const dones = seen.map((x) => x.done);
    expect(dones).toEqual([...dones].sort((a, b) => a - b));
    expect(dones[dones.length - 1]).toBe(120);
  });
});
