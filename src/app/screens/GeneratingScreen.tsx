import { useEffect, useState } from "react";
import type { ScreenId } from "../data/mockData";
import { LoadingView, ErrorView } from "../components/states";

interface GeneratingProps {
  onNavigate: (screen: ScreenId) => void;
}

// 「動画案を作る前の確認」→ ここ（生成中）→「動画のたたき台」 の間に表示する。
// 実AI接続は後で結線。ここではモックで進捗を進め、完了したら確認ボタンで台本表へ。
export function GeneratingScreen({ onNavigate }: GeneratingProps) {
  const [progress, setProgress] = useState(8);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (failed) return;
    const tick = setInterval(() => {
      setProgress((p) => Math.min(100, p + 6));
    }, 180);
    return () => clearInterval(tick);
  }, [failed]);

  const ready = progress >= 100;

  if (failed) {
    return (
      <div className="main-scroll">
        <ErrorView
          title="動画案の作成に失敗しました"
          message="通信状況や設定を確認して、もう一度お試しください。手動で作成を始めることもできます。"
          actions={[
            {
              label: "もう一度試す",
              primary: true,
              onClick: () => {
                setProgress(8);
                setFailed(false);
              },
            },
            { label: "手動で作成する", onClick: () => onNavigate("draft") },
            { label: "前回の結果を復元", onClick: () => onNavigate("draft") },
          ]}
        />
      </div>
    );
  }

  return (
    <div className="main-scroll">
      <LoadingView
        title={ready ? "動画案ができました" : "ゆうこが動画案を作っています…"}
        message={
          ready
            ? "内容を確認して、自由に修正できます。"
            : "会社情報と素材をもとに、動画のたたき台を準備しています。少しだけお待ちください。"
        }
        progress={progress}
        onCancel={ready ? undefined : () => onNavigate("confirm")}
      />
      {ready ? (
        <div className="text-center">
          <button className="btn btn-primary btn-lg" onClick={() => onNavigate("draft")}>
            動画案を確認する
          </button>
        </div>
      ) : (
        <div className="text-center mt">
          <button
            className="btn btn-ghost text-sm text-faint"
            onClick={() => setFailed(true)}
          >
            うまくいかない場合の表示（デモ）
          </button>
        </div>
      )}
    </div>
  );
}
