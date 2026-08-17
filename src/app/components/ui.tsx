import type { ReactNode } from "react";
import { EDITOR_HEADER_CLASS } from "./EditorToolbar";

interface PageHeadProps {
  title: string;
  desc?: string;
  actions?: ReactNode;
  /**
   * 見出しの行を**貼り付ける**（スクロールしても消えない）。
   * 共通ツールバー（#774）を載せる画面だけ立てる＝下へスクロールした時点で
   * 取り消す・保存の状態・戻るが視界から出るなら、置き場を移した意味がない。
   */
  sticky?: boolean;
}

export function PageHead({ title, desc, actions, sticky = false }: PageHeadProps) {
  return (
    <div className={sticky ? `row-between page-head ${EDITOR_HEADER_CLASS}` : "row-between page-head"}>
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
