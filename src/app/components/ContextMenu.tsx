// 右クリックで出す操作メニュー（#512 後のレイアウト改善・ADR-0033）。**見た目と閉じ方だけ**を持つ部品で、
// 何ができるか（項目）は使う側が決める。
//
// **常時ボタンを並べない**ための受け皿＝行に操作ボタンを並べると、行が文字だらけになり本体（帯）が読めない
// （利用者指摘 2026-08-03）。操作はここへ畳み、行には**状態**（出さない・固定中）だけを残す。
//
// 自由配置エディタ（`FreeLayoutOverlay`）が持っていた同じ作りをここへ出して**1つにする**（§6）＝
// 画面ごとに閉じ方や見た目が割れない。
import { useEffect } from "react";
import { useEscapeOwner } from "../hooks/escapeOwners";

export interface ContextMenuItem {
  label: string;
  /** 消す等の取り返しにくい操作（色を変える）。 */
  danger?: boolean;
  /** いまはできない操作（押せなくする）。**理由を必ず添える**＝押せないのに理由が無い、を作らない（§2-5）。 */
  disabled?: boolean;
  disabledHint?: string;
  onSelect: () => void;
}

/** はみ出さないように寄せるための見込みサイズ（実測ではなく上限の目安）。 */
const MENU_W = 176;
const ITEM_H = 34;
const MENU_PAD = 8;

/**
 * 右クリックの位置に出すメニュー。**画面の外へ出さない**ように寄せる（出ると押せない＝§2-5）。
 * 外側を押す・`Escape`・項目を選ぶ、のいずれでも閉じる（開いたまま戻れない、を作らない）。
 */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}): React.ReactElement | null {
  // **`Escape` を受け持っている間は名乗る**（#701 レビュー）＝外側（画面）の `Escape` が同時に走って
  // 「メニューを閉じただけなのに選択も解ける」を作らない。
  useEscapeOwner(true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (items.length === 0) return null;
  // 画面幅・高さは実行時にしか分からないので、ここで寄せる（開く側に同じ計算を書かせない）。
  const maxX = typeof window !== "undefined" ? window.innerWidth - MENU_W : x;
  const maxY = typeof window !== "undefined" ? window.innerHeight - (items.length * ITEM_H + MENU_PAD) : y;
  const left = Math.max(0, Math.min(x, Math.max(0, maxX)));
  const top = Math.max(0, Math.min(y, Math.max(0, maxY)));

  return (
    <>
      {/* 外側のクリック/右クリックで閉じる透明の覆い。 */}
      <div
        style={{ position: "fixed", inset: 0, zIndex: 50 }}
        onPointerDown={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        role="menu"
        style={{
          position: "fixed",
          left,
          top,
          zIndex: 51,
          background: "#fff",
          border: "1px solid rgba(0,0,0,0.15)",
          borderRadius: 8,
          boxShadow: "0 6px 24px rgba(0,0,0,0.18)",
          padding: 4,
          minWidth: 140,
        }}
      >
        {items.map((it) => (
          <button
            key={it.label}
            role="menuitem"
            className="btn btn-ghost text-sm"
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              color: it.danger ? "var(--color-danger)" : undefined,
            }}
            disabled={it.disabled}
            title={it.disabled ? it.disabledHint : undefined}
            onClick={() => {
              it.onSelect();
              onClose();
            }}
          >
            {it.label}
          </button>
        ))}
      </div>
    </>
  );
}
