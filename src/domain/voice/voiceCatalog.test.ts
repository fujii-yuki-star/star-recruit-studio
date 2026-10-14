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

describe('拡張パックの声（ADR-0060 段階3）', () => {
  it('足した声も一覧とキャラ名・クレジットの引き当てに出て、差し替えると消える', async () => {
    const { setExtraVoiceCharacters, voiceCatalog } = await import('./voiceCatalog');
    const { creditForSpeaker } = await import('./narratorCredit');
    try {
      setExtraVoiceCharacters([{ character: 'あおい', styles: [{ speaker: 9001, label: 'ノーマル' }] }]);
      expect(voiceCatalog().at(-1)?.character).toBe('あおい');
      expect(characterForSpeaker(9001)).toBe('あおい');
      expect(speakerForCharacter('あおい')).toBe(9001);
      expect(creditForSpeaker(9001)).toContain('あおい'); // クレジットを落とさない（ADR-0003）
      setExtraVoiceCharacters([]);
      expect(characterForSpeaker(9001)).toBeNull();
      expect(voiceCatalog()).toBe(VOICE_CATALOG);
    } finally {
      setExtraVoiceCharacters([]);
    }
  });
});

describe('いま入っていない声で作り済みの読み上げ（段階3）', () => {
  it('作り済み・文あり・一覧に無い声だけを数える（継承・同梱の声・まだ作っていないものは数えない）', async () => {
    const { sceneGoneVoiceLineCount, isGoneGeneratedVoice } = await import('./goneVoices');
    const gen = 'generated';
    expect(isGoneGeneratedVoice({ speaker: 9001, status: gen, text: 'こんにちは' })).toBe(true);
    expect(isGoneGeneratedVoice({ speaker: 3, status: gen, text: 'こんにちは' })).toBe(false);
    expect(isGoneGeneratedVoice({ speaker: null, status: gen, text: 'こんにちは' })).toBe(false);
    expect(isGoneGeneratedVoice({ speaker: 9001, status: 'not_generated', text: 'こんにちは' })).toBe(false);
    expect(isGoneGeneratedVoice({ speaker: 9001, status: gen, text: '  ' })).toBe(false);
    expect(sceneGoneVoiceLineCount([
      { lines: [{ speaker: 9001, status: gen, text: 'a' }, { speaker: 3, status: gen, text: 'b' }] },
      { lines: null },
      { lines: [{ speaker: 9002, status: gen, text: 'c' }] },
    ])).toBe(2);
  });
});
