// このパソコンの中で声を文字にする（ADR-0058・#1387）＝Rust の口（`src-tauri/src/transcribe.rs`）を呼ぶだけ。
//
// ⚠️ **断りは Rust が返す文をそのまま渡す**（`messages.rs` の `TRANSCRIBE_*`＝`15 §6` の表で守られている）。
//   画面に出してよい文かは、呼ぶ側が関門（`userFacingMessage`）で見る。
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from './assetFs';

/** 区切り1つ（**切り出した範囲の頭からの秒**）。 */
export interface TranscribedSegment {
  startSec: number;
  endSec: number;
  text: string;
}

/** 部品が入っているか（押す前に断る）。Tauri の外では無い扱い。 */
export async function transcribeAvailable(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    return await invoke<boolean>('transcribe_available');
  } catch {
    return false;
  }
}

/** 声を文字にする（失敗は投げる＝Rust の断りの文が入る）。`runId` は止めるとき・進み具合の見分けに使う。 */
export async function transcribeAudio(
  projectId: string,
  relPath: string,
  fromSec: number,
  lengthSec: number,
  runId: number,
): Promise<TranscribedSegment[]> {
  return invoke<TranscribedSegment[]>('transcribe_audio', { projectId, relPath, fromSec, lengthSec, runId });
}

/** その回を止める（まだ始まっていなくても、始まった時点で止まる）。 */
export async function transcribeCancel(runId: number): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('transcribe_cancel', { runId });
  } catch {
    // 止められなくても、画面は結果を捨てる（止めた回の結果は使わない）。
  }
}

/** 進み具合（0〜100）。どの回のものかを添える。 */
export interface TranscribeProgressEvent {
  runId: number;
  percent: number;
}

/** 進み具合を受け取る。返り値を呼ぶと購読をやめる。Tauri の外では何もしない関数を返す。 */
export async function listenTranscribeProgress(cb: (e: TranscribeProgressEvent) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    return await listen<TranscribeProgressEvent>('transcribe_progress', (ev) => cb(ev.payload));
  } catch {
    return () => {};
  }
}
