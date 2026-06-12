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
 * BGM音量を解決（§6）：scene.audioMix.bgmVolume → project.bgmSettings.volume → BGM_VOLUME。
 * V-C3 のBGM合成で使用予定（現状はV-C1のナレーション合成のみ実装）。
 */
export function resolveBgmVolume(
  audioMix: AudioMix | undefined,
  bgm: BgmSettings | undefined,
): number {
  return clampVolume(audioMix?.bgmVolume ?? bgm?.volume ?? BGM_VOLUME);
}
