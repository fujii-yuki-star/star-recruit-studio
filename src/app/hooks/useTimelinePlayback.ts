// タイムラインの連続再生（ADR-0032・#630）。**時計だけ**をここが持ち、見せる時刻の決め方は
// domain の純粋関数（`playbackTick`）に委ねる＝再生で見た絵と書き出したフレームがずれない（ADR-0001）。
import { useEffect, useRef } from "react";
import { effectiveFps, loopSpan, playbackTick } from "../../domain/timeline/playback";
import { timelineDurationSec } from "../../domain/timeline/persistence";
import { useTimelineStore } from "../store/timelineStore";
import { setPlaybackPulse } from "./playbackPulse";

/**
 * 再生中だけ時計を回し、再生位置を進める。終わりまで来たら止める。
 *
 * **経過は「再生を始めた実時刻」から測る**（毎フレームの差分を足し込まない）＝端末が重くてフレームが
 * 落ちても、再生位置が実時間から遅れていかない（音を足したときに絵と音がずれない土台になる）。
 *
 * `enabled` が偽（＝仕上がり確認の別窓・ADR-0050）なら時計を持たない＝時計は本体だけ。
 * ⚠️ **1歩ぶんの処理（`step`）を外からも呼べる**（`pulsePlayback`）＝本体の窓が隠れて描く合図が止まっても、
 * 別窓の合図で進められる。1歩は始めた実時刻から測るので、余計に呼ばれても位置はずれない。
 */
export function useTimelinePlayback(enabled = true): void {
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const doc = useTimelineStore((s) => s.doc);
  // **位置を外から動かされたら測り直す**ための世代番号。`playheadSec` を依存にすると、この effect 自身が
  // それを更新するので毎フレーム組み直しになる（＝時計が進まない）。
  const seekNonce = useTimelineStore((s) => s.seekNonce);
  const startedAt = useRef<{ wallMs: number; sec: number } | null>(null);

  useEffect(() => {
    if (!enabled || !isPlaying || !doc) {
      startedAt.current = null;
      return;
    }
    const total = timelineDurationSec(doc);
    startedAt.current = { wallMs: performance.now(), sec: useTimelineStore.getState().playheadSec };
    let raf = 0;
    let done = false;
    /** 1歩進める。続けるなら `true`。 */
    const step = (): boolean => {
      const from = startedAt.current;
      if (!from || done) return false;
      const { sec, ended } = playbackTick(from.sec, (performance.now() - from.wallMs) / 1000, total, effectiveFps(doc));
      // **繰り返し**（#1267）＝区間の終わりまで来たら始まりへ戻す（時計の測り直しは `_loopTo` が世代番号で起こす）。
      const st = useTimelineStore.getState();
      const span = loopSpan(st.loopPlayback, st.rangeInSec, st.rangeOutSec, total);
      if (span && (sec >= span.endSec || ended)) { done = true; st._loopTo(span.startSec); return false; }
      // **`setPlayhead` ではなく専用の入口**を使う（世代番号を上げると毎フレーム測り直しになる）。
      st._advancePlayhead(sec);
      if (ended) { done = true; st.pause(); return false; }
      return true;
    };
    const tick = (): void => {
      if (step()) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    setPlaybackPulse(() => { step(); });
    return () => {
      cancelAnimationFrame(raf);
      setPlaybackPulse(null);
    };
  }, [enabled, isPlaying, doc, seekNonce]);

  // 画面を離れたら止める＝戻ったときに勝手に再生が続いていない（`isPlaying` は文書の寿命、時計は画面の寿命）。
  // ⚠️ **別窓では止めない**＝別窓が閉じただけで本体の再生が止まる、を作らない。
  const enabledRef = useRef(enabled);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);
  useEffect(() => () => { if (enabledRef.current) useTimelineStore.getState().pause(); }, []);
}
