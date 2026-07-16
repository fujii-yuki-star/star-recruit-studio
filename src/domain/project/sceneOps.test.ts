import { describe, it, expect } from 'vitest';
import type { Part, Scene } from './types';
import type { Layer, Template } from '../template/types';
import { composeGroupGeometry } from '../group/compose';
import { DEFAULT_LAYER_Z } from '../template/layerOrder';
import { NARRATION_STATUS } from '../enums';
import { duplicateSceneInList, freeLayoutFromPlacedContent, moveSceneInList, moveSceneToIndexInList, rebuildPartSceneIds, splitSceneInList, splitSceneLinesInList, switchSceneTemplate } from './sceneOps';

function scene(id: string, order: number, partId = 'part_001', narration?: Scene['narration']): Scene {
  return {
    sceneId: id,
    partId,
    order,
    sceneType: 'photo_intro',
    templateId: 't1',
    durationSec: 5,
    assetRefs: {},
    character: { enabled: false, characterId: 'yuko' },
    texts: {},
    narration: narration ?? { text: 'こんにちは', status: NARRATION_STATUS.none },
    warnings: [],
  };
}

const onePart = (): Part[] => [
  { partId: 'part_001', title: 'パート1', order: 1, sceneIds: ['scene_001', 'scene_002', 'scene_003'] },
];
const threeScenes = (): Scene[] => [scene('scene_001', 1), scene('scene_002', 2), scene('scene_003', 3)];

describe('moveSceneInList', () => {
  it('下へ移動で順序が入れ替わり order と part.sceneIds が整合する', () => {
    const r = moveSceneInList(threeScenes(), onePart(), 'scene_001', 'down');
    expect(r.scenes.map((s) => s.sceneId)).toEqual(['scene_002', 'scene_001', 'scene_003']);
    expect(r.scenes.map((s) => s.order)).toEqual([1, 2, 3]);
    expect(r.parts[0].sceneIds).toEqual(['scene_002', 'scene_001', 'scene_003']);
  });

  it('上へ移動で順序が入れ替わる', () => {
    const r = moveSceneInList(threeScenes(), onePart(), 'scene_003', 'up');
    expect(r.scenes.map((s) => s.sceneId)).toEqual(['scene_001', 'scene_003', 'scene_002']);
  });

  it('先頭を上・末尾を下へは変化なし（端）', () => {
    expect(moveSceneInList(threeScenes(), onePart(), 'scene_001', 'up').scenes.map((s) => s.sceneId)).toEqual([
      'scene_001',
      'scene_002',
      'scene_003',
    ]);
    expect(moveSceneInList(threeScenes(), onePart(), 'scene_003', 'down').scenes.map((s) => s.sceneId)).toEqual([
      'scene_001',
      'scene_002',
      'scene_003',
    ]);
  });

  it('パートをまたいで移動しても partId は変わらず sceneIds が整合する', () => {
    const parts: Part[] = [
      { partId: 'part_001', title: 'P1', order: 1, sceneIds: ['scene_001'] },
      { partId: 'part_002', title: 'P2', order: 2, sceneIds: ['scene_002'] },
    ];
    const scenes = [scene('scene_001', 1, 'part_001'), scene('scene_002', 2, 'part_002')];
    const r = moveSceneInList(scenes, parts, 'scene_001', 'down');
    expect(r.scenes.map((s) => s.sceneId)).toEqual(['scene_002', 'scene_001']);
    expect(r.scenes[1].partId).toBe('part_001'); // 所属（partId）は維持される
    expect(r.parts[0].sceneIds).toEqual(['scene_001']); // 各パートは所属ベースで再構築
    expect(r.parts[1].sceneIds).toEqual(['scene_002']);
  });
});

