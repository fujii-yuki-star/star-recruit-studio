import { describe, expect, it } from 'vitest';
import { NARRATION_STATUS } from '../enums';
import { activeLineIndexAt, firstFrameBoundary, lastFrameBoundary, lineSegments, motionSubtitleAt, previewSubtitleSegment, resolveLineSubtitle, sceneSegmentSpecs, segmentAt } from './lineTimeline';
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

  it('subtitleText が明示 null のとき text を流用（null=継承）', () => {
    const line: NarrationLine = { lineId: 'line_001', text: 'やあ', subtitleText: null, status: NARRATION_STATUS.none };
    expect(resolveLineSubtitle(line, sceneWith({}))).toEqual({ text: 'やあ', enabled: true });
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

  it('先頭行の開始より前の時刻は先頭行へフォールバック（編集プレビュー＝先頭行表示）', () => {
    const late: NarrationLine[] = [{ lineId: 'line_001', text: 'a', startSec: 2, status: NARRATION_STATUS.none }];
    const s = lineSegments(sceneWith({ lines: late }), {});
    expect(activeLineIndexAt(s, 0)).toBe(0); // t=0 は startSec=2 より前だが先頭行(0)
  });
});

describe('sceneSegmentSpecs（書き出しセグメント・PR-E）', () => {
  it('単一 narration は1セグメント（字幕上書きなし・場面尺・isFirst）', () => {
    expect(sceneSegmentSpecs(sceneWith({}), {})).toEqual([{ startSec: 0, durationSec: 10, isFirst: true }]);
  });

  it('掛け合いは行ごと（字幕上書き＋開始秒＋区間尺・先頭のみ isFirst・OFFは null）', () => {
    const lines: NarrationLine[] = [
      { lineId: 'line_001', text: 'やあ', status: NARRATION_STATUS.none },
      { lineId: 'line_002', text: 'どうも', subtitleEnabled: false, status: NARRATION_STATUS.none },
    ];
    expect(sceneSegmentSpecs(sceneWith({ lines }), { line_001: 3, line_002: 4 })).toEqual([
      { lineId: 'line_001', subtitleText: 'やあ', startSec: 0, durationSec: 3, isFirst: true },
      { lineId: 'line_002', subtitleText: null, startSec: 3, durationSec: 7, isFirst: false }, // [3,10]・OFF→null
    ]);
  });

  it('0秒セグメント（音声未測定で endSec===startSec）は出さない', () => {
    const lines: NarrationLine[] = [
      { lineId: 'line_001', text: 'a', status: NARRATION_STATUS.none },
      { lineId: 'line_002', text: 'b', status: NARRATION_STATUS.none },
    ];
    // line_001 の音声長 0 → [0,0] で除外、line_002 が場面（[0,10]）を占める。
    expect(sceneSegmentSpecs(sceneWith({ lines }), { line_001: 0, line_002: 4 })).toEqual([
      { lineId: 'line_002', subtitleText: 'b', startSec: 0, durationSec: 10, isFirst: true },
    ]);
  });

  it('全行が0秒なら場面全体の1セグメントへフォールバック', () => {
    const lines: NarrationLine[] = [{ lineId: 'line_001', text: 'a', startSec: 10, status: NARRATION_STATUS.none }];
    expect(sceneSegmentSpecs(sceneWith({ lines }), {})).toEqual([{ startSec: 0, durationSec: 10, isFirst: true }]);
  });

  it('先頭行が途中開始なら先頭に「間」区間（字幕なし・音声なし・isGap）を足し、合計＝場面尺（#386・A案）', () => {
    const lines: NarrationLine[] = [
      { lineId: 'line_001', text: 'やあ', startSec: 2, status: NARRATION_STATUS.none },
      { lineId: 'line_002', text: 'どうも', startSec: 6, status: NARRATION_STATUS.none },
    ];
    const specs = sceneSegmentSpecs(sceneWith({ lines }), {});
    expect(specs).toEqual([
      { subtitleText: null, startSec: 0, durationSec: 2, isGap: true, isFirst: true }, // 間 [0,2)・字幕なし・lineId なし
      { lineId: 'line_001', subtitleText: 'やあ', startSec: 2, durationSec: 4, isFirst: false }, // [2,6)
      { lineId: 'line_002', subtitleText: 'どうも', startSec: 6, durationSec: 4, isFirst: false }, // [6,10]
    ]);
    // 合計＝場面尺（間を尊重＝静止画/プレビューでも場面が短縮しない）。
    expect(specs.reduce((s, p) => s + p.durationSec, 0)).toBe(10);
  });

  it('先頭行が0秒開始なら「間」区間は付かない（従来どおり・#386）', () => {
    const lines: NarrationLine[] = [
      { lineId: 'line_001', text: 'a', startSec: 0, status: NARRATION_STATUS.none },
      { lineId: 'line_002', text: 'b', startSec: 4, status: NARRATION_STATUS.none },
    ];
    const specs = sceneSegmentSpecs(sceneWith({ lines }), {});
    expect(specs.some((s) => 'isGap' in s)).toBe(false);
    expect(specs[0]).toMatchObject({ lineId: 'line_001', startSec: 0, isFirst: true });
  });
});

