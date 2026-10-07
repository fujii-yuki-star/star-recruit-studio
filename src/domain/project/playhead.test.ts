import { describe, expect, it } from 'vitest';
import type { Timeline } from './compileTimeline';
import { clampPlayheadSec, playheadFrameAt } from './playhead';

// ADR-0023 段階(1)：タイムライン（グローバル秒）と場面の中身（場面ローカル秒）の橋渡し。
// 射影を読むだけで正準（場面）には触れない（ADR-0018 の2モデル方式）。
const tl = (scenes: { sceneId: string; startSec: number; endSec: number }[], totalSec: number): Timeline => ({
  totalSec,
  scenes: scenes.map((s, i) => ({ ...s, order: i })),
  tracks: { video: [], telop: [], audio: [], bgm: [] },
  transitions: [],
});

/** 遷移なし：0-8 と 8-16 が隣接。 */
const plain = tl([{ sceneId: 's1', startSec: 0, endSec: 8 }, { sceneId: 's2', startSec: 8, endSec: 16 }], 16);
/** 遷移あり（2秒の重なり）：s1 は 0-8、s2 は 6 から始まる＝6〜8 が重なり区間。 */
const overlapped = tl([{ sceneId: 's1', startSec: 0, endSec: 8 }, { sceneId: 's2', startSec: 6, endSec: 14 }], 14);

describe('clampPlayheadSec（ADR-0023 (1)）', () => {
  it('動画の範囲へ収める（負・尺超え・壊れた値）', () => {
    expect(clampPlayheadSec(plain, -3)).toBe(0);
    expect(clampPlayheadSec(plain, 5)).toBe(5);
    expect(clampPlayheadSec(plain, 99)).toBe(16);
    expect(clampPlayheadSec(plain, Number.NaN)).toBe(0);
  });

  it('空の動画は 0（負の尺を作らない）', () => {
    expect(clampPlayheadSec(tl([], 0), 5)).toBe(0);
  });
});

describe('playheadFrameAt（ADR-0023 (1)）', () => {
  it('その時刻の場面と、場面の中での秒を返す', () => {
    expect(playheadFrameAt(plain, 0)).toEqual({ sceneId: 's1', localSec: 0 });
    expect(playheadFrameAt(plain, 3.5)).toEqual({ sceneId: 's1', localSec: 3.5 });
    expect(playheadFrameAt(plain, 10)).toEqual({ sceneId: 's2', localSec: 2 });
  });

  it('場面の境目は次の場面（同時に該当したら開始が遅いほう）', () => {
    // 8 は s1 の終端でもあり s2 の開始でもある。ヘッドを右へ動かして場面が戻らないよう、次を採る。
    expect(playheadFrameAt(plain, 8)).toEqual({ sceneId: 's2', localSec: 0 });
  });

  it('末尾（尺ちょうど）でも最後の場面を出す（終端で絵が消えない）', () => {
    expect(playheadFrameAt(plain, 16)).toEqual({ sceneId: 's2', localSec: 8 });
  });

  it('範囲外は端へ寄せてから解決する', () => {
    expect(playheadFrameAt(plain, -5)).toEqual({ sceneId: 's1', localSec: 0 });
    expect(playheadFrameAt(plain, 99)).toEqual({ sceneId: 's2', localSec: 8 });
  });

  // 切り替え中は2場面が重なる。静止1枚ではどちらか一方しか出せないので「あとから始まったほう」に決める
  // ＝タイムラインで手前に見えるクリップと一致し、ヘッドを右へ動かすと場面が戻らない（単調）。
  it('切り替えの重なりでは、あとから始まった場面を出す', () => {
    expect(playheadFrameAt(overlapped, 5.9)).toEqual({ sceneId: 's1', localSec: 5.9 });
    expect(playheadFrameAt(overlapped, 6)).toEqual({ sceneId: 's2', localSec: 0 });
    expect(playheadFrameAt(overlapped, 7)).toEqual({ sceneId: 's2', localSec: 1 });
  });

  it('ヘッドを右へ動かしても場面が戻らない（単調・重なりがあっても）', () => {
    let prevOrder = -1;
    for (let t = 0; t <= overlapped.totalSec; t += 0.1) {
      const { sceneId } = playheadFrameAt(overlapped, t);
      const order = overlapped.scenes.findIndex((s) => s.sceneId === sceneId);
      expect(order, `t=${t.toFixed(1)}`).toBeGreaterThanOrEqual(prevOrder);
      prevOrder = order;
    }
  });

  it('場面が無ければ何も指さない（空の動画・場面の外）', () => {
    expect(playheadFrameAt(tl([], 0), 0)).toEqual({ sceneId: null, localSec: 0 });
    // 場面のあいだに隙間がある壊れた射影でも、無い場面を指さない。
    const gapped = tl([{ sceneId: 's1', startSec: 0, endSec: 2 }, { sceneId: 's2', startSec: 5, endSec: 8 }], 8);
    expect(playheadFrameAt(gapped, 3)).toEqual({ sceneId: null, localSec: 0 });
  });

  it('場面ローカル秒はその場面の尺を超えない', () => {
    for (let t = 0; t <= overlapped.totalSec; t += 0.25) {
      const { sceneId, localSec } = playheadFrameAt(overlapped, t);
      if (!sceneId) continue;
      const span = overlapped.scenes.find((s) => s.sceneId === sceneId)!;
      expect(localSec).toBeGreaterThanOrEqual(0);
      expect(localSec).toBeLessThanOrEqual(span.endSec - span.startSec);
    }
  });
});
