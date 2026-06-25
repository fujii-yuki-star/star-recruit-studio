import { describe, expect, it } from 'vitest';
import { NARRATION_STATUS } from '../enums';
import { lineFromNarration, sceneLines } from './narrationLines';
import type { Narration, NarrationLine, Scene } from './types';

const narration: Narration = {
  text: 'こんにちは',
  voiceId: null,
  speed: 1.1,
  pitch: 0.2,
  voicePath: 'voices/scene_001.wav',
  status: NARRATION_STATUS.generated,
};

function sceneWith(partial: Partial<Scene>): Scene {
  return {
    sceneId: 'scene_001', partId: 'part_001', order: 1, sceneType: 'opening', templateId: 'tpl',
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: 'yuko' }, texts: {},
    narration, warnings: [], ...partial,
  } as Scene;
}

describe('lineFromNarration', () => {
  it('単一 narration を line_001 の1行に写す（text/status/speed/pitch/voicePath を引継ぎ）', () => {
    expect(lineFromNarration(narration)).toMatchObject({
      lineId: 'line_001', text: 'こんにちは', speed: 1.1, pitch: 0.2,
      voicePath: 'voices/scene_001.wav', status: NARRATION_STATUS.generated,
    });
  });

  it('voiceId（文字列）は speaker（数値）へ逆変換しない＝speaker 未指定（既定声を継承）', () => {
    expect(lineFromNarration(narration).speaker).toBeUndefined();
  });
});

describe('sceneLines', () => {
  it('lines が無ければ単一 narration を1行に解決（後方互換）', () => {
    const lines = sceneLines(sceneWith({}));
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe('こんにちは');
    expect(lines[0].lineId).toBe('line_001');
  });

  it('lines があればそれを返す（掛け合い・話者は行ごと）', () => {
    const myLines: NarrationLine[] = [
      { lineId: 'line_001', text: 'やあ', speaker: 3, status: NARRATION_STATUS.none },
      { lineId: 'line_002', text: 'どうも', speaker: 2, status: NARRATION_STATUS.none },
    ];
    const lines = sceneLines(sceneWith({ lines: myLines }));
    expect(lines).toBe(myLines);
    expect(lines.map((l) => l.speaker)).toEqual([3, 2]);
  });

  it('lines が空配列なら単一 narration へフォールバック', () => {
    const lines = sceneLines(sceneWith({ lines: [] }));
    expect(lines).toHaveLength(1);
    expect(lines[0].lineId).toBe('line_001');
  });
});
