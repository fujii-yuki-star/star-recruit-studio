// キャンバスの**矢印キーで少しずつ動かす／Delete で消す**（#525-11）。描画は無く、window の keydown を購読するだけ。
//
// ⚠️ **3つのキャンバスで1つ**（#788-3）＝場面編集の自由配置・見た目パターン編集・（将来）タイムライン編集。
// 以前は場面編集の中に書いてあり、見た目パターン編集には**そもそも結線が無かった**＝同じキャンバスなのに
// 「掴んで動かせるがキーでは動かせない」画面ができていた（ADR-0034 決定19＝ドラッグ専用の操作を作らない）。
//
// ⚠️ **打っている最中は奪わない**＝入力欄・日本語の変換中の判定は**共通のもの**（`keyboardShortcut`）を使う。
// 書き写すと、片方だけ「変換中の Delete で部品が消える」ような穴が残る。
import { useEffect } from "react";
import { keyboardNudgeDelta } from "../../domain/project/freeLayoutOps";
import { isImeComposing, isTextEntryTarget } from "../hooks/keyboardShortcut";

export interface KeyboardNudgeProps {
  /** 効かせるか（選んでいる・書き出し中でない など、画面ごとの条件）。 */
  active: boolean;
  /** 矢印。`dx`/`dy` は px（`Shift` で 10px＝規則は domain の `keyboardNudgeDelta`）。 */
  onArrow: (dx: number, dy: number) => void;
  /** `Delete` / `Backspace`。消せない状況では**渡さない**（押しても何も起きない、を作らない）。 */
  onDelete?: () => void;
}

export function KeyboardNudge({ active, onArrow, onDelete }: KeyboardNudgeProps) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent): void => {
      if (isTextEntryTarget(e.target) || isImeComposing(e)) return;
      const d = keyboardNudgeDelta(e.key, e.shiftKey);
      if (d) { e.preventDefault(); onArrow(d.dx, d.dy); return; }
      if (onDelete && (e.key === "Delete" || e.key === "Backspace")) { e.preventDefault(); onDelete(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onArrow, onDelete]);
  return null;
}
