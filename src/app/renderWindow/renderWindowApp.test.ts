// 書き出しのコマを描く隠した窓の中身（ADR-0070）＝本体からの知らせの受け方。
import { describe, expect, it, vi } from 'vitest';
import { createRenderWindowHandler, RENDER_PROGRESS_EVERY, type RenderWindowDeps } from './renderWindowApp';
import type { RenderSessionPayload, RenderToMain } from './renderSession';
import { ExportCancelledError } from '../../renderer/export/buildExportScenes';

const session = { sessionId: 's1', doc: { projectId: 'p' } } as unknown as RenderSessionPayload;
const job = (jobId: number, fromFrame = 0, toFrame = 10) =>
  ({ type: 'job' as const, sessionId: 's1', job: { jobId, framesDirName: 'timeline_frames', fromFrame, toFrame, stageIndexBase: 0, stagedVideos: [] } });

function setup(over: Partial<RenderWindowDeps> = {}) {
  const sent: RenderToMain[] = [];
  const draw = vi.fn<RenderWindowDeps['draw']>(async (_doc, opts) => {
    const n = opts.window!.toFrame - opts.window!.fromFrame;
    await opts.stageFramePng!(opts.framesDirName!, 0, new Uint8Array(100));
    await opts.copyFrames!(opts.framesDirName!, 0, 1, n - 1, 100);
    for (let d = 1; d <= n; d += 1) opts.onProgress?.(d, n);
  });
  const deps: RenderWindowDeps = {
    label: 'render-1',
    send: (m) => { sent.push(m); },
    prepare: async (s) => ({ session: s, drawOptions: { templateOf: () => undefined, assetSrc: () => undefined, fallbackCredit: '', stageFramePng: async () => {}, copyFrames: async () => {} } }),
    probe: async () => 'probe-hash',
    draw,
    ...over,
  };
  return { sent, draw, h: createRenderWindowHandler(deps) };
}

describe('createRenderWindowHandler', () => {
  it('材料を受けたら確かめの印を返し、範囲を描いて置いた数と大きさを知らせる', async () => {
    const { sent, h } = setup();
    await h.handle({ type: 'session', session });
    expect(sent[0]).toEqual({ type: 'session-ready', label: 'render-1', sessionId: 's1', probe: 'probe-hash' });
    await h.handle(job(7, 0, 10));
    const done = sent.find((m) => m.type === 'job-done');
    // 描いた1枚（100）＋写した9枚（9×100）。
    expect(done).toEqual({ type: 'job-done', label: 'render-1', sessionId: 's1', jobId: 7, frames: 10, bytes: 1000 });
  });

  it('範囲の置き場・番号の数え方・焼き出し済みの動画を、そのまま描く関数へ渡す', async () => {
    const { draw, h } = setup();
    await h.handle({ type: 'session', session });
    await h.handle({ type: 'job', sessionId: 's1', job: { jobId: 1, framesDirName: 'timeline_frames_2', fromFrame: 240, toFrame: 480, stageIndexBase: 100, stagedVideos: [{ clipId: 'c', layerId: null, dirName: 'v', count: 3, offset: 0 }] } });
    const opts = draw.mock.calls[0]![1];
    expect(opts.framesDirName).toBe('timeline_frames_2');
    expect(opts.window).toEqual({ fromFrame: 240, toFrame: 480 });
    expect(opts.stageIndexBase).toBe(100);
    expect(opts.stagedVideos).toEqual([{ clipId: 'c', layerId: null, dirName: 'v', count: 3, offset: 0 }]);
  });

  it(`進み具合は ${RENDER_PROGRESS_EVERY} コマおきに送る（毎コマは送らない）`, async () => {
    const { sent, h } = setup();
    await h.handle({ type: 'session', session });
    await h.handle(job(1, 0, RENDER_PROGRESS_EVERY * 3));
    expect(sent.filter((m) => m.type === 'progress').map((m) => (m as { done: number }).done))
      .toEqual([RENDER_PROGRESS_EVERY, RENDER_PROGRESS_EVERY * 2, RENDER_PROGRESS_EVERY * 3]);
  });

  it('材料をそろえられなければ、失敗を知らせる（範囲は描かない）', async () => {
    const { sent, draw, h } = setup({ prepare: async () => { throw new Error('font'); } });
    await h.handle({ type: 'session', session });
    expect(sent[0]).toMatchObject({ type: 'session-failed', error: 'font' });
    await h.handle(job(1));
    expect(draw).not.toHaveBeenCalled();
    expect(sent[1]).toMatchObject({ type: 'job-done', jobId: 1, error: 'no session' });
  });

  it('描くのに失敗したら、失敗として知らせる（黙って成功にしない）', async () => {
    const { sent, h } = setup({ draw: async () => { throw new Error('asset not resolvable'); } });
    await h.handle({ type: 'session', session });
    await h.handle(job(1));
    expect(sent.find((m) => m.type === 'job-done')).toMatchObject({ jobId: 1, error: 'asset not resolvable' });
  });

  it('中止された回の範囲は描かない', async () => {
    const { sent, draw, h } = setup();
    await h.handle({ type: 'session', session });
    await h.handle({ type: 'cancel', sessionId: 's1' });
    await h.handle(job(1));
    expect(draw).not.toHaveBeenCalled();
    expect(sent.find((m) => m.type === 'job-done')).toMatchObject({ jobId: 1, error: expect.any(String) });
  });

  it('描いている途中に中止されたら止める', async () => {
    let seenCancel = false;
    const { sent, h } = setup({
      draw: async (_d, opts) => {
        await new Promise((r) => setTimeout(r, 5));
        seenCancel = opts.shouldCancel!();
        if (seenCancel) throw new ExportCancelledError();
      },
    });
    await h.handle({ type: 'session', session });
    const running = h.handle(job(1));
    await new Promise((r) => setTimeout(r, 1)); // 描き始めてから止める
    await h.handle({ type: 'cancel', sessionId: 's1' });
    await running;
    expect(seenCancel).toBe(true);
    expect(sent.find((m) => m.type === 'job-done')).toMatchObject({ jobId: 1, error: expect.any(String) });
  });

  it('範囲は届いた順に1つずつ描く（同じ窓で2つ同時に描かない）', async () => {
    let now = 0;
    let peak = 0;
    const { h } = setup({
      draw: async () => { now += 1; peak = Math.max(peak, now); await new Promise((r) => setTimeout(r, 5)); now -= 1; },
    });
    await h.handle({ type: 'session', session });
    await Promise.all([h.handle(job(1)), h.handle(job(2)), h.handle(job(3))]);
    expect(peak).toBe(1);
  });
});
