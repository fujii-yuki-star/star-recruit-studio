import { describe, expect, it } from 'vitest';
import { EXPORT_RUN_PHASES, exportEncodePercent, exportHeadingLabel, exportOverallPercent, exportPhaseLabel, exportProgressLabel, isExportFinished, pastExportNotice } from './exportProgress';

describe('exportEncodePercent（#376）', () => {
  it('encode は step/total を 80→92 に按分する', () => {
    expect(exportEncodePercent({ phase: 'encode', step: 0, total: 4 })).toBe(80);
    expect(exportEncodePercent({ phase: 'encode', step: 2, total: 4 })).toBe(86);
    expect(exportEncodePercent({ phase: 'encode', step: 4, total: 4 })).toBe(92);
  });

  it('encode の total=0（想定外）は基準 80% にフォールバック', () => {
    expect(exportEncodePercent({ phase: 'encode', step: 0, total: 0 })).toBe(80);
  });

  it('step>total でも上限 92% を超えない（クランプ）', () => {
    expect(exportEncodePercent({ phase: 'encode', step: 9, total: 4 })).toBe(92);
  });

  it('後段は段階的に上がる（join<telop<bgm・いずれも<100）', () => {
    const join = exportEncodePercent({ phase: 'join', step: 0, total: 0 });
    const telop = exportEncodePercent({ phase: 'telop', step: 0, total: 0 });
    const bgm = exportEncodePercent({ phase: 'bgm', step: 0, total: 0 });
    expect(join).toBeLessThan(telop);
    expect(telop).toBeLessThan(bgm);
    expect(bgm).toBeLessThan(100);
    expect(join).toBeGreaterThanOrEqual(92);
  });
});

describe('exportPhaseLabel（§2-3：技術用語を出さない）', () => {
  it('各段の文言（テロップ→字幕・非技術）', () => {
    expect(exportPhaseLabel({ phase: 'encode', step: 1, total: 1 })).toBe('映像を作成しています');
    expect(exportPhaseLabel({ phase: 'encode', step: 2, total: 4 })).toBe('映像を作成しています（2/4）');
    expect(exportPhaseLabel({ phase: 'join', step: 0, total: 0 })).toBe('つなぎ合わせています');
    expect(exportPhaseLabel({ phase: 'telop', step: 0, total: 0 })).toBe('字幕を重ねています');
    expect(exportPhaseLabel({ phase: 'bgm', step: 0, total: 0 })).toBe('BGMを合わせています');
  });

  it('encode 文言に技術用語（テロップ/エンコード/フレーム）を含まない', () => {
    const s = exportPhaseLabel({ phase: 'telop', step: 0, total: 0 });
    expect(s).not.toMatch(/テロップ|エンコード|フレーム|encode/);
  });
});

// #547 P2-1：書き出し画面と、他画面に出す「書き出し中」バナーが同じ数字・同じ説明を出すための単一の参照元。
// 別々に計算すると、画面を移った利用者に違う進捗が見えて「止まった/戻った」と誤認させる（ADR-0026②）。
describe('exportOverallPercent / exportProgressLabel（進捗の単一参照元・#547 P2-1）', () => {
  it('レンダリング段は場面数で 0〜80%（フレーム進捗も混ぜて滑らかに）', () => {
    expect(exportOverallPercent({ phase: 'rendering', progress: { done: 0, total: 8 } })).toBe(0);
    expect(exportOverallPercent({ phase: 'rendering', progress: { done: 2, total: 8 } })).toBe(20);
    expect(exportOverallPercent({ phase: 'rendering', progress: { done: 8, total: 8 } })).toBe(80);
    // 処理中の場面のフレーム進捗ぶんだけ先へ進む（バーが場面境界で凍らない・#391）。
    expect(exportOverallPercent({ phase: 'rendering', progress: { done: 2, total: 8, frameFraction: 0.5 } })).toBe(25);
    // 最後の場面をほぼ焼き終えても、レンダリング段の上限（80%）を超えない＝エンコード段へ食い込まない。
    expect(exportOverallPercent({ phase: 'rendering', progress: { done: 7, total: 8, frameFraction: 0.99 } })).toBe(80);
  });

  it('エンコード段は 80% から始まり、進捗イベントがあればその値', () => {
    expect(exportOverallPercent({ phase: 'encoding', progress: { done: 0, total: 0 } })).toBe(80);
    expect(exportOverallPercent({ phase: 'encoding', progress: { done: 0, total: 0 }, encode: { phase: 'join', step: 0, total: 0 } })).toBe(94);
  });

  it('完了は 100%、開始前・場面0は 0%（0除算にしない）', () => {
    expect(exportOverallPercent({ phase: 'done', progress: { done: 0, total: 0 } })).toBe(100);
    expect(exportOverallPercent({ phase: 'idle', progress: { done: 0, total: 0 } })).toBe(0);
    expect(exportOverallPercent({ phase: 'rendering', progress: { done: 0, total: 0 } })).toBe(0);
  });

  it('説明は「いま何をしているか」を非技術語で出す（処理中の場面は1始まり）', () => {
    expect(exportProgressLabel({ phase: 'rendering', progress: { done: 2, total: 8 } })).toBe('場面 3 / 8 を処理中');
    // 最後の場面を処理中でも総数を超えない。
    expect(exportProgressLabel({ phase: 'rendering', progress: { done: 8, total: 8 } })).toBe('場面 8 / 8 を処理中');
    expect(exportProgressLabel({ phase: 'encoding', progress: { done: 0, total: 0 } })).toBe('最後の仕上げ中です。そのままお待ちください。');
    expect(exportProgressLabel({ phase: 'encoding', progress: { done: 0, total: 0 }, encode: { phase: 'telop', step: 0, total: 0 } })).toBe('字幕を重ねています');
    expect(exportProgressLabel({ phase: 'idle', progress: { done: 0, total: 0 } })).toBe(''); // 出すものが無い
    // 抽出時に足したガード：場面0で「場面 1 / 0 を処理中」と出さない（旧インライン実装はここが素通りだった）。
    expect(exportProgressLabel({ phase: 'rendering', progress: { done: 0, total: 0 } })).toBe('');
  });

  // バナーは「動画を書き出し中です（80%・◯◯）。」と1文の括弧内に差し込むので、句点で終わる完結文を入れない。
  it('compact は文の途中に差し込める短い語にする（完結文を入れ子にしない）', () => {
    const encoding = { phase: 'encoding' as const, progress: { done: 0, total: 0 } };
    expect(exportProgressLabel(encoding)).toBe('最後の仕上げ中です。そのままお待ちください。');
    expect(exportProgressLabel(encoding, { compact: true })).toBe('最後の仕上げ中');
    // 差があるのはこの分岐だけ（他は同じ＝説明が2通りにならない）。
    const rendering = { phase: 'rendering' as const, progress: { done: 2, total: 8 } };
    expect(exportProgressLabel(rendering, { compact: true })).toBe(exportProgressLabel(rendering));
  });
});

