import { describe, expect, it } from 'vitest';
import { creditForLine, creditForSpeaker, sceneCreditText, sceneVoiceCredits, usedVoiceCredits, NARRATOR_CREDIT } from './narratorCredit';

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

// ADR-0025 追補（利用者判断 2026-10-01）：場面形式も「最初と最後」は全員を縦に。プレビューと書き出しが同じ関数を通る。
describe('sceneCreditText（場面形式のクレジットの文）', () => {
  const base = 'VOICEVOX:ずんだもん';
  const scenes = [
    { lines: null }, // 単一 narration＝既定の声
    { lines: [{ speaker: 8 }, { speaker: 14 }, { speaker: 8 }] },
    { lines: [{ speaker: null }] }, // 継承＝既定の声（重ならない）
  ];

  it('最初と最後（既定）・最初・最後は、使った声を全員、出てくる順に縦に', () => {
    const all = 'VOICEVOX:ずんだもん\nVOICEVOX:春日部つむぎ\nVOICEVOX:冥鳴ひまり';
    expect(sceneCreditText(undefined, scenes, { speaker: 14 }, base)).toBe(all);
    expect(sceneCreditText({ mode: 'head' }, scenes, null, base)).toBe(all);
    expect(sceneCreditText({ mode: 'tail' }, scenes, null, base)).toBe(all);
  });

  it('ずっと表示は、話している行のキャラ（行が無ければ既定の声）', () => {
    expect(sceneCreditText({ mode: 'always' }, scenes, { speaker: 14 }, base)).toBe('VOICEVOX:冥鳴ひまり');
    expect(sceneCreditText({ mode: 'always' }, scenes, null, base)).toBe(base);
  });

  it('使った声の一覧は、場面と行の順に・重ならない（usedVoiceCredits と同じ）', () => {
    expect(sceneVoiceCredits(scenes, base)).toEqual(['VOICEVOX:ずんだもん', 'VOICEVOX:春日部つむぎ', 'VOICEVOX:冥鳴ひまり']);
    expect(usedVoiceCredits(scenes, 3)).toEqual(sceneVoiceCredits(scenes, base));
    expect(sceneVoiceCredits([], base)).toEqual([base]);
  });
});

describe('数える声は鳴る声だけ（文が空の行・場面は声が作られない＝PR レビュー 🟡）', () => {
  const base = 'VOICEVOX:ずんだもん';
  it('文が空の行は数えない／文が空の単一の場面（題字だけ）は既定の声を数えない', () => {
    const scenes = [
      { lines: null, narration: { text: '' } },
      { lines: [{ speaker: 2, text: 'こんにちは' }, { speaker: 14, text: '  ' }] },
    ];
    expect(sceneVoiceCredits(scenes, base)).toEqual(['VOICEVOX:四国めたん']);
    expect(sceneCreditText(undefined, scenes, null, base)).toBe('VOICEVOX:四国めたん');
  });
  it('文のある単一の場面は既定の声を数える・全部空なら既定の声1件（名乗りを消さない）', () => {
    expect(sceneVoiceCredits([{ narration: { text: 'はい' } }], base)).toEqual([base]);
    expect(sceneVoiceCredits([{ narration: { text: '' } }, { lines: [{ speaker: 8, text: '' }] }], base)).toEqual([base]);
  });
});