describe('firstFrameBoundary / lastFrameBoundary（切替プレビューの端フレーム・sceneSegmentSpecs 準拠・#408 Part 2 レビュー P1）', () => {
  it('非掛け合い（行なし）はテンプレ既定（subtitleText=undefined・既定クレジット）', () => {
    expect(firstFrameBoundary(sceneWith({}))).toEqual({ subtitleText: undefined, creditLine: undefined });
    expect(lastFrameBoundary(sceneWith({}))).toEqual({ subtitleText: undefined, creditLine: undefined });
  });

  it('掛け合いで頭に間（先頭行 startSec>0）＝先頭は字幕なし・既定クレジット（headGap 一致）／末尾は末尾行', () => {
    const lines: NarrationLine[] = [
      { lineId: 'line_001', text: 'a', startSec: 2, status: NARRATION_STATUS.none },
      { lineId: 'line_002', text: 'b', startSec: 6, status: NARRATION_STATUS.none },
    ];
    expect(firstFrameBoundary(sceneWith({ lines }))).toEqual({ subtitleText: null, creditLine: undefined }); // 間
    expect(lastFrameBoundary(sceneWith({ lines }))).toEqual({ subtitleText: 'b', creditLine: lines[1] }); // 末尾行
  });

  it('掛け合いで頭に間が無い（先頭行 startSec=0）＝先頭は先頭行の字幕・クレジット', () => {
    const lines: NarrationLine[] = [
      { lineId: 'line_001', text: 'a', startSec: 0, status: NARRATION_STATUS.none },
      { lineId: 'line_002', text: 'b', startSec: 5, status: NARRATION_STATUS.none },
    ];
    expect(firstFrameBoundary(sceneWith({ lines }))).toEqual({ subtitleText: 'a', creditLine: lines[0] });
  });

  it('字幕 OFF の行は subtitleText=null だがクレジットは行の話者（間＝creditLine undefined と区別）', () => {
    const lines: NarrationLine[] = [
      { lineId: 'line_001', text: 'a', startSec: 0, subtitleEnabled: false, status: NARRATION_STATUS.none },
    ];
    expect(firstFrameBoundary(sceneWith({ lines }))).toEqual({ subtitleText: null, creditLine: lines[0] });
  });

  it('【P1】最終行が startSec===durationSec（0 秒行）＝末尾は直前の生存行（書き出しの 0 秒行除外と一致）', () => {
    const lines: NarrationLine[] = [
      { lineId: 'line_001', text: 'a', startSec: 0, status: NARRATION_STATUS.none },
      { lineId: 'line_002', text: 'b', startSec: 10, status: NARRATION_STATUS.none }, // = durationSec ゆえ [10,10]＝0 秒→除外
    ];
    // 書き出し（sceneSegmentSpecs）は line_002 を落とし line_001 が場面全体。プレビュー末尾も line_001。
    expect(lastFrameBoundary(sceneWith({ lines }))).toEqual({ subtitleText: 'a', creditLine: lines[0] });
    expect(firstFrameBoundary(sceneWith({ lines }))).toEqual({ subtitleText: 'a', creditLine: lines[0] });
  });

  it('【P1】先頭行が startSec===durationSec（全 0 秒→フォールバック）＝先頭はテンプレ既定（間ではない・書き出し一致）', () => {
    const lines: NarrationLine[] = [
      { lineId: 'line_001', text: 'a', startSec: 10, status: NARRATION_STATUS.none }, // = durationSec ゆえ全行 0 秒
    ];
    // 書き出しは nonEmpty=[] → 場面全体1セグメント（lineId/subtitleText なし＝テンプレ既定）。プレビューも既定（間 null にしない）。
    expect(firstFrameBoundary(sceneWith({ lines }))).toEqual({ subtitleText: undefined, creditLine: undefined });
    expect(lastFrameBoundary(sceneWith({ lines }))).toEqual({ subtitleText: undefined, creditLine: undefined });
  });

  it('自動逐次（startSec 未指定）は実音声長で区間＝先頭は先頭行・末尾は末尾行', () => {
    const lines: NarrationLine[] = [
      { lineId: 'line_001', text: 'a', status: NARRATION_STATUS.none },
      { lineId: 'line_002', text: 'b', status: NARRATION_STATUS.none },
    ];
    const durs = { line_001: 3, line_002: 4 }; // [0,3],[3,10]
    expect(firstFrameBoundary(sceneWith({ lines }), durs)).toEqual({ subtitleText: 'a', creditLine: lines[0] });
    expect(lastFrameBoundary(sceneWith({ lines }), durs)).toEqual({ subtitleText: 'b', creditLine: lines[1] });
  });
});