describe('moveSceneToIndexInList（ドラッグ&ドロップの任意位置移動・#398）', () => {
  it('下へ移動（from<to）＝結果配列の toIndex に落ち着く', () => {
    const r = moveSceneToIndexInList(threeScenes(), onePart(), 'scene_001', 2);
    expect(r.scenes.map((s) => s.sceneId)).toEqual(['scene_002', 'scene_003', 'scene_001']);
    expect(r.scenes.map((s) => s.order)).toEqual([1, 2, 3]); // order は 1..N で振り直し
    expect(r.parts[0].sceneIds).toEqual(['scene_002', 'scene_003', 'scene_001']); // part.sceneIds も整合
  });

  it('上へ移動（from>to）＝ドロップ先を押し下げて先頭へ', () => {
    const r = moveSceneToIndexInList(threeScenes(), onePart(), 'scene_003', 0);
    expect(r.scenes.map((s) => s.sceneId)).toEqual(['scene_003', 'scene_001', 'scene_002']);
    expect(r.scenes.map((s) => s.order)).toEqual([1, 2, 3]);
  });

  it('中間へ移動', () => {
    const r = moveSceneToIndexInList(threeScenes(), onePart(), 'scene_003', 1);
    expect(r.scenes.map((s) => s.sceneId)).toEqual(['scene_001', 'scene_003', 'scene_002']);
  });

  it('同じ位置は変化なし（同一参照＝未保存/履歴にしない）', () => {
    const scenes = threeScenes();
    const parts = onePart();
    const r = moveSceneToIndexInList(scenes, parts, 'scene_002', 1);
    expect(r.scenes).toBe(scenes);
    expect(r.parts).toBe(parts);
  });

  it('範囲外の toIndex は端にクランプ', () => {
    expect(moveSceneToIndexInList(threeScenes(), onePart(), 'scene_001', 99).scenes.map((s) => s.sceneId)).toEqual([
      'scene_002', 'scene_003', 'scene_001',
    ]);
    expect(moveSceneToIndexInList(threeScenes(), onePart(), 'scene_003', -5).scenes.map((s) => s.sceneId)).toEqual([
      'scene_003', 'scene_001', 'scene_002',
    ]);
  });

  it('存在しない sceneId は変化なし（同一参照）', () => {
    const scenes = threeScenes();
    const r = moveSceneToIndexInList(scenes, onePart(), 'scene_999', 0);
    expect(r.scenes).toBe(scenes);
  });

  it('複数パートでも partId は維持し sceneIds を所属ベースで再構築する', () => {
    const parts: Part[] = [
      { partId: 'part_001', title: 'P1', order: 1, sceneIds: ['scene_001', 'scene_002'] },
      { partId: 'part_002', title: 'P2', order: 2, sceneIds: ['scene_003'] },
    ];
    const scenes = [scene('scene_001', 1, 'part_001'), scene('scene_002', 2, 'part_001'), scene('scene_003', 3, 'part_002')];
    const r = moveSceneToIndexInList(scenes, parts, 'scene_003', 0);
    expect(r.scenes.map((s) => s.sceneId)).toEqual(['scene_003', 'scene_001', 'scene_002']);
    expect(r.scenes.find((s) => s.sceneId === 'scene_003')?.partId).toBe('part_002'); // 所属は不変
    expect(r.parts[0].sceneIds).toEqual(['scene_001', 'scene_002']); // 所属ベースで再構築（順序は配列順）
    expect(r.parts[1].sceneIds).toEqual(['scene_003']);
  });
});

describe('duplicateSceneInList', () => {
  it('直後に複製を挿入し order を振り直す。文言は引き継ぎ音声はリセットする', () => {
    const scenes = [
      scene('scene_001', 1, 'part_001', { text: '会社紹介', status: NARRATION_STATUS.generated, voicePath: 'voices/scene_001.wav' }),
      scene('scene_002', 2),
    ];
    const parts: Part[] = [{ partId: 'part_001', title: 'パート1', order: 1, sceneIds: ['scene_001', 'scene_002'] }];
    const r = duplicateSceneInList(scenes, parts, 'scene_001', 'scene_003');
    expect(r.scenes.map((s) => s.sceneId)).toEqual(['scene_001', 'scene_003', 'scene_002']);
    expect(r.scenes.map((s) => s.order)).toEqual([1, 2, 3]);
    const dup = r.scenes[1];
    expect(dup.narration.text).toBe('会社紹介'); // セリフは引き継ぐ
    expect(dup.narration.status).toBe(NARRATION_STATUS.none); // 音声は作り直し
    expect(dup.narration.voicePath).toBeNull();
    expect(dup.warnings).toEqual([]); // 警告はクリア（再検証前提）
    expect(r.scenes[0].narration.voicePath).toBe('voices/scene_001.wav'); // 元は保持
    expect(r.parts[0].sceneIds).toEqual(['scene_001', 'scene_003', 'scene_002']);
  });

  it('掛け合い場面の複製では行音声も作り直しになる（新 sceneId で音声キーが変わるため・#405 P1）', () => {
    const src: Scene = {
      ...scene('scene_001', 1),
      lines: [
        { lineId: 'line_001', text: 'やあ', speaker: 3, startSec: 0, status: NARRATION_STATUS.generated, voicePath: 'v/a.wav' },
        { lineId: 'line_002', text: 'どうも', speaker: 2, startSec: 2, status: NARRATION_STATUS.generated, voicePath: 'v/b.wav' },
      ],
    };
    const parts: Part[] = [{ partId: 'part_001', title: 'P1', order: 1, sceneIds: ['scene_001'] }];
    const r = duplicateSceneInList([src], parts, 'scene_001', 'scene_003');
    const dup = r.scenes[1];
    expect(dup.lines?.map((l) => l.status)).toEqual([NARRATION_STATUS.none, NARRATION_STATUS.none]); // 作り直し
    expect(dup.lines?.every((l) => l.voicePath === null)).toBe(true);
    // 複製として text/speaker/startSec/lineId は保持。
    expect(dup.lines?.map((l) => l.text)).toEqual(['やあ', 'どうも']);
    expect(dup.lines?.map((l) => l.speaker)).toEqual([3, 2]);
    expect(dup.lines?.map((l) => l.startSec)).toEqual([0, 2]);
    expect(dup.lines?.map((l) => l.lineId)).toEqual(['line_001', 'line_002']);
    // 元場面は保持。
    expect(r.scenes[0].lines?.every((l) => l.status === NARRATION_STATUS.generated)).toBe(true);
  });

  it('存在しない sceneId は変化なし', () => {
    const r = duplicateSceneInList(threeScenes(), onePart(), 'scene_999', 'scene_004');
    expect(r.scenes).toHaveLength(3);
  });
});

