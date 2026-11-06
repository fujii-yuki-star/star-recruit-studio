// @vitest-environment jsdom
// あなた向け会社説明の登録の保存/読込（ADR-0061 決定2）＝読めなかった登録を例の登録に潰さない。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { defaultBriefingCatalog } from '../domain/briefing/catalog';
import { loadBriefingCatalog, saveBriefingCatalog } from './briefingFs';

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
});
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.mocked(invoke).mockReset();
});

describe('loadBriefingCatalog', () => {
  it('まだ無ければ、例の項目つきの登録', async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    expect(await loadBriefingCatalog()).toEqual(defaultBriefingCatalog());
  });

  it('保存してある登録を、そのまま返す', async () => {
    const c = { ...defaultBriefingCatalog(), exitCode: '0427' };
    vi.mocked(invoke).mockResolvedValue(JSON.stringify(c));
    expect(await loadBriefingCatalog()).toEqual(c);
  });

  it('読めない・形が違う・壊れているときは null（例の登録に潰さない）', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('io'));
    expect(await loadBriefingCatalog()).toBeNull();
    vi.mocked(invoke).mockResolvedValue(JSON.stringify({ ...defaultBriefingCatalog(), exitCode: 'abcd' }));
    expect(await loadBriefingCatalog()).toBeNull();
    vi.mocked(invoke).mockResolvedValue('{ 壊れた');
    expect(await loadBriefingCatalog()).toBeNull();
  });
});

describe('saveBriefingCatalog', () => {
  it('正典の形を満たす登録だけを書く', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await saveBriefingCatalog(defaultBriefingCatalog());
    expect(vi.mocked(invoke).mock.calls[0][0]).toBe('briefing_catalog_save');
    vi.mocked(invoke).mockClear();
    await expect(saveBriefingCatalog({ ...defaultBriefingCatalog(), exitCode: '1' })).rejects.toThrow();
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });
});
