// 「置くものを選ぶ」一覧（#512 後のレイアウト改善・ADR-0033）。**欄の中に収める**ための部品。
//
// 横に並べると、数が増えたぶんだけ**欄からはみ出して画面の外へ貫通する**（利用者指摘 2026-08-03＝
// 見た目パターンが右へ突き抜ける）。ここでは**縦に並べて欄の中でスクロール**させ、**一度に見せるのは
// 既定 5 件**にする。多いときは**絞り込み**を出して、目当てのものへ数文字で辿り着けるようにする。
//
// 「しまう」だけにしないのが要点＝スクロールと絞り込みで**全部に手が届く**（隠れて選べないものを作らない）。
import { useMemo, useState } from "react";

export interface PickerItem {
  id: string;
  label: string;
  /** 補足（ボタンの説明として出す。一覧には出さない＝行を太らせない）。 */
  note?: string;
}

/** 一度に見せる数の既定。これを超えたら絞り込みを出し、残りは欄の中のスクロールで辿る。 */
const DEFAULT_MAX_VISIBLE = 5;
/** 1行の高さの目安（px）。スクロールする高さを「◯件ぶん」で決めるために使う。 */
const ROW_H = 40;

export function PickerList({
  items,
  onPick,
  disabled,
  disabledHint,
  searchLabel = "絞り込み",
  maxVisible = DEFAULT_MAX_VISIBLE,
}: {
  items: PickerItem[];
  onPick: (id: string) => void;
  disabled?: boolean;
  disabledHint?: string;
  searchLabel?: string;
  maxVisible?: number;
}): React.ReactElement {
  const [query, setQuery] = useState("");
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
        <div style={{ maxHeight: maxVisible * ROW_H, overflowY: "auto" }}>
          {shown.map((it) => (
            <button
              key={it.id}
              className="btn btn-secondary"
              style={{ display: "block", width: "100%", textAlign: "left", marginBottom: 4 }}
              disabled={disabled}
              title={disabled ? disabledHint : it.note}
              onClick={() => onPick(it.id)}
            >
              {it.label}
            </button>
          ))}
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
