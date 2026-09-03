import { useState } from "react";
import type { Group } from "../../domain/group/types";
import { renameFieldKeys } from "../hooks/keyboardShortcut";
import { DeleteConfirm } from "./DeleteConfirm";
import { PencilIcon } from "./icons";

/**
 * グループ一覧（#525-9・ADR-0022）。FREE（場面）／テンプレ作成の両エディタで共有する。
 * すべてのグループを列挙し、選択（アクティブ化）・再表示（隠したグループを戻す）・改名（任意 name・未設定は自動名）ができる。
 * これで「隠したグループを戻せない／非表示グループを選び直せない」問題を解く。純粋な表示コンポーネント（状態は親が持つ）。
 */
export function GroupList({
  groups, activeGroupId, onSelect, onToggleHidden, onRename, onDelete, memberCount, deleteDisabledReason,
}: {
  groups: Group[];
  activeGroupId: string | null;
  onSelect: (id: string) => void;
  onToggleHidden: (id: string) => void;
  onRename: (id: string, name: string) => void;
  /** グループをメンバーごと削除（#551）。 */
  onDelete: (id: string) => void;
  /** そのグループが抱える要素数（確認文に出す）。中身の数だけ消えることを押す前に伝える（§2-5）。 */
  memberCount: (id: string) => number;
  /**
   * 削除できないときの理由（画面固有の制約）。返すと削除ボタンを無効化し、その文言を説明に出す＝
   * 押せない理由が分かる（§2-5）。ロック中の抑止は全画面共通なのでここでは扱わない（下で共通処理）。
   * 例：テンプレ作成エディタは最低1枚のレイヤーが要る（`template.schema` の `layers.minItems:1`）。
   */
  deleteDisabledReason?: (id: string) => string | undefined;
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  // 削除確認中のグループ id（#551）。破壊的＋複数要素が一度に消えるので、押した行をその場で確認へ変える。
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  if (groups.length === 0) return null;

  const startRename = (g: Group) => { setDraftName(g.name ?? ""); setRenamingId(g.id); };
  const commit = () => { if (renamingId) onRename(renamingId, draftName.trim()); setRenamingId(null); };

  return (
    <div className="field" style={{ marginBottom: 4 }}>
      <label className="field-label text-sm" style={{ margin: "0 0 4px" }}>グループ</label>
      <div className="col" style={{ gap: 2 }}>
        {groups.map((g, i) => {
          const active = g.id === activeGroupId;
          const auto = `グループ${i + 1}`; // 未設定時の自動名（一覧の並び順）
          const name = g.name && g.name.length > 0 ? g.name : auto;
          const renaming = renamingId === g.id;
          // 削除できない理由（ロックは全画面共通／画面固有は親から）。理由があればボタンを無効化し説明に出す。
          const deleteReason = g.locked
            ? "ロック中は削除できません（先にロックを解除してください）"
            : deleteDisabledReason?.(g.id);
          // 削除確認中はその行を確認へ差し替える（一覧の位置を保ったまま・他の行は触れる）。
          // **確認中に削除できなくなったら確認を出さない**（`!deleteReason`）＝確認を開いたまま別の場所で
          // ロックした/要素を減らした場合、「削除する」を押しても内側のガードが無言 return して
          // 「消えたはずが消えていない」サイレント失敗になる（#551 レビュー P2）。理由つきの無効ボタン（下）へ戻す。
          if (confirmDeleteId === g.id && !deleteReason) {
            const n = memberCount(g.id);
            return (
              <DeleteConfirm
                key={g.id}
                message={`「${name}」を中身ごと削除しますか？${n > 0 ? `この中の${n}個の要素も一緒に消えます。` : ""}`}
                onCancel={() => setConfirmDeleteId(null)}
                onConfirm={() => { onDelete(g.id); setConfirmDeleteId(null); }}
              />
            );
          }
          return (
            <div
              key={g.id}
              className="row-between"
              style={{ padding: "2px 6px", borderRadius: 4, background: active ? "rgba(var(--color-primary-rgb), 0.12)" : "var(--color-surface-alt)", opacity: g.hidden ? 0.55 : 1 }}
            >
              {renaming ? (
                <input
                  className="input text-sm"
                  style={{ flex: 1, minWidth: 0 }}
                  autoFocus
                  value={draftName}
                  placeholder={auto}
                  aria-label="グループ名"
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={commit}
                  // ⚠️ **変換中は奪わない**（#989）＝規則は `renameFieldKeys` に1つだけ。
                  onKeyDown={renameFieldKeys({ commit, cancel: () => setRenamingId(null) })}
                />
              ) : (
                <button
                  className="btn btn-ghost text-sm"
                  style={{ flex: 1, textAlign: "left", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  onClick={() => onSelect(g.id)}
                  onDoubleClick={() => startRename(g)}
                  title="クリックで選択・ダブルクリックで名前を変更"
                >
                  {name}{g.locked ? "（ロック）" : ""}{g.hidden ? "（非表示）" : ""}
                </button>
              )}
              <div className="row" style={{ gap: 2 }}>
                {/* 可視ラベルは名詞「名前」でなく操作＝ペンアイコンにする（動詞規約・#547 P3-6）。名前は title/aria-label が担う。 */}
                <button className="btn btn-ghost btn-icon text-sm" title="名前を変更" aria-label="名前を変更" onClick={() => startRename(g)}><PencilIcon size={14} /></button>
                <button className="btn btn-ghost btn-icon text-sm" title={g.hidden ? "表示する" : "隠す"} aria-label={g.hidden ? "表示する" : "隠す"} onClick={() => onToggleHidden(g.id)}>{g.hidden ? "表示" : "隠す"}</button>
                {/* 中身ごと削除（#551）。ロック中は「まとめて移動・拡縮・回転」「解除」と揃えて抑止し、
                    画面固有の制約（例：テンプレは最低1枚）は deleteDisabledReason で理由ごと受け取る。 */}
                <button
                  className="btn btn-ghost btn-icon text-sm"
                  title={deleteReason ?? "グループを中身ごと削除（中の要素も消えます）"}
                  aria-label={`${name}を中身ごと削除`}
                  disabled={!!deleteReason}
                  onClick={() => setConfirmDeleteId(g.id)}
                >削除</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
