// キャンバスの**矢印キーで少しずつ動かす／Delete で消す**（#525-11）。描画は無く、window の keydown を購読するだけ。
//
// ⚠️ **3つのキャンバスで1つ**（#788-3）＝場面編集の自由配置・見た目パターン編集・（将来）タイムライン編集。
// 以前は場面編集の中に書いてあり、見た目パターン編集には**そもそも結線が無かった**＝同じキャンバスなのに
// 「掴んで動かせるがキーでは動かせない」画面ができていた（ADR-0034 決定19＝ドラッグ専用の操作を作らない）。
//
// ⚠️ **そのキーで反応する相手には譲る**＝判定は**共通のもの**（`keyboardShortcut`）を使う。
// 書き写すと、片方だけ「変換中の Delete で部品が消える」ような穴が残る。
//
// ⚠️ 譲る相手は**3種類あり、どれか1つでは足りない**（#788 レビュー 🔴）：
// - **打っている最中**（`isTextEntryTarget`）と**変換中**（`isImeComposing`）＝文字が消える・確定できない
// - **矢印自身が効く相手**（`usesArrowKeys`）＝セレクト・スライダー・数値欄。ここを見落とすと
//   **欄の値が変わらないまま部品だけ動く**（`06 §12.1`＝片方だけ譲ると同じ理由の判断が入口で割れる）
// - **押せば反応する相手**（`activatesOnSpace`）＝`Delete` は本来そこで何も起きないが、**部品が消える**のは
//   利用者の意図から遠い（欄を触っているつもりなのにキャンバスの中身が消える）
//
// この部品を場面編集から抜いたとき、旧実装の `SELECT`／全 `INPUT` の除外がいったん落ちて上の穴が開いた
// ＝**共通判定は旧判定より狭い**ことに気づかず寄せたため（レビューで検出）。
import { useEffect } from "react";
import { keyboardNudgeDelta } from "../../domain/project/freeLayoutOps";
import { activatesOnSpace, isImeComposing, isTextEntryTarget, usesArrowKeys } from "../hooks/keyboardShortcut";

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
      if (d) {
        if (usesArrowKeys(e.target)) return; // 矢印はその相手のもの（セレクト・スライダー・数値欄）
        e.preventDefault();
        onArrow(d.dx, d.dy);
        return;
      }
      if (onDelete && (e.key === "Delete" || e.key === "Backspace")) {
        if (activatesOnSpace(e.target)) return; // 欄を触っているつもりで中身が消える、を作らない
        e.preventDefault();
        onDelete();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onArrow, onDelete]);
  return null;
}
