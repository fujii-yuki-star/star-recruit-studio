import { isAiSceneLimitMessage } from "../../domain/project/sceneLimit";
import { useEffect, useState } from "react";
import type { ScreenId } from "../data/mockData";
import { useProjectStore } from "../store/projectStore";
import { onAiBusyWait } from "../../infrastructure/aiClient";
import { LoadingView, ErrorView } from "../components/states";
import { GENERATE_FAILED_TITLE, GENERATE_TOO_LONG_TITLE, EDIT_WIZARD_INPUT_LABEL, generateFailedMessage, RETRY_GENERATE_LABEL, START_MANUAL_LABEL } from "../uiLabels";

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
  /**
   * 混み合っていて待ち直している回数（0＝待っていない）。
   *
   * ⚠️ **待っていることを言う**（#1244・利用者の指摘 2026-09-25）＝混雑のときは裏で最長 30 秒ほど
   * 待ち直すので、黙っていると**固まったように見える**（しかも以前は待ち直さずに落ちていた）。
   */
  const [busyWait, setBusyWait] = useState(0);

  useEffect(() => {
    void generate();
  }, [generate]);

  // ⚠️ **外す**＝画面を離れたあとに知らせが届いて、消えた画面へ書き込まない。
  useEffect(() => {
    let stop: (() => void) | null = null;
    let alive = true;
    void onAiBusyWait((e) => setBusyWait(e.attempt)).then((off) => {
      if (alive) stop = off;
      else off();
    });
    return () => {
      alive = false;
      if (stop) stop();
    };
  }, []);

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
    // ⚠️ **見分けは domain の目印から**（#1222）＝断りの文と同じ1か所から作るので、ずれない。
    const 上限で断った = isAiSceneLimitMessage(aiError);
    return (
      <div className="main-scroll">
        {/* 見出し・説明・2択のラベルは空状態（NoScenesState）と共有する＝この画面を離れても言葉が変わらない（§6・#590）。 */}
        <ErrorView
          title={上限で断った ? GENERATE_TOO_LONG_TITLE : GENERATE_FAILED_TITLE}
          message={generateFailedMessage(aiError)}
          // 正典 `12_AI_PROMPT_AND_MAPPING §9.3③`「前回 ai/latest_result.json から復元」は **post-α・未実装として正典で追跡中**の
          // ため導線を出さない（GH issue でなく正典が追跡元＝復元しない導線で誤誘導しないため。現状 UI は ①再試行 / ②手動のみ）。
          // ⚠️ **同じ入力での再送を出さない**（PR #1223 レビュー 🟡）＝上限で断ったときの
          //   「もう一度試す」は `reset(); generate()`＝**同じ内容をそのまま送り直す**ので、**また超える**。
          //   断りの文が「もう一度お試しください」を避けているのに、**ボタンがそれを打ち消して**いた（§2-5）。
          // ⚠️ **行き先は入力**＝文が指示する次の行動（伝える内容を減らす）に、画面から到達できるようにする。
          actions={[
            上限で断った
              ? { label: EDIT_WIZARD_INPUT_LABEL, primary: true, onClick: () => onNavigate("wizard") }
              : {
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
            : busyWait > 0
              ? "いま混み合っているので、少し待ってからもう一度お願いしています。このままお待ちください。"
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
