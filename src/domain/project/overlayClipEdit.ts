// タイムライン overlay クリップ（ADR-0018）の「端を動かす」編集の**単一の参照元**（#561）。純粋関数（§4・§7）。
//
// **座標系に依存しない**：呼び出し側が同じ座標系で「いまのクリップ」と「動かした端の新しい値」を渡す。
// タイムライン表示は**グローバル秒**、store の `OverlayClip` は**場面アンカー相対**なので、同じ式を
// 両方から呼べることが要る（ドラッグ中のプレビュー＝ドロップ後の確定＝ADR-0026③・パリティ）。
//
// **なぜ「差分」ではなく「端そのもの」なのか**（#561 の本体）：
// 以前は送り手（TimelineView）が吸着＋クランプした端を `端 - 元の端` で差分にし、受け手（TimelineEditScreen）が
// `長さ + 差分` で足し戻して**同じ下限でもう一度クランプ**していた。この往復は下限へ厳密に戻らない。実測：
//   trim-end  （開始3・長さ3を大きく縮める）→ `0.10000000000000009`（**「長さ（秒）」欄に17桁**）
//   trim-start（開始2・長さ3を右へ大きく）  → `0.09999999999999964`（**下限割れ**＝守っているはずの不変条件を破る）
// 最小長 0.5 ではどちらも起きない（`5 - 4.5` が二進で厳密）＝**今まで露見していなかっただけ**。
// 端そのものを渡せば足し戻しが消え、クランプも1か所（この関数）だけになる。
//
// **ドラッグ結果は 0.1 秒格子へ量子化しない**（設計判断・#561）：場面尺は実数を取りうる（AI 生成も手入力も
// `clampSceneDuration` は量子化しない）ので、量子化すると**格子に乗らない場面境界への吸着が黙って捨てられる**
// （例：3.25 秒の境界へ吸着したのに 3.3 へ動く）。「合わせたところに着く」を優先する（ADR-0026①）。
// 数値欄からの入力は従来どおり利用者が打った値をそのまま使う。

/** クリップのどの端を動かしているか。move=全体、trim-start=左端、trim-end=右端。 */
export type ClipDragMode = 'move' | 'trim-start' | 'trim-end';

/** 編集対象の区間（呼び出し側の座標系での開始秒と長さ）。 */
export interface ClipSpan {
  startSec: number;
  durationSec: number;
}

/**
 * 動かした端を `edgeSec` に置いたときのクリップを返す（クランプ込み）。
 *
 * @param clip     いまのクリップ（`edgeSec` と同じ座標系）
 * @param edgeSec  動かした端の新しい値。move/trim-start は**開始**、trim-end は**終了**（同座標系・吸着済み・未クランプ）
 * @param minStartSec 開始の下限（グローバル秒で呼ぶならアンカー場面の開始／アンカー相対で呼ぶなら 0）
 * @param minClipSec  最小の長さ
 */
export function applyClipEdge(
  clip: ClipSpan,
  mode: ClipDragMode,
  edgeSec: number,
  minStartSec: number,
  minClipSec: number,
): ClipSpan {
  if (mode === 'move') {
    return { startSec: Math.max(minStartSec, edgeSec), durationSec: clip.durationSec };
  }
  const end = clip.startSec + clip.durationSec;
  if (mode === 'trim-end') {
    // **下限との比較は端どうしで行う**（長さを引き算してから `Math.max` すると、`開始 + 最小長` を渡し直したときに
    // `(開始+最小長) - 開始 !== 最小長` で下限をわずかに超える＝同じ入力を2度通すと結果が動く）。
    const minEnd = clip.startSec + minClipSec;
    return { startSec: clip.startSec, durationSec: edgeSec <= minEnd ? minClipSec : edgeSec - clip.startSec };
  }
  // trim-start：右端を固定して左端を動かす。開始は [minStartSec, end−最小長] に収める。
  // **開始の下限が最後に効く**＝極端に短いクリップ（end < minStartSec + minClipSec・壊れた/古いデータ）で
  // 開始が下限を割らない（schema `OverlayClip.startSec >= 0`）。最小長は操作の都合、開始の下限は schema の
  // 制約なので後者を優先する。正しいデータでは両者は衝突しない
  // （startSec ≥ minStartSec かつ durationSec ≥ minClipSec なら end ≥ minStartSec + minClipSec）。
  const maxStart = end - minClipSec;
  const startSec = Math.max(minStartSec, Math.min(edgeSec, maxStart));
  // 最小長で止まったときの長さは**定数そのもの**にする（`end - startSec` の端数を出さない）。
  return { startSec, durationSec: startSec === maxStart ? minClipSec : end - startSec };
}
