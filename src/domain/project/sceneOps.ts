// 場面の構成編集（並べ替え・複製）の純粋ロジック（CLAUDE.md §4：副作用なし・テスト容易）。
// 再生・表示順の「正」＝scenes 配列順（buildExportScenes も scenes 配列を順に処理する）。
// scene.order（1..N）は配列順に追従させ、part.sceneIds は「パート所属＋パート内順序」を保持する目印。
// 並べ替えは scenes 配列の入れ替えで行い partId は変えない（パート間移動は MVP 外＝1パート前提）。
import { SCENE_MIN_DURATION_SEC } from '../constants';
import { NARRATION_STATUS } from '../enums';
import type { Part, Scene } from './types';

/** 各パートの sceneIds を、現在の scenes 配列順（パート所属は保持）に合わせて作り直す。 */
export function rebuildPartSceneIds(parts: Part[], scenes: Scene[]): Part[] {
  return parts.map((p) => ({
    ...p,
    sceneIds: scenes.filter((sc) => sc.partId === p.partId).map((sc) => sc.sceneId),
  }));
}

/** order を配列順に 1..N で振り直す。 */
function reindexOrder(scenes: Scene[]): Scene[] {
  return scenes.map((sc, i) => ({ ...sc, order: i + 1 }));
}

/** 場面を上/下へ1つ移動した結果を返す（端なら変化なし）。 */
export function moveSceneInList(
  scenes: Scene[],
  parts: Part[],
  sceneId: string,
  direction: 'up' | 'down',
): { scenes: Scene[]; parts: Part[] } {
  const idx = scenes.findIndex((s) => s.sceneId === sceneId);
  const swap = direction === 'up' ? idx - 1 : idx + 1;
  if (idx < 0 || swap < 0 || swap >= scenes.length) return { scenes, parts };
  const next = [...scenes];
  [next[idx], next[swap]] = [next[swap], next[idx]];
  const reordered = reindexOrder(next);
  return { scenes: reordered, parts: rebuildPartSceneIds(parts, reordered) };
}

/**
 * 場面を複製し、元の直後に挿入した結果を返す（新IDは呼び出し側が採番して渡す）。
 * 複製された場面は音声を作り直す：voices/<sceneId>.wav は sceneId 単位なので
 * voicePath=null / status='none' にリセットする（ADR-0007・複数場面が同一音声を指す不整合を防ぐ）。
 * セリフ文言・素材割当・クリップ設定などはそのまま引き継ぐ。
 */
export function duplicateSceneInList(
  scenes: Scene[],
  parts: Part[],
  sceneId: string,
  newSceneId: string,
): { scenes: Scene[]; parts: Part[] } {
  const idx = scenes.findIndex((s) => s.sceneId === sceneId);
  if (idx < 0) return { scenes, parts };
  const src = scenes[idx];
  const copy: Scene = {
    ...src,
    sceneId: newSceneId,
    narration: { ...src.narration, status: NARRATION_STATUS.none, voicePath: null },
    // 複製直後は検証し直す前提で警告をクリアする（古い検証結果を引き継がない）。
    warnings: [],
  };
  const next = [...scenes];
  next.splice(idx + 1, 0, copy);
  const reordered = reindexOrder(next);
  return { scenes: reordered, parts: rebuildPartSceneIds(parts, reordered) };
}

/**
 * 場面のセリフ（narration.text）を splitIndex で前半/後半に分け、1場面を2場面にする（Phase 2b・ADR-0007）。
 * 新IDは呼び出し側が採番して渡す。見た目・素材・clip 等は両場面に引き継ぐ。
 * 表示時間は前半/後半の文字数比で按分（合計は不変・各最低1秒）。両場面とも音声は作り直し・warnings はクリア。
 */
export function splitSceneInList(
  scenes: Scene[],
  parts: Part[],
  sceneId: string,
  splitIndex: number,
  newSceneId: string,
): { scenes: Scene[]; parts: Part[] } {
  const idx = scenes.findIndex((s) => s.sceneId === sceneId);
  if (idx < 0) return { scenes, parts };
  const src = scenes[idx];
  // 尺が最小尺の2倍未満だと両場面が最小尺（11 §4）を割るため分割しない。
  if (src.durationSec < 2 * SCENE_MIN_DURATION_SEC) return { scenes, parts };
  const at = resolveSplitIndex(src.narration.text, splitIndex);
  if (at == null) return { scenes, parts }; // セリフが短すぎて分割できない
  const firstText = src.narration.text.slice(0, at).trimEnd();
  const secondText = src.narration.text.slice(at).trimStart();
  const [d1, d2] = apportionDuration(src.durationSec, firstText.length, secondText.length);
  const first: Scene = {
    ...src,
    durationSec: d1,
    narration: { ...src.narration, text: firstText, status: NARRATION_STATUS.none, voicePath: null },
    warnings: [],
  };
  const second: Scene = {
    ...src,
    sceneId: newSceneId,
    durationSec: d2,
    narration: { ...src.narration, text: secondText, status: NARRATION_STATUS.none, voicePath: null },
    warnings: [],
  };
  const next = [...scenes];
  next.splice(idx, 1, first, second);
  const reordered = reindexOrder(next);
  return { scenes: reordered, parts: rebuildPartSceneIds(parts, reordered) };
}

/** 分割位置を [1, len-1] に収める。端/範囲外は中央に近い文末記号→無ければ中央で分割。len<2 は null（分割不能）。 */
function resolveSplitIndex(text: string, index: number): number | null {
  const len = text.length;
  if (len < 2) return null;
  if (index >= 1 && index <= len - 1) return index;
  const mid = Math.floor(len / 2);
  const boundaries: number[] = [];
  for (let i = 1; i < len; i++) {
    if ('。！？!?\n'.includes(text[i - 1])) boundaries.push(i);
  }
  if (boundaries.length === 0) return mid;
  return boundaries.reduce((best, b) => (Math.abs(b - mid) < Math.abs(best - mid) ? b : best));
}

/** 表示時間を文字数比で按分する（各最低 SCENE_MIN_DURATION_SEC・合計は元のまま。最小尺の2倍未満は等分）。 */
function apportionDuration(total: number, len1: number, len2: number): [number, number] {
  const min = SCENE_MIN_DURATION_SEC;
  if (total < 2 * min || len1 + len2 === 0) return [total / 2, total / 2];
  let d1 = Math.round((total * len1) / (len1 + len2));
  d1 = Math.min(Math.max(d1, min), total - min);
  return [d1, total - d1];
}
