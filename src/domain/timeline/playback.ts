// タイムライン形式（ADR-0032）の再生位置の進み方（#630）。純粋関数（副作用なし・§7 テスト対象）。
//
// **秒が正準・フレームは出力時の量子化**（ADR-0023 の周辺方針）。格子へ落とす規則（`quantizeToFrameSec`）と
// 実効 fps（`effectiveFps`）・位置のクランプ（`clampTimelinePlayheadSec`）を**ここに1つずつ**置き、
// 描画（`frameTimeSec`）と再生の両方がこれを通る＝同じ規則を層をまたいで書かない（§6）。
// 時計そのもの（`performance.now` / `requestAnimationFrame`）は app 側が持つ。
import { FPS } from '../constants';
import { timelineDurationSec } from './persistence';
import type { TimelineProject } from './types';

/**
 * この動画の実効 fps。**解決を1か所に置く**（`videoSettings.fps` は schema で必須・`const 30` なので
 * 通常は欠けないが、欠落/0 のときの既定を複数箇所で書かないため）。
 */
export function effectiveFps(doc: TimelineProject): number {
  const fps = doc.videoSettings.fps;
  return typeof fps === 'number' && fps > 0 ? fps : FPS;
}

/**
 * 秒をフレームの格子へ落とす（`floor(t*fps)/fps`）。**「見せる時刻」の単一の参照元**（§6）。
 * 書き出しは同じ格子でフレームを焼くので、ここを通した時刻で描けば絵がずれない（ADR-0001）。
 */
export function quantizeToFrameSec(sec: number, fps: number): number {
  const rate = fps > 0 ? fps : FPS;
  return Math.floor(sec * rate) / rate;
}

/**
 * 再生位置を動画の範囲へ収める（0 未満・尺超え・壊れた入力を作らない）。
 * 場面形式の `clampPlayheadSec`（`domain/project/playhead.ts`）と同じ流儀で **domain に1つだけ**置く。
 */
export function clampTimelinePlayheadSec(doc: TimelineProject, sec: number): number {
  if (!Number.isFinite(sec)) return 0;
  return Math.min(Math.max(0, sec), Math.max(0, timelineDurationSec(doc)));
}

/** 再生位置を進めた結果。`ended` は動画の終わりに達したか（再生を止める合図）。 */
export interface PlaybackTick {
  sec: number;
  ended: boolean;
}

/**
 * 再生を始めた位置 `fromSec` から `elapsedSec` 経ったときに**見せる時刻**（秒）。
 *
 * - **フレーム格子へ落とす**（`floor(t * fps) / fps`）＝1フレームの間は同じ絵を見せる。書き出しは同じ格子で
 *   フレームを焼くので、再生で見た絵とMP4のフレームがずれない。
 * - **尺を超えない**。超えたら `ended`＝再生を止める（ループしない＝書き出しと同じ長さで終わる）。
 * - 尺が 0（何も置いていない）ならその場に留まる＝再生ボタンを押しても暴走しない。
 */
export function playbackTick(fromSec: number, elapsedSec: number, totalSec: number, fps: number = FPS): PlaybackTick {
  const raw = fromSec + Math.max(0, elapsedSec);
  if (totalSec <= 0) return { sec: 0, ended: true };
  // 終端に**達した**かは量子化前の生の時刻で見る（量子化で1フレーム手前に丸まると終われない）。
  // 終端で返すのは尺そのもの＝**位置の正準は秒**（見せる時刻へ落とすのは `frameTimeSec` の役目・ADR-0023）。
  return raw >= totalSec ? { sec: totalSec, ended: true } : { sec: Math.max(0, quantizeToFrameSec(raw, fps)), ended: false };
}

/**
 * 再生を始められるか。**終端にいるときは先頭へ戻してから始める**（押しても動かない、を作らない）。
 * 戻り値は「再生の開始位置」。何も置いていない動画では 0（呼び出し側が再生させない）。
 */
export function playbackStartSec(currentSec: number, totalSec: number): number {
  if (totalSec <= 0) return 0;
  return currentSec >= totalSec ? 0 : Math.max(0, currentSec);
}
