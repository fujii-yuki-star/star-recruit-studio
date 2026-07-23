// 同時実行数を絞って順に処理する小さなヘルパ（#547 P2-6）。
//
// なぜ必要か：一括処理を `Promise.all` で一度に全部走らせると、**まだ始まっていない仕事が存在しない**ため
// 「中止」を押しても止められるものが無い＝ボタンがあるのに効かない（ADR-0026④「壊れて見える仕様止まり」）。
// 同時実行数を絞れば残りは待機列に残るので、中止が実際に効く。あわせて進捗も少しずつ進む（一気に終わって見えない）。
//
// 副作用を持たない純粋な制御構造＝§7 のテスト対象。
export interface RunWithConcurrencyOptions {
  /** true を返した時点で**新しい仕事を始めない**。実行中の仕事は最後まで走る（作りかけを捨てない）。 */
  shouldStop?: () => boolean;
}

/**
 * `items` を最大 `limit` 件ずつ並行に `worker` へ渡す。全件（または中止まで）終わったら**実際に開始した件数**を返す。
 *
 * - `limit` は 1 以上に丸める（0 や負値で永久に何も走らない、を作らない）。
 * - `worker` が投げた例外はここでは握らない＝呼び出し側の責務（既存の生成処理は行ごとに try/catch 済み）。
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
  options?: RunWithConcurrencyOptions,
): Promise<number> {
  const width = Math.max(1, Math.floor(limit));
  let next = 0;
  let started = 0;
  const pump = async (): Promise<void> => {
    for (;;) {
      if (options?.shouldStop?.()) return;
      const index = next;
      if (index >= items.length) return;
      next += 1;
      started += 1;
      await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, () => pump()));
  return started;
}
