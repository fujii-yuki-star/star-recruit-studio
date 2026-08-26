// 書き出しの締め（`exportLock`）の断り文（#843・差分再監査）。
// ⚠️ **文言は「押そうとしたとき」だけでなく「成功した直後」にも出る**（終わりの合図は締めの返却より先に
// 立つ）ので、状態の文にしてある＝「もう一度お試しください」を成功の上に並べない。
import { describe, expect, it } from 'vitest';
import {
  EXPORT_CLEANUP_PENDING_MESSAGE,
  OTHER_EXPORT_RUNNING_MESSAGE,
  exportLockBlockedMessage,
  isOwnCleanupPending,
} from './exportLock';

describe('exportLockBlockedMessage（締めが理由で始められないとき・#843）', () => {
  it('締めが空いていれば断らない', () => {
    expect(exportLockBlockedMessage(null, 'scene', false)).toBeNull();
  });

  it('相手が持っていれば「ほかの動画」', () => {
    expect(exportLockBlockedMessage('timeline', 'scene', false)).toBe(OTHER_EXPORT_RUNNING_MESSAGE);
  });

  it('自分が持っていて走行中なら断らない（それは正常な走行）', () => {
    expect(exportLockBlockedMessage('scene', 'scene', true)).toBeNull();
  });

  it('自分が持っていて走行中でなければ「片づけ中」', () => {
    expect(exportLockBlockedMessage('scene', 'scene', false)).toBe(EXPORT_CLEANUP_PENDING_MESSAGE);
  });

  // ⚠️ **成功が失敗に見えないこと**（差分再監査 🟡）＝この文は書き出しが**成功した直後にも必ず出る**
  // （片づけるコマは尺×fps 個あるので数秒）。「動画を書き出しました」の上に警告として並ぶので、
  // **利用者に行動を促す言い方をしない**（何も頼んでいないのに「もう一度お試しください」を読まされる）。
  it('片づけ中の文は「もう一度お試しください」と言わない（成功の直後にも出るため）', () => {
    expect(EXPORT_CLEANUP_PENDING_MESSAGE).not.toContain('お試しください');
    // 状態と、いつまた押せるかは伝える（§2-5＝行き止まりにしない）。
    expect(EXPORT_CLEANUP_PENDING_MESSAGE).toContain('片づけ');
    expect(EXPORT_CLEANUP_PENDING_MESSAGE).toContain('また書き出せます');
  });

  // ⚠️ **相手を待つ側は従来どおり行動を促してよい**＝あちらは成功の直後に出るものではない。
  it('「ほかの動画」の文は次の行動で終わる', () => {
    expect(OTHER_EXPORT_RUNNING_MESSAGE).toContain('もう一度お試しください');
  });

  it('isOwnCleanupPending は「自分が持っていて走っていない」だけ真', () => {
    expect(isOwnCleanupPending('scene', 'scene', false)).toBe(true);
    expect(isOwnCleanupPending('scene', 'scene', true)).toBe(false);
    expect(isOwnCleanupPending('timeline', 'scene', false)).toBe(false);
    expect(isOwnCleanupPending(null, 'scene', false)).toBe(false);
  });
});
