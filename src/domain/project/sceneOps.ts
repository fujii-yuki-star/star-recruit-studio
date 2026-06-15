// 場面の構成編集（並べ替え・複製）の純粋ロジック（CLAUDE.md §4：副作用なし・テスト容易）。
// 再生・表示順の「正」＝scenes 配列順（buildExportScenes も scenes 配列を順に処理する）。
// scene.order（1..N）は配列順に追従させ、part.sceneIds は「パート所属＋パート内順序」を保持する目印。
// 並べ替えは scenes 配列の入れ替えで行い partId は変えない（パート間移動は MVP 外＝1パート前提）。
import { NARRATION_STATUS } from '../enums';
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
    narration: { ...src.narration, status: NARRATION_STATUS.none, voicePath: null },
    // 複製直後は検証し直す前提で警告をクリアする（古い検証結果を引き継がない）。
    warnings: [],
  };
  const next = [...scenes];
  next.splice(idx + 1, 0, copy);
  const reordered = reindexOrder(next);
  return { scenes: reordered, parts: rebuildPartSceneIds(parts, reordered) };
}
