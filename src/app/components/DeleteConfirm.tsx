import type { ReactNode } from "react";
import { TrashIcon } from "./icons";

// 削除の確認を全画面で統一する（#410 sub1）。警告 notice ＋ [やめる（ghost・左）] [削除する（btn-danger・右）]。
// 破壊的操作は「右・危険色」で固定＝画面ごとに順序/色が違って「やめるのつもりが削除」を防ぐ。busy 中はラベルを
// 変え両ボタンを無効化（連打/多重削除を防ぐ）。トリガー（「◯◯を削除」ボタン）は配置が画面ごとに違うため各画面が持つ。
export function DeleteConfirm({
  message,
  confirmLabel = "削除する",
  busyLabel = "削除中…",
  busy = false,
  onCancel,
  onConfirm,
  className,
}: {
  /** 何を消すか＋影響（例:「Xを削除しますか？元に戻せません。…」）。 */
  message: ReactNode;
  confirmLabel?: string;
  busyLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  className?: string;
}) {
  return (
    <div className={`notice notice-warn${className ? ` ${className}` : ""}`} role="alert">
      <span>{message}</span>
      <div className="row gap-sm">
        <button className="btn btn-ghost btn-icon" onClick={onCancel} disabled={busy}>
          やめる
        </button>
        <button className="btn btn-danger btn-icon" onClick={onConfirm} disabled={busy}>
          <TrashIcon size={16} />
          {busy ? busyLabel : confirmLabel}
        </button>
      </div>
    </div>
  );
}
