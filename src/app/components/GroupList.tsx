import { useState } from "react";
import type { Group } from "../../domain/group/types";

/**
 * グループ一覧（#525-9・ADR-0022）。FREE（場面）／テンプレ作成の両エディタで共有する。
 * すべてのグループを列挙し、選択（アクティブ化）・再表示（隠したグループを戻す）・改名（任意 name・未設定は自動名）ができる。
 * これで「隠したグループを戻せない／非表示グループを選び直せない」問題を解く。純粋な表示コンポーネント（状態は親が持つ）。
 */
export function GroupList({
  groups, activeGroupId, onSelect, onToggleHidden, onRename,
}: {
  groups: Group[];
  activeGroupId: string | null;
  onSelect: (id: string) => void;
  onToggleHidden: (id: string) => void;
  onRename: (id: string, name: string) => void;
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
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
          return (
            <div
              key={g.id}
              className="row-between"
              style={{ padding: "2px 6px", borderRadius: 4, background: active ? "rgba(80,130,255,0.12)" : "var(--color-surface-alt)", opacity: g.hidden ? 0.55 : 1 }}
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
                  onKeyDown={(e) => { if (e.key === "Enter") commit(); else if (e.key === "Escape") setRenamingId(null); }}
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
                <button className="btn btn-ghost btn-icon text-sm" title="名前を変更" aria-label="名前を変更" onClick={() => startRename(g)}>名前</button>
                <button className="btn btn-ghost btn-icon text-sm" title={g.hidden ? "表示する" : "隠す"} aria-label={g.hidden ? "表示する" : "隠す"} onClick={() => onToggleHidden(g.id)}>{g.hidden ? "表示" : "隠す"}</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
