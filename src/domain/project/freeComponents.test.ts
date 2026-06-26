import { describe, expect, it } from 'vitest';
import type { FreeElement } from './types';
import { addFreeComponentGroup, FREE_COMPONENTS } from './freeComponents';

describe('FREE_COMPONENTS カタログ', () => {
  it('5種・各パーツは id/label/要素を持ち、要素は kind と正のサイズを持つ', () => {
    expect(FREE_COMPONENTS).toHaveLength(5);
    for (const c of FREE_COMPONENTS) {
      expect(c.id).toBeTruthy();
      expect(c.label).toBeTruthy();
      expect(c.elements.length).toBeGreaterThan(0);
      for (const el of c.elements) {
        expect(['slot', 'text', 'shape']).toContain(el.kind);
        expect(el.w).toBeGreaterThan(0);
        expect(el.h).toBeGreaterThan(0);
      }
    }
  });

  it('パーツ id は一意', () => {
    const ids = FREE_COMPONENTS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('addFreeComponentGroup', () => {
  it('空配列に展開：要素数一致・id 連番・zIndex は前面へテンプレ順', () => {
    const part = FREE_COMPONENTS.find((c) => c.id === 'number_card');
    const { freeLayout, newIds } = addFreeComponentGroup([], 'number_card');
    expect(freeLayout).toHaveLength(part?.elements.length ?? -1);
    expect(newIds).toEqual(['free_001', 'free_002', 'free_003']);
    expect(freeLayout.map((e) => e.zIndex)).toEqual([1, 2, 3]); // baseZ(0)+1.. テンプレ順
    expect(freeLayout.map((e) => e.kind)).toEqual(part?.elements.map((e) => e.kind));
  });

  it('既存要素あり：id は衝突せず連番継続・zIndex は既存最前面より上', () => {
    const existing: FreeElement[] = [{ id: 'free_001', kind: 'shape', x: 0, y: 0, w: 10, h: 10, zIndex: 7 }];
    const { freeLayout, newIds } = addFreeComponentGroup(existing, 'speech_balloon');
    expect(newIds).toEqual(['free_002', 'free_003']);
    const added = freeLayout.filter((e) => newIds.includes(e.id));
    expect(added.every((e) => (e.zIndex ?? 0) > 7)).toBe(true);
  });

  it('展開要素は基準位置＋相対座標で配置（先頭は ANCHOR 付近）', () => {
    const { freeLayout } = addFreeComponentGroup([], 'speech_balloon');
    expect(freeLayout[0].x).toBe(240); // ANCHOR_X + 相対0 + ずらし0
    expect(freeLayout[0].y).toBe(220);
  });

  it('未知の partId は変化なし・newIds=[]（同一参照）', () => {
    const layout: FreeElement[] = [{ id: 'free_001', kind: 'text', x: 0, y: 0, w: 10, h: 10, text: 'a' }];
    const { freeLayout, newIds } = addFreeComponentGroup(layout, 'unknown');
    expect(freeLayout).toBe(layout);
    expect(newIds).toEqual([]);
  });
});
