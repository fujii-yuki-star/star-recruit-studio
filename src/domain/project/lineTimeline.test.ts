import { describe, expect, it } from 'vitest';
import { NARRATION_STATUS } from '../enums';
import { activeLineIndexAt, lineSegments, resolveLineSubtitle } from './lineTimeline';
import type { NarrationLine, Scene } from './types';

function sceneWith(partial: Partial<Scene>): Scene {
  return {
    sceneId: 'scene_001', partId: 'part_001', order: 1, sceneType: 'opening', templateId: 'tpl',
    durationSec: 10, assetRefs: {}, character: { enabled: false, characterId: 'yuko' }, texts: {},
    narration: { text: 'ナレ', status: NARRATION_STATUS.none }, warnings: [], ...partial,
  } as Scene;
}

describe('resolveLineSubtitle（追加B）', () => {
  it('subtitleText 未指定は text を流用・enabled 既定 true', () => {
    const line: NarrationLine = { lineId: 'line_001', text: 'やあ', status: NARRATION_STATUS.none };
    expect(resolveLineSubtitle(line, sceneWith({}))).toEqual({ text: 'やあ', enabled: true });
  });

  it('subtitleText/subtitleEnabled を優先', () => {
    const line: NarrationLine = { lineId: 'line_001', text: 'やあ', subtitleText: '字幕', subtitleEnabled: false, status: NARRATION_STATUS.none };
    expect(resolveLineSubtitle(line, sceneWith({}))).toEqual({ text: '字幕', enabled: false });
  });

  it('行 enabled 未指定は場面 subtitleEnabledDefault を継承', () => {
    const line: NarrationLine = { lineId: 'line_001', text: 'やあ', status: NARRATION_STATUS.none };
    expect(resolveLineSubtitle(line, sceneWith({ subtitleEnabledDefault: false })).enabled).toBe(false);
  });
});

describe('lineSegments（追加A・自動逐次/明示startSec）', () => {
  it('自動逐次：音声長を積み上げて区間を作る（最終行は場面末）', () => {
    const lines: NarrationLine[] = [
      { lineId: 'line_001', text: 'a', status: NARRATION_STATUS.none },
      { lineId: 'line_002', text: 'b', status: NARRATION_STATUS.none },
    ];
    const segs = lineSegments(sceneWith({ lines }), { line_001: 3, line_002: 4 });
    expect(segs.map((s) => [s.startSec, s.endSec])).toEqual([[0, 3], [3, 10]]);
  });

  it('明示 startSec を優先（区間は次行の開始まで）', () => {
    const lines: NarrationLine[] = [
      { lineId: 'line_001', text: 'a', startSec: 1, status: NARRATION_STATUS.none },
      { lineId: 'line_002', text: 'b', startSec: 5, status: NARRATION_STATUS.none },
    ];
    const segs = lineSegments(sceneWith({ lines }), {});
    expect(segs.map((s) => [s.startSec, s.endSec])).toEqual([[1, 5], [5, 10]]);
  });

  it('場面尺を超える開始は durationSec にクランプ', () => {
    const lines: NarrationLine[] = [{ lineId: 'line_001', text: 'a', startSec: 99, status: NARRATION_STATUS.none }];
    expect(lineSegments(sceneWith({ lines }), {})[0]).toMatchObject({ startSec: 10, endSec: 10 });
  });

  it('単一 narration は1行のセグメント（[0,durationSec]）＝後方互換', () => {
    const segs = lineSegments(sceneWith({}), {});
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ lineId: 'line_001', startSec: 0, endSec: 10 });
  });
});

describe('activeLineIndexAt（追加A）', () => {
  const lines: NarrationLine[] = [
    { lineId: 'line_001', text: 'a', status: NARRATION_STATUS.none },
    { lineId: 'line_002', text: 'b', status: NARRATION_STATUS.none },
  ];
  const segs = lineSegments(sceneWith({ lines }), { line_001: 3, line_002: 4 }); // [0,3],[3,10]

  it('区間で有効行が変わる（[start,end)・最終行は end を含む）', () => {
    expect(activeLineIndexAt(segs, 0)).toBe(0);
    expect(activeLineIndexAt(segs, 2.9)).toBe(0);
    expect(activeLineIndexAt(segs, 3)).toBe(1);
    expect(activeLineIndexAt(segs, 10)).toBe(1);
  });

  it('空は -1', () => {
    expect(activeLineIndexAt([], 0)).toBe(-1);
  });
});
