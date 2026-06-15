import { describe, expect, it, vi } from 'vitest';

// canvas(ADR-0004) は Node テスト環境に無いため描画系をスタブ化し、音声付与の分岐のみを検証する。
vi.mock('../layout', () => ({ layoutScene: () => ({}) }));
vi.mock('../sceneSvg', () => ({ layoutToSvg: vi.fn(() => '<svg/>') }));
vi.mock('./rasterize', () => ({ svgToPngDataUrl: vi.fn(async () => 'data:image/png;base64,PNG') }));
vi.mock('./videoSceneSplit', () => ({
  splitVideoSceneSvg: () => ({
    belowSvg: '<below/>',
    aboveSvg: '<above/>',
    slot: { x: 80, y: 140, w: 1040, h: 800 },
  }),
}));

import type { Scene } from '../../domain/project/types';
import type { Template } from '../../domain/template/types';
import type { LayoutItem } from '../layout';
import { layoutToSvg } from '../sceneSvg';
import { svgToPngDataUrl } from './rasterize';
import { buildExportScenes } from './buildExportScenes';

// buildExportScenes が参照するのは templateId / durationSec / (narrationFor へ渡す scene) のみ。
const scenes = [
  { sceneId: 's1', templateId: 'tpl', durationSec: 8 },
  { sceneId: 's2', templateId: 'tpl', durationSec: 5 },
  { sceneId: 'sX', templateId: 'missing', durationSec: 4 },
] as unknown as Scene[];

// canvas は svgToPngDataUrl への寸法渡しで参照されるため最小限だけ持たせる。
const templateById = new Map<string, Template>([
  ['tpl', { canvas: { width: 1920, height: 1080 } } as Template],
]);
const noAsset = () => undefined;

describe('buildExportScenes：ナレーション音声の付与', () => {
  it('音声ありの場面は audioBase64 / narrationVolume を含む', async () => {
    const out = await buildExportScenes(scenes, templateById, noAsset, (s) =>
      s.sceneId === 's1'
        ? { audioBase64: 'data:audio/wav;base64,AAAA', narrationVolume: 0.5 }
        : { narrationVolume: 1.0 },
    );
    // テンプレ未解決の sX はスキップされる。
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      pngBase64: 'data:image/png;base64,PNG',
      durationSec: 8,
      audioBase64: 'data:audio/wav;base64,AAAA',
      narrationVolume: 0.5,
    });
  });

  it('音声なしの場面は audioBase64 が undefined（音量は解決済み値）', async () => {
    const out = await buildExportScenes(scenes, templateById, noAsset, (s) =>
      s.sceneId === 's1'
        ? { audioBase64: 'data:audio/wav;base64,AAAA', narrationVolume: 0.5 }
        : { narrationVolume: 1.0 },
    );
    expect(out[1].audioBase64).toBeUndefined();
    expect(out[1].narrationVolume).toBe(1.0);
  });

  it('コールバックが undefined を返した場面は音声フィールドを付けない', async () => {
    const out = await buildExportScenes(scenes, templateById, noAsset, () => undefined);
    expect(out[0].audioBase64).toBeUndefined();
    expect(out[0].narrationVolume).toBeUndefined();
  });

  it('narrationFor 自体を渡さなければ音声フィールドは付かない', async () => {
    const out = await buildExportScenes(scenes, templateById, noAsset);
    expect(out[0].audioBase64).toBeUndefined();
    expect(out[0].narrationVolume).toBeUndefined();
    expect(out).toHaveLength(2);
  });
});

describe('buildExportScenes：動画シーン（ADR-0006）', () => {
  it('動画スロットがある場面は video（下/上PNG＋クリップ情報）を持ち、単一PNGは付かない', async () => {
    const out = await buildExportScenes(
      [{ sceneId: 's1', templateId: 'tpl', durationSec: 8 }] as unknown as Scene[],
      templateById,
      noAsset,
      () => ({ narrationVolume: 1.0 }),
      () => ({
        slotLayerId: 'mainVisual',
        clipRelPath: 'assets/v.mp4',
        fit: 'cover',
        clipStartSec: 0,
        useOriginalAudio: false,
        speed: 1,
      }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].pngBase64).toBeUndefined(); // 動画シーンは単一PNGなし
    expect(out[0].narrationVolume).toBe(1.0);
    expect(out[0].video).toMatchObject({
      belowPngBase64: 'data:image/png;base64,PNG',
      abovePngBase64: 'data:image/png;base64,PNG',
      clipRelPath: 'assets/v.mp4',
      slotX: 80,
      slotY: 140,
      slotW: 1040,
      slotH: 800,
      fit: 'cover',
      clipStartSec: 0,
      useOriginalAudio: false,
    });
  });

  it('videoSlotFor 未指定なら従来どおり単一PNG（video なし）', async () => {
    const out = await buildExportScenes(
      [{ sceneId: 's1', templateId: 'tpl', durationSec: 8 }] as unknown as Scene[],
      templateById,
      noAsset,
    );
    expect(out[0].pngBase64).toBe('data:image/png;base64,PNG');
    expect(out[0].video).toBeUndefined();
  });
});

