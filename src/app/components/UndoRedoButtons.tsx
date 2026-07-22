// 「取り消す/やり直す」の共有ボタン（#547 P2-3 レビュー）。
// 同じ操作は全画面で同じ見た目・位置・語彙にする（`06_UI_SPEC.md §操作の統一規約`＝共有コンポーネント＋単一参照元）。
// 置く画面：たたき台・場面編集・タイムライン編集（store 履歴＝ADR-0020）／テンプレ作成（画面ローカル下書きの履歴）。
// **戻す対象は画面ごとに違う**が、見た目・ラベル・キー案内はここ1か所に集約してドリフトを防ぐ（ADR-0026②）。
export function UndoRedoButtons({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  disabled = false,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** 保存中など、取り消し操作自体を止めたいとき（既定 false）。 */
  disabled?: boolean;
}) {
  return (
    <>
      <button
        className="btn btn-ghost btn-icon text-sm"
        onClick={onUndo}
        disabled={!canUndo || disabled}
        aria-label="取り消す"
        title="取り消す（Ctrl+Z）"
      >
        ↶ 取り消す
      </button>
      <button
        className="btn btn-ghost btn-icon text-sm"
        onClick={onRedo}
        disabled={!canRedo || disabled}
        aria-label="やり直す"
        title="やり直す（Ctrl+Y）"
      >
        ↷ やり直す
      </button>
    </>
  );
}
