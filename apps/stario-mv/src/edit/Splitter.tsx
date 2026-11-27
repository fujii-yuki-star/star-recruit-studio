import { useRef } from "react";

/**
 * 欄の境目（掴んで大きさを変える）。`sign`＝右・下へ動かすと大きくなる欄なら 1、小さくなる欄なら -1。
 * キーボードでも動かせる（←→／↑↓で 16 画素）。
 */
export function Splitter(props: {
  orientation: "vertical" | "horizontal";
  label: string;
  value: number;
  sign: 1 | -1;
  onChange: (v: number) => void;
}): React.JSX.Element {
  const start = useRef<{ p: number; v: number } | null>(null);
  const vertical = props.orientation === "vertical";
  return (
    <div
      role="separator"
      aria-orientation={props.orientation}
      aria-label={props.label}
      aria-valuenow={props.value}
      tabIndex={0}
      className={`splitter ${vertical ? "v" : "h"}`}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        start.current = { p: vertical ? e.clientX : e.clientY, v: props.value };
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s) return;
        props.onChange(s.v + props.sign * ((vertical ? e.clientX : e.clientY) - s.p));
      }}
      onPointerUp={() => (start.current = null)}
      onKeyDown={(e) => {
        const grow = vertical ? "ArrowRight" : "ArrowDown";
        const shrink = vertical ? "ArrowLeft" : "ArrowUp";
        if (e.key !== grow && e.key !== shrink) return;
        e.preventDefault();
        e.stopPropagation();
        props.onChange(props.value + props.sign * (e.key === grow ? 16 : -16));
      }}
    />
  );
}
