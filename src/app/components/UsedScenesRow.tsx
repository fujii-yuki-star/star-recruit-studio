// 素材・見た目の「使用場面」逆引き行（#406）。使っている場面の番号チップを並べ、押すと該当場面の編集へ飛ぶ。
// 対象場面は editingSceneId 機構（#400）で運ぶ＝呼び出し側の onJump が setEditingSceneId＋画面遷移を行う。
// 表示は「場面3」のみ（§2-3：sceneId 等の技術語は出さない）。純粋な表示部品ゆえ store には依存しない。

/** 使用場面の逆引きチップ列。scenes が空なら emptyText を出す（「まだ使われていない」を明示・§2-5）。 */
export function UsedScenesRow({
  scenes,
  onJump,
  emptyText,
}: {
  scenes: readonly { sceneId: string; order: number }[];
  onJump: (sceneId: string) => void;
  emptyText: string;
}) {
  if (scenes.length === 0) {
    return <p className="text-sm text-muted" style={{ margin: 0 }}>{emptyText}</p>;
  }
  return (
    <div className="row gap-sm row-wrap">
      {scenes.map((s) => (
        <button
          key={s.sceneId}
          type="button"
          className="badge badge-teal"
          style={{ cursor: "pointer" }}
          onClick={() => onJump(s.sceneId)}
          title={`場面${s.order}の編集を開く`}
        >
          場面{s.order}
        </button>
      ))}
    </div>
  );
}
