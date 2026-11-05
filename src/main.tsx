import { installTroubleLogBridge } from "./app/troubleLogBridge";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { PreviewWindowApp } from "./app/screens/PreviewWindowApp";
import { isPreviewWindowContext } from "./infrastructure/previewWindow";
import { isRenderWindowContext } from "./infrastructure/renderWindowLink";
import { startRenderWindow } from "./app/renderWindow/renderWindowApp";

// うまくいかないときの記録（#396）へ、画面側の技術詳細も流す。
// ⚠️ **描く前に仕掛ける**＝描画中に出た警告も拾う（あとから仕掛けると最初の失敗を取り逃がす）。
installTroubleLogBridge();

if (isRenderWindowContext()) {
  // 書き出しのコマを描く隠した窓（ADR-0070）＝画面は出さない。本体から頼まれた範囲を描くだけ
  // （アプリの画面・声の用意・自動保存は動かさない＝状態の持ち主は本体）。
  void startRenderWindow();
} else {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      {/* 仕上がり確認の別窓（ADR-0050）＝同じ束を別の入口で開く。 */}
      {isPreviewWindowContext() ? <PreviewWindowApp /> : <App />}
    </React.StrictMode>,
  );
}
