import { describe, expect, it } from 'vitest';
import { characterForSpeaker, DEFAULT_SPEAKER, VOICE_CATALOG } from './voiceCatalog';

describe('VOICE_CATALOG', () => {
  it('各キャラは名前とスタイルを持ち、speaker は整数', () => {
    for (const c of VOICE_CATALOG) {
      expect(c.character).toBeTruthy();
      expect(c.styles.length).toBeGreaterThan(0);
      expect(c.styles.every((s) => Number.isInteger(s.speaker))).toBe(true);
    }
  });

  it('speaker 番号はカタログ全体で一意（重複なし）', () => {
    const all = VOICE_CATALOG.flatMap((c) => c.styles.map((s) => s.speaker));
    expect(new Set(all).size).toBe(all.length);
  });

  it('DEFAULT_SPEAKER(3) は ずんだもん', () => {
    expect(DEFAULT_SPEAKER).toBe(3);
    expect(characterForSpeaker(DEFAULT_SPEAKER)).toBe('ずんだもん');
  });
});

describe('characterForSpeaker', () => {
  it('既知の speaker → キャラ名', () => {
    expect(characterForSpeaker(3)).toBe('ずんだもん');
    expect(characterForSpeaker(2)).toBe('四国めたん');
  });

  it('未知/未指定は null', () => {
    expect(characterForSpeaker(99999)).toBeNull();
    expect(characterForSpeaker(null)).toBeNull();
    expect(characterForSpeaker(undefined)).toBeNull();
  });
});
