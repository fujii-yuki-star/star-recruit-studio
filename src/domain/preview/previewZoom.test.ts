import { describe, expect, it } from 'vitest';
import {
  canStepZoom, fitPercentOf, PREVIEW_ZOOM_MAX, PREVIEW_ZOOM_MIN, stepZoom, zoomedBox, zoomPercentOf,
} from './previewZoom';

describe('previewZoom（仕上がり確認のズーム・#142）', () => {
  describe('zoomPercentOf（いま何%で見えているか）', () => {
    // ⚠️ **フィットは 100% とは限らない**＝領域が狭ければ縮む。画面に出す数字が実際の見え方と
    // 違うと「100% なのに小さい」になる。
    it('フィットは領域に応じた実際の%を返す', () => {
      expect(zoomPercentOf('fit', 63.4)).toBe(63);
      expect(zoomPercentOf('fit', 140)).toBe(140);
    });
    it('数値ならその値', () => {
      expect(zoomPercentOf(150, 63)).toBe(150);
    });
  });

  describe('stepZoom（1段動かす）', () => {
    // ⚠️ **フィットからの1段は「いまの見え方」から数える**＝63% で拡大したら 75%。
    // 100% へ飛ばすと**縮んで見える**ことがある（フィットが 140% のとき等）。
    it('フィットからの拡大は、いまの見え方より大きい最初の段へ', () => {
      expect(stepZoom('fit', 'in', 63)).toBe(75);
      expect(stepZoom('fit', 'in', 120)).toBe(150);
    });
    it('フィットからの縮小は、いまの見え方より小さい最初の段へ', () => {
      expect(stepZoom('fit', 'out', 63)).toBe(50);
      expect(stepZoom('fit', 'out', 120)).toBe(100);
    });
    it('数値からは隣の段へ', () => {
      expect(stepZoom(100, 'in', 63)).toBe(150);
      expect(stepZoom(100, 'out', 63)).toBe(75);
    });

    // ⚠️ **端では同じ値を返す**＝「変わらない操作」を再描画や履歴へ流さない。
    it('端では動かさない（同じ値）', () => {
      expect(stepZoom(PREVIEW_ZOOM_MAX, 'in', 63)).toBe(PREVIEW_ZOOM_MAX);
      expect(stepZoom(PREVIEW_ZOOM_MIN, 'out', 63)).toBe(PREVIEW_ZOOM_MIN);
    });

    // ⚠️ **フィットが段の外にあるときも端で止まる**＝フィットが 220%（極端に広い領域）なら
    // 拡大はできない。段の外だからと `undefined` を返して落ちない。
    it('フィットが段の外でも落ちない', () => {
      expect(stepZoom('fit', 'in', 220)).toBe('fit');
      expect(stepZoom('fit', 'out', 30)).toBe('fit');
      expect(stepZoom('fit', 'out', 220)).toBe(PREVIEW_ZOOM_MAX);
      expect(stepZoom('fit', 'in', 30)).toBe(PREVIEW_ZOOM_MIN);
    });
  });

  describe('canStepZoom（押せるか）', () => {
    it('動かせるときだけ true（押せるのに何も起きない、を作らない）', () => {
      expect(canStepZoom('fit', 'in', 63)).toBe(true);
      expect(canStepZoom(PREVIEW_ZOOM_MAX, 'in', 63)).toBe(false);
      expect(canStepZoom(PREVIEW_ZOOM_MIN, 'out', 63)).toBe(false);
    });
  });

  describe('zoomedBox（表示する箱の実寸）', () => {
    const box = { width: 640, height: 360 };

    it('フィットはそのまま', () => {
      expect(zoomedBox(box, 'fit', 63)).toEqual(box);
    });

    // ⚠️ **フィット時の%を基準に比を取る**＝フィットが 50% のとき 100% を選んだら**2倍**になる。
    // 「100% ＝ フィットの大きさ」にしてしまうと、倍率を選んでも見え方が変わらない。
    it('フィット時の見え方を基準に拡大する', () => {
      expect(zoomedBox(box, 100, 50)).toEqual({ width: 1280, height: 720 });
      expect(zoomedBox(box, 50, 100)).toEqual({ width: 320, height: 180 });
    });

    it('縦横比は保つ（片方だけ伸びない）', () => {
      const z = zoomedBox(box, 150, 75);
      expect(z.width / z.height).toBeCloseTo(box.width / box.height, 6);
    });
  });

  describe('fitPercentOf', () => {
    it('表示幅 / canvas 幅', () => {
      expect(fitPercentOf(960, 1920)).toBe(50);
      expect(fitPercentOf(1920, 1920)).toBe(100);
    });

    // ⚠️ **計測前（0）は 100 扱い**＝段が変な所へ飛ばない（0 で割らない）。
    it('計測前は 100 として扱う（段が飛ばない・0 で割らない）', () => {
      expect(fitPercentOf(0, 1920)).toBe(100);
      expect(fitPercentOf(960, 0)).toBe(100);
    });
  });
});
