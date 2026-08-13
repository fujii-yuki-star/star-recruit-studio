// キャンバスで掴むときの**共通の作法**（ADR-0034 決定9・#769）。
//
// このアプリにはキャンバスが3つある（場面編集の自由配置／タイムライン編集／見た目パターン編集）。
// どれも `setPointerCapture` を使う自前のドラッグで、`usePointerDrag`（帯・欄の見出し）とは組み方が違う。
// **作法だけ**をここへ集め、3つが同じものを見るようにする。
//
// ⚠️ **書き写しで増やさない**＝#758 でこの機構を `FreeLayoutOverlay` に入れ、#769 で見た目パターン編集にも
// 要ることが分かった時点で共有へ抜いた。写すと「片方だけ直す」が必ず起きる（実際に `Escape` の受け持ちで
// 一度やっている）。
//
// 受け持つのは4つ：
// - **`Escape` を受け持っていると名乗る**（外側の解除まで走らせない）
// - **掴んでいる数に入れる**（掴んでいる最中の `Ctrl+Z` を止める）
// - **少し動かすまで掴まない**（押しただけ・手の震えで位置を書かない）
// - **掴んだ指だけ見る**（別の指の動き・離しを混ぜない）
//
// 受け持たないのは「何をどう動かすか」＝各キャンバスの中身（要素の種類も、動かし方も違う）。
import { useEffect, useRef } from "react";
import { claimEscape } from "./escapeOwners";
import { DRAG_START_PX, registerExternalDrag } from "./usePointerDrag";

export interface CanvasDrag {
  /**
   * 掴み始める（`pointerdown`）。⚠️ **前の掴みが残っていたら、呼ぶ前に閉じること**
   * （`isActive()` で見る）＝名乗りを外さずに上書きすると、`Escape`・取り消し・倍率の変更が
   * 恒久的に効かなくなる。
   */
  claim: (e: { clientX: number; clientY: number; pointerId: number }) => void;
  /** 掴んでいる間か（`claim` 〜 `release`）。同じ後始末を二度走らせないための印。 */
  isActive: () => boolean;
  /** その催しが**掴んだ指**のものか（掴んでいなければ素通しでよい）。 */
  mine: (e: { pointerId: number }) => boolean;
  /**
   * **少し動かしたか**。まだなら距離を測り、越えていれば真にして返す。
   * 越えるまでは位置を書かない（押しただけで動かさない）。
   */
  passedThreshold: (e: { clientX: number; clientY: number }) => boolean;
  /** しきい値を越えた後か（やめるときに「書き戻すか」を決めるのに使う）。 */
  isStarted: () => boolean;
  /** 名乗りをすべて外す。**やめる・離す・画面を離れる**のすべてで通すこと。 */
  release: () => void;
}

/**
 * キャンバスのドラッグの作法を1つにまとめる。画面を離れるときは自動で名乗りを外す
 *（外し忘れると `Escape` も取り消しも効かなくなる）。
 */
export function useCanvasDrag(): CanvasDrag {
  const claims = useRef<(() => void)[]>([]);
  const active = useRef(false);
  const started = useRef(false);
  const startPoint = useRef({ x: 0, y: 0 });
  const pointerId = useRef<number | null>(null);

  const release = (): void => {
    claims.current.forEach((r) => r());
    claims.current = [];
    active.current = false;
    started.current = false;
    pointerId.current = null;
  };
  const releaseRef = useRef(release);
  useEffect(() => { releaseRef.current = release; });
  // 画面を離れるときだけ後始末する（依存を書くと、渡された関数が変わるたびに走って
  // 掴んでいる最中に名乗りが落ちる＝#752-8 で踏んだ穴）。
  useEffect(() => () => releaseRef.current(), []);

  return {
    claim: (e) => {
      active.current = true;
      started.current = false;
      startPoint.current = { x: e.clientX, y: e.clientY };
      pointerId.current = e.pointerId;
      // ⚠️ **`Escape` の受け持ちも「掴んでいる」も、押した時点から**（#752 レビュー）。
      // キャンバスは `pointerdown` の時点で取り消しのまとめを開けるので、数に入れるのを
      // しきい値の後にすると**まとめが開いている間だけ `Ctrl+Z` が通る**穴になる。
      claims.current = [claimEscape(), registerExternalDrag()];
    },
    isActive: () => active.current,
    mine: (e) => pointerId.current == null || e.pointerId === pointerId.current,
    passedThreshold: (e) => {
      if (started.current) return true;
      const d = Math.hypot(e.clientX - startPoint.current.x, e.clientY - startPoint.current.y);
      if (d < DRAG_START_PX) return false;
      started.current = true;
      return true;
    },
    isStarted: () => started.current,
    release,
  };
}
