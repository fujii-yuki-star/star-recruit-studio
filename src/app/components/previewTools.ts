// 仕上がり確認の見出しの道具のうち、**欄が狭いと「…」へ畳むもの**の名前（α 最終点検 2026-10-21）。
//
// どれを畳むかは CSS（欄の幅を測る `@container`）が決め、「…」は**開いた時点で隠れている物**だけを並べる。
// 両者は `data-preview-tool` の値でつながる＝ここが唯一の名簿（CSS の選び方も同じ値を書く）。

export const PREVIEW_TOOL = {
  /** 全体表示（倍率の道具の一部＝`PreviewZoomControl`）。 */
  fit: "fit",
  /** 端の目安を出す。 */
  safe: "safe",
  /** 大きく見る。 */
  big: "big",
  /** 別の窓で見る（別窓の中では描かない）。 */
  window: "window",
} as const;

export type PreviewToolKey = (typeof PREVIEW_TOOL)[keyof typeof PREVIEW_TOOL];

/** 「…」に並べる順＝見出しの行に並ぶ順と同じ。 */
export const PREVIEW_TOOL_ORDER: readonly PreviewToolKey[] = [PREVIEW_TOOL.fit, PREVIEW_TOOL.safe, PREVIEW_TOOL.big, PREVIEW_TOOL.window];
