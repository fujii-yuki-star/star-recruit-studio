import { useId, useState, type ReactNode } from "react";
import { useEscapeReceiver } from "../hooks/escapeOwners";

/**
 * 見本の絵つきで選ぶ候補（`ThumbPicker` の1タイル）。
 *
 * ⚠️ **絵は呼ぶ側が作る**＝素材は取り込んだ画像、見た目パターンは `layoutScene` の見本、と
 * 出どころが違う。ここで作り分けると、この部品が素材と見た目パターンの両方を知ることになる。
 */
export type ThumbOption = {
  value: string;
  label: string;
  /** 見本の絵。渡さないと名前だけのタイルになる（絵を出せない候補＝「なし」など）。 */
  thumb?: ReactNode;
  /**
   * 選べない候補（今の動画に合わない・見つからない）。
   *
   * ⚠️ **一覧から消さない**＝いま選ばれているものが消えると、**何が選ばれているのか読めない**
   * 空欄になる（`<option disabled>` で出していた従来の挙動をそのまま引き継ぐ・#415 P2）。
   */
  disabled?: boolean;
  /** 名前の下に出す短い注記（「今の動画に合いません」など）。 */
  note?: string;
};

/**
 * **見て選ぶ**ための格子ピッカー（#1031）。
 *
 * 名前の一覧は、選んでみるまで何が起きるか分からない＝試し打ちになる。押すと候補が
 * **見本の絵つきで並ぶ**格子を出し、絵を見て選べるようにする。
 *
 * ⚠️ **見出しはこの部品が描いて欄と結ぶ**（#1075 の流儀＝`FontPicker` と同じ）。外で
 * `<label htmlFor>` を書く形にすると**結び忘れた所だけ残る**（実際に15か所すべて結ばれていなかった）。
 * ⚠️ **呼び名は `aria-labelledby` で作る**＝`<button>` の呼び名は**中身から作られる**ので、
 * 見出しで指すだけでは「いま何が選ばれているか」と「何の欄か」の両方は読まれない。
 *
 * ⚠️ **候補ぶんの絵は開いている間だけ描く**＝畳んでいる間も全候補を描くと、
 * 見た目パターンの数だけ `layoutScene` が回る（開くまで要らない仕事をしない）。
 * 畳んでいる間に描くのは**いま選ばれている1つだけ**（下の「開く」ボタンの中）。
 */
export function ThumbPicker({
  label,
  value,
  options,
  onChange,
  labelClassName = "field-label",
}: {
  /** 見出し（この部品が描いて欄と結ぶ）。 */
  label: ReactNode;
  /** いま選ばれている候補の `value`。どの候補にも当たらないときは「選ばれていません」と出す。 */
  value: string;
  options: ThumbOption[];
  onChange: (value: string) => void;
  /** 見出しの見た目（周りの欄とそろえるため）。 */
  labelClassName?: string;
}) {
  // 見出しと欄を結ぶ id（React が一意にする＝いくつ並べても重複しない）。
  const fieldId = useId();
  const labelId = `${fieldId}-label`;
  const valueId = `${fieldId}-value`;
  const [open, setOpen] = useState(false);

  // ⚠️ **候補に無い値を指しているときは「なし」と言わない**（下の「選ばれていません」）。
  // 名前の `<select>` だった頃は**先頭の選択肢が選ばれて見えていた**ので、例えば消した素材を
  // 指したままの差し込み口が「なし」と見えていた（実際は `assetRefs` に残っている＝
  // 設定した意味と違うことを言う・ADR-0026①）。⚠️ **内部の綴りは出さない**（§2-3）。
  const current = options.find((o) => o.value === value);

  // 開いている間は Esc で閉じる。処理は名簿へ預ける（#965）＝自分で購読すると、
  // 開けたまま別の確認が出たときに1回の `Escape` で両方いっぺんに閉じる。
  useEscapeReceiver(open, () => {
    setOpen(false);
    return true;
  });

  return (
    <div style={{ position: "relative" }}>
      <label id={labelId} className={labelClassName} htmlFor={fieldId} style={{ display: "block", margin: "0 0 2px" }}>
        {label}
      </label>
      <button
        type="button"
        id={fieldId}
        // ⚠️ **見出しといまの値の両方を読み上げる**（#1075）＝見出しで指すだけだと
        // **いま何が選ばれているかが読まれなくなる**。見出しと値を並べて指す。
        aria-labelledby={`${labelId} ${valueId}`}
        className="select"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        style={{ width: "100%", textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
      >
        {current?.thumb != null && (
          <span aria-hidden style={{ flex: "0 0 auto", width: 40, display: "block" }}>{current.thumb}</span>
        )}
        {/* いまの値にも名前を付ける（自分自身は指せないので、値を包んで名前を付ける）。 */}
        <span id={valueId} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {current?.label ?? "選ばれていません"}
        </span>
      </button>
      {open && (
        <>
          {/* クリックで閉じる透明な背景（`FontPicker` と同じ）。 */}
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 30 }} aria-hidden />
          <div
            style={{
              position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 31,
              padding: 6, maxHeight: 320, overflowY: "auto",
              background: "var(--color-surface, #fff)", border: "1px solid var(--color-border)",
              borderRadius: "var(--radius)", boxShadow: "var(--shadow-md, 0 6px 18px rgba(0,0,0,.14))",
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 6 }}>
              {options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  disabled={o.disabled}
                  aria-current={o.value === value ? "true" : undefined}
                  // ⚠️ **呼び名は名前（と理由）だけにする**＝見本の絵は `layoutScene` の SVG なので、
                  // 何も指定しないと**見本の中の例文**（「見出しの例」等）まで呼び名に混ざる。
                  aria-label={o.note ? `${o.label}（${o.note}）` : o.label}
                  title={o.note ? `${o.label}（${o.note}）` : o.label}
                  // ⚠️ **選び直しは何も起きない**（PR #1085 レビュー）＝名前の `<select>` は同じ値を
                  // 選び直しても変化を出さなかったが、格子は「いま選ばれているタイル」も押せる。
                  // そのまま伝えると**中身が同じまま取り消せるものが積まり**、保存もやり直す
                  //（ADR-0032「何も変わらない操作は積まない」・ADR-0026②）。
                  onClick={() => { if (o.value !== value) onChange(o.value); setOpen(false); }}
                  style={{
                    display: "block", width: "100%", textAlign: "left", padding: 4,
                    border: `1px solid ${o.value === value ? "var(--color-primary)" : "var(--color-border)"}`,
                    borderRadius: "var(--radius-sm)",
                    background: o.value === value ? "var(--color-primary-soft)" : "transparent",
                    cursor: o.disabled ? "not-allowed" : "pointer",
                    opacity: o.disabled ? 0.55 : 1,
                  }}
                >
                  <span aria-hidden style={{ display: "block" }}>{o.thumb}</span>
                  <span className="text-sm" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {o.label}
                  </span>
                  {o.note && <span className="text-faint" style={{ display: "block", fontSize: 11 }}>{o.note}</span>}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
