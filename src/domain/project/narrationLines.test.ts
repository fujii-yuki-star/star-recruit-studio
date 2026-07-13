import { describe, expect, it } from 'vitest';
import { NARRATION_STATUS } from '../enums';
import {
  lineAudioKey, lineDurationsFromAudio, lineFromNarration, lineVoiceStem, liveNarrationAudioKeys, sceneLines,
  sceneNeedsVoice, validateSceneLines, withLineStatus, withLineVoicePath,
} from './narrationLines';
import { MockVoiceProvider } from '../../infrastructure/voiceProviders/mockVoiceProvider';
import type { Narration, NarrationLine, Scene } from './types';

const narration: Narration = {
  text: 'こんにちは',
  voiceId: null,
  speed: 1.1,
  pitch: 0.2,
  intonation: 1.4,
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
  it('単一 narration を line_001 の1行に写す（text/status/speed/pitch/intonation/voicePath を引継ぎ・#242）', () => {
    expect(lineFromNarration(narration)).toMatchObject({
      lineId: 'line_001', text: 'こんにちは', speed: 1.1, pitch: 0.2, intonation: 1.4,
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

describe('sceneNeedsVoice（#403 P1・掛け合い/単一を統一した実効判定）', () => {
  const mkLine = (over: Partial<NarrationLine>): NarrationLine =>
    ({ lineId: 'line_001', text: 'やあ', status: NARRATION_STATUS.none, ...over });

  it('単一 narration：本文あり・未生成 → true', () => {
    expect(sceneNeedsVoice(sceneWith({ narration: { ...narration, text: 'x', status: NARRATION_STATUS.none } }))).toBe(true);
  });
  it('単一 narration：生成済み → false', () => {
    expect(sceneNeedsVoice(sceneWith({ narration: { ...narration, text: 'x', status: NARRATION_STATUS.generated } }))).toBe(false);
  });
  it('本文が空（空白のみ）なら未生成でも false（読む物が無い）', () => {
    expect(sceneNeedsVoice(sceneWith({ narration: { ...narration, text: '  ', status: NARRATION_STATUS.none } }))).toBe(false);
  });
  it('掛け合い：全行 generated → false（narration.status=none でも見ない・#403 P1）', () => {
    const scene = sceneWith({
      narration: { ...narration, status: NARRATION_STATUS.none },
      lines: [mkLine({ lineId: 'line_001', status: NARRATION_STATUS.generated }), mkLine({ lineId: 'line_002', status: NARRATION_STATUS.generated })],
    });
    expect(sceneNeedsVoice(scene)).toBe(false);
  });
  it('掛け合い：本文ありの未生成行が1つでもあれば true', () => {
    const scene = sceneWith({ lines: [mkLine({ lineId: 'line_001', status: NARRATION_STATUS.generated }), mkLine({ lineId: 'line_002', status: NARRATION_STATUS.none })] });
    expect(sceneNeedsVoice(scene)).toBe(true);
  });
  it('掛け合い：未生成でも本文が空の行は対象外', () => {
    const scene = sceneWith({ lines: [mkLine({ lineId: 'line_001', status: NARRATION_STATUS.generated }), mkLine({ lineId: 'line_002', text: '', status: NARRATION_STATUS.none })] });
    expect(sceneNeedsVoice(scene)).toBe(false);
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

describe('行ごと音声の補助（PR-C2）', () => {
  it('lineAudioKey / lineVoiceStem', () => {
    expect(lineAudioKey('scene_001', 'line_002')).toBe('scene_001/line_002');
    expect(lineVoiceStem('scene_001', 'line_002')).toBe('scene_001_line_002');
  });

  it('liveNarrationAudioKeys：掛け合いは行キー・単一は sceneId・切替/削除で孤児を剪定できる（#390）', () => {
    const scenes = [
      sceneWith({ sceneId: 'scene_001', lines: [{ lineId: 'line_001', text: 'a', status: NARRATION_STATUS.none }, { lineId: 'line_002', text: 'b', status: NARRATION_STATUS.none }] }),
      { ...sceneWith({}), sceneId: 'scene_002' }, // 単一 narration（lines 無し）
    ];
    const keys = liveNarrationAudioKeys(scenes);
    // 掛け合いは行キー、単一は sceneId。sceneId=scene_001 の単一キーは含まない（＝掛け合い化で孤児になった sceneId 音声は剪定対象）。
    expect([...keys].sort()).toEqual(['scene_001/line_001', 'scene_001/line_002', 'scene_002']);
    expect(keys.has('scene_001')).toBe(false);
  });

  it('liveNarrationAudioKeys：lines が空配列の場面は単一扱い（sceneId キー）', () => {
    // sceneLines と同じく lines.length===0 は単一 narration とみなす（sceneId キー）。
    const keys = liveNarrationAudioKeys([{ ...sceneWith({}), sceneId: 'scene_003', lines: [] }]);
    expect([...keys]).toEqual(['scene_003']);
  });

  it('lineDurationsFromAudio：掛け合いの各行に実音声長を返す（音声のある行のみ・#392）', async () => {
    const mock = new MockVoiceProvider();
    const a1 = (await mock.synthesize({ text: 'あ', voiceId: 'v', speed: 1, pitch: 0, intonation: 1 })).audioDataUrl;
    const a2 = (await mock.synthesize({ text: 'これはずっと長いセリフです。', voiceId: 'v', speed: 1, pitch: 0, intonation: 1 })).audioDataUrl;
    const scene = sceneWith({
      sceneId: 'scene_001',
      lines: [
        { lineId: 'line_001', text: 'あ', status: NARRATION_STATUS.generated },
        { lineId: 'line_002', text: 'これはずっと長いセリフです。', status: NARRATION_STATUS.generated },
        { lineId: 'line_003', text: '未生成', status: NARRATION_STATUS.none },
      ],
    });
    const dur = lineDurationsFromAudio(scene, { 'scene_001/line_001': a1, 'scene_001/line_002': a2 });
    expect(dur.line_001).toBeGreaterThan(0);
    expect(dur.line_002).toBeGreaterThan(dur.line_001); // 長いセリフほど区間が長い
    expect(dur.line_003).toBeUndefined(); // 音声未生成の行は含めない（0＝自動逐次のまま）
  });

  it('lineDurationsFromAudio：単一 narration（明示 lines 無し）は空を返す', () => {
    // 実効1行＝常に全幅ゆえ区間尺は不要。
    expect(lineDurationsFromAudio(sceneWith({ sceneId: 'scene_001' }), { scene_001: 'x' })).toEqual({});
  });

  it('lineDurationsFromAudio：本文編集で none に戻った行は旧音声キャッシュの尺を使わない（#392 レビュー P1）', async () => {
    const mock = new MockVoiceProvider();
    const a1 = (await mock.synthesize({ text: 'これはそこそこ長いセリフです', voiceId: 'v', speed: 1, pitch: 0, intonation: 1 })).audioDataUrl;
    // line_001＝生成済み。line_002＝本文編集で none へ戻ったが旧 data URL がキャッシュに残存（Undo 安全のため・#390）。
    const scene = sceneWith({
      sceneId: 'scene_001',
      lines: [
        { lineId: 'line_001', text: 'A', status: NARRATION_STATUS.generated },
        { lineId: 'line_002', text: '編集後の新しい本文（未生成）', status: NARRATION_STATUS.none },
      ],
    });
    const dur = lineDurationsFromAudio(scene, { 'scene_001/line_001': a1, 'scene_001/line_002': a1 });
    expect(dur.line_001).toBeGreaterThan(0);
    expect(dur.line_002).toBeUndefined(); // none の行は旧尺を適用しない＝自動逐次へ（新本文に旧区間長を出さない）
  });

  it('withLineStatus：明示 lines は該当行・無ければ単一 narration を更新', () => {
    const multi = sceneWith({
      lines: [
        { lineId: 'line_001', text: 'a', status: NARRATION_STATUS.none },
        { lineId: 'line_002', text: 'b', status: NARRATION_STATUS.none },
      ],
    });
    const r = withLineStatus(multi, 'line_002', NARRATION_STATUS.generated);
    expect(r.lines?.map((l) => l.status)).toEqual([NARRATION_STATUS.none, NARRATION_STATUS.generated]);
    // lines 無し＝単一 narration を更新。
    expect(withLineStatus(sceneWith({}), 'line_001', NARRATION_STATUS.failed).narration.status).toBe(NARRATION_STATUS.failed);
  });

  it('withLineVoicePath：明示 lines は該当行・無ければ単一 narration を更新', () => {
    const multi = sceneWith({ lines: [{ lineId: 'line_001', text: 'a', status: NARRATION_STATUS.none }] });
    expect(withLineVoicePath(multi, 'line_001', 'voices/x.wav').lines?.[0].voicePath).toBe('voices/x.wav');
    expect(withLineVoicePath(sceneWith({}), 'line_001', null).narration.voicePath).toBeNull();
  });
});
