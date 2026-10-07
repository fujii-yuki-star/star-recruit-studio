// 動画づくりの流れの段（ADR-0048 追補・利用者判断 2026-10-05）。流れの帯（`FlowBar`）と検査が同じものを見る。
// ⚠️ **画面の部品の file から出す**（`react-refresh/only-export-components`＝部品以外を置かない）。
import type { ScreenId } from "./data/mockData";
import { useProjectStore } from "./store/projectStore";

export type FlowScreen = Extract<ScreenId, "draft" | "scene-edit" | "preview" | "precheck" | "export">;

/**
 * 並び順がそのまま段の順。名札は**短く**（帯に5つ並ぶ）＝画面の見出し（`SCREEN_TITLES`）の短い呼び名。
 * ⚠️ 見出しと違う言葉にしない＝「たたき台」「場面編集」「仕上がり確認」「公開前チェック」「書き出し」は、
 *   どれも画面の中で既に使っている呼び名（戻るの文言・案内）。
 */
export const FLOW_STEPS: readonly { screen: FlowScreen; label: string }[] = [
  { screen: "draft", label: "たたき台" },
  { screen: "scene-edit", label: "場面編集" },
  { screen: "preview", label: "仕上がり確認" },
  { screen: "precheck", label: "公開前チェック" },
  { screen: "export", label: "書き出し" },
];

/**
 * 段を押したときの移り方（来た画面の覚え方を1か所に）。
 * ⚠️ 仕上がり確認と公開前チェックは「来た画面へ戻る」を持つ＝ここで覚えさせる（覚えない入口を作らない・#1026）。
 */
export function flowJump(from: FlowScreen, to: FlowScreen, onNavigate: (s: ScreenId) => void): void {
  const st = useProjectStore.getState();
  // ⚠️ **どの段から来ても覚える**（PR #1347 レビュー 🟡）＝以前は覚えられない入口で戻り先を消していたので、
  //   来ていない画面（既定の「仕上がり確認へ戻る」など）を指した（#1026 の型）。戻るの言い方は両画面の表が全段を持つ。
  if (to === "preview") st.setPreviewReturnTo(from);
  if (to === "precheck") st.setPrecheckReturnTo(from);
  onNavigate(to);
}
