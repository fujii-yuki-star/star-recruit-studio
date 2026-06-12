import { describe, expect, it } from 'vitest';
import { resolveSpeaker } from './voicevoxProvider';
import { NARRATOR_STYLES } from '../../domain/voice/narratorStyles';

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

describe('NARRATOR_STYLES', () => {
  it('ノーマル(3)を含み、speaker はすべて整数', () => {
    expect(NARRATOR_STYLES.some((s) => s.speaker === 3)).toBe(true);
    expect(NARRATOR_STYLES.every((s) => Number.isInteger(s.speaker))).toBe(true);
  });
});
