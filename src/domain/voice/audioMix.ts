// 音声ミックスの音量解決（純粋関数）。正典：11 §6（解決順序）/ §4（値域 0.0〜1.5）。
// scene.audioMix（上書き・null可） ＞ project 既定 ＞ システム定数 の順に解決する。
import { BGM_VOLUME, NARRATION_VOLUME, VOLUME_MAX, VOLUME_MIN } from '../constants';
import type { AudioMix, BgmSettings, VoiceSettings } from '../project/types';

/** 音量を値域 [VOLUME_MIN, VOLUME_MAX] に収める（§4）。 */
export function clampVolume(volume: number): number {
  return Math.min(VOLUME_MAX, Math.max(VOLUME_MIN, volume));
}

/**
 * ナレーション音量を解決（§6）：scene.audioMix.narrationVolume → project.voiceSettings.volume → NARRATION_VOLUME。
 * null/未指定は継承を意味する。
 */
export function resolveNarrationVolume(
  audioMix: AudioMix | undefined,
  voice: VoiceSettings,
): number {
  return clampVolume(audioMix?.narrationVolume ?? voice.volume ?? NARRATION_VOLUME);
}

/**
 * この場面が「個別の声量」を持つか（§6＝個別設定が動画全体の既定より優先＝`resolveNarrationVolume` の第一候補）。
 * true の場面は、全体のナレーション音量スライダーを動かしても `audioMix.narrationVolume` が優先されて変わらない。
 *
 * 「設定できるのに（一部に）効かない」誤認を避ける案内を、仕上がり確認（現在の場面）と書き出し（全場面のいずれか）で
 * **同じ意味**で出すための単一の判定（ADR-0026②）。判定条件をここへ集約し、両画面でインライン比較を書き分けない（§6）。
 */
export function hasSceneNarrationOverride(audioMix: AudioMix | undefined): boolean {
  return audioMix?.narrationVolume != null;
}

/**
 * BGM音量を解決（§6）：scene.audioMix.bgmVolume → project.bgmSettings.volume → BGM_VOLUME。
 * 書き出しの BGM ミックス（`planBgmMix`＝`domain/project/bgmExport.ts`）と仕上がり確認（`PreviewScreen`）で共有する
 * ＝プレビュー=書き出しで同じ値域・同じ継承（ADR-0026②）。
 */
export function resolveBgmVolume(
  audioMix: AudioMix | undefined,
  bgm: BgmSettings | undefined,
): number {
  return clampVolume(audioMix?.bgmVolume ?? bgm?.volume ?? BGM_VOLUME);
}
