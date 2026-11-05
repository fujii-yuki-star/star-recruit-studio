// 本体が、書き出しのコマを描く**隠した窓**を開いて使う（ADR-0070）。
//
// ⚠️ **窓は助っ人**＝落ちた・黙った・違う絵になった窓は外し、その範囲は本体（ほかの描き手）が描き直す。
//   書き出しそのものは止めない（窓が1つも使えなくても、いままでどおり1窓で描ける）。
// ⚠️ **確かめてから使う**＝窓で確かめの1コマを描かせ、本体の絵と印が違えば使わない（ADR-0070 決定6）。
import type { FrameDrawer, FrameRange } from '../../renderer/export/parallelFrames';
import { reasonForLog } from '../../infrastructure/renderWindowLink';
import type { StagedVideoRef } from '../../renderer/export/buildTimelineFrames';
import type { MainToRender, RenderSessionPayload, RenderToMain } from './renderSession';

/** 窓とのつなぎ（本物は `infrastructure/renderWindowLink`・検査では偽物）。 */
export interface RenderHelperLink {
  open(label: string): Promise<boolean>;
  close(label: string): Promise<void>;
  send(label: string, msg: MainToRender): Promise<void>;
  onReport(handler: (msg: RenderToMain) => void): Promise<() => void>;
}

/** 窓が立ち上がって「用意できた」と言うまでの待ち。 */
export const RENDER_READY_TIMEOUT_MS = 20_000;
/** 材料をそろえて確かめの1コマを描くまでの待ち（字体・素材の読み込み込み）。 */
export const RENDER_SESSION_TIMEOUT_MS = 60_000;
/**
 * 範囲を描いている間、何も言ってこない時間の上限（越えたら落ちたとみなす）。窓は `RENDER_PROGRESS_EVERY`（24コマ）ごとに
 * 知らせる＝重い区間でも 24コマで十秒に届かない。⚠️ 長いと、窓が落ちたときに進み具合がその間止まって見える
 * （実機で描く窓を落として確かめた＝60秒だと 33→80秒・その間バーが止まる）。
 */
export const RENDER_JOB_IDLE_TIMEOUT_MS = 30_000;

/** 1つの区間を窓に描かせるための情報（同じ置き場・同じ番号の数え方・焼き出し済みの動画）。 */
export interface RenderSegment {
  framesDirName: string;
  stageIndexBase: number;
  stagedVideos: StagedVideoRef[];
}

/** 開いた窓の束。 */
export interface RenderHelperPool {
  /** いま使える窓の数。 */
  size(): number;
  /** その区間を描く窓の描き手（使える窓のぶん）。 */
  drawersFor(seg: RenderSegment): FrameDrawer[];
  /** 窓を全部閉じる（書き出しの終わりに必ず呼ぶ）。 */
  close(): Promise<void>;
}

interface Helper {
  label: string;
  alive: boolean;
  /** 窓からの知らせを受ける手（いま待っているもの）。 */
  listener: ((msg: RenderToMain) => void) | null;
}

function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      onTimeout();
      reject(new Error('render window timeout'));
    }, ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/**
 * 窓を `count` 個開いて確かめ、使える窓の束を返す（1つも使えなければ大きさ 0 の束）。
 * `accountFrames` には、窓が置いたコマの数と大きさを渡す（本体の空きの見張りで数える）。
 */