// 見出し（粗い状態）も共有＝書き出し画面と他画面バナーで別の状態名を出さない（ADR-0026②）。
// 文言は 06_UI_SPEC §12 の進捗表示例「動画を書き出しています／場面 3 / 12 を処理中」に合わせる。
describe('exportHeadingLabel（進捗の見出し・#547 P2-1）', () => {
  it('書き出し中は段階によらず同じ見出し（準備/まとめ、と言い分けない）', () => {
    expect(exportHeadingLabel({ phase: 'rendering', progress: { done: 1, total: 4 } })).toBe('動画を書き出しています');
    expect(exportHeadingLabel({ phase: 'encoding', progress: { done: 4, total: 4 } })).toBe('動画を書き出しています');
  });

  it('完了は保存したことを伝え、書き出していない間は出さない', () => {
    expect(exportHeadingLabel({ phase: 'done', progress: { done: 0, total: 0 } })).toBe('保存しました');
    expect(exportHeadingLabel({ phase: 'idle', progress: { done: 0, total: 0 } })).toBe('');
    expect(exportHeadingLabel({ phase: 'cancelled', progress: { done: 0, total: 0 } })).toBe('');
  });
});

// 前回の書き出しの結果を「いま起きたこと」として出し続けない（#547 P3-11）。
// 実行状態は次の書き出しまで残る（画面を移っても進捗が見える＝#379/P2-1）ので、離れて戻ったときの
// 見せ方だけを変える。どのフェーズを「終わった結果」とみなすかを、この2関数で1か所に置く。
describe('isExportFinished / pastExportNotice（前回の結果・#547 P3-11）', () => {
  it('結果が確定した3つ（保存・失敗・中止）だけを「終わった結果」とみなす', () => {
    expect(isExportFinished('done')).toBe(true);
    expect(isExportFinished('error')).toBe(true);
    expect(isExportFinished('cancelled')).toBe(true);
    expect(isExportFinished('idle')).toBe(false);
    expect(isExportFinished('rendering')).toBe(false);
    expect(isExportFinished('encoding')).toBe(false);
  });

  it('unsupported は「この端末では書き出せない」という今の事情＝前回の結果にしない', () => {
    // 過去形で示すと「いま押せば書き出せる」と読めてしまう（ADR-0026①）。
    expect(isExportFinished('unsupported')).toBe(false);
    expect(pastExportNotice('unsupported')).toBe('');
  });

  it('前回の結果には、いつのことかと次の行動を書く（§2-5）', () => {
    for (const phase of ['done', 'error', 'cancelled'] as const) {
      expect(pastExportNotice(phase).startsWith('前回の書き出しは')).toBe(true);
    }
    // 保存済み＝そのあとの編集は入っていないので、保存し直せることまで言う（完了表示だけだと最新に見える）。
    expect(pastExportNotice('done')).toContain('もう一度「動画を保存」');
    expect(pastExportNotice('cancelled')).toContain('もう一度「動画を保存」');
  });

  it('走行中・未実行には出さない（呼び出し側で phase を場合分けしない）', () => {
    expect(pastExportNotice('idle')).toBe('');
    expect(pastExportNotice('rendering')).toBe('');
    expect(pastExportNotice('encoding')).toBe('');
  });

  it('終わった結果には必ず1行あり、そうでなければ空（2関数が食い違わない）', () => {
    for (const phase of EXPORT_RUN_PHASES) {
      expect(pastExportNotice(phase) !== '').toBe(isExportFinished(phase));
    }
  });
});
