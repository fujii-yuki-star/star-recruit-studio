// 区間のコマを、本体と隠した別の窓で分けて描く段取り（ADR-0070）。
import { describe, expect, it } from 'vitest';
import { ExportCancelledError } from './buildExportScenes';
import { drawRangesInParallel, frameChunks, type FrameDrawer, type FrameRange } from './parallelFrames';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 描いた範囲を覚える偽の描き手。`fail` に当たった範囲で失敗する。 */
function drawer(log: string[], name: string, opts: { delay?: number; fail?: (r: FrameRange) => boolean } = {}): FrameDrawer & { aborted: boolean } {
  const d = {
    aborted: false,
    async draw(r: FrameRange, onProgress: (n: number) => void) {
      await sleep(opts.delay ?? 1);
      if (opts.fail?.(r)) throw new Error(`${name} failed`);
      onProgress(r.toFrame - r.fromFrame);
      log.push(`${name}:${r.fromFrame}-${r.toFrame}`);
    },
    abort() { d.aborted = true; },
  };
  return d;
}

const covered = (log: string[]) => log.map((l) => l.split(':')[1]).sort((a, b) => Number(a.split('-')[0]) - Number(b.split('-')[0]));

describe('frameChunks', () => {
  it('範囲を決まった数ずつに分け、最後は余り（隙間も重なりも無い）', () => {
    expect(frameChunks(10, 35, 10)).toEqual([
      { fromFrame: 10, toFrame: 20 },
      { fromFrame: 20, toFrame: 30 },
      { fromFrame: 30, toFrame: 35 },
    ]);
    expect(frameChunks(0, 0, 10)).toEqual([]);
  });
});

describe('drawRangesInParallel', () => {
  it('全部の範囲がちょうど1回ずつ描かれる（本体も窓も取りに行く）', async () => {
    const log: string[] = [];
    const ranges = frameChunks(0, 100, 10);
    await drawRangesInParallel(ranges, [drawer(log, 'main', { delay: 3 }), drawer(log, 'w1', { delay: 2 }), drawer(log, 'w2', { delay: 2 })]);
    expect(covered(log)).toEqual(ranges.map((r) => `${r.fromFrame}-${r.toFrame}`));
    expect(new Set(log.map((l) => l.split(':')[0]))).toEqual(new Set(['main', 'w1', 'w2']));
  });

  it('窓が落ちたら、その範囲をほかの描き手が描き直す（コマを抜かさない）・その窓はもう使わない', async () => {
    const log: string[] = [];
    const ranges = frameChunks(0, 60, 10);
    const bad = drawer(log, 'w1', { delay: 1, fail: () => true });
    await drawRangesInParallel(ranges, [drawer(log, 'main', { delay: 2 }), bad]);
    expect(covered(log)).toEqual(ranges.map((r) => `${r.fromFrame}-${r.toFrame}`));
    expect(log.every((l) => l.startsWith('main:'))).toBe(true);
  });

  it('本体が描き終わった後に窓が落ちても、戻った範囲を本体が描く（待ってから抜ける）', async () => {
    const log: string[] = [];
    const ranges = frameChunks(0, 20, 10);
    // 窓は 10-20 を長く抱えてから落ちる。本体は 0-10 をすぐ描き終える。
    const slowBad: FrameDrawer = {
      async draw(r) { await sleep(30); throw new Error(`late fail ${r.fromFrame}`); },
    };
    const main = drawer(log, 'main', { delay: 1 });
    // 窓が先に 0-10 を取らないよう、本体を先に並べる（本体が 0-10・窓が 10-20）。
    await drawRangesInParallel(ranges, [main, slowBad]);
    expect(covered(log)).toEqual(['0-10', '10-20']);
  });

  it('本体が失敗したら全体を止め、窓にも止めさせる', async () => {
    const log: string[] = [];
    const w1 = drawer(log, 'w1', { delay: 5 });
    await expect(drawRangesInParallel(frameChunks(0, 100, 10), [drawer(log, 'main', { fail: () => true }), w1]))
      .rejects.toThrow('main failed');
    expect(w1.aborted).toBe(true);
  });

  it('中止したら新しい範囲を取らず、中止として返す', async () => {
    const log: string[] = [];
    let cancel = false;
    const main: FrameDrawer = {
      async draw(r, onProgress) { await sleep(1); onProgress(r.toFrame - r.fromFrame); log.push(`main:${r.fromFrame}`); cancel = true; },
    };
    await expect(drawRangesInParallel(frameChunks(0, 100, 10), [main], { shouldCancel: () => cancel }))
      .rejects.toBeInstanceOf(ExportCancelledError);
    expect(log).toHaveLength(1);
  });

  it('進み具合は置き終えたコマの合計（落ちた窓のぶんは数え直す＝行き過ぎない）', async () => {
    const seen: number[] = [];
    const half: FrameDrawer = {
      async draw(r, onProgress) { onProgress(5); await sleep(2); throw new Error(`half ${r.fromFrame}`); },
    };
    await drawRangesInParallel(frameChunks(0, 30, 10), [drawer([], 'main', { delay: 4 }), half], { onProgress: (n) => seen.push(n) });
    expect(Math.max(...seen)).toBe(30);
    expect(seen[seen.length - 1]).toBe(30);
  });
});
