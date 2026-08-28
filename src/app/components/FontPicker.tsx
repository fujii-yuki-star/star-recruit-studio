import { useEffect, useState } from "react";
import { claimEscape } from "../hooks/escapeOwners";
import { FONT_CATALOG, DEFAULT_FONT_ID, fontFamilyForId, isKnownFontId, type FontId } from "../../domain/font/fontCatalog";
import { useProjectStore } from "../store/projectStore";

// 動画フォントの選択（プルダウン）。各選択肢を「そのフォントの字形」で表示して直感的に選べるようにする。
// native <select> は option 個別の font 装飾ができないため、開閉する自前のドロップダウンにする。
// ※ ARIA: listbox/option ロールは矢印キー移動など一式の実装が前提なので使わず、ボタン列＋aria-current で
//   選択中を示す（PR#161 レビュー）。Esc・背景クリックで閉じる。
// allowInherit=true のとき、先頭に「動画全体に合わせる」(=null) を出す（場面ごとのフォント＝null は継承）。
const INHERIT_LABEL = "動画全体に合わせる";

export function FontPicker({
  value,
  onChange,
  allowInherit,
  disabled,
  title,
}: {
  value: FontId | null | undefined;
  /** null は「継承（動画全体に合わせる）」。allowInherit=false のときは null を返さない。 */
  onChange: (id: FontId | null) => void;
  allowInherit?: boolean;
  /**
   * 押せないとき（書き出し中・固定した列など・#720）。**受け口が無いと、渡された `disabled` は
   * 黙って捨てられる**＝触れてしまい、あとから断られる。
   */
  disabled?: boolean;
  /** 押せない理由（指したときに出す）。 */
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  // ⚠️ **一覧は自分で store から読む**（α-6 出口監査 🔴1）＝この部品の呼び出しは6か所あり、
  // 呼ぶ側から渡す形にすると**配り忘れた所だけ同梱3種**になる（ADR-0036 の色と同じ流儀）。
  const userFonts = useProjectStore((s) => s.userFonts);
  // 同梱＋持ち込みを1つの一覧にする（`note` は持ち込みには無いので空）。
  const choices: { id: FontId; label: string; note?: string }[] = [
    ...FONT_CATALOG.map((f) => ({ id: f.id as FontId, label: f.label, note: f.note })),
    ...userFonts.map((f) => ({ id: f.id as FontId, label: f.displayName, note: "手持ち" })),
  ];
  // ⚠️ **持ち込みフォントも「既知」として扱う**（🔴1）＝`FONT_CATALOG` だけを見ていたため、
  // 既に持ち込みフォントが入っている文書で**実際と違う字体名を見せ**、一度触ると黙って上書きしていた。
  const known = isKnownFontId(value) ? (value as FontId) : null;
  // allowInherit のとき、未選択/不明は「動画全体に合わせる」。そうでなければ既定フォント表示。
  const isInherit = allowInherit ? known === null : false;
  const currentId: FontId = known ?? DEFAULT_FONT_ID;
  const current = choices.find((f) => f.id === currentId) ?? choices[0];

  // **開いている最中に押せなくなったら閉じる**（#730 レビュー・`ColorPicker` と同じ理由＝同概念同挙動）。
  // `disabled` は見本のボタンにしか効かないので、開いたままだと一覧は選べてしまい、選んでから断られる。
  // 閉じる仕掛け（覆いの `onClick`）はクリック待ちなので、**キーボードで開いて別のボタンを押した**ときは働かない。
  // effect ではなく**レンダー中の調整**にする理由は `ColorPicker` と同じ。
  if (disabled && open) setOpen(false);

  // 開いている間は Esc で閉じる（キーボードのみのユーザーがフォーカスを外さず閉じられるように）。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const release = claimEscape(); // 開いている間は `Escape` を受け持つ（外側の後始末を同時に走らせない・#701）
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      release();
    };
  }, [open]);

  const optionStyle = (active: boolean, family?: string) => ({
    display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8,
    width: "100%", textAlign: "left" as const, padding: "8px 10px", border: "none",
    borderRadius: "calc(var(--radius) - 2px)", cursor: "pointer",
    background: active ? "var(--color-primary-soft)" : "transparent",
    ...(family ? { fontFamily: family } : {}),
  });

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        className="select"
        disabled={disabled}
        title={title}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        style={{ width: "100%", textAlign: "left", cursor: "pointer", fontFamily: isInherit ? undefined : fontFamilyForId(current.id) }}
      >
        {isInherit ? INHERIT_LABEL : current.label}
      </button>
      {open && (
        <>
          {/* クリックで閉じる透明な背景 */}
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 30 }} aria-hidden />
          <ul
            style={{
              position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 31,
              margin: 0, padding: 4, listStyle: "none", maxHeight: 280, overflowY: "auto",
              background: "var(--color-surface, #fff)", border: "1px solid var(--color-border)",
              borderRadius: "var(--radius)", boxShadow: "var(--shadow-md, 0 6px 18px rgba(0,0,0,.14))",
            }}
          >
            {allowInherit && (
              <li key="__inherit__">
                <button
                  type="button"
                  aria-current={isInherit ? "true" : undefined}
                  onClick={() => { onChange(null); setOpen(false); }}
                  style={optionStyle(isInherit)}
                >
                  <span>{INHERIT_LABEL}</span>
                  <span className="text-sm text-muted">既定</span>
                </button>
              </li>
            )}
            {choices.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  aria-current={!isInherit && f.id === currentId ? "true" : undefined}
                  onClick={() => { onChange(f.id); setOpen(false); }}
                  style={optionStyle(!isInherit && f.id === currentId, fontFamilyForId(f.id))}
                >
                  <span>{f.label}</span>
                  <span className="text-sm text-muted">{f.note}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
