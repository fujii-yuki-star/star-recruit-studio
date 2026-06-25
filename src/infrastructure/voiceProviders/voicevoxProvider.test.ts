import { describe, expect, it } from 'vitest';
import { effectiveSpeaker, resolveSpeaker } from './voicevoxProvider';

describe('resolveSpeaker（設定 > voiceIdマップ > 既定）', () => {
  it('設定の話者を最優先する', () => {
    expect(resolveSpeaker(7, 'voicevox_zundamon')).toBe(7);
  });
  it('設定が無ければ voiceId マップ（既定 voiceId → 3）', () => {
    expect(resolveSpeaker(null, 'voicevox_zundamon')).toBe(3);
  });
  it('未知の voiceId は既定 speaker(3) にフォールバック', () => {
    expect(resolveSpeaker(null, 'unknown_voice')).toBe(3);
  });
});

describe('effectiveSpeaker（行の明示話者を最優先・ADR-0015）', () => {
  it('input.speaker があれば設定（getVoicevoxSpeaker）より優先', () => {
    expect(effectiveSpeaker({ speaker: 8, voiceId: 'voicevox_zundamon' }, 2)).toBe(8);
  });
  it('input.speaker 未指定/null は resolveSpeaker（設定→voiceId→既定）', () => {
    expect(effectiveSpeaker({ speaker: null, voiceId: 'voicevox_zundamon' }, 2)).toBe(2); // 設定優先
    expect(effectiveSpeaker({ voiceId: 'voicevox_zundamon' }, null)).toBe(3); // voiceId マップ（既定 zundamon→3）
  });
});
