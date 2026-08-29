// 持ち込みフォント／よく使う素材の**番号の採り方**（α-6 出口監査 🟡8・ADR-0038 / ADR-0035）。
//
// ⚠️ **一覧から採ると消した番号を使い回す**＝一覧（`listUserFonts`）は**実体があるものだけ**を返すので、
// 最大番号のフォントを外すと次の取り込みで同じ番号が再発行され、その番号を指している動画が
// **黙って別の字体**になる（id は解決するので `USER_FONT_MISSING` も発火しない＝§2-5）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../infrastructure/userFontFs', () => ({
  listUserFonts: vi.fn(),
  usedUserFontIds: vi.fn(),
  importUserFont: vi.fn(async () => {}),
  deleteUserFont: vi.fn(async () => {}),
  loadUserFonts: vi.fn(async () => []),
}));

import { useProjectStore } from './projectStore';
import { importUserFont, listUserFonts, usedUserFontIds } from '../../infrastructure/userFontFs';

beforeEach(() => {
  // 一覧＝いま実体があるのは 001 だけ／これまでに使ったのは 002 まで（002 を外した後）。
  vi.mocked(listUserFonts).mockResolvedValue([
    { id: 'user_font_001', fileName: 'user_font_001.ttf', displayName: '手持ちの字' },
  ]);
  vi.mocked(usedUserFontIds).mockResolvedValue(['user_font_001', 'user_font_002']);
});
afterEach(() => vi.clearAllMocks());

describe('持ち込みフォントの採番（🟡8）', () => {
  it('外した番号を使い回さない（一覧ではなく「これまでに使った番号」から採る）', async () => {
    const id = await useProjectStore.getState().addUserFont('C:/tmp/new.ttf', '新しい字');
    expect(id).toBe('user_font_003');
    expect(vi.mocked(importUserFont).mock.calls[0]?.[0]).toBe('user_font_003');
  });
});
