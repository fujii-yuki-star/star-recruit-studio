// 変異チェックの「回った件数」を読む（純粋）。
//
// ⚠️ **ここが無いと、いちばん質の悪い嘘が通る**＝書き換えで**構文が壊れた**とき、
// vitest は「Tests  no tests」で赤を返す。実行係はそれを**「捕まえた」と数えてしまう**が、
// 実際には**その振る舞いは一度も試されていない**（2026-09-17 に実際に踏んだ＝
// `if (x) a; else b;` の `if` 行だけを置き換えて `else` が宙に浮いた）。

/**
 * vitest の「Tests …」行から、**回った総数**を返す。読めなければ `null`。
 *
 * 例: `Tests  180 passed (180)` → 180 ／ `Tests  1 failed | 179 passed (180)` → 180
 *     `Tests  no tests` → null ／ 行そのものが無いとき → null
 */
export function totalTests(line) {
  if (typeof line !== 'string') return null;
  const m = /\((\d+)\)\s*$/.exec(line.trim());
  return m ? Number(m[1]) : null;
}

/**
 * 変異させた回が「ちゃんと同じ検査を回した」かを見る。
 * 回った数がベースラインより**減っていたら**、壊れたのは振る舞いではなく**ファイル**。
 */
export function ranSameTests(baseTotal, mutantTotal) {
  if (baseTotal === null || mutantTotal === null) return false;
  return mutantTotal >= baseTotal;
}
