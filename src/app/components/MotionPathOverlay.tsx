// 動きの道筋と点（ADR-0054 段階2）。キャンバスの上に重ねる**編集用の描き足し**（書き出しには出ない）。
//
// - 線＝選んだ部品の中心が通る所（`motionPathOf`＝描画と同じ補間）。
// - 点＝位置を決めているキーフレーム。**掴んで引くと、その時刻の位置だけ**直る（時刻は変えない）。
//   本体を掴む＝動き全体の平行移動（段階1）とは手が分かれる＝業界の「その時刻だけ直す」を、見える操作で届ける（決定3）。
// ⚠️ **点だけが指を受ける**＝線や余白は下の部品（`FreeLayoutOverlay`）へ素通しする（本体を掴む操作を塞がない）。
// ⚠️ **ドラッグの作法は画面で1つ**（`usePointerDrag` の冒頭）＝左ボタンだけ・**少し動かすまで掴まない**（`DRAG_START_PX`）・
//   掴んだ指だけ見る・`Escape` と
//   `pointercancel` でやめて**元へ戻す**・掴んでいる間は数に入れる（`registerExternalDrag`＝その間 `Ctrl+Z` を通さない）。
// ⚠️ **キーボードの焦点は取らない**＝矢印キーは「選んだ部品を動かす」（段階1と同じ）に効くので、点に焦点があると
//   同じキーで何が動くかが割れる。値を数で直す道は「動き」の欄にある（行き止まりにしない）。
import { useEffect, useRef, useState } from "react";
import { useEscapeReceiver } from "../hooks/escapeOwners";
import { DRAG_START_PX, registerExternalDrag } from "../hooks/usePointerDrag";
import type { MotionPath } from "../../domain/timeline/motionPath";
import { motionKeyTitle } from "../uiLabels";

export function MotionPathOverlay({ path, canvasW, canvasH, currentSec, disabled, onDragStart, onDrag, onDragEnd }: {
  path: MotionPath;
  canvasW: number;
  canvasH: number;
  /** いまの時刻（クリップの先頭からの秒）。その時刻ちょうどの点を強く出す。 */
  currentSec: number | null;
  /** 列が固定されているなど＝線は見せるが点は掴ませない。 */
  disabled: boolean;
  onDragStart: (timeSec: number) => void;
  /**
   * 掴んだ時点からの**合計の動き**（キャンバスの px）。足し込まない＝呼ぶ側は掴んだ時点の値から計算し直す。
   * `axisMinPx`＝持っていない軸を書き足す境目（キャンバスの px）＝**画面で `DRAG_START_PX`** にそろえる
   * （手ぶれで縦の区切りが増えて緩急が変わる、を倍率によらず防ぐ・PR #1343 レビュー 🟡）。
   */
  onDrag: (timeSec: number, dx: number, dy: number, axisMinPx: number) => void;
  /**
   * 掴み終わった。`cancelled`＝やめた（`Escape`・`pointercancel`）＝その引きを**なかったことにする**
   * （掴む前へ戻し、取り消しにも跡を残さない）。
   */
  onDragEnd: (cancelled: boolean) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  /** 押した点。`release` が入るのは**掴んでから**（少し動かすまでは掴んでいない＝何も書かない・数にも入れない）。 */
  const drag = useRef<{ timeSec: number; startX: number; startY: number; perPx: number; pointerId: number; release: (() => void) | null } | null>(null);
  const [active, setActive] = useState(false);
  const pct = (v: number, of: number): string => `${(v / of) * 100}%`;
  const end = (cancel = false): void => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (!d.release) return; // 押しただけ＝掴んでいない（開いたものも書いたものも無い）
    d.release();
    setActive(false);
    onDragEnd(cancel);
  };
  useEscapeReceiver(active, () => {
    if (!drag.current) return false;
    end(true);
    return true;
  });
  // ⚠️ **掴んだまま消えても締める**（再生を始めた・選び直した）＝締めないと取り消しのまとまりが開いたまま残り、
  //   以後の編集が全部1つに束ねられる。最新の締め方を持っておく（掴んだときの関数は古いことがある）。
  const endRef = useRef(end);
  useEffect(() => {
    endRef.current = end;
  });
  useEffect(() => () => endRef.current(), []);
  return (
    <div ref={rootRef} className="motion-path" data-testid="motion-path">
      <svg viewBox={`0 0 ${canvasW} ${canvasH}`} preserveAspectRatio="none" width="100%" height="100%" aria-hidden="true">
        <polyline
          className="motion-path-line"
          points={path.line.map((p) => `${p.x},${p.y}`).join(" ")}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {path.keys.map((k) => (
        <div
          key={k.timeSec}
          className={`motion-path-key${currentSec != null && Math.abs(currentSec - k.timeSec) < 1e-6 ? " motion-path-key--current" : ""}${disabled ? " motion-path-key--disabled" : ""}`}
          data-testid="motion-key"
          data-time={k.timeSec}
          title={motionKeyTitle(k.timeSec, disabled)}
          style={{ left: pct(k.x, canvasW), top: pct(k.y, canvasH) }}
          onPointerDown={(e) => {
            if (disabled || e.button !== 0) return;
            e.preventDefault();
            const rect = rootRef.current?.getBoundingClientRect();
            // 画面の 1px がキャンバスの何 px か（倍率を変えても指と点がずれない）。測れなければ 1。
            const perPx = rect && rect.width > 0 ? canvasW / rect.width : 1;
            drag.current = { timeSec: k.timeSec, startX: e.clientX, startY: e.clientY, perPx, pointerId: e.pointerId, release: null };
            e.currentTarget.setPointerCapture?.(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d || e.pointerId !== d.pointerId) return;
            if (!d.release) {
              if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_START_PX) return;
              d.release = registerExternalDrag();
              setActive(true);
              onDragStart(d.timeSec);
            }
            onDrag(d.timeSec, (e.clientX - d.startX) * d.perPx, (e.clientY - d.startY) * d.perPx, DRAG_START_PX * d.perPx);
          }}
          onPointerUp={(e) => { if (drag.current?.pointerId === e.pointerId) end(); }}
          onPointerCancel={(e) => { if (drag.current?.pointerId === e.pointerId) end(true); }}
          onLostPointerCapture={() => end()}
        />
      ))}
    </div>
  );
}
