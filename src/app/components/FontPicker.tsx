import { useState } from "react";
import { useEscapeReceiver } from "../hooks/escapeOwners";
import { FONT_CATALOG, DEFAULT_FONT_ID, fontFamilyForId, isKnownFontId, type FontId } from "../../domain/font/fontCatalog";
import { useProjectStore } from "../store/projectStore";
import { FONT_INHERIT_PROJECT_LABEL } from "../uiLabels";

// 動画フォントの選択（プルダウン）。各選択肢を「そのフォントの字形」で表示して直感的に選べるようにする。
// native <select> は option 個別の font 装飾ができないため、開閉する自前のドロップダウンにする。
// ※ ARIA: listbox/option ロールは矢印キー移動など一式の実装が前提なので使わず、ボタン列＋aria-current で
//   選択中を示す（PR#161 レビュー）。Esc・背景クリックで閉じる。
// allowInherit=true のとき、先頭に継承の項目 (=null) を出す（場面ごとのフォント＝null は継承）。
// ⚠️ **継承先の名前は呼ぶ側が決める**（#925）＝どこに合わせるかは場所によって違う
//（`resolveFontId`＝場面の指定 → 動画全体 → 既定）。**場面が自分の指定を持っているとき**に
// 「動画全体に合わせる」と出すと**設定した意味と違うことを言う**（ADR-0026①）。既定は動画全体。
/** 指している字体が一覧に無いとき（起動直後でまだ読めていない／実体が消えている）。 */
const MISSING_LABEL = "取り込んだ文字の形（見つかりません）";

export function FontPicker({
  value,
  onChange,
  allowInherit,
  inheritLabel = FONT_INHERIT_PROJECT_LABEL,
  disabled,
  title,
}: {
  value: FontId | null | undefined;
  /** null は「継承（動画全体に合わせる）」。allowInherit=false のときは null を返さない。 */
  onChange: (id: FontId | null) => void;
  allowInherit?: boolean;
  /**
   * 継承の項目に出す名前（#925）。未指定＝「動画全体に合わせる」。
   * ⚠️ **場面の指定がある場面では「この場面の文字の形に合わせる」を渡す**＝実際の継承先を言う。
   */
  inheritLabel?: string;
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
  // ⚠️ **見つからない字体を、無関係な字体の名前で見せない**（PR #901 レビュー 🟡・§2-5）＝
  // `isKnownFontId` は**形**しか見ないので、①起動直後でまだ一覧を取れていない ②実体が消えている
  //（`listUserFonts` は実体があるものだけ返す）の2つで「既知だが一覧に無い」が起きる。
  // 先頭へ倒すと**具体的に間違った名前**が出て、押した瞬間その字体で上書きされる
  //（🔴1 で直した失敗と同型）。id を保ったまま「見つかりません」と出す。
  // ⚠️ **内部の id は画面に出さない**（§2-3・PR #901 レビュー 🟡）＝`user_font_003` のような
  // 内部の綴りは「見つからない」系の既存 UI（素材・見た目パターン）でも出していない（種別と件数まで）。
  // 選び直せるように、指している値そのものは `title`（指したときの説明）に残す。
  const current = choices.find((f) => f.id === currentId)
    ?? { id: currentId, label: MISSING_LABEL, note: undefined };
  const missing = !choices.some((f) => f.id === currentId);

  // **開いている最中に押せなくなったら閉じる**（#730 レビュー・`ColorPicker` と同じ理由＝同概念同挙動）。
  // `disabled` は見本のボタンにしか効かないので、開いたままだと一覧は選べてしまい、選んでから断られる。
  // 閉じる仕掛け（覆いの `onClick`）はクリック待ちなので、**キーボードで開いて別のボタンを押した**ときは働かない。
  // effect ではなく**レンダー中の調整**にする理由は `ColorPicker` と同じ。
  if (disabled && open) setOpen(false);

  // 開いている間は Esc で閉じる（キーボードのみのユーザーがフォーカスを外さず閉じられるように）。
  // ⚠️ **処理は名簿へ預ける**（#965）＝自分で購読すると、開けたまま別の確認が出たときに
  // 1回の `Escape` で両方いっぺんに閉じる。名乗りは外側の後始末を止める役目も兼ねる（#701）。
  useEscapeReceiver(open, () => {
    setOpen(false);
    return true;
  });

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
        // ⚠️ **内部の綴りを出さない**（α-6 出口監査 🟡・§2-3）＝可視テキストからは外したのに
        // ホバーには `user_font_NNN` がそのまま出ていた。素材・見た目パターンの「見つからない」表示と
        // 同じ流儀（種別と状態だけ・識別子は出さない）にそろえる。
        title={missing ? `${title ? `${title} / ` : ""}${MISSING_LABEL}` : title}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        style={{ width: "100%", textAlign: "left", cursor: "pointer", fontFamily: isInherit || missing ? undefined : fontFamilyForId(current.id) }}
      >
        {isInherit ? inheritLabel : current.label}
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
                  <span>{inheritLabel}</span>
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
