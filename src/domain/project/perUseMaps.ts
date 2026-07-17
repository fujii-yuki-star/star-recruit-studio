// per-use 上書きマップ（ADR-0028 D6 の3マップ）の共通ライフサイクル。純粋関数（副作用なし・§4）。
//
// D6 は「**スロットが消滅したら3マップとも当該キーを掃除**（FREE スロット要素の削除・スロット非割当・素材差し替えで
// スロットでなくなる 等）」「掃除/複製は**3マップ共通のヘルパ1か所**で行う（実装PRで確定）」「将来 per-use マップを
// 増やすときも同ヘルパに足す」と定めている。ここがその1か所。
import type { Scene } from './types';

/** D6 の3マップだけを取り出した型（呼び出し側は Scene をそのまま渡せる）。 */
export type PerUseMaps = Pick<Scene, 'slotFits' | 'slotClips' | 'slotVideoStart'>;

/**
 * 消えたスロット（FREE 要素 id／テンプレの layer.id）のキーを3マップから落とす（ADR-0028 D6）。
 *
 * **なぜ必要か**＝`free_NNN` の採番（`createFreeElementId`）は**歯抜けの最小番号を再利用する**ため、孤児エントリは
 * 休眠では済まない：`free_002` を消して残った `slotClips.free_002` は、次に発行された別の `free_002` に**憑依**し、
 * 「設定した覚えのないクリップ範囲・速度・再生開始タイミングが黙って効く」ことになる（ADR-0026① の裏面）。
 *
 * 変化が無いマップは**同一参照**を返す（未保存/履歴を無駄に作らない）。空になったら `undefined`（意味のない {} を
 * 永続化しない＝`textStyles`/`slotFits` 等と同じ流儀）。返り値は Scene へスプレッドして使う。
 */
export function prunePerUseMaps(scene: PerUseMaps, removedIds: readonly string[]): PerUseMaps {
  if (removedIds.length === 0) return { slotFits: scene.slotFits, slotClips: scene.slotClips, slotVideoStart: scene.slotVideoStart };
  const gone = new Set(removedIds);
  const prune = <V>(m: Record<string, V> | undefined): Record<string, V> | undefined => {
    if (!m) return undefined;
    const keep = Object.keys(m).filter((k) => !gone.has(k));
    if (keep.length === Object.keys(m).length) return m; // 変化なし＝同一参照
    return keep.length ? Object.fromEntries(keep.map((k) => [k, m[k]])) : undefined;
  };
  return {
    slotFits: prune(scene.slotFits),
    slotClips: prune(scene.slotClips),
    slotVideoStart: prune(scene.slotVideoStart),
  };
}
