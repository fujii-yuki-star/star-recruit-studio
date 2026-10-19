// エンジンへ映すときに送る形（ADR-0037 追補 2026-10-19）。Rust の口は invoke でモックする。
import { afterEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));
vi.mock('../appSettings', () => ({ getVoicevoxUrl: () => '' }));

import { READING_DICT_PRIORITY } from '../../domain/voice/readingDict';
import { overwriteEngineWord, syncReadingDict } from './userDict';

function inApp(engineDict: Record<string, unknown>): void {
  (globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === 'voicevox_user_dict_list') return JSON.stringify(engineDict);
    if (cmd === 'voicevox_user_dict_add') return 'new-uuid';
    return true;
  });
}

const argsOf = (cmd: string): Record<string, unknown>[] =>
  invokeMock.mock.calls.filter(([c]) => c === cmd).map(([, a]) => a as Record<string, unknown>);

describe('syncReadingDict：登録は優先度を付けて送る', () => {
  afterEach(() => {
    invokeMock.mockReset();
    delete (globalThis as { window?: unknown }).window;
  });

  /** ⚠️ 既にエンジンの辞書にある言葉は、既定の優先度（5）では登録が効かない（実測）。 */
  it('足すときに優先度 10 を送る', async () => {
    inApp({});
    await syncReadingDict([{ surface: '角田', yomi: 'カドタ', accentType: 1 }], {});
    expect(argsOf('voicevox_user_dict_add')).toEqual([expect.objectContaining({ surface: '角田', priority: READING_DICT_PRIORITY })]);
  });

  it('前の版で優先度を付けずに入れた自分の語は、送り直すときに優先度 10 を送る', async () => {
    inApp({ u1: { surface: '角田', pronunciation: 'カドタ', accent_type: 1, priority: 5 } });
    await syncReadingDict([{ surface: '角田', yomi: 'カドタ', accentType: 1 }], { 角田: 'u1' });
    expect(argsOf('voicevox_user_dict_update')).toEqual([expect.objectContaining({ wordUuid: 'u1', priority: READING_DICT_PRIORITY })]);
  });

  it('利用者が選んで上書きするときも優先度 10 を送る', async () => {
    inApp({});
    await overwriteEngineWord({ surface: '角田', yomi: 'カドタ', accentType: 1 }, 'u9');
    expect(argsOf('voicevox_user_dict_update')).toEqual([expect.objectContaining({ wordUuid: 'u9', priority: READING_DICT_PRIORITY })]);
  });
});
