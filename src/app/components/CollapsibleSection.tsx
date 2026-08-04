// 欄の中の節を開閉できるアコーディオン（#276→#687 で共有部品化）。`details`/`summary` ベース。
//
// **欄の配置（ADR-0033）とは別の層**＝あれは「どの欄をどこへ置くか」、これは「欄の中身をどこまで見せるか」。
// 縦に長い欄（場面編集の右欄・タイムライン編集の「選んだ部品」）で、いま触らない節を畳んで
// **上下スクロールを減らす**ためのもの（#550・#687＝利用者要望）。
//
// 開閉は画面ごとに覚える（記憶の置き場は `sectionOpen.ts`）＝画面を往復しても開き直さなくてよい。
import { useState, type ReactNode, type SyntheticEvent } from "react";
import { loadSectionOpen, saveSectionOpen, type SectionScope } from "./sectionOpen";

export function CollapsibleSection({ scope, title, storageKey, defaultOpen = true, children }: {
  /** どの画面の記憶か（画面ごとに分ける＝別画面の同名の節と混ざらない）。 */
  scope: SectionScope;
  title: string;
  /**
   * 記憶のキー（#550 レビュー P3）。既定は見出しそのもの。
   *
   * **新しく足す節では必ず渡す**（#687 レビュー）＝既定のままだと**利用者に見える文言が永続キーになる**ので、
   * 見出しを言い換えた瞬間にその節の開閉の記憶が黙って失われる（言い換えは実際に予定されている＝ADR-0034 決定21）。
   * 既に見出しをキーにしている節（場面編集）は**そのまま**＝変えるとそこで記憶が消える。
   *
   * **見出しが状態で変わる節は必ず渡す**＝
   * 例「〜の見た目（この場面だけ変更中）」（#555）は上書きの有無で見出しが変わるため、素で使うと記憶が
   * 2キーに割れて「上書き中に開いた記憶」が非上書き時に引かれない（記憶が当てにならなくなる）。
   */
  storageKey?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const memoKey = storageKey ?? title;
  // 記憶があればそれを、無ければ既定（#550 ①＝主編集の節だけ開く）。lazy init＝初回描画時に1度だけ読む。
  const [open, setOpen] = useState(() => loadSectionOpen(scope)[memoKey] ?? defaultOpen);
  const onToggle = (e: SyntheticEvent<HTMLDetailsElement>) => {
    const next = e.currentTarget.open;
    // **既定のままなら保存しない**：`<details open>` は描画しただけで（非同期に）toggle を発火するため、
    // 素通しにすると「触ってもいない節の既定値」が保存され、**将来 既定を変えても既存利用者に届かなくなる**
    // （記憶が既定を上書きし続ける）。利用者が実際に開閉したときだけ覚える。
    if (next === open) return;
    setOpen(next);
    saveSectionOpen(scope, memoKey, next);
  };
  return (
    <details className="accordion" open={open} onToggle={onToggle}>
      <summary className="accordion-summary">{title}</summary>
      <div className="accordion-body">{children}</div>
    </details>
  );
}