describe('buildExportScenes：字幕トグル（withSubtitle）', () => {
  const oneScene = [{ sceneId: 's1', templateId: 'tpl', durationSec: 8 }] as unknown as Scene[];

  it('withSubtitle:false で layoutToSvg に「字幕除外」フィルタを渡す', async () => {
    vi.mocked(layoutToSvg).mockClear();
    await buildExportScenes(oneScene, templateById, noAsset, undefined, undefined, undefined, {
      withSubtitle: false,
    });
    const filter = vi.mocked(layoutToSvg).mock.calls[0]?.[1]?.itemFilter;
    expect(filter).toBeTypeOf('function');
    expect(filter!({ kind: 'text', isSubtitle: true } as unknown as LayoutItem)).toBe(false);
    expect(filter!({ kind: 'text', isSubtitle: false } as unknown as LayoutItem)).toBe(true);
    expect(filter!({ kind: 'image' } as unknown as LayoutItem)).toBe(true);
  });

  it('withSubtitle 未指定なら itemFilter なし（従来動作を維持）', async () => {
    vi.mocked(layoutToSvg).mockClear();
    await buildExportScenes(oneScene, templateById, noAsset);
    expect(vi.mocked(layoutToSvg).mock.calls[0]?.[1]?.itemFilter).toBeUndefined();
  });
});

describe('buildExportScenes：出力解像度（HDサイズ）', () => {
  const videoSlot = () => ({
    slotLayerId: 'mainVisual',
    clipRelPath: 'assets/v.mp4',
    fit: 'cover' as const,
    clipStartSec: 0,
    useOriginalAudio: false,
    speed: 1,
  });

  it('outputWidth/Height でPNGを縮小し、動画スロット座標もスケールする', async () => {
    vi.mocked(svgToPngDataUrl).mockClear();
    const out = await buildExportScenes(
      [{ sceneId: 's1', templateId: 'tpl', durationSec: 8 }] as unknown as Scene[],
      templateById,
      noAsset,
      () => ({ narrationVolume: 1.0 }),
      videoSlot,
      undefined,
      { outputSize: { width: 960, height: 540 } }, // 1920x1080 の半分
    );
    expect(vi.mocked(svgToPngDataUrl)).toHaveBeenCalledWith(expect.anything(), 960, 540);
    // スロット(80,140,1040,800) が半分にスケールされる
    expect(out[0].video).toMatchObject({ slotX: 40, slotY: 70, slotW: 520, slotH: 400 });
  });

  it('静止画シーンも outputSize でPNGを縮小する', async () => {
    vi.mocked(svgToPngDataUrl).mockClear();
    await buildExportScenes(
      [{ sceneId: 's1', templateId: 'tpl', durationSec: 8 }] as unknown as Scene[],
      templateById,
      noAsset,
      undefined,
      undefined, // videoSlotFor なし → 静止画シーン
      undefined,
      { outputSize: { width: 1280, height: 720 } },
    );
    expect(vi.mocked(svgToPngDataUrl)).toHaveBeenCalledWith(expect.anything(), 1280, 720);
  });

  it('outputSize 未指定ならキャンバス寸法（フルHD）で焼く', async () => {
    vi.mocked(svgToPngDataUrl).mockClear();
    await buildExportScenes(
      [{ sceneId: 's1', templateId: 'tpl', durationSec: 8 }] as unknown as Scene[],
      templateById,
      noAsset,
    );
    expect(vi.mocked(svgToPngDataUrl)).toHaveBeenCalledWith(expect.anything(), 1920, 1080);
  });
});
