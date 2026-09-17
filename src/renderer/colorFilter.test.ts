// 色の調整を SVG の `<filter>` へ落とす（ADR-0044 ①）。
//
// ⚠️ **ここが間違うと、プレビューと書き出しが同じだけ間違う**（同じ道を通るので）＝
// 「一致しているから正しい」とは言えない。**数字の意味**をここで固定する。
import { describe, expect, it } from 'vitest';
import { colorFilterBody, colorFilterDefs, colorFilterId, needsColorFilter } from './colorFilter';

describe('調整が要るかどうか', () => {
  // ⚠️ **要らないときは `<filter>` を出さない**＝通すだけで絵がわずかに変わる（縁・色空間の往復）。
  it('未指定・素の値なら、フィルタを出さない', () => {
    expect(needsColorFilter(undefined)).toBe(false);
    expect(needsColorFilter({})).toBe(false);
    expect(needsColorFilter({ brightness: 1, contrast: 1, saturation: 1, temperature: 0 })).toBe(false);
  });

  it('1つでも動いていれば出す', () => {
    expect(needsColorFilter({ brightness: 1.2 })).toBe(true);
    expect(needsColorFilter({ contrast: 0.8 })).toBe(true);
    expect(needsColorFilter({ saturation: 0 })).toBe(true);
    expect(needsColorFilter({ temperature: -0.3 })).toBe(true);
  });
});

describe('id は中身から作る（影と同じ流儀）', () => {
  // ⚠️ **同じ調整は同じ id**＝`<defs>` を共有でき、`layoutToSvg` が重複を畳める。
  it('同じ調整なら同じ id', () => {
    expect(colorFilterId({ brightness: 1.2 })).toBe(colorFilterId({ brightness: 1.2, contrast: 1 }));
  });

  it('違う調整なら違う id', () => {
    expect(colorFilterId({ brightness: 1.2 })).not.toBe(colorFilterId({ brightness: 1.3 }));
  });

  // ⚠️ **id に使えない文字を残さない**＝`-0.3` の `.`・`-` がそのまま入ると SVG が壊れる。
  it('負の値や小数でも、id として使える形になる', () => {
    expect(colorFilterId({ temperature: -0.3 })).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('フィルタの中身', () => {
  // ⚠️ **明るさとコントラストは1つの一次変換にまとめる**＝2回通すと縁の扱いが2回掛かる。
  it('明るさは slope になる', () => {
    expect(colorFilterBody({ brightness: 2 })).toContain('slope="2"');
  });

  // ⚠️ **コントラストは中心 0.5 を保って伸ばす**＝そうしないと、上げるほど全体が明るくなる。
  it('コントラストは中心を保つ（intercept が付く）', () => {
    const body = colorFilterBody({ contrast: 2 });
    expect(body).toContain('slope="2"');
    expect(body).toContain('intercept="-0.5"');
  });

  it('彩度は saturate', () => {
    expect(colorFilterBody({ saturation: 0 })).toContain('type="saturate" values="0"');
  });

  // ⚠️ **色温度は赤と青を逆向きに**＝同じ向きに動かすと、ただ明るくなるだけになる。
  it('色温度は赤と青を逆向きに動かす', () => {
    const warm = colorFilterBody({ temperature: 1 });
    expect(warm).toContain('1.2 0 0 0 0');
    expect(warm).toContain('0 0 0.8 0 0');
  });

  it('素の値の項目は書かない（SVG を無駄に長くしない）', () => {
    const body = colorFilterBody({ saturation: 0.5 });
    expect(body).not.toContain('feComponentTransfer');
    expect(body).not.toContain('type="matrix"');
  });
});

describe('掛ける順（自分で書いた主張を検査する）', () => {
  // ⚠️ **コメントに書いた主張は変異にする**（`CLAUDE.md §7`）＝
  //「明るさ→コントラスト→彩度→色温度の順で掛ける」と書いたのに、
  // **順番を入れ替える変異が生き残った**（＝検査していなかった）。
  // ⚠️ **順番は絵を変える**＝彩度を先に掛けると、持ち上げる前の色で彩度が決まる。
  it('明るさ・コントラスト → 彩度 → 色温度 の並びで出る', () => {
    const body = colorFilterBody({ brightness: 1.2, contrast: 1.5, saturation: 0.5, temperature: 0.5 });
    const iTransfer = body.indexOf('<feComponentTransfer>');
    const iSaturate = body.indexOf('type="saturate"');
    const iMatrix = body.indexOf('type="matrix"');
    expect(iTransfer).toBeGreaterThanOrEqual(0);
    expect(iSaturate).toBeGreaterThan(iTransfer);
    expect(iMatrix).toBeGreaterThan(iSaturate);
  });
});

describe('`<defs>` の形', () => {
  // ⚠️ **いちばん間違えやすい所**＝既定の色空間は linearRGB で、
  // 付け忘れると「明るさ 0.5」が画面上 187 になる（実測）＝数字と見た目が合わない。
  it('色空間を sRGB に指定している', () => {
    expect(colorFilterDefs({ brightness: 0.5 })).toContain('color-interpolation-filters="sRGB"');
  });

  it('id を持った filter を defs で包む', () => {
    const defs = colorFilterDefs({ brightness: 0.5 });
    expect(defs.startsWith('<defs><filter id="color-')).toBe(true);
    expect(defs.endsWith('</filter></defs>')).toBe(true);
  });
});
