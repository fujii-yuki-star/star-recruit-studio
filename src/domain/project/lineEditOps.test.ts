import { describe, expect, it } from 'vitest';
import { NARRATION_STATUS } from '../enums';
import { addLine, demoteFromLines, moveLine, promoteToLines, removeLine, updateLine } from './lineEditOps';
import type { NarrationLine, Scene, SubtitleSource } from './types';

function sceneWith(partial: Partial<Scene>): Scene {
  return {
    sceneId: 'scene_001', partId: 'part_001', order: 1, sceneType: 'opening', templateId: 'tpl',
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: 'yuko' }, texts: {},
    narration: { text: 'こんにちは', status: NARRATION_STATUS.generated, voicePath: 'voices/scene_001.wav' },
    warnings: [], ...partial,
  } as Scene;
}

describe('promoteToLines / demoteFromLines', () => {
  it('単一 narration を lines:[line_001] へ昇格（text/status を引継ぎ）', () => {
    const r = promoteToLines(sceneWith({}));
    expect(r.lines?.map((l) => [l.lineId, l.text])).toEqual([['line_001', 'こんにちは']]);
    expect(r.lines?.[0].status).toBe(NARRATION_STATUS.generated);
  });

  it('既に lines があれば昇格しても変化なし', () => {
    const lines: NarrationLine[] = [{ lineId: 'line_001', text: 'a', status: NARRATION_STATUS.none }];
    expect(promoteToLines(sceneWith({ lines }))).toMatchObject({ lines });
  });

  it('降格：lines[0] を narration に戻し lines を消す（text/status/voicePath/speed/pitch/intonation 引継ぎ・2行目以降は破棄）', () => {
    const lines: NarrationLine[] = [
      { lineId: 'line_001', text: 'やあ', speed: 1.2, pitch: 0.1, intonation: 1.5, status: NARRATION_STATUS.generated, voicePath: 'v.wav' },
      { lineId: 'line_002', text: 'どうも', status: NARRATION_STATUS.none },
    ];
    const r = demoteFromLines(sceneWith({ lines }));
    expect(r.lines).toBeUndefined();
    expect(r.narration).toMatchObject({ text: 'やあ', status: NARRATION_STATUS.generated, voicePath: 'v.wav', speed: 1.2, pitch: 0.1, intonation: 1.5 });
  });
});

describe('addLine', () => {
  it('単一 narration から追加すると昇格＋空行（line_002）が増える', () => {
    const r = addLine(sceneWith({}));
    expect(r.lines?.map((l) => l.lineId)).toEqual(['line_001', 'line_002']);
    expect(r.lines?.[1]).toMatchObject({ text: '', status: NARRATION_STATUS.none });
  });

  it('連番で id を採る（衝突しない最小番号）', () => {
    const lines: NarrationLine[] = [{ lineId: 'line_001', text: 'a', status: NARRATION_STATUS.none }];
    expect(addLine(sceneWith({ lines })).lines?.map((l) => l.lineId)).toEqual(['line_001', 'line_002']);
  });
});

describe('removeLine', () => {
  it('複数行のうち1つを消す', () => {
    const lines: NarrationLine[] = [
      { lineId: 'line_001', text: 'a', status: NARRATION_STATUS.none },
      { lineId: 'line_002', text: 'b', status: NARRATION_STATUS.none },
    ];
    expect(removeLine(sceneWith({ lines }), 'line_001').lines?.map((l) => l.lineId)).toEqual(['line_002']);
  });

  it('最後の1行を消すと掛け合い解除（単一 narration へ）', () => {
    const lines: NarrationLine[] = [{ lineId: 'line_001', text: 'のこり', status: NARRATION_STATUS.none }];
    const r = removeLine(sceneWith({ lines }), 'line_001');
    expect(r.lines).toBeUndefined();
    expect(r.narration.text).toBe('のこり');
  });
});

