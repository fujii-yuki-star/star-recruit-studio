import { describe, expect, it } from 'vitest';
import { resolveNarrationVoice } from './voiceProvider';
import { DEFAULT_VOICE_ID } from '../constants';
import type { Narration, VoiceSettings } from '../project/types';

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
