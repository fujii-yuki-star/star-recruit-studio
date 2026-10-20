import { useId } from "react";
import { TRANSITION_DIRECTION, TRANSITION_TYPE, type TransitionDirection } from "../../domain/enums";

/**
 * 画面の切り替え（トランジション）を**絵で選ぶ**（#1032）。
 *
 * ⚠️ **名前だけの一覧だと、選んで再生してみるまで何が起きるか分からない**＝以前は `<select>` と
 * 「※ 上の『切り替えを見る』で確認できます」という**注釈2文**で補っていた（#1031 §3 の「文章依存」）。
 *
 * ⚠️ **絵は「前の場面 → この場面」の2枚で描く**＝切り替えは**場面と場面の間**の話なので、
 * 1枚だけ描くと「何から何へ」が読めない。左の薄い枠が前の場面、濃い枠がこの場面。
 *
 * ⚠️ **`layoutScene` は使わない**＝ここで見せたいのは**効果の型**であって場面の中身ではない。
 * 中身つきの本物は「切り替えを見る」（`TransitionPreview`）が出す＝そちらが書き出しと同じ絵。
 */
export type TransitionTileValue = string;

/** 効果の並びと名前（値は `deriveTransitionSelectValue` と同じ綴り）。 */
const TILES: readonly (readonly [TransitionTileValue, string])[] = [
  [TRANSITION_TYPE.none, "なし"],
  [TRANSITION_TYPE.fade, "フェード"],
  [`slide:${TRANSITION_DIRECTION.left}`, "スライド（左へ）"],
  [`slide:${TRANSITION_DIRECTION.right}`, "スライド（右へ）"],
  [`slide:${TRANSITION_DIRECTION.up}`, "スライド（上へ）"],
  [`slide:${TRANSITION_DIRECTION.down}`, "スライド（下へ）"],
  // ワイプ・ズーム（ADR-0066）。向きの言葉はスライドと同じ（「左へ」＝次の場面が右から入る）。
  [`wipe:${TRANSITION_DIRECTION.left}`, "ワイプ（左へ）"],
  [`wipe:${TRANSITION_DIRECTION.right}`, "ワイプ（右へ）"],
  [`wipe:${TRANSITION_DIRECTION.up}`, "ワイプ（上へ）"],
  [`wipe:${TRANSITION_DIRECTION.down}`, "ワイプ（下へ）"],
  [TRANSITION_TYPE.zoom, "ズーム"],
];

/** 矢印の向き（スライドが**動いていく先**）。 */
const ARROW: Record<TransitionDirection, string> = {
  [TRANSITION_DIRECTION.left]: "M30 16 L14 16 M20 10 L14 16 L20 22",
  [TRANSITION_DIRECTION.right]: "M14 16 L30 16 M24 10 L30 16 L24 22",
  [TRANSITION_DIRECTION.up]: "M22 24 L22 8 M16 14 L22 8 L28 14",
  [TRANSITION_DIRECTION.down]: "M22 8 L22 24 M16 18 L22 24 L28 18",
};

/** ワイプの絵で、この場面が見えている側（矢印の向きと逆の端から入る）。 */
const WIPE_SHOWN: Record<TransitionDirection, { x: number; y: number; w: number; h: number }> = {
  [TRANSITION_DIRECTION.left]: { x: 25, y: 4, w: 12, h: 24 },
  [TRANSITION_DIRECTION.right]: { x: 13, y: 4, w: 12, h: 24 },
  [TRANSITION_DIRECTION.up]: { x: 13, y: 16, w: 24, h: 12 },
  [TRANSITION_DIRECTION.down]: { x: 13, y: 4, w: 24, h: 12 },
};

