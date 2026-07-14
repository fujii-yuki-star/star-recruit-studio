// 場面の構成編集（並べ替え・複製）の純粋ロジック（CLAUDE.md §4：副作用なし・テスト容易）。
// 再生・表示順の「正」＝scenes 配列順（buildExportScenes も scenes 配列を順に処理する）。
// scene.order（1..N）は配列順に追従させ、part.sceneIds は「パート所属＋パート内順序」を保持する目印。
// 並べ替えは scenes 配列の入れ替えで行い partId は変えない（パート間移動は MVP 外＝1パート前提）。
import { SCENE_MIN_DURATION_SEC } from '../constants';
import { FIT, FREE_CATEGORY, FREE_ELEMENT_KIND, NARRATION_STATUS, TEXT_KEY } from '../enums';
import type { SceneCategory } from '../enums';
import type { Layer, Template } from '../template/types';
import { composeGroupGeometry, isHiddenByGroup } from '../group/compose';
import { effectiveLayerZ } from '../template/layerOrder';
import { createFreeElementId } from './persistence';
import { defaultSubtitleSource } from './subtitleBinding';
import type { FreeElement, Part, Scene } from './types';

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
 * - **sceneType は新テンプレのカテゴリに追従する**（0.4.2 動確・FREE 全場面化）：見た目とカテゴリを常に一致させ、
 *   FREE を選べば自由配置に、通常テンプレを選べばその役割に変換する（ピッカーの整合＝`pickableTemplatesForScene` と対）。
 *   newCategory 未指定（旧呼び出し）は sceneType 据え置き（後方互換）。
 * - **通常→FREE は表示中の内容を `freeLayout` へ seed する**（ADR-0030・#524 P1）：旧テンプレ（`prevTemplate`）のスロット素材＋
 *   文字を FreeElement へ変換して持ち込む（`freeLayout` が空のときだけ＝既存の自由配置は上書きしない）。これで FREE 化で
 *   写真・動画・文字が無言消失しない（§2-2）。`prevTemplate` 未指定（旧呼び出し・テスト）は seed しない（後方互換）。
 * - **`freeLayout` は保持（休眠）**：通常テンプレへ戻しても消さない（`texts` と同じ #236 の非対称の延長・ADR-0030）。
 *   通常テンプレでは描画/編集/事前確認/素材使用の対象外（実効表現＝category でゲート）＝休眠データが悪さをしない（P2）。
 */
export function switchSceneTemplate(
  scene: Scene,
  newTemplateId: string,
  newTemplateLayers: Layer[],
  newCategory?: SceneCategory,
  prevTemplate?: Template,
): Scene {
  const slotIds = new Set(
    newTemplateLayers.filter((l) => l.type === 'background' || l.type === 'slot' || l.type === 'logo').map((l) => l.id),
  );
  const toFree = newCategory === FREE_CATEGORY;
  // FREE へ切り替えるときは通常配置（assetRefs/slotFits）を休眠のまま保持し、通常テンプレへ戻すと自動復元する（ADR-0030・非破壊往復）。
  // 通常テンプレへ切り替えるときは #236 どおり新スロット id へ清算＝休眠していた一致分が復元される（ダングリングは sceneActiveAssetIds で無害化済み）。
  const nextAssetRefs = toFree
    ? scene.assetRefs
    : Object.fromEntries(Object.entries(scene.assetRefs).filter(([k]) => slotIds.has(k)));
  const keptFits = toFree
    ? scene.slotFits
    : scene.slotFits
      ? Object.fromEntries(Object.entries(scene.slotFits).filter(([k]) => slotIds.has(k)))
      : undefined;
  // 通常→FREE：表示中の配置内容（スロット素材＋文字＋字幕＋立ち絵）を freeLayout へ seed（空のときだけ・ADR-0030）。旧テンプレの幾何が要る。
  const seeded =
    newCategory === FREE_CATEGORY &&
    prevTemplate &&
    prevTemplate.category !== FREE_CATEGORY &&
    (scene.freeLayout?.length ?? 0) === 0
      ? freeLayoutFromPlacedContent(scene, prevTemplate)
      : undefined;
  return {
    ...scene,
    templateId: newTemplateId,
    sceneType: newCategory ?? scene.sceneType, // 見た目のカテゴリに追従（未指定は据え置き＝後方互換）
    assetRefs: nextAssetRefs,
    slotFits: keptFits && Object.keys(keptFits).length ? keptFits : undefined,
    // 通常→FREE の seed 結果があれば freeLayout を差し替え（空 seed・非該当は ...scene の freeLayout を休眠保持）。
    ...(seeded && seeded.elements.length ? { freeLayout: seeded.elements } : {}),
    // 動画クリップ調整（範囲/速度/元音声）を旧層 id → 新 FREE 要素 id へ移送（#524 P1）。旧キーは休眠のまま残す（往復）。
    ...(seeded && Object.keys(seeded.slotClips).length ? { slotClips: { ...scene.slotClips, ...seeded.slotClips } } : {}),
    // texts / textFontIds は保持（上記ポリシー＝#236）。warnings は再検証前提でクリア。
    warnings: [],
  };
}

