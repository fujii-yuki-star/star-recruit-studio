import { useEffect, useState } from "react";
import { FONT_CATALOG, DEFAULT_FONT_ID, fontFamilyForId, type FontId } from "../../domain/font/fontCatalog";

// 動画フォントの選択（プルダウン）。各選択肢を「そのフォントの字形」で表示して直感的に選べるようにする。
// native <select> は option 個別の font 装飾ができないため、開閉する自前のドロップダウンにする。
// ※ ARIA: listbox/option ロールは矢印キー移動など一式の実装が前提なので使わず、ボタン列＋aria-current で
//   選択中を示す（PR#161 レビュー）。Esc・背景クリックで閉じる。
export function FontPicker({ value, onChange }: { value: FontId | null | undefined; onChange: (id: FontId) => void }) {
  const [open, setOpen] = useState(false);
  const currentId: FontId = value && FONT_CATALOG.some((f) => f.id === value) ? value : DEFAULT_FONT_ID;
  const current = FONT_CATALOG.find((f) => f.id === currentId) ?? FONT_CATALOG[0];

  // 開いている間は Esc で閉じる（キーボードのみのユーザーがフォーカスを外さず閉じられるように）。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        className="select"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        style={{ width: "100%", textAlign: "left", cursor: "pointer", fontFamily: fontFamilyForId(current.id) }}
      >
        {current.label}
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
            {FONT_CATALOG.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  aria-current={f.id === currentId ? "true" : undefined}
                  onClick={() => { onChange(f.id); setOpen(false); }}
                  style={{
                    display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8,
                    width: "100%", textAlign: "left", padding: "8px 10px", border: "none",
                    borderRadius: "calc(var(--radius) - 2px)", cursor: "pointer",
                    background: f.id === currentId ? "var(--color-primary-soft)" : "transparent",
                    fontFamily: fontFamilyForId(f.id),
                  }}
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
