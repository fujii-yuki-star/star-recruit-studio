import { describe, expect, it } from 'vitest';
import type { FreeElement } from './types';
import type { Group } from '../group/types';
import { addFreeComponentAsGroup, addFreeComponentGroup, FREE_COMPONENTS } from './freeComponents';

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

  it('縦型は等倍縮小し基点を比例配置（widget の縦横比を保つ・#281）', () => {
    const land = addFreeComponentGroup([], 'speech_balloon'); // 横型（既定＝従来どおり）
    const port = addFreeComponentGroup([], 'speech_balloon', 1080, 1920); // 縦型
    const ls = land.freeLayout[0], ps = port.freeLayout[0]; // 吹き出し shape
    expect(ps.w).toBeLessThan(ls.w); // 縦型は幅が縮む（画面に対し過大にならない）
    expect(ps.x).toBeLessThan(ls.x); // 横位置は縮む
    expect(ps.y).toBeGreaterThan(ls.y); // 縦位置は下へ（縦の比で proportional）
    expect(ps.w / ps.h).toBeCloseTo(ls.w / ls.h, 2); // 縦横比を保つ（等倍＝歪まない）
    // パーツ内テキストも等倍（吹き出しとの位置関係・fontSize を保つ）。
    const lt = land.freeLayout[1], pt = port.freeLayout[1];
    expect(pt.fontSize ?? 0).toBeLessThan(lt.fontSize ?? 0);
    expect((pt.w ?? 0) / (lt.w ?? 1)).toBeCloseTo((ps.w ?? 0) / (ls.w ?? 1), 2); // text と shape が同じ倍率
  });

  it('縦型：slot を含むパーツ（before_after）も等倍縮小し canvas 内に収まる（#281）', () => {
    const land = addFreeComponentGroup([], 'before_after');
    const port = addFreeComponentGroup([], 'before_after', 1080, 1920);
    const landSlots = land.freeLayout.filter((e) => e.kind === 'slot');
    const portSlots = port.freeLayout.filter((e) => e.kind === 'slot');
    expect(landSlots).toHaveLength(2);
    expect(portSlots).toHaveLength(2);
    portSlots.forEach((s, i) => {
      expect(s.w).toBeLessThan(landSlots[i].w); // 縦型は縮む
      expect(s.w / s.h).toBeCloseTo(landSlots[i].w / landSlots[i].h, 2); // 縦横比保持（360:240）
    });
    // すべての要素が canvas(1080×1920) 内に収まる（横型基準の座標で外へはみ出さない）。
    port.freeLayout.forEach((e) => {
      expect(e.x + e.w).toBeLessThanOrEqual(1080);
      expect(e.y + e.h).toBeLessThanOrEqual(1920);
    });
  });
});

describe('addFreeComponentAsGroup（プリセットを最初からグループ化・#525-3）', () => {
  it('複数要素パーツは展開要素を1つのグループに束ね、名前はパーツ名にする', () => {
    const { freeLayout, groups, newIds, groupId } = addFreeComponentAsGroup([], [], 'number_card');
    expect(newIds).toEqual(['free_001', 'free_002', 'free_003']);
    expect(freeLayout).toHaveLength(3);
    expect(groupId).toBe('group_001');
    expect(groups).toHaveLength(1);
    expect(groups[0].members).toEqual(newIds); // 追加要素がそのままメンバー
    expect(groups[0].name).toBe('数字カード'); // 一覧で見分けやすいようパーツ名（#525-12 と同趣旨）
    expect(groups[0].transform).toEqual({ x: 0, y: 0, rotation: 0, scale: 1 }); // 素の identity
  });

  it('既存グループは保持し、新グループの id は衝突しない', () => {
    const existing: Group[] = [{ id: 'group_001', members: ['free_001'], transform: { x: 0, y: 0, rotation: 0, scale: 1 } }];
    const layout: FreeElement[] = [{ id: 'free_001', kind: 'shape', x: 0, y: 0, w: 10, h: 10, zIndex: 1 }];
    const { groups, groupId } = addFreeComponentAsGroup(layout, existing, 'speech_balloon');
    expect(groups).toHaveLength(2); // 既存＋新規
    expect(groupId).toBe('group_002'); // 衝突しない採番
    expect(groups[1].members.every((m) => m.startsWith('free_'))).toBe(true);
  });

  it('未知の partId は変化なし・グループを作らない', () => {
    const { freeLayout, groups, newIds, groupId } = addFreeComponentAsGroup([], [], 'unknown');
    expect(freeLayout).toEqual([]);
    expect(groups).toEqual([]);
    expect(newIds).toEqual([]);
    expect(groupId).toBeNull();
  });

  it('全カタログ：複数要素パーツは必ずグループ化される（全メンバーが追加要素）', () => {
    for (const c of FREE_COMPONENTS) {
      const { newIds, groups, groupId } = addFreeComponentAsGroup([], [], c.id);
      if (c.elements.length >= 2) {
        expect(groupId).not.toBeNull();
        expect(groups.find((g) => g.id === groupId)?.members).toEqual(newIds);
      }
    }
  });
});
