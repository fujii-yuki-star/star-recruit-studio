// タイムライン形式（ADR-0032）の読込・尺の算出。純粋関数（I/O は infrastructure・§4）。
// 場面形式の `project/persistence.ts` と同じ流儀で、読み込めない文書は**生のエラーを UI へ出さず**
// 「次の行動」を示す文言で断る（§2-5・15 §6）。
import { PROJECT_FORMAT } from '../enums';
import { isTimelineProjectDoc } from '../projectFormat';
import { validateTimelineProject } from '../validation/generated/validators.js';
import { effectiveFps, lastFrameSec, quantizeToFrameSec } from './playback';
import { clipEndSec } from './validateTimelineDoc';
import type { TimelineProject } from './types';
import { OLD_PROJECT_AUDIO_AUTO } from '../voice/audioAuto';
import { TIMELINE_SCHEMA_VERSION } from './types';
import { isNewerSchemaVersion, PROJECT_NEWER_VERSION_MESSAGE } from '../schemaVersionCompare';

/**
 * この版のアプリで開けるか（11 §1）。**場面形式と同じ流儀**＝メジャーが同じなら開き、
 * 未対応メジャー（2.0 等）だけ断る。完全一致にすると、後方互換の追加（1.1→1.2 のような additive バンプ）
 * だけで**焼き出し済みの文書がすべて開けなくなる**（ADR-0026②＝同じ概念は同じ挙動）。
 */
export function isSupportedTimelineSchemaVersion(version: string): boolean {
  const major = TIMELINE_SCHEMA_VERSION.split('.')[0];
  return version.startsWith(`${major}.`);
}

/**
 * 旧版の文書を現行版へ引き上げる（11 §1「破壊的変更時はマイグレーションを用意」）。
 *
 * **ここまでのバンプ（1.0→1.9）はいずれも任意フィールドの追加か値域の拡大だけ**（読み上げクリップ・字幕の連動・切り抜き・動き方・音量の変化・動画の元の音＝`11 §1`）なので、
 * データはそのままで版だけ上げれば現行スキーマに適合する。**中身の入れ替えが要るバンプを入れるときは、
 * ここに実際の変換を足すこと**（版だけ上げて通すと、壊れた文書を通してしまう）。
 */
export function migrateTimelineProject(doc: Record<string, unknown>): Record<string, unknown> {
  if (doc.schemaVersion === TIMELINE_SCHEMA_VERSION) return doc;
  const next: Record<string, unknown> = { ...doc, schemaVersion: TIMELINE_SCHEMA_VERSION };
  // 1.9→1.10: 音の自動処理（#257 ダッキング・#259 ノーマライズ）。
  // ⚠️ **既に作った動画の音を変えない**（§2-5・場面形式の 1.28→1.29 と同じ扱い）＝新しい動画では
  // 既定で「する」だが、**前の版で作った動画には明示的に「しない」を書き込む**。書かないと、開いて
  // 書き出し直しただけで BGM の鳴り方と全体の音量が変わり、前に書き出した動画と別物になる。
  // ⚠️ **`videoSettings` は場面形式と `$ref` 共有**なので、片方だけ直すと形式で挙動が割れる（ADR-0026②）。
  const vs = next.videoSettings;
  if (isAudioSettingsRecord(vs) && vs.audioAuto === undefined) {
    next.videoSettings = { ...vs, audioAuto: OLD_PROJECT_AUDIO_AUTO };
  }
  return next;
}

function isAudioSettingsRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 読込に失敗したことを UI へ伝える例外（場面形式の `ProjectLoadError` と同じ役割）。 */
export class TimelineLoadError extends Error {}

