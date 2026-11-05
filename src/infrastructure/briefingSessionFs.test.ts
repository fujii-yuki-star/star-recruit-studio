// @vitest-environment jsdom
// 一時の動画の置き場所（ADR-0061 決定5）＝作ると asset:// の道が一時の置き場所へ向き、消すと戻る。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => undefined),
  convertFileSrc: vi.fn((p: string) => `asset://localhost/${p}`),
}));
vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn(async () => 'C:/data'),
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
}));

import { invoke } from '@tauri-apps/api/core';
import { createBriefingSession, deleteBriefingSession } from './briefingSessionFs';
import { assetDisplayUrl } from './assetFs';

const ID = 'proj_20261105_901';

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
});
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.mocked(invoke).mockClear();
});

describe('一時の動画の置き場所', () => {
  it('作ると写真の道が一時の置き場所へ向き、消すと通常へ戻る（ほかの動画は通常のまま）', async () => {
    expect(await assetDisplayUrl(ID, 'assets/asset_001.png')).toBe(`asset://localhost/C:/data/projects/${ID}/assets/asset_001.png`);
    await createBriefingSession(ID);
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('briefing_session_create', { projectId: ID });
    expect(await assetDisplayUrl(ID, 'assets/asset_001.png')).toBe(`asset://localhost/C:/data/temporary-sessions/${ID}/assets/asset_001.png`);
    expect(await assetDisplayUrl('proj_20261105_001', 'assets/a.png')).toBe('asset://localhost/C:/data/projects/proj_20261105_001/assets/a.png');
    await deleteBriefingSession(ID);
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('briefing_session_delete', { projectId: ID });
    expect(await assetDisplayUrl(ID, 'assets/asset_001.png')).toBe(`asset://localhost/C:/data/projects/${ID}/assets/asset_001.png`);
  });

  it('作るのを断られたら、一時の動画として覚えない', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('taken'));
    await expect(createBriefingSession('proj_20261105_902')).rejects.toThrow();
    expect(await assetDisplayUrl('proj_20261105_902', 'a.png')).toContain('/projects/');
  });
});
