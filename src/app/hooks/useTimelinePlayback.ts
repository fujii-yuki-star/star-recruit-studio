// タイムラインの連続再生（ADR-0032・#630）。**時計だけ**をここが持ち、見せる時刻の決め方は
// domain の純粋関数（`playbackTick`）に委ねる＝再生で見た絵と書き出したフレームがずれない（ADR-0001）。
import { useEffect, useRef } from "react";
import { effectiveFps, playbackTick } from "../../domain/timeline/playback";
import { timelineDurationSec } from "../../domain/timeline/persistence";
import { useTimelineStore } from "../store/timelineStore";

/**
 * 再生中だけ時計を回し、再生位置を進める。終わりまで来たら止める。
 *
 * **経過は「再生を始めた実時刻」から測る**（毎フレームの差分を足し込まない）＝端末が重くてフレームが
 * 落ちても、再生位置が実時間から遅れていかない（音を足したときに絵と音がずれない土台になる）。
 */
export function useTimelinePlayback(): void {
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const doc = useTimelineStore((s) => s.doc);
  // **位置を外から動かされたら測り直す**ための世代番号。`playheadSec` を依存にすると、この effect 自身が
  // それを更新するので毎フレーム組み直しになる（＝時計が進まない）。
  const seekNonce = useTimelineStore((s) => s.seekNonce);
  const startedAt = useRef<{ wallMs: number; sec: number } | null>(null);

  useEffect(() => {
    if (!isPlaying || !doc) {
      startedAt.current = null;
      return;
    }
    const total = timelineDurationSec(doc);
    startedAt.current = { wallMs: performance.now(), sec: useTimelineStore.getState().playheadSec };
    let raf = 0;
    const tick = (): void => {
      const from = startedAt.current;
      if (!from) return;
      const { sec, ended } = playbackTick(from.sec, (performance.now() - from.wallMs) / 1000, total, effectiveFps(doc));
      // **`setPlayhead` ではなく専用の入口**を使う（世代番号を上げると毎フレーム測り直しになる）。
      useTimelineStore.getState()._advancePlayhead(sec);
      if (ended) useTimelineStore.getState().pause();
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, doc, seekNonce]);

  // 画面を離れたら止める＝戻ったときに勝手に再生が続いていない（`isPlaying` は文書の寿命、時計は画面の寿命）。
  useEffect(() => () => useTimelineStore.getState().pause(), []);
}
