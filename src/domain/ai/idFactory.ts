// ID採番（11 §2.1）。Date.now/乱数に依存しない決定論的な連番（CLAUDE.md §3 / 14 §4）。
// 採番器を注入できるようにし、テストでの決定論性を担保する。

export interface IdFactory {
  nextPartId(): string;
  nextSceneId(): string;
}

const pad3 = (n: number): string => String(n).padStart(3, '0');

/** part_NNN / scene_NNN を連番で発行する（start は「既に使用済みの最大番号」）。 */
export function createSequentialIdFactory(startPart = 0, startScene = 0): IdFactory {
  let part = startPart;
  let scene = startScene;
  return {
    nextPartId: () => `part_${pad3((part += 1))}`,
    nextSceneId: () => `scene_${pad3((scene += 1))}`,
  };
}
