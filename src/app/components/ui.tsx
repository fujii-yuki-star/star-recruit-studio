import type { ReactNode } from "react";

interface PageHeadProps {
  title: string;
  desc?: string;
  actions?: ReactNode;
}

export function PageHead({ title, desc, actions }: PageHeadProps) {
  return (
    <div className="row-between page-head">
      <div>
        <h1 className="page-title text-balance">{title}</h1>
        {desc && <p className="page-desc text-pretty">{desc}</p>}
      </div>
      {actions && <div className="row gap-sm">{actions}</div>}
    </div>
  );
}

interface SwitchProps {
  on: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export function Switch({ on, onChange, label, disabled = false }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={`switch${on ? " on" : ""}`}
      style={disabled ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
      onClick={() => onChange(!on)}
    >
      <span className="switch-knob" />
    </button>
  );
}

interface SeekbarProps {
  value: number; // 0-100
}

export function Seekbar({ value }: SeekbarProps) {
  return (
    <div className="seekbar" role="slider" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} tabIndex={0}>
      <div className="seekbar-fill" style={{ width: `${value}%` }} />
      <div className="seekbar-knob" style={{ left: `${value}%` }} />
    </div>
  );
}
