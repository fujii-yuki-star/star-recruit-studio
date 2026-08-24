// 欄の中の節を開閉できるアコーディオン（#276→#687 で共有部品化）。`details`/`summary` ベース。
//
// **欄の配置（ADR-0033）とは別の層**＝あれは「どの欄をどこへ置くか」、これは「欄の中身をどこまで見せるか」。
// 縦に長い欄（場面編集の右欄・タイムライン編集の「選んだ部品」）で、いま触らない節を畳んで
// **上下スクロールを減らす**ためのもの（#550・#687＝利用者要望）。
//
// 開閉は画面ごとに覚える（記憶の置き場は `sectionOpen.ts`）＝画面を往復しても開き直さなくてよい。
import { useState, type ReactNode, type SyntheticEvent } from "react";
import { loadSectionOpen, saveSectionOpen, type SectionScope } from "./sectionOpen";

export function CollapsibleSection({ scope, title, storageKey, defaultOpen = true, forceOpen, children }: {
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
  /**
   * 開いて出すか。**選んでいるものによって変わる値を渡すときは、呼び出し側で `key` を必ず付ける**
   * （例 `key={selected.id}`・#705 レビュー）。開閉は下の lazy init で**作られたとき1回だけ**決まるので、
   * `key` が無いと同じ種類のものを選び直しても React が作り直さず、**最初に選んだものの開閉のまま固まる**
   * （設定が入っていても畳まれたまま＝入れた設定を見失う）。
   *
   * ⚠️ **`key` を付けても、利用者が明示的に開閉した記憶は既定より優先される**（それが「覚える」の意味）。
   * だから**「黙って消さないための知らせ」は節の中に置かない**＝一度畳まれたら二度と見えなくなる。
   */
  defaultOpen?: boolean;
  /**
   * 外から「いまだけ開いていてほしい」と伝える（#832・ドリルイン）。**保存しない**＝`true` の間だけ
   * 開き、`false` に戻っても畳まない（黙って閉じない＝利用者が自分で畳むまでそのまま）。次にこの節が
   * 新しく作られたときは、いつもどおり記憶（`loadSectionOpen`）を読む＝この一時的な「開いて」は
   * 利用者の畳む設定を上書きしない。
   *
   * ⚠️ **マウント時の値にも織り込む**＝下の「変わった回だけ開く」処理だけに任せると、初回描画は
   * 「畳んだ記憶のまま」で出てから次の描画で開き直すので、一瞬だけ畳んだ見た目が入る（ちらつき）。
   * 呼び出し側の別の事情で、この節を含む祖先が**まさに forceOpen が要る回に**作り直されやすい
   * （例：ドリルインの1回目のタップは「空白を押した」ぶんとして選択を一度解く＝#818＝「選んだ部品」欄の
   * 中身がアンマウント→再マウントする）ので、そのちらつきが実際に起きうる場面はここ。
   */
  forceOpen?: boolean;
  children: ReactNode;
}) {
  const memoKey = storageKey ?? title;
  // 記憶があればそれを、無ければ既定（#550 ①＝主編集の節だけ開く）。lazy init＝初回描画時に1度だけ読む
  // （＝`defaultOpen` の変化は追わない。追わせたい節は呼び出し側が `key` を付ける＝上の注記）。
  // `forceOpen` は初期値にも織り込む＝畳んだ記憶で出てから開き直す、というちらつきを避ける。
  const [open, setOpen] = useState(() => forceOpen || (loadSectionOpen(scope)[memoKey] ?? defaultOpen));
  // `forceOpen` が変わった回だけ開く（描画中に反映＝React 公式の「props の変化に合わせて state を
  // 直す」形）。`useEffect` で `setState` すると再描画がもう1回余計に走る（lint `react-hooks/set-state-in-effect`）。
  const [lastForceOpen, setLastForceOpen] = useState(forceOpen);
  if (forceOpen !== lastForceOpen) {
    setLastForceOpen(forceOpen);
    if (forceOpen) setOpen(true); // 保存しない＝一時的に開くだけ（false に戻っても畳まない）
  }
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
