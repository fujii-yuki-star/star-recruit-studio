// 一時の動画の番号（ADR-0061 決定5・11 §7.9）。
import { describe, expect, it } from 'vitest';
import { createBriefingSessionId } from './session';
import { BRIEFING_SESSION_ID_FLOOR } from '../constants';

const now = new Date(2026, 10, 5, 10, 0, 0);
const id = (n: number, day = '20261105'): string => `proj_${day}_${n}`;

describe('一時の動画の番号', () => {
  it('その日の帯の上から採る（通常の動画の番号とは重ならない）', () => {
    expect(createBriefingSessionId(now, [])).toBe(id(BRIEFING_SESSION_ID_FLOOR + 1));
    expect(createBriefingSessionId(now, ['proj_20261105_001', 'proj_20261105_002'])).toBe(id(BRIEFING_SESSION_ID_FLOOR + 1));
  });

  it('両方の置き場所にある番号を避け、空いている一番小さい番号を採る・別の日の番号は見ない', () => {
    const taken = [id(BRIEFING_SESSION_ID_FLOOR + 1), id(BRIEFING_SESSION_ID_FLOOR + 3), id(BRIEFING_SESSION_ID_FLOOR + 2, '20261104')];
    expect(createBriefingSessionId(now, taken)).toBe(id(BRIEFING_SESSION_ID_FLOOR + 2));
  });

  it('番号は正典の形（proj_YYYYMMDD_NNN＝ちょうど3桁）・帯が埋まれば null', () => {
    expect(createBriefingSessionId(now, [])).toMatch(/^proj_[0-9]{8}_[0-9]{3}$/);
    const all = Array.from({ length: 999 - BRIEFING_SESSION_ID_FLOOR }, (_, i) => id(BRIEFING_SESSION_ID_FLOOR + 1 + i));
    expect(createBriefingSessionId(now, all.slice(0, -1))).toBe(id(999));
    expect(createBriefingSessionId(now, all)).toBeNull();
  });
});
