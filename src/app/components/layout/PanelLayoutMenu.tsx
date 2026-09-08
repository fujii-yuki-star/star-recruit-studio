// 欄の出し入れ（ADR-0033 決定6/8）を**見出しの行**に置くためのメニュー（#1032）。
//
// ⚠️ **見えていないボタンは無いのと同じ**（`EditorToolbar` と同じ理由・#774）＝これまで
// 「〈欄〉を表示する」「配置を既定に戻す」は**欄の下**に並べていた。欄は画面の高さいっぱいまで
// 広がるので、編集している間はどの画面でも視界の外にあり、**閉じた欄を戻す道が見えなかった**。
//
// ⚠️ **3画面で同じ出し方にする**（場面編集・見た目パターン編集・タイムライン編集）＝共通の
// 仕組み（`usePanelLayout`）なのに置き場が画面ごとに違うと、同じ概念が別物に見える（ADR-0026②）。
//
// ⚠️ **常時ボタンを並べない**＝閉じた欄の数だけボタンが増えると見出しの行が文字だらけになる。
// 畳み先は右クリックメニューと同じ部品（`ContextMenu`）＝閉じ方・キー操作を作り直さない。
import { useState } from "react";
import { ContextMenu } from "../ContextMenu";
import { PANEL_REGION, addPanelToRegion } from "../../../domain/layout/panelLayout";
import type { PanelId, PanelLayout } from "../../../domain/layout/panelLayout";

/** 押す言葉（§2-3＝「レイアウト」「パネル」は出さない）。 */
export const PANEL_MENU_LABEL = "欄";
/** 配置を戻す（3画面で同じ言葉＝1か所に置く）。 */
export const PANEL_RESET_LABEL = "配置を既定に戻す";

export function PanelLayoutMenu({
  layout,
  panels,
  closed,
  onChange,
  onReset,
}: {
  layout: PanelLayout;
  panels: readonly { id: PanelId; title: string }[];
  closed: readonly PanelId[];
  onChange: (next: PanelLayout) => void;
  onReset: () => void;
}) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const items = [
    ...closed.map((id) => ({
      label: `「${panels.find((p) => p.id === id)?.title ?? id}」を表示する`,
      onSelect: () => onChange(addPanelToRegion(layout, id, PANEL_REGION.left)),
    })),
    { label: PANEL_RESET_LABEL, onSelect: onReset },
  ];
  return (
    <>
      <button
        className="btn btn-ghost text-sm"
        title="閉じた欄を戻す・配置を既定に戻す"
        onClick={(e) => {
          // 押したボタンの真下に出す（右クリックメニューと同じ部品なので位置は渡す側が決める）。
          const r = e.currentTarget.getBoundingClientRect();
          setAt({ x: r.left, y: r.bottom });
        }}
      >
        {PANEL_MENU_LABEL}
        {/* ⚠️ **閉じている欄があることを見た目で言う**＝メニューを開くまで気づけないと、
            「欄が消えた」と思ったまま戻し方に辿り着けない（§2-5＝行き止まりを作らない）。 */}
        {closed.length > 0 && <span className="badge badge-yellow" style={{ marginLeft: "var(--gap-sm)" }}>閉じている {closed.length}</span>}
      </button>
      {at && <ContextMenu x={at.x} y={at.y} items={items} onClose={() => setAt(null)} />}
    </>
  );
}
