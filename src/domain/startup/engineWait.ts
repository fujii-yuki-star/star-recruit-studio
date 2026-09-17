// 同梱エンジンの用意ができるまでの**待ち方**（#1204）。**純粋関数**（時計も通信も持たない）。
//
// ⚠️ **なぜ要るか**＝同梱エンジンは起動に数十秒かかる。人が押す回は待っている間に画面を見ているが、
// **起動の引数で走る回**（ADR-0042）は**開いた直後に走る**ので、用意ができる前に声を作ろうとして落ちる
//（実機で確認＝`--make-voices` が **5.7 秒で終了コード 1**・声は1つも出来ていなかった）。
//
// ⚠️ **待ち方を関数へ出す**＝`setTimeout` の中に数字を埋めると、**待ち時間を変えたときに検査が無い**。

/** 何回目の確認までなら待ってよいか（`0` 始まり）。 */
export interface EngineWaitPlan {
  /** 次に確認するまで待つミリ秒。 */
  waitMs: number;
  /** これ以上は待たない（＝あきらめる）。 */
  giveUp: boolean;
}

/** 確認の間隔（ミリ秒）。⚠️ **短くしすぎない**＝立ち上がり中のエンジンを叩き続けない。 */
export const ENGINE_POLL_MS = 1000;
/** あきらめるまでの秒数。⚠️ **同梱エンジンの起動より十分に長く**取る（実測で 10〜30 秒）。 */
export const ENGINE_WAIT_LIMIT_SEC = 120;

/**
 * `attempt` 回目（0 始まり）の確認のあと、どうするか。
 *
 * ⚠️ **あきらめる形を持つ**＝持たないと、エンジンが永久に来ないとき**頼んだ側が永久に待つ**
 *（`--quit-when-done` で起こした AI は、終了コードを待ち続ける）。
 */
export function engineWaitPlan(attempt: number): EngineWaitPlan {
  const limit = Math.ceil((ENGINE_WAIT_LIMIT_SEC * 1000) / ENGINE_POLL_MS);
  return { waitMs: ENGINE_POLL_MS, giveUp: attempt + 1 >= limit };
}
