// 書き出しのコマを描く**隠した窓**の中身（ADR-0070）。画面は出さない＝本体から範囲を受け取り、描いて置き、知らせるだけ。
//
// ⚠️ **描くのは本体と同じ関数**（`buildTimelineFrames`）・材料の組み立ても同じ（`sessionDrawOptions`）。
// ⚠️ **状態の持ち主は本体**（ADR-0050 と同じ）＝ここは保存・音・書き出しの締めに触れない。
// ⚠️ **1つずつ描く**＝頼まれた範囲は順に描く（同じ窓で2つ同時に描くと、主スレッドを取り合うだけ）。
import { buildTimelineFrames } from '../../renderer/export/buildTimelineFrames';
import type { BuildTimelineFramesOptions } from '../../renderer/export/buildTimelineFrames';
import { ExportCancelledError } from '../../renderer/export/buildExportScenes';
import { reasonForLog } from '../../infrastructure/renderWindowLink';
import { probeHash, sessionDrawOptions, type MainToRender, type RenderJob, type RenderSessionPayload, type RenderToMain } from './renderSession';

/** 1回の書き出しの、窓の中の材料（`prepare` が作る）。 */
export interface RenderWindowSession {
  session: RenderSessionPayload;
  /** 描く材料（置く口・読む口まで入れたもの）。 */
  drawOptions: BuildTimelineFramesOptions;
}

/** 窓の中の動き（検査で偽物を渡せるように外から受ける）。 */
export interface RenderWindowDeps {
  label: string;
  send(msg: RenderToMain): Promise<void> | void;
  /** 材料をそろえる（字体・素材の絵・パックの字体）。 */
  prepare(session: RenderSessionPayload): Promise<RenderWindowSession>;
  /** 確かめの1コマの印。 */
  probe(ctx: RenderWindowSession): Promise<string>;
  /** 範囲を描いて置く（本物は `buildTimelineFrames`）。 */
  draw(doc: RenderSessionPayload['doc'], opts: BuildTimelineFramesOptions): Promise<unknown>;
}

/** 進み具合を送る間隔（コマ数）。毎コマ送ると知らせの往復で本体が詰まる。 */
export const RENDER_PROGRESS_EVERY = 24;

/**
 * 本体からの知らせを受ける手（`handle`）を作る。
 * ⚠️ 中止は**書き出しの回ごと**（`sessionId`）＝前の回の中止で次の回を止めない。
 */
export function createRenderWindowHandler(deps: RenderWindowDeps): { handle(msg: MainToRender): Promise<void> } {
  let ctx: RenderWindowSession | null = null;
  const cancelled = new Set<string>();
  let chain: Promise<void> = Promise.resolve();

  const runJob = async (sessionId: string, job: RenderJob): Promise<void> => {
    let frames = 0;
    let bytes = 0;
    const base = { label: deps.label, sessionId, jobId: job.jobId };
    try {
      if (!ctx || ctx.session.sessionId !== sessionId) throw new Error('no session');
      if (cancelled.has(sessionId)) throw new ExportCancelledError();
      const o = ctx.drawOptions;
      let lastSent = 0;
      await deps.draw(ctx.session.doc, {
        ...o,
        // ⚠️ **置いた数と大きさを数える**＝窓には空きの見張りが無いので、本体へ知らせて本体が数える。
        ...(o.stageFramePng ? { stageFramePng: async (d, i, png) => { await o.stageFramePng!(d, i, png); frames += 1; bytes += png.byteLength; } } : {}),
        ...(o.copyFrames ? { copyFrames: async (d, f, t, n, b) => { await o.copyFrames!(d, f, t, n, b); frames += n; bytes += n * b; } } : {}),
        framesDirName: job.framesDirName,
        window: { fromFrame: job.fromFrame, toFrame: job.toFrame },
        stageIndexBase: job.stageIndexBase,
        stagedVideos: job.stagedVideos,
        onProgress: (done) => {
          if (done - lastSent < RENDER_PROGRESS_EVERY) return;
          lastSent = done;
          void deps.send({ type: 'progress', ...base, done, frames, bytes });
        },
        shouldCancel: () => cancelled.has(sessionId),
      });
      await deps.send({ type: 'job-done', ...base, frames, bytes });
    } catch (e) {
      await deps.send({ type: 'job-done', ...base, frames, bytes, error: reasonForLog(e) });
    }
  };

  return {
    async handle(msg) {
      if (msg.type === 'cancel') {
        cancelled.add(msg.sessionId);
        return;
      }
      if (msg.type === 'session') {
        ctx = null;
        try {
          ctx = await deps.prepare(msg.session);
          const probe = await deps.probe(ctx);
          await deps.send({ type: 'session-ready', label: deps.label, sessionId: msg.session.sessionId, probe });
        } catch (e) {
          ctx = null;
          await deps.send({ type: 'session-failed', label: deps.label, sessionId: msg.session.sessionId, error: reasonForLog(e) });
        }
        return;
      }
      // 範囲は届いた順に1つずつ描く。
      const { sessionId, job } = msg;
      chain = chain.then(() => runJob(sessionId, job));
      await chain;
    },
  };
}

