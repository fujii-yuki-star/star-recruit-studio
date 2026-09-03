import { useEffect, useRef, type ReactNode } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useEscapeReceiver } from "../hooks/escapeOwners";
import { TrashIcon } from "./icons";

// 削除の確認を全画面で統一する（#410 sub1）。警告 notice ＋ [やめる（ghost・左）] [削除する（btn-danger・右）]。
// 破壊的操作は「右・危険色」で固定＝画面ごとに順序/色が違って「やめるのつもりが削除」を防ぐ。busy 中はラベルを
// 変え両ボタンを無効化（連打/多重削除を防ぐ）。トリガー（「◯◯を削除」ボタン）は配置が画面ごとに違うため各画面が持つ。
//
// ⚠️ **キーボードで戻れるようにする**（#354）＝以前は Escape も焦点の移動も無く、
// 押した「◯◯を削除」がこの確認に置き換わるので**焦点が本文の先頭へ落ちていた**（実機で確認）。
// キーボードだけの人は、押した直後に**どこにいるか分からなくなり**、Tab で画面の頭から辿り直すことになる。
// ⚠️ **メニューや選択欄には Escape が在った**（`ContextMenu` / `FontPicker` / 各オーバーレイ）のに、
// **確認にだけ無かった**＝「双子の片方だけ直す」。確認は「やめる」に届くことがいちばん大事な場所。
// ⚠️ **13 か所がこの部品を通る**ので、ここで直せば全部に効く（画面ごとに書き足さない）。
export function DeleteConfirm({
  message,
  confirmLabel = "削除する",
  busyLabel = "削除中…",
  busy = false,
  onCancel,
  onConfirm,
  className,
}: {
  /** 何を消すか＋影響（例:「Xを削除しますか？元に戻せません。…」）。 */
  message: ReactNode;
  confirmLabel?: string;
  busyLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  className?: string;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // ⚠️ **閉じたときに元へ戻す**（#986）＝出た瞬間に「やめる」へ手を移すのに（#354）、
  // **閉じるときに戻していなかった**ので、押した瞬間に焦点が `body` へ落ちる＝
  // #354 が直そうとした症状（「押した直後にどこにいるか分からなくなる」）が、出る方向に残っていた。
  // ⚠️ **実行中も閉じ込める**＝両ボタンが無効でも、外へ `Tab` で抜けて別の操作を始められない。
  useFocusTrap(true, boxRef, cancelRef);

  // ⚠️ **安全な側（やめる）へ焦点を置く**＝Enter をそのまま押しても消えない。
  // 実行中は動かさない（押せないボタンへ焦点を移しても行き止まり）。
  // ⚠️ **出た瞬間の1回は上の `useFocusTrap` が済ませている**＝ここが受け持つのは
  // **実行が終わって押せるようになったとき**に安全な側へ戻すこと（同じ所へ2度当てても害はない）。
  useEffect(() => {
    if (!busy) cancelRef.current?.focus();
  }, [busy]);

  // ⚠️ **Escape の名簿に参加する**（#963 レビュー 🟡1）＝この画面には既に
  // 「いま Escape を受け持っているものが名乗る」仕組み（`escapeOwners`）があり、
  // メニュー・色や文字の選び欄・ドラッグの中止はすべてそこに参加している。
  // 最初は自分だけ document の capture で握って `stopPropagation` していたが、
  // それだと**名簿より必ず先に走って横取りする**＝確認を出したまま自由配置の文字を編集していると、
  // 編集を終えるつもりの Escape が**無関係な確認だけを閉じて**編集は終わらない。
  // 既にある仕組みを使わずに別のやり方を持ち込むと、こういう形で噛み合わなくなる。
  // ⚠️ **処理は名簿へ預ける**（#965）＝色や文字の選び欄を開いたままこの確認を開いたとき、
  // 自分で購読していると1回の `Escape` で両方いっぺんに閉じる。**実行中は名乗らない**
  //（両ボタンを無効にしているのと同じ扱い＝走っている処理は止まらない）。
  useEscapeReceiver(!busy, (e) => {
    // ⚠️ **入力中は横取りしない**＝文字を打っている最中の Escape は、その欄のもの。
    // 確認は答えるまで残る作りなので、**別の場所で入力している間ずっと**奪い続けることになる。
    // ⚠️ **「いま焦点がある所」ではなく「キーを押した所」を見る**（#973 レビュー）＝
    // 欄は自分の `onKeyDown` で抜ける（`blur()`）ものがあり、それは**この判定より先に走る**。
    // `document.activeElement` を見ると、抜けた後の姿を見て「打っていない」と誤り、
    // **1回のキーで欄を抜けて確認まで答えたことになる**（実測で再現した）。
    // 押した先が要素でないとき（窓へ直に投げた合成のキーなど）だけ、いまの焦点で代用する。
    const active = e.target instanceof HTMLElement ? e.target : document.activeElement;
    const editing =
      active instanceof HTMLElement &&
      !boxRef.current?.contains(active) &&
      (active.tagName === "TEXTAREA" || active.tagName === "INPUT" || active.isContentEditable);
    // ⚠️ **見送りは `false`**（#965 レビュー 🟡）＝ここで受け取ったことにすると、
    // **奥の受け手（開いたままの選び欄など）まで黙る**＝`Escape` が完全に死ぬ（§2-5）。
    if (editing) return false;
    // ⚠️ **奥へ通す**（`stopPropagation` しない）＝止め方は名簿に任せる（既存の受け手と同じ流儀）。
    onCancel();
    return true;
  });

  return (
    <div ref={boxRef} className={`notice notice-warn${className ? ` ${className}` : ""}`} role="alert">
      <span>{message}</span>
      <div className="row gap-sm">
        <button ref={cancelRef} className="btn btn-ghost btn-icon" onClick={onCancel} disabled={busy}>
          やめる
        </button>
        <button className="btn btn-danger btn-icon" onClick={onConfirm} disabled={busy}>
          <TrashIcon size={16} />
          {busy ? busyLabel : confirmLabel}
        </button>
      </div>
    </div>
  );
}
