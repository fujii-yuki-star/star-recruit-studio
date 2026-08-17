// 編集画面の**共通ツールバー**（#774）。「取り消す／やり直す」「保存の状態」「一覧へ戻る」を
// **3画面で同じ場所**（画面上の見出しの横）に置く。
//
// ⚠️ **なぜ場所をそろえるのか**＝以前は3画面3様だった（タイムライン＝画面の**いちばん下**／
// 見た目パターン編集＝見出しの行／場面編集＝欄の中）。とくにタイムラインは欄が画面の高さを超えると
// **スクロールしないと見えない**＝**見えていないボタンは無いのと同じ**（ADR-0034 決定19 が「もう1つの
// 入口を残す」と言うとき、その入口は**見えている**必要がある）。
//
// ⚠️ **保存の状態をいつも見える所に置く**のは、横断調査 C1（作業が消える不安）への備え。
// 失敗したまま気づかない、を作らない。
//
// 受け口を細かく分けているのは、**画面ごとに持ち物が違う**ため（保存の出し方・戻り先の言い方・
// 画面固有のボタン）。ここで無理に1つへ寄せると、どれかの画面で嘘の表示になる。
import type { ReactNode } from "react";
import { UndoRedoButtons } from "./UndoRedoButtons";

export interface EditorToolbarProps {
  /** 取り消す／やり直す（3画面とも出す）。 */
  undo: {
    canUndo: boolean;
    canRedo: boolean;
    onUndo: () => void;
    onRedo: () => void;
    /** 押せない状況（書き出し中・保存中など）。 */
    disabled?: boolean;
  };
  /** 保存の状態。画面によって出し方が違う（自動保存の文言／未保存の印）ので受け取るだけ。 */
  status?: ReactNode;
  /** 一覧・前の画面へ戻る。言い方は画面ごと（「動画の一覧へ」「一覧へ戻る」「台本表へ戻る」）。 */
  back?: {
    label: ReactNode;
    onClick: () => void;
    disabled?: boolean;
    /** 押せないときの理由（§2-5＝押してから断らない）。 */
    title?: string;
  };
  /** この画面だけの追加（保存ボタン・声の作成など）。戻るの手前に並ぶ。 */
  extra?: ReactNode;
}

export function EditorToolbar({ undo, status, back, extra }: EditorToolbarProps) {
  return (
    <div className="row gap-sm editor-toolbar" style={{ alignItems: "center", flexWrap: "wrap" }}>
      <UndoRedoButtons
        canUndo={undo.canUndo}
        canRedo={undo.canRedo}
        onUndo={undo.onUndo}
        onRedo={undo.onRedo}
        disabled={undo.disabled}
      />
      {status}
      {extra}
      {back && (
        <button
          className="btn btn-ghost btn-icon"
          onClick={back.onClick}
          disabled={back.disabled}
          title={back.title}
        >
          {back.label}
        </button>
      )}
    </div>
  );
}