/**
 * 文字列(JSON) → タイムライン形式の文書。形式・版・スキーマ適合を確かめる。
 *
 * **場面形式のファイルをここへ渡さない**（呼び出し側が `resolveProjectFormat` で振り分ける前提だが、
 * 取り違えても「形式が違う」と言えるように見る）。スキーマ適合は ajv（`11 §8` V1/V2）に委ねる。
 * 相互参照の検証（V22–V32）は**ここでは見ない**＝`validateTimelineDoc` を画面が呼んで `Warning[]` を
 * 出す（読込は止めない）。焼き出し側もスキーマ未適合なら保存しないので、開けない文書は作られない。
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
  if (typeof doc.schemaVersion !== 'string' || !isSupportedTimelineSchemaVersion(doc.schemaVersion)) {
    // **「バージョン」と言う**（「形式」は場面/タイムラインの別を指す確定語なので、すぐ上の行と同じ語を
    // 別の意味で使わない＝#640 で場面形式側に入れた「版と形式のすり替えをしない」の裏返し・15 §6）。
    throw new TimelineLoadError('この動画は対応していないバージョンで作成されています。アプリを更新してください。');
  }
  // ⚠️ **アプリより新しい版は、引き上げる前に断る**（#793）＝`migrateTimelineProject` は版を
  // **現行へ書き換えるだけ**なので、未来の版を通すと**版の印が黙って下がる**（1.9 の文書が 1.8 に）。
  // しかも新しい語彙が入っていれば ajv が落ちて「この動画の内容が正しくありません」＝**嘘**になる
  //（壊れておらず、アプリを更新すれば開ける・§2-5）。
  if (isNewerSchemaVersion(doc.schemaVersion, TIMELINE_SCHEMA_VERSION)) {
    throw new TimelineLoadError(PROJECT_NEWER_VERSION_MESSAGE);
  }
  // 版を現行へ引き上げてから検証する（ajv は現行版だけを通すので、上げずに渡すと旧版が必ず落ちる）。
  const migrated = migrateTimelineProject(doc);
  if (!validateTimelineProject(migrated)) {
    console.warn('[timeline] 読み込んだ内容がスキーマに未適合:', validateTimelineProject.errors);
    throw new TimelineLoadError('この動画の内容が正しくありません。一覧から別の動画を選んでください。');
  }
  return migrated as unknown as TimelineProject;
}

/**
 * 動画全体の尺（秒）＝**いちばん後ろまで伸びているクリップの終わり**。純粋関数。
 * 場面形式のように「場面尺の合計」ではない＝置いていない時間（隙間）も尺に含まれ、
 * 何も置いていなければ 0（再生ヘッドの上限・書き出しの長さの基準になる）。
 */
export function timelineDurationSec(doc: TimelineProject): number {
  return doc.clips.reduce((max, c) => Math.max(max, clipEndSec(c)), 0);
}

/**
 * その時刻の絵を描くための時刻（秒）。**尺のちょうど末尾は1フレーム手前へ寄せる**。
 *
 * クリップの生存区間は半開 `[start, start+duration)`（V24 と同じ）なので、末尾ちょうどではどのクリップも
 * 外れて**画面が真っ白になる**。場面形式の再生ヘッド（`playhead.ts`）は区間を閉じて「最後のフレームで場面が
 * 消えない」ようにしており、同じ概念が割れないよう**フレームへ量子化**して合わせる
 * （秒＝正準・フレーム＝出力時の量子化＝ADR-0023）。
 */
export function frameTimeSec(doc: TimelineProject, playheadSec: number): number {
  const fps = effectiveFps(doc);
  if (!Number.isFinite(playheadSec)) return 0;
  // **格子へ落としてから**最後のフレームで頭打ちにする＝見せる時刻が必ず `k/fps` になる
  // （落とさずにクランプすると、尺が格子に乗っていないとき書き出しに存在しない時刻の絵を描く）。
  // 頭打ちの位置は**書き出しと同じ導き方**（`lastFrameSec`・#724）＝`total − 1/fps` を自分で計算すると、
  // 尺 × fps が整数でないときに**書き出しの最終フレームへ到達できない**（1.05秒・30fps で 1.0 止まり）。
  return Math.min(Math.max(0, quantizeToFrameSec(playheadSec, fps)), lastFrameSec(doc));
}

/** 保存用に更新日時を差し替えた文書を返す（保存そのものは infrastructure）。 */
export function withUpdatedAt(doc: TimelineProject, nowIso: string): TimelineProject {
  return { ...doc, format: PROJECT_FORMAT.timeline, updatedAt: nowIso };
}
