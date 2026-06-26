// 取り消し/やり直し（Undo/Redo）の純粋スタック操作（ADR-0020・#211）。
// スナップショット方式：文書slice（meta/parts/scenes）の値を past/future に積み替えるだけ。
// store はこの純粋関数を薄く繋ぐ（§4：履歴の中核は domain・副作用なし＝§7 テスト対象）。

/** 履歴に積む最大件数（これを超えたら古い方から捨てる・§6 定数）。 */
export const HISTORY_LIMIT = 50;

export interface HistoryStacks<T> {
  /** 過去（undo で戻る先）。末尾が直近。 */
  past: T[];
  /** 未来（redo でやり直す先）。末尾が直近に取り消したもの。 */
  future: T[];
}

/** 空の履歴（プロジェクトを開く/新規で使う）。 */
export function emptyHistory<T>(): HistoryStacks<T> {
  return { past: [], future: [] };
}

/**
 * 現在のスナップショット current を past に積み、future を捨てる（新しい操作で「やり直し」分岐は消える）。
 * 操作の「適用前」に呼ぶ＝past には各編集の直前状態が積まれる。上限超過は古い方から落とす。
 */
export function recordSnapshot<T>(h: HistoryStacks<T>, current: T, limit = HISTORY_LIMIT): HistoryStacks<T> {
  const past = [...h.past, current];
  return {
    past: past.length > limit ? past.slice(past.length - limit) : past,
    future: [],
  };
}

/**
 * undo：past の末尾を復元値として返し、現在値 current を future へ送る。戻せなければ null。
 * 呼び出し側は restored（meta/parts/scenes）を現在状態へ差し替え、history を置き換える。
 */
export function undoSnapshot<T>(h: HistoryStacks<T>, current: T): { history: HistoryStacks<T>; restored: T } | null {
  if (h.past.length === 0) return null;
  const restored = h.past[h.past.length - 1];
  return {
    history: { past: h.past.slice(0, -1), future: [...h.future, current] },
    restored,
  };
}

/**
 * redo：future の末尾を復元値として返し、現在値 current を past へ戻す。やり直せなければ null。
 */
export function redoSnapshot<T>(h: HistoryStacks<T>, current: T): { history: HistoryStacks<T>; restored: T } | null {
  if (h.future.length === 0) return null;
  const restored = h.future[h.future.length - 1];
  return {
    history: { past: [...h.past, current], future: h.future.slice(0, -1) },
    restored,
  };
}
