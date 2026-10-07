// 二度押しを送るテストが**実時間に依存して戻らない**ようにする門番（#645）。
//
// `pointerdown → pointerup → pointerdown` の並びは二度押し（`DOUBLE_TAP_MS`）の判定にかかる。
// `fireEvent` は**呼んだ瞬間**の実時刻をイベントに載せるので、間に走る再描画が経過時間に混ざり、
// 負荷が高いとしきい値を超えて落ちる。時刻を固定するヘルパー（`src/test/pointer.ts`）を通すこと。
// これは「直したことを将来も確認する手段」＝新しく素の並びが増えたらここで落ちる。
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');
const HELPER = 'test/pointer';
/** 素の二度押しの並び（間に何か挟まってもよいが、離れすぎたら別操作とみなして拾わない）。 */
const RAW_DOUBLE_TAP = /fireEvent\.pointerDown[\s\S]{0,400}?fireEvent\.pointerUp[\s\S]{0,400}?fireEvent\.pointerDown/;
/**
 * ⚠️ **テストの境目をまたいで拾わない**（#763）＝別の `it(` の押下は**別の操作**（間に描き直しも
 * 後片づけも入る）。文字の近さだけで見ると、隣り合う2つのテストの「押す→離す」と「押す」が
 * 二度押しに見える（実際に #763 で誤検知した）。境目で切ってから見る＝**1つのテストの中の
 * 本物の並びは、いままでどおり拾う**（下の「本物は拾う」テストで固定）。
 */
const splitByTest = (src: string): string[] => src.split(/\b(?:it|test)\s*\(/);

/** その中身に、素の二度押しが（ヘルパー無しで）入っているか。 */
function hasRawDoubleTap(src: string): boolean {
  return splitByTest(src).some((block) => RAW_DOUBLE_TAP.test(block)) && !src.includes(HELPER);
}

function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return testFiles(p);
    return /\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe('二度押しのテストは時刻を固定する（#645）', () => {
  it('素の pointerdown×2 を送っているテストは pointer ヘルパーを使っている', () => {
    const offenders = testFiles(SRC).filter((f) => hasRawDoubleTap(readFileSync(f, 'utf-8')));
    // 落ちたら：`doubleTap(el)` か `pointerDownAt(el, 時刻)` に置き換える（`src/test/pointer.ts`）。
    expect(offenders.map((f) => f.replace(SRC, 'src'))).toEqual([]);
  });

  // ⚠️ 門番そのものを確かめる（#763）＝境目で切る変更で**本物を見逃していない**ことを固定する。
  // 見逃す形にしても上のテストは緑のままなので、ここが無いと骨抜きに気づけない。
  it('1つのテストの中の本物の並びは拾う', () => {
    const real = `it('x', () => { fireEvent.pointerDown(el); fireEvent.pointerUp(el); fireEvent.pointerDown(el); });`;
    expect(hasRawDoubleTap(real)).toBe(true);
  });

  it('別々のテストにまたがる並びは拾わない（誤検知しない）', () => {
    const across = `it('a', () => { fireEvent.pointerDown(el); fireEvent.pointerUp(el); });\n`
      + `it('b', () => { fireEvent.pointerDown(el); });`;
    expect(hasRawDoubleTap(across)).toBe(false);
  });

  it('ヘルパーを使っているファイルは対象外', () => {
    const withHelper = `import { doubleTap } from '../test/pointer';\n`
      + `it('x', () => { fireEvent.pointerDown(el); fireEvent.pointerUp(el); fireEvent.pointerDown(el); });`;
    expect(hasRawDoubleTap(withHelper)).toBe(false);
  });
});
