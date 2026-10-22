// @vitest-environment jsdom
// 取り込んだ音を鳴らす URL（負荷・耐久の点検 2026-10-22）＝中身を読まない・無ければ null・毎回別の URL。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((p: string) => `asset://localhost/${p}`),
}));
vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn(async () => 'C:/data'),
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
}));

import { invoke } from '@tauri-apps/api/core';
import { audioPlayUrl } from './assetFs';

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
});
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.mocked(invoke).mockReset();
});

describe('audioPlayUrl', () => {
  it('在るファイルは asset:// の URL で返し、中身は読まない', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => (cmd === 'missing_asset_files' ? [] : 'data:never'));
    const url = await audioPlayUrl('proj_1', 'assets/asset_001.wav');
    expect(url).toMatch(/^asset:\/\/localhost\/C:\/data\/projects\/proj_1\/assets\/asset_001\.wav\?t=\d+$/);
    expect(vi.mocked(invoke).mock.calls.map((c) => c[0]), '中身を読みにいった').toEqual(['missing_asset_files']);
  });

  it('見つからないファイルは null（読めない音として扱える）', async () => {
    vi.mocked(invoke).mockImplementation(async () => ['assets/asset_001.wav']);
    expect(await audioPlayUrl('proj_1', 'assets/asset_001.wav')).toBeNull();
  });

  it('アプリの外・保存先が無いときは null', async () => {
    expect(await audioPlayUrl('proj_1', '')).toBeNull();
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    expect(await audioPlayUrl('proj_1', 'assets/asset_001.wav')).toBeNull();
  });
});