describe('segmentAt（ADR-0029・字幕解決の正準入力＝sceneSegmentSpecs 直結）', () => {
  it('単一 narration はどの t でも1セグメント（lineId/isGap なし）', () => {
    const s = sceneWith({});
    expect(segmentAt(s, {}, 0)).toMatchObject({ startSec: 0, durationSec: 10, isFirst: true });
    expect(segmentAt(s, {}, 5).lineId).toBeUndefined();
    expect(segmentAt(s, {}, 10).durationSec).toBe(10);
  });

  it('掛け合い自動逐次：t が属する行セグメントを返す（末尾 t=尺 は最終行）', () => {
    const lines: NarrationLine[] = [
      { lineId: 'line_001', text: 'a', status: NARRATION_STATUS.none },
      { lineId: 'line_002', text: 'b', status: NARRATION_STATUS.none },
    ];
    const s = sceneWith({ lines });
    const durs = { line_001: 3, line_002: 4 }; // [0,3),[3,10]
    expect(segmentAt(s, durs, 0).lineId).toBe('line_001');
    expect(segmentAt(s, durs, 2.9).lineId).toBe('line_001');
    expect(segmentAt(s, durs, 3).lineId).toBe('line_002');
    expect(segmentAt(s, durs, 10).lineId).toBe('line_002'); // 末尾は端含む
  });

  it('先頭の「間」（先頭行 startSec>0）は isGap セグメント・行に入ると行セグメント（activeLineIndexAt と違い間を表せる）', () => {
    const lines: NarrationLine[] = [{ lineId: 'line_001', text: 'a', startSec: 2, status: NARRATION_STATUS.none }];
    const s = sceneWith({ lines });
    expect(segmentAt(s, {}, 1)).toMatchObject({ isGap: true }); // [0,2) は間
    expect(segmentAt(s, {}, 1).lineId).toBeUndefined();
    expect(segmentAt(s, {}, 2).lineId).toBe('line_001'); // [2,10] は行
  });
});

