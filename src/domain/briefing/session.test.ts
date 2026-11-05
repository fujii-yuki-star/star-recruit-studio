// 一時の動画の番号（ADR-0061 決定5・11 §7.9）。
import { describe, expect, it } from 'vitest';
import { createBriefingSessionId } from './session';
import { BRIEFING_SESSION_ID_FLOOR } from '../constants';

const now = new Date(2026, 10, 5, 10, 0, 0);

describe('一時の動画の番号', () => {
  it('その日の帯の上から採る（通常の動画の番号とは重ならない）', () => {
    expect(createBriefingSessionId(now, [])).toBe(`proj_20261105_${BRIEFING_SESSION_ID_FLOOR + 1}`);
    expect(createBriefingSessionId(now, ['proj_20261105_001', 'proj_20261105_002'])).toBe(`proj_20261105_${BRIEFING_SESSION_ID_FLOOR + 1}`);
  });

  it('両方の置き場所にある番号を避ける・別の日の番号は見ない', () => {
    const taken = [`proj_20261105_${BRIEFING_SESSION_ID_FLOOR + 1}`, `proj_20261105_${BRIEFING_SESSION_ID_FLOOR + 3}`, `proj_20261104_${BRIEFING_SESSION_ID_FLOOR + 50}`];
    expect(createBriefingSessionId(now, taken)).toBe(`proj_20261105_${BRIEFING_SESSION_ID_FLOOR + 4}`);
  });

  it('番号は正典の形（proj_YYYYMMDD_NNN 以上）', () => {
    expect(createBriefingSessionId(now, [])).toMatch(/^proj_[0-9]{8}_[0-9]{3,}$/);
  });
});
