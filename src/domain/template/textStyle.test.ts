import { describe, expect, it } from 'vitest';
import { boxHeightForLines, DEFAULT_FONT_SIZE, DEFAULT_STROKE_COLOR, DEFAULT_TEXT_COLOR, linesForBoxHeight, resolveTextStyle } from './textStyle';
import type { TextStyleSource } from './textStyle';

// #555：場面の上書き（textStyles）→ テンプレ層 → 既定 の継承解決。描画（layoutScene）・場面編集の体裁欄・
// 通常→FREE 変換（freeLayoutFromPlacedContent）が共有する単一の参照元（§2-7）。
describe('resolveTextStyle（文字の体裁の継承解決・#555）', () => {
  const bare: TextStyleSource = {};
  const layer: TextStyleSource = { color: '#ffffff', fontSize: 64, fontWeight: 'bold' };

  it('層も上書きも無ければ既定へ', () => {
    expect(resolveTextStyle(bare)).toEqual({
      color: DEFAULT_TEXT_COLOR,
      fontSize: DEFAULT_FONT_SIZE,
      fontWeight: 'normal',
      strokeColor: undefined,
      strokeWidth: undefined,
    });
  });

  it('上書きが無ければテンプレ層を継承する', () => {
    expect(resolveTextStyle(layer)).toMatchObject({ color: '#ffffff', fontSize: 64, fontWeight: 'bold' });
  });

  it('上書きがテンプレ層に勝つ', () => {
    expect(resolveTextStyle(layer, { color: '#ff0000', fontSize: 96 })).toMatchObject({ color: '#ff0000', fontSize: 96 });
  });

  it('各プロパティは独立＝指定したものだけ固有値', () => {
    expect(resolveTextStyle(layer, { fontSize: 96 })).toMatchObject({ color: '#ffffff', fontSize: 96, fontWeight: 'bold' });
  });

  // `??` で繋ぐので falsy な有効値が継承に倒れない。`||` だと 0 が継承へ落ちる（縁取りを消せなくなる）。
  it('strokeWidth: 0（縁取りなしの明示）は継承に倒れない', () => {
    const withStroke: TextStyleSource = { ...layer, strokeColor: '#000000', strokeWidth: 8 };
    const r = resolveTextStyle(withStroke, { strokeWidth: 0 });
    expect(r.strokeWidth).toBe(0);
    expect(r.strokeColor).toBe('#000000'); // 太さ0 では色を既定化しない（層の色をそのまま返す）
  });

  it('fontWeight: normal はテンプレ層の bold を上書きできる', () => {
    expect(resolveTextStyle(layer, { fontWeight: 'normal' }).fontWeight).toBe('normal');
  });

  // 縁取りは「太さ>0 なのに色が無いと silent に消える」を防ぐ既定を持つ（#275/PR#289）。
  // **上書きを解決したあとの太さ**で判定する＝場面で太さだけ足しても縁取りが消えない。
  it('太さ>0 で色が無ければ既定色（層に太さがある場合）', () => {
    expect(resolveTextStyle({ ...layer, strokeWidth: 3 }).strokeColor).toBe(DEFAULT_STROKE_COLOR);
  });

  it('太さ>0 で色が無ければ既定色（場面で太さだけ足した場合）', () => {
    expect(resolveTextStyle(layer, { strokeWidth: 3 }).strokeColor).toBe(DEFAULT_STROKE_COLOR);
  });

  it('太さが 0/未指定なら色を既定化しない（縁取りなし）', () => {
    expect(resolveTextStyle(layer).strokeColor).toBeUndefined();
    expect(resolveTextStyle(layer, { strokeWidth: 0 }).strokeColor).toBeUndefined();
  });

  it('色だけ上書きしても、太さが無ければ縁取りは付かない', () => {
    const r = resolveTextStyle(layer, { strokeColor: '#0000ff' });
    expect(r.strokeWidth).toBeUndefined();
    expect(r.strokeColor).toBe('#0000ff'); // 値は保つ（太さを足せばこの色で出る）
  });

  it('空の上書きオブジェクトは継承と同じ（{} を保存しても壊れない）', () => {
    expect(resolveTextStyle(layer, {})).toEqual(resolveTextStyle(layer));
  });
});

// 通常テンプレ（maxLines で行数が決まる）と FREE（枠高から行数を導出）の橋渡し。
// 通常→FREE 変換が行数を保てるのは、この2つが逆関数であることに依存している（#555 レビュー P1）。
describe('linesForBoxHeight / boxHeightForLines（行数と枠高の相互変換・#555）', () => {
  it('枠高から行数を導出する（FREE のモデル）', () => {
    expect(linesForBoxHeight(52, 40)).toBe(1); // 40*1.3 = 52 でちょうど1行
    expect(linesForBoxHeight(104, 40)).toBe(2);
    expect(linesForBoxHeight(140, 72)).toBe(1); // 標準テンプレの見出し層＝そのままでは1行しか入らない
  });

  it('行数が足りない枠高でも 1 行は下回らない', () => {
    expect(linesForBoxHeight(1, 96)).toBe(1);
    expect(linesForBoxHeight(0, 96)).toBe(1);
  });

  // 「ceil すれば逆関数」は成り立たない（ceil(5*12*1.3)=78 だが 78/(12*1.3)=4.999999999999999 で1行減る）。
  // 丸めの偶然に頼っていないことを、実際に使う寸法の全組合せで固定する。
  it('往復する＝boxHeightForLines が返す高さは必ずその行数に戻る（丸めで1行減らない）', () => {
    for (const fontSize of [12, 24, 40, 48, 64, 72, 96, 120, 200]) {
      for (let lines = 1; lines <= 8; lines += 1) {
        expect(linesForBoxHeight(boxHeightForLines(lines, fontSize), fontSize)).toBe(lines);
      }
    }
  });

  it('返す高さは必要最小限（1行ぶん余計に取らない）', () => {
    for (const fontSize of [40, 72, 96]) {
      for (let lines = 1; lines <= 4; lines += 1) {
        const h = boxHeightForLines(lines, fontSize);
        expect(linesForBoxHeight(h - 1, fontSize)).toBeLessThan(lines + 1); // これ以上は縮められない付近
        expect(h).toBeLessThan(Math.ceil((lines + 1) * fontSize * 1.3)); // +1行ぶんは取らない
      }
    }
  });

  it('行間を変えても往復する', () => {
    for (const lh of [0.5, 1, 1.3, 2, 3]) {
      expect(linesForBoxHeight(boxHeightForLines(3, 48, lh), 48, lh)).toBe(3);
    }
  });

  it('0/負の行数でも 1 行ぶんの高さを返す（潰れた枠を作らない）', () => {
    expect(boxHeightForLines(0, 40)).toBe(52);
    expect(boxHeightForLines(-2, 40)).toBe(52);
  });
});
