import { describe, expect, it } from 'vitest';
import { layerStyles } from './transitionLayerStyles';
import type { BoundaryTransition } from '../../domain/project/sceneTransitions';

// TransitionPreview の補間ロジック（fade=opacity・slide=押し出しの translate%）を単体で固定する（#408 Part 2）。
// スクリーンショットに頼らず「書き出し xfade と同じ見え方」の要（B が入り、A が方向へ抜ける）を検証する。
const b = (type: BoundaryTransition['type'], direction: BoundaryTransition['direction'] = 'left'): BoundaryTransition => ({
  type, direction, durationSec: 0.5,
});

describe('layerStyles（#408 Part 2 の切替効果プレビュー補間）', () => {
  it('fade：A は不透明のまま、B を上に opacity 0→1（クロスフェード）', () => {
    expect(layerStyles(b('fade'), 0).b.opacity).toBe(0); // 開始＝B 透明（A が見える）
    expect(layerStyles(b('fade'), 0.5).b.opacity).toBe(0.5);
    expect(layerStyles(b('fade'), 1).b.opacity).toBe(1); // 終了＝B 完全表示
    expect(layerStyles(b('fade'), 0.5).a.opacity).toBe(1); // A は下で不透明のまま
    expect(layerStyles(b('fade'), 0.5).a.transform).toBeUndefined(); // fade は移動しない
  });

  it('slide-left：A が左へ抜け（0→-100%）、B が右から入る（+100%→0）＝押し出し', () => {
    expect(layerStyles(b('slide', 'left'), 0)).toMatchObject({
      a: { transform: 'translateX(0%)' }, b: { transform: 'translateX(100%)' },
    });
    expect(layerStyles(b('slide', 'left'), 1)).toMatchObject({
      a: { transform: 'translateX(-100%)' }, b: { transform: 'translateX(0%)' },
    });
  });

  it('slide-right：A が右へ（0→+100%）、B が左から（-100%→0）', () => {
    expect(layerStyles(b('slide', 'right'), 1)).toMatchObject({
      a: { transform: 'translateX(100%)' }, b: { transform: 'translateX(0%)' },
    });
    expect(layerStyles(b('slide', 'right'), 0).b.transform).toBe('translateX(-100%)');
  });

  it('slide-up：Y 軸・A が上へ（0→-100%）、B が下から（+100%→0）', () => {
    expect(layerStyles(b('slide', 'up'), 1)).toMatchObject({
      a: { transform: 'translateY(-100%)' }, b: { transform: 'translateY(0%)' },
    });
    expect(layerStyles(b('slide', 'up'), 0).b.transform).toBe('translateY(100%)');
  });

  it('slide-down：Y 軸・A が下へ（0→+100%）、B が上から（-100%→0）', () => {
    expect(layerStyles(b('slide', 'down'), 1)).toMatchObject({
      a: { transform: 'translateY(100%)' }, b: { transform: 'translateY(0%)' },
    });
    expect(layerStyles(b('slide', 'down'), 0).b.transform).toBe('translateY(-100%)');
  });

  it('両レイヤとも fit 箱を充填する絶対配置（inset:0）', () => {
    const s = layerStyles(b('fade'), 0.5);
    expect(s.a.position).toBe('absolute');
    expect(s.b.position).toBe('absolute');
    expect(s.a.inset).toBe(0);
  });
});