export async function openRenderHelpers(
  count: number,
  session: RenderSessionPayload,
  mainProbe: string,
  deps: { link: RenderHelperLink; accountFrames(frames: number, bytes: number): Promise<void> | void; labelStamp?: string },
): Promise<RenderHelperPool> {
  const stamp = deps.labelStamp ?? `${Date.now()}`;
  const helpers: Helper[] = [];
  const byLabel = new Map<string, Helper>();
  const unlisten = await deps.link.onReport((msg) => byLabel.get(msg.label)?.listener?.(msg));

  const retire = async (h: Helper): Promise<void> => {
    if (!h.alive) return;
    h.alive = false;
    h.listener = null;
    await deps.link.close(h.label);
  };

  /** 窓を1つ開いて、用意・確かめまで済ませる。使えなければ閉じて `false`。 */
  const start = async (h: Helper): Promise<boolean> => {
    try {
      const ready = new Promise<void>((resolve) => {
        h.listener = (m) => { if (m.type === 'ready') resolve(); };
      });
      if (!(await deps.link.open(h.label))) throw new Error('open failed');
      await withTimeout(ready, RENDER_READY_TIMEOUT_MS, () => {});
      const answered = new Promise<string>((resolve, reject) => {
        h.listener = (m) => {
          if (m.type === 'session-ready' && m.sessionId === session.sessionId) resolve(m.probe);
          if (m.type === 'session-failed' && m.sessionId === session.sessionId) reject(new Error(m.error));
        };
      });
      await deps.link.send(h.label, { type: 'session', session });
      const probe = await withTimeout(answered, RENDER_SESSION_TIMEOUT_MS, () => {});
      // ⚠️ **本体と同じ絵にならない窓は使わない**（字体・素材・パターンのどれかが窓で違って解けている）。
      if (probe !== mainProbe) throw new Error('probe mismatch');
      h.listener = null;
      return true;
    } catch (e) {
      // 使わなかった理由を後から追えるように残す（普段の実況＝info）。
      console.info(`[export] render window ${h.label} not used: ${reasonForLog(e)}`);
      await retire(h);
      return false;
    }
  };

  for (let i = 1; i <= count; i += 1) {
    const h: Helper = { label: `render-${stamp}-${i}`, alive: true, listener: null };
    helpers.push(h);
    byLabel.set(h.label, h);
  }
  await Promise.all(helpers.map((h) => start(h)));

  let nextJobId = 0;
  const drawerOf = (h: Helper, seg: RenderSegment): FrameDrawer => ({
    async draw(range: FrameRange, onProgress: (done: number) => void): Promise<void> {
      if (!h.alive) throw new Error('render window retired');
      nextJobId += 1;
      const jobId = nextJobId;
      let counted = { frames: 0, bytes: 0 };
      // ⚠️ 置いた数は**差分だけ**数える（知らせは合計で届く）。
      const account = (frames: number, bytes: number): void => {
        const df = frames - counted.frames;
        const db = bytes - counted.bytes;
        counted = { frames, bytes };
        if (df > 0) void deps.accountFrames(df, db);
      };
      let idle: ReturnType<typeof setTimeout> | null = null;
      try {
        await new Promise<void>((resolve, reject) => {
          const arm = (): void => {
            if (idle) clearTimeout(idle);
            idle = setTimeout(() => reject(new Error('render window timeout')), RENDER_JOB_IDLE_TIMEOUT_MS);
          };
          h.listener = (m) => {
            if (!('jobId' in m) || m.jobId !== jobId || m.sessionId !== session.sessionId) return;
            if (m.type === 'progress') {
              arm();
              account(m.frames, m.bytes);
              onProgress(m.done);
            } else if (m.type === 'job-done') {
              account(m.frames, m.bytes);
              if (m.error) reject(new Error(m.error));
              else resolve();
            }
          };
          arm();
          deps.link.send(h.label, { type: 'job', sessionId: session.sessionId, job: { jobId, ...seg, fromFrame: range.fromFrame, toFrame: range.toFrame } })
            .catch(reject);
        });
      } catch (e) {
        // ⚠️ **落ちた・黙った・失敗した窓はもう使わない**（その範囲は呼ぶ側が戻して、ほかの描き手が描き直す）。
        await retire(h);
        throw e;
      } finally {
        if (idle) clearTimeout(idle);
        if (h.listener) h.listener = null;
      }
    },
    abort() {
      void deps.link.send(h.label, { type: 'cancel', sessionId: session.sessionId }).catch(() => {});
    },
  });

  return {
    size: () => helpers.filter((h) => h.alive).length,
    drawersFor: (seg) => helpers.filter((h) => h.alive).map((h) => drawerOf(h, seg)),
    async close() {
      for (const h of helpers) {
        if (h.alive) await deps.link.send(h.label, { type: 'cancel', sessionId: session.sessionId }).catch(() => {});
      }
      await Promise.all(helpers.map((h) => retire(h)));
      unlisten();
    },
  };
}