/** 1つ分の絵（前の場面＝薄い枠／この場面＝濃い枠）。 */
function TileArt({ value }: { value: TransitionTileValue }): React.ReactElement {
  const [kind, rawDir] = value.split(":");
  const dir = rawDir ? (rawDir as TransitionDirection) : null;
  // ⚠️ **ワイプは1枚の上で境目が動く**＝スライドのように2枚をずらして描くと、押し出しと見分けられない。
  if (kind === TRANSITION_TYPE.wipe && dir) {
    const shown = WIPE_SHOWN[dir];
    return (
      <svg viewBox="0 0 44 32" width="100%" height="34" aria-hidden focusable="false">
        <rect x="13" y="4" width="24" height="24" rx="3" fill="var(--color-surface-alt)" stroke="var(--color-border)" />
        <rect {...shown} fill="var(--color-primary-soft)" stroke="var(--color-primary)" />
        <path d={ARROW[dir]} transform="translate(3 0)" fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  // ⚠️ **ズームは前の場面へ寄る**＝前の場面の中に小さい枠と、外へ広がる角の線。
  if (kind === TRANSITION_TYPE.zoom) {
    return (
      <svg viewBox="0 0 44 32" width="100%" height="34" aria-hidden focusable="false">
        <rect x="10" y="4" width="24" height="24" rx="3" fill="var(--color-surface-alt)" stroke="var(--color-border)" />
        <rect x="17" y="11" width="10" height="10" rx="2" fill="var(--color-primary-soft)" stroke="var(--color-primary)" />
        <path d="M17 11 L12 6 M27 11 L32 6 M17 21 L12 26 M27 21 L32 26" fill="none" stroke="var(--color-primary)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 44 32" width="100%" height="34" aria-hidden focusable="false">
      {/* 前の場面（薄い） */}
      <rect x="1" y="4" width="24" height="24" rx="3" fill="var(--color-surface-alt)" stroke="var(--color-border)" />
      {/* この場面（濃い）。フェードは重なりを半透明で見せる。 */}
      <rect
        x={dir ? 19 : 15}
        y="4"
        width="24"
        height="24"
        rx="3"
        fill="var(--color-primary-soft)"
        stroke="var(--color-primary)"
        opacity={value === TRANSITION_TYPE.fade ? 0.55 : value === TRANSITION_TYPE.none ? 1 : 0.9}
      />
      {dir && (
        <path d={ARROW[dir]} fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      )}
      {/* 「なし」は切り替わらない＝2枚が触れているだけ、を斜線で示す。 */}
      {value === TRANSITION_TYPE.none && (
        <path d="M20 6 L20 26" stroke="var(--color-text-faint)" strokeWidth="2" strokeDasharray="3 3" />
      )}
    </svg>
  );
}

/**
 * 切り替えの選び方（絵つきのタイル）。
 *
 * ⚠️ **見出しはこの部品が描いて欄と結ぶ**（#1075 の流儀）＝選ぶ相手は `<button>` なので、
 * 外で `<label htmlFor>` を書くと**結び忘れた所だけ残る**。
 */
export function TransitionTiles({
  value,
  onChange,
  label,
  disabled,
}: {
  value: TransitionTileValue;
  onChange: (value: TransitionTileValue) => void;
  /** 見出し（この部品が描いて欄と結ぶ）。 */
  label: string;
  disabled?: boolean;
}) {
  const fieldId = useId();
  const labelId = `${fieldId}-label`;
  return (
    <div>
      <span id={labelId} className="field-label" style={{ display: "block" }}>
        {label}
      </span>
      {/* ⚠️ **`radiogroup` にはしない**（矢印キー移動など一式の実装が前提＝`FontPicker` と同じ判断）。
          選んでいるものは `aria-current` で示し、見出しは群に結ぶ。 */}
      <div
        id={fieldId}
        role="group"
        aria-labelledby={labelId}
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))", gap: 6 }}
      >
        {TILES.map(([v, name]) => (
          <button
            key={v}
            type="button"
            disabled={disabled}
            aria-current={v === value ? "true" : undefined}
            aria-label={name}
            title={name}
            // ⚠️ **選び直しは何も起きない**＝同じものを押しても取り消せるものを積まない
            //（`ThumbPicker` と同じ流儀・ADR-0032「何も変わらない操作は積まない」）。
            onClick={() => { if (v !== value) onChange(v); }}
            style={{
              display: "block", width: "100%", padding: 4, cursor: disabled ? "not-allowed" : "pointer",
              border: `1px solid ${v === value ? "var(--color-primary)" : "var(--color-border)"}`,
              borderRadius: "var(--radius-sm)",
              background: v === value ? "var(--color-primary-soft)" : "transparent",
            }}
          >
            <TileArt value={v} />
            <span className="text-sm" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {name}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