/**
 * 窓の中の本物の材料（字体・素材の絵・パックの字体）をそろえる。
 * ⚠️ **素材の絵は本体と同じ関数で読む**（`createExportSrcResolver`・`resolveExportSrcMap`）＝同じファイルから同じ文字列。
 * ⚠️ **本体が引ける素材を窓で引けなければ失敗にする**（`knownSrcIds`）＝黙って灰色の枠で描かない。
 */
export async function prepareRenderWindowSession(session: RenderSessionPayload): Promise<RenderWindowSession> {
  const [{ setPackFontSources }, { loadExportFonts }, { createExportSrcResolver, resolveExportSrcMap }, { timelineImageAssetIds }, io] = await Promise.all([
    import('../../infrastructure/userFontFs'),
    import('../../renderer/export/loadExportFonts'),
    import('../store/assetExportSrc'),
    import('../../domain/timeline/export'),
    import('../../infrastructure/ffmpegExport'),
  ]);
  setPackFontSources(session.packFonts);
  await loadExportFonts();
  const doc = session.doc;
  const loose = sessionDrawOptions(session, () => undefined);
  const exportSrcById = await resolveExportSrcMap(
    timelineImageAssetIds(doc, loose.templateOf),
    createExportSrcResolver({ projectId: doc.projectId, assets: doc.assets, templateAssetSrcById: session.templateAssetSrcById }),
  );
  const known = new Set(session.knownSrcIds);
  const assetSrc = (id: string | null): string | undefined => {
    if (!id) return undefined;
    const src = exportSrcById[id] ?? session.templateAssetSrcById[id];
    if (src == null && known.has(id)) throw new Error(`asset not resolvable in render window: ${id}`);
    return src;
  };
  return {
    session,
    drawOptions: {
      ...sessionDrawOptions(session, assetSrc, true),
      stageFrame: io.stageExportFrame,
      stageFramePng: io.stageExportFramePng,
      copyFrames: io.copyExportFrames,
      readVideoFrame: (dirName, frameIndex) => io.readExportFrame(dirName, frameIndex),
    },
  };
}

/** 描く窓として起動する（`main.tsx` から呼ぶ）。 */
export async function startRenderWindow(): Promise<void> {
  const link = await import('../../infrastructure/renderWindowLink');
  const label = await link.currentWindowLabel();
  const handler = createRenderWindowHandler({
    label,
    send: (msg) => link.sendToMainFromRender(msg),
    prepare: prepareRenderWindowSession,
    probe: (ctx) => probeHash(ctx.session.doc, ctx.drawOptions, ctx.session.probeFrame),
    draw: (doc, opts) => buildTimelineFrames(doc, opts),
  });
  await link.onRenderJob<MainToRender>((msg) => { void handler.handle(msg); });
  await link.sendToMainFromRender({ type: 'ready', label } satisfies RenderToMain);
}
