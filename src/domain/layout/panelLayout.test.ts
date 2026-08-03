// 欄の配置（ADR-0033 段階1）。**壊れた配置を作らない**ことと、**縦にも横にも積める**ことを固定する。
import { describe, expect, it } from 'vitest';

import {
  DROP_SIDE,
  MIN_PANEL_RATIO,
  PANEL_REGION,
  SPLIT_DIR,
  addPanelToRegion,
  closedPanelIds,
  dropPanelBeside,
  emptyLayout,
  isSplit,
  movePanelStep,
  normalizeLayout,
  normalizeSizes,
  placedPanelIds,
  removePanel,
  resizeSplit,
} from './panelLayout';
import type { PanelLayout, PanelNode } from './panelLayout';

const leaf = (id: string): PanelNode => ({ panelId: id });
const col = (children: PanelNode[], sizes?: number[]): PanelNode => ({
  dir: SPLIT_DIR.column,
  sizes: sizes ?? children.map(() => 1 / children.length),
  children,
});
const row = (children: PanelNode[], sizes?: number[]): PanelNode => ({
  dir: SPLIT_DIR.row,
  sizes: sizes ?? children.map(() => 1 / children.length),
  children,
});
const withLeft = (node: PanelNode | null): PanelLayout => ({ ...emptyLayout(), left: node });

