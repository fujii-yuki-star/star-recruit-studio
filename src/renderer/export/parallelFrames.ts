// 区間のコマを、本体と隠した別の窓で分けて描く段取り（ADR-0070）。
//
// ⚠️ **ここは段取りだけ**＝描くのは各窓の `buildTimelineFrames`（同じ関数）。窓のつなぎ方（Tauri の窓・知らせ）は
//   呼ぶ側が `FrameDrawer` として渡す＝ここは窓を知らない（検査で偽の描き手を渡せる）。
// ⚠️ **区間を小分けにして、空いた描き手から取っていく**＝絵の重さは場所で偏る（喋っている間は毎コマ描き、
//   止まっている間は写すだけ）。等分すると、重い所を引いた窓だけが遅れて全体が待つ。
import { ExportCancelledError } from './buildExportScenes';

/** 1つの小分けのコマ数（8秒＝30fps）。小さすぎると窓へ頼む往復が増え、大きすぎると偏りが残る。 */
export const PARALLEL_CHUNK_FRAMES = 240;

/** 窓で分けて描くのは、描くコマがこれ以上の区間だけ（10秒＝30fps）。窓を立てる数秒で得が消えるため（ADR-0070 決定5）。 */
export const PARALLEL_MIN_FRAMES = 300;

/** 描く範囲（動画の頭から数えたコマの番号・`toFrame` は含まない）。 */
export interface FrameRange {
  fromFrame: number;
  toFrame: number;
}

/** 範囲を `size` コマずつに分ける（最後は余り）。 */
export function frameChunks(fromFrame: number, toFrame: number, size: number = PARALLEL_CHUNK_FRAMES): FrameRange[] {
  const out: FrameRange[] = [];
  const step = Math.max(1, Math.floor(size));
  for (let f = fromFrame; f < toFrame; f += step) out.push({ fromFrame: f, toFrame: Math.min(toFrame, f + step) });
  return out;
}

/** 1つの描き手（本体か、隠した窓）。 */
export interface FrameDrawer {
  /** 範囲を描いて置く。`onProgress` にはその範囲の中で置き終えたコマ数を渡す。失敗したら reject。 */
  draw(range: FrameRange, onProgress: (done: number) => void): Promise<void>;
  /** 描いている途中でも止めさせる（中止・本体の失敗のとき）。本体の描き手は持たなくてよい。 */
  abort?(): void;
}

/**
 * 小分けにした範囲を、描き手たちで分けて描く。`drawers[0]` は**本体**（落ちたら全体を止める）、
 * 残りは**隠した窓**（落ちたらその範囲を戻して、ほかの描き手が描き直す＝ADR-0070 決定7）。
 *
 * ⚠️ **コマを抜かさない**＝窓が落ちた範囲は丸ごと描き直す（途中まで置いたコマは上書きされる）。
 * ⚠️ 進み具合は「置き終えたコマの合計」＝描き直す範囲は数え直す（行き過ぎない）。
 */
export async function drawRangesInParallel(
  ranges: readonly FrameRange[],
  drawers: readonly FrameDrawer[],
  opts: { onProgress?: (done: number) => void; shouldCancel?: () => boolean } = {},
): Promise<void> {
  if (drawers.length === 0) throw new Error('no drawer');
  const queue = [...ranges];
  const doneByRange = new Map<FrameRange, number>();
  let stopped = false;
  let failure: unknown = null;
  /** 描いている途中の範囲の数（本体は、窓が描いている間は待つ＝窓が落ちたら戻った範囲を描くため）。 */
  let inFlight = 0;
  let wake: (() => void) | null = null;
  const changed = (): void => {
    const w = wake;
    wake = null;
    w?.();
  };
  const report = (): void => {
    let sum = 0;
    for (const n of doneByRange.values()) sum += n;
    opts.onProgress?.(sum);
  };
  const stopAll = (): void => {
    if (stopped) return;
    stopped = true;
    for (const d of drawers) d.abort?.();
    changed();
  };

  const run = async (drawer: FrameDrawer, isMain: boolean): Promise<void> => {
    while (!stopped) {
      if (opts.shouldCancel?.()) {
        stopAll();
        return;
      }
      const range = queue.shift();
      if (!range) {
        // ⚠️ **本体は、窓が描いている間は抜けない**＝窓が落ちて範囲が戻ったとき、描く者がいなくなる。
        if (!isMain || inFlight === 0) return;
        await new Promise<void>((r) => { wake = r; });
        continue;
      }
      inFlight += 1;
      doneByRange.set(range, 0);
      try {
        await drawer.draw(range, (done) => {
          doneByRange.set(range, done);
          report();
        });
        doneByRange.set(range, range.toFrame - range.fromFrame);
        report();
        inFlight -= 1;
        changed();
      } catch (e) {
        inFlight -= 1;
        doneByRange.delete(range);
        report();
        if (isMain || e instanceof ExportCancelledError || opts.shouldCancel?.()) {
          // 本体の失敗・中止＝全体を止める（窓にも止めさせる）。
          if (failure == null) failure = e;
          stopAll();
          return;
        }
        // 窓の失敗＝その範囲を先頭へ戻し、この窓はもう使わない（ほかの描き手が描き直す）。
        queue.unshift(range);
        changed();
        return;
      }
    }
  };

  await Promise.all(drawers.map((d, i) => run(d, i === 0)));
  if (failure != null) throw failure;
  if (opts.shouldCancel?.()) throw new ExportCancelledError();
  // ⚠️ 窓が全部落ちて本体も抜けた、は起きない（本体は最後まで取りに行く）が、残りがあれば黙って返さない。
  if (queue.length > 0) throw new Error('frames left undrawn');
}
