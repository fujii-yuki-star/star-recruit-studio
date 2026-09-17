import { describe, expect, it } from 'vitest';
import { ENGINE_POLL_MS, ENGINE_WAIT_LIMIT_SEC, engineWaitPlan } from './engineWait';

describe('同梱エンジンの用意を待つ（#1204）', () => {
  it('最初は少し待ってもう一度見る', () => {
    expect(engineWaitPlan(0)).toEqual({ waitMs: ENGINE_POLL_MS, giveUp: false });
  });

  // ⚠️ **あきらめる形を持つ**＝持たないと、エンジンが永久に来ないとき**頼んだ側が永久に待つ**。
  it('上限まで来たらあきらめる', () => {
    const last = Math.ceil((ENGINE_WAIT_LIMIT_SEC * 1000) / ENGINE_POLL_MS) - 1;
    expect(engineWaitPlan(last).giveUp).toBe(true);
    expect(engineWaitPlan(last - 1).giveUp).toBe(false);
  });

  // ⚠️ **同梱エンジンの起動より十分に長く**（実測で 10〜30 秒）。
  it('上限は、エンジンの起動より十分に長い', () => {
    expect(ENGINE_WAIT_LIMIT_SEC).toBeGreaterThanOrEqual(60);
  });

  // ⚠️ **短くしすぎない**＝立ち上がり中のエンジンを叩き続けない。
  it('確認の間隔が短すぎない', () => {
    expect(ENGINE_POLL_MS).toBeGreaterThanOrEqual(500);
  });
});
