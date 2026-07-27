// 書き出し能力（標準方式 h264_mf の可用性）の事前検知（#120）を画面間で共有するフック（#547 P2-5 後続）。
// 公開前チェックと書き出し画面が**同じ検知**を使う＝片方だけ「この端末では書き出せない」を見落として
// 「押せるのに必ず失敗」を作らない（`15_ERROR_STATE_MODEL` §3・ADR-0026②）。
// Tauri 環境でのみ取得する（ブラウザ実行では null のまま＝判定材料が無いので止めない）。
import { useEffect, useState } from "react";
import type { ExportCapability } from "../../domain/export/exportCapability";
import { canExport, detectH264Capability } from "../../infrastructure/ffmpegExport";

export function useExportCapability(): ExportCapability | null {
  const [capability, setCapability] = useState<ExportCapability | null>(null);
  useEffect(() => {
    if (!canExport()) return;
    let alive = true;
    detectH264Capability()
      .then((c) => {
        if (alive) setCapability(c);
      })
      .catch(() => {
        if (alive) setCapability(null);
      });
    return () => {
      alive = false;
    };
  }, []);
  return capability;
}
