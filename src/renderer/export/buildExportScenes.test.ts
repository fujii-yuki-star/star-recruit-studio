import { describe, expect, it, vi } from 'vitest';

// canvas(ADR-0004) は Node テスト環境に無いため描画系をスタブ化し、音声付与の分岐のみを検証する。
vi.mock('../layout', () => ({ layoutScene: vi.fn(() => ({ items: [] })) }));
vi.mock('../sceneSvg', () => ({ layoutToSvg: vi.fn(() => '<svg/>') }));
vi.mock('./rasterize', () => ({ svgToPngDataUrl: vi.fn(async () => 'data:image/png;base64,PNG') }));
vi.mock('./videoSceneSplit', () => ({
  splitVideoSceneSvg: vi.fn(() => ({
    belowSvg: '<below/>',
    aboveSvg: '<above/>',
    slot: { x: 80, y: 140, w: 1040, h: 800 },
  })),
}));

import type { Scene } from '../../domain/project/types';
import type { Template } from '../../domain/template/types';
import { layoutScene } from '../layout';
import type { LayoutItem, SceneLayout } from '../layout';
import { layoutToSvg } from '../sceneSvg';
import { NARRATOR_CREDIT } from '../../domain/voice/narratorCredit';
import { svgToPngDataUrl } from './rasterize';
import { splitVideoSceneSvg } from './videoSceneSplit';
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
const noAsset = async () => undefined;

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

  it('opts.credit を渡すと splitVideoSceneSvg の credit 引数（6番目）に反映（#177・動画シーン）', async () => {
    vi.mocked(splitVideoSceneSvg).mockClear();
    await buildExportScenes(
      [{ sceneId: 's1', templateId: 'tpl', durationSec: 8 }] as unknown as Scene[],
      templateById,
      noAsset,
      undefined,
      () => ({ slotLayerId: 'mainVisual', clipRelPath: 'assets/v.mp4', fit: 'cover', clipStartSec: 0, useOriginalAudio: false, speed: 1 }),
      undefined,
      { credit: 'VOICEVOX:四国めたん' },
    );
    expect(vi.mocked(splitVideoSceneSvg).mock.calls[0]?.[5]).toBe('VOICEVOX:四国めたん');
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

  it('静止画は layoutToSvg に常時クレジット（NARRATOR_CREDIT）を渡す（ADR-0003）', async () => {
    vi.mocked(layoutToSvg).mockClear();
    await buildExportScenes(oneScene, templateById, noAsset);
    expect(vi.mocked(layoutToSvg).mock.calls[0]?.[1]?.credit).toBe(NARRATOR_CREDIT);
  });

  it('opts.credit を渡すと layoutToSvg のクレジットに反映（#177・動的クレジット）', async () => {
    vi.mocked(layoutToSvg).mockClear();
    await buildExportScenes(oneScene, templateById, noAsset, undefined, undefined, undefined, { credit: 'VOICEVOX:四国めたん' });
    expect(vi.mocked(layoutToSvg).mock.calls[0]?.[1]?.credit).toBe('VOICEVOX:四国めたん');
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

describe('buildExportScenes：場面間トランジション（ADR-0009 T2）', () => {
  it('先頭は transition なし、以降は xfade 名＋offset（実効累積−D）を付与', async () => {
    const scenes = [
      { sceneId: 's1', templateId: 'tpl', durationSec: 8 },
      { sceneId: 's2', templateId: 'tpl', durationSec: 10, transition: { in: 'fade', durationSec: 0.5 } },
      { sceneId: 's3', templateId: 'tpl', durationSec: 6, transition: { in: 'slide', direction: 'up', durationSec: 0.5 } },
    ] as unknown as Scene[];
    const out = await buildExportScenes(scenes, templateById, noAsset);
    expect(out[0].transition).toBeUndefined();
    expect(out[1].transition).toEqual({ name: 'fade', durationSec: 0.5, offsetSec: 7.5 }); // 8−0.5
    // 実効累積: 8 → 8+10−0.5=17.5。境界2 offset = 17.5−0.5 = 17。
    expect(out[2].transition).toEqual({ name: 'slideup', durationSec: 0.5, offsetSec: 17 });
  });

  it('none/未設定はハードカット（transition を付けない）', async () => {
    const scenes = [
      { sceneId: 's1', templateId: 'tpl', durationSec: 8 },
      { sceneId: 's2', templateId: 'tpl', durationSec: 5, transition: { in: 'none' } },
    ] as unknown as Scene[];
    const out = await buildExportScenes(scenes, templateById, noAsset);
    expect(out[1].transition).toBeUndefined();
  });

  it('wipe/zoom は fade として書き出す（resolveTransition と一致）', async () => {
    const scenes = [
      { sceneId: 's1', templateId: 'tpl', durationSec: 8 },
      { sceneId: 's2', templateId: 'tpl', durationSec: 6, transition: { in: 'wipe', durationSec: 0.5 } },
    ] as unknown as Scene[];
    const out = await buildExportScenes(scenes, templateById, noAsset);
    expect(out[1].transition?.name).toBe('fade');
  });
});

describe('buildExportScenes：場面で使う画像IDの収集（#143）', () => {
  it('場面の画像 assetId ぶんだけ resolveAssetSrc を呼ぶ（場面内の重複・null・非画像は除外）', async () => {
    vi.mocked(layoutScene).mockReturnValueOnce({
      items: [
        { kind: 'image', assetId: 'img1' },
        { kind: 'image', assetId: 'img2' },
        { kind: 'image', assetId: 'img1' }, // 同一場面での重複 → 1回に集約
        { kind: 'text', isSubtitle: false }, // 画像以外は対象外
        { kind: 'image', assetId: null }, // 未割当（null）は対象外
      ],
    } as unknown as SceneLayout);
    const resolve = vi.fn(async () => 'data:image/png;base64,X');
    await buildExportScenes(
      [{ sceneId: 's1', templateId: 'tpl', durationSec: 8 }] as unknown as Scene[],
      templateById,
      resolve,
    );
    expect(resolve).toHaveBeenCalledWith('img1');
    expect(resolve).toHaveBeenCalledWith('img2');
    expect(resolve).toHaveBeenCalledTimes(2); // 重複排除＋null/非画像除外で2回のみ
  });
});
