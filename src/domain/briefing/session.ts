// あなた向け会社説明の一時の動画（β・ADR-0061 決定5・`11 §7.9`）。純粋関数。
import { BRIEFING_SESSION_ID_FLOOR } from '../constants';
import { createProjectId } from '../project/persistence';

/** 番号の最後の3桁の上限（正典の `projectId` は `proj_YYYYMMDD_NNN`＝ちょうど3桁）。 */
const ID_NUMBER_MAX = 999;

/**
 * 一時の動画の番号＝`proj_YYYYMMDD_NNN`（`11.2` と同じ形）。**その日の `BRIEFING_SESSION_ID_FLOOR` より上で、空いている一番小さい番号**。
 * 空きが無ければ null（その日の一時の動画が多すぎる＝呼ぶ側が知らせる）。
 *
 * ⚠️ **通常の動画の番号と重ならないように、数の帯を分ける**＝通常の動画を作る所（12 か所）は通常の一覧の番号しか見ないので、
 *   同じ帯から採ると、後から作った通常の動画が一時の動画と同じ番号になりうる（Rust は通常の動画を先に見るので
 *   通常の動画は守られるが、一時の動画が見えなくなる）。1 日に通常の動画を 900 本作ることは無い。
 * ⚠️ **最大＋1 ではなく空きを採る**＝3桁しか無いので、消した番号を使い直さないとすぐ尽きる（一時の動画は 24 時間で消える）。
 * @param existingIds 通常の動画と一時の動画の番号（両方の置き場所を見る＝ADR-0061 決定5）。
 */
export function createBriefingSessionId(now: Date, existingIds: readonly string[]): string | null {
  const prefix = createProjectId(now, []).slice(0, -'001'.length);
  const taken = new Set(existingIds);
  for (let n = BRIEFING_SESSION_ID_FLOOR + 1; n <= ID_NUMBER_MAX; n++) {
    const id = `${prefix}${n}`;
    if (!taken.has(id)) return id;
  }
  return null;
}
