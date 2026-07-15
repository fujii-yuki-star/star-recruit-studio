import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { hexToHsv, hsvToHex, normalizeHex, type Hsv } from "../../domain/format/color";

// 自前カラーピッカー（#525-6）。ブラウザ標準の <input type="color"> はポップアップ位置を制御できず、
// 詳細編集サイドバー（overflow:auto）や画面右端で見切れるため、画面内に必ず収まる自前ポップオーバーへ置換する。
// 目で選べる面（鮮やかさ×明るさ）＋色相バー＋定番パレット＋色コード欄。値は #rrggbb で親へ返す（既存 onChange 互換）。

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

// 定番色（白黒＋よく使う12色）。目で早く選ぶための下段パレット。
const PRESET_COLORS = [
  "#ffffff", "#d1d5db", "#9ca3af", "#4b5563", "#1f2937", "#000000",
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6",
  "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e", "#a3623b", "#14b8a6",
];

// ポップオーバーの見積りサイズ（画面端クランプ用の初期値。実測できれば実測を優先）。
const POPOVER_W = 236;
const POPOVER_H = 300;

interface Props {
  /** 現在の色（#rrggbb）。 */
  value: string;
  /** 色が変わるたびに #rrggbb で通知（標準 input と同じく随時発火）。 */
  onChange: (hex: string) => void;
  /** トリガー（見本）の追加クラス。 */
  className?: string;
  /** 読み上げ用ラベル。 */
  ariaLabel?: string;
}

