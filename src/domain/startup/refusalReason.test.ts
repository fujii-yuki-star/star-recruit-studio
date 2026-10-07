// 断りの理由として返す文（#1212・#1217 レビュー 🟡）。
//
// ⚠️ **いちばん避けたい形**＝「直前の成功の文が、失敗の理由として出る」。
// 頼んだ側（外の AI）は「保存しました」を**断りの理由**として受け取り、何が起きたか分からなくなる。
import { describe, expect, it } from 'vitest';
import { refusalReason } from './refusalReason';

const FALLBACK = '動画を書き出せませんでした。もう一度お試しください。';

describe('断りの理由として返す文', () => {
  it('その回に出た文があれば、それを返す', () => {
    expect(refusalReason('声がまだ作られていません。', null, FALLBACK)).toBe('声がまだ作られていません。');
  });

  // ⚠️ **ここが本体**＝始まった時点と同じ文＝**この回の文ではない**（前の回の残り）。
  it('始まった時点と同じ文なら、既定文へ倒す（前の回の残りを理由にしない）', () => {
    expect(
      refusalReason('保存しました', '保存しました', FALLBACK),
      '直前の成功の文が、失敗の理由として出ている',
    ).toBe(FALLBACK);
  });

  it('文が出ていなければ、既定文へ倒す', () => {
    expect(refusalReason(null, null, FALLBACK)).toBe(FALLBACK);
    expect(refusalReason('', null, FALLBACK)).toBe(FALLBACK);
    expect(refusalReason(undefined, undefined, FALLBACK)).toBe(FALLBACK);
  });

  // ⚠️ **前の回の文が残っていても、この回が新しい文を出していれば、そちらが正しい**。
  it('前の回の文があっても、この回の文が違えばそちらを返す', () => {
    expect(refusalReason('素材が見つかりません。', '保存しました', FALLBACK)).toBe('素材が見つかりません。');
  });

  // ⚠️ **既定文は「次の行動」を示す文**（§2-5）＝ここへ倒れた回も行き止まりにしない。
  it('既定文をそのまま返す（作り変えない）', () => {
    expect(refusalReason(null, null, FALLBACK)).toContain('お試しください');
  });
});
