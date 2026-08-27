// 仕上がり確認の拡大縮小（#142）。**3つの画面が同じものを使う**共有部品。
//
// ⚠️ **共有部品として作る**（利用者条件 2026-08-17・`CLAUDE.md §11`）＝場面編集専用に作ると
// ADR-0032 の凍結（場面形式の編集機能の拡張）とぶつかる。`ScenePreview` を使う画面
//（場面編集・見た目パターン編集・仕上がり確認）すべてに同時に効かせる。
//
// ⚠️ **文書に依存する状態は覚えない**（ADR-0034 決定16）＝倍率は**画面を離れたら戻す**。
// 動画ごとに覚えると、別の動画を開いたときに前の倍率で始まって「なぜか拡大されている」になる。
import { canStepZoom, stepZoom, zoomPercentOf, type PreviewZoom } from "../../domain/preview/previewZoom";

export function PreviewZoomControl({
  zoom,
  fitPercent,
  onChange,
}: {
  zoom: PreviewZoom;
  /** フィット時の実寸%（`ScenePreview` の `onFitPercent` で受けた値）。 */
  fitPercent: number;
  onChange: (next: PreviewZoom) => void;
}) {
  const percent = zoomPercentOf(zoom, fitPercent);
  const canIn = canStepZoom(zoom, "in", fitPercent);
  const canOut = canStepZoom(zoom, "out", fitPercent);
  return (
    <div className="row gap-sm" style={{ alignItems: "center" }}>
      <button
        className="btn btn-ghost btn-icon text-sm"
        aria-label="表示を縮める"
        disabled={!canOut}
        // ⚠️ **押せないときは理由を出す**（§2-5）＝押せるのに何も起きない／押せない理由が無い、を作らない。
        title={canOut ? "表示を縮める" : "これ以上は縮められません"}
        onClick={() => onChange(stepZoom(zoom, "out", fitPercent))}
      >
        −
      </button>
      {/* ⚠️ **いま何%で見えているかを出す**＝フィットは 100% とは限らない（領域で変わる）ので、
          「フィット」とだけ出すと**どれくらいで見ているか**が分からない。 */}
      <span className="text-sm text-muted" style={{ minWidth: "5em", textAlign: "center" }}>
        {zoom === "fit" ? `全体（${percent}%）` : `${percent}%`}
      </span>
      <button
        className="btn btn-ghost btn-icon text-sm"
        aria-label="表示を広げる"
        disabled={!canIn}
        title={canIn ? "表示を広げる" : "これ以上は広げられません"}
        onClick={() => onChange(stepZoom(zoom, "in", fitPercent))}
      >
        ＋
      </button>
      <button
        className="btn btn-ghost text-sm"
        // ⚠️ **戻す先は「全体」**＝倍率の数字ではなく**領域に合わせる**状態へ戻す
        //（100% に戻すと、狭い領域では画面からはみ出したままになる）。
        disabled={zoom === "fit"}
        title={zoom === "fit" ? "いま全体が見えています" : "領域に合わせて全体を見る"}
        onClick={() => onChange("fit")}
      >
        全体表示
      </button>
    </div>
  );
}
