import { useState } from "react";
import type { ReactNode } from "react";
import type { DraftWarning, VoiceStatus } from "../data/mockData";
import { CheckIcon, FolderIcon, SparkleIcon } from "./icons";

// 生成中などのローディング表示
export function LoadingView({
  title,
  message,
  progress,
  onCancel,
}: {
  title: string;
  message?: string;
  progress?: number;
  onCancel?: () => void;
}) {
  return (
    <div className="card text-center" style={{ maxWidth: 520, margin: "var(--gap-xl) auto" }}>
      <div className="yuko-avatar" aria-hidden="true" style={{ margin: "0 auto var(--gap)" }}>
        <span className="yuko-avatar-face">ゆうこ</span>
      </div>
      <h2 className="section-title">{title}</h2>
      {message && <p className="page-desc text-pretty">{message}</p>}
      {typeof progress === "number" && (
        <div className="progress mt" aria-hidden="true">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
      )}
      {onCancel && (
        <button className="btn btn-ghost mt-lg" onClick={onCancel}>
          キャンセル
        </button>
      )}
    </div>
  );
}

// 一覧などが空のときの表示
export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="card text-center text-muted" style={{ padding: "var(--gap-xl)" }}>
      <div style={{ lineHeight: 1 }} aria-hidden="true">
        <FolderIcon size={40} style={{ opacity: 0.55 }} />
      </div>
      <h3 className="section-title" style={{ marginTop: "var(--gap-sm)" }}>
        {title}
      </h3>
      {message && <p className="text-sm text-pretty">{message}</p>}
      {action && <div className="mt">{action}</div>}
    </div>
  );
}

// 自動補正・確認の警告バナー（件数＋対応内容、詳細を開ける）
export function WarningBanner({ warnings }: { warnings: DraftWarning[] }) {
  const [open, setOpen] = useState(false);
  if (warnings.length === 0) return null;
  const autoFixed = warnings.filter((w) => w.severity === "info").length;
  const needAttention = warnings.filter((w) => w.severity === "warning").length;

  return (
    <div className="notice notice-warn mb" style={{ flexDirection: "column", alignItems: "stretch" }}>
      <div className="row-between">
        <span className="row gap-sm">
          <SparkleIcon size={18} />
          {autoFixed}件を自動で調整しました。
          {needAttention > 0 ? `${needAttention}件は確認が必要です。` : "確認が必要な項目はありません。"}
        </span>
        <button className="btn btn-ghost btn-icon text-sm" onClick={() => setOpen(!open)}>
          {open ? "閉じる" : "詳細を見る"}
        </button>
      </div>
      {open && (
        <ul style={{ margin: "var(--gap-sm) 0 0", paddingLeft: "1.2em" }}>
          {warnings.map((w, i) => (
            <li key={i} className="text-sm" style={{ marginBottom: 4 }}>
              {w.severity === "warning" ? "⚠ " : "✓ "}
              {w.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// 読み上げの声（ナレーション）の作成状態バッジ
const voiceStatusLabel: Record<VoiceStatus, string> = {
  none: "声：未作成",
  pending: "声：作成中",
  generated: "声：作成済み",
  failed: "声：作り直せます",
};

export function VoiceStatusBadge({ status }: { status: VoiceStatus }) {
  const label = voiceStatusLabel[status];
  if (status === "generated") {
    return (
      <span className="badge badge-teal">
        <CheckIcon size={12} />
        {label}
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="badge" style={{ background: "var(--color-danger-soft)", color: "var(--color-danger)" }}>
        {label}
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="badge" style={{ background: "var(--color-yellow)", color: "var(--color-warn)" }}>
        {label}
      </span>
    );
  }
  return <span className="badge badge-gray">{label}</span>;
}

// エラー表示（原因でなく「次の行動」を提示する）
export function ErrorView({
  title,
  message,
  actions,
}: {
  title: string;
  message: string;
  actions: { label: string; onClick: () => void; primary?: boolean }[];
}) {
  return (
    <div className="card text-center" style={{ maxWidth: 520, margin: "var(--gap-xl) auto" }}>
      <div
        className="action-card-icon"
        style={{
          background: "var(--color-danger-soft)",
          color: "var(--color-danger)",
          margin: "0 auto var(--gap)",
          width: 56,
          height: 56,
          fontSize: 28,
          fontWeight: 700,
        }}
        aria-hidden="true"
      >
        !
      </div>
      <h2 className="section-title">{title}</h2>
      <p className="page-desc text-pretty">{message}</p>
      <div className="row gap-sm mt-lg" style={{ justifyContent: "center", flexWrap: "wrap" }}>
        {actions.map((a) => (
          <button
            key={a.label}
            className={`btn ${a.primary ? "btn-primary" : "btn-secondary"}`}
            onClick={a.onClick}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
