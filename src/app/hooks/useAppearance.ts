// 画面の見た目（明るい／暗い）の切り替え（ADR-0039・#1108）。
//
// ⚠️ **暗くするのはアプリの外枠だけ**＝`layoutScene` / `layoutToSvg` が描く**動画の絵は変えない**
// （ADR-0001）。ここが触るのは `<html>` の `data-theme` だけで、キャンバスの中身には一切届かない。
//
// ⚠️ **「OS に合わせる」も JS で解いて `data-theme` に落とす**＝CSS 側の暗い版を**1か所**に保つため。
// `@media (prefers-color-scheme: dark)` と `[data-theme="dark"]` の両方に同じ値を書くと、
// **25 個のトークンを二重に持つ**ことになり、片方だけ直す事故が必ず起きる（この repo の頻出の型）。
// だから `<html data-theme>` は常に `"light"` か `"dark"` のどちらかになり、
// **「OS に合わせる」は覚えの側の値**（`system`）として持つ。
import { useCallback, useEffect, useState } from "react";
import { getAppearance, setAppearance, type Appearance } from "../../infrastructure/appSettings";

/** 同じタブの他の使い手へ知らせる合図（`storage` は同じタブに届かない）。 */
const EVENT = "stario:appearance-changed";
/** OS が暗い見た目かを聞く問い合わせ。 */
const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * OS が暗い見た目かどうか。
 *
 * ⚠️ **`matchMedia` が無い場でも落ちない**（古い WebView・テスト環境）＝分からないときは明るい側。
 */
export function prefersDark(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(DARK_QUERY).matches
      : false;
  } catch {
    return false;
  }
}

/**
 * 好み（`system` / `light` / `dark`）を、実際に当てる見た目（`light` / `dark`）へ解く。
 *
 * ⚠️ **純粋関数として出す**＝`system` の解き方はここだけ。画面や CSS で解き直さない。
 */
export function resolveAppearance(pref: Appearance, osIsDark: boolean): "light" | "dark" {
  if (pref === "system") return osIsDark ? "dark" : "light";
  return pref;
}

/** いまの好み（このセッションの正）。⚠️ 覚えられなくても、その場では効かせる（§2-5）。 */
let current: Appearance = getAppearance();

/** `<html>` へ当てる。⚠️ **属性は必ずどちらかが入る**＝CSS の暗い版を1か所に保つため。 */
function apply(): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", resolveAppearance(current, prefersDark()));
}

// 読み込んだ時点で当てる（最初の描画から正しい見た目にする）。
apply();

/**
 * 見た目の好みと、その切り替え。
 *
 * ⚠️ **OS の設定が途中で変わったら追いつく**＝「OS に合わせる」を選んでいる人は、
 * OS を暗くした瞬間にアプリも暗くなるのが期待どおり（開き直しを強いない）。
 */
export function useAppearance(): [Appearance, (next: Appearance) => void] {
  const [pref, setPrefState] = useState(current);

  useEffect(() => {
    const sync = (): void => { setPrefState(current); apply(); };
    window.addEventListener(EVENT, sync);
    let mql: MediaQueryList | null = null;
    try {
      mql = typeof window.matchMedia === "function" ? window.matchMedia(DARK_QUERY) : null;
      mql?.addEventListener("change", sync);
    } catch { /* 問い合わせられない場では OS 追従だけ諦める（切り替えは効く） */ }
    // 待っている間に別の入口が変えていたら追いつく。
    sync();
    return () => {
      window.removeEventListener(EVENT, sync);
      try { mql?.removeEventListener("change", sync); } catch { /* 解除できなくても落とさない */ }
    };
  }, []);

  const set = useCallback((next: Appearance) => {
    current = next;
    setAppearance(next);
    apply();
    window.dispatchEvent(new CustomEvent(EVENT));
  }, []);

  return [pref, set];
}

/** テスト用＝この場の正を入れ直す（`localStorage.clear()` だけでは足りない）。 */
export function resetAppearanceTo(next: Appearance): void {
  current = next;
  apply();
}