export function ColorPicker({ value, onChange, className, ariaLabel = "色を選ぶ" }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // 開いている間の作業用 HSV（value からの往復で色相が飛ばないよう保持）。開くたびに現在値へ同期する。
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value) ?? { h: 0, s: 0, v: 0 });
  const [codeText, setCodeText] = useState(value);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const draggingSv = useRef(false);
  const draggingHue = useRef(false);

  const openPicker = () => {
    setHsv(hexToHsv(value) ?? { h: 0, s: 0, v: 0 }); // 開いた瞬間の値を取り込む
    setCodeText(value);
    setPos(null); // 位置は開いた後に実測して確定（下の layout effect）
    setOpen(true);
  };

  // 位置決め：トリガーの実座標→ビューポート内へクランプ。右端では左寄せ・下がはみ出れば上に開く。
  // fixed＋body ポータルなので祖先の overflow に切られない（サイドバーでも画面内に必ず収まる）。
  useLayoutEffect(() => {
    if (!open) return;
    const tr = triggerRef.current?.getBoundingClientRect();
    if (!tr) return;
    const pw = popRef.current?.offsetWidth || POPOVER_W;
    const ph = popRef.current?.offsetHeight || POPOVER_H;
    const pad = 8;
    let left = tr.left;
    if (left + pw > window.innerWidth - pad) left = window.innerWidth - pw - pad;
    left = Math.max(pad, left);
    let top = tr.bottom + 4;
    if (top + ph > window.innerHeight - pad) top = tr.top - ph - 4; // 下に入らなければ上へ
    top = Math.max(pad, top);
    setPos({ left, top });
  }, [open]);

  // 外側クリック / Escape で閉じる（capture でトリガー自身の再クリックと二重発火しない）。
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const applyHsv = (next: Hsv) => {
    setHsv(next);
    const hex = hsvToHex(next);
    setCodeText(hex);
    onChange(hex);
  };
  // パレット等・外部からの確定：作業値・コード欄・親をすべてそろえる（コード欄も新色に同期する）。
  const commitHex = (hex: string) => {
    const n = normalizeHex(hex);
    if (!n) return;
    setHsv(hexToHsv(n) ?? { h: 0, s: 0, v: 0 });
    setCodeText(n);
    onChange(n);
  };

  // 鮮やかさ×明るさの面：横=鮮やかさ(0..1)、縦=明るさ(1..0)。
  const applySvAt = (clientX: number, clientY: number) => {
    const r = svRef.current?.getBoundingClientRect();
    if (!r || r.width === 0 || r.height === 0) return;
    const s = clamp((clientX - r.left) / r.width, 0, 1);
    const v = clamp(1 - (clientY - r.top) / r.height, 0, 1);
    applyHsv({ h: hsv.h, s, v });
  };
  // 色相バー：横=色相(0..360)。
  const applyHueAt = (clientX: number) => {
    const r = hueRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    applyHsv({ h: clamp((clientX - r.left) / r.width, 0, 1) * 360, s: hsv.s, v: hsv.v });
  };

  const hueColor = `hsl(${hsv.h}, 100%, 50%)`;
  const currentHex = hsvToHex(hsv);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={className}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openPicker())}
        style={{
          width: 40, height: 26, padding: 0, borderRadius: 6, cursor: "pointer",
          border: "1px solid var(--color-border-strong)", background: value,
          boxShadow: "inset 0 0 0 2px var(--color-surface)", // 明るい色でも枠が見えるよう内側に地色線
        }}
      />
      {open && createPortal(
        <div
          ref={popRef}
          role="dialog"
          aria-label={ariaLabel}
          style={{
            position: "fixed", left: pos?.left ?? -9999, top: pos?.top ?? -9999,
            visibility: pos ? "visible" : "hidden", zIndex: 1000,
            width: POPOVER_W, boxSizing: "border-box", padding: 10,
            background: "var(--color-surface)", border: "1px solid var(--color-border-strong)",
            borderRadius: 10, boxShadow: "0 8px 28px rgba(0,0,0,0.28)",
            display: "flex", flexDirection: "column", gap: 8,
          }}
        >
          {/* 鮮やかさ×明るさの面 */}
          <div
            ref={svRef}
            data-testid="cp-sv"
            onPointerDown={(e) => {
              e.preventDefault();
              draggingSv.current = true;
              try { svRef.current?.setPointerCapture(e.pointerId); } catch { /* noop */ }
              applySvAt(e.clientX, e.clientY);
            }}
            onPointerMove={(e) => { if (draggingSv.current) applySvAt(e.clientX, e.clientY); }}
            onPointerUp={(e) => {
              draggingSv.current = false;
              try { svRef.current?.releasePointerCapture(e.pointerId); } catch { /* noop */ }
            }}
            style={{
              position: "relative", width: "100%", height: 130, borderRadius: 6, cursor: "crosshair",
              touchAction: "none",
              background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueColor})`,
            }}
          >
            <div
              style={{
                position: "absolute", left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`,
                width: 14, height: 14, marginLeft: -7, marginTop: -7, borderRadius: "50%",
                border: "2px solid #fff", boxShadow: "0 0 0 1px rgba(0,0,0,0.5)", pointerEvents: "none",
                background: currentHex,
              }}
            />
          </div>

          {/* 色相バー */}
          <div
            ref={hueRef}
            data-testid="cp-hue"
            onPointerDown={(e) => {
              e.preventDefault();
              draggingHue.current = true;
              try { hueRef.current?.setPointerCapture(e.pointerId); } catch { /* noop */ }
              applyHueAt(e.clientX);
            }}
            onPointerMove={(e) => { if (draggingHue.current) applyHueAt(e.clientX); }}
            onPointerUp={(e) => {
              draggingHue.current = false;
              try { hueRef.current?.releasePointerCapture(e.pointerId); } catch { /* noop */ }
            }}
            style={{
              position: "relative", width: "100%", height: 14, borderRadius: 7, cursor: "ew-resize",
              touchAction: "none",
              background: "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)",
            }}
          >
            <div
              style={{
                position: "absolute", left: `${(hsv.h / 360) * 100}%`, top: "50%",
                width: 14, height: 14, marginLeft: -7, marginTop: -7, borderRadius: "50%",
                border: "2px solid #fff", boxShadow: "0 0 0 1px rgba(0,0,0,0.5)", pointerEvents: "none",
                background: hueColor,
              }}
            />
          </div>

          {/* 定番パレット */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(9, 1fr)", gap: 4 }}>
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`色 ${c}`}
                onClick={() => commitHex(c)}
                style={{
                  width: "100%", aspectRatio: "1 / 1", padding: 0, borderRadius: 4, cursor: "pointer",
                  background: c,
                  border: normalizeHex(c) === normalizeHex(currentHex)
                    ? "2px solid var(--color-primary)" : "1px solid var(--color-border)",
                }}
              />
            ))}
          </div>

          {/* 色コード欄（技術用語 HEX は出さず「色コード」表記） */}
          <label className="col" style={{ gap: 2 }}>
            <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>色コード</span>
            <input
              className="input"
              value={codeText}
              aria-label="色コード"
              spellCheck={false}
              onChange={(e) => {
                const raw = e.target.value;
                setCodeText(raw); // 入力中は生の文字を保持（3桁など打ちかけを壊さない）
                const n = normalizeHex(raw);
                if (n) { setHsv(hexToHsv(n) ?? { h: 0, s: 0, v: 0 }); onChange(n); } // 有効ならコード欄以外を更新
              }}
              onBlur={() => setCodeText(currentHex)} // 打ちかけ/無効のまま抜けたら現在色の表記へそろえる
              style={{ width: "100%", boxSizing: "border-box", fontFamily: "monospace" }}
            />
          </label>
        </div>,
        document.body,
      )}
    </>
  );
}
