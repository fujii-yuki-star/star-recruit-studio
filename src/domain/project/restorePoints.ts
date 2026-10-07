// 復元ポイント（#263 段階2）＝**過去の状態へ戻れる**ようにするための世代の決め方。
//
// ⚠️ **保存のたびに作らない**＝自動保存は3秒の無操作で走るので、そのまま世代にすると
// **何百個も溜まる**（容量より、選ぶときに見分けられなくなるほうが困る）。
// ⚠️ **規則はここに1つだけ置く**＝Rust 側にも画面側にも書かない（`volumeExpr` と同じ流儀）。
// 「いつ作るか」と「どれを残すか」は**同じ考え方の裏表**なので、離して持つとすぐ食い違う。

/** 世代を作る最短の間隔。これより近い保存では作らない。 */
export const RESTORE_POINT_MIN_INTERVAL_MS = 5 * 60 * 1000;

/**
 * 残す世代の数。
 *
 * ⚠️ **多すぎても選べない**＝一覧から選ぶものなので、画面に収まる数にする。
 * 最短間隔と掛けると **およそ1時間ぶん**（12 × 5分）＝「さっきの状態に戻したい」に足りる長さ。
 */
export const RESTORE_POINT_MAX = 12;

/** 1つの世代（作った時刻だけを持つ＝中身はファイル）。 */
export interface RestorePoint {
  /** ファイル名（`restore/` の中）。 */
  readonly name: string;
  /** 作った時刻（1970年からのミリ秒）。 */
  readonly savedAt: number;
}

/**
 * いま世代を作るか。
 *
 * ⚠️ **いちばん新しいものだけを見る**＝古いものが残っているかは関係ない
 * （消してから保存した直後に、間隔を無視して作ってしまう）。
 * ⚠️ **1つも無ければ作る**＝最初の保存で1つ持っておかないと、
 * 「5分たつ前に壊れた」ときに戻り先がゼロになる。
 */
export function shouldTakeRestorePoint(points: readonly RestorePoint[], now: number): boolean {
  if (points.length === 0) return true;
  const newest = points.reduce((m, p) => (p.savedAt > m.savedAt ? p : m));
  return now - newest.savedAt >= RESTORE_POINT_MIN_INTERVAL_MS;
}

/**
 * 消してよい世代（古いものから、上限を超えたぶん）。
 *
 * ⚠️ **新しいほうを残す**＝戻りたいのはたいてい直前の状態。
 * ⚠️ **これから作る1つぶんを空けておく**＝作ってから消すと、一瞬だけ上限を超える。
 */
export function restorePointsToDrop(
  points: readonly RestorePoint[],
  keep: number = RESTORE_POINT_MAX,
): RestorePoint[] {
  const sorted = [...points].sort((a, b) => b.savedAt - a.savedAt);
  return sorted.slice(Math.max(0, keep - 1));
}

/** 新しい順（画面に出す順）。 */
export function sortRestorePoints(points: readonly RestorePoint[]): RestorePoint[] {
  return [...points].sort((a, b) => b.savedAt - a.savedAt);
}
