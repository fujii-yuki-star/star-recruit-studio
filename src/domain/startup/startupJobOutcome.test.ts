import { describe, expect, it } from 'vitest';
import { EXPORT_RUN_PHASE } from '../export/exportProgress';
import { startupExportSucceeded } from './startupJobOutcome';

describe('頼まれた書き出しが「できた」と言えるか（#1184）', () => {
  it('出来上がっていれば、できた', () => {
    expect(startupExportSucceeded(EXPORT_RUN_PHASE.done, false)).toBe(true);
  });

  // ⚠️ **中止も「できなかった」**＝人が止めた回を「できた」で返さない（場面形式と同じ判断）。
  it('中止は、できなかった', () => {
    expect(startupExportSucceeded(EXPORT_RUN_PHASE.cancelled, false)).toBe(false);
  });

  it('失敗は、できなかった', () => {
    expect(startupExportSucceeded(EXPORT_RUN_PHASE.error, false)).toBe(false);
  });

  it('この端末では書き出せないときも、できなかった', () => {
    expect(startupExportSucceeded(EXPORT_RUN_PHASE.unsupported, false)).toBe(false);
  });

  // ⚠️ **走らずに弾かれた回**（PR #1202 レビュー）＝保存先が残っているのが見分け。
  it('⚠️ 一度も走っていなければ、出来上がった姿に見えても、できなかった', () => {
    expect(startupExportSucceeded(EXPORT_RUN_PHASE.done, true)).toBe(false);
  });

  it('走っていなければ、途中の姿でもできなかった', () => {
    expect(startupExportSucceeded(EXPORT_RUN_PHASE.rendering, true)).toBe(false);
  });
});
