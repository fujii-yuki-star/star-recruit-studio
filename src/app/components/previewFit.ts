// プレビュー箱の「収める」計算（縦型 9:16 でもはみ出さないよう幅×高さ両制約で内接）。純粋関数（§7 テスト対象）。
// ScenePreview の fit 計測から使う。JS 計測が空振りしたときの CSS フォールバックも同じ「使える高さ×アスペクト比」で幅を絞る。

/**
 * canvas（cw×ch）を使える領域（availW×availH）にアスペクト比を保って内接させた実寸を返す。
 * scale = min(幅比, 高さ比)＝contain。負/0 入力は {0,0}（呼び出し側は計測前として扱う）。
 */
export function containBox(
  cw: number,
  ch: number,
  availW: number,
  availH: number,
): { width: number; height: number } {
  if (cw <= 0 || ch <= 0 || availW <= 0 || availH <= 0) return { width: 0, height: 0 };
  const scale = Math.min(availW / cw, availH / ch);
  return { width: Math.floor(cw * scale), height: Math.floor(ch * scale) };
}

/** プレビュー上部（タイトルバー＋見出し＋戻る＋余白）に見込む予備高さ(px)。CSS フォールバックの高さ予算＝100vh − これ。 */
export const PREVIEW_TOP_RESERVE_PX = 240;

/**
 * JS 計測前/空振り時の CSS フォールバック幅（縦型でも高さがはみ出さないよう、使える高さ×アスペクト比で幅を絞る）。
 * 幅 = min(100%, (100vh − 予備) × cw/ch)＝箱高さ ≤ (100vh − 予備) になり viewport 内に収まる（aspectRatio が高さを決める）。
 */
export function fallbackWidthCss(cw: number, ch: number): string {
  if (cw <= 0 || ch <= 0) return "100%";
  return `min(100%, calc((100vh - ${PREVIEW_TOP_RESERVE_PX}px) * ${cw} / ${ch}))`;
}
