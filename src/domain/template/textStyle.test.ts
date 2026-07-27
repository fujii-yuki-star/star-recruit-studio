import { describe, expect, it } from 'vitest';
import { boxHeightForLines, DEFAULT_FONT_SIZE, DEFAULT_TEXT_COLOR, defaultStrokeColor, linesForBoxHeight, resolveStrokeColor, resolveTextStyle, STROKE_COLOR_ON_DARK, STROKE_COLOR_ON_LIGHT } from './textStyle';
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
  // 既定色は**文字色と反対側**（#565）＝この層は白文字なので黒。固定の白だと白文字に白い縁取りが付いて、
  // 結局「太さを入れたのに何も起きない」に戻る（このフィクスチャ自体がその実例だった）。
  it('太さ>0 で色が無ければ既定色（層に太さがある場合）', () => {
    expect(resolveTextStyle({ ...layer, strokeWidth: 3 }).strokeColor).toBe(STROKE_COLOR_ON_LIGHT);
  });

  it('太さ>0 で色が無ければ既定色（場面で太さだけ足した場合）', () => {
    expect(resolveTextStyle(layer, { strokeWidth: 3 }).strokeColor).toBe(STROKE_COLOR_ON_LIGHT);
  });

  it('暗い文字なら既定の縁取りは白（#275 以来の挙動）', () => {
    expect(resolveTextStyle({ ...layer, color: undefined, strokeWidth: 3 }).strokeColor).toBe(STROKE_COLOR_ON_DARK);
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

  // 判定は**解決後**の文字色＝場面で色を変えた瞬間から既定の縁取りもそれに合う（#565・ADR-0026①）。
  it('場面で文字色を白へ変えたら、既定の縁取りも黒へ切り替わる', () => {
    const dark: TextStyleSource = { ...layer, color: '#222222' };
    expect(resolveTextStyle(dark, { strokeWidth: 3 }).strokeColor).toBe(STROKE_COLOR_ON_DARK);
    expect(resolveTextStyle(dark, { strokeWidth: 3, color: '#ffffff' }).strokeColor).toBe(STROKE_COLOR_ON_LIGHT);
  });
});

// 縁取り/枠線の色の既定を決める単一の参照元（#565）。通常テンプレの文字・FREE の文字/字幕/図形・色見本が共有する。
describe('defaultStrokeColor / resolveStrokeColor（縁取りの既定色・#565）', () => {
  it('暗い下地には白・明るい下地には黒（既定の文字色は #275 以来の白のまま）', () => {
    expect(defaultStrokeColor(DEFAULT_TEXT_COLOR)).toBe(STROKE_COLOR_ON_DARK); // #222222
    expect(defaultStrokeColor('#333333')).toBe(STROKE_COLOR_ON_DARK);
    expect(defaultStrokeColor('#ffffff')).toBe(STROKE_COLOR_ON_LIGHT);
    expect(defaultStrokeColor('#dddddd')).toBe(STROKE_COLOR_ON_LIGHT);
    expect(defaultStrokeColor('#cccccc')).toBe(STROKE_COLOR_ON_LIGHT); // 図形の描画フォールバック側
  });

  it('色みの明るさの違いを見る（緑は明るく青は暗い）＝RGB の単純平均ではない', () => {
    expect(defaultStrokeColor('#00ff00')).toBe(STROKE_COLOR_ON_LIGHT); // 純緑は明るい＝黒縁
    expect(defaultStrokeColor('#0000ff')).toBe(STROKE_COLOR_ON_DARK); // 純青は暗い＝白縁
  });

  it('色として読めない値は白＝#275 以来の既定へ倒す（例外にしない）', () => {
    expect(defaultStrokeColor('')).toBe(STROKE_COLOR_ON_DARK);
    expect(defaultStrokeColor('rgb(255,255,255)')).toBe(STROKE_COLOR_ON_DARK);
    expect(defaultStrokeColor('#fff')).toBe(STROKE_COLOR_ON_LIGHT); // 短縮形は解釈する（schema 外の手書きデータ）
  });

  it('太さ>0 で色が無いときだけ既定色を入れる（指定色はそのまま・太さ0では色を消さない）', () => {
    expect(resolveStrokeColor(3, undefined, '#ffffff')).toBe(STROKE_COLOR_ON_LIGHT);
    expect(resolveStrokeColor(3, '#00ff00', '#ffffff')).toBe('#00ff00');
    expect(resolveStrokeColor(0, undefined, '#ffffff')).toBeUndefined();
    expect(resolveStrokeColor(undefined, undefined, '#ffffff')).toBeUndefined();
    // 太さを 0 に戻しても選んだ色は残す＝また太くすれば同じ色で戻る。
    expect(resolveStrokeColor(0, '#00ff00', '#ffffff')).toBe('#00ff00');
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
