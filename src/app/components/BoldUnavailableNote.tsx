import { boldLooksSameIn } from "../../domain/font/fontCatalog";
import { BOLD_UNAVAILABLE_NOTE } from "../uiLabels";

/**
 * 太さの欄の下に出す知らせ（#1483・ADR-0038）＝**描く字体が持ち込み・拡張パックの字体なら**、太字を選んでも見た目は変わらない。
 * ⚠️ **欄は押せるまま**（値は残す）＝字体を同梱のものへ戻せば太字が効く。黙って効かない選択肢を並べない、のための知らせ。
 * ⚠️ 字体は**描くときと同じ順**で解いたものを渡す（`effectiveTextFontId`）。
 */
export function BoldUnavailableNote({ fontId }: { fontId: string | null | undefined }) {
  if (!boldLooksSameIn(fontId)) return null;
  return <p className="field-hint" role="note" style={{ margin: "2px 0 0" }}>{BOLD_UNAVAILABLE_NOTE}</p>;
}