describe('rebuildPartSceneIds', () => {
  it('scenes 配列順に合わせて各パートの sceneIds を作り直す（所属は保持）', () => {
    const parts: Part[] = [
      { partId: 'part_001', title: 'P1', order: 1, sceneIds: ['scene_001'] },
      { partId: 'part_002', title: 'P2', order: 2, sceneIds: ['scene_002'] },
    ];
    const scenes = [scene('scene_002', 1, 'part_002'), scene('scene_001', 2, 'part_001')];
    const r = rebuildPartSceneIds(parts, scenes);
    expect(r[0].sceneIds).toEqual(['scene_001']);
    expect(r[1].sceneIds).toEqual(['scene_002']);
  });
});

describe('splitSceneInList', () => {
  it('カーソル位置でセリフを分け、直後に新場面を挿入する（尺は文字数按分・音声はリセット）', () => {
    const scenes = [
      {
        ...scene('scene_001', 1, 'part_001', {
          text: 'こんにちは',
          status: NARRATION_STATUS.generated,
          voicePath: 'voices/scene_001.wav',
        }),
        durationSec: 10,
      },
    ];
    const parts: Part[] = [{ partId: 'part_001', title: 'P1', order: 1, sceneIds: ['scene_001'] }];
    const r = splitSceneInList(scenes, parts, 'scene_001', 2, 'scene_002');
    expect(r.scenes.map((s) => s.sceneId)).toEqual(['scene_001', 'scene_002']);
    expect(r.scenes.map((s) => s.order)).toEqual([1, 2]);
    expect(r.scenes[0].narration.text).toBe('こん');
    expect(r.scenes[1].narration.text).toBe('にちは');
    expect(r.scenes[0].durationSec).toBe(4); // 10秒を 2:3 で按分
    expect(r.scenes[1].durationSec).toBe(6);
    expect(r.scenes[0].narration.status).toBe(NARRATION_STATUS.none);
    expect(r.scenes[0].narration.voicePath).toBeNull();
    expect(r.scenes[1].narration.status).toBe(NARRATION_STATUS.none);
    expect(r.scenes[0].warnings).toEqual([]);
    expect(r.parts[0].sceneIds).toEqual(['scene_001', 'scene_002']);
  });

  it('カーソルが端なら中央に最も近い文末記号で分割する', () => {
    const scenes = [
      { ...scene('scene_001', 1, 'part_001', { text: 'いちです。にいです。', status: NARRATION_STATUS.none }), durationSec: 10 },
    ];
    const parts: Part[] = [{ partId: 'part_001', title: 'P1', order: 1, sceneIds: ['scene_001'] }];
    const r = splitSceneInList(scenes, parts, 'scene_001', 0, 'scene_002');
    expect(r.scenes[0].narration.text).toBe('いちです。');
    expect(r.scenes[1].narration.text).toBe('にいです。');
  });

  it('セリフが短すぎる（1文字以下）と分割しない', () => {
    const scenes = [
      { ...scene('scene_001', 1, 'part_001', { text: 'あ', status: NARRATION_STATUS.none }), durationSec: 10 },
    ];
    const parts: Part[] = [{ partId: 'part_001', title: 'P1', order: 1, sceneIds: ['scene_001'] }];
    const r = splitSceneInList(scenes, parts, 'scene_001', 1, 'scene_002');
    expect(r.scenes).toHaveLength(1);
  });

  it('表示時間が最小尺の2倍未満なら分割しない（各場面が最小尺を割るため）', () => {
    const scenes = [
      { ...scene('scene_001', 1, 'part_001', { text: 'いちです。にいです。', status: NARRATION_STATUS.none }), durationSec: 5 },
    ];
    const parts: Part[] = [{ partId: 'part_001', title: 'P1', order: 1, sceneIds: ['scene_001'] }];
    const r = splitSceneInList(scenes, parts, 'scene_001', 5, 'scene_002');
    expect(r.scenes).toHaveLength(1); // 5 < 2*SCENE_MIN_DURATION_SEC(3) ＝ 変化なし
  });
});

