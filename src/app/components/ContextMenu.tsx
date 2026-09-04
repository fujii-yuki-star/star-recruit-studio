// 右クリックで出す操作メニュー（#512 後のレイアウト改善・ADR-0033）。**見た目と閉じ方だけ**を持つ部品で、
// 何ができるか（項目）は使う側が決める。
//
// **常時ボタンを並べない**ための受け皿＝行に操作ボタンを並べると、行が文字だらけになり本体（帯）が読めない
// （利用者指摘 2026-08-03）。操作はここへ畳み、行には**状態**（出さない・固定中）だけを残す。
//
// 自由配置エディタ（`FreeLayoutOverlay`）が持っていた同じ作りをここへ出して**1つにする**（§6）＝
// 画面ごとに閉じ方や見た目が割れない。

import { useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEscapeReceiver } from "../hooks/escapeOwners";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useKeepInViewport } from "../hooks/useKeepInViewport";

export interface ContextMenuItem {
  label: string;
  /** 消す等の取り返しにくい操作（色を変える）。 */
  danger?: boolean;
  /** いまはできない操作（押せなくする）。**理由を必ず添える**＝押せないのに理由が無い、を作らない（§2-5）。 */
  disabled?: boolean;
  disabledHint?: string;
  onSelect: () => void;
}


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
  // ⚠️ **処理は名簿へ預ける**（#965）＝メニューを開いたまま別の受け手（削除の確認など）が出ると、
  // 自分で購読していたときは1回の `Escape` で両方いっぺんに閉じた（「1段ずつはがす」から外れる）。
  // ⚠️ **項目が無いときは名乗らない**＝下の早い `return` で**描かれないのに順番を占める**（#965 レビュー）。
  useEscapeReceiver(items.length > 0, () => {
    onClose();
    return true;
  });
  // ⚠️ **`role="menu"` を名乗るなら、その作法を持つ**（#986）＝
  // 焦点移動も矢印キーも `tabIndex` も無いまま名乗っていた。
  // `FontPicker` は**逆の判断**（一式が無いのでロールを付けない）を自分で書いており、割れていた。
  // ここは**作法を足す側**にそろえる（メニューは矢印で選べることが強く期待される）。
  // ⚠️ **覆いは `onPointerDown` しか見ない**＝キーボードでは背後へ `Tab` で抜けて Enter で起動できた。
  const menuRef = useRef<HTMLDivElement>(null);
  useFocusTrap(items.length > 0, menuRef);
  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    if (buttons.length === 0) return;
    e.preventDefault();
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === "Home" ? 0
      : e.key === "End" ? buttons.length - 1
      : e.key === "ArrowDown" ? (at + 1 + buttons.length) % buttons.length
      : (at - 1 + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  // ⚠️ **大きさは見積もらず、実物を測って寄せる**（#1023＝実機の指摘）＝もとは
  // 「1項目 34px × 件数 ＋ 余白8px」で高さを見積もっていたが、**実際は見積もりより大きくなる**
  //（長い項目が2行に折り返す・余白や枠の実寸が違う）ので、**寄せたつもりで見切れて**いた。
  // 見切れると、そこにある項目（「この欄を閉じる」「下へ移す」など）に**永久に手が届かない**。
  const { style: fit } = useKeepInViewport(menuRef, x, y, items.length > 0);

  if (items.length === 0) return null;

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
        ref={menuRef}
        onKeyDown={onMenuKey}
        role="menu"
        style={{
          position: "fixed",
          ...fit,
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
