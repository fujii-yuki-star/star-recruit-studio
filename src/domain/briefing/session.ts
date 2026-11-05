// あなた向け会社説明の一時の動画（β・ADR-0061 決定5・`11 §7.9`）。純粋関数。
import { BRIEFING_SESSION_ID_FLOOR } from '../constants';
import { createProjectId } from '../project/persistence';

/**
 * 一時の動画の番号＝`proj_YYYYMMDD_NNNN`（`11.2` と同じ形）。**その日の `BRIEFING_SESSION_ID_FLOOR` より上**から採る。
 *
 * ⚠️ **通常の動画の番号と重ならないように、数の帯を分ける**＝通常の動画を作る所（12 か所）は通常の一覧の番号しか見ないので、
 *   同じ帯から採ると、後から作った通常の動画が一時の動画と同じ番号になりうる（Rust は通常の動画を先に見るので
 *   通常の動画は守られるが、一時の動画が見えなくなる）。1 日に通常の動画を 9000 本作ることは無い。
 * @param existingIds 通常の動画と一時の動画の番号（両方の置き場所を見る＝ADR-0061 決定5）。
 */
export function createBriefingSessionId(now: Date, existingIds: readonly string[]): string {
  const ymd = createProjectId(now, []).slice(0, -'_001'.length);
  const floor = `${ymd}_${BRIEFING_SESSION_ID_FLOOR}`;
  return createProjectId(now, [floor, ...existingIds]);
}
