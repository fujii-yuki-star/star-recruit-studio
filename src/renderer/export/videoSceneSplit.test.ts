import { describe, expect, it } from 'vitest';
import type { SceneLayout } from '../layout';
import { layoutScene } from '../layout';
import type { Scene } from '../../domain/project/types';
import type { Template } from '../../domain/template/types';
import { splitVideoSceneSvg, splitVideoSceneSvgMulti } from './videoSceneSplit';
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

// #431：2動画スロット（z10/z30）＋間の中間テキスト(z20)＋タイトル(z40) で zIndex 帯分割を検証。
function multiLayout(): SceneLayout {
  return {
    width: 1920,
    height: 1080,
    backgroundColor: '#abcdef',
    items: [
      { kind: 'fill', id: 'bg', x: 0, y: 0, w: 1920, h: 1080, zIndex: 0, color: '#123456', opacity: 1, radius: 0 },
      { kind: 'image', id: 'slotA', x: 0, y: 0, w: 900, h: 500, zIndex: 10, assetId: 'asset_a', fit: 'cover', role: 'slot', label: 'メインA' },
      { kind: 'text', id: 'midText', x: 100, y: 200, w: 400, h: 60, zIndex: 20, text: '中間テキスト', fontSize: 30, fontWeight: 'normal', color: '#222222', maxLines: 1, isSubtitle: false },
      { kind: 'image', id: 'slotB', x: 960, y: 100, w: 900, h: 500, zIndex: 30, assetId: 'asset_b', fit: 'contain', role: 'slot', label: 'メインB' },
      { kind: 'text', id: 'title', x: 160, y: 700, w: 1000, h: 120, zIndex: 40, text: 'タイトルです', fontSize: 60, fontWeight: 'bold', color: '#111111', maxLines: 1, isSubtitle: false },
    ],
  } as unknown as SceneLayout;
}

describe('splitVideoSceneSvgMulti（#431 複数動画スロット・zIndex 帯分割）', () => {
  it('スロットを zIndex 昇順（下→上）で返す（入力順に依らない）', () => {
    const r = splitVideoSceneSvgMulti(multiLayout(), ['slotB', 'slotA']);
    expect(r?.slots.map((s) => s.layerId)).toEqual(['slotA', 'slotB']);
    expect(r?.slots[0].rect).toEqual({ x: 0, y: 0, w: 900, h: 500 });
    expect(r?.slots[1].rect).toEqual({ x: 960, y: 100, w: 900, h: 500 });
  });

  it('下層=先頭スロット未満／中間層=スロット間／上層=末尾スロット以上（透過・クレジットは最上のみ）', () => {
    const r = splitVideoSceneSvgMulti(multiLayout(), ['slotA', 'slotB']);
    // 下層: bg(z0)。中間テキスト(z20)・タイトル(z40) は含まない。
    expect(r?.belowSvg).toContain('fill="#123456"');
    expect(r?.belowSvg).not.toContain('中間テキスト');
    expect(r?.belowSvg).not.toContain('タイトルです');
    // 中間層(N-1=1枚): slotA(10)〜slotB(30) の帯＝中間テキスト(z20)。透過（全面背景なし）。
    expect(r?.midSvgs).toHaveLength(1);
    expect(r?.midSvgs[0]).toContain('中間テキスト');
    expect(r?.midSvgs[0]).not.toContain('fill="#abcdef"');
    expect(r?.midSvgs[0]).not.toContain('タイトルです');
    // 上層: z>=末尾スロット(30)＝タイトル(z40)。透過＋クレジット。
    expect(r?.aboveSvg).toContain('タイトルです');
    expect(r?.aboveSvg).not.toContain('fill="#abcdef"');
    expect(r?.aboveSvg).toContain(NARRATOR_CREDIT);
    // クレジットは最上層のみ（中間・下層には付けない）。
    expect(r?.midSvgs[0]).not.toContain(NARRATOR_CREDIT);
    expect(r?.belowSvg).not.toContain(NARRATOR_CREDIT);
  });

  it('単一スロットは splitVideoSceneSvg と同一（mid なし・below=z<slot / above=z>=slot・== は上）', () => {
    const r = splitVideoSceneSvgMulti(layout(), ['slot']);
    expect(r?.midSvgs).toEqual([]);
    expect(r?.slots).toEqual([{ layerId: 'slot', rect: { x: 80, y: 140, w: 1040, h: 800 } }]);
    expect(r?.belowSvg).toContain('fill="#123456"'); // z0 下
    expect(r?.aboveSvg).toContain('タイトルです'); // z30 上
    expect(r?.aboveSvg).toContain('同じZ'); // z==slot は上（取りこぼし防止）
  });

  it('どれかのスロット id が無ければ null（誤 id/未解決）', () => {
    expect(splitVideoSceneSvgMulti(multiLayout(), ['slotA', 'nope'])).toBeNull();
    expect(splitVideoSceneSvgMulti(multiLayout(), ['bg', 'slotA'])).toBeNull(); // fill は slot でない
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
