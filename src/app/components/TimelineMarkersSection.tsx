// 時間の一点に置く**目印**（#356 ①）の一覧。
//
// ⚠️ **一覧は「補助」**（#1138 レビュー由来 🔴）＝業界の型では印は**時間軸の上に見える**もので、
// 一覧はそこから辿るための道具。印そのものは「並び」のタイムラインに描く（`.timeline-marker`）。
//
// ⚠️ **動画には出ない**＝作業用のメモ（「ここ直す」「ここに効果音」「この間を伸ばす」）。
// 門番＝`src/test/markersNotInVideoGuard.test.ts`（描く側・焼く側が読んでいないことを見る）。
import { CollapsibleSection } from "./CollapsibleSection";
import { SECTION_SCOPE } from "./sectionOpen";
import { markerClock, markersInOrder, markerTimeEq, MARKER_TEXT_MAX } from "../../domain/timeline/markers";
import {
  DELETE_LABEL, MARKER_ADD_LABEL, MARKER_EMPTY_HINT, MARKER_JUMP_TITLE,
  MARKER_MOVE_LABEL, MARKER_MOVE_TITLE, MARKER_SECTION_TITLE, MARKER_TEXT_PLACEHOLDER,
} from "../uiLabels";
import type { TimelineProject } from "../../domain/timeline/types";

/**
 * 目印の一覧と、置く・辿る・書く・動かす・消す。
 *
 * @param onJump その時刻へ再生位置を移す（**見える所まで連れて行く**のは呼ぶ側の責任＝`followPlayhead`）。
 * @param onMove その目印を**再生位置へ動かす**（置けるのに直せない、を作らない＝ADR-0034 決定4）。
 */
export function TimelineMarkersSection({
  doc, playheadSec, busy, textGroup, onAdd, onJump, onText, onMove, onRemove,
}: {
  doc: TimelineProject;
  playheadSec: number;
  /** 押せないとき（書き出し中・再生中など）＝理由つきで押せなくする。 */
  busy?: { disabled?: boolean; title?: string };
  /**
   * 文字欄の履歴のまとめ（#1138 レビュー由来 🔴）。
   *
   * ⚠️ **この画面の文字欄はこれに一本化されている**＝手元 state ＋ `blur` で書き戻す形にすると、
   * **欄が消えるとき `blur` が来ない**（欄を並べ替える・閉じる・画面を離れる）ので
   * **打ちかけが黙って失われる**。`onChange` で書き、まとめは `textGroup` に任せる。
   */
  textGroup: {
    onFocus: (e: { currentTarget: Element | null }) => void;
    onBlur: () => void;
    ref: (el: Element | null) => void;
  };
  onAdd: () => void;
  onJump: (timeSec: number) => void;
  onText: (markerId: string, text: string) => void;
  onMove: (markerId: string) => void;
  onRemove: (markerId: string) => void;
}) {
  const markers = markersInOrder(doc);
  const fps = doc.videoSettings.fps;
  return (
    <CollapsibleSection scope={SECTION_SCOPE.timeline} title={MARKER_SECTION_TITLE} storageKey="markers">
      <button className="btn btn-secondary" onClick={onAdd} {...(busy ?? {})}>{MARKER_ADD_LABEL}</button>
      {markers.length === 0 ? (
        <p className="text-muted">{MARKER_EMPTY_HINT}</p>
      ) : (
        // ⚠️ **自前で縦に流す**（#1138 レビュー由来 🔴）＝この欄は縦に流れないので、行が増えると
        // **帯の取り分を一方的に削り**、欄の高さを超えた行は**切れて到達できなくなる**（#1104 と同じ形）。
        <ul className="list-reset" style={{ maxHeight: "12rem", overflowY: "auto" }}>
          {markers.map((m) => (
            <li
              key={m.id}
              className="row gap-sm"
              style={{ alignItems: "center", ...(markerTimeEq(m.timeSec, playheadSec) ? { outline: "1px solid var(--color-accent)" } : {}) }}
            >
              {/* ⚠️ **辿れること**が目印の本体＝押したらそこへ行く（置くだけにしない）。 */}
              <button className="btn btn-ghost" onClick={() => onJump(m.timeSec)} title={MARKER_JUMP_TITLE}>
                {/* ⚠️ **コマまで出す**＝秒で丸めると `3.1秒` と `3.4秒` が同じ表示になり、一覧で見分けがつかない。 */}
                {markerClock(m.timeSec, fps)}
              </button>
              <input
                className="input"
                style={{ flex: "1 1 auto", minWidth: 0 }}
                maxLength={MARKER_TEXT_MAX}
                placeholder={MARKER_TEXT_PLACEHOLDER}
                value={m.text ?? ""}
                ref={textGroup.ref}
                onFocus={textGroup.onFocus}
                onBlur={textGroup.onBlur}
                onChange={(e) => onText(m.id, e.target.value)}
                {...(busy?.disabled ? { disabled: true } : {})}
              />
              <button className="btn btn-ghost" onClick={() => onMove(m.id)} title={MARKER_MOVE_TITLE} {...(busy ?? {})}>
                {MARKER_MOVE_LABEL}
              </button>
              <button className="btn btn-danger" onClick={() => onRemove(m.id)} {...(busy ?? {})}>{DELETE_LABEL}</button>
            </li>
          ))}
        </ul>
      )}
    </CollapsibleSection>
  );
}
