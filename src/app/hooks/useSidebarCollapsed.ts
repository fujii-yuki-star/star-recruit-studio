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
import type { ScreenId } from "../data/mockData";

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

/** 左の帯を畳んでいるかと、その切り替え（編集画面の外）。 */
export const useSidebarCollapsed = pref.usePref;

/** テスト用＝この場の正を入れ直す。 */
export const resetSidebarCollapsedTo = pref.resetTo;

/**
 * **編集画面**（ADR-0048・#1256 b1）＝ここでは左の帯を**畳んだ状態で始める**。
 *
 * ⚠️ **なぜ別に覚えるか**＝編集画面は作業場を最大にしたい所（1920 の窓で帯は 248px＝12.9%）、
 * 一覧・設定は行き先を選ぶ所で帯が要る。1つの覚えを共有すると、編集画面で畳んだら一覧でも
 * 畳まれたまま・一覧で出したら編集画面でも出たまま、になる。**他社の編集ソフトも編集中は
 * 行き先の帯を持たない**（Clipchamp・Final Cut のサイドバー切替）。
 */
export const SIDEBAR_EDITOR_SCREENS: ReadonlySet<ScreenId> = new Set<ScreenId>(["scene-edit", "timeline-project", "looks-edit"]);

/** 編集画面での覚えの置き場。⚠️ **気軽に変えない**。 */
export const SIDEBAR_COLLAPSED_IN_EDITOR_KEY = "shell.sidebarCollapsedInEditor";
/** 編集画面で覚えが無いときの姿＝**畳んでいる**（作業場を最大にする）。 */
export const SIDEBAR_COLLAPSED_IN_EDITOR_DEFAULT = true;

const editorPref = createBooleanPref(
  SIDEBAR_COLLAPSED_IN_EDITOR_KEY,
  "stario:sidebar-collapsed-in-editor-changed",
  SIDEBAR_COLLAPSED_IN_EDITOR_DEFAULT,
);

/** 編集画面で左の帯を畳んでいるかと、その切り替え。 */
export const useEditorSidebarCollapsed = editorPref.usePref;

/** テスト用＝この場の正を入れ直す（編集画面）。 */
export const resetEditorSidebarCollapsedTo = editorPref.resetTo;
