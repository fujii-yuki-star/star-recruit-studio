import { describe, expect, it } from 'vitest';
import { runWithConcurrency } from './concurrency';

/** 手動で解決できる Promise（並行度の観測に使う）。 */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('runWithConcurrency', () => {
  it('同時に走る数が limit を超えない', async () => {
    const gates = [deferred(), deferred(), deferred(), deferred(), deferred()];
    let running = 0;
    let peak = 0;
    const done = runWithConcurrency([0, 1, 2, 3, 4], 2, async (i) => {
      running += 1;
      peak = Math.max(peak, running);
      await gates[i].promise;
      running -= 1;
    });
    // まだ誰も解決していない＝先頭2件だけが走っているはず。
    await Promise.resolve();
    expect(peak).toBe(2);
    for (const g of gates) g.resolve();
    await done;
    expect(peak).toBe(2);
  });

  it('全件を順に処理して開始件数を返す', async () => {
    const seen: string[] = [];
    const started = await runWithConcurrency(['a', 'b', 'c'], 1, async (x) => {
      seen.push(x);
    });
    expect(seen).toEqual(['a', 'b', 'c']);
    expect(started).toBe(3);
  });

  it('shouldStop が true になったら新しい仕事を始めない（実行中は最後まで走る）', async () => {
    const seen: number[] = [];
    let stop = false;
    const started = await runWithConcurrency([1, 2, 3, 4, 5], 1, async (n) => {
      seen.push(n);
      if (n === 2) stop = true; // 2件目の処理中に中止
      await Promise.resolve();
    }, { shouldStop: () => stop });
    expect(seen).toEqual([1, 2]); // 3件目以降は開始しない
    expect(started).toBe(2);
  });

  it('最初から shouldStop が true なら1件も始めない', async () => {
    let calls = 0;
    const started = await runWithConcurrency([1, 2, 3], 3, async () => {
      calls += 1;
    }, { shouldStop: () => true });
    expect(calls).toBe(0);
    expect(started).toBe(0);
  });

  it('limit が 0 以下でも 1 件ずつ走る（永久に止まらない）', async () => {
    const seen: number[] = [];
    const started = await runWithConcurrency([1, 2], 0, async (n) => {
      seen.push(n);
    });
    expect(seen).toEqual([1, 2]);
    expect(started).toBe(2);
  });

  it('空の入力では worker を呼ばない', async () => {
    let calls = 0;
    const started = await runWithConcurrency([], 3, async () => {
      calls += 1;
    });
    expect(calls).toBe(0);
    expect(started).toBe(0);
  });
});
