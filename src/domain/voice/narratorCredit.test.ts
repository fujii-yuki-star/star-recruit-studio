import { describe, expect, it } from 'vitest';
import { creditForLine, creditForLines, creditForSpeaker, usedVoiceCredits, NARRATOR_CREDIT } from './narratorCredit';

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

  describe('creditForLine（#243：行ごとの動的クレジット）', () => {
    const fallback = 'VOICEVOX:四国めたん'; // 場面/動画の話者（継承元）のクレジット

    it('行に有効な話者があればそのキャラ', () => {
      expect(creditForLine({ speaker: 3 }, fallback)).toBe('VOICEVOX:ずんだもん');
    });

    it('話者 null/未指定（継承）は fallback＝場面/動画のクレジット', () => {
      expect(creditForLine({ speaker: null }, fallback)).toBe(fallback);
      expect(creditForLine({}, fallback)).toBe(fallback);
    });

    it('不明な話者は既定キャラでなく fallback へ（合成 resolveLineVoice と一致＝実音声に合わせる）', () => {
      expect(creditForLine({ speaker: 99999 }, fallback)).toBe(fallback);
    });
  });

  describe('creditForLines（#243：使用話者の併記＝集約表示向け。動画×掛け合いの書き出しは行ごと表示へ移行済み）', () => {
    const fallback = 'VOICEVOX:四国めたん';

    it('使用キャラを重複なく「 / 」で併記する', () => {
      expect(creditForLines([{ speaker: 3 }, { speaker: 2 }], fallback)).toBe('VOICEVOX:ずんだもん / VOICEVOX:四国めたん');
    });

    it('同一キャラは1つにまとめる', () => {
      expect(creditForLines([{ speaker: 3 }, { speaker: 3 }], fallback)).toBe('VOICEVOX:ずんだもん');
    });

    it('継承（null）の行は fallback＝場面/動画のクレジットを含める', () => {
      expect(creditForLines([{ speaker: 3 }, { speaker: null }], fallback)).toBe('VOICEVOX:ずんだもん / VOICEVOX:四国めたん');
    });

    it('空配列は fallback を返す（契約の明示・境界値）', () => {
      expect(creditForLines([], fallback)).toBe(fallback);
    });
  });

  describe('usedVoiceCredits（#251：プロジェクトの使用キャラ全列挙）', () => {
    it('単一 narration の場面は既定話者（getVoicevoxSpeaker）を使う', () => {
      expect(usedVoiceCredits([{ lines: undefined }, { lines: [] }], 3)).toEqual(['VOICEVOX:ずんだもん']);
    });
    it('掛け合いは行ごとの話者を重複なく集める（＋単一 narration 場面の既定話者）', () => {
      const scenes = [{ lines: undefined }, { lines: [{ speaker: 2 }, { speaker: null }] }];
      expect(usedVoiceCredits(scenes, 3).sort()).toEqual(['VOICEVOX:ずんだもん', 'VOICEVOX:四国めたん'].sort());
    });
    it('既定話者が実際に使われなければ含めない（全場面が明示話者の掛け合い）', () => {
      expect(usedVoiceCredits([{ lines: [{ speaker: 2 }] }], 3)).toEqual(['VOICEVOX:四国めたん']);
    });
    it('場面が無くても既定話者を1件返す（About 後方互換・null は既定へ）', () => {
      expect(usedVoiceCredits([], 3)).toEqual(['VOICEVOX:ずんだもん']);
      expect(usedVoiceCredits([], null)).toEqual(['VOICEVOX:ずんだもん']);
    });
  });
});
