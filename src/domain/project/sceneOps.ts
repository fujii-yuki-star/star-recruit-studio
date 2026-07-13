// 場面の構成編集（並べ替え・複製）の純粋ロジック（CLAUDE.md §4：副作用なし・テスト容易）。
// 再生・表示順の「正」＝scenes 配列順（buildExportScenes も scenes 配列を順に処理する）。
// scene.order（1..N）は配列順に追従させ、part.sceneIds は「パート所属＋パート内順序」を保持する目印。
// 並べ替えは scenes 配列の入れ替えで行い partId は変えない（パート間移動は MVP 外＝1パート前提）。
import { SCENE_MIN_DURATION_SEC } from '../constants';
import { NARRATION_STATUS } from '../enums';
import type { Layer } from '../template/types';
import type { Part, Scene } from './types';

/** 各パートの sceneIds を、現在の scenes 配列順（パート所属は保持）に合わせて作り直す。 */
export function rebuildPartSceneIds(parts: Part[], scenes: Scene[]): Part[] {
  return parts.map((p) => ({
    ...p,
    sceneIds: scenes.filter((sc) => sc.partId === p.partId).map((sc) => sc.sceneId),
  }));
}

/**
 * 場面の見た目パターン（テンプレ）を切り替えた結果を返す＝参照スコープの補正（issue #236 の清算ポリシー）。
 * - **assetRefs / slotFits は清算する**：新テンプレに無いスロット（`background`/`slot`/`logo` レイヤーの id）への
 *   参照/収め方を捨てる（11 §5＝キー集合 ⊆ テンプレのスロット id 集合。実在しないスロットへのダングリングを残さない）。
 * - **texts / textFontIds は保持する**：これらは固定の `TextKey` enum がキーでテンプレ非依存ゆえダングリングにならず、
 *   別パターンへ変えて戻したとき入力が復元される（描画は未使用 textKey を無視）。`assetRefs` と非対称だが**意図的**（#236＝保持を採用）。
 *   ※ 将来この非対称を「揃える」目的で texts を清算しないこと（利用者の入力消失になる）。
 * - **warnings はクリアする**：旧テンプレ基準の検証結果（例: 必須スロット未設定）は切替で陳腐化するため引き継がない＝
 *   再検証前提（`duplicateSceneInList`/`splitSceneInList` と同ポリシー）。残すと存在しないスロットの警告などが誤って残る。
 */
