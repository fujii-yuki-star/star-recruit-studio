import { useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { usePointerDrag } from "../hooks/usePointerDrag";
import type { OverviewViewport } from "../timelineOverview";

/** 全体図に描く部品1つ（列の並びの何番目か・時間・種類の色）。 */
export interface OverviewClip {
  id: string;
  row: number;
  startSec: number;
  endSec: number;
  /** 色の種類（`timeline-overview-clip--◯◯`）。 */
  tone: "video" | "telop" | "shape" | "audio" | "bgm";
}

/**
 * タイムラインの全体図の帯（#1319 c2・ADR-0034 決定1＝業界の型）。
 *
 * 全体を細い帯に縮め、**いま見えている範囲を枠で示す**（Resolve のカットページの上のタイムライン・Premiere の横スクロール）。
 * - **押す**＝その時刻が真ん中に来るように並びを送る（そのまま運べば続けて送る）。
 * - **枠を掴んで運ぶ**＝並びも一緒に送る。
 * - **矢印キー**＝見えている幅の1割ずつ送る（`Home`／`End` で端へ）。
 * ⚠️ **描くだけ**＝部品は掴めない（並びの上で触る）。字や波形も描かない（細くて読めない）。
 * ⚠️ **場所は常に取る**（`active` が偽なら中身を描かず押せない）＝出し入れで並びが縦にずれない（PR #1412 レビュー）。
 * ⚠️ **`Escape` で送る前へ戻す**＝同じ画面のほかの運ぶ操作（欄の境界）と同じ流儀。
 */
export function TimelineOverview({
  active,
  controlsId,
  totalSec,
  rows,
  clips,
  view,
  playheadSec,
  range,
  onCenterAt,
  onScrollBySec,
  getScrollPx,
  setScrollPx,
}: {
  /** 偽＝全体が収まっている・まだ測れていない（場所だけ取り、中身は描かない）。 */
  active: boolean;
  /** 送る相手（並びの枠）の id＝`aria-controls`。 */
  controlsId: string;
  totalSec: number;
  rows: number;
  clips: readonly OverviewClip[];
  view: OverviewViewport;
  playheadSec: number;
  range: { startSec: number; endSec: number } | null;
  /** その時刻を真ん中へ。 */
  onCenterAt: (sec: number) => void;
  /** 見えている範囲を秒で送る（正＝右へ）。 */
  onScrollBySec: (deltaSec: number) => void;
  /** いまの送り量（`Escape` で戻す先を控える）。 */
  getScrollPx: () => number;
  /** 送り量を戻す。 */
  setScrollPx: (px: number) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const beginDrag = usePointerDrag();
  const pct = (sec: number): string => `${(Math.max(0, Math.min(totalSec, sec)) / totalSec) * 100}%`;
  const rowH = 100 / Math.max(1, rows);
  const secAt = (clientX: number): number => {
    const r = barRef.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return 0;
    return ((clientX - r.left) / r.width) * totalSec;
  };

  /** 運ぶ（枠を掴んだとき・押してそのまま運んだとき）。動いた割合ぶん送る。 */
  const follow = (e: ReactPointerEvent, before: number): void => {
    let lastX = e.clientX;
    beginDrag(e, {
      startPx: 0,
      onMove: (ev) => {
        const w = barRef.current?.getBoundingClientRect().width ?? 0;
        if (w > 0) onScrollBySec(((ev.clientX - lastX) / w) * totalSec);
        lastX = ev.clientX;
      },
      // `Escape`＝押す前の送り量へ戻す（押した瞬間に真ん中へ送った分も含めて）。
      onCancel: () => setScrollPx(before),
    });
  };

  const onKeyDown = (e: ReactKeyboardEvent): void => {
    const step = Math.max(0.1, (view.endSec - view.startSec) * 0.1);
    if (e.key === "ArrowRight") onScrollBySec(step);
    else if (e.key === "ArrowLeft") onScrollBySec(-step);
    else if (e.key === "Home") onScrollBySec(-totalSec);
    else if (e.key === "End") onScrollBySec(totalSec);
    else return;
    e.preventDefault();
    // ⚠️ **並び全体の近道へ渡さない**＝矢印は並びでは「再生位置を1コマ動かす」。全体図に焦点があるときは送るだけ。
    e.stopPropagation();
  };

  if (!active) return <div className="timeline-overview timeline-overview--idle" aria-hidden="true" />;

  return (
    <div
      ref={barRef}
      className="timeline-overview"
      role="scrollbar"
      aria-controls={controlsId}
      aria-valuetext={`${Math.round(view.startSec)}秒から${Math.round(view.endSec)}秒まで（全体 ${Math.round(totalSec)}秒）`}
      title="押すとその時刻へ送ります。枠を運んでも送れます（← → で少しずつ・Home／End で端へ）"
      aria-orientation="horizontal"
      aria-label="全体図（押すとその時刻へ送ります）"
      aria-valuemin={0}
      aria-valuemax={Math.round(totalSec)}
      aria-valuenow={Math.round(view.startSec)}
      tabIndex={0}
      data-testid="timeline-overview"
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const before = getScrollPx();
        onCenterAt(secAt(e.clientX));
        follow(e, before);
      }}
    >
      {range && range.endSec > range.startSec && (
        <span className="timeline-overview-range" style={{ left: pct(range.startSec), width: pct(range.endSec - range.startSec) }} aria-hidden="true" />
      )}
      {clips.map((c) => (
        <span
          key={c.id}
          className={`timeline-overview-clip timeline-overview-clip--${c.tone}`}
          style={{ left: pct(c.startSec), width: pct(c.endSec - c.startSec), top: `${c.row * rowH}%`, height: `${rowH}%` }}
          aria-hidden="true"
        />
      ))}
      <span className="timeline-overview-playhead" style={{ left: pct(playheadSec) }} aria-hidden="true" />
      <span
        className="timeline-overview-window"
        style={{ left: pct(view.startSec), width: pct(view.endSec - view.startSec) }}
        data-testid="timeline-overview-window"
        aria-hidden="true"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation(); // 枠を掴んだら真ん中へ跳ばさない（掴んだ所からそのまま運ぶ）
          follow(e, getScrollPx());
        }}
      />
    </div>
  );
}
