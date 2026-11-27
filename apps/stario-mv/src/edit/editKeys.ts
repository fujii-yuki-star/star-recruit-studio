// 編集のキー（MV-0008 決定4・AE の型）。画面に依存しない純粋な関数。
import {
  moveToPlayheadOps,
  removeOps,
  rippleRemoveOps,
  splitOps,
  stackStepOps,
  trimToPlayheadOps,
} from "./layerOps";
import type { Composition, Op } from "./types";

export type EditKey =
  | "moveIn"
  | "moveOut"
  | "trimIn"
  | "trimOut"
  | "split"
  | "remove"
  | "rippleRemove"
  | "forward"
  | "backward"
  | "selectAll"
  | "snap"
  | "undo"
  | "redo"
  | "precompose"
  | "timeRemap"
  | "reveal";

/**
 * キー → 編集の名前（編集のキーでなければ null）。
 * `[` `]`＝始まり／終わりを今の時刻へ・`Alt+[` `Alt+]`＝今の時刻で切る・`Ctrl+Shift+D`＝分割・
 * `Delete`＝消す・`Shift+Delete`＝消して詰める・`Ctrl+]` `Ctrl+[`＝重なりの順・`Ctrl+A`＝全部選ぶ・`S`＝吸着。
 */
export function editKey(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): EditKey | null {
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  // 元に戻す＝Ctrl+Z・やり直す＝Ctrl+Shift+Z（AE の型）と Ctrl+Y（Windows の慣れ）＝MV-0009 決定6
  if (ctrl && !e.altKey && k === "z") return e.shiftKey ? "redo" : "undo";
  if (ctrl && !e.shiftKey && !e.altKey && k === "y") return "redo";
  if (ctrl && e.shiftKey && k === "d") return "split";
  // プリコンポーズ＝Ctrl+Shift+C（AE と同じ・MV-0011 決定5）
  if (ctrl && e.shiftKey && !e.altKey && k === "c") return "precompose";
  // タイムリマップの入り切り＝Ctrl+Alt+T（AE と同じ・MV-0012 決定4）
  if (ctrl && e.altKey && !e.shiftKey && k === "t") return "timeRemap";
  if (ctrl && !e.shiftKey && k === "a") return "selectAll";
  if (ctrl && k === "]") return "forward";
  if (ctrl && k === "[") return "backward";
  if (ctrl) return null;
  if (e.altKey && k === "[") return "trimIn";
  if (e.altKey && k === "]") return "trimOut";
  if (e.altKey) return null;
  if (k === "[") return "moveIn";
  if (k === "]") return "moveOut";
  if (k === "Delete") return e.shiftKey ? "rippleRemove" : "remove";
  if (k === "s" && !e.shiftKey) return "snap";
  // キーフレームのある値だけを開く＝U（AE と同じ・MV-0014 決定1）
  if (k === "u" && !e.shiftKey) return "reveal";
  return null;
}

/** 編集のキー → 取引の中身（選んでいるレイヤー・今の時刻）。 */
export function editOps(
  key: Exclude<EditKey, "selectAll" | "snap" | "undo" | "redo" | "precompose" | "timeRemap" | "reveal">,
  comp: Composition,
  selected: ReadonlySet<string>,
  playhead: number,
): Op[] {
  switch (key) {
    case "moveIn":
      return moveToPlayheadOps(comp, selected, playhead, "in");
    case "moveOut":
      return moveToPlayheadOps(comp, selected, playhead, "out");
    case "trimIn":
      return trimToPlayheadOps(comp, selected, playhead, "in");
    case "trimOut":
      return trimToPlayheadOps(comp, selected, playhead, "out");
    case "split":
      return splitOps(comp, selected, playhead);
    case "remove":
      return removeOps(comp, selected);
    case "rippleRemove":
      return rippleRemoveOps(comp, selected);
    case "forward":
      return stackStepOps(comp, selected, "forward");
    case "backward":
      return stackStepOps(comp, selected, "backward");
  }
}
