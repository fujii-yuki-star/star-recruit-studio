// @vitest-environment jsdom
// 動画案を作る AI の選び方（ADR-0051 決定1・5・15）＝アプリの中の既定はこのパソコンの中・Gemini は選んだときだけ・
// Mock はブラウザでの開発のときだけ。⚠️ 黙って別の道へ落とさない（外部へ送らない・見本の構成案を出さない）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectStore } from './projectStore';
import * as aiClient from '../../infrastructure/aiClient';
import { MockAiProvider } from '../../infrastructure/aiProviders/mockAiProvider';
import { GeminiProvider } from '../../infrastructure/aiProviders/geminiProvider';
import { LocalVideoPlanProvider } from '../../infrastructure/aiProviders/localVideoPlanProvider';
import { AI_GEMINI_KEY_MISSING_MESSAGE } from '../uiLabels';

const FAIL = '（検査用）ここで止める。もう一度お試しください。';
const spies = () => ({
  mock: vi.spyOn(MockAiProvider.prototype, 'generateVideoPlan').mockRejectedValue(new Error(FAIL)),
  gemini: vi.spyOn(GeminiProvider.prototype, 'generateVideoPlan').mockRejectedValue(new Error(FAIL)),
  local: vi.spyOn(LocalVideoPlanProvider.prototype, 'generateVideoPlan').mockRejectedValue(new Error(FAIL)),
});
const inTauri = (on: boolean) => {
  if (on) (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  else delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
};
const run = async () => {
  useProjectStore.setState({ scenes: [], status: 'idle' });
  await useProjectStore.getState().generate();
};

beforeEach(() => {
  try { window.localStorage.clear(); } catch { /* 保存できない環境 */ }
});
afterEach(() => {
  inTauri(false);
  vi.restoreAllMocks();
});

describe('動画案を作る AI の選び方（ADR-0051）', () => {
  it('アプリの中の既定は、このパソコンの中で作る（外へ送らない・見本にしない）', async () => {
    inTauri(true);
    const s = spies();
    await run();
    expect(s.local).toHaveBeenCalledTimes(1);
    expect(s.gemini).not.toHaveBeenCalled();
    expect(s.mock).not.toHaveBeenCalled();
  });

  it('このパソコンの中で失敗しても、見本の構成案や外部の AI へ落とさない', async () => {
    inTauri(true);
    const s = spies();
    await run();
    expect(useProjectStore.getState().status).toBe('error');
    expect(useProjectStore.getState().aiError).toBe(FAIL);
    expect(s.gemini).not.toHaveBeenCalled();
    expect(s.mock).not.toHaveBeenCalled();
  });

  it('Gemini を選んで鍵があれば Gemini', async () => {
    inTauri(true);
    window.localStorage.setItem('app.aiEngine', 'gemini');
    vi.spyOn(aiClient, 'willSendExternally').mockResolvedValue(true);
    const s = spies();
    await run();
    expect(s.gemini).toHaveBeenCalledTimes(1);
    expect(s.local).not.toHaveBeenCalled();
  });

  it('Gemini を選んで鍵が無ければ、次の行動で断る（黙ってこのパソコンの中や見本へ落とさない）', async () => {
    inTauri(true);
    window.localStorage.setItem('app.aiEngine', 'gemini');
    vi.spyOn(aiClient, 'willSendExternally').mockResolvedValue(false);
    const s = spies();
    await run();
    expect(useProjectStore.getState().aiError).toBe(AI_GEMINI_KEY_MISSING_MESSAGE);
    expect(s.gemini).not.toHaveBeenCalled();
    expect(s.local).not.toHaveBeenCalled();
    expect(s.mock).not.toHaveBeenCalled();
  });

  it('ブラウザでの開発（アプリの外）だけ見本', async () => {
    inTauri(false);
    const s = spies();
    await run();
    expect(s.mock).toHaveBeenCalledTimes(1);
    expect(s.local).not.toHaveBeenCalled();
  });
});

describe('外へ送るかの判定（willSendExternally・ADR-0051 決定15）', () => {
  it('アプリの中でも、既定（このパソコンの中）なら外へ送らない＝鍵があっても', async () => {
    // ⚠️ 鍵を問い合わせに行かない＝アプリの中の偽物（`__TAURI_INTERNALS__`）は問い合わせると投げる＝行けば赤くなる。
    inTauri(true);
    expect(await aiClient.willSendExternally()).toBe(false);
  });

  it('アプリの外では送らない', async () => {
    inTauri(false);
    window.localStorage.setItem('app.aiEngine', 'gemini');
    expect(await aiClient.willSendExternally()).toBe(false);
  });
});
