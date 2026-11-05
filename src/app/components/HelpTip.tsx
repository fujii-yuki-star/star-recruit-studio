// 押すと開く「？」（使い勝手の点検 2026-10-22）。**常に出していた説明文**を、ここへ畳む。
//
// ⚠️ **ホバー（`title`）だけに置かない**（`06 §2` 規約20）＝タッチでもキーボードでも開けて読める形にする。
// `<details>` を使う＝開閉・読み上げ（開いているか）・キーボード（Enter／Space）がブラウザの作法どおりに付く。
// ⚠️ 本文を札（`title`）にも入れる＝マウスなら乗せるだけで読める（押さなくても）。
import type { ReactNode } from "react";

export function HelpTip({ label, children, text }: {
  /** 読み上げの名前（何の説明か）。例「動きの説明」。 */
  label: string;
  /** 札にも入れる文（`children` が文字だけのときは同じものを渡す）。 */
  text: string;
  children?: ReactNode;
}) {
  return (
    <details className="help-tip">
      <summary aria-label={label} title={text}>？</summary>
      <div className="help-tip-body text-sm">{children ?? text}</div>
    </details>
  );
}
