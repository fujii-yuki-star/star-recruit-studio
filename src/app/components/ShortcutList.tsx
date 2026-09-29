// 近道キーの一覧を出す面（ADR-0048・#1256 c6）。
//
// ⚠️ **閉じ方はメニューと同じ**（外側を押す・`Escape`）＝同じ画面で閉じ方を割らない（ADR-0026②）。
// `Escape` は名簿（`useEscapeReceiver`）に預ける＝開いている間は画面の近道キーも止まる
//（一覧を読んでいる最中に `Space` で再生が始まる、を作らない）。
import { useRef } from "react";
import { useEscapeReceiver } from "../hooks/escapeOwners";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useKeepInViewport } from "../hooks/useKeepInViewport";
import type { Shortcut } from "../timelineShortcuts";

export const SHORTCUT_LIST_TITLE = "キー操作の一覧";

export function ShortcutList({
  x,
  y,
  shortcuts,
  onClose,
}: {
  x: number;
  y: number;
  shortcuts: readonly Shortcut[];
  onClose: () => void;
}): React.ReactElement {
  useEscapeReceiver(true, () => {
    onClose();
    return true;
  });
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(true, ref);
  const { style: fit } = useKeepInViewport(ref, x, y, true);
  return (
    <>
      <div style={{ position: "fixed", inset: 0, zIndex: 50 }} onPointerDown={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-label={SHORTCUT_LIST_TITLE}
        className="shortcut-list"
        style={{ position: "fixed", ...fit, zIndex: 51 }}
      >
        <div className="row-between" style={{ alignItems: "center" }}>
          <strong className="text-sm">{SHORTCUT_LIST_TITLE}</strong>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>閉じる</button>
        </div>
        <table className="shortcut-list-table">
          <tbody>
            {shortcuts.map((s) => (
              <tr key={s.keys}>
                <th scope="row"><kbd>{s.keys}</kbd></th>
                <td>{s.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
