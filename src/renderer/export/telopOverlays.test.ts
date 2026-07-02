import { describe, expect, it, vi } from 'vitest';

// 描画系（canvas）は Node に無いためスタブ化し、抽出・区間・サイズ/フォントの配線だけを検証する（buildExportScenes.test と同方針）。
vi.mock('../sceneSvg', () => ({ layoutToSvg: vi.fn(() => '<svg/>') }));
vi.mock('./rasterize', () => ({ svgToPngDataUrl: vi.fn(async () => 'data:image/png;base64,PNG') }));

import type { Project } from '../../domain/project/types';
import { layoutToSvg } from '../sceneSvg';
import { svgToPngDataUrl } from './rasterize';
import { buildTelopOverlays } from './telopOverlays';

function project(overlay?: unknown): Project {
  return {
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 300 },
    scenes: [
      { sceneId: 's1', durationSec: 8, narration: { text: 'a', status: 'idle' }, warnings: [], assetRefs: {}, texts: {}, character: { enabled: false, characterId: 'yuko' }, partId: 'p', order: 1, sceneType: 'intro', templateId: 't' },
    ],
    timelineOverlay: overlay,
  } as unknown as Project;
}

describe('buildTelopOverlays（配線・ADR-0018）', () => {
  it('overlay 由来かつ非空文言のクリップだけを帯PNG＋グローバル区間へ（outputSize/fontId/fontFamily 反映）', async () => {
    const overlay = { clips: [
      { id: 'ovclip_001', track: 'telop', anchorSceneId: 's1', startSec: 1, durationSec: 2, text: '補足' },
      { id: 'ovclip_002', track: 'telop', startSec: 0, durationSec: 1 }, // 文言なし＝出さない
    ] };
    const out = await buildTelopOverlays(project(overlay), { outputSize: { width: 1280, height: 720 }, fontFamily: 'F', fontId: 'gen-interface-jp' });
    expect(out).toEqual([{ pngBase64: 'data:image/png;base64,PNG', startSec: 1, endSec: 3 }]);
    // ラスタライズは出力解像度・レイアウトはキャンバス実寸（場面PNGと同じ流儀）。
    expect(vi.mocked(svgToPngDataUrl)).toHaveBeenCalledWith('<svg/>', 1280, 720);
    const [layout, opts] = vi.mocked(layoutToSvg).mock.calls[0];
    expect(layout.width).toBe(1920);
    expect(opts).toMatchObject({ transparent: true, fontFamily: 'F' });
    // item に動画全体フォントが明示される（場面フォント非依存＝パリティ・🔴対応）。
    expect(layout.items[0]).toMatchObject({ id: 'overlay_telop', text: '補足', fontId: 'gen-interface-jp' });
  });

  it('overlay が無ければ空配列', async () => {
    expect(await buildTelopOverlays(project())).toEqual([]);
  });
});
