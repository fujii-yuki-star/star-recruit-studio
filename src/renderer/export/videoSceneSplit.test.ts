import { describe, expect, it } from 'vitest';
import type { SceneLayout } from '../layout';
import { layoutScene } from '../layout';
import type { Scene } from '../../domain/project/types';
import type { Template } from '../../domain/template/types';
import { splitVideoSceneSvg } from './videoSceneSplit';
import { NARRATOR_CREDIT } from '../../domain/voice/narratorCredit';

// 背景(z0・色は backgroundColor とは別)・動画スロット(z10)・同z テキスト(z10)・タイトル(z30) の最小レイアウト。
// backgroundColor(#abcdef) は layoutToSvg の全面背景 rect のみが使う色＝transparent を厳密に検証できる。
function layout(): SceneLayout {
  return {
    width: 1920,
    height: 1080,
    backgroundColor: '#abcdef',
    items: [
      { kind: 'fill', id: 'bg', x: 0, y: 0, w: 1920, h: 1080, zIndex: 0, color: '#123456', opacity: 1, radius: 0 },
      { kind: 'image', id: 'slot', x: 80, y: 140, w: 1040, h: 800, zIndex: 10, assetId: 'asset_v', fit: 'cover', role: 'slot', label: 'メイン' },
      { kind: 'text', id: 'sameZ', x: 100, y: 200, w: 400, h: 60, zIndex: 10, text: '同じZ', fontSize: 30, fontWeight: 'normal', color: '#222222', maxLines: 1, isSubtitle: false },
      { kind: 'text', id: 'title', x: 160, y: 300, w: 1000, h: 120, zIndex: 30, text: 'タイトルです', fontSize: 60, fontWeight: 'bold', color: '#111111', maxLines: 1, isSubtitle: false },
    ],
  };
}

describe('splitVideoSceneSvg（ADR-0006 下/上分割）', () => {
  it('スロット矩形を返す', () => {
    expect(splitVideoSceneSvg(layout(), 'slot')?.slot).toEqual({ x: 80, y: 140, w: 1040, h: 800 });
  });

  it('下PNGは全面背景塗り(backgroundColor)を持ち、上レイヤーは含まない', () => {
    const r = splitVideoSceneSvg(layout(), 'slot');
    // #abcdef は全面背景 rect のみが使う色＝transparent でないことを厳密に確認。
    expect(r?.belowSvg).toContain('fill="#abcdef"');
    expect(r?.belowSvg).toContain('fill="#123456"'); // 背景アイテム(z0)も下
    expect(r?.belowSvg).not.toContain('タイトルです'); // z30 は上
  });

  it('上PNGは透過（全面背景塗りなし）で、上レイヤーを含む', () => {
    const r = splitVideoSceneSvg(layout(), 'slot');
    expect(r?.aboveSvg).not.toContain('fill="#abcdef"'); // 透過＝全面背景 rect なし
    expect(r?.aboveSvg).not.toContain('fill="#123456"'); // 背景アイテム(z0)は下なので上に無い
    expect(r?.aboveSvg).toContain('タイトルです');
  });

  it('常時クレジット（ADR-0003）は上レイヤーのみ＝下には付けない（二重化防止）', () => {
    const r = splitVideoSceneSvg(layout(), 'slot');
    expect(r?.aboveSvg).toContain(NARRATOR_CREDIT);
    expect(r?.belowSvg).not.toContain(NARRATOR_CREDIT);
  });

  it('fontFamily を layoutToSvg へ渡す（上レイヤーのテキストに反映・同梱フォント選択）', () => {
    const r = splitVideoSceneSvg(layout(), 'slot', undefined, undefined, "'TestFont Y', sans-serif");
    expect(r?.aboveSvg).toContain(`font-family="'TestFont Y', sans-serif"`);
  });

  it('スロットと同 zIndex のアイテムは上に含める（取りこぼし防止＝網羅的分割）', () => {
    const r = splitVideoSceneSvg(layout(), 'slot');
    expect(r?.aboveSvg).toContain('同じZ');
    expect(r?.belowSvg).not.toContain('同じZ');
  });

  it('スロット自身は下にも上にも描かれない（動画で埋める穴）', () => {
    const r = splitVideoSceneSvg(layout(), 'slot');
    expect(r?.belowSvg).not.toContain('メイン');
    expect(r?.aboveSvg).not.toContain('メイン');
  });

  it('includeItem で除外したアイテムは下にも上にも描かれない（字幕OFF等）', () => {
    // title(z30=上) を除外 → 上に出ない。bg(z0=下) を除外 → 下に出ない。
    const noTitle = splitVideoSceneSvg(layout(), 'slot', undefined, (it) => it.id !== 'title');
    expect(noTitle?.aboveSvg).not.toContain('タイトルです');
    const noBg = splitVideoSceneSvg(layout(), 'slot', undefined, (it) => it.id !== 'bg');
    expect(noBg?.belowSvg).not.toContain('fill="#123456"');
  });

  it('image/role=slot でない id（fill/text）や未知 id は null', () => {
    expect(splitVideoSceneSvg(layout(), 'bg')).toBeNull(); // fill
    expect(splitVideoSceneSvg(layout(), 'title')).toBeNull(); // text
    expect(splitVideoSceneSvg(layout(), 'nope')).toBeNull(); // 未知
  });
});

// Phase 4c：FREE の freeLayout slot 要素を、実 layoutScene → splitVideoSceneSvg で
// 要素 id のまま分割できる（＝動画は要素矩形に合成・Rust 経路は無改修）ことを通しで確認する。
describe('splitVideoSceneSvg × FREE freeLayout（Phase 4c）', () => {
  const freeTemplate: Template = {
    schemaVersion: '1.0', templateId: 'free_canvas_v1', name: '自由配置', category: 'free',
    aspectRatio: '16:9', canvas: { width: 1920, height: 1080 }, defaults: { backgroundColor: '#ffffff' },
    layers: [{ id: 'background', type: 'background', x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 }],
  };
  const freeScene: Scene = {
    sceneId: 'scene_001', partId: 'part_001', order: 1, sceneType: 'free', templateId: 'free_canvas_v1',
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: 'yuko' }, texts: {},
    narration: { text: '', status: 'none' }, warnings: [],
    freeLayout: [
      { id: 'free_001', kind: 'shape', x: 0, y: 0, w: 1920, h: 1080, zIndex: 1, shapeType: 'rect', fillColor: '#101010' },
      { id: 'free_002', kind: 'slot', x: 200, y: 150, w: 900, h: 600, zIndex: 5, assetId: 'asset_v', fit: 'cover' },
      { id: 'free_003', kind: 'text', x: 100, y: 100, w: 500, h: 80, zIndex: 9, text: '前面テキスト' },
    ],
  };

  it('slot 要素 id で分割でき、矩形は要素の x/y/w/h（低z は下・高z は上）', () => {
    const r = splitVideoSceneSvg(layoutScene(freeScene, freeTemplate), 'free_002');
    expect(r?.slot).toEqual({ x: 200, y: 150, w: 900, h: 600 });
    expect(r?.aboveSvg).toContain('前面テキスト'); // z9 > slot z5 → 上（透過）
    expect(r?.belowSvg).not.toContain('前面テキスト');
    expect(r?.belowSvg).toContain('fill="#101010"'); // 図形 z1 < slot → 下
  });
});
