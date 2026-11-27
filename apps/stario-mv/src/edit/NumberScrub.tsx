import { useRef, useState } from "react";

/**
 * 数の欄（AE の型＝MV-0008 決定5）。左右に掴んで動かす（Shift で 10 倍・Ctrl で 1/10）・押して離すと打ち込み・
 * `Enter` で確定・`Esc` で取り消す。掴んでいる途中は `onPreview`（試し）、離した・確定したら `onCommit`（1つの取引）。
 */
export function NumberScrub(props: {
  label: string;
  value: number;
  /** 1 画素あたりの量。 */
  step: number;
  /** 小数の桁。 */
  digits?: number;
  unit?: string;
  min?: number;
  disabled?: boolean;
  onPreview?: (v: number) => void;
  /** 掴んで動かしたが元の値へ戻して離した（試しをやめる）。 */
  onCancel?: () => void;
  onCommit: (v: number) => void;
}): React.JSX.Element {
  const { label, value, step, digits = 1, unit = "", min, disabled } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [live, setLive] = useState<number | null>(null);
  const drag = useRef<{ x0: number; v0: number; moved: boolean; last: number } | null>(null);
  const clamp = (v: number): number => (min != null ? Math.max(min, v) : v);
  const round = (v: number): number => Math.round(v * 10 ** digits) / 10 ** digits;
  const shown = live ?? value;

  const startEdit = (): void => {
    setDraft(String(round(value)));
    setEditing(true);
  };
  const commitDraft = (): void => {
    setEditing(false);
    const n = Number(draft.trim());
    if (draft.trim() !== "" && Number.isFinite(n) && round(clamp(n)) !== round(value)) props.onCommit(clamp(n));
  };

  if (editing) {
    return (
      <input
        className="scrub-input"
        aria-label={label}
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") commitDraft();
          else if (e.key === "Escape") setEditing(false);
        }}
        onBlur={commitDraft}
      />
    );
  }
  return (
    <span
      role="spinbutton"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuenow={round(shown)}
      aria-disabled={disabled}
      className={`scrub${disabled ? " disabled" : ""}`}
      onKeyDown={(e) => {
        if (!disabled && e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          startEdit();
        }
      }}
      onPointerDown={(e) => {
        if (disabled || e.button !== 0) return;
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        drag.current = { x0: e.clientX, v0: value, moved: false, last: value };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const k = e.shiftKey ? 10 : e.ctrlKey ? 0.1 : 1;
        const v = round(clamp(d.v0 + (e.clientX - d.x0) * step * k));
        if (v === d.last && d.moved) return;
        d.moved = d.moved || e.clientX !== d.x0;
        d.last = v;
        setLive(v);
        props.onPreview?.(v);
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        setLive(null);
        if (!d) return;
        if (d.moved && d.last !== d.v0) props.onCommit(d.last);
        else if (!d.moved) startEdit();
        else props.onCancel?.();
      }}
    >
      {round(shown).toFixed(digits)}
      {unit}
    </span>
  );
}
