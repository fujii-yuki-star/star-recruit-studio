// 本体が、書き出しのコマを描く隠した窓を開いて使う（ADR-0070）。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openRenderHelpers, RENDER_JOB_IDLE_TIMEOUT_MS, type RenderHelperLink } from './renderHelpers';
import type { MainToRender, RenderSessionPayload, RenderToMain } from './renderSession';

const session = { sessionId: 's1' } as unknown as RenderSessionPayload;
const seg = { framesDirName: 'timeline_frames', stageIndexBase: 0, stagedVideos: [] };

/** 偽の窓たち。`behave` で窓ごとの振る舞いを決める。 */
function fakeLink(behave: (label: string) => { probe?: string; onJob?: 'ok' | 'error' | 'silent' }) {
  let report: (m: RenderToMain) => void = () => {};
  const sent: { label: string; msg: MainToRender }[] = [];
  const opened: string[] = [];
  const closed: string[] = [];
  const link: RenderHelperLink = {
    open: async (label) => {
      opened.push(label);
      setTimeout(() => report({ type: 'ready', label }), 0);
      return true;
    },
    close: async (label) => { closed.push(label); },
    send: async (label, msg) => {
      sent.push({ label, msg });
      const b = behave(label);
      if (msg.type === 'session') setTimeout(() => report({ type: 'session-ready', label, sessionId: 's1', probe: b.probe ?? 'P' }), 0);
      if (msg.type === 'job') {
        const { jobId, fromFrame, toFrame } = msg.job;
        const n = toFrame - fromFrame;
        if (b.onJob === 'silent') return;
        setTimeout(() => {
          report({ type: 'progress', label, sessionId: 's1', jobId, done: Math.floor(n / 2), frames: 2, bytes: 200 });
          report({ type: 'job-done', label, sessionId: 's1', jobId, frames: n, bytes: n * 100, ...(b.onJob === 'error' ? { error: 'boom' } : {}) });
        }, 0);
      }
    },
    onReport: async (h) => { report = h; return () => { report = () => {}; }; },
  };
  return { link, sent, opened, closed };
}

afterEach(() => vi.useRealTimers());

describe('openRenderHelpers', () => {
  it('窓を開いて確かめ、本体と同じ絵の窓だけ使う（違う窓は閉じる）', async () => {
    const f = fakeLink((label) => ({ probe: label.endsWith('-2') ? 'DIFFERENT' : 'P' }));
    const pool = await openRenderHelpers(2, session, 'P', { link: f.link, accountFrames: () => {}, labelStamp: 't' });
    expect(f.opened).toEqual(['render-t-1', 'render-t-2']);
    expect(pool.size()).toBe(1);
    expect(f.closed).toEqual(['render-t-2']);
  });

  it('範囲を頼むと、置き場・番号の数え方・範囲を送り、進み具合と置いた数（差分）を受ける', async () => {
    const f = fakeLink(() => ({ onJob: 'ok' }));
    const accounted: [number, number][] = [];
    const pool = await openRenderHelpers(1, session, 'P', { link: f.link, accountFrames: (fr, b) => { accounted.push([fr, b]); }, labelStamp: 't' });
    const progress: number[] = [];
    await pool.drawersFor({ ...seg, stageIndexBase: 30 })[0]!.draw({ fromFrame: 40, toFrame: 50 }, (d) => progress.push(d));
    const jobMsg = f.sent.find((s) => s.msg.type === 'job')!.msg as Extract<MainToRender, { type: 'job' }>;
    expect(jobMsg.job).toMatchObject({ framesDirName: 'timeline_frames', stageIndexBase: 30, fromFrame: 40, toFrame: 50 });
    expect(progress).toEqual([5]);
    // 途中で2枚・終わりで合計10枚＝差分で 2 と 8。
    expect(accounted).toEqual([[2, 200], [8, 800]]);
  });

  it('窓が失敗したら、その範囲は失敗で返し、窓は閉じてもう使わない', async () => {
    const f = fakeLink(() => ({ onJob: 'error' }));
    const pool = await openRenderHelpers(1, session, 'P', { link: f.link, accountFrames: () => {}, labelStamp: 't' });
    await expect(pool.drawersFor(seg)[0]!.draw({ fromFrame: 0, toFrame: 10 }, () => {})).rejects.toThrow('boom');
    expect(pool.size()).toBe(0);
    expect(f.closed).toEqual(['render-t-1']);
    expect(pool.drawersFor(seg)).toEqual([]);
  });

  it(`窓が ${RENDER_JOB_IDLE_TIMEOUT_MS / 1000} 秒黙ったら落ちたとみなす（待ち続けない）`, async () => {
    const f = fakeLink(() => ({ onJob: 'silent' }));
    const pool = await openRenderHelpers(1, session, 'P', { link: f.link, accountFrames: () => {}, labelStamp: 't' });
    vi.useFakeTimers();
    const p = pool.drawersFor(seg)[0]!.draw({ fromFrame: 0, toFrame: 10 }, () => {});
    const caught = p.catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(RENDER_JOB_IDLE_TIMEOUT_MS + 10);
    expect(await caught).toBeInstanceOf(Error);
    expect(pool.size()).toBe(0);
  });

  it('閉じるときは中止を送ってから全部閉じる', async () => {
    const f = fakeLink(() => ({}));
    const pool = await openRenderHelpers(2, session, 'P', { link: f.link, accountFrames: () => {}, labelStamp: 't' });
    await pool.close();
    expect(f.sent.filter((s) => s.msg.type === 'cancel').map((s) => s.label)).toEqual(['render-t-1', 'render-t-2']);
    expect(f.closed.sort()).toEqual(['render-t-1', 'render-t-2']);
    expect(pool.size()).toBe(0);
  });
});
