import { describe, expect, it } from 'vitest';
// @ts-expect-error -- 実行係（scripts/）は型定義を持たない素の ESM
import { ranSameTests, totalTests } from '../../scripts/mutateCounts.mjs';

/**
 * 変異チェックの実行係そのものの検査（CLAUDE.md §7）。
 *
 * ⚠️ **門番を書いたら門番自身を壊して確かめる**＝ここが無いと、
 * 「件数を読む規則」を壊しても、いまの出力がたまたま読めている間は緑のまま。
 */
describe('変異チェックが「ちゃんと回ったか」を見分ける', () => {
  it('全部通った回の総数を読む', () => {
    expect(totalTests('  Tests  180 passed (180)')).toBe(180);
  });

  it('落ちた回でも総数を読む', () => {
    expect(totalTests('  Tests  1 failed | 179 passed (180)')).toBe(180);
  });

  it('1件も回らなかった回は読めない（null）', () => {
    expect(totalTests('  Tests  no tests')).toBeNull();
  });

  it('行そのものが取れなかったときも null', () => {
    expect(totalTests('(件数の行が取れなかった)')).toBeNull();
    expect(totalTests(undefined)).toBeNull();
  });

  it('同じだけ回っていれば「回った」と見る', () => {
    expect(ranSameTests(180, 180)).toBe(true);
  });

  it('増えるぶんには構わない（変異で検査が増えることはないが、止める理由もない）', () => {
    expect(ranSameTests(180, 181)).toBe(true);
  });

  it('⚠️ 減っていたら「ファイルを壊した」＝赤くても捕まえたと数えない', () => {
    expect(ranSameTests(180, 179)).toBe(false);
  });

  it('⚠️ 1件も回らなかった回は、赤くても捕まえたと数えない', () => {
    expect(ranSameTests(180, null)).toBe(false);
  });

  // ⚠️ **これが無いと、`null` を弾く分岐を外しても緑のまま**（`null >= 180` は false なので）。
  //『検査が1件も無い』ときだけ差が出る＝`null >= 0` は **true** になってしまう。
  it('⚠️ 元が0件でも、回らなかった回は通さない（数の大小に頼らない）', () => {
    expect(ranSameTests(0, null)).toBe(false);
  });
});
