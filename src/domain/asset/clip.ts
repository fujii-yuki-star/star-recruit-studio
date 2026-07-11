// 動画クリップ設定の純粋ロジック（CLAUDE.md §4：domain は副作用なし）。
// 正典: 11_SCHEMA_REFERENCE §7.1 / schemas $defs/Clip（startSec/endSec ≥ 0、originalAudioVolume 0–1.5、speed 0.5–2.0）。
import { SPEED_DEFAULT, SPEED_MAX, SPEED_MIN } from '../constants';
import type { Clip, SlotClipOverride } from '../project/types';

/**
 * クリップの時刻(秒)を [min, max] に収める。
 * @param max 動画の長さ（不明なら null/undefined＝上限なし）。**絶対上限＝min より優先**する
 *   （呼び出し側は min ≤ max を渡す前提。UIでは startSec ≤ dur が保証される）。
 * @param min 下限（終了秒は開始秒以上にしたい等で使う。既定 0）
 * NaN・非有限は min を返す。
 */
export function clampClipTime(value: number, max?: number | null, min = 0): number {
  if (!Number.isFinite(value)) return min;
  let v = Math.max(min, value);
  if (max != null && v > max) v = max;
  return v;
}

/** 再生速度を [SPEED_MIN, SPEED_MAX] に収める（§4）。NaN・非有限は SPEED_DEFAULT。 */
export function clampSpeed(value: number): number {
  if (!Number.isFinite(value)) return SPEED_DEFAULT;
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, value));
}

/**
 * 場面の per-use 上書き（`scene.slotClips[layerId]`）を素材既定（`asset.clip`）に重ねた実効クリップ設定（ADR-0028・#472）。
 * フィールド単位で override を優先し、未指定は base（asset.clip）を継承（null=継承・11 §6）。
 * `fit` は slotClips に無く per-use は `scene.slotFits` が担うため、ここでは base（素材既定）の fit をそのまま返す。
 * 描画/書き出し（findVideoSlots）・場面編集UI が共有する単一の解決点（§2-7）。
 */
export function resolveSlotClip(override: SlotClipOverride | undefined, base: Clip | undefined): Clip {
  return {
    startSec: override?.startSec ?? base?.startSec,
    endSec: override?.endSec ?? base?.endSec,
    useOriginalAudio: override?.useOriginalAudio ?? base?.useOriginalAudio,
    originalAudioVolume: override?.originalAudioVolume ?? base?.originalAudioVolume,
    speed: override?.speed ?? base?.speed,
    fit: base?.fit,
  };
}
