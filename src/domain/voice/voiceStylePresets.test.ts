import { describe, expect, it } from 'vitest';
import { INTONATION_RANGE, PITCH_RANGE, SPEED_RANGE } from './voiceParams';
import { VOICE_STYLE_PRESETS, matchVoiceStyleId, voiceStyleParams } from './voiceStylePresets';

describe('VOICE_STYLE_PRESETS', () => {
  it('全プリセットのパラメータは各 ParamRange 内（schemas VoiceSettings §7.1）', () => {
    for (const p of VOICE_STYLE_PRESETS) {
      expect(p.params.speed).toBeGreaterThanOrEqual(SPEED_RANGE.min);
      expect(p.params.speed).toBeLessThanOrEqual(SPEED_RANGE.max);
      expect(p.params.pitch).toBeGreaterThanOrEqual(PITCH_RANGE.min);
      expect(p.params.pitch).toBeLessThanOrEqual(PITCH_RANGE.max);
      expect(p.params.intonation).toBeGreaterThanOrEqual(INTONATION_RANGE.min);
      expect(p.params.intonation).toBeLessThanOrEqual(INTONATION_RANGE.max);
    }
  });
  it('id は一意', () => {
    const ids = VOICE_STYLE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('voiceStyleParams', () => {
  it('id からパラメータを返す', () => {
    expect(voiceStyleParams('bright')).toEqual({ speed: 1.1, pitch: 0.1, intonation: 1.2 });
  });
  it('未知 id は先頭（既定）プリセット', () => {
    expect(voiceStyleParams('unknown')).toEqual(VOICE_STYLE_PRESETS[0].params);
  });
});

describe('matchVoiceStyleId', () => {
  it('完全一致するプリセット id を返す', () => {
    expect(matchVoiceStyleId({ speed: 1.1, pitch: 0.1, intonation: 1.2 })).toBe('bright');
  });
  it('一致しない（既定 1.0/0.0/1.0 など）・未設定は先頭プリセット', () => {
    expect(matchVoiceStyleId({ speed: 1.0, pitch: 0.0, intonation: 1.0 })).toBe(VOICE_STYLE_PRESETS[0].id);
    expect(matchVoiceStyleId(undefined)).toBe(VOICE_STYLE_PRESETS[0].id);
  });
});
