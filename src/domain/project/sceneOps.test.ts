import { describe, it, expect } from 'vitest';
import type { FreeElement, Part, Scene } from './types';
import type { Layer, Template } from '../template/types';
import { composeGroupGeometry } from '../group/compose';
import { DEFAULT_LAYER_Z } from '../template/layerOrder';
import { NARRATION_STATUS } from '../enums';
import { duplicateSceneInList, freeContentHiddenBySwitch, freeLayoutFromPlacedContent, moveSceneInList, moveSceneToIndexInList, rebuildPartSceneIds, splitSceneInList, splitSceneLinesInList, switchSceneTemplate } from './sceneOps';
import { DEFAULT_LINE_HEIGHT, DEFAULT_TEMPLATE_MAX_LINES, linesForBoxHeight } from '../template/textStyle';
import { layoutScene, type TextItem } from '../../renderer/layout';
import { wrapText } from '../text/textWrap';

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

  // #553：場面ごとの下限を撤廃＝短い場面でも分割できる（旧実装は 2*3=6秒未満を弾いていた）。守るのは両側 >0 だけ。
  it('短い場面でも分割できる（旧・最小尺の2倍未満ガードは撤廃・#553）', () => {
    const scenes = [
      { ...scene('scene_001', 1, 'part_001', { text: 'いちです。にいです。', status: NARRATION_STATUS.none }), durationSec: 5 },
    ];
    const parts: Part[] = [{ partId: 'part_001', title: 'P1', order: 1, sceneIds: ['scene_001'] }];
    const r = splitSceneInList(scenes, parts, 'scene_001', 5, 'scene_002');
    expect(r.scenes).toHaveLength(2); // 5秒（旧ガードでは不可）でも分割できる
    expect(r.scenes[0].durationSec + r.scenes[1].durationSec).toBeCloseTo(5); // 合計は元のまま
    expect(r.scenes[0].durationSec).toBeGreaterThan(0); // 両側 >0（schema 不変条件）
    expect(r.scenes[1].durationSec).toBeGreaterThan(0);
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

  // #553：場面ごとの下限を撤廃＝短い場面でも行境界で分割できる。分割しないのは尺が 0 以下のときだけ。
  it('短い場面でも分割できる（旧・最小尺の2倍未満ガードは撤廃・#553）', () => {
    const r = splitSceneLinesInList([dialogueScene({ durationSec: 5 })], p1(), 'scene_001', 1, 'scene_002');
    expect(r.scenes).toHaveLength(2);
    expect(r.scenes[0].durationSec).toBeGreaterThan(0);
    expect(r.scenes[1].durationSec).toBeGreaterThan(0);
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

describe('switchSceneTemplate（見た目パターン切替の保持ポリシー・#236／ADR-0030 追補・#547 P3-14）', () => {
  const richScene = (): Scene => ({
    ...scene('scene_001', 1),
    templateId: 'old_tmpl',
    assetRefs: { background: 'asset_bg_001', mainVisual: 'asset_v_001', logo: 'asset_logo_001', oldSlot: 'asset_x_001' },
    slotFits: { mainVisual: 'contain', oldSlot: 'stretch' },
    texts: { title: 'タイトル', main: '本文' },
    textFontIds: { main: 'gen-interface-jp', title: 'gen-interface-jp-display' },
    textStyles: { title: { color: '#ff0000', fontSize: 96 } },
    warnings: [{ code: 'SLOT_REQUIRED_EMPTY', message: '旧テンプレ基準の警告', field: 'assetRefs', severity: 'warning' }],
  });

  it('assetRefs は清算せず全部残す＝差し込み先を失った割当も休眠保持（#547 P3-14）', () => {
    const r = switchSceneTemplate(richScene(), 'new_tmpl');
    expect(r.assetRefs).toEqual({ background: 'asset_bg_001', mainVisual: 'asset_v_001', logo: 'asset_logo_001', oldSlot: 'asset_x_001' });
  });

  it('slotFits も清算しない（assetRefs と同ポリシー＝収め方だけ先に消えない）', () => {
    const r = switchSceneTemplate(richScene(), 'new_tmpl');
    expect(r.slotFits).toEqual({ mainVisual: 'contain', oldSlot: 'stretch' });
  });

  it('往復で戻る：差し込み先の無い種類へ変えても、元の種類へ戻せば割当が復元する（texts と同じ非破壊・ADR-0026②）', () => {
    const away = switchSceneTemplate(richScene(), 'text_only_v1', 'message'); // mainVisual を持たない見た目
    const back = switchSceneTemplate(away, 'old_tmpl', 'photo_intro');
    expect(back.assetRefs.mainVisual).toBe('asset_v_001');
    expect(back.slotFits?.mainVisual).toBe('contain');
  });

  it('texts / textFontIds / textStyles は保持する（#236＝固定TextKeyキー・別パターンへ変えて戻すと入力が復元）', () => {
    const r = switchSceneTemplate(richScene(), 'new_tmpl');
    // 新テンプレが main を使わなくても texts.main / textFontIds.main は残す。
    expect(r.texts).toEqual({ title: 'タイトル', main: '本文' });
    expect(r.textFontIds).toEqual({ main: 'gen-interface-jp', title: 'gen-interface-jp-display' });
    expect(r.textStyles).toEqual({ title: { color: '#ff0000', fontSize: 96 } }); // 体裁も同じ理由で保持（#555）
  });

  it('templateId を新しい値に更新する', () => {
    expect(switchSceneTemplate(richScene(), 'new_tmpl').templateId).toBe('new_tmpl');
  });

  it('warnings はクリアする（旧テンプレ基準の検証結果を引き継がない＝duplicate/split と同ポリシー・再検証前提）', () => {
    expect(switchSceneTemplate(richScene(), 'new_tmpl').warnings).toEqual([]);
  });

  it('newCategory を渡すと sceneType が追従する＝FREE 化（自由配置へ変換・0.4.2 動確）', () => {
    expect(switchSceneTemplate(richScene(), 'free_v1', 'free').sceneType).toBe('free');
    expect(switchSceneTemplate(richScene(), 'closing_v1', 'closing').sceneType).toBe('closing');
  });

  it('newCategory 未指定（旧呼び出し）は sceneType 据え置き（後方互換）', () => {
    const before = richScene();
    expect(switchSceneTemplate(before, 'new_tmpl').sceneType).toBe(before.sceneType);
  });

  it('見た目が見つからない先へ切り替えても assetRefs・texts は消さない（選び直せば戻る）', () => {
    const r = switchSceneTemplate(richScene(), 'missing');
    expect(r.assetRefs).toEqual(richScene().assetRefs);
    expect(r.texts).toEqual({ title: 'タイトル', main: '本文' });
  });
});

describe('switchSceneTemplate 通常↔FREE の非破壊移送（ADR-0030・#524 P1/P2）', () => {
  const layer = (id: string, type: Layer['type'], extra: Partial<Layer> = {}): Layer => ({ id, type, x: 0, y: 0, w: 100, h: 100, ...extra });
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

  // #555：場面で変えた体裁（textStyles）も「表示中の内容」＝FREE へ持ち込む。生の layer.* を写すと、
  // 隣の fontId は per-scene で移送されるのに体裁だけテンプレ既定へ戻る＝FREE 化で見た目が黙って変わる
  // （ADR-0030「表示中の内容を持ち込む」／ADR-0026② 同概念同挙動）。
  it('通常→FREE：場面で変えた文字の体裁（textStyles）も持ち込む＝FREE 化で見た目が戻らない（#555）', () => {
    const styled = {
      ...richScene(),
      texts: { title: 'タイトル', subtitle: '字幕' },
      textStyles: {
        title: { color: '#ff0000', fontSize: 96, fontWeight: 'bold' as const, strokeColor: '#0000ff', strokeWidth: 4 },
        subtitle: { fontSize: 76 },
      },
    };
    const r = switchSceneTemplate(styled, 'free_v1', 'free', prevTemplate());
    const title = (r.freeLayout ?? []).find((e) => e.kind === 'text')!;
    // テンプレ層は fontSize:64 / color:#ffffff / bold。場面の上書きが勝つ。
    expect(title).toMatchObject({ color: '#ff0000', fontSize: 96, fontWeight: 'bold', strokeColor: '#0000ff', strokeWidth: 4 });
    const sub = (r.freeLayout ?? []).find((e) => e.kind === 'subtitle')!;
    expect(sub).toMatchObject({ fontSize: 76, color: '#ffffff' }); // 触っていない色はテンプレ層のまま継承
  });

  // #555 レビュー P1：通常は maxLines（既定2）で行数が決まるが、FREE は枠高から導出する（別モデル）。
  // 枠高をそのまま持ち込むと行が減って文字が切り詰められる（wrapText が末尾を … にする）。
  // **実際の折返し行数**で確かめる（枠高の数値だけ見ても「見える内容が同じ」の担保にならない）。
  it.each([
    { name: 'テンプレのまま（上書きなし）', textStyles: undefined, fontSize: 64 },
    { name: '場面で文字を大きくした（#555）', textStyles: { title: { fontSize: 96 } }, fontSize: 96 },
  ])('通常→FREE：$name でも表示行数が減らない＝文字が切り詰められない（P1）', ({ textStyles, fontSize }) => {
    const long = 'あ'.repeat(30); // 幅1500 なら 64px でも 96px でも2行に折れる長さ
    const styled = { ...richScene(), texts: { title: long }, ...(textStyles ? { textStyles } : {}) } as Scene;
    const tpl = prevTemplate();
    const titleLayer = tpl.layers.find((l) => l.id === 'title')!;
    // 通常テンプレでの表示行数（layoutScene と同じ wrapText・同じ maxLines 既定）。
    const normalLines = wrapText(long, titleLayer.w, fontSize, titleLayer.maxLines ?? DEFAULT_TEMPLATE_MAX_LINES).length;
    expect(normalLines).toBe(2); // 前提：この文字数・幅で2行になっている

    const r = switchSceneTemplate(styled, 'free_v1', 'free', tpl);
    const el = (r.freeLayout ?? []).find((e) => e.kind === 'text')!;
    // FREE 側の行数モデル（枠高から導出）で、同じ行数が出ること。
    const freeMaxLines = linesForBoxHeight(el.h, el.fontSize ?? fontSize);
    expect(freeMaxLines).toBeGreaterThanOrEqual(normalLines);
    expect(wrapText(el.text ?? '', el.w, el.fontSize ?? fontSize, freeMaxLines).length).toBe(normalLines);
    expect((el.text ?? '').length).toBe(long.length); // 文言そのものは持ち込まれている
  });

  // #555 再レビュー P2：テンプレ字幕は下端基準（anchorBottom＝行が増えると上へ伸び下端が動かない）だが、
  // FREE 字幕は上端起点で下へ伸びる。同じ y に置くと2行字幕が1行ぶん下がり、画面下端からはみ出しうる。
  // **実際に描かれる帯の位置**（layoutScene の字幕アイテム）で、変換前後が一致することを見る。
  const bandTop = (item: { y: number; fontSize: number; anchorBottom?: boolean }, lines: number): number =>
    item.y - (item.anchorBottom ? (lines - 1) * item.fontSize * DEFAULT_LINE_HEIGHT : 0);

  it.each([
    { name: '既定サイズ', fontSize: undefined, expectLines: 2 },
    { name: '場面で大きくした（#555）', fontSize: 60, expectLines: 2 },
  ])('通常→FREE：2行字幕の帯の位置が変わらない（$name・下端基準を座標へ翻訳・P2）', ({ fontSize, expectLines }) => {
    const long = 'あ'.repeat(50); // 幅1720 の字幕層で2行に折れる長さ
    const base = {
      ...richScene(),
      texts: { subtitle: long },
      ...(fontSize ? { textStyles: { subtitle: { fontSize } } } : {}),
    } as Scene;
    const tpl = prevTemplate();
    // 変換前：通常テンプレでの字幕帯の上端。
    const before = layoutScene(base, tpl).items.find((i) => i.id === 'subtitle') as TextItem;
    expect(wrapText(before.text, before.w, before.fontSize, before.maxLines).length).toBe(expectLines); // 前提：2行
    const topBefore = bandTop(before, expectLines);

    // 変換後：FREE テンプレでの同じ字幕の上端。
    const freeTpl = { ...tpl, templateId: 'free_v1', category: 'free', layers: [] } as unknown as Template;
    const r = switchSceneTemplate(base, 'free_v1', 'free', tpl);
    const after = layoutScene(r, freeTpl).items.find((i) => i.kind === 'text' && i.isSubtitle) as TextItem;
    expect(after).toBeTruthy();
    expect(wrapText(after.text, after.w, after.fontSize, after.maxLines).length).toBe(expectLines); // 行は減っていない（P1）
    expect(bandTop(after, expectLines)).toBeCloseTo(topBefore, 5); // 帯の位置が一致（P2）
  });

  it('通常→FREE：1行字幕は元から一致しているので動かさない', () => {
    const base = { ...richScene(), texts: { subtitle: '短い字幕' } } as Scene;
    const tpl = prevTemplate();
    const r = switchSceneTemplate(base, 'free_v1', 'free', tpl);
    const el = (r.freeLayout ?? []).find((e) => e.kind === 'subtitle')!;
    expect(el.y).toBe(tpl.layers.find((l) => l.id === 'subtitle')!.y); // y 据え置き
  });

  it('通常→FREE：枠が十分に高いときは広げない（幾何をむやみに変えない）', () => {
    const tall = prevTemplate();
    tall.layers = tall.layers.map((l) => (l.id === 'title' ? { ...l, h: 900 } : l));
    const r = switchSceneTemplate(richScene(), 'free_v1', 'free', tall);
    expect((r.freeLayout ?? []).find((e) => e.kind === 'text')!.h).toBe(900); // 旧テンプレの枠高のまま
  });

  it('通常→FREE：場面で縁取りの太さだけ足したときも既定色ごと持ち込む（縁取りが消えない・#555）', () => {
    // テンプレ層に縁取りが無く、場面で太さだけ足した状態。**解決済みの色**を写すので、変換後に文字色を
    // いじっても FREE 化した時点の見た目が保たれる（#565 で FREE 側にも同じ既定が入ったが、写す方が変換の
    // 「見えているものをそのまま持ち込む」に忠実）。この層は白文字なので既定の縁取りは黒（#565）。
    const styled = { ...richScene(), textStyles: { title: { strokeWidth: 3 } } };
    const r = switchSceneTemplate(styled, 'free_v1', 'free', prevTemplate());
    const title = (r.freeLayout ?? []).find((e) => e.kind === 'text')!;
    expect(title).toMatchObject({ strokeWidth: 3, strokeColor: '#000000' });
  });

  it('通常→FREE：表示中の素材/文字を freeLayout へ変換（位置/収め方/回転/体裁を継承・空スロット/装飾/テキスト層なしは除外）', () => {
    const r = switchSceneTemplate(richScene(), 'free_v1', 'free', prevTemplate());
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
    const r = switchSceneTemplate(withFree, 'free_v1', 'free', prevTemplate());
    expect(r.freeLayout).toEqual(withFree.freeLayout);
  });

  it('prevTemplate 未指定（旧呼び出し）は seed しない（後方互換）', () => {
    expect(switchSceneTemplate(richScene(), 'free_v1', 'free').freeLayout ?? []).toEqual([]);
  });

  it('通常テンプレ間の切替（newCategory≠free）では seed しない', () => {
    expect(switchSceneTemplate(richScene(), 'closing_v1', 'closing', prevTemplate()).freeLayout ?? []).toEqual([]);
  });

  it('FREE→通常は freeLayout を休眠保持（消さない）＝往復で自由配置が戻る', () => {
    const freeSc = { ...richScene(), sceneType: 'free', templateId: 'free_v1', freeLayout: [{ id: 'free_001', kind: 'text', x: 0, y: 0, w: 10, h: 10, text: 'あ' }] } as Scene;
    const r = switchSceneTemplate(freeSc, 'closing_v1', 'closing');
    expect(r.sceneType).toBe('closing');
    expect(r.freeLayout).toEqual(freeSc.freeLayout);
  });

  it('通常→FREE：動画クリップ調整（slotClips）を新 FREE 要素 id へ移送（#524 P1）', () => {
    const sc = { ...richScene(), slotClips: { mainVisual: { startSec: 1, endSec: 5, speed: 1.5 } } } as Scene;
    const r = switchSceneTemplate(sc, 'free_v1', 'free', prevTemplate());
    const mv = (r.freeLayout ?? []).find((e) => e.assetId === 'asset_v')!;
    expect(r.slotClips?.[mv.id]).toEqual({ startSec: 1, endSec: 5, speed: 1.5 }); // 新 id でクリップ設定が読める
  });

  it('通常→FREE：立ち絵（poseAssetId）を slot 要素で持ち込み・scene.character は休眠保持（#524 P1）', () => {
    const sc = { ...richScene(), character: { enabled: true, characterId: 'yuko', poseAssetId: 'asset_yuko' } } as Scene;
    const r = switchSceneTemplate(sc, 'free_v1', 'free', prevTemplate());
    const pose = (r.freeLayout ?? []).find((e) => e.assetId === 'asset_yuko');
    expect(pose).toMatchObject({ kind: 'slot', x: 1300, y: 300, w: 500, h: 700, fit: 'contain' });
    expect(r.character.poseAssetId).toBe('asset_yuko'); // 休眠保持（往復で通常へ戻すと立ち絵が戻る）
  });

  it('通常→FREE：字幕層を subtitle 要素へ（単独=narration／掛け合い=allLines・#524 P1）', () => {
    const single = { ...richScene(), texts: { title: 'タイトル', main: '本文', subtitle: '字幕テキスト' } } as Scene;
    const subS = (switchSceneTemplate(single, 'free_v1', 'free', prevTemplate()).freeLayout ?? []).find((e) => e.kind === 'subtitle');
    expect(subS).toMatchObject({ x: 100, y: 980, subtitleSource: { kind: 'narration' } });
    const dialogue = { ...richScene(), lines: [{ lineId: 'line_001', text: 'A', status: 'none' }] } as Scene;
    const subD = (switchSceneTemplate(dialogue, 'free_v1', 'free', prevTemplate()).freeLayout ?? []).find((e) => e.kind === 'subtitle')!;
    expect(subD.subtitleSource).toEqual({ kind: 'allLines' });
  });

  it('字幕が出ない単独場面（subtitle 空）は subtitle 要素を作らない', () => {
    const r = switchSceneTemplate(richScene(), 'free_v1', 'free', prevTemplate()); // texts.subtitle なし・lines なし
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

  /**
   * ⚠️ **場面別の上書き（`scene.textStyles[key]`）は帯にも効く**（PR #879 再レビュー 🔴）。
   * 以前は生の `layer.background` を写していたので、**場面で変えた帯だけテンプレ既定へ戻って**いた
   *（隣の色・大きさは実効値を写していたのに帯だけ＝ADR-0026② の非対称）。
   */
  it('通常→FREE：背景帯も場面別の上書きを写す（テンプレ既定へ戻さない）', () => {
    const tmpl: Template = {
      ...prevTemplate(),
      layers: [layer('title', 'text', { textKey: 'title', x: 0, y: 0, w: 100, h: 50, background: { enabled: true, color: '#111111', opacity: 0.2 } })],
    };
    const sc = {
      ...richScene(),
      texts: { title: 'タイトル' },
      textStyles: { title: { background: { enabled: true, color: '#ff0000', opacity: 0.9, radius: 20 } } },
    } as unknown as Scene;
    const t = freeLayoutFromPlacedContent(sc, tmpl).elements.find((e) => e.kind === 'text')!;
    expect(t.background).toEqual({ enabled: true, color: '#ff0000', opacity: 0.9, radius: 20 });
  });

  it('通常→FREE：字幕の背景帯も場面別の上書きを写す', () => {
    const tmpl: Template = {
      ...prevTemplate(),
      layers: [layer('subtitle', 'subtitle', { textKey: 'subtitle', x: 0, y: 0, w: 100, h: 50, background: { enabled: true, color: '#111111' } })],
    };
    const sc = {
      ...richScene(),
      texts: { subtitle: '字幕' },
      textStyles: { subtitle: { background: { enabled: true, color: '#00ff00', opacity: 0.3 } } },
    } as unknown as Scene;
    const el = freeLayoutFromPlacedContent(sc, tmpl).elements.find((e) => e.kind === 'subtitle')!;
    expect(el.background).toEqual({ enabled: true, color: '#00ff00', opacity: 0.3 });
  });

  /** ⚠️ **`FreeElement.background` は生の形**（`enabled` を持つ）＝解決後の帯を入れると往復で形が変わる。 */
  it('通常→FREE：帯は「生の形」で写す（解決後の既定埋め済みの形にしない）', () => {
    const tmpl: Template = {
      ...prevTemplate(),
      layers: [layer('title', 'text', { textKey: 'title', x: 0, y: 0, w: 100, h: 50, background: { enabled: true, color: '#112233' } })],
    };
    const sc = { ...richScene(), texts: { title: 'あ' } } as Scene;
    const t = freeLayoutFromPlacedContent(sc, tmpl).elements.find((e) => e.kind === 'text')!;
    // 既定（濃さ 0.55・角丸 16）を埋めない＝テンプレが持っていたものだけ。
    expect(t.background).toEqual({ enabled: true, color: '#112233' });
  });

  it('通常→FREE：テンプレ既定素材（ADR-0021）も持ち込む（描画と同じ解決＝切替で絵が消えない）', () => {
    const tmpl: Template = {
      ...prevTemplate(),
      layers: [layer('mainVisual', 'slot', { x: 0, y: 0, w: 100, h: 100, assetId: 'tmpl_asset_001' })],
    };
    const sc = { ...richScene(), assetRefs: {} } as Scene;
    const { elements } = freeLayoutFromPlacedContent(sc, tmpl);
    expect(elements.find((e) => e.kind === 'slot')?.assetId).toBe('tmpl_asset_001');
  });

  it('通常→FREE：ロゴの収め方は contain（自由配置の既定 cover に任せると切り取られる）', () => {
    const tmpl: Template = {
      ...prevTemplate(),
      layers: [layer('logo', 'logo', { x: 0, y: 0, w: 100, h: 100 })],
    };
    const sc = { ...richScene(), assetRefs: { logo: 'asset_logo' } } as Scene;
    const { elements } = freeLayoutFromPlacedContent(sc, tmpl);
    expect(elements.find((e) => e.kind === 'slot')?.fit).toBe('contain');
  });

  it('faithful：描かれるものをすべて写す（図形・空のスロット・素材の無い背景の塗り）', () => {
    const tmpl: Template = {
      ...prevTemplate(),
      layers: [
        layer('background', 'background', { x: 0, y: 0, w: 1920, h: 1080, fillColor: '#123456' }),
        layer('deco', 'shape', { x: 10, y: 10, w: 50, h: 50, fillColor: '#ff0000' }),
        layer('mainVisual', 'slot', { x: 100, y: 100, w: 200, h: 200 }),
      ],
    };
    const sc = { ...richScene(), assetRefs: {} } as Scene;
    expect(freeLayoutFromPlacedContent(sc, tmpl).elements).toHaveLength(0); // 既定（切替）は持ち込まない
    const faithful = freeLayoutFromPlacedContent(sc, tmpl, { faithful: true }).elements;
    expect(faithful).toHaveLength(3);
    expect(faithful.filter((e) => e.kind === 'shape')).toHaveLength(2); // 背景の塗り＋図形
    expect(faithful.find((e) => e.kind === 'slot')?.assetId).toBeNull(); // 空の枠はそのまま
  });

  it('freeLayoutFromPlacedContent 単体：{elements, slotClips} を返す（slotClips 移送マップ）', () => {
    const sc = { ...richScene(), slotClips: { mainVisual: { speed: 2 } } } as Scene;
    const { elements, slotClips } = freeLayoutFromPlacedContent(sc, prevTemplate());
    expect(elements.filter((e) => e.kind === 'slot')).toHaveLength(3);
    expect(elements.filter((e) => e.kind === 'text')).toHaveLength(1);
    const mv = elements.find((e) => e.assetId === 'asset_v')!;
    expect(slotClips[mv.id]).toEqual({ speed: 2 });
  });

  // #831＝バラす（explode.ts）が「立ち絵の動画」と「差し込み口でない層の動画」を取り違えないために、
  // characterElementIds を直接見る。統合テスト（explodeParity.test.ts）だけに任せず、この関数自身の
  // 戻り値としても固定する（§7・ほかのフィールドと同じ流儀）。
  it('freeLayoutFromPlacedContent 単体：立ち絵の要素は characterElementIds に入る（差し込み口とは別扱い・#831）', () => {
    const sc = { ...richScene(), character: { enabled: true, characterId: 'yuko', poseAssetId: 'asset_yuko' } } as Scene;
    const { elements, slotLayerByElementId, characterElementIds } = freeLayoutFromPlacedContent(sc, prevTemplate());
    const pose = elements.find((e) => e.assetId === 'asset_yuko')!;
    expect(characterElementIds.has(pose.id)).toBe(true);
    expect(slotLayerByElementId[pose.id]).toBeUndefined(); // 差し込み口の層ではない＝対応表には入らない（#512 段3b）
  });

  it('freeLayoutFromPlacedContent 単体：ポーズ未設定なら要素も characterElementIds も増えない', () => {
    const sc = { ...richScene(), character: { enabled: false, characterId: 'yuko' } } as Scene; // poseAssetId なし
    const { elements, characterElementIds } = freeLayoutFromPlacedContent(sc, prevTemplate());
    expect(elements.some((e) => e.assetId === 'asset_yuko')).toBe(false);
    expect(characterElementIds.size).toBe(0);
  });

  it('freeLayoutFromPlacedContent 単体：characterElementIds と slotLayerByElementId は互いに排他', () => {
    const sc = { ...richScene(), character: { enabled: true, characterId: 'yuko', poseAssetId: 'asset_yuko' } } as Scene;
    const { elements, slotLayerByElementId, characterElementIds } = freeLayoutFromPlacedContent(sc, prevTemplate());
    const slotIds = new Set(Object.keys(slotLayerByElementId));
    for (const id of characterElementIds) expect(slotIds.has(id)).toBe(false);
    const mv = elements.find((e) => e.assetId === 'asset_v')!; // 差し込み口（mainVisual）の要素は逆に入らない
    expect(characterElementIds.has(mv.id)).toBe(false);
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
    const toFree = switchSceneTemplate(original, 'free_v1', 'free', prevTemplate());
    expect(toFree.assetRefs).toEqual(original.assetRefs); // FREE でも清算せず休眠保持
    expect(toFree.slotFits).toEqual(original.slotFits);
    // FREE→通常（元の通常テンプレへ）：休眠 assetRefs がそのまま戻る（差し込み先を持つキーが再び描かれる）。
    // 当て先に無い oldSlot も**落とさない**＝それを持つ見た目へ変えれば復活する（#547 P3-14・実効使用は assetUsage がゲート）。
    const back = switchSceneTemplate(toFree, 'old_tmpl', 'opening');
    expect(back.assetRefs).toEqual(original.assetRefs);
    expect(back.slotFits).toEqual(original.slotFits);
    expect(back.sceneType).toBe('opening');
  });

  // 字幕層の textKey はテンプレ作成エディタで変えられる（ADR-0017）。seed の判定を TEXT_KEY.subtitle 固定にすると
  // 「元は出ていない字幕」を FREE へ持ち込み、戻すときに「往復しただけなのに字幕が出なくなります」と言う（#547 P2-9）。
  it('通常→FREE：字幕層の textKey が subtitle 以外なら、texts.subtitle があっても字幕要素を作らない', () => {
    const tmpl = prevTemplate();
    const customKey: Template = {
      ...tmpl,
      layers: tmpl.layers.map((l) => (l.type === 'subtitle' ? { ...l, textKey: 'caption' as const } : l)),
    };
    const sc = { ...richScene(), texts: { subtitle: '出ていない字幕' } } as Scene;
    const { elements } = freeLayoutFromPlacedContent(sc, customKey);
    expect(elements.some((e) => e.kind === 'subtitle')).toBe(false); // 出ていないものは持ち込まない
    // 逆に層の textKey に中身があれば持ち込む（描画と一致）。
    const withCaption = { ...richScene(), texts: { caption: 'キャプション字幕' } } as Scene;
    expect(freeLayoutFromPlacedContent(withCaption, customKey).elements.some((e) => e.kind === 'subtitle')).toBe(true);
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

describe('freeContentHiddenBySwitch（FREE→通常で出なくなる中身・#547 P2-9）', () => {
  const layer = (id: string, type: Layer['type'], extra: Partial<Layer> = {}): Layer => ({ id, type, x: 0, y: 0, w: 100, h: 100, ...extra });
  /** 通常テンプレ：差し込み先1つ・見出し1つ・字幕1つ・立ち絵1つ。 */
  const normalTemplate = (): Template => ({
    schemaVersion: '1.0', templateId: 'normal_v1', name: '通常', category: 'opening', aspectRatio: '16:9',
    canvas: { width: 1920, height: 1080 },
    layers: [
      layer('mainVisual', 'slot'),
      layer('title', 'text', { textKey: 'title' }),
      layer('subtitle', 'subtitle', { textKey: 'subtitle' }),
      layer('yuko', 'character'),
    ],
  });
  const freeTemplate = (): Template => ({ ...normalTemplate(), templateId: 'free_v1', category: 'free', layers: [] });
  const freeEl = (id: string, kind: FreeElement['kind'], extra: Partial<FreeElement> = {}): FreeElement =>
    ({ id, kind, x: 0, y: 0, w: 10, h: 10, ...extra });
  /** FREE 場面：通常から往復してきた想定（差し込み先の素材＋見出しが休眠している）。 */
  const freeScene = (elements: FreeElement[], over: Partial<Scene> = {}): Scene => ({
    ...scene('scene_001', 1),
    templateId: 'free_v1', sceneType: 'free',
    assetRefs: { mainVisual: 'asset_a' },
    texts: { title: 'タイトル' },
    freeLayout: elements,
    ...over,
  });

  it('往復しただけ（追加なし）なら出なくなる中身は無い＝確認を出さない', () => {
    const s = freeScene(
      [
        freeEl('free_001', 'slot', { assetId: 'asset_a' }),
        freeEl('free_002', 'text', { text: 'タイトル' }),
        freeEl('free_003', 'subtitle'),
      ],
      { texts: { title: 'タイトル', subtitle: '字幕の文' } },
    );
    expect(freeContentHiddenBySwitch(s, normalTemplate())).toEqual({ slot: 0, text: 0, subtitle: 0, shape: 0, total: 0 });
  });

  it('FREE で足した分は、復元される素材があっても数える（これが元の穴＝willRestore では見えない）', () => {
    const s = freeScene([
      freeEl('free_001', 'slot', { assetId: 'asset_a' }), // 復元される
      freeEl('free_002', 'slot', { assetId: 'asset_b' }), // FREE で追加＝出なくなる
      freeEl('free_003', 'slot', { assetId: 'asset_c' }), // 同上
      freeEl('free_004', 'text', { text: 'FREEで足した文字' }),
    ]);
    const r = freeContentHiddenBySwitch(s, normalTemplate());
    expect(r).toMatchObject({ slot: 2, text: 1, total: 3 });
  });

  it('同じ素材を2つ置いていたら、差し込み先1つぶんを超えた分を数える（多重度を見る）', () => {
    const s = freeScene([
      freeEl('free_001', 'slot', { assetId: 'asset_a' }),
      freeEl('free_002', 'slot', { assetId: 'asset_a' }), // 同じ素材の2枚目＝通常では1枚しか出ない
    ]);
    expect(freeContentHiddenBySwitch(s, normalTemplate())).toMatchObject({ slot: 1, total: 1 });
  });

  // 復元されるのは**切替先テンプレに実在する差し込み先**の分だけ（描画・実効使用と同じ規則）。
  // 休眠したままのキーを「復元される」と数えると、実際には出ない素材を出ると言ってしまう。
  it('切替先に無い差し込み先の休眠素材は「復元される」に数えない', () => {
    const s = freeScene([freeEl('free_001', 'slot', { assetId: 'asset_old' })], {
      assetRefs: { oldSlot: 'asset_old' }, // oldSlot は通常テンプレに無い＝復元されない
    });
    expect(freeContentHiddenBySwitch(s, normalTemplate())).toMatchObject({ slot: 1, total: 1 });
  });

  it('自由配置で作った場面（休眠する通常配置が無い）は中身すべてを数える', () => {
    const s = freeScene(
      [freeEl('free_001', 'slot', { assetId: 'asset_x' }), freeEl('free_002', 'text', { text: 'あいさつ' })],
      { assetRefs: {}, texts: {} },
    );
    expect(freeContentHiddenBySwitch(s, normalTemplate())).toMatchObject({ slot: 1, text: 1, total: 2 });
  });

  it('図形（飾り）は通常テンプレに受け皿が無いので必ず数える', () => {
    const s = freeScene([freeEl('free_001', 'shape', { shapeType: 'rect' })]);
    expect(freeContentHiddenBySwitch(s, normalTemplate())).toMatchObject({ shape: 1, total: 1 });
  });

  // 字幕は箱の数で突き合わせない：通常テンプレの字幕層1枚がその場面の字幕を**すべて**受け持つ
  // （逐次も同時字幕の段積みも1層＝ADR-0031）。話者別に複数置いても、切替後に字幕が出るなら失われていない。
  it('字幕層のある通常テンプレへは、箱を複数置いていても出なくならない（1層が全話者を受け持つ）', () => {
    const s = freeScene([freeEl('free_001', 'subtitle'), freeEl('free_002', 'subtitle')], {
      texts: { subtitle: '字幕の文' },
    });
    expect(freeContentHiddenBySwitch(s, normalTemplate())).toMatchObject({ subtitle: 0, total: 0 });
  });

  it('字幕層の無い通常テンプレへ変えると、出ていた字幕の箱を数える', () => {
    const noSubtitle = (): Template => ({
      ...normalTemplate(),
      layers: normalTemplate().layers.filter((l) => l.type !== 'subtitle'),
    });
    const s = freeScene([freeEl('free_001', 'subtitle'), freeEl('free_002', 'subtitle')], {
      texts: { subtitle: '字幕の文' },
    });
    expect(freeContentHiddenBySwitch(s, noSubtitle())).toMatchObject({ subtitle: 2, total: 2 });
  });

  // 掛け合い場面の通常テンプレは、字幕層を**行の字幕で上書き**する（layoutScene の opts.subtitleText）。
  // つまり `texts.subtitle`（対象＝読み上げ）は通常テンプレでは決して出ない＝「字幕が出ているから失っていない」では取りこぼす。
  it('掛け合い場面で対象＝読み上げの字幕箱は、切替後に行字幕が出ていても「出なくなる」と数える', () => {
    const s = freeScene([freeEl('free_001', 'subtitle', { subtitleSource: { kind: 'narration' } })], {
      texts: { subtitle: 'ここに注釈' },
      lines: [
        { lineId: 'line_001', text: 'こんにちは', status: 'none' },
        { lineId: 'line_002', text: 'よろしく', status: 'none' },
      ],
    } as Partial<Scene>);
    expect(freeContentHiddenBySwitch(s, normalTemplate())).toMatchObject({ subtitle: 1, total: 1 });
  });

  it('掛け合い場面で対象＝全部の字幕箱は、切替後も同じ行字幕が出るので数えない', () => {
    const s = freeScene([freeEl('free_001', 'subtitle', { subtitleSource: { kind: 'allLines' } })], {
      texts: {},
      lines: [
        { lineId: 'line_001', text: 'こんにちは', status: 'none' },
        { lineId: 'line_002', text: 'よろしく', status: 'none' },
      ],
    } as Partial<Scene>);
    expect(freeContentHiddenBySwitch(s, normalTemplate())).toMatchObject({ total: 0 });
  });

  // 話者ボックス（ADR-0029 (2a)＝掛け合いの主要ユースケース）。対象＝その話者の行だけなので、
  // 通常テンプレの字幕層がその行を出すかで決まる（判定は freeSubtitleElementTexts＝実表示に委譲）。
  it('掛け合い場面で対象＝話者の字幕箱は、その話者の行が切替後も出るかで数える', () => {
    const s = freeScene(
      [freeEl('free_001', 'subtitle', { subtitleSource: { kind: 'speaker', speaker: { kind: 'catalog', speaker: 2 } } })],
      {
        texts: {},
        lines: [
          { lineId: 'line_001', text: 'こんにちは', status: 'none', speaker: 2 },
          { lineId: 'line_002', text: 'よろしく', status: 'none', speaker: 3 },
        ],
      } as Partial<Scene>,
    );
    // 字幕層1枚がその場面の字幕を全部受け持つ（ADR-0031）＝この話者の行も切替後に出る。
    expect(freeContentHiddenBySwitch(s, normalTemplate())).toMatchObject({ total: 0 });
    const noSubtitle = (): Template => ({
      ...normalTemplate(),
      layers: normalTemplate().layers.filter((l) => l.type !== 'subtitle'),
    });
    expect(freeContentHiddenBySwitch(s, noSubtitle())).toMatchObject({ subtitle: 1, total: 1 });
  });

  it('いま何も出していない字幕の箱は数えない（字幕オフ／文が空）', () => {
    const off = freeScene([freeEl('free_001', 'subtitle')], {
      texts: { subtitle: '字幕の文' },
      subtitleEnabledDefault: false,
    });
    const empty = freeScene([freeEl('free_001', 'subtitle')], { texts: {} });
    const noSubtitle = (): Template => ({
      ...normalTemplate(),
      layers: normalTemplate().layers.filter((l) => l.type !== 'subtitle'),
    });
    expect(freeContentHiddenBySwitch(off, noSubtitle()).total).toBe(0);
    expect(freeContentHiddenBySwitch(empty, noSubtitle()).total).toBe(0);
  });

  // 受け皿の数え上げは描画と同じ規則（ADR-0022）。非表示グループのメンバー層は描かれない＝受け皿にしない。
  it('切替先の差し込み先が非表示グループにあると、受け皿として数えない（無言消失を作らない）', () => {
    const hiddenSlot = (): Template => ({
      ...normalTemplate(),
      groups: [{ id: 'group_001', members: ['mainVisual'], transform: { x: 0, y: 0, scale: 1, rotation: 0 }, hidden: true }],
    });
    const s = freeScene([freeEl('free_001', 'slot', { assetId: 'asset_a' })]);
    expect(freeContentHiddenBySwitch(s, normalTemplate())).toMatchObject({ total: 0 }); // 通常は受け皿あり
    expect(freeContentHiddenBySwitch(s, hiddenSlot())).toMatchObject({ slot: 1, total: 1 }); // 非表示なら出ない
  });

  // 描画は「場面の素材 ?? テンプレ既定素材」（ADR-0021）。既定素材で出るものを「出なくなる」と言わない。
  it('テンプレ既定素材（背景）で出る素材は受け皿として数える', () => {
    const withDefault = (): Template => ({
      ...normalTemplate(),
      layers: [...normalTemplate().layers, layer('background', 'background', { assetId: 'asset_bg' })],
    });
    const s = freeScene([freeEl('free_001', 'slot', { assetId: 'asset_bg' })], { assetRefs: {} });
    expect(freeContentHiddenBySwitch(s, withDefault())).toMatchObject({ total: 0 });
    expect(freeContentHiddenBySwitch(s, normalTemplate())).toMatchObject({ slot: 1, total: 1 }); // 既定素材が無ければ出ない
  });

  // 描画（layoutScene）も実効使用（sceneActiveAssetIds）も character.enabled を見ない＝ここも見ない。
  it('立ち絵は character.enabled を見ずに対応づける（描画と同じ規則）', () => {
    const s = freeScene([freeEl('free_001', 'slot', { assetId: 'asset_pose' })], {
      assetRefs: {},
      character: { enabled: false, characterId: 'yuko', poseAssetId: 'asset_pose' },
    });
    expect(freeContentHiddenBySwitch(s, normalTemplate())).toMatchObject({ total: 0 });
  });

  it('いま見えていないもの（非表示・非表示グループのメンバー）は数えない', () => {
    const s = freeScene(
      [
        freeEl('free_001', 'shape', { hidden: true }),
        freeEl('free_002', 'shape'),
      ],
      {
        assetRefs: {},
        texts: {},
        groups: [{ id: 'group_001', members: ['free_002'], transform: { x: 0, y: 0, scale: 1, rotation: 0 }, hidden: true }],
      },
    );
    expect(freeContentHiddenBySwitch(s, normalTemplate())).toMatchObject({ total: 0 });
  });

  // 立ち絵は character 層ごとに描かれる（layoutScene）＝層の数だけ受け皿がある。
  it('立ち絵の受け皿は character 層の数だけ数える（2層の見た目で過剰に警告しない）', () => {
    const twoCharacters = (): Template => ({
      ...normalTemplate(),
      layers: [...normalTemplate().layers, layer('yuko2', 'character')],
    });
    const s = freeScene(
      [freeEl('free_001', 'slot', { assetId: 'asset_pose' }), freeEl('free_002', 'slot', { assetId: 'asset_pose' })],
      { assetRefs: {}, texts: {}, character: { enabled: true, characterId: 'yuko', poseAssetId: 'asset_pose' } },
    );
    expect(freeContentHiddenBySwitch(s, twoCharacters())).toMatchObject({ total: 0 }); // 2層＝2つとも出る
    expect(freeContentHiddenBySwitch(s, normalTemplate())).toMatchObject({ slot: 1, total: 1 }); // 1層なら1つ超過
  });

  it('空スロット・空文字は失う中身が無いので数えない', () => {
    const s = freeScene(
      [freeEl('free_001', 'slot', { assetId: null }), freeEl('free_002', 'text', { text: '' })],
      { assetRefs: {}, texts: {} },
    );
    expect(freeContentHiddenBySwitch(s, normalTemplate())).toMatchObject({ total: 0 });
  });

  // 描画は `text.length > 0` で出す（layoutScene）＝空白だけの文字も描かれ、背景帯つきなら帯が出る。
  // trim で落とすと、その帯が確認なしで消える（直そうとしている無言消失そのもの）。両側とも同じ規則で見る。
  it('空白だけの文字も数える（描かれるので）／通常側に同じ文字があれば数えない', () => {
    const only = freeScene([freeEl('free_001', 'text', { text: '  ' })], { assetRefs: {}, texts: {} });
    expect(freeContentHiddenBySwitch(only, normalTemplate())).toMatchObject({ text: 1, total: 1 });
    const restored = freeScene([freeEl('free_001', 'text', { text: '  ' })], { assetRefs: {}, texts: { title: '  ' } });
    expect(freeContentHiddenBySwitch(restored, normalTemplate())).toMatchObject({ total: 0 });
  });

  it('自由配置が空／切替先が自由配置／見た目が見つからない場合は 0（確認を出さない）', () => {
    expect(freeContentHiddenBySwitch(freeScene([]), normalTemplate()).total).toBe(0);
    const s = freeScene([freeEl('free_001', 'shape')]);
    expect(freeContentHiddenBySwitch(s, freeTemplate()).total).toBe(0); // FREE→FREE は隠れない
    expect(freeContentHiddenBySwitch(s, undefined).total).toBe(0); // 見た目未解決は判断材料が無い
  });
});
