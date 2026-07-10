import type { Scene } from "../../domain/project/types";
import { sceneLines } from "../../domain/project/narrationLines";

/**
 * 場面カード（場面編集の場面ストリップ）に出す「セリフ先頭」＝最初の非空セリフ行のテキスト。
 * 空行はスキップし、非空が無ければ空文字。全カードが同一アイコンでも中身で見分けられるようにする（#413）。
 */
export function sceneFirstLine(scene: Scene): string {
  return sceneLines(scene).map((l) => l.text.trim()).find((t) => t.length > 0) ?? "";
}