describe('splitSceneLinesInList（掛け合いの行境界分割・#405）', () => {
  const dialogueScene = (over?: Partial<Scene>): Scene => ({
    ...scene('scene_001', 1),
    durationSec: 10,
    lines: [
      { lineId: 'line_001', text: 'やあ', speaker: 3, status: NARRATION_STATUS.generated, voicePath: 'v/a.wav' },
      { lineId: 'line_002', text: 'どうも', speaker: 2, status: NARRATION_STATUS.generated, voicePath: 'v/b.wav' },
      { lineId: 'line_003', text: 'こんにちは', speaker: 3, status: NARRATION_STATUS.generated, voicePath: 'v/c.wav' },
    ],
    ...over,
  });
  const p1 = (): Part[] => [{ partId: 'part_001', title: 'P1', order: 1, sceneIds: ['scene_001'] }];

  it('lineIndex で前後に分け、後半は新場面＝音声/開始秒をリセット（前半は保持）', () => {
    const r = splitSceneLinesInList([dialogueScene()], p1(), 'scene_001', 1, 'scene_002');
    expect(r.scenes.map((s) => s.sceneId)).toEqual(['scene_001', 'scene_002']);
    expect(r.scenes[0].lines?.map((l) => l.lineId)).toEqual(['line_001']); // 前半
    expect(r.scenes[1].lines?.map((l) => l.lineId)).toEqual(['line_002', 'line_003']); // 後半
    expect(r.scenes[0].lines?.[0].status).toBe(NARRATION_STATUS.generated); // 前半は sceneId 不変＝音声保持
    expect(r.scenes[1].lines?.every((l) => l.status === NARRATION_STATUS.none)).toBe(true); // 後半は作り直し
    expect(r.scenes[1].lines?.every((l) => l.voicePath === null)).toBe(true);
    expect(r.scenes[0].durationSec + r.scenes[1].durationSec).toBe(10); // 合計は元のまま（文字数按分）
    expect(r.parts[0].sceneIds).toEqual(['scene_001', 'scene_002']);
  });

  it('先頭（lineIndex 0）では分割しない（前半が空になる）', () => {
    expect(splitSceneLinesInList([dialogueScene()], p1(), 'scene_001', 0, 'scene_002').scenes).toHaveLength(1);
  });

  it('掛け合いでない（lines 無し・1行）は分割しない', () => {
    expect(splitSceneLinesInList([{ ...scene('scene_001', 1), durationSec: 10 }], p1(), 'scene_001', 1, 'scene_002').scenes).toHaveLength(1);
    const oneLine = [dialogueScene({ lines: [{ lineId: 'line_001', text: 'a', status: NARRATION_STATUS.none }] })];
    expect(splitSceneLinesInList(oneLine, p1(), 'scene_001', 1, 'scene_002').scenes).toHaveLength(1);
  });

  it('尺が最小尺の2倍未満なら分割しない', () => {
    expect(splitSceneLinesInList([dialogueScene({ durationSec: 5 })], p1(), 'scene_001', 1, 'scene_002').scenes).toHaveLength(1);
  });

  it('手動 startSec つき掛け合いを分割しても、前半/後半とも範囲外 startSec が残らない（#405 P1）', () => {
    // 10秒場面で line_002 は 6秒開始。line_002 までを前半に分けると前半尺が 6秒未満になり得て、
    // 元は正常だった startSec:6 が新しい尺を超える（→ lineTimeline でクランプされ0秒区間として落ちる）。
    const src = dialogueScene({
      lines: [
        { lineId: 'line_001', text: 'あ', speaker: 3, startSec: 0, status: NARRATION_STATUS.generated, voicePath: 'v/a.wav' },
        { lineId: 'line_002', text: 'い', speaker: 2, startSec: 6, status: NARRATION_STATUS.generated, voicePath: 'v/b.wav' },
        { lineId: 'line_003', text: 'うえおかきくけこ', speaker: 3, startSec: 8, status: NARRATION_STATUS.generated, voicePath: 'v/c.wav' },
      ],
    });
    const r = splitSceneLinesInList([src], p1(), 'scene_001', 2, 'scene_002');
    const [first, second] = r.scenes;
    expect(first.lines?.map((l) => l.lineId)).toEqual(['line_001', 'line_002']); // 前半
    expect(second.lines?.map((l) => l.lineId)).toEqual(['line_003']); // 後半
    // 前半は startSec を自動逐次へ戻す（音声＝status/voicePath は sceneId 不変ゆえ保持）。
    expect(first.lines?.map((l) => l.startSec)).toEqual([undefined, undefined]);
    expect(first.lines?.map((l) => l.status)).toEqual([NARRATION_STATUS.generated, NARRATION_STATUS.generated]);
    expect(first.lines?.map((l) => l.voicePath)).toEqual(['v/a.wav', 'v/b.wav']);
    // 後半は音声も作り直し＋startSec も自動逐次。
    expect(second.lines?.map((l) => l.startSec)).toEqual([undefined]);
    expect(second.lines?.every((l) => l.status === NARRATION_STATUS.none && l.voicePath === null)).toBe(true);
    // 不変条件：どの行の startSec も、その場面の durationSec を超えて残っていない。
    for (const s of r.scenes) {
      for (const l of s.lines ?? []) {
        expect(l.startSec === undefined || l.startSec < s.durationSec).toBe(true);
      }
    }
  });
});