describe('updateLine', () => {
  const lines: NarrationLine[] = [
    { lineId: 'line_001', text: 'a', speaker: 3, status: NARRATION_STATUS.generated, voicePath: 'v.wav' },
  ];

  it('text 変更で status/voicePath をリセット（声の作り直し）', () => {
    const r = updateLine(sceneWith({ lines }), 'line_001', { text: 'b' });
    expect(r.lines?.[0]).toMatchObject({ text: 'b', status: NARRATION_STATUS.none, voicePath: null });
  });

  it('speaker 変更でも status をリセット', () => {
    expect(updateLine(sceneWith({ lines }), 'line_001', { speaker: 2 }).lines?.[0].status).toBe(NARRATION_STATUS.none);
  });

  it('抑揚（intonation）変更でも status をリセット（声の作り直し・#242）', () => {
    expect(updateLine(sceneWith({ lines }), 'line_001', { intonation: 1.4 }).lines?.[0].status).toBe(NARRATION_STATUS.none);
  });

  it('字幕（subtitleEnabled）変更では status を保つ（音声に無関係）', () => {
    const r = updateLine(sceneWith({ lines }), 'line_001', { subtitleEnabled: false });
    expect(r.lines?.[0]).toMatchObject({ subtitleEnabled: false, status: NARRATION_STATUS.generated });
  });

  it('字幕文言（subtitleText）変更でも status を保つ（音声に無関係）', () => {
    const r = updateLine(sceneWith({ lines }), 'line_001', { subtitleText: '別の字幕' });
    expect(r.lines?.[0]).toMatchObject({ subtitleText: '別の字幕', status: NARRATION_STATUS.generated });
  });
});

describe('moveLine', () => {
  const lines: NarrationLine[] = [
    { lineId: 'line_001', text: 'a', status: NARRATION_STATUS.none },
    { lineId: 'line_002', text: 'b', status: NARRATION_STATUS.none },
    { lineId: 'line_003', text: 'c', status: NARRATION_STATUS.none },
  ];

  it('後ろへ移動（+1）', () => {
    expect(moveLine(sceneWith({ lines }), 'line_001', 1).lines?.map((l) => l.lineId)).toEqual(['line_002', 'line_001', 'line_003']);
  });

  it('前へ移動（-1）', () => {
    expect(moveLine(sceneWith({ lines }), 'line_003', -1).lines?.map((l) => l.lineId)).toEqual(['line_001', 'line_003', 'line_002']);
  });

  it('範囲外（先頭をさらに前へ）は変化なし', () => {
    expect(moveLine(sceneWith({ lines }), 'line_001', -1).lines?.map((l) => l.lineId)).toEqual(['line_001', 'line_002', 'line_003']);
  });
});

describe('字幕対象の正規化（掛け合い解除・話者変更/削除で無効な対象を戻す・ADR-0026④・PR-C P1）', () => {
  const dialogueWithSub = (source: SubtitleSource, lines: NarrationLine[]): Scene =>
    sceneWith({ sceneType: 'free', lines, freeLayout: [{ id: 'free_001', kind: 'subtitle', x: 0, y: 0, w: 100, h: 50, subtitleSource: source }] } as Partial<Scene>);
  const subSource = (s: Scene): SubtitleSource | undefined => s.freeLayout?.[0]?.subtitleSource;

  it('掛け合い解除（demoteFromLines）で allLines 対象を未設定へ戻す（黙って消さない）', () => {
    const s = dialogueWithSub({ kind: 'allLines' }, [{ lineId: 'line_001', text: 'A', speaker: 3, status: NARRATION_STATUS.none }]);
    expect(subSource(demoteFromLines(s))).toBeUndefined();
  });

  it('話者変更（updateLine）で対象話者が場面から消えたら未設定へ戻す', () => {
    const s = dialogueWithSub({ kind: 'speaker', speaker: { kind: 'catalog', speaker: 3 } }, [{ lineId: 'line_001', text: 'A', speaker: 3, status: NARRATION_STATUS.none }]);
    expect(subSource(updateLine(s, 'line_001', { speaker: 2 }))).toBeUndefined(); // speaker3 が不在に
  });

  it('話者削除（removeLine）で対象話者が消えたら未設定へ戻す（他行は残す）', () => {
    const s = dialogueWithSub({ kind: 'speaker', speaker: { kind: 'catalog', speaker: 3 } }, [
      { lineId: 'line_001', text: 'A', speaker: 3, status: NARRATION_STATUS.none },
      { lineId: 'line_002', text: 'B', speaker: 2, status: NARRATION_STATUS.none },
    ]);
    const r = removeLine(s, 'line_001');
    expect(r.lines?.map((l) => l.lineId)).toEqual(['line_002']);
    expect(subSource(r)).toBeUndefined();
  });

  it('対象話者が残っていれば不変（有効な対象は消さない）', () => {
    const s = dialogueWithSub({ kind: 'speaker', speaker: { kind: 'catalog', speaker: 3 } }, [
      { lineId: 'line_001', text: 'A', speaker: 3, status: NARRATION_STATUS.none },
      { lineId: 'line_002', text: 'B', speaker: 3, status: NARRATION_STATUS.none },
    ]);
    expect(subSource(removeLine(s, 'line_001'))).toEqual({ kind: 'speaker', speaker: { kind: 'catalog', speaker: 3 } });
  });
});
