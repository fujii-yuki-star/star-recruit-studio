// セリフ音声の生成進捗（生成済み行数 / 対象行数）。対象＝本文が空でない行（#176・行対応＝ADR-0015）。
// 純粋関数＝§7 テスト対象。UI の「声 X/Y」表示に使う。
// 単一 narration の場面は sceneLines が1行に解決＝従来（場面=1行）と同値（後方互換）。
import { NARRATION_STATUS } from '../enums';
import { sceneLines } from '../project/narrationLines';
import type { Scene } from '../project/types';

export function narrationProgress(scenes: Scene[]): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const scene of scenes) {
    for (const line of sceneLines(scene)) {
      if (line.text.trim().length === 0) continue;
      total += 1;
      if (line.status === NARRATION_STATUS.generated) done += 1;
    }
  }
  return { done, total };
}