describe('switchSceneTemplate（見た目パターン切替の清算ポリシー・#236）', () => {
  const layer = (id: string, type: Layer['type']): Layer => ({ id, type, x: 0, y: 0, w: 100, h: 100 });
  // 新テンプレのスロット系（background/slot/logo）＋テキスト層。text 層は assetRefs の対象外。
  const newLayers: Layer[] = [layer('background', 'background'), layer('mainVisual', 'slot'), layer('logo', 'logo'), layer('title', 'text')];

  const richScene = (): Scene => ({
    ...scene('scene_001', 1),
    templateId: 'old_tmpl',
    assetRefs: { background: 'asset_bg_001', mainVisual: 'asset_v_001', logo: 'asset_logo_001', oldSlot: 'asset_x_001' },
    slotFits: { mainVisual: 'contain', oldSlot: 'stretch' },
    texts: { title: 'タイトル', main: '本文' },
    textFontIds: { main: 'gen-interface-jp', title: 'gen-interface-jp-display' },
    warnings: [{ code: 'SLOT_REQUIRED_EMPTY', message: '旧テンプレ基準の警告', field: 'assetRefs', severity: 'warning' }],
  });

  it('assetRefs は新テンプレのスロット id（background/slot/logo）だけ残す＝ダングリング清算（§5）', () => {
    const r = switchSceneTemplate(richScene(), 'new_tmpl', newLayers);
    expect(r.assetRefs).toEqual({ background: 'asset_bg_001', mainVisual: 'asset_v_001', logo: 'asset_logo_001' });
    expect(r.assetRefs.oldSlot).toBeUndefined(); // 新テンプレに無いスロット参照は捨てる
  });

  it('slotFits も新テンプレのスロット id だけ残す＝ダングリング清算（assetRefs と同ポリシー・🟡①）', () => {
    const r = switchSceneTemplate(richScene(), 'new_tmpl', newLayers);
    expect(r.slotFits).toEqual({ mainVisual: 'contain' }); // 残るのは新テンプレにある mainVisual のみ
    expect(r.slotFits?.oldSlot).toBeUndefined(); // 新テンプレに無いスロットの収め方は捨てる
  });

  it('texts / textFontIds は保持する（#236＝固定TextKeyキー・別パターンへ変えて戻すと入力が復元）', () => {
    const r = switchSceneTemplate(richScene(), 'new_tmpl', newLayers);
    // 新テンプレが main を使わなくても texts.main / textFontIds.main は残す。
    expect(r.texts).toEqual({ title: 'タイトル', main: '本文' });
    expect(r.textFontIds).toEqual({ main: 'gen-interface-jp', title: 'gen-interface-jp-display' });
  });

  it('templateId を新しい値に更新する', () => {
    expect(switchSceneTemplate(richScene(), 'new_tmpl', newLayers).templateId).toBe('new_tmpl');
  });

  it('warnings はクリアする（旧テンプレ基準の検証結果を引き継がない＝duplicate/split と同ポリシー・再検証前提）', () => {
    expect(switchSceneTemplate(richScene(), 'new_tmpl', newLayers).warnings).toEqual([]);
  });

  it('newCategory を渡すと sceneType が追従する＝FREE 化（自由配置へ変換・0.4.2 動確）', () => {
    expect(switchSceneTemplate(richScene(), 'free_v1', [], 'free').sceneType).toBe('free');
    expect(switchSceneTemplate(richScene(), 'closing_v1', newLayers, 'closing').sceneType).toBe('closing');
  });

  it('newCategory 未指定（旧呼び出し）は sceneType 据え置き（後方互換）', () => {
    const before = richScene();
    expect(switchSceneTemplate(before, 'new_tmpl', newLayers).sceneType).toBe(before.sceneType);
  });

  it('テンプレ未発見（layers 空）でも assetRefs は全清算・texts は保持', () => {
    const r = switchSceneTemplate(richScene(), 'missing', []);
    expect(r.assetRefs).toEqual({});
    expect(r.texts).toEqual({ title: 'タイトル', main: '本文' });
  });
});

