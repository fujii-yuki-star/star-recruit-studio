// 時間の一点に置く**目印**（#356 ①）。
//
// ⚠️ **動画には出ない**＝作業用のメモ（「ここ直す」「ここに効果音」「この間を伸ばす」）。
// 門番＝`src/test/markersNotInVideoGuard.test.ts`（描く側・焼く側が読んでいないことを見る）。
//
// ⚠️ **「並び」の欄の中に置く**（`06 §2` 統一規約5＝同じ操作を2か所に置かない）＝
// 目印は時間軸のものなので、時間軸を見ている欄の中で足して・辿れるのが自然。
import { useState } from "react";
import { MARKER_TEXT_MAX, markersInOrder } from "../../domain/timeline/markers";
import { clockLabel, MARKER_ADD_LABEL, MARKER_EMPTY_HINT, MARKER_JUMP_TITLE, MARKER_SECTION_TITLE, MARKER_TEXT_PLACEHOLDER } from "../uiLabels";
import { DELETE_LABEL } from "../uiLabels";
import type { TimelineProject } from "../../domain/timeline/types";

/**
 * 目印の一覧と、置く・辿る・書く・消す。
 *
 * @param onJump その時刻へ再生位置を移す（**辿れないと目印の意味が無い**＝置くだけにしない）。
 */
export function TimelineMarkersSection({
  doc, playheadSec, busy, onAdd, onJump, onText, onRemove,
}: {
  doc: TimelineProject;
  playheadSec: number;
  /** 書き出し中など、編集できないとき（理由つきで押せなくする）。 */
  busy?: { disabled?: boolean; title?: string };
  onAdd: () => void;
  onJump: (timeSec: number) => void;
  onText: (markerId: string, text: string) => void;
  onRemove: (markerId: string) => void;
}) {
  const markers = markersInOrder(doc);
  // ⚠️ **打っている最中は手元の値を使う**＝1文字ごとに文書へ書くと、取り消しがその粒度で積まれる。
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  return (
    <section className="mt-md">
      <div className="row gap-sm" style={{ alignItems: "center" }}>
        <h3 className="section-title" style={{ margin: 0 }}>{MARKER_SECTION_TITLE}</h3>
        <button className="btn btn-secondary" onClick={onAdd} {...(busy ?? {})}>{MARKER_ADD_LABEL}</button>
      </div>
      {markers.length === 0 ? (
        <p className="text-muted">{MARKER_EMPTY_HINT}</p>
      ) : (
        <ul className="list-reset">
          {markers.map((m) => (
            <li key={m.id} className="row gap-sm" style={{ alignItems: "center" }}>
              {/* ⚠️ **辿れること**が目印の本体＝押したらそこへ行く（置くだけにしない）。 */}
              <button
                className="btn btn-ghost"
                onClick={() => onJump(m.timeSec)}
                title={MARKER_JUMP_TITLE}
              >
                {clockLabel(m.timeSec)}
              </button>
              <input
                className="input"
                style={{ flex: "1 1 auto", minWidth: 0 }}
                maxLength={MARKER_TEXT_MAX}
                placeholder={MARKER_TEXT_PLACEHOLDER}
                value={editing?.id === m.id ? editing.text : (m.text ?? "")}
                onChange={(e) => setEditing({ id: m.id, text: e.target.value })}
                // ⚠️ **離れたときに書き込む**＝打つたびに履歴へ積まない（取り消しが1文字ずつになる）。
                onBlur={() => { if (editing?.id === m.id) { onText(m.id, editing.text); setEditing(null); } }}
                {...(busy?.disabled ? { disabled: true } : {})}
              />
              <button className="btn btn-danger" onClick={() => onRemove(m.id)} {...(busy ?? {})}>{DELETE_LABEL}</button>
            </li>
          ))}
        </ul>
      )}
      {/* ⚠️ **いつの位置に置くのかを見せる**＝押す前に分かる（押してから探さない）。 */}
      <p className="text-muted text-sm">いまの再生位置：{clockLabel(playheadSec)}</p>
    </section>
  );
}
