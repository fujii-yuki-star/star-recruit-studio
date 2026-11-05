// 単独の語りの話者（ADR-0073・schema 1.35）＝掛け合いの行と同じ道に乗る。
import { describe, expect, it } from 'vitest';
import { lineFromNarration, sceneLines } from '../project/narrationLines';
import { resolveNarrationInput, sameSynthInput } from './voiceProvider';
import { creditForSpeaker, sceneCreditText, sceneVoiceCredits, soloCreditLine, usedVoiceCredits } from './narratorCredit';
import { CREDIT_MODE } from './creditDisplay';
import { validateProjectDoc } from '../project/persistence';
import { briefingVoiceChoices } from '../briefing/compose';
import { isCompanyOkVoiceCharacter, VOICE_CATALOG } from './voiceCatalog';
import type { Narration, VoiceSettings } from '../project/types';
import sample from '../../../docs/yuko_recruit_docs/fixtures/project.sample.json';

const VOICE: VoiceSettings = { defaultVoiceId: 'voicevox_zundamon', speed: 1, pitch: 0, intonation: 1, volume: 1 };
const METAN = 2;

describe('単独の語りの話者', () => {
  it('1行に写すと話者も写る（無ければ付けない）', () => {
    expect(lineFromNarration({ text: 'a', status: 'none', speaker: METAN }).speaker).toBe(METAN);
    expect('speaker' in lineFromNarration({ text: 'a', status: 'none' })).toBe(false);
    expect(sceneLines({ narration: { text: 'a', status: 'none', speaker: METAN } } as never)[0].speaker).toBe(METAN);
  });

  it('作る声の入力は場面の話者（カタログに無い番号は既定へ）・話者が変われば同じ入力ではない', () => {
    const n: Narration = { text: 'こんにちは', status: 'none', speaker: METAN };
    expect(resolveNarrationInput(n, VOICE)).toMatchObject({ text: 'こんにちは', speaker: METAN, speed: 1 });
    expect(resolveNarrationInput({ ...n, speaker: 99999 }, VOICE).speaker).toBeNull();
    expect(resolveNarrationInput({ text: 'x', status: 'none' }, VOICE).speaker).toBeNull();
    expect(sameSynthInput(resolveNarrationInput(n, VOICE), resolveNarrationInput({ ...n, speaker: 3 }, VOICE))).toBe(false);
  });

  it('名乗りは場面の話者（掛け合いは行で決まる）', () => {
    const solo = { narration: { text: 'a', speaker: METAN } };
    const dialog = { lines: [{ text: 'b', speaker: 8 }], narration: { text: '', speaker: METAN } };
    const base = creditForSpeaker(3);
    expect(sceneVoiceCredits([solo, { narration: { text: 'c' } }], base)).toEqual([creditForSpeaker(METAN), base]);
    expect(usedVoiceCredits([solo], 3)).toEqual([creditForSpeaker(METAN)]);
    expect(soloCreditLine(solo)).toBe(solo.narration);
    expect(soloCreditLine(dialog)).toBeNull();
    expect(sceneCreditText({ mode: CREDIT_MODE.always }, [solo], soloCreditLine(solo), base)).toBe(creditForSpeaker(METAN));
  });

  it('正典の形（1.35）が話者を受け、整数でない話者は断る', () => {
    const doc = structuredClone(sample) as { scenes: { narration: Record<string, unknown> }[] };
    doc.scenes[0].narration.speaker = METAN;
    expect(validateProjectDoc(doc).errors).toEqual([]);
    doc.scenes[0].narration.speaker = 'metan';
    expect(validateProjectDoc(doc).valid).toBe(false);
  });

  it('学生が選べる声は、会社で使えるキャラのノーマルだけ・上限まで', () => {
    const choices = briefingVoiceChoices(VOICE_CATALOG, isCompanyOkVoiceCharacter);
    expect(choices.length).toBeGreaterThan(0);
    expect(choices.every((c) => isCompanyOkVoiceCharacter(c.character))).toBe(true);
    expect(choices[0]).toEqual({ speaker: VOICE_CATALOG.find((c) => isCompanyOkVoiceCharacter(c.character))!.styles[0].speaker, character: VOICE_CATALOG.find((c) => isCompanyOkVoiceCharacter(c.character))!.character });
    const many = Array.from({ length: 10 }, (_, i) => ({ character: `c${i}`, styles: [{ speaker: i }] }));
    expect(briefingVoiceChoices(many, (c) => c !== 'c1').map((c) => c.speaker)).toEqual([0, 2, 3, 4, 5, 6]);
    expect(briefingVoiceChoices([{ character: 'x', styles: [] }], () => true)).toEqual([]);
  });
});
