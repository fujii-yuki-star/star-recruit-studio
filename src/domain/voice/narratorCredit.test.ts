import { describe, expect, it } from 'vitest';
import { creditForSpeaker, NARRATOR_CREDIT } from './narratorCredit';

describe('narratorCredit（#177：動的クレジット）', () => {
  it('NARRATOR_CREDIT は既定キャラ（ずんだもん）＝後方互換', () => {
    expect(NARRATOR_CREDIT).toBe('VOICEVOX:ずんだもん');
  });

  it('creditForSpeaker：既知 speaker のキャラを「VOICEVOX:<character>」に', () => {
    expect(creditForSpeaker(3)).toBe('VOICEVOX:ずんだもん');
    expect(creditForSpeaker(2)).toBe('VOICEVOX:四国めたん');
  });

  it('creditForSpeaker：未知/未指定は既定キャラへフォールバック', () => {
    expect(creditForSpeaker(99999)).toBe('VOICEVOX:ずんだもん');
    expect(creditForSpeaker(null)).toBe('VOICEVOX:ずんだもん');
    expect(creditForSpeaker(undefined)).toBe('VOICEVOX:ずんだもん');
  });
});
