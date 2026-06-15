// 場面の構成編集（並べ替え・複製）の純粋ロジック（CLAUDE.md §4：副作用なし・テスト容易）。
// 表示順＝scenes 配列順とし、scene.order（1..N）と part.sceneIds をそれに整合させる。
import type { Part, Scene } from './types';

/** 各パートの sceneIds を、現在の scenes 配列順（パート所属は保持）に合わせて作り直す。 */
export function rebuildPartSceneIds(parts: Part[], scenes: Scene[]): Part[] {
  return parts.map((p) => ({
    ...p,
    sceneIds: scenes.filter((sc) => sc.partId === p.partId).map((sc) => sc.sceneId),
  }));
}

/** order を配列順に 1..N で振り直す。 */
function reindexOrder(scenes: Scene[]): Scene[] {
  return scenes.map((sc, i) => ({ ...sc, order: i + 1 }));
}

/** 場面を上/下へ1つ移動した結果を返す（端なら変化なし）。 */
export function moveSceneInList(
  scenes: Scene[],
  parts: Part[],
  sceneId: string,
  direction: 'up' | 'down',
): { scenes: Scene[]; parts: Part[] } {
  const idx = scenes.findIndex((s) => s.sceneId === sceneId);
  const swap = direction === 'up' ? idx - 1 : idx + 1;
  if (idx < 0 || swap < 0 || swap >= scenes.length) return { scenes, parts };
  const next = [...scenes];
  [next[idx], next[swap]] = [next[swap], next[idx]];
  const reordered = reindexOrder(next);
  return { scenes: reordered, parts: rebuildPartSceneIds(parts, reordered) };
}

/**
 * 場面を複製し、元の直後に挿入した結果を返す（新IDは呼び出し側が採番して渡す）。
 * 複製された場面は音声を作り直す：voices/<sceneId>.wav は sceneId 単位なので
 * voicePath=null / status='none' にリセットする（ADR-0007・複数場面が同一音声を指す不整合を防ぐ）。
 * セリフ文言・素材割当・クリップ設定などはそのまま引き継ぐ。
 */
export function duplicateSceneInList(
  scenes: Scene[],
  parts: Part[],
  sceneId: string,
  newSceneId: string,
): { scenes: Scene[]; parts: Part[] } {
  const idx = scenes.findIndex((s) => s.sceneId === sceneId);
  if (idx < 0) return { scenes, parts };
  const src = scenes[idx];
  const copy: Scene = {
    ...src,
    sceneId: newSceneId,
    narration: { ...src.narration, status: 'none', voicePath: null },
  };
  const next = [...scenes];
  next.splice(idx + 1, 0, copy);
  const reordered = reindexOrder(next);
  return { scenes: reordered, parts: rebuildPartSceneIds(parts, reordered) };
}
