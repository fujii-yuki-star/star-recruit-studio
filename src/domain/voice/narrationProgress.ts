// セリフ音声の生成進捗（生成済み数 / 対象数）。対象＝セリフ本文が空でない場面（#176）。
// 純粋関数＝§7 テスト対象。UI の「音声 X/Y」表示に使う。
import { NARRATION_STATUS } from '../enums';
import type { Scene } from '../project/types';

export function narrationProgress(scenes: Scene[]): { done: number; total: number } {
  const withText = scenes.filter((s) => s.narration.text.trim().length > 0);
  const done = withText.filter((s) => s.narration.status === NARRATION_STATUS.generated).length;
  return { done, total: withText.length };
}
