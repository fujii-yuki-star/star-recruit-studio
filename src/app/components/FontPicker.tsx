import { useState } from "react";
import { FONT_CATALOG, DEFAULT_FONT_ID, fontFamilyForId } from "../../domain/font/fontCatalog";

// 動画フォントの選択（プルダウン）。各選択肢を「そのフォントの字形」で表示して直感的に選べるようにする。
// native <select> は option 個別の font 装飾ができないため、開閉する自前のドロップダウンにする。
export function FontPicker({ value, onChange }: { value: string | null | undefined; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const currentId = FONT_CATALOG.some((f) => f.id === value) ? (value as string) : DEFAULT_FONT_ID;
  const current = FONT_CATALOG.find((f) => f.id === currentId) ?? FONT_CATALOG[0];

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        className="select"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
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
            role="listbox"
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
                  role="option"
                  aria-selected={f.id === currentId}
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
