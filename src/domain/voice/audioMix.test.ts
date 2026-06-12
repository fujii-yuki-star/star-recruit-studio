import { describe, expect, it } from 'vitest';
import { BGM_VOLUME, NARRATION_VOLUME, VOLUME_MAX, VOLUME_MIN } from '../constants';
import type { AudioMix, BgmSettings, VoiceSettings } from '../project/types';
import { clampVolume, resolveBgmVolume, resolveNarrationVolume } from './audioMix';

const voice: VoiceSettings = { defaultVoiceId: 'voicevox_zundamon', volume: 0.8 };

describe('resolveNarrationVolume (11 §6)', () => {
  it('場面の上書きを最優先する', () => {
    const mix: AudioMix = { narrationVolume: 0.5 };
    expect(resolveNarrationVolume(mix, voice)).toBe(0.5);
  });

  it('場面が null ならプロジェクト既定を継承する', () => {
    const mix: AudioMix = { narrationVolume: null };
    expect(resolveNarrationVolume(mix, voice)).toBe(0.8);
  });

  it('場面・プロジェクトとも無ければシステム定数にフォールバックする', () => {
    expect(resolveNarrationVolume(undefined, { defaultVoiceId: 'voicevox_zundamon' })).toBe(
      NARRATION_VOLUME,
    );
  });

  it('値域 [VOLUME_MIN, VOLUME_MAX] にクランプする', () => {
    expect(resolveNarrationVolume({ narrationVolume: 9 }, voice)).toBe(VOLUME_MAX);
    expect(resolveNarrationVolume({ narrationVolume: -1 }, voice)).toBe(VOLUME_MIN);
  });
});

describe('resolveBgmVolume (11 §6)', () => {
  it('場面 > プロジェクト > 定数 の順に解決する', () => {
    expect(resolveBgmVolume({ bgmVolume: 0.4 }, { volume: 0.1 })).toBe(0.4);
    expect(resolveBgmVolume({ bgmVolume: null }, { volume: 0.1 })).toBe(0.1);
    const noBgm: BgmSettings | undefined = undefined;
    expect(resolveBgmVolume(undefined, noBgm)).toBe(BGM_VOLUME);
  });
});

describe('clampVolume', () => {
  it('範囲内はそのまま返す', () => {
    expect(clampVolume(1.0)).toBe(1.0);
    expect(clampVolume(VOLUME_MAX)).toBe(VOLUME_MAX);
    expect(clampVolume(VOLUME_MIN)).toBe(VOLUME_MIN);
  });
});
