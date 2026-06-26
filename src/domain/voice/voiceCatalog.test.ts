import { describe, expect, it } from 'vitest';
import { characterForSpeaker, DEFAULT_SPEAKER, speakerForCharacter, VOICE_CATALOG } from './voiceCatalog';

describe('speakerForCharacter', () => {
  it('キャラ名 → 先頭スタイルの speaker（ずんだもん→3）', () => {
    expect(speakerForCharacter('ずんだもん')).toBe(3);
    expect(speakerForCharacter('四国めたん')).toBe(2);
  });

  it('未知/未指定は null', () => {
    expect(speakerForCharacter('知らない人')).toBeNull();
    expect(speakerForCharacter(null)).toBeNull();
    expect(speakerForCharacter(undefined)).toBeNull();
  });

  it('characterForSpeaker と往復する（先頭スタイル）', () => {
    for (const c of VOICE_CATALOG) {
      const sp = speakerForCharacter(c.character);
      expect(sp).toBe(c.styles[0].speaker);
      expect(characterForSpeaker(sp)).toBe(c.character);
    }
  });
});

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
