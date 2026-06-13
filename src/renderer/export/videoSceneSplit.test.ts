import { describe, expect, it } from 'vitest';
import type { SceneLayout } from '../layout';
import { splitVideoSceneSvg } from './videoSceneSplit';

// 背景(z0)・動画スロット(z10)・タイトル(z30) の最小レイアウト。
function layout(): SceneLayout {
  return {
    width: 1920,
    height: 1080,
    backgroundColor: '#abcdef',
    items: [
      { kind: 'fill', id: 'bg', x: 0, y: 0, w: 1920, h: 1080, zIndex: 0, color: '#abcdef', opacity: 1, radius: 0 },
      { kind: 'image', id: 'slot', x: 80, y: 140, w: 1040, h: 800, zIndex: 10, assetId: 'asset_v', fit: 'cover', role: 'slot', label: 'メイン' },
      { kind: 'text', id: 'title', x: 160, y: 300, w: 1000, h: 120, zIndex: 30, text: 'タイトルです', fontSize: 60, fontWeight: 'bold', color: '#111111', maxLines: 1 },
    ],
  };
}

describe('splitVideoSceneSvg（ADR-0006 下/上分割）', () => {
  it('スロット矩形を返す', () => {
    const r = splitVideoSceneSvg(layout(), 'slot');
    expect(r?.slot).toEqual({ x: 80, y: 140, w: 1040, h: 800 });
  });

  it('下PNGは背景(不透明・全面塗り)を含み、上レイヤーは含まない', () => {
    const r = splitVideoSceneSvg(layout(), 'slot');
    expect(r?.belowSvg).toContain('fill="#abcdef"'); // 背景塗りあり
    expect(r?.belowSvg).not.toContain('タイトルです'); // z30 は上
  });

  it('上PNGは透過（背景塗りなし）で、上レイヤーを含む', () => {
    const r = splitVideoSceneSvg(layout(), 'slot');
    expect(r?.aboveSvg).not.toContain('fill="#abcdef"'); // 透過＝背景塗りなし
    expect(r?.aboveSvg).toContain('タイトルです'); // z30 は上
  });

  it('スロット自身は下にも上にも描かれない（動画で埋める穴）', () => {
    const r = splitVideoSceneSvg(layout(), 'slot');
    expect(r?.belowSvg).not.toContain('メイン'); // スロットのラベル
    expect(r?.aboveSvg).not.toContain('メイン');
  });

  it('スロットが無ければ null', () => {
    expect(splitVideoSceneSvg(layout(), 'nope')).toBeNull();
  });
});
