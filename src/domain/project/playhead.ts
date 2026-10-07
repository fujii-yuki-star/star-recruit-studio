// 統合タイムラインの再生ヘッド（ADR-0023 段階(1)・#329）。純粋関数（§4・§7）。
//
// タイムラインは**グローバル秒**、場面の中身（字幕・アニメ・テロップ）は**場面ローカル秒**で決まる。
// その橋渡しだけをここに置く＝「いま何を出すか」の解決は既存の共有関数
// （`segmentAt`／`activeLineIndexAt`／`sceneLocalTelops`＋`activeTelopsAt`／`layoutScene(t)`）が引き続き担う。
// **射影（`compileTimeline`）を読むだけで、正準（場面）には触れない**（ADR-0018 の2モデル方式）。
import type { Timeline } from './compileTimeline';

/** 再生ヘッドの時刻が指す「場面と、その場面の中での秒」。場面が無い時刻は `sceneId: null`。 */
export interface PlayheadFrame {
  sceneId: string | null;
  localSec: number;
}

/** 再生ヘッドの時刻を動画の範囲へ収める（0 未満・尺超えを作らない）。空の動画は 0。 */
export function clampPlayheadSec(timeline: Timeline, sec: number): number {
  if (!Number.isFinite(sec)) return 0;
  return Math.min(Math.max(0, sec), Math.max(0, timeline.totalSec));
}

/**
 * グローバル秒 `sec` が指す場面と、その場面ローカルの秒を返す。
 *
 * **遷移（xfade）の重なりでは「あとから始まった場面」を返す**：切り替え中は2つの場面が重なっており
 * （`compileTimeline` の場面 span も重なる）、静止1枚では**どちらか一方しか出せない**。
 * ここで返すのは「その時刻に**いちばん最後に始まった**場面」＝タイムライン上で手前に見えているクリップと一致し、
 * ヘッドを右へ動かすと場面が戻らない（単調）。**実際の書き出しはこの区間で2場面を混ぜる**点は UI 側で断る
 * （静止フレームは近似＝ADR-0023 段階(1) の範囲。混ぜた絵は段階(2) 以降の再生で扱う）。
 */
export function playheadFrameAt(timeline: Timeline, sec: number): PlayheadFrame {
  const t = clampPlayheadSec(timeline, sec);
  let hit: { sceneId: string; startSec: number; endSec: number } | null = null;
  for (const s of timeline.scenes) {
    // 区間は [開始, 終了]（終端も含む＝最後のフレームで場面が消えない）。同時に該当したら開始が遅いほうを採る。
    if (t < s.startSec || t > s.endSec) continue;
    if (!hit || s.startSec > hit.startSec) hit = { sceneId: s.sceneId, startSec: s.startSec, endSec: s.endSec };
  }
  if (!hit) return { sceneId: null, localSec: 0 };
  // 場面の尺を超えない（丸め誤差で末尾がわずかに超えても場面外の時刻を渡さない）。
  return { sceneId: hit.sceneId, localSec: Math.min(Math.max(0, t - hit.startSec), hit.endSec - hit.startSec) };
}
