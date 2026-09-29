// 「置くものを選ぶ」一覧（#512 後のレイアウト改善・ADR-0033）。**欄の中に収める**ための部品。
//
// 横に並べると、数が増えたぶんだけ**欄からはみ出して画面の外へ貫通する**（利用者指摘 2026-08-03＝
// 見た目パターンが右へ突き抜ける）。ここでは**縦に並べて欄の中でスクロール**させ、**一度に見せるのは
// 既定 5 件**にする。多いときは**絞り込み**を出して、目当てのものへ数文字で辿り着けるようにする。
//
// 「しまう」だけにしないのが要点＝スクロールと絞り込みで**全部に手が届く**（隠れて選べないものを作らない）。
import { useId, useMemo, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { isKeyboardActivation } from "../hooks/usePointerDrag";

export interface PickerItem {
  id: string;
  label: string;
  /** 補足（ボタンの説明として出す。一覧には出さない＝行を太らせない）。 */
  note?: string;
  /** 絵（#1264・`layout="grid"` のとき名前の上に出す）。 */
  thumb?: ReactNode;
  /** 小さな印（#1264・例「使用中」）。名前の横に出す。 */
  badge?: string;
  /**
   * 印の意味（#1271 レビュー）＝説明（`title`）と読み上げ（`aria-describedby`）に使う。無ければ印そのもの。
   * ⚠️ **読み上げは名前に混ぜず説明で届ける**＝印は `aria-hidden` なので、ここが無いと見えない人に届かない
   * （`title` は読み上げでの扱いが不安定）。
   */
  badgeDescription?: string;
}

/** 一度に見せる数の既定。これを超えたら絞り込みを出し、残りは欄の中のスクロールで辿る。 */
const DEFAULT_MAX_VISIBLE = 5;
/** 1行の高さの目安（px）。スクロールする高さを「◯件ぶん」で決めるために使う。 */
const ROW_H = 40;
/** 絵を並べるときの高さの上限（px）＝2段半ほど見せ、残りは欄の中のスクロールで辿る。 */
const GRID_MAX_H = 260;

export function PickerList({
  items,
  onPick,
  onGrab,
  disabled,
  disabledHint,
  searchLabel = "絞り込み",
  maxVisible = DEFAULT_MAX_VISIBLE,
  onHover,
  layout = "list",
}: {
  /**
   * 並べ方（#1264）。`grid`＝絵を並べる（Final Cut Pro・CapCut・Clipchamp の素材の並び）。
   * ⚠️ **名前は残す**＝絵だけだと似た写真を見分けられない・読み上げに名前が要る。既定は従来の `list`。
   */
  layout?: "list" | "grid";
  items: PickerItem[];
  onPick: (id: string) => void;
  disabled?: boolean;
  disabledHint?: string;
  searchLabel?: string;
  maxVisible?: number;
  /**
   * つかんで運べる一覧にする（#684）。押した時点で呼ぶ＝**掴むかどうかは受け取った側が決める**
   * （少し動かすまで掴まない・ADR-0034 決定9）。**動かさずに離したときは `onPick` が走る**ので、
   * 押しただけ・キーボードで選んだだけの経路は変わらない（ドラッグ専用の操作を作らない＝決定19）。
   */
  onGrab?: (e: ReactPointerEvent, id: string) => void;
  /**
   * どれに手を伸ばしているかを知らせる（#1032）＝`id`／離れたら `null`。
   *
   * ⚠️ **押す前に「どこへ入るか」を見せる**ために使う（並びの上に置き先の帯を出す）＝
   * 以前は「再生位置（X秒）から置きます」という**同じ文が4か所**にあり、文章で補っていた。
   * ⚠️ **キーボードでも同じ**＝`focus` でも呼ぶ（ホバー専用の情報を作らない・ADR-0034 決定19）。
   */
  onHover?: (id: string | null) => void;
}): React.ReactElement {
  const [query, setQuery] = useState("");
  const idBase = useId();
  const needle = query.trim().toLowerCase();
  const shown = useMemo(
    () => (needle === "" ? items : items.filter((i) => i.label.toLowerCase().includes(needle))),
    [items, needle],
  );

  return (
    <div>
      {/* 少ないうちは絞り込みを出さない（数個の一覧に検索欄は邪魔）。 */}
      {items.length > maxVisible && (
        <label className="field">
          <span>{searchLabel}</span>
          <input
            type="search"
            value={query}
            placeholder="名前の一部を入れると絞り込めます"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      )}
      {shown.length === 0 ? (
        // §2-5＝次の行動。「0件」で終わらせない。
        <p className="text-muted">見つかりませんでした。別の言葉でお試しください。</p>
      ) : (
        <div
          className={layout === "grid" ? "picker-grid" : undefined}
          style={{ maxHeight: layout === "grid" ? GRID_MAX_H : maxVisible * ROW_H, overflowY: "auto" }}
        >
          {shown.map((it) => {
            const badgeText = it.badge ? (it.badgeDescription ?? it.badge) : undefined;
            return (
            <button
              key={it.id}
              // 掴めるものは**手を出す前に分かる**ようにする（欄の見出し・帯と同じ流儀・#684 レビュー）。
              className={`btn btn-secondary${onGrab ? " grabbable" : ""}${layout === "grid" ? " picker-tile" : ""}`}
              style={layout === "grid" ? undefined : { display: "block", width: "100%", textAlign: "left", marginBottom: 4 }}
              disabled={disabled}
              title={disabled ? disabledHint : [it.note, badgeText].filter(Boolean).join("・") || undefined}
              aria-describedby={badgeText ? `${idBase}-badge-${it.id}` : undefined}
              onPointerDown={onGrab && !disabled ? (e) => onGrab(e, it.id) : undefined}
              onMouseEnter={onHover && !disabled ? () => onHover(it.id) : undefined}
              onMouseLeave={onHover ? () => onHover(null) : undefined}
              onFocus={onHover && !disabled ? () => onHover(it.id) : undefined}
              onBlur={onHover ? () => onHover(null) : undefined}
              // 掴める一覧では、指の経路は掴んだ側（`onEnd`）で完結している＝`click` はキーボードのぶんだけ拾う
              // （拾わないと二重に実行する・#684 レビュー）。掴めない一覧はこれまでどおり全部拾う。
              onClick={(e) => { if (!onGrab || isKeyboardActivation(e)) onPick(it.id); }}
            >
              {layout === "grid" && <span className="picker-tile-thumb" aria-hidden="true">{it.thumb}</span>}
              {layout === "grid" ? <span className="picker-tile-label">{it.label}</span> : it.label}
              {/* ⚠️ **印は名前に混ぜない**（`aria-hidden`）＝ボタンの名前は素材の名前のまま。印の中身は説明（`title`）で言う。 */}
              {it.badge && <span className="badge picker-badge" aria-hidden="true">{it.badge}</span>}
              {badgeText && <span id={`${idBase}-badge-${it.id}`} hidden>{badgeText}</span>}
            </button>
            );
          })}
        </div>
      )}
      {/* 絞り込みで見えている数を出す＝**隠れているものがある**ことが分かる（探し方も添える）。 */}
      {items.length > maxVisible && (
        <p className="text-muted">
          {shown.length === items.length
            ? `全${items.length}件（この中をスクロールできます）`
            : `${items.length}件中${shown.length}件`}
        </p>
      )}
    </div>
  );
}
