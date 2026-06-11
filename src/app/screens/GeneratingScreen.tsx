import { useEffect, useState } from "react";
import type { ScreenId } from "../data/mockData";
import { LoadingView } from "../components/states";

interface GeneratingProps {
  onNavigate: (screen: ScreenId) => void;
}

// 「動画案を作る前の確認」→ ここ（生成中）→「動画のたたき台」 の間に表示する。
// 実AI接続は後で結線。ここではモックで進捗を進め、完了したら台本表へ進む。
export function GeneratingScreen({ onNavigate }: GeneratingProps) {
  const [progress, setProgress] = useState(8);

  useEffect(() => {
    const tick = setInterval(() => {
      setProgress((p) => Math.min(95, p + 7));
    }, 220);
    const done = setTimeout(() => onNavigate("draft"), 2600);
    return () => {
      clearInterval(tick);
      clearTimeout(done);
    };
  }, [onNavigate]);

  return (
    <div className="main-scroll">
      <LoadingView
        title="ゆうこが動画案を作っています…"
        message="会社情報と素材をもとに、動画のたたき台を準備しています。少しだけお待ちください。"
        progress={progress}
        onCancel={() => onNavigate("confirm")}
      />
    </div>
  );
}
