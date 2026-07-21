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

// 音声生成が進行中（pending の行が1つでもある）か。書き出し開始のブロック判定で共有する正準関数
// （#570 P1 レビュー・#547 P2-6）。掛け合いは sceneLines で行ごとに見る＝pending 行を取りこぼさない。
export function isNarrationGenerating(scenes: Scene[]): boolean {
  return scenes.some((scene) => sceneLines(scene).some((line) => line.status === NARRATION_STATUS.pending));
}
