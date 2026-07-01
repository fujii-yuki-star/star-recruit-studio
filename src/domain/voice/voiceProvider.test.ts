import { describe, expect, it } from 'vitest';
import { resolveLineVoice, resolveNarrationVoice } from './voiceProvider';
import { DEFAULT_VOICE_ID } from '../constants';
import { NARRATION_STATUS } from '../enums';
import type { Narration, NarrationLine, VoiceSettings } from '../project/types';

const voice: VoiceSettings = {
  defaultVoiceId: DEFAULT_VOICE_ID,
  speed: 1.1,
  pitch: 0.2,
  intonation: 1.3,
  volume: 1.0,
};
const base: Narration = { text: 'こんにちは', status: 'none' };

describe('resolveNarrationVoice', () => {
  it('未指定(null)は project.voiceSettings を継承する（11 §6）', () => {
    expect(resolveNarrationVoice(base, voice)).toEqual({
      voiceId: DEFAULT_VOICE_ID,
      speed: 1.1,
      pitch: 0.2,
      intonation: 1.3,
    });
  });

  it('scene 側の指定が project より優先される', () => {
    const r = resolveNarrationVoice({ ...base, voiceId: 'other', speed: 0.8 }, voice);
    expect(r.voiceId).toBe('other');
    expect(r.speed).toBe(0.8);
    expect(r.pitch).toBe(0.2); // 未指定は project 継承
  });

  it('project 側も未指定なら中立値（1.0/0.0/1.0）', () => {
    expect(resolveNarrationVoice(base, { defaultVoiceId: 'v' })).toEqual({
      voiceId: 'v',
      speed: 1.0,
      pitch: 0.0,
      intonation: 1.0,
    });
  });

  it('project.defaultVoiceId が空ならシステム定数へフォールバック（3段目）', () => {
    expect(resolveNarrationVoice(base, { defaultVoiceId: '' }).voiceId).toBe(DEFAULT_VOICE_ID);
  });
});

describe('resolveLineVoice（掛け合いの行・ADR-0015）', () => {
  const resolved = { voiceId: 'voicevox_zundamon', speed: 1.0, pitch: 0.0, intonation: 1.0 };

  it('行の speaker/speed/pitch/intonation を優先する（#242 で intonation も行ごと）', () => {
    const line: NarrationLine = { lineId: 'line_001', text: 'やあ', speaker: 7, speed: 1.2, intonation: 1.4, status: NARRATION_STATUS.none };
    expect(resolveLineVoice(line, resolved)).toEqual({
      text: 'やあ', voiceId: 'voicevox_zundamon', speed: 1.2, pitch: 0.0, intonation: 1.4, speaker: 7,
    });
  });

  it('speaker 未指定は null（voiceId 経路で解決）・speed/pitch/intonation は base を継承', () => {
    const line: NarrationLine = { lineId: 'line_001', text: 'a', status: NARRATION_STATUS.none };
    const r = resolveLineVoice(line, resolved);
    expect(r.speaker).toBeNull();
    expect(r.speed).toBe(1.0);
    expect(r.pitch).toBe(0.0);
    expect(r.intonation).toBe(1.0);
  });

  it('voiceCatalog に無い speaker は null＝既定声へフォールバック（V19・破損データ対策）', () => {
    const line: NarrationLine = { lineId: 'line_001', text: 'a', speaker: 99999, status: NARRATION_STATUS.none };
    expect(resolveLineVoice(line, resolved).speaker).toBeNull();
  });
});