export function switchSceneTemplate(scene: Scene, newTemplateId: string, newTemplateLayers: Layer[]): Scene {
  const slotIds = new Set(
    newTemplateLayers.filter((l) => l.type === 'background' || l.type === 'slot' || l.type === 'logo').map((l) => l.id),
  );
  // slotFits も新テンプレのスロット id 集合で清算（assetRefs と同ポリシー＝11 §5・キー ⊆ スロット id）。空なら未設定に。
  const keptFits = scene.slotFits
    ? Object.fromEntries(Object.entries(scene.slotFits).filter(([k]) => slotIds.has(k)))
    : undefined;
  return {
    ...scene,
    templateId: newTemplateId,
    assetRefs: Object.fromEntries(Object.entries(scene.assetRefs).filter(([k]) => slotIds.has(k))),
    slotFits: keptFits && Object.keys(keptFits).length ? keptFits : undefined,
    // texts / textFontIds は保持（上記ポリシー＝#236）。warnings は再検証前提でクリア。
    warnings: [],
  };
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
 * 場面を結果配列の toIndex へ移動した結果を返す（ドラッグ&ドロップの任意位置移動・#398）。
 * toIndex は「移動後の配列でのその場面の index」＝ドロップ先の要素の位置。上下どちらの向きでも直感的に落ち着く
 *（下向き＝ドロップ先の位置へ、上向き＝ドロップ先を押し下げる）。範囲外は端にクランプ。移動後は order を 1..N で振り直し、
 * part.sceneIds もパート所属を保ったまま再構築する（moveSceneInList と同じ整合）。対象なし/位置不変は同一参照を返す（未保存/履歴にしない）。
 */
export function moveSceneToIndexInList(
  scenes: Scene[],
  parts: Part[],
  sceneId: string,
  toIndex: number,
): { scenes: Scene[]; parts: Part[] } {
  const from = scenes.findIndex((s) => s.sceneId === sceneId);
  if (from < 0) return { scenes, parts };
  const to = Math.max(0, Math.min(toIndex, scenes.length - 1));
  if (from === to) return { scenes, parts };
  const next = [...scenes];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  const reordered = reindexOrder(next);
  return { scenes: reordered, parts: rebuildPartSceneIds(parts, reordered) };
}

/**
 * 場面を複製し、元の直後に挿入した結果を返す（新IDは呼び出し側が採番して渡す）。
 * 複製された場面は音声を作り直す：単一 narration は voices/<sceneId>.wav が sceneId 単位、掛け合いの行音声は
 * lineAudioKey(sceneId, lineId) がキー（ADR-0015）で、いずれも新 sceneId では実体が無い。よって narration と scene.lines の
 * 両方について voicePath=null / status='none' にリセットする（「作成済みに見えるのに音声が無い/旧音声を指す」不整合を防ぐ）。
 * 行の lineId/text/speaker/startSec は複製としてそのまま保持（尺・素材割当・クリップ設定なども引き継ぐ）。
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
    // 掛け合い（行ごと音声）も新 sceneId で音声キーが変わるため各行を作り直しにする（lineId/text/speaker/startSec は保持）。
    ...(src.lines ? { lines: src.lines.map((l) => ({ ...l, status: NARRATION_STATUS.none, voicePath: null })) } : {}),
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

/**
 * 掛け合い場面（scene.lines）を行境界で2つに分ける（#405）。lines[0, lineIndex) を前・[lineIndex, 末] を後の場面へ。
 * 後の場面は新 sceneId になり行の音声キー（lineAudioKey）が変わるため、後半の各行の音声状態/パス/開始秒をリセット
 *（作り直し前提・自動逐次に戻す＝splitSceneInList と同ポリシー）。前半は sceneId 不変ゆえ音声（キー）は保つが、
 * 場面尺が d1 に縮むと手動 startSec が新しい尺を超え得る（例: 10秒場面で startSec:6 の行が前半 d1<6 で範囲外→
 * lineTimeline でクランプされ0秒区間として落ち「作成済みなのに出ない」不整合＝ADR-0026 ④）ため、**両場面とも
 * startSec は自動逐次に戻す**（保存された startSec が新しい durationSec を超えて残らないことを保証）。
 * 掛け合いでない/1行/範囲外/尺が最小尺の2倍未満は分割しない（変化なし）。表示時間は各側の総文字数比で按分（各最低 SCENE_MIN_DURATION_SEC・合計は元のまま）。
 */
export function splitSceneLinesInList(
  scenes: Scene[],
  parts: Part[],
  sceneId: string,
  lineIndex: number,
  newSceneId: string,
): { scenes: Scene[]; parts: Part[] } {
  const idx = scenes.findIndex((s) => s.sceneId === sceneId);
  if (idx < 0) return { scenes, parts };
  const src = scenes[idx];
  const lines = src.lines;
  if (!lines || lines.length < 2) return { scenes, parts }; // 掛け合いでない/1行＝分割不能
  if (lineIndex < 1 || lineIndex > lines.length - 1) return { scenes, parts }; // 各側1行以上
  if (src.durationSec < 2 * SCENE_MIN_DURATION_SEC) return { scenes, parts }; // 両場面が最小尺（11 §4）を割る
  // 前半は音声（sceneId 不変ゆえキー lineAudioKey も不変）を保つが、尺が縮み手動 startSec が範囲外になり得るため
  // startSec は自動逐次へ戻す（後半と対称・上記 JSDoc の不整合を分割時に潰す）。lineId/text/speaker/subtitle 等は保持。
  const firstLines = lines.slice(0, lineIndex).map((l) => ({ ...l, startSec: undefined }));
  const secondLines = lines
    .slice(lineIndex)
    .map((l) => ({ ...l, status: NARRATION_STATUS.none, voicePath: null, startSec: undefined }));
  const len1 = firstLines.reduce((n, l) => n + l.text.length, 0);
  const len2 = secondLines.reduce((n, l) => n + l.text.length, 0);
  const [d1, d2] = apportionDuration(src.durationSec, len1, len2);
  const first: Scene = { ...src, durationSec: d1, lines: firstLines, warnings: [] };
  const second: Scene = { ...src, sceneId: newSceneId, durationSec: d2, lines: secondLines, warnings: [] };
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