/**
 * 通常テンプレの「表示中の配置内容」を FREE 要素へ変換する（ADR-0030・通常→FREE の seed 用）。純粋関数。
 * 旧テンプレのレイヤー幾何（x/y/w/h/rotation/zIndex）ごと、以下を FreeElement へ写す（表示されていないものは持ち込まない）:
 * - スロット層（background/slot/logo）の素材（`assetRefs`）→ slot 要素。**動画クリップ調整（`slotClips`）は新 id へ移送**（#524 P1）。
 * - 立ち絵層（character）の `scene.character.poseAssetId` → slot 要素（画像）。`scene.character` は休眠保持（往復で戻る・#524 P1）。
 * - 文字層（text）のテキスト（`texts`）→ text 要素。
 * - 字幕層（subtitle）→ subtitle 要素（`subtitleSource`＝単独 narration／掛け合い allLines・ADR-0029）。字幕が出る場面のみ（#524 P1）。
 * 装飾レイヤー（shape/背景色）は対象外＝意匠。字幕の背景帯（`layer.background`）は FreeElement に無く引き継がない（既知の軽微差）。
 * 戻り値の `slotClips` は「新 FREE 要素 id → クリップ調整」（呼び出し側 `switchSceneTemplate` が既存 `slotClips` へマージ）。
 */
export function freeLayoutFromPlacedContent(
  scene: Scene,
  template: Template,
): { elements: FreeElement[]; slotClips: NonNullable<Scene['slotClips']> } {
  const elements: FreeElement[] = [];
  const slotClips: NonNullable<Scene['slotClips']> = {};
  const nextId = (): string => createFreeElementId(elements.map((e) => e.id));
  // 通常描画（layoutScene）と同じくグループ transform を前合成し、非表示グループのメンバーは持ち込まない（ADR-0022・#524 P1）。
  // これで生の layer.x/y/w/h ではなく「実効配置」を FREE 要素へ写す＝グループ利用テンプレでも FREE 化直後に崩れない。
  const groups = template.groups ?? [];
  const layerGeom = composeGroupGeometry(template.layers, groups);
  // 字幕を出す場面か（単独＝texts.subtitle が非空かつ OFF でない／掛け合い＝行がある）。出ない場面は空の字幕要素を作らない。
  const hasLines = (scene.lines?.length ?? 0) > 0;
  const staticSubtitle = scene.texts[TEXT_KEY.subtitle];
  const showsSubtitle =
    hasLines || (!!staticSubtitle && staticSubtitle.length > 0 && scene.subtitleEnabledDefault !== false);
  for (const layer of template.layers) {
    if (isHiddenByGroup(layer.id, groups)) continue; // 非表示グループのメンバーは変換しない（通常描画と一致）
    const cg = layerGeom.get(layer.id) ?? { x: layer.x, y: layer.y, w: layer.w, h: layer.h, rotation: layer.rotation };
    const geom = {
      x: cg.x,
      y: cg.y,
      w: cg.w,
      h: cg.h,
      ...(cg.rotation ? { rotation: cg.rotation } : {}),
      zIndex: effectiveLayerZ(layer), // 実効 z（明示 zIndex 優先・無ければ種別既定）＝通常描画と重なり順が一致（#524 P2）
    };
    if (layer.type === 'background' || layer.type === 'slot' || layer.type === 'logo') {
      const assetId = scene.assetRefs[layer.id];
      if (!assetId) continue; // 空スロットは持ち込まない
      const id = nextId();
      elements.push({ id, kind: FREE_ELEMENT_KIND.slot, ...geom, assetId, fit: scene.slotFits?.[layer.id] ?? layer.fit });
      const clip = scene.slotClips?.[layer.id];
      if (clip) slotClips[id] = clip; // 動画クリップ調整を新 id へ移送（#524 P1）
    } else if (layer.type === 'character') {
      const poseId = scene.character?.poseAssetId;
      if (!poseId) continue; // ポーズ未設定は持ち込まない
      // 立ち絵は slot 要素（画像）で持ち込む＝FREE で見えて自由に動かせる。scene.character は休眠保持（往復で戻る）。
      elements.push({ id: nextId(), kind: FREE_ELEMENT_KIND.slot, ...geom, assetId: poseId, fit: layer.fit ?? FIT.contain });
    } else if (layer.type === 'text' && layer.textKey) {
      const text = scene.texts[layer.textKey];
      if (!text) continue; // 空文字は持ち込まない
      elements.push({
        id: nextId(),
        kind: FREE_ELEMENT_KIND.text,
        ...geom,
        text,
        fontSize: layer.fontSize,
        color: layer.color,
        fontWeight: layer.fontWeight,
        fontId: scene.textFontIds?.[layer.textKey],
        ...(layer.strokeColor != null ? { strokeColor: layer.strokeColor } : {}),
        ...(layer.strokeWidth != null ? { strokeWidth: layer.strokeWidth } : {}),
      });
    } else if (layer.type === 'subtitle') {
      if (!showsSubtitle) continue; // 字幕が出ない場面は空の字幕要素を作らない
      // 表示文言は subtitleSource から解決＝el.text は持たない（ADR-0029）。単独→narration／掛け合い→allLines。
      elements.push({
        id: nextId(),
        kind: FREE_ELEMENT_KIND.subtitle,
        ...geom,
        subtitleSource: defaultSubtitleSource(scene),
        fontSize: layer.fontSize,
        color: layer.color,
        fontWeight: layer.fontWeight,
        fontId: layer.textKey ? scene.textFontIds?.[layer.textKey] : undefined,
        ...(layer.strokeColor != null ? { strokeColor: layer.strokeColor } : {}),
        ...(layer.strokeWidth != null ? { strokeWidth: layer.strokeWidth } : {}),
      });
    }
  }
  return { elements, slotClips };
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
