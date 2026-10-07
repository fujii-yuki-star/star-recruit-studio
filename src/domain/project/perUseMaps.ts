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

/**
 * per-use マップの**顔ぶれ**（D6 の「将来 per-use マップを増やすときも同ヘルパに足す」の単一の参照元）。
 *
 * ⚠️ **`PerUseMaps` にマップを1本足すと、ここがコンパイルエラーになる**（キーが足りない）＝
 * 「落とす・取り出す・入れるの3つ**全部**へ足す」合図。**型だけでは足りない**＝`Scene` の各マップは
 * 任意（`?`）なので、どれか1つの関数が足し忘れても戻り型は通ってしまい、**複製で1本だけ黙って落ちる**。
 * そこで、この表を回して3関数が全キーを面倒みているかを**テストで**確かめる（`perUseMaps.test.ts`）。
 */
export const PER_USE_MAP_KEYS: Record<keyof PerUseMaps, true> = { slotFits: true, slotClips: true, slotVideoStart: true };

/**
 * 1つの要素ぶんの per-use 上書きを取り出したもの（**写す→貼る**の間で持ち運ぶ・#770）。
 * 元が持っていない項目は `undefined`（意味のない既定値を運ばない）。
 */
export type PerUseEntries = { [K in keyof PerUseMaps]: NonNullable<PerUseMaps[K]>[string] | undefined };

/**
 * 要素ひとつぶんの per-use 上書きを**取り出す**（複製・コピーの前半・#770）。
 *
 * ⚠️ **コピーは押した時点で取り出すこと**＝貼るのは別の場面かもしれず、そのとき元をたどれない。
 * 要素そのもの（`FreeElement`）を控えるのと同じ扱いにする（元を消してから貼っても中身が揃う）。
 */
export function perUseEntriesFor(scene: PerUseMaps, id: string): PerUseEntries {
  return {
    slotFits: scene.slotFits?.[id],
    slotClips: scene.slotClips?.[id],
    slotVideoStart: scene.slotVideoStart?.[id],
  };
}

/**
 * 取り出した per-use 上書きを、複製先の id で**入れる**（複製・貼り付けの後半・#770）。
 *
 * **なぜ必要か**＝入れないと、**複製した瞬間に設定が落ちた別物**ができる（動画の使う範囲・速度・
 * 再生の開始タイミング・収め方が既定へ戻る）。消す側は `prunePerUseMaps` で3マップを対で片づけて
 * いるのに、複製側だけ欠けていた＝**同じ概念の片側だけを面倒みる**非対称（ADR-0026②）。
 *
 * 入れるものが無いマップは**同一参照**を返す（未保存/履歴を無駄に作らない＝`prunePerUseMaps` と同じ流儀）。
 * 返り値は Scene へスプレッドして使う。
 */
export function withPerUseEntries(scene: PerUseMaps, id: string, entries: PerUseEntries): PerUseMaps {
  // ⚠️ **入れないマップは「消す」**＝入れた後の `id` のキー集合を、取り出したもの（`entries`）と**必ず一致**させる。
  // `id` は新しく採った未使用の id なので、そこに残っているエントリは**定義上すべて孤児**（#566 より前に保存した
  // 古い動画に有りうる）。残すと、元が持っていない設定が複製にだけ**憑依**する（ADR-0028 D6 の「憑依」と同じ経路）。
  const put = <V>(m: Record<string, V> | undefined, v: V | undefined): Record<string, V> | undefined => {
    if (v !== undefined) return { ...m, [id]: v };
    if (!m || m[id] === undefined) return m; // 消すものが無い＝同一参照
    const rest = Object.fromEntries(Object.entries(m).filter(([k]) => k !== id));
    return Object.keys(rest).length ? rest : undefined; // 空は undefined（`prunePerUseMaps` と同じ流儀）
  };
  return {
    slotFits: put(scene.slotFits, entries.slotFits),
    slotClips: put(scene.slotClips, entries.slotClips),
    slotVideoStart: put(scene.slotVideoStart, entries.slotVideoStart),
  };
}
