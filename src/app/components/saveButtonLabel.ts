import type { SaveStatus } from "../store/projectStore";

// 保存ボタンの表示文言の単一参照元（#410 sub5・「保存」1種に統一）。
// 共通トップバー・場面編集・ウィザードなど、保存状態（saveStatus）で駆動する保存ボタンはすべてこれを使う。
// これで「ここまで保存／変更を保存／プロジェクトを保存」の語ゆれを無くし、状態文言（保存中…等）も1か所に集約する。
// 文言は技術用語なし（§2-3）、失敗は「次の行動」を示す（§2-5）。
export function saveButtonLabel(saveStatus: SaveStatus): string {
  switch (saveStatus) {
    case "saving":
      return "保存中…";
    case "saved":
      return "保存しました";
    case "error":
      return "保存に失敗（もう一度押す）";
    default:
      return "保存";
  }
}