describe('placedPanelIds / closedPanelIds', () => {
  it('置いてある欄を前から順に返す', () => {
    const layout: PanelLayout = { ...emptyLayout(), left: col([leaf('a'), row([leaf('b'), leaf('c')])]), right: leaf('d') };
    expect(placedPanelIds(layout)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('置いていない欄＝閉じている欄（「表示する欄」から戻せる）', () => {
    expect(closedPanelIds(withLeft(leaf('a')), ['a', 'b', 'c'])).toEqual(['b', 'c']);
  });
});

describe('normalizeLayout（読める形へ整える）', () => {
  it('知らない欄は落とす（画面から消えた欄が残っても描けない）', () => {
    expect(normalizeLayout(withLeft(col([leaf('a'), leaf('zzz')])), ['a']).left).toEqual(leaf('a'));
  });

  it('同じ欄は1か所だけにする（2か所に出ると追えない）', () => {
    const layout: PanelLayout = { ...emptyLayout(), left: leaf('a'), right: leaf('a') };
    expect(placedPanelIds(normalizeLayout(layout, ['a']))).toEqual(['a']);
  });

  it('子が1つの分かれ目は畳み、空の枝は消す（空の器を残さない）', () => {
    expect(normalizeLayout(withLeft(col([col([leaf('a')])])), ['a']).left).toEqual(leaf('a'));
    expect(normalizeLayout(withLeft(col([leaf('x')])), ['a']).left).toBeNull();
  });

  it('割合は残った子に合わせて数をそろえ、合計1にする', () => {
    const got = normalizeLayout(withLeft(col([leaf('a'), leaf('gone'), leaf('b')], [0.2, 0.5, 0.3])), ['a', 'b']).left;
    expect(got && isSplit(got)).toBe(true);
    if (!got || !isSplit(got)) return;
    // 落ちた子のぶんは捨て、残り（0.2 と 0.3）の比を保ったまま合計1へ。
    expect(got.sizes).toHaveLength(2);
    expect(got.sizes[0] + got.sizes[1]).toBeCloseTo(1, 9);
    expect(got.sizes[0]).toBeCloseTo(0.4, 9);
  });

  it('向きが壊れていても描ける向きにする', () => {
    const broken = { dir: 'ななめ' as never, sizes: [1, 1], children: [leaf('a'), leaf('b')] };
    const got = normalizeLayout(withLeft(broken), ['a', 'b']).left;
    expect(got && isSplit(got) && got.dir).toBe(SPLIT_DIR.column);
  });
});

describe('normalizeSizes（欄が潰れて掴めなくならない）', () => {
  it('合計1にそろえる', () => {
    expect(normalizeSizes([2, 2]).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });

  it('最小より小さい欄は押し上げる（0 幅の欄を作らない）', () => {
    const got = normalizeSizes([0.99, 0.01]);
    expect(Math.min(...got)).toBeGreaterThanOrEqual(MIN_PANEL_RATIO - 1e-9);
    expect(got.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });

  it('壊れた値（負・NaN・全部0）でも有効な割合を返す', () => {
    for (const input of [[-1, -1], [Number.NaN, 1], [0, 0]]) {
      const got = normalizeSizes(input);
      expect(got.every((v) => Number.isFinite(v) && v > 0)).toBe(true);
      expect(got.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    }
  });

  it('欄が多すぎて最小を満たせないときは等分にする（描けない値を返さない）', () => {
    const got = normalizeSizes(Array.from({ length: 20 }, () => 1));
    expect(got.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(new Set(got.map((v) => v.toFixed(6))).size).toBe(1);
  });
});

describe('removePanel / addPanelToRegion（閉じる・戻す）', () => {
  it('外すと枝が畳まれる', () => {
    expect(removePanel(withLeft(col([leaf('a'), leaf('b')])), 'b').left).toEqual(leaf('a'));
    expect(removePanel(withLeft(leaf('a')), 'a').left).toBeNull();
  });

  it('戻すと領域の末尾へ入る（縦に積む）', () => {
    const got = addPanelToRegion(withLeft(leaf('a')), 'b', PANEL_REGION.left).left;
    expect(got && isSplit(got) && got.dir).toBe(SPLIT_DIR.column);
    expect(placedPanelIds(withLeft(got))).toEqual(['a', 'b']);
  });

  it('すでにどこかにある欄は移動になる（同じ欄が2か所に出ない）', () => {
    const layout: PanelLayout = { ...emptyLayout(), left: leaf('a'), right: leaf('b') };
    const got = addPanelToRegion(layout, 'b', PANEL_REGION.left);
    expect(placedPanelIds(got)).toEqual(['a', 'b']);
    expect(got.right).toBeNull();
  });
});

describe('dropPanelBeside（縦にも横にも積める・決定11）', () => {
  it('左右の辺へ落とすと横並びになる', () => {
    const got = dropPanelBeside({ ...emptyLayout(), left: leaf('a'), right: leaf('b') }, 'b', 'a', DROP_SIDE.right).left;
    expect(got && isSplit(got) && got.dir).toBe(SPLIT_DIR.row);
    expect(placedPanelIds(withLeft(got))).toEqual(['a', 'b']);
  });

  it('上下の辺へ落とすと縦並びになる（落とす向きで前後が決まる）', () => {
    const got = dropPanelBeside({ ...emptyLayout(), left: leaf('a'), right: leaf('b') }, 'b', 'a', DROP_SIDE.top).left;
    expect(got && isSplit(got) && got.dir).toBe(SPLIT_DIR.column);
    expect(placedPanelIds(withLeft(got))).toEqual(['b', 'a']);
  });

  it('同じ向きの並びの中なら、入れ子を深くせずその並びへ挿す', () => {
    const layout: PanelLayout = { ...emptyLayout(), left: row([leaf('a'), leaf('b')]), right: leaf('c') };
    const got = dropPanelBeside(layout, 'c', 'b', DROP_SIDE.right).left;
    expect(got && isSplit(got) && got.children).toHaveLength(3);
    expect(placedPanelIds(withLeft(got))).toEqual(['a', 'b', 'c']);
  });

  it('自分自身の辺へ落としても何も変えない（同じ配置を返す）', () => {
    const layout = withLeft(col([leaf('a'), leaf('b')]));
    expect(dropPanelBeside(layout, 'a', 'a', DROP_SIDE.top)).toBe(layout);
  });

  it('落とし先が無いときは何も変えない（黙って別の場所へ置かない）', () => {
    const layout = withLeft(col([leaf('a'), leaf('b')]));
    expect(dropPanelBeside(layout, 'a', 'zzz', DROP_SIDE.top)).toBe(layout);
  });
});

describe('movePanelStep（メニューの上へ／下へ・決定12）', () => {
  it('同じ向きの並びの中で隣と入れ替える（割合も一緒に動く）', () => {
    const layout = withLeft(col([leaf('a'), leaf('b')], [0.7, 0.3]));
    const got = movePanelStep(layout, 'b', DROP_SIDE.top).left;
    expect(placedPanelIds(withLeft(got))).toEqual(['b', 'a']);
    expect(got && isSplit(got) && got.sizes).toEqual([0.3, 0.7]);
  });

  it('端では何も変えない（同じ配置を返す）', () => {
    const layout = withLeft(col([leaf('a'), leaf('b')]));
    expect(movePanelStep(layout, 'a', DROP_SIDE.top)).toBe(layout);
  });

  it('向きが違う並びでは何も変えない（縦並びを「左へ」で動かさない）', () => {
    const layout = withLeft(col([leaf('a'), leaf('b')]));
    expect(movePanelStep(layout, 'b', DROP_SIDE.left)).toBe(layout);
  });
});

describe('resizeSplit（境界のドラッグ・決定2）', () => {
  it('割合を変えられる（合計は1のまま）', () => {
    const layout = withLeft(col([leaf('a'), leaf('b')]));
    const got = resizeSplit(layout, PANEL_REGION.left, [], [0.8, 0.2]).left;
    expect(got && isSplit(got) && got.sizes[0]).toBeCloseTo(0.8, 9);
    expect(got && isSplit(got) && got.sizes.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });

  it('最小より小さくは絞れない（掴めない欄を作らない）', () => {
    const layout = withLeft(col([leaf('a'), leaf('b')]));
    const got = resizeSplit(layout, PANEL_REGION.left, [], [0.999, 0.001]).left;
    expect(got && isSplit(got) && Math.min(...got.sizes)).toBeGreaterThanOrEqual(MIN_PANEL_RATIO - 1e-9);
  });

  it('入れ子の中も道順で指せる', () => {
    const layout = withLeft(col([leaf('a'), row([leaf('b'), leaf('c')])]));
    const got = resizeSplit(layout, PANEL_REGION.left, [1], [0.25, 0.75]).left;
    const inner = got && isSplit(got) ? got.children[1] : null;
    expect(inner && isSplit(inner) && inner.sizes[0]).toBeCloseTo(0.25, 9);
  });

  it('見つからない・数が合わないときは何も変えない', () => {
    const layout = withLeft(col([leaf('a'), leaf('b')]));
    expect(resizeSplit(layout, PANEL_REGION.left, [9], [0.5, 0.5])).toBe(layout);
    expect(resizeSplit(layout, PANEL_REGION.left, [], [0.5, 0.3, 0.2])).toBe(layout);
    expect(resizeSplit(layout, PANEL_REGION.right, [], [0.5, 0.5])).toBe(layout);
  });
});
