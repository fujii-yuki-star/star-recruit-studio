// 左の帯（メニュー）を畳んでいるかの記憶（#1103）。
//
// ⚠️ **畳んだら完全に隠す**（利用者決定・2026-09-10）＝アイコンだけ残す形（業界の型）ではなく、
// **幅0にして作業場を最大にする**。動機は「メインの作業場を広げたい」で、248px は 1280px 幅の
// 画面で 19% を占めていた。型から外れる判断なので、経緯を #1103 に記録してある。
//
// ⚠️ **戻す道は絶対に消さない**（ADR-0033 決定6/8）＝隠した側には**細い取っ手**を必ず出し、
// キーボードだけでも辿り着いて押せるようにする（`<button>` で出す）。
//
// ⚠️ **画面の好みなので覚える**＝`localStorage`（プロジェクトの schema には入れない・§5）。
// 仕組みは `booleanPref` に寄せる（`useSafeAreaPref` と同じ形を二重に持たない）。
import { createBooleanPref } from "./booleanPref";

/** 覚えの置き場。⚠️ **気軽に変えない**＝変えると利用者の記憶が消える。 */
export const SIDEBAR_COLLAPSED_KEY = "shell.sidebarCollapsed";
/**
 * 覚えが無いときの姿＝**帯は出ている**。
 *
 * ⚠️ **名前を付けて外へ出す**（レビュー 🟡）＝呼び出しの中に `false` と書いたままだと、
 * 検査が毎回 `resetSidebarCollapsedTo(false)` で正を上書きしてから描くので、
 * **この既定を一度も通らない**（`true` に書き換えても全部緑のまま）。
 * 「覚えの読み直しを1バイトも通っていなかった」のと**同じ型の穴**。
 */
export const SIDEBAR_COLLAPSED_DEFAULT = false;

const pref = createBooleanPref(
  SIDEBAR_COLLAPSED_KEY,
  "stario:sidebar-collapsed-changed",
  SIDEBAR_COLLAPSED_DEFAULT,
);

/** 左の帯を畳んでいるかと、その切り替え。 */
export const useSidebarCollapsed = pref.usePref;

/** テスト用＝この場の正を入れ直す。 */
export const resetSidebarCollapsedTo = pref.resetTo;
