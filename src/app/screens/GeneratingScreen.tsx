import { useEffect, useState } from "react";
import type { ScreenId } from "../data/mockData";
import { useProjectStore } from "../store/projectStore";
import { LoadingView, ErrorView } from "../components/states";

interface GeneratingProps {
  onNavigate: (screen: ScreenId) => void;
}

// 「動画案を作る前の確認」→ ここ（生成中）→「動画のたたき台」。
// マウント時に Mock AI → 検証/変換 を実行し、結果はストアに入る。進捗はUX用のアニメーション。
export function GeneratingScreen({ onNavigate }: GeneratingProps) {
  const status = useProjectStore((s) => s.status);
  const aiError = useProjectStore((s) => s.aiError);
  const generate = useProjectStore((s) => s.generate);
  const fail = useProjectStore((s) => s.fail);
  const reset = useProjectStore((s) => s.reset);
  const [progress, setProgress] = useState(8);

  useEffect(() => {
    void generate();
  }, [generate]);

  useEffect(() => {
    if (status === "error") return;
    const tick = setInterval(() => {
      setProgress((p) => Math.min(100, p + 6));
    }, 180);
    return () => clearInterval(tick);
  }, [status]);

  if (status === "error") {
    return (
      <div className="main-scroll">
        <ErrorView
          title="動画案の作成に失敗しました"
          message={
            aiError ??
            "通信状況や設定を確認して、もう一度お試しください。手動で作成を始めることもできます。"
          }
          actions={[
            {
              label: "もう一度試す",
              primary: true,
              onClick: () => {
                setProgress(8);
                reset();
                void generate();
              },
            },
            { label: "手動で作成する", onClick: () => onNavigate("draft") },
            { label: "前回の結果を復元", onClick: () => onNavigate("draft") },
          ]}
        />
      </div>
    );
  }

  const ready = status === "ready" && progress >= 100;

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
          <button className="btn btn-ghost text-sm text-faint" onClick={() => fail()}>
            うまくいかない場合の表示（デモ）
          </button>
        </div>
      )}
    </div>
  );
}
