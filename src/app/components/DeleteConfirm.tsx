import { useEffect, useRef, type ReactNode } from "react";
import { TrashIcon } from "./icons";

// 削除の確認を全画面で統一する（#410 sub1）。警告 notice ＋ [やめる（ghost・左）] [削除する（btn-danger・右）]。
// 破壊的操作は「右・危険色」で固定＝画面ごとに順序/色が違って「やめるのつもりが削除」を防ぐ。busy 中はラベルを
// 変え両ボタンを無効化（連打/多重削除を防ぐ）。トリガー（「◯◯を削除」ボタン）は配置が画面ごとに違うため各画面が持つ。
//
// ⚠️ **キーボードで戻れるようにする**（#354）＝以前は Escape も焦点の移動も無く、
// 押した「◯◯を削除」がこの確認に置き換わるので**焦点が本文の先頭へ落ちていた**（実機で確認）。
// キーボードだけの人は、押した直後に**どこにいるか分からなくなり**、Tab で画面の頭から辿り直すことになる。
// ⚠️ **メニューや選択欄には Escape が在った**（`ContextMenu` / `FontPicker` / 各オーバーレイ）のに、
// **確認にだけ無かった**＝「双子の片方だけ直す」。確認は「やめる」に届くことがいちばん大事な場所。
// ⚠️ **13 か所がこの部品を通る**ので、ここで直せば全部に効く（画面ごとに書き足さない）。
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
  const cancelRef = useRef<HTMLButtonElement>(null);

  // ⚠️ **安全な側（やめる）へ焦点を置く**＝Enter をそのまま押しても消えない。
  // 実行中は動かさない（押せないボタンへ焦点を移しても行き止まり）。
  useEffect(() => {
    if (!busy) cancelRef.current?.focus();
  }, [busy]);

  // ⚠️ **Escape でやめる**。実行中は効かせない（両ボタンを無効にしているのと同じ扱い＝走っている処理は止まらない）。
  // ⚠️ **奥へ通さない**（capture＋`stopPropagation`）＝この確認は自由配置の編集面の中にも出るので、
  // 通すと**やめると同時に選択も解除**され、やめたのに画面が変わったように見える。
  useEffect(() => {
    if (busy) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onCancel();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [busy, onCancel]);

  return (
    <div className={`notice notice-warn${className ? ` ${className}` : ""}`} role="alert">
      <span>{message}</span>
      <div className="row gap-sm">
        <button ref={cancelRef} className="btn btn-ghost btn-icon" onClick={onCancel} disabled={busy}>
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
