// 掴んだまま端まで来たら送る（#714-1）。速さの規則は domain（`edgeScrollPxPerSec`）、
// ここが持つのは**時計と要素**だけ。
//
// ⚠️ **送っている間は指が止まっていても落ちる先が変わる**（枠が動くので、指の下の時刻が変わる）。
// だから毎フレーム**最後の指の位置で `onMove` をやり直す**＝ゴーストも判定も追いつく。
// これをしないと「送られてはいるが、離すと送る前の時刻に落ちる」という食い違いになる。
import { useCallback, useEffect, useRef } from "react";
import { edgeScrollPxPerSec, nextScrollLeft } from "../../domain/timeline/autoScroll";
import { visibleRectOf } from "../timelineDrop";

/**
 * その指の位置で送る速さ。**縦は枠の中にいるときだけ**（#714 レビュー・2名が独立に指摘）。
 *
 * ⚠️ 横だけで見ると、**タイムラインの上に指が無くても効く**。既定の配置では左の「置く」欄と
 * タイムラインの枠が**同じ左端から始まる**ので、一覧の左寄りを掴んだ瞬間に送る帯に入り、
 * 落とし先も予告も無いまま最大の速さで先頭へ巻き戻る＝いちばん見失う壊れ方だった。
 * 縦は**切った後の見えている矩形**で見る（落とし先の判定と同じ規則＝2つの当たり判定を割らない）。
 * 横のはみ出しは今までどおり許す（端へ寄せながら運ぶのは普通の操作）。
 */
function speedFor(el: HTMLElement, ev: PointerEvent, insetLeftPx: number): number {
  const box = visibleRectOf(el);
  if (!box || ev.clientY < box.top || ev.clientY > box.bottom) return 0;
  return edgeScrollPxPerSec({
    pointerPx: ev.clientX - el.getBoundingClientRect().left,
    viewPx: el.clientWidth,
    insetLeftPx,
  });
}

type Session = {
  el: HTMLElement;
  ev: PointerEvent;
  replay: (ev: PointerEvent) => void;
  lastMs: number;
  raf: number;
};

/**
 * 掴んでいる間の**端送り**。`track` を `onMove` から呼び、`stop` を離す・やめる・画面を離れるで呼ぶ。
 * 端の帯に入っていない間は時計を回さない（掴んでいるだけで毎フレーム走らせない）。
 */
export function useEdgeAutoScroll(insetLeftPx = 0): {
  track: (el: HTMLElement | null, ev: PointerEvent, replay: (ev: PointerEvent) => void) => void;
  stop: () => void;
} {
  const ref = useRef<Session | null>(null);

  const stop = useCallback((): void => {
    if (!ref.current) return;
    cancelAnimationFrame(ref.current.raf);
    ref.current = null;
  }, []);

  // 画面を離れたら止める（掴んだまま別の画面へ行っても回り続けない）。
  useEffect(() => stop, [stop]);

  const track = useCallback(
    (el: HTMLElement | null, ev: PointerEvent, replay: (ev: PointerEvent) => void): void => {
      if (!el) { stop(); return; } // 枠が消えたら止める（外れた要素を見て回り続けない）
      if (speedFor(el, ev, insetLeftPx) === 0) {
        stop();
        return;
      }
      if (ref.current) {
        // もう回っている＝**指の位置だけ差し替える**（時計は掛け直さない＝速さが跳ねない）。
        ref.current.el = el;
        ref.current.ev = ev;
        ref.current.replay = replay;
        return;
      }
      const step = (nowMs: number): void => {
        const s = ref.current;
        if (!s) return;
        const dtSec = Math.min(0.05, Math.max(0, (nowMs - s.lastMs) / 1000)); // 戻ってきた直後に跳ばない
        s.lastMs = nowMs;
        const px = speedFor(s.el, s.ev, insetLeftPx) * dtSec;
        const before = s.el.scrollLeft;
        s.el.scrollLeft = nextScrollLeft(before, px, s.el.scrollWidth - s.el.clientWidth);
        if (s.el.scrollLeft !== before) s.replay(s.ev); // 動いた分だけ落ちる先も動く
        s.raf = requestAnimationFrame(step);
      };
      ref.current = { el, ev, replay, lastMs: performance.now(), raf: 0 };
      ref.current.raf = requestAnimationFrame(step);
    },
    [stop, insetLeftPx],
  );

  return { track, stop };
}
