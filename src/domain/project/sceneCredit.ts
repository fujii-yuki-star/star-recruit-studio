// 場面形式で「どの場面にクレジット（VOICEVOX）を焼くか」（ADR-0025・#359）。純粋関数（§7 テスト対象）。
//
// ⚠️ **書き出しとプレビューが同じ1つを見る**（ADR-0001）。前は書き出し（`buildExportScenes`）だけが
// 判定しており、仕上がり確認・場面編集のプレビューは**無条件にクレジットを描いて**いた
//＝「最初の数秒」「非表示」を選んだ動画で、画面には出ているのに焼いた動画には入っていない（PR #881 レビュー）。
// 判定を共有関数にしておかないと、消費者が増えるたびに同じ漏れが起きる。
import { creditVisibleForScene, type CreditDisplay } from '../voice/creditDisplay';
import { transitionBoundaryDs, transitionTimeline } from './sceneTransitions';
import type { Scene } from './types';

/**
 * 場面ごとに「クレジットを出すか」（`scenes` と同じ並び・同じ長さ）。
 *
 * ⚠️ **時間軸は「実際に書き出される尺」で採る**（PR #881 レビュー）。表示時間を順に足すだけだと、
 * 切り替え（xfade）が重なるぶん**実尺より長い**時間軸になり、「最後の N 秒」の窓が本当の末尾より
 * 後ろへずれる。ずれは**足りない側にも倒れる**（`実尺 = Σ尺 − Σ重なり` なので、後ろに切り替えを
 * 持つ場面ほど実際は早く終わる＝単純合算では「窓に重ならない」と見えるのに実際は末尾 N 秒に入る）。
 * 出るべきクレジットが出ないのは `13 §4` に触れるので、正準の `transitionTimeline` から採る。
 *
 * ⚠️ ここへ渡す尺は**書き出しの後処理（場面クリップ単位のトランジション解決）と同じもの**＝掛け合いの
 * 区間列（`sceneSegmentSpecs`）は場面尺をちょうど敷き詰めるので、合算しても `durationSec` に戻る。
 * 前提の内訳と、それを固定しているテスト：
 * - 区間列が場面尺を敷き詰める＝`lineTimeline.test.ts`「先頭行が途中開始なら…合計＝場面尺」
 * - この関数と後処理が同じ位置を指す＝`buildExportScenes.test.ts`「クレジットの時間軸は、後処理の
 *   トランジション解決と同じ位置を指す」（片方だけ変えたら赤くなる）
 */
export function sceneCreditVisibility(
  scenes: readonly Scene[],
  display: CreditDisplay | undefined,
): boolean[] {
  const { steps, effectiveTotalSec } = transitionTimeline(
    scenes.map((s) => s.durationSec),
    transitionBoundaryDs(scenes),
  );
  return scenes.map((s, i) =>
    creditVisibleForScene(display, effectiveTotalSec, i === 0 ? 0 : steps[i - 1]?.offsetSec ?? 0, s.durationSec),
  );
}
