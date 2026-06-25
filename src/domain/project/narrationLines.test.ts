import { describe, expect, it } from 'vitest';
import { NARRATION_STATUS } from '../enums';
import { lineFromNarration, sceneLines, validateSceneLines } from './narrationLines';
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

describe('validateSceneLines (V16-V19・ADR-0015)', () => {
  it('lines 無し/空は警告なし（単一 narration は対象外）', () => {
    expect(validateSceneLines(undefined, 8)).toEqual([]);
    expect(validateSceneLines([], 8)).toEqual([]);
  });

  it('V16: lineId 重複を検出（LINE_ID_DUPLICATE）', () => {
    const lines: NarrationLine[] = [
      { lineId: 'line_001', text: 'a', status: NARRATION_STATUS.none },
      { lineId: 'line_001', text: 'b', status: NARRATION_STATUS.none },
    ];
    expect(validateSceneLines(lines, 8).map((w) => w.code)).toContain('LINE_ID_DUPLICATE');
  });

  it('V19: 未知 speaker のみ検出（既知/未指定は許容）', () => {
    const lines: NarrationLine[] = [
      { lineId: 'line_001', text: 'a', speaker: 3, status: NARRATION_STATUS.none }, // 既知（ずんだもん）
      { lineId: 'line_002', text: 'b', status: NARRATION_STATUS.none }, // 未指定＝継承
      { lineId: 'line_003', text: 'c', speaker: 99999, status: NARRATION_STATUS.none }, // 未知
    ];
    expect(validateSceneLines(lines, 8).map((w) => w.code)).toEqual(['LINE_SPEAKER_UNKNOWN']);
  });

  it('V17: startSec が範囲外（負・場面尺超過）の両境界で LINE_START_OUT_OF_RANGE', () => {
    const over: NarrationLine[] = [{ lineId: 'line_001', text: 'a', startSec: 10, status: NARRATION_STATUS.none }];
    const neg: NarrationLine[] = [{ lineId: 'line_001', text: 'a', startSec: -1, status: NARRATION_STATUS.none }];
    expect(validateSceneLines(over, 8).map((w) => w.code)).toContain('LINE_START_OUT_OF_RANGE');
    expect(validateSceneLines(neg, 8).map((w) => w.code)).toContain('LINE_START_OUT_OF_RANGE');
  });

  it('V18: startSec が降順だと LINE_ORDER_INVALID', () => {
    const lines: NarrationLine[] = [
      { lineId: 'line_001', text: 'a', startSec: 5, status: NARRATION_STATUS.none },
      { lineId: 'line_002', text: 'b', startSec: 2, status: NARRATION_STATUS.none },
    ];
    expect(validateSceneLines(lines, 8).map((w) => w.code)).toContain('LINE_ORDER_INVALID');
  });

  it('V18: startSec が等値でも LINE_ORDER_INVALID（時間重複なし）', () => {
    const lines: NarrationLine[] = [
      { lineId: 'line_001', text: 'a', startSec: 3, status: NARRATION_STATUS.none },
      { lineId: 'line_002', text: 'b', startSec: 3, status: NARRATION_STATUS.none },
    ];
    expect(validateSceneLines(lines, 8).map((w) => w.code)).toContain('LINE_ORDER_INVALID');
  });

  it('正常な lines（一意・既知speaker・昇順・範囲内）は警告なし', () => {
    const lines: NarrationLine[] = [
      { lineId: 'line_001', text: 'a', speaker: 3, startSec: 0, status: NARRATION_STATUS.none },
      { lineId: 'line_002', text: 'b', speaker: 2, startSec: 3, status: NARRATION_STATUS.none },
    ];
    expect(validateSceneLines(lines, 8)).toEqual([]);
  });
});
