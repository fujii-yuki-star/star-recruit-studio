// 本体と描く窓が同じものを同じように描くための取り決め（ADR-0070）。
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../renderer/export/rasterize', () => ({
  svgToPngDataUrl: vi.fn(async (svg: string) => `png:${svg.length}`),
  svgToPngLater: vi.fn(async () => ({ bytes: Promise.resolve(new Uint8Array(1)) })),
}));

const { fnv1a, probeHash, sessionDrawOptions, sessionTemplateAssets } = await import('./renderSession');
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../../domain/enums';
import { TIMELINE_SCHEMA_VERSION } from '../../domain/timeline/types';
import type { TimelineClip, TimelineProject } from '../../domain/timeline/types';
import type { Template } from '../../domain/template/types';

const doc = (clips: TimelineClip[]): TimelineProject => ({
  schemaVersion: TIMELINE_SCHEMA_VERSION,
  format: PROJECT_FORMAT.timeline,
  projectId: 'proj_20261023_001',
  projectName: 't',
  createdAt: '2026-10-23T00:00:00.000Z',
  updatedAt: '2026-10-23T00:00:00.000Z',
  videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
  voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
  assets: [],
  tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }],
  clips,
}) as TimelineProject;

const text = (id: string, extra: Record<string, unknown> = {}): TimelineClip =>
  ({ id, kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: 2, x: 0, y: 0, w: 100, h: 40, text: 'あ', ...extra }) as TimelineClip;

const tpl = (templateId: string, assetId: string): Template => ({ templateId, layers: [{ id: 'bg', kind: 'image', assetId }] }) as unknown as Template;

describe('sessionTemplateAssets', () => {
  it('文書のどこに書かれた見た目パターンも拾い、その既定素材だけを渡す（ほかは渡さない）', () => {
    const d = doc([text('clip_001', { templateId: 'tpl_a' }), text('clip_002', { nested: { templateId: 'tpl_b' } })]);
    const r = sessionTemplateAssets(d, [tpl('tpl_a', 'tmpl_asset_1'), tpl('tpl_b', 'tmpl_asset_2'), tpl('tpl_c', 'tmpl_asset_3')], {
      tmpl_asset_1: 'data:1', tmpl_asset_2: 'data:2', tmpl_asset_3: 'data:3',
    });
    expect(r.templates.map((t) => t.templateId).sort()).toEqual(['tpl_a', 'tpl_b']);
    expect(r.templateAssetSrcById).toEqual({ tmpl_asset_1: 'data:1', tmpl_asset_2: 'data:2' });
  });
});

describe('sessionDrawOptions', () => {
  const session = { templates: [tpl('tpl_a', 'x')], assetSizes: { a: { w: 10, h: 20 } }, outputSize: { width: 1280, height: 720 }, fontFamily: 'F', fallbackCredit: 'C' };

  it('本体も窓も同じ材料（大きさ・字体・名乗り・実寸・パターン）になる', () => {
    const o = sessionDrawOptions(session, () => 'src');
    expect(o.outputSize).toEqual({ width: 1280, height: 720 });
    expect(o.fontFamily).toBe('F');
    expect(o.fallbackCredit).toBe('C');
    expect(o.assetSizeOf!('a')).toEqual({ w: 10, h: 20 });
    expect(o.templateOf('tpl_a')?.templateId).toBe('tpl_a');
  });

  it('窓では、受け取っていない見た目パターンを引いたら失敗にする（黙ってパターン無しで描かない）', () => {
    expect(sessionDrawOptions(session, () => undefined).templateOf('tpl_zzz')).toBeUndefined();
    expect(() => sessionDrawOptions(session, () => undefined, true).templateOf('tpl_zzz')).toThrow();
  });
});

describe('probeHash', () => {
  it('確かめの1コマは置き場へ置かない（本物のコマを上書きしない）', async () => {
    const stageFrame = vi.fn(async () => {});
    const stageFramePng = vi.fn(async () => {});
    const opts = { templateOf: () => undefined, assetSrc: () => undefined, fallbackCredit: '', stageFrame, stageFramePng } as never;
    const h = await probeHash(doc([text('clip_001')]), opts, 0);
    expect(h).toMatch(/:/);
    expect(stageFrame).not.toHaveBeenCalled();
    expect(stageFramePng).not.toHaveBeenCalled();
  });

  it('同じ文書・同じ材料なら同じ印、絵が違えば違う印', async () => {
    const opts = { templateOf: () => undefined, assetSrc: () => undefined, fallbackCredit: '' };
    const a = await probeHash(doc([text('clip_001')]), opts, 0);
    expect(await probeHash(doc([text('clip_001')]), opts, 0)).toBe(a);
    expect(await probeHash(doc([text('clip_001', { text: 'いいいいい' })]), opts, 0)).not.toBe(a);
  });
});

describe('fnv1a', () => {
  it('同じ文字列は同じ・1文字でも違えば違う', () => {
    expect(fnv1a('abc')).toBe(fnv1a('abc'));
    expect(fnv1a('abc')).not.toBe(fnv1a('abd'));
  });
});
