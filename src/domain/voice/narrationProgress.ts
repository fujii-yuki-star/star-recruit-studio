// セリフ音声の生成進捗（生成済み行数 / 対象行数）。対象＝本文が空でない行（#176・行対応＝ADR-0015）。
// 純粋関数＝§7 テスト対象。UI の「声 X/Y」表示に使う。
// 単一 narration の場面は sceneLines が1行に解決＝従来（場面=1行）と同値（後方互換）。
import { NARRATION_STATUS } from '../enums';
import { sceneLines, withLineStatus } from '../project/narrationLines';
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

/**
 * 「準備中」の行/場面を「未作成」へ戻す（#547 P2-6）。純粋関数。`isNarrationGenerating` が見る状態を解く側なので
 * 同じ場所に置く（読み取りと解除が離れるとどちらか片方だけ直る）。
 *
 * 使いどころは2つ：
 * - **一括作成の中止**。対象行をまとめて `pending` にしてから順に合成するため、中止すると開始されないまま準備中が残る。
 * - **プロジェクトの読込**。保存時に合成中だった行は `pending` のまま保存され得るが、その合成はもう走っていない。
 *
 * どちらも残したままだと ①進捗が永久に止まって見える ②`isNarrationGenerating` が true のままで書き出しがブロックされ続ける
 * ③その行だけ「作り直す」も押せない（多重起動防止が pending を弾く）＝行き止まりになる（§2-5／ADR-0026④）。
 * 失う音声は無い（`pending` の行にはまだ音声が無い）。
 *
 * すでに始まっている合成の結果は捨てない（作った音声を無駄にしない）＝完了時にあらためて `generated` が書かれる。
 * 掛け合い/単一 narration の分岐は持たず `sceneLines`＋`withLineStatus` に委ねる（分岐の二重定義を作らない＝`narrationLines.ts` の流儀）。
 * 変更が無ければ**同一参照**を返す（無用な未保存/再描画を作らない）。
 */
export function clearPendingNarrations(scenes: Scene[]): Scene[] {
  let changed = false;
  const next = scenes.map((scene) => {
    let out = scene;
    for (const line of sceneLines(scene)) {
      if (line.status !== NARRATION_STATUS.pending) continue;
      out = withLineStatus(out, line.lineId, NARRATION_STATUS.none);
    }
    if (out !== scene) changed = true;
    return out;
  });
  return changed ? next : scenes;
}
