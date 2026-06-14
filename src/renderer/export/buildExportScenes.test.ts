import { describe, expect, it, vi } from 'vitest';

// canvas(ADR-0004) は Node テスト環境に無いため描画系をスタブ化し、音声付与の分岐のみを検証する。
vi.mock('../layout', () => ({ layoutScene: () => ({}) }));
vi.mock('../sceneSvg', () => ({ layoutToSvg: () => '<svg/>' }));
vi.mock('./rasterize', () => ({ svgToPngDataUrl: async () => 'data:image/png;base64,PNG' }));
vi.mock('./videoSceneSplit', () => ({
  splitVideoSceneSvg: () => ({
    belowSvg: '<below/>',
    aboveSvg: '<above/>',
    slot: { x: 80, y: 140, w: 1040, h: 800 },
  }),
}));

import type { Scene } from '../../domain/project/types';
import type { Template } from '../../domain/template/types';
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
