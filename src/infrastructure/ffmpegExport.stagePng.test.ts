// 1コマの PNG をバイトのまま置き場へ運ぶ口（書き出しの高速化 2026-10-23）。
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

import { invoke } from '@tauri-apps/api/core';
import { stageExportFramePng } from './ffmpegExport';

beforeEach(() => vi.mocked(invoke).mockClear());

describe('stageExportFramePng', () => {
  it('PNG のバイトを本文にそのまま載せ、置き場の名前と番号はヘッダで渡す（文字にしない）', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    await stageExportFramePng('timeline_frames', 12, png);
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('stage_export_frame_png', png, {
      headers: { 'x-stage-dir': 'timeline_frames', 'x-frame-index': '12' },
    });
  });
});