describe('motionSubtitleAt（#527 P1・「動き」再生の字幕は時刻追従＝先頭固定にしない・書き出しと一致）', () => {
  const lines: NarrationLine[] = [
    { lineId: 'line_001', text: 'あ', subtitleText: '字幕1', speaker: 3, status: NARRATION_STATUS.none },
    { lineId: 'line_002', text: 'い', subtitleText: '字幕2', speaker: 2, status: NARRATION_STATUS.none },
  ];
  const durs = { line_001: 3, line_002: 4 }; // [0,3),[3,10]

  it('t=0（停止相当）は先頭セグメント＝firstFrameBoundary と同値（静止表示の後方互換）', () => {
    const s = sceneWith({ lines });
    const r = motionSubtitleAt(s, durs, 0);
    expect(r.segment.lineId).toBe('line_001');
    expect(r.boundary).toEqual(firstFrameBoundary(s, durs)); // 停止時は従来の先頭フレームと一致
  });

  it('アニメ中に2行目の窓へ入ると segment・通常字幕・クレジット行が2行目へ追従（先頭固定の回帰防止）', () => {
    const s = sceneWith({ lines });
    expect(motionSubtitleAt(s, durs, 2.9).segment.lineId).toBe('line_001');
    const r = motionSubtitleAt(s, durs, 3); // line_002 の窓 [3,10]
    expect(r.segment.lineId).toBe('line_002'); // FREE 字幕の対象解決に渡すセグメント
    expect(r.boundary.subtitleText).toBe('字幕2'); // 通常テンプレ字幕も2行目
    expect(r.boundary.creditLine).toEqual(lines[1]); // クレジット行（話者連動）も2行目
  });

  it('頭空白（先頭行 startSec>0）の t は間（isGap）＝字幕なし（間は表示しない）', () => {
    const gap = sceneWith({ lines: [{ lineId: 'line_001', text: 'A', startSec: 2, status: NARRATION_STATUS.none }] });
    const r = motionSubtitleAt(gap, {}, 1); // [0,2) は間
    expect(r.segment.isGap).toBe(true);
    expect(r.boundary.subtitleText).toBeNull();
    expect(r.boundary.creditLine).toBeUndefined();
  });
});

describe('previewSubtitleSegment（ADR-0029・停止/再生の正準セグメント・P1 停止時パリティ）', () => {
  const gapScene = (): Scene => sceneWith({ lines: [
    { lineId: 'line_001', text: 'A', startSec: 2, status: NARRATION_STATUS.none }, // 頭空白 [0,2)
    { lineId: 'line_002', text: 'B', startSec: 5, status: NARRATION_STATUS.none },
  ] });

  it('停止中（初期）は先頭セグメント＝頭空白があれば間（isGap）＝t=0 の書き出しと一致', () => {
    const seg = previewSubtitleSegment(gapScene(), {}, 0, false); // activeLine=0 でも停止なら先頭（間）
    expect(seg.isGap).toBe(true);
    expect(seg.lineId).toBeUndefined();
  });

  it('再生中・有効行は行セグメント（lineId）', () => {
    expect(previewSubtitleSegment(gapScene(), {}, 0, true).lineId).toBe('line_001');
  });

  it('再生中・間（activeLine<0）は isGap セグメント', () => {
    expect(previewSubtitleSegment(gapScene(), {}, -1, true).isGap).toBe(true);
  });

  it('全ゼロ長行は停止・再生とも場面全体1区間（lineId なし）＝書き出しフォールバックと一致', () => {
    const zero = sceneWith({ lines: [{ lineId: 'line_001', text: 'A', startSec: 10, status: NARRATION_STATUS.none }] });
    expect(previewSubtitleSegment(zero, {}, 0, false).lineId).toBeUndefined();
    expect(previewSubtitleSegment(zero, {}, 0, true).lineId).toBeUndefined();
  });

  it('頭空白なしは停止時に先頭行セグメント', () => {
    const s = sceneWith({ lines: [{ lineId: 'line_001', text: 'A', status: NARRATION_STATUS.none }] });
    expect(previewSubtitleSegment(s, {}, 0, false).lineId).toBe('line_001');
  });
});
