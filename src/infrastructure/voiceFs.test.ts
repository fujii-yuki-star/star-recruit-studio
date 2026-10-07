// @vitest-environment jsdom
// 声まわりの外との橋渡し（#1204）。
//
// ⚠️ **用意ができたかを見る先は、合成が使う先と同じでなければならない**（PR #1208 レビュー 🟡）＝
// ずれると、**設定した接続先はまだなのに「できた」と言って**合成へ進む／
// 逆に**とうに立っている接続先を待ち続けて**的外れな断りを返す。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock('./appSettings', () => ({ getVoicevoxUrl: () => mockUrl }));

let mockUrl = '';
const { voicevoxReady } = await import('./voiceFs');

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(true);
  mockUrl = '';
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
});

describe('声を作る用意ができているか', () => {
  it('設定の接続先があれば、そこを見る', async () => {
    mockUrl = 'http://192.168.0.9:50021';
    await voicevoxReady();
    expect(invoke).toHaveBeenCalledWith('voicevox_ready', { baseUrl: 'http://192.168.0.9:50021' });
  });

  // ⚠️ **設定が無ければ渡さない**＝Rust 側が「同梱→環境変数→既定」の順で解く。
  it('設定が無ければ、渡さない（Rust が解く）', async () => {
    await voicevoxReady();
    expect(invoke).toHaveBeenCalledWith('voicevox_ready', { baseUrl: null });
  });

  it('聞けなければ「できていない」と返す（投げない）', async () => {
    invoke.mockRejectedValue(new Error('だめ'));
    expect(await voicevoxReady()).toBe(false);
  });
});