describe('switchSceneTemplate 通常↔FREE の非破壊移送（ADR-0030・#524 P1/P2）', () => {
  const layer = (id: string, type: Layer['type'], extra: Partial<Layer> = {}): Layer => ({ id, type, x: 0, y: 0, w: 100, h: 100, ...extra });
  const newLayers: Layer[] = [layer('background', 'background'), layer('mainVisual', 'slot'), layer('logo', 'logo')];
  // 旧テンプレ（通常）：スロット/テキスト層に幾何を持たせて変換の継承を確かめる。
  const prevTemplate = (): Template => ({
    schemaVersion: '1.0', templateId: 'old_tmpl', name: '旧', category: 'opening', aspectRatio: '16:9',
    canvas: { width: 1920, height: 1080 },
    layers: [
      layer('background', 'background', { x: 0, y: 0, w: 1920, h: 1080 }),
      layer('mainVisual', 'slot', { x: 100, y: 200, w: 800, h: 600, rotation: 15, zIndex: 2, fit: 'cover' }),
      layer('logo', 'logo', { x: 50, y: 50, w: 120, h: 120 }),
      layer('title', 'text', { textKey: 'title', x: 200, y: 900, w: 1500, h: 120, fontSize: 64, color: '#ffffff', fontWeight: 'bold' }),
      layer('subtitle', 'subtitle', { textKey: 'subtitle', x: 100, y: 980, w: 1720, h: 80, fontSize: 48, color: '#ffffff' }),
      layer('yuko', 'character', { x: 1300, y: 300, w: 500, h: 700, fit: 'contain' }),
      layer('emptySlot', 'slot', { x: 0, y: 0, w: 10, h: 10 }), // 素材なし＝変換されない
      layer('decor', 'shape', { x: 0, y: 0, w: 100, h: 100 }), // 装飾＝対象外
    ],
  });
  const richScene = (): Scene => ({
    ...scene('scene_001', 1),
    templateId: 'old_tmpl', sceneType: 'opening',
    assetRefs: { background: 'asset_bg', mainVisual: 'asset_v', logo: 'asset_logo', oldSlot: 'asset_dangling' },
    slotFits: { mainVisual: 'contain' },
    texts: { title: 'タイトル', main: '本文' },
    textFontIds: { title: 'gen-interface-jp-display' },
  });

  it('通常→FREE：表示中の素材/文字を freeLayout へ変換（位置/収め方/回転/体裁を継承・空スロット/装飾/テキスト層なしは除外）', () => {
    const r = switchSceneTemplate(richScene(), 'free_v1', [], 'free', prevTemplate());
    const fl = r.freeLayout ?? [];
    const slots = fl.filter((e) => e.kind === 'slot');
    const texts = fl.filter((e) => e.kind === 'text');
    // 素材ありスロット3（bg/mainVisual/logo）＋テキスト層1（title）。emptySlot/decor/main(層なし)/oldSlot(層なし)は除外。
    expect(slots.map((e) => e.assetId).sort()).toEqual(['asset_bg', 'asset_logo', 'asset_v']);
    const mv = slots.find((e) => e.assetId === 'asset_v')!;
    expect(mv).toMatchObject({ x: 100, y: 200, w: 800, h: 600, rotation: 15, fit: 'contain' }); // slotFits(contain) 優先
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatchObject({ text: 'タイトル', x: 200, y: 900, fontSize: 64, color: '#ffffff', fontWeight: 'bold', fontId: 'gen-interface-jp-display' });
    expect(new Set(fl.map((e) => e.id)).size).toBe(fl.length); // id 重複なし
    expect(fl.every((e) => /^free_\d{3}$/.test(e.id))).toBe(true); // free_NNN 採番
    expect(r.assetRefs).toEqual(richScene().assetRefs); // Option A：通常配置は休眠保持（清算しない＝往復で復元・ADR-0030）
  });

  it('seed は freeLayout が空のときだけ（既存の自由配置は上書きしない）', () => {
    const withFree = { ...richScene(), freeLayout: [{ id: 'free_001', kind: 'slot', x: 0, y: 0, w: 10, h: 10, assetId: 'keep' }] } as Scene;
    const r = switchSceneTemplate(withFree, 'free_v1', [], 'free', prevTemplate());
    expect(r.freeLayout).toEqual(withFree.freeLayout);
  });

  it('prevTemplate 未指定（旧呼び出し）は seed しない（後方互換）', () => {
    expect(switchSceneTemplate(richScene(), 'free_v1', [], 'free').freeLayout ?? []).toEqual([]);
  });

  it('通常テンプレ間の切替（newCategory≠free）では seed しない', () => {
    expect(switchSceneTemplate(richScene(), 'closing_v1', newLayers, 'closing', prevTemplate()).freeLayout ?? []).toEqual([]);
  });

  it('FREE→通常は freeLayout を休眠保持（消さない）＝往復で自由配置が戻る', () => {
    const freeSc = { ...richScene(), sceneType: 'free', templateId: 'free_v1', freeLayout: [{ id: 'free_001', kind: 'text', x: 0, y: 0, w: 10, h: 10, text: 'あ' }] } as Scene;
    const r = switchSceneTemplate(freeSc, 'closing_v1', newLayers, 'closing');
    expect(r.sceneType).toBe('closing');
    expect(r.freeLayout).toEqual(freeSc.freeLayout);
  });

  it('通常→FREE：動画クリップ調整（slotClips）を新 FREE 要素 id へ移送（#524 P1）', () => {
    const sc = { ...richScene(), slotClips: { mainVisual: { startSec: 1, endSec: 5, speed: 1.5 } } } as Scene;
    const r = switchSceneTemplate(sc, 'free_v1', [], 'free', prevTemplate());
    const mv = (r.freeLayout ?? []).find((e) => e.assetId === 'asset_v')!;
    expect(r.slotClips?.[mv.id]).toEqual({ startSec: 1, endSec: 5, speed: 1.5 }); // 新 id でクリップ設定が読める
  });

  it('通常→FREE：立ち絵（poseAssetId）を slot 要素で持ち込み・scene.character は休眠保持（#524 P1）', () => {
    const sc = { ...richScene(), character: { enabled: true, characterId: 'yuko', poseAssetId: 'asset_yuko' } } as Scene;
    const r = switchSceneTemplate(sc, 'free_v1', [], 'free', prevTemplate());
    const pose = (r.freeLayout ?? []).find((e) => e.assetId === 'asset_yuko');
    expect(pose).toMatchObject({ kind: 'slot', x: 1300, y: 300, w: 500, h: 700, fit: 'contain' });
    expect(r.character.poseAssetId).toBe('asset_yuko'); // 休眠保持（往復で通常へ戻すと立ち絵が戻る）
  });

  it('通常→FREE：字幕層を subtitle 要素へ（単独=narration／掛け合い=allLines・#524 P1）', () => {
    const single = { ...richScene(), texts: { title: 'タイトル', main: '本文', subtitle: '字幕テキスト' } } as Scene;
    const subS = (switchSceneTemplate(single, 'free_v1', [], 'free', prevTemplate()).freeLayout ?? []).find((e) => e.kind === 'subtitle');
    expect(subS).toMatchObject({ x: 100, y: 980, subtitleSource: { kind: 'narration' } });
    const dialogue = { ...richScene(), lines: [{ lineId: 'line_001', text: 'A', status: 'none' }] } as Scene;
    const subD = (switchSceneTemplate(dialogue, 'free_v1', [], 'free', prevTemplate()).freeLayout ?? []).find((e) => e.kind === 'subtitle')!;
    expect(subD.subtitleSource).toEqual({ kind: 'allLines' });
  });

  it('字幕が出ない単独場面（subtitle 空）は subtitle 要素を作らない', () => {
    const r = switchSceneTemplate(richScene(), 'free_v1', [], 'free', prevTemplate()); // texts.subtitle なし・lines なし
    expect((r.freeLayout ?? []).some((e) => e.kind === 'subtitle')).toBe(false);
  });

  it('通常→FREE：字幕/文字の背景帯（layer.background）を FreeElement.background へ移送（#529）', () => {
    const tmpl: Template = {
      ...prevTemplate(),
      layers: [
        layer('title', 'text', { textKey: 'title', x: 200, y: 900, w: 1500, h: 120, background: { enabled: true, color: '#112233', opacity: 0.4, radius: 8 } }),
        layer('subtitle', 'subtitle', { textKey: 'subtitle', x: 100, y: 980, w: 1720, h: 80, background: { enabled: true, color: '#000000', opacity: 0.6 } }),
      ],
    };
    const sc = { ...richScene(), texts: { title: 'タイトル', subtitle: '字幕' } } as Scene;
    const { elements } = freeLayoutFromPlacedContent(sc, tmpl);
    const t = elements.find((e) => e.kind === 'text')!;
    const s = elements.find((e) => e.kind === 'subtitle')!;
    expect(t.background).toEqual({ enabled: true, color: '#112233', opacity: 0.4, radius: 8 });
    expect(s.background).toEqual({ enabled: true, color: '#000000', opacity: 0.6 });
  });

  it('通常→FREE：背景帯なし（layer.background 未指定）は FreeElement.background を付けない（#529）', () => {
    const t = freeLayoutFromPlacedContent(richScene(), prevTemplate()).elements.find((e) => e.kind === 'text')!;
    expect(t.background).toBeUndefined(); // prevTemplate の title 層は background 未指定
  });

  it('freeLayoutFromPlacedContent 単体：{elements, slotClips} を返す（slotClips 移送マップ）', () => {
    const sc = { ...richScene(), slotClips: { mainVisual: { speed: 2 } } } as Scene;
    const { elements, slotClips } = freeLayoutFromPlacedContent(sc, prevTemplate());
    expect(elements.filter((e) => e.kind === 'slot')).toHaveLength(3);
    expect(elements.filter((e) => e.kind === 'text')).toHaveLength(1);
    const mv = elements.find((e) => e.assetId === 'asset_v')!;
    expect(slotClips[mv.id]).toEqual({ speed: 2 });
  });

  it('通常→FREE：グループ変形・非表示を実効配置で展開（生の座標でなく composeGroupGeometry・#524 P1）', () => {
    const grouped: Template = {
      ...prevTemplate(),
      layers: [
        layer('mainVisual', 'slot', { x: 100, y: 100, w: 200, h: 200 }),
        layer('hiddenSlot', 'slot', { x: 500, y: 500, w: 100, h: 100 }),
      ],
      groups: [
        { id: 'group_001', members: ['mainVisual'], transform: { x: 50, y: 30, scale: 2, rotation: 0 } },
        { id: 'group_002', members: ['hiddenSlot'], transform: { x: 0, y: 0, scale: 1, rotation: 0 }, hidden: true },
      ],
    };
    const sc = { ...richScene(), assetRefs: { mainVisual: 'asset_v', hiddenSlot: 'asset_h' } } as Scene;
    const { elements } = freeLayoutFromPlacedContent(sc, grouped);
    // 非表示グループのメンバー（hiddenSlot）は変換しない（通常描画＝isHiddenByGroup と一致）。
    expect(elements.some((e) => e.assetId === 'asset_h')).toBe(false);
    // mainVisual は実効配置（composeGroupGeometry）で展開＝生の x/y/w/h ではない（グループ移動/拡縮が効く）。
    const expected = composeGroupGeometry(grouped.layers, grouped.groups!).get('mainVisual')!;
    const mv = elements.find((e) => e.assetId === 'asset_v')!;
    expect({ x: mv.x, y: mv.y, w: mv.w, h: mv.h }).toEqual({ x: expected.x, y: expected.y, w: expected.w, h: expected.h });
    expect(mv.x).not.toBe(100); // 生の座標のまま持ち込んでいない
  });

  it('非破壊往復：通常→FREE で通常配置（assetRefs/slotFits）を休眠保持し、FREE→通常で復元（Option A・ADR-0030）', () => {
    const original = richScene();
    const toFree = switchSceneTemplate(original, 'free_v1', [], 'free', prevTemplate());
    expect(toFree.assetRefs).toEqual(original.assetRefs); // FREE でも清算せず休眠保持
    expect(toFree.slotFits).toEqual(original.slotFits);
    // FREE→通常（元の通常テンプレへ）：休眠 assetRefs が新スロット id へ復元（oldSlot は新テンプレに無く落ちる＝#236）。
    const back = switchSceneTemplate(toFree, 'old_tmpl', prevTemplate().layers, 'opening');
    expect(back.assetRefs).toEqual({ background: 'asset_bg', mainVisual: 'asset_v', logo: 'asset_logo' });
    expect(back.slotFits).toEqual({ mainVisual: 'contain' });
    expect(back.sceneType).toBe('opening');
  });

  it('通常→FREE：zIndex 未指定レイヤーは実効 z（種別既定）で展開＝通常描画と重なり順一致（#524 P2）', () => {
    const { elements } = freeLayoutFromPlacedContent(richScene(), prevTemplate()); // prevTemplate は zIndex 未指定
    const bg = elements.find((e) => e.assetId === 'asset_bg')!; // background 層
    const logo = elements.find((e) => e.assetId === 'asset_logo')!; // logo 層
    expect(bg.zIndex).toBe(DEFAULT_LAYER_Z.background); // 0（生の未指定→FREE 既定 1 ではない）
    expect(logo.zIndex).toBe(DEFAULT_LAYER_Z.logo); // 60
    expect((logo.zIndex ?? 0) > (bg.zIndex ?? 0)).toBe(true); // ロゴが背景より前面（通常描画と一致）
  });
});
