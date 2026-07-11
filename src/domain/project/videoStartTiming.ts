// 動画スロット本体アニメの再生開始タイミング（ADR-0027・#444）の純粋ロジック。
// preview（実 <video> の currentTime シーク）と export（fps 格子へ量子化）がこの単一関数群を共有し、
// 「プレビューでは途中から・書き出しは先頭から」のようなパリティ破れ（ADR-0001）を防ぐ。
import type { VideoStartSpec } from './types';
import { VIDEO_START_MODE } from '../enums';

/**
 * VideoStartSpec（モード明示保存）→ 再生開始の遅延秒 d（scene-time）。窓尺 W（=アニメ区間長）でクランプ。
 * - `withAnim`／未指定 … 0（アニメと同時・先頭から＝#442 既定）
 * - `afterAnim` … W（アニメの後＝窓の間は代表フレームで待ち、settled から再生）
 * - `delay` … clamp(delaySec, 0, W)（途中から）
 * モードで保存するため、アニメ長 W が変わっても「アニメの後」は「アニメの後」のまま（意味が化けない・ADR-0026①）。
 * @param spec 場面×スロットの `scene.slotVideoStart[layerId]`（未設定可）
 * @param windowSec 窓尺 W（= min(場面尺, animEnd)）。クランプ上限。
 */
export function resolveVideoStartDelaySec(spec: VideoStartSpec | undefined, windowSec: number): number {
  const w = Math.max(0, windowSec);
  if (!spec || spec.mode === VIDEO_START_MODE.withAnim) return 0;
  if (spec.mode === VIDEO_START_MODE.afterAnim) return w;
  // delay：delaySec を [0, W] にクランプ（保存値は上限なし・実効はここで頭打ち＝11 §7.1）。
  return Math.min(Math.max(0, spec.delaySec ?? 0), w);
}

/**
 * scene-time t におけるクリップ再生位置（クリップ内の秒）。
 * `[0, d]` は clipStart に張り付き（代表フレームで静止）、`[d, …]` で clipStart から speed 倍で再生。
 * export はこの値を fps 格子へ量子化（窓フレーム f → クリップフレーム `round((t−d)*fps)` の下限0）、
 * preview は実 <video> の currentTime にこの値をそのままシーク＝両者パリティ（ADR-0027/0001）。
 * settled 開始位置は `clipTimeAtSceneTime(W, …)` = `clipStart + (W−d)*speed`（窓の続き）。
 */
export function clipTimeAtSceneTime(
  sceneTimeSec: number,
  opts: { startDelaySec: number; clipStartSec: number; speed: number },
): number {
  return opts.clipStartSec + Math.max(0, sceneTimeSec - opts.startDelaySec) * opts.speed;
}
