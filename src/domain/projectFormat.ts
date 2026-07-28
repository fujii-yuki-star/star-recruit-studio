// project.json の文書形式の判別（ADR-0032・11 §1）。純粋関数（副作用なし）。
// 場面形式とタイムライン形式のどちらの型にも寄せられないので domain 直下に置く
// （読込の入口＝どちらのスキーマで検証するかを決める前に通る唯一の関数）。
import { DEFAULT_PROJECT_FORMAT, PROJECT_FORMAT } from './enums';
import type { ProjectFormat } from './enums';

/** 形式判別だけに使う最小の形（読込直後＝まだどちらの型でもない生データ）。 */
export interface ProjectFormatProbe {
  format?: unknown;
}

/**
 * 読み込んだ project.json がどちらの形式かを返す（11 §1）。
 *
 * 判定は **`format === 'timeline'` か否かの一点**。それ以外（未指定・未知の値・型違い）は
 * すべて場面形式へ倒す＝既存データ（`format` を持たない）がそのまま読めるため。
 *
 * **場面形式は `format` を書かない**（不在がそのまま「場面形式」を意味する）。`'scene'` は
 * ここが返す**解決値**であって永続化しない値で、書き込むと `project.schema` の
 * `additionalProperties:false` に触れる（CI の must-reject で固定）。
 */
export function resolveProjectFormat(doc: ProjectFormatProbe): ProjectFormat {
  return doc.format === PROJECT_FORMAT.timeline ? PROJECT_FORMAT.timeline : DEFAULT_PROJECT_FORMAT;
}

/** タイムライン形式か（読込先の画面・スキーマを選ぶ分岐で使う）。 */
export function isTimelineProjectDoc(doc: ProjectFormatProbe): boolean {
  return resolveProjectFormat(doc) === PROJECT_FORMAT.timeline;
}
