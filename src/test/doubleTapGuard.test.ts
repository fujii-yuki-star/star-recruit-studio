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

function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return testFiles(p);
    return /\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe('二度押しのテストは時刻を固定する（#645）', () => {
  it('素の pointerdown×2 を送っているテストは pointer ヘルパーを使っている', () => {
    const offenders = testFiles(SRC).filter((f) => {
      const s = readFileSync(f, 'utf-8');
      return RAW_DOUBLE_TAP.test(s) && !s.includes(HELPER);
    });
    // 落ちたら：`doubleTap(el)` か `pointerDownAt(el, 時刻)` に置き換える（`src/test/pointer.ts`）。
    expect(offenders.map((f) => f.replace(SRC, 'src'))).toEqual([]);
  });
});
