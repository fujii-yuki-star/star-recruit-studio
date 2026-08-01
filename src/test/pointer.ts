// 対話テスト用のポインタ操作ヘルパー（ADR-0014・#645）。
//
// **なぜ時刻を固定するのか**：二度押し（実機は互換 dblclick が来ないので pointerdown 2回で判定・#525-4）は
// `e.timeStamp` の差を `DOUBLE_TAP_MS` と比べる。実機ではブラウザが**押した瞬間**の時刻をイベントに載せる
// ので、間に重い再描画が入っても利用者の押した間隔がそのまま測られる。ところがテストの `fireEvent` は
// **呼んだ瞬間**の実時刻を載せるため、1回目と2回目の間に走る React の再描画（場面編集は画面全体）が
// 経過時間に混ざる。並列実行で負荷が高いと 350ms を超え、**二度押しと見なされずに落ちる**（#645）。
// ここで時刻を明示して、判定を**描画の速さに依存させない**。
import { createEvent, fireEvent } from "@testing-library/react";

/** 既定の押下位置（二度押しの近接判定 `DOUBLE_TAP_DIST` に収まる同一座標）。 */
const DEFAULT_POINT = { clientX: 10, clientY: 10 };

type PointerInit = { button?: number; clientX?: number; clientY?: number; pointerId?: number; shiftKey?: boolean };

/** 時刻を指定して pointerdown を送る（`timeStamp` は読み取り専用なので、作ってから差し替える）。 */
export function pointerDownAt(el: Element, timeStamp: number, init: PointerInit = {}): void {
  const ev = createEvent.pointerDown(el, { button: 0, pointerId: 1, ...DEFAULT_POINT, ...init });
  Object.defineProperty(ev, "timeStamp", { value: timeStamp, configurable: true });
  fireEvent(el, ev);
}

/**
 * 二度押し（インライン編集・グループのドリルイン）。**2回の押下を同じ時刻で送る**ので、
 * 間の再描画がどれだけ遅くても二度押しとして扱われる。
 */
export function doubleTap(el: Element, init: PointerInit = {}): void {
  const t = 1000; // 実時刻と無関係な固定値（差が 0＝必ずしきい値内）
  pointerDownAt(el, t, init);
  fireEvent.pointerUp(el, { pointerId: init.pointerId ?? 1 });
  pointerDownAt(el, t, init);
}
