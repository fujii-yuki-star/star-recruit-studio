// 欄の配置（ADR-0033 段階1）。**壊れた配置を作らない**ことと、**縦にも横にも積める**ことを固定する。
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_REGION_SIZES,
  DROP_SIDE,
  dropSideAt,
  MAX_REGION_RATIO,
  MAX_SIDE_TOTAL_RATIO,
  MIN_PANEL_RATIO,
  MIN_REGION_RATIO,
  normalizeRegionSizes,
  resizeRegion,
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
  PANEL_REGIONS,
  parsePanelLayout,
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
/** 領域を指定して配置を組む（`nodes` の下にぶら下がる形をテストで何度も書かない）。 */
const lay = (nodes: Partial<Record<'left' | 'center' | 'right' | 'bottom', PanelNode | null>>): PanelLayout => {
  const l = emptyLayout();
  for (const [region, node] of Object.entries(nodes)) l.nodes[region as 'left'] = node ?? null;
  return l;
};
const withLeft = (node: PanelNode | null): PanelLayout => lay({ left: node });

describe('placedPanelIds / closedPanelIds', () => {
  it('置いてある欄を前から順に返す', () => {
    const layout: PanelLayout = lay({ left: col([leaf('a'), row([leaf('b'), leaf('c')])]), right: leaf('d') });
    expect(placedPanelIds(layout)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('置いていない欄＝閉じている欄（画面が並べた順のまま返す）', () => {
    // 並べ替えたり並び順を作り直したりしない＝「表示する欄」の並びが画面ごとに勝手に変わらない。
    expect(closedPanelIds(withLeft(leaf('a')), ['c', 'a', 'b'])).toEqual(['c', 'b']);
  });
});

describe('normalizeLayout（読める形へ整える）', () => {
  it('知らない欄は落とす（画面から消えた欄が残っても描けない）', () => {
    expect(normalizeLayout(withLeft(col([leaf('a'), leaf('zzz')])), ['a']).nodes.left).toEqual(leaf('a'));
  });

  it('同じ欄は1か所だけにする（先に出てきたほうを残す＝2か所に出ると追えない）', () => {
    const layout: PanelLayout = lay({ left: leaf('a'), right: leaf('a') });
    const got = normalizeLayout(layout, ['a']);
    expect(got.nodes.left).toEqual(leaf('a'));
    expect(got.nodes.right).toBeNull();
  });

  it('子が1つの分かれ目は畳み、空の枝は消す（空の器を残さない）', () => {
    expect(normalizeLayout(withLeft(col([col([leaf('a')])])), ['a']).nodes.left).toEqual(leaf('a'));
    expect(normalizeLayout(withLeft(col([leaf('x')])), ['a']).nodes.left).toBeNull();
  });

  it('割合は残った子に合わせて数をそろえ、合計1にする', () => {
    const got = normalizeLayout(withLeft(col([leaf('a'), leaf('gone'), leaf('b')], [0.2, 0.5, 0.3])), ['a', 'b']).nodes.left;
    expect(got && isSplit(got)).toBe(true);
    if (!got || !isSplit(got)) return;
    // 落ちた子のぶんは捨て、残り（0.2 と 0.3）の比を保ったまま合計1へ。
    expect(got.sizes).toHaveLength(2);
    expect(got.sizes[0] + got.sizes[1]).toBeCloseTo(1, 9);
    expect(got.sizes[0]).toBeCloseTo(0.4, 9);
  });

  it('向きが壊れていても描ける向きにする', () => {
    const broken = { dir: 'ななめ' as never, sizes: [1, 1], children: [leaf('a'), leaf('b')] };
    const got = normalizeLayout(withLeft(broken), ['a', 'b']).nodes.left;
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
    expect(removePanel(withLeft(col([leaf('a'), leaf('b')])), 'b').nodes.left).toEqual(leaf('a'));
    expect(removePanel(withLeft(leaf('a')), 'a').nodes.left).toBeNull();
  });

  it('戻すと領域の末尾へ入る（縦に積む）', () => {
    const got = addPanelToRegion(withLeft(leaf('a')), 'b', PANEL_REGION.left).nodes.left;
    expect(got && isSplit(got) && got.dir).toBe(SPLIT_DIR.column);
    expect(placedPanelIds(withLeft(got))).toEqual(['a', 'b']);
  });

  it('すでにどこかにある欄は移動になる（同じ欄が2か所に出ない）', () => {
    const layout: PanelLayout = lay({ left: leaf('a'), right: leaf('b') });
    const got = addPanelToRegion(layout, 'b', PANEL_REGION.left);
    expect(placedPanelIds(got)).toEqual(['a', 'b']);
    expect(got.nodes.right).toBeNull();
  });
});

describe('dropPanelBeside（縦にも横にも積める・決定11）', () => {
  it('左右の辺へ落とすと横並びになる', () => {
    const got = dropPanelBeside(lay({ left: leaf('a'), right: leaf('b') }), 'b', 'a', DROP_SIDE.right).nodes.left;
    expect(got && isSplit(got) && got.dir).toBe(SPLIT_DIR.row);
    expect(placedPanelIds(withLeft(got))).toEqual(['a', 'b']);
  });

  it('上下の辺へ落とすと縦並びになる（落とす向きで前後が決まる）', () => {
    const got = dropPanelBeside(lay({ left: leaf('a'), right: leaf('b') }), 'b', 'a', DROP_SIDE.top).nodes.left;
    expect(got && isSplit(got) && got.dir).toBe(SPLIT_DIR.column);
    expect(placedPanelIds(withLeft(got))).toEqual(['b', 'a']);
  });

  it('同じ向きの並びの中なら、入れ子を深くせずその並びへ挿す', () => {
    const layout: PanelLayout = lay({ left: row([leaf('a'), leaf('b')]), right: leaf('c') });
    const got = dropPanelBeside(layout, 'c', 'b', DROP_SIDE.right).nodes.left;
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
    const got = movePanelStep(layout, 'b', DROP_SIDE.top).nodes.left;
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
    const got = resizeSplit(layout, PANEL_REGION.left, [], [0.8, 0.2]).nodes.left;
    expect(got && isSplit(got) && got.sizes[0]).toBeCloseTo(0.8, 9);
    expect(got && isSplit(got) && got.sizes.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });

  it('最小より小さくは絞れない（掴めない欄を作らない）', () => {
    const layout = withLeft(col([leaf('a'), leaf('b')]));
    const got = resizeSplit(layout, PANEL_REGION.left, [], [0.999, 0.001]).nodes.left;
    expect(got && isSplit(got) && Math.min(...got.sizes)).toBeGreaterThanOrEqual(MIN_PANEL_RATIO - 1e-9);
  });

  it('入れ子の中も道順で指せる', () => {
    const layout = withLeft(col([leaf('a'), row([leaf('b'), leaf('c')])]));
    const got = resizeSplit(layout, PANEL_REGION.left, [1], [0.25, 0.75]).nodes.left;
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

describe('parsePanelLayout（保存から読んだ値を受け取る）', () => {
  it('形が違うところは落とす（例外にしない＝設定のせいで画面が開けなくならない）', () => {
    expect(() => parsePanelLayout({ left: 5 })).not.toThrow();
    expect(parsePanelLayout(null)).toBeNull();
    expect(parsePanelLayout([])).toBeNull();
    expect(parsePanelLayout({ left: { children: 'x' } })).toBeNull();
  });

  it('欄をすべて閉じた配置は「まだ保存していない」と区別する（閉じた欄が黙って戻らない）', () => {
    expect(parsePanelLayout({ left: null, center: null, right: null, bottom: null })).toEqual(emptyLayout());
    expect(parsePanelLayout({})).toBeNull(); // 保存していない＝既定を使う
  });

  it('壊れた値が混ざっていれば「閉じてある」と読まない（何も出ない画面にしない）', () => {
    expect(parsePanelLayout({ left: 5 })).toBeNull();
  });

  it('割合が無い分かれ目は等分として読む（中身を黙って捨てない）', () => {
    const got = parsePanelLayout({ left: { dir: 'column', children: [{ panelId: 'a' }, { panelId: 'b' }] } });
    expect(got && placedPanelIds(got)).toEqual(['a', 'b']);
    const node = got?.nodes.left;
    expect(node && isSplit(node) && node.sizes.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 9);
  });

  it('読める形はそのまま受け取る（往復して同じ配置になる）', () => {
    const layout: PanelLayout = lay({ left: col([leaf('a'), row([leaf('b'), leaf('c')])]), bottom: leaf('d') });
    expect(parsePanelLayout(JSON.parse(JSON.stringify(layout)))).toEqual(layout);
  });
});

describe('入れ子の奥・4つの領域すべて（/canon-check の指摘）', () => {
  it('奥にある欄の隣にも差せる（入れ子の深さに上限が無い＝決定11 の核）', () => {
    const layout: PanelLayout = lay({
      center: col([leaf('a'), row([leaf('b'), col([leaf('c'), leaf('d')])])]),
      bottom: leaf('e'),
    });
    const got = dropPanelBeside(layout, 'e', 'd', DROP_SIDE.right);
    expect(placedPanelIds(got)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(got.nodes.bottom).toBeNull();
    // 'd' は縦並びの中にいるので、横に差すと新しい分かれ目ができる（入れ子が1段深くなる）。
    const inner = got.nodes.center && isSplit(got.nodes.center) ? got.nodes.center.children[1] : null;
    const deep = inner && isSplit(inner) ? inner.children[1] : null;
    expect(deep && isSplit(deep) && deep.dir).toBe(SPLIT_DIR.column);
  });

  it('奥にある欄もメニューで入れ替えられる', () => {
    const layout: PanelLayout = lay({ right: col([leaf('a'), row([leaf('b'), leaf('c')])]) });
    const got = movePanelStep(layout, 'c', DROP_SIDE.left);
    expect(placedPanelIds(got)).toEqual(['a', 'c', 'b']);
  });

  it('どの領域でも同じように扱える', () => {
    for (const region of PANEL_REGIONS) {
      const one = addPanelToRegion(emptyLayout(), 'a', region);
      const two = addPanelToRegion(one, 'b', region);
      expect(placedPanelIds(two)).toEqual(['a', 'b']);
      expect(placedPanelIds(removePanel(two, 'a'))).toEqual(['b']);
    }
  });
});

describe('割合の対応がずれない（/canon-check の指摘）', () => {
  it('3つ並んだ真ん中を外しても、残りの比が保たれる', () => {
    const got = removePanel(withLeft(col([leaf('a'), leaf('b'), leaf('c')], [0.2, 0.5, 0.3])), 'b').nodes.left;
    expect(got && isSplit(got) && got.sizes[0]).toBeCloseTo(0.4, 9); // 0.2 : 0.3 → 0.4 : 0.6
    expect(got && isSplit(got) && got.sizes.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 9);
  });

  it('すでに積んである領域へ足すと末尾に入る（入れ子を深くしない）', () => {
    const got = addPanelToRegion(withLeft(col([leaf('a'), leaf('b')])), 'c', PANEL_REGION.left).nodes.left;
    expect(got && isSplit(got) && got.children).toHaveLength(3);
    expect(placedPanelIds(withLeft(got))).toEqual(['a', 'b', 'c']);
  });

  it('横並びの領域へ足すと、その並びごと縦に分ける（中の並びは崩さない）', () => {
    const got = addPanelToRegion(withLeft(row([leaf('a'), leaf('b')])), 'c', PANEL_REGION.left).nodes.left;
    expect(got && isSplit(got) && got.dir).toBe(SPLIT_DIR.column);
    const inner = got && isSplit(got) ? got.children[0] : null;
    expect(inner && isSplit(inner) && inner.dir).toBe(SPLIT_DIR.row);
    expect(placedPanelIds(withLeft(got))).toEqual(['a', 'b', 'c']);
  });

  it('最小値をちょうど満たせない数（10個）でも描ける割合を返す', () => {
    const got = normalizeSizes(Array.from({ length: 10 }, () => 1));
    expect(got.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 9);
    expect(Math.min(...got)).toBeGreaterThan(0);
  });

  it('押し上げのしわ寄せは、余裕のある欄から比例して引く（3つ以上）', () => {
    const got = normalizeSizes([0.8, 0.19, 0.01]);
    expect(got[2]).toBeCloseTo(MIN_PANEL_RATIO, 9);
    expect(got.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 9);
    // 0.8 と 0.19 から**比例して**引く＝大きいほうが多く引かれる（等分に削らない）。
    expect(0.8 - got[0]).toBeGreaterThan(0.19 - got[1]);
  });
});

describe('外枠の大きさ（決定2・段階2 で追加）', () => {
  it('壊れた値は既定へ戻す（設定のせいで画面が壊れない）', () => {
    expect(normalizeRegionSizes({ left: Number.NaN, right: undefined, bottom: -5 })).toEqual({
      left: DEFAULT_REGION_SIZES.left,
      right: DEFAULT_REGION_SIZES.right,
      bottom: MIN_REGION_RATIO,
    });
    expect(normalizeRegionSizes(undefined)).toEqual(DEFAULT_REGION_SIZES);
  });

  it('下限と上限で押さえる（潰れた領域・画面を食い尽くす領域を作らない）', () => {
    const got = normalizeRegionSizes({ left: 0.01, right: 0.9, bottom: 0.9 });
    expect(got.left).toBe(MIN_REGION_RATIO);
    expect(got.bottom).toBe(MAX_REGION_RATIO);
  });

  it('左右を合わせても中央が残る（両方を広げても画面を食い尽くさない）', () => {
    const got = normalizeRegionSizes({ left: 0.5, right: 0.5, bottom: 0.3 });
    expect(got.left + got.right).toBeLessThanOrEqual(MAX_SIDE_TOTAL_RATIO + 1e-9);
  });

  it('境界のドラッグで変えられる（収まらない値は収める）', () => {
    const got = resizeRegion(emptyLayout(), 'left', 0.4);
    expect(got.regionSizes.left).toBeCloseTo(0.4, 9);
    expect(resizeRegion(emptyLayout(), 'left', 99).regionSizes.left).toBe(MAX_REGION_RATIO);
  });

  it('何も変わらなければ同じ配置を返す（履歴・保存を汚さない）', () => {
    const base = emptyLayout();
    expect(resizeRegion(base, 'left', base.regionSizes.left)).toBe(base);
  });

  it('保存から読むとき、外枠が無い古い形でも既定で読める（版が上がっただけで配置を捨てない）', () => {
    const got = parsePanelLayout({ left: { panelId: 'a' } });
    expect(got?.regionSizes).toEqual(DEFAULT_REGION_SIZES);
    expect(got && placedPanelIds(got)).toEqual(['a']);
  });
});

describe('dropSideAt（つかんだ欄をどの辺へ差すか・段階3）', () => {
  const box = { left: 100, top: 100, width: 200, height: 100 };

  it('指した側の辺になる', () => {
    expect(dropSideAt(box, 110, 150)).toBe(DROP_SIDE.left);
    expect(dropSideAt(box, 290, 150)).toBe(DROP_SIDE.right);
    expect(dropSideAt(box, 200, 105)).toBe(DROP_SIDE.top);
    expect(dropSideAt(box, 200, 195)).toBe(DROP_SIDE.bottom);
  });

  it('箱の大きさに対する割合で比べる＝同じ位置でも箱の形で辺が変わる（横長の欄でも上下が取れる）', () => {
    // 横長（200×100）の左上角付近：px では上辺のほうが近いが、**割合**では横のほうが中心から遠いので「左」。
    expect(dropSideAt(box, 105, 105)).toBe(DROP_SIDE.left);
    // 縦長にすると同じ位置関係でも「上」になる。
    expect(dropSideAt({ left: 100, top: 100, width: 100, height: 200 }, 105, 105)).toBe(DROP_SIDE.top);
  });

  it('潰れた箱でも決まる（0 で割らない・迷って何も起きない、を作らない）', () => {
    expect(dropSideAt({ left: 0, top: 0, width: 0, height: 0 }, 0, 0)).toBe(DROP_SIDE.top);
  });
});

describe('落とし直しと境目（/canon-check の指摘）', () => {
  it('いま居る場所へ落とし直しても何も変えない（決めた割合が等分へ戻らない）', () => {
    const layout = withLeft(col([leaf('a'), leaf('b')], [0.7, 0.3]));
    expect(dropPanelBeside(layout, 'a', 'b', DROP_SIDE.top)).toBe(layout);
    expect(dropPanelBeside(layout, 'b', 'a', DROP_SIDE.bottom)).toBe(layout);
    // 反対側へ落とすのは「動く」ので、ここは変わってよい。
    expect(dropPanelBeside(layout, 'a', 'b', DROP_SIDE.bottom)).not.toBe(layout);
  });

  it('ちょうど中心のときは上下を採る（迷って何も起きない、を作らない）', () => {
    const box = { left: 100, top: 100, width: 200, height: 100 };
    expect(dropSideAt(box, 200, 150)).toBe(DROP_SIDE.bottom);
  });

  it('縦横の割合が同じときは、どの向きでも上下を採る（決め方が象限で変わらない）', () => {
    const box = { left: 0, top: 0, width: 100, height: 100 };
    expect(dropSideAt(box, 25, 25)).toBe(DROP_SIDE.top); // 左上
    expect(dropSideAt(box, 75, 25)).toBe(DROP_SIDE.top); // 右上
    expect(dropSideAt(box, 25, 75)).toBe(DROP_SIDE.bottom); // 左下
    expect(dropSideAt(box, 75, 75)).toBe(DROP_SIDE.bottom); // 右下
  });
});
