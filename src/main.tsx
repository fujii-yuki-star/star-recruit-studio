import { installTroubleLogBridge } from "./app/troubleLogBridge";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// うまくいかないときの記録（#396）へ、画面側の技術詳細も流す。
// ⚠️ **描く前に仕掛ける**＝描画中に出た警告も拾う（あとから仕掛けると最初の失敗を取り逃がす）。
installTroubleLogBridge();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
