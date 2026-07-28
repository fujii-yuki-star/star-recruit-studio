// タイムライン形式（ADR-0032）の読込・尺の算出。純粋関数（I/O は infrastructure・§4）。
// 場面形式の `project/persistence.ts` と同じ流儀で、読み込めない文書は**生のエラーを UI へ出さず**
// 「次の行動」を示す文言で断る（§2-5・15 §6）。
import { PROJECT_FORMAT } from '../enums';
import { isTimelineProjectDoc } from '../projectFormat';
import { validateTimelineProject } from '../validation/generated/validators.js';
import { clipEndSec } from './validateTimelineDoc';
import type { TimelineProject } from './types';
import { TIMELINE_SCHEMA_VERSION } from './types';

/** 読込に失敗したことを UI へ伝える例外（場面形式の `ProjectLoadError` と同じ役割）。 */
export class TimelineLoadError extends Error {}

/**
 * 文字列(JSON) → タイムライン形式の文書。形式・版・スキーマ適合を確かめる。
 *
 * **場面形式のファイルをここへ渡さない**（呼び出し側が `resolveProjectFormat` で振り分ける前提だが、
 * 取り違えても「形式が違う」と言えるように見る）。スキーマ適合は ajv（`11 §8` V1/V2）に委ね、
 * 相互参照の検証（V22–V28）は `validateTimelineDoc` が別途 `Warning[]` を返す＝**読込は止めない**。
 */
export function parseTimelineProjectDoc(text: string): TimelineProject {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new TimelineLoadError('この動画のファイルを読み取れませんでした。一覧から別の動画を選んでください。');
  }
  if (typeof raw !== 'object' || raw === null || !isTimelineProjectDoc(raw)) {
    throw new TimelineLoadError('この動画はタイムラインで編集する形式ではありません。一覧から別の動画を選んでください。');
  }
  const doc = raw as Record<string, unknown>;
  if (doc.schemaVersion !== TIMELINE_SCHEMA_VERSION) {
    // 版はこの形式だけで独立に進む（11 §1）。合わないのは「新しいアプリで作られた」ケース。
    throw new TimelineLoadError('この動画は新しい形式で作成されています。アプリを更新してください。');
  }
  if (!validateTimelineProject(doc)) {
    console.warn('[timeline] 読み込んだ内容がスキーマに未適合:', validateTimelineProject.errors);
    throw new TimelineLoadError('この動画の内容が正しくありません。一覧から別の動画を選んでください。');
  }
  return doc as unknown as TimelineProject;
}

/**
 * 動画全体の尺（秒）＝**いちばん後ろまで伸びているクリップの終わり**。純粋関数。
 * 場面形式のように「場面尺の合計」ではない＝置いていない時間（隙間）も尺に含まれ、
 * 何も置いていなければ 0（再生ヘッドの上限・書き出しの長さの基準になる）。
 */
export function timelineDurationSec(doc: TimelineProject): number {
  return doc.clips.reduce((max, c) => Math.max(max, clipEndSec(c)), 0);
}

/** 保存用に更新日時を差し替えた文書を返す（保存そのものは infrastructure）。 */
export function withUpdatedAt(doc: TimelineProject, nowIso: string): TimelineProject {
  return { ...doc, format: PROJECT_FORMAT.timeline, updatedAt: nowIso };
}
