import { useEffect, useState } from "react";
import type { ScreenId } from "../data/mockData";
import { useProjectStore } from "../store/projectStore";
import { LoadingView, ErrorView } from "../components/states";
import { GENERATE_FAILED_TITLE, generateFailedMessage, RETRY_GENERATE_LABEL, START_MANUAL_LABEL } from "../uiLabels";

interface GeneratingProps {
  onNavigate: (screen: ScreenId) => void;
}

// 「動画案を作る前の確認」→ ここ（生成中）→「動画のたたき台」。
// マウント時に Mock AI → 検証/変換 を実行し、結果はストアに入る。進捗はUX用のアニメーション。
export function GeneratingScreen({ onNavigate }: GeneratingProps) {
  const status = useProjectStore((s) => s.status);
  const aiError = useProjectStore((s) => s.aiError);
  const generate = useProjectStore((s) => s.generate);
  const cancelGeneration = useProjectStore((s) => s.cancelGeneration);
  const fail = useProjectStore((s) => s.fail);
  const reset = useProjectStore((s) => s.reset);
  const startManualEdit = useProjectStore((s) => s.startManualEdit);
  const [progress, setProgress] = useState(8);

  useEffect(() => {
    void generate();
  }, [generate]);

  // ⚠️ **できるまでは「わからない」と見せる**（#993 ②）＝以前は 180ms ごとに +6 して
  // **2.5秒で 90% まで行き、そこで止まって**いた。AI は最長60秒待つので、実際の相手だと
  // **90% のまま数十秒動かない**＝「固まった」ようにしか見えない。
  // ⚠️ **数字は出していないので嘘はついていなかった**が、止まったバーは固まって見える。
  // 書き出しが「わからない区間」に使っている**流れるバー**へ寄せる（ADR-0026②）。
  // できたら 100% まで詰めて終わりを見せる（そこは分かっている）。
  useEffect(() => {
    if (status !== "ready") return;
    const tick = setInterval(() => setProgress((p) => Math.min(100, p + 6)), 180);
    return () => clearInterval(tick);
  }, [status]);

  if (status === "error") {
    return (
      <div className="main-scroll">
        {/* 見出し・説明・2択のラベルは空状態（NoScenesState）と共有する＝この画面を離れても言葉が変わらない（§6・#590）。 */}
        <ErrorView
          title={GENERATE_FAILED_TITLE}
          message={generateFailedMessage(aiError)}
          // 正典 `12_AI_PROMPT_AND_MAPPING §9.3③`「前回 ai/latest_result.json から復元」は **post-α・未実装として正典で追跡中**の
          // ため導線を出さない（GH issue でなく正典が追跡元＝復元しない導線で誤誘導しないため。現状 UI は ①再試行 / ②手動のみ）。
          actions={[
            {
              label: RETRY_GENERATE_LABEL,
              primary: true,
              onClick: () => {
                setProgress(8);
                reset();
                void generate();
              },
            },
            // 手動作成リカバリ（#393 P1）：status を error のままにせず ready にし、入力済みメタ/素材を残して draft へ。
            { label: START_MANUAL_LABEL, onClick: () => { startManualEdit(); onNavigate("draft"); } },
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
        progress={status === "ready" ? progress : "indeterminate"}
        onCancel={
          ready
            ? undefined
            : () => {
                cancelGeneration(); // 生成を本当に中止＝裏で完走しても場面を置き換えない（#402）
                onNavigate("confirm");
              }
        }
      />
      {ready ? (
        <div className="text-center">
          <button className="btn btn-primary btn-lg" onClick={() => onNavigate("draft")}>
            動画案を確認する
          </button>
        </div>
      ) : (
        // 「デモ（失敗表示）」ボタンは開発時のみ表示＝本番UIに出さない（#392）。
        import.meta.env.DEV && (
          <div className="text-center mt">
            <button className="btn btn-ghost text-sm text-faint" onClick={() => fail()}>
              うまくいかない場合の表示（デモ）
            </button>
          </div>
        )
      )}
    </div>
  );
}
