// 場面形式 → タイムライン形式の焼き出し（ADR-0032・#628）。純粋関数のテスト（§7 の必須対象＝変換）。
import { describe, expect, it } from 'vitest';
import { FREE_CATEGORY, FREE_ELEMENT_KIND, NARRATION_STATUS, TIMELINE_CLIP_KIND, TRACK_KIND, TRANSITION_DIRECTION, TRANSITION_TYPE } from '../enums';
import { transitionTimeline } from '../project/sceneTransitions';
import type { Project, Scene } from '../project/types';
import type { Template } from '../template/types';
import { validateTimelineProject } from '../validation/generated/validators.js';
import { BAKE_NOTE_CODE, BAKE_RANGE_KIND, bakeTimelineProject, bakedFilePaths, scenesForBakeRange } from './bake';
import type { BakeOptions } from './bake';
import { validateTimelineDoc } from './validateTimelineDoc';

function scene(id: string, over: Partial<Scene> = {}): Scene {
  return {
    sceneId: id,
    partId: 'part_001',
    order: 1,
    sceneType: 'photo_intro',
    templateId: 'tmpl_normal',
    durationSec: 6,
    assetRefs: {},
    character: { enabled: false, characterId: 'yuko' },
    texts: {},
    // 既定は読み上げ無し（空文＝クリップを作らない）。読み上げの検証は専用のケースで明示する。
    narration: { text: '', status: NARRATION_STATUS.none },
    warnings: [],
    ...over,
  };
}

function project(over: Partial<Project> = {}): Project {
  return {
    schemaVersion: '1.24',
    projectId: 'proj_20260701_001',
    projectName: '元のプロジェクト',
    purpose: 'company_intro',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [],
    parts: [{ partId: 'part_001', title: 'パート1', order: 1, sceneIds: ['scene_001'] }],
    scenes: [scene('scene_001')],
    ...over,
  };
}

const NORMAL_TEMPLATE: Template = {
  schemaVersion: '1.0',
  templateId: 'tmpl_normal',
  name: '通常',
  category: 'photo_intro',
  aspectRatio: '16:9',
  canvas: { width: 1920, height: 1080 },
  layers: [
    { id: 'mainVisual', type: 'slot', x: 0, y: 0, w: 1920, h: 1080 },
    { id: 'character', type: 'character', x: 100, y: 100, w: 400, h: 800 },
    { id: 'subtitle', type: 'subtitle', textKey: 'subtitle', x: 100, y: 900, w: 1720, h: 120 },
  ],
};

// 同梱の自由配置テンプレ（free_canvas_v1）と同じく **background 層を持つ**＝FREE でもテンプレ層は動画に出る。
const FREE_TEMPLATE: Template = {
  schemaVersion: '1.0',
  templateId: 'tmpl_free',
  name: '自由配置',
  category: FREE_CATEGORY,
  aspectRatio: '16:9',
  canvas: { width: 1920, height: 1080 },
  layers: [{ id: 'background', type: 'background', x: 0, y: 0, w: 1920, h: 1080, fillColor: '#ffffff' }],
};

const templateOf = (id: string): Template | undefined =>
  id === FREE_TEMPLATE.templateId ? FREE_TEMPLATE : id === NORMAL_TEMPLATE.templateId ? NORMAL_TEMPLATE : undefined;

function opts(over: Partial<BakeOptions> = {}): BakeOptions {
  return {
    range: { kind: BAKE_RANGE_KIND.whole },
    projectId: 'proj_20260728_001',
    projectName: '焼いたプロジェクト',
    nowIso: '2026-07-28T00:00:00.000Z',
    templateOf,
    ...over,
  };
}

/** 焼いた文書の共通の健全性＝スキーマ適合（V2）と意味検証の警告ゼロ（V22–V28。V24 の重なり禁止を含む）。 */
function expectSound(doc: ReturnType<typeof bakeTimelineProject>['doc']): void {
  const ok = validateTimelineProject(doc);
  expect(validateTimelineProject.errors ?? []).toEqual([]);
  expect(ok).toBe(true);
  expect(validateTimelineDoc(doc)).toEqual([]);
}

describe('scenesForBakeRange（焼き出す範囲・ADR-0032 決定17）', () => {
  const p = project({
    parts: [
      { partId: 'part_001', title: 'P1', order: 1, sceneIds: ['scene_001', 'scene_002'] },
      { partId: 'part_002', title: 'P2', order: 2, sceneIds: ['scene_003'] },
    ],
    scenes: [scene('scene_001'), scene('scene_002'), scene('scene_003', { partId: 'part_002' })],
  });

  it('全体＝全場面', () => {
    expect(scenesForBakeRange(p, { kind: BAKE_RANGE_KIND.whole }).map((s) => s.sceneId)).toEqual([
      'scene_001',
      'scene_002',
      'scene_003',
    ]);
  });

  it('パート＝そのパートの場面だけ', () => {
    expect(scenesForBakeRange(p, { kind: BAKE_RANGE_KIND.part, partId: 'part_002' }).map((s) => s.sceneId)).toEqual([
      'scene_003',
    ]);
  });

  it('範囲＝指定した場面だけ。並びは再生順（指定した順ではない）', () => {
    const r = scenesForBakeRange(p, { kind: BAKE_RANGE_KIND.scenes, sceneIds: ['scene_003', 'scene_001'] });
    expect(r.map((s) => s.sceneId)).toEqual(['scene_001', 'scene_003']);
  });
});

describe('bakeTimelineProject: 片道であること（ADR-0032 決定16）', () => {
  it('元のプロジェクトを一切書き換えない', () => {
    const p = project({
      scenes: [
        scene('scene_001', { transition: { in: TRANSITION_TYPE.fade, durationSec: 0.5 } }),
        scene('scene_002', { templateId: 'tmpl_free', sceneType: FREE_CATEGORY, freeLayout: [{ id: 'free_001', kind: FREE_ELEMENT_KIND.text, x: 0, y: 0, w: 100, h: 50, text: 'あ' }] }),
      ],
    });
    const before = JSON.stringify(p);
    bakeTimelineProject(p, opts());
    expect(JSON.stringify(p)).toBe(before);
  });

  it('焼いた文書は元の projectId を記録するが、id/名前は新しいものになる', () => {
    const { doc } = bakeTimelineProject(project(), opts());
    expect(doc.sourceProjectId).toBe('proj_20260701_001');
    expect(doc.projectId).toBe('proj_20260728_001');
    expect(doc.projectName).toBe('焼いたプロジェクト');
    expect(doc.format).toBe('timeline');
  });

  it('場面が1つも無い範囲でも壊れた文書を作らない（空のまま返す）', () => {
    const { doc, scenes } = bakeTimelineProject(project(), opts({ range: { kind: BAKE_RANGE_KIND.part, partId: 'part_999' } }));
    expect(scenes).toEqual([]);
    expect(doc.clips).toEqual([]);
    expectSound(doc);
  });
});

describe('bakeTimelineProject: 通常テンプレの場面＝1場面1クリップ（差し込み口が生きている・決定5）', () => {
  it('テンプレクリップに差し込み口の中身がそのまま乗る', () => {
    const p = project({
      assets: [
        { assetId: 'asset_001', assetType: 'image', displayName: '写真', filePath: 'a.png' },
        { assetId: 'asset_002', assetType: 'yuko', displayName: '立ち絵', filePath: 'y.png' },
      ],
      scenes: [
        scene('scene_001', {
          assetRefs: { mainVisual: 'asset_001' },
          texts: { title: 'みだし' },
          character: { enabled: true, characterId: 'yuko', poseAssetId: 'asset_002' },
          slotFits: { mainVisual: 'contain' },
          slotClips: { mainVisual: { startSec: 1, endSec: 4 } },
          textFontIds: { title: 'gen-interface-jp-display' },
          fontId: 'gen-interface-jp',
        }),
      ],
    });
    const { doc } = bakeTimelineProject(p, opts());
    expect(doc.clips).toHaveLength(1);
    const c = doc.clips[0];
    expect(c.kind).toBe(TIMELINE_CLIP_KIND.template);
    expect(c.templateId).toBe('tmpl_normal');
    expect(c.assetRefs).toEqual({ mainVisual: 'asset_001' });
    expect(c.texts).toEqual({ title: 'みだし' });
    expect(c.slotFits).toEqual({ mainVisual: 'contain' });
    expect(c.slotClips).toEqual({ mainVisual: { startSec: 1, endSec: 4 } });
    expect(c.textFontIds).toEqual({ title: 'gen-interface-jp-display' });
    expect(c.character).toEqual({ enabled: true, characterId: 'yuko', poseAssetId: 'asset_002' });
    expect(c.fontId).toBe('gen-interface-jp');
    expectSound(doc);
  });

  it('切り替えの無い場面が続いても列は増えない（1列で回る）', () => {
    const p = project({ scenes: [scene('scene_001'), scene('scene_002'), scene('scene_003')] });
    const { doc } = bakeTimelineProject(p, opts());
    expect(doc.tracks.filter((t) => t.kind === TRACK_KIND.visual)).toHaveLength(1);
    expect(new Set(doc.clips.map((c) => c.trackId)).size).toBe(1);
    expectSound(doc);
  });
});

describe('bakeTimelineProject: 時間軸（焼く前の書き出しと同じ経路）', () => {
  it('切り替えの重なりぶんだけ後続の場面が前へ寄る（transitionTimeline と一致）', () => {
    const p = project({
      scenes: [
        scene('scene_001', { durationSec: 5 }),
        scene('scene_002', { durationSec: 4, transition: { in: TRANSITION_TYPE.fade, durationSec: 1 } }),
      ],
    });
    const { doc } = bakeTimelineProject(p, opts());
    const { steps } = transitionTimeline([5, 4], [0, 1]);
    const visual = doc.clips.filter((c) => c.kind === TIMELINE_CLIP_KIND.template);
    expect(visual[0].startSec).toBe(0);
    expect(visual[1].startSec).toBe(steps[0].offsetSec); // 4
    expect(visual[1].durationSec).toBe(4);
    expectSound(doc);
  });

  it('範囲の先頭場面の入場の切り替えは落とす（切り替え元が範囲の外）', () => {
    const p = project({
      scenes: [
        scene('scene_001', { durationSec: 5 }),
        scene('scene_002', { durationSec: 5, transition: { in: TRANSITION_TYPE.fade, durationSec: 1 } }),
        scene('scene_003', { durationSec: 5, transition: { in: TRANSITION_TYPE.fade, durationSec: 1 } }),
      ],
    });
    // scene_002 は範囲の先頭になる＝入場の切り替えは効かない（0 から始まり、キーフレームも付かない）。
    // 範囲の中の境目（scene_002→scene_003）の切り替えはそのまま残る。
    const { doc } = bakeTimelineProject(
      p,
      opts({ range: { kind: BAKE_RANGE_KIND.scenes, sceneIds: ['scene_002', 'scene_003'] } }),
    );
    expect(doc.clips.map((c) => c.startSec)).toEqual([0, 4]);
    expect(doc.animations!.map((a) => a.targetId)).toEqual([doc.clips[1].id]);
    expectSound(doc);
  });
});

describe('bakeTimelineProject: 切り替えはキーフレームで表す（ADR-0032 決定19）', () => {
  const twoScenes = (transition: Scene['transition']): Project =>
    project({ scenes: [scene('scene_001', { durationSec: 5 }), scene('scene_002', { durationSec: 5, transition })] });

  it('フェード＝入る側の不透明度 0→1（出ていく側には付けない）', () => {
    const { doc } = bakeTimelineProject(twoScenes({ in: TRANSITION_TYPE.fade, durationSec: 1 }), opts());
    expect(doc.animations).toHaveLength(1);
    const anim = doc.animations![0];
    expect(anim.targetId).toBe(doc.clips[1].id); // 入る側
    expect(anim.keyframes).toEqual([
      { timeSec: 0, opacity: 0 },
      { timeSec: 1, opacity: 1 },
    ]);
  });

  it('入る側が手前の列になるときは、入る側の不透明度を上げる', () => {
    const { doc } = bakeTimelineProject(twoScenes({ in: TRANSITION_TYPE.fade, durationSec: 1 }), opts());
    const visualTracks = doc.tracks.filter((t) => t.kind === TRACK_KIND.visual).map((t) => t.id);
    expect(visualTracks.indexOf(doc.clips[1].trackId)).toBeGreaterThan(visualTracks.indexOf(doc.clips[0].trackId));
    expect(doc.animations!.map((a) => a.targetId)).toEqual([doc.clips[1].id]);
    expectSound(doc);
  });

  it('入る側が奥の列になるときは、代わりに出ていく側の不透明度を下げる（同じ絵・列を増やさない）', () => {
    // 3場面すべてに切り替えを付けると、3つ目は1つ目の空いた列へ戻る＝2つ目より奥になる。
    const fade = { in: TRANSITION_TYPE.fade, durationSec: 1 } as const;
    const p = project({
      scenes: [
        scene('scene_001', { durationSec: 5 }),
        scene('scene_002', { durationSec: 5, transition: fade }),
        scene('scene_003', { durationSec: 5, transition: fade }),
      ],
    });
    const { doc } = bakeTimelineProject(p, opts());
    const visualTracks = doc.tracks.filter((t) => t.kind === TRACK_KIND.visual).map((t) => t.id);
    expect(visualTracks).toHaveLength(2); // 切り替えが続いても列は増えない
    expect(doc.clips[2].trackId).toBe(doc.clips[0].trackId);
    // 2つ目→3つ目の切り替えは、手前にある2つ目を 1→0 で薄くする（開始は自身の先頭から 4 秒）。
    const outAnim = doc.animations!.find((a) => a.targetId === doc.clips[1].id && a.keyframes[0].opacity === 1)!;
    expect(outAnim.keyframes).toEqual([
      { timeSec: 4, opacity: 1 },
      { timeSec: 5, opacity: 0 },
    ]);
    expectSound(doc);
  });

  it('スライド＝両方が一緒に動く（FFmpeg の slideleft 等と同じ絵）', () => {
    const { doc } = bakeTimelineProject(
      twoScenes({ in: TRANSITION_TYPE.slide, direction: TRANSITION_DIRECTION.left, durationSec: 1 }),
      opts(),
    );
    const byTarget = new Map((doc.animations ?? []).map((a) => [a.targetId, a.keyframes]));
    // 入る側は右（+1920）から本来位置へ。
    expect(byTarget.get(doc.clips[1].id)).toEqual([
      { timeSec: 0, x: 1920, y: 0 },
      { timeSec: 1, x: 0, y: 0 },
    ]);
    // 出ていく側は重なりが始まる秒（=4）から左（-1920）へ抜ける。
    expect(byTarget.get(doc.clips[0].id)).toEqual([
      { timeSec: 4, x: 0, y: 0 },
      { timeSec: 5, x: -1920, y: 0 },
    ]);
    expectSound(doc);
  });

  it('切り替えなし（none）はキーフレームを作らない', () => {
    const { doc } = bakeTimelineProject(twoScenes({ in: TRANSITION_TYPE.none }), opts());
    expect(doc.animations ?? []).toEqual([]);
  });

  it('設定が wipe でも、実効の切り替え（fade へ丸められた結果）を焼く', () => {
    const { doc } = bakeTimelineProject(twoScenes({ in: TRANSITION_TYPE.wipe, durationSec: 1 }), opts());
    expect(doc.animations![0].keyframes).toEqual([
      { timeSec: 0, opacity: 0 },
      { timeSec: 1, opacity: 1 },
    ]);
  });
});

describe('bakeTimelineProject: FREE の場面＝要素ごとのクリップ＋1場面=1グループ', () => {
  const freeScene = (): Scene =>
    scene('scene_001', {
      templateId: 'tmpl_free',
      sceneType: FREE_CATEGORY,
      texts: { title: 'ばめん' },
      freeLayout: [
        { id: 'free_002', kind: FREE_ELEMENT_KIND.text, x: 10, y: 20, w: 300, h: 80, text: 'まえ', zIndex: 5 },
        { id: 'free_001', kind: FREE_ELEMENT_KIND.slot, x: 0, y: 0, w: 1920, h: 1080, assetId: 'asset_001', fit: 'cover', zIndex: 1 },
      ],
    });

  /** FREE の場面と、その要素が使う素材を持つプロジェクト。 */
  const freeProject = (over: Partial<Project> = {}): Project =>
    project({
      assets: [{ assetId: 'asset_001', assetType: 'image', displayName: '写真', filePath: 'a.png' }],
      scenes: [freeScene()],
      ...over,
    });

  it('最背面に見た目パターンのクリップを置き、その上に要素ごとのクリップを重ね順どおりに並べる', () => {
    const { doc } = bakeTimelineProject(freeProject(), opts());
    // FREE テンプレも background 層などを持ち動画に出る＝要素だけ焼くと背景が落ちる。
    expect(doc.clips.map((c) => c.kind)).toEqual([
      TIMELINE_CLIP_KIND.template,
      TIMELINE_CLIP_KIND.slot,
      TIMELINE_CLIP_KIND.text,
    ]);
    expect(doc.clips[0].templateId).toBe('tmpl_free');
    const visualTracks = doc.tracks.filter((t) => t.kind === TRACK_KIND.visual).map((t) => t.id);
    const at = (n: number): number => visualTracks.indexOf(doc.clips[n].trackId);
    // 見た目パターン → zIndex の小さい要素（slot） → 大きい要素（text）の順に手前へ
    expect(at(0)).toBeLessThan(at(1));
    expect(at(1)).toBeLessThan(at(2));
    // 空間の語彙はそのまま持ち込む。zIndex は持たない（重ね順は列の並びだけで決まる）。
    expect(doc.clips[2]).toMatchObject({ x: 10, y: 20, w: 300, h: 80, text: 'まえ' });
    expect('zIndex' in doc.clips[2]).toBe(false);
    expectSound(doc);
  });

  it('場面ごとに1つのグループができ、見た目パターンのクリップも含めて全クリップがメンバーになる', () => {
    const { doc } = bakeTimelineProject(freeProject(), opts());
    expect(doc.groups).toHaveLength(1);
    expect([...doc.groups![0].members].sort()).toEqual(doc.clips.map((c) => c.id).sort());
    expect(doc.groups![0].transform).toEqual({ x: 0, y: 0, rotation: 0, scale: 1 });
  });

  it('場面内のグループは入れ子で残り、メンバーはクリップ id へ差し替わる', () => {
    const p = freeProject({
      scenes: [{ ...freeScene(), groups: [{ id: 'group_001', members: ['free_001', 'free_002'], transform: { x: 5, y: 0, rotation: 0, scale: 1 } }] }],
    });
    const { doc } = bakeTimelineProject(p, opts());
    const nested = doc.groups!.find((g) => g.transform.x === 5)!;
    const elementClipIds = doc.clips.filter((c) => c.kind !== TIMELINE_CLIP_KIND.template).map((c) => c.id);
    expect([...nested.members].sort()).toEqual([...elementClipIds].sort());
    // 場面グループは入れ子グループと、入れ子に入っていない見た目パターンのクリップだけを持つ（二重所属を作らない）
    const sceneGroup = doc.groups!.find((g) => g.id !== nested.id)!;
    expect(sceneGroup.members).toEqual([doc.clips[0].id, nested.id]);
    expectSound(doc);
  });

  it('場面内のアニメを持ち込む（場面ローカル秒＝クリップローカル秒）', () => {
    const p = freeProject({
      timelineOverlay: {
        animations: [
          { id: 'anim_001', sceneId: 'scene_001', targetId: 'free_002', keyframes: [{ timeSec: 0, opacity: 0 }, { timeSec: 1, opacity: 1 }] },
          { id: 'anim_002', sceneId: 'scene_001', targetId: 'free_999', keyframes: [{ timeSec: 0, opacity: 0 }] },
        ],
      },
    });
    const { doc } = bakeTimelineProject(p, opts());
    // 参照切れ（free_999）は持ち込まない
    expect(doc.animations).toHaveLength(1);
    expect(doc.animations![0].targetId).toBe(doc.clips[2].id); // free_002 → text クリップ
    expect(doc.animations![0].keyframes).toEqual([{ timeSec: 0, opacity: 0 }, { timeSec: 1, opacity: 1 }]);
    expectSound(doc);
  });

  it('見た目が見つからない場面でも、場面の種類が自由配置なら自由配置として焼く（黙って中身を落とさない）', () => {
    // 呼び出し側が見た目を解決できない（削除された・templateOf を省いた）ケース。
    const p = freeProject({
      timelineOverlay: {
        animations: [{ id: 'anim_001', sceneId: 'scene_001', targetId: 'free_002', keyframes: [{ timeSec: 0, opacity: 0 }] }],
      },
    });
    for (const o of [opts({ templateOf: () => undefined }), opts({ templateOf: undefined })]) {
      const { doc } = bakeTimelineProject(p, o);
      expect(doc.clips.map((c) => c.kind)).toEqual([
        TIMELINE_CLIP_KIND.template,
        TIMELINE_CLIP_KIND.slot,
        TIMELINE_CLIP_KIND.text,
      ]);
      expect(doc.groups).toHaveLength(1);
      expect(doc.animations).toHaveLength(1);
      expect(doc.assets.map((a) => a.assetId)).toEqual(['asset_001']); // 要素が使う素材も持っていく
      expectSound(doc);
    }
  });

  it('通常の見た目の場面に休眠している自由配置（ADR-0030）が残っていても焼かない', () => {
    // 場面の種類は自由配置のまま（古いプロジェクトは切替で据え置かれることがある）だが、**見た目が解決できるなら
    // そちらが正**＝通常の見た目では自由配置は描かれない（`layoutScene` と同じ規則）。
    const p = freeProject({
      scenes: [{ ...freeScene(), templateId: 'tmpl_normal' }],
    });
    const { doc } = bakeTimelineProject(p, opts());
    expect(doc.clips.map((c) => c.kind)).toEqual([TIMELINE_CLIP_KIND.template]);
    expect(doc.groups).toBeUndefined();
  });

  it('自由配置の場面が続いても、場面ごとに列を丸ごと確保する（切り替えの重なりで列を食い合わない）', () => {
    const p = freeProject({
      scenes: [
        { ...freeScene(), durationSec: 5 },
        { ...freeScene(), sceneId: 'scene_002', durationSec: 5, transition: { in: TRANSITION_TYPE.fade, durationSec: 1 } },
      ],
    });
    const { doc } = bakeTimelineProject(p, opts());
    // 1場面＝見た目パターン＋要素2つ＝3列。2場面ぶんで6列（重なる区間があるので使い回せない）。
    expect(doc.tracks.filter((t) => t.kind === TRACK_KIND.visual)).toHaveLength(6);
    expect(new Set(doc.clips.filter((c) => c.kind !== TIMELINE_CLIP_KIND.voice).map((c) => c.trackId)).size).toBe(6);
    expectSound(doc); // 同じ列で時間が重なっていない（V24）
  });

  it('1場面ぶんの列は必ず連続して取る（切り替えで重なる場面の層が互い違いに挟まらない）', () => {
    const fade = { in: TRANSITION_TYPE.fade, durationSec: 1 } as const;
    const p = freeProject({
      scenes: [
        scene('scene_001', { durationSec: 5 }),
        scene('scene_002', { durationSec: 5, transition: fade }),
        { ...freeScene(), sceneId: 'scene_003', durationSec: 5, transition: fade },
      ],
    });
    const { doc } = bakeTimelineProject(p, opts());
    const visualTracks = doc.tracks.filter((t) => t.kind === TRACK_KIND.visual).map((t) => t.id);
    const free = doc.clips.filter((c) => c.kind !== TIMELINE_CLIP_KIND.template);
    const at = free.map((c) => visualTracks.indexOf(c.trackId)).sort((a, b) => a - b);
    // 直前の場面の列（1本目の空きの上）を飛び越えてでも、2要素は隣り合う列に置く。
    expect(at[1] - at[0]).toBe(1);
    expect(at[0]).toBeGreaterThan(visualTracks.indexOf(doc.clips[1].trackId));
    expectSound(doc);
  });

  it('要素が1つも無い FREE 場面でも、見た目パターンのクリップは残る（背景が消えない）', () => {
    const p = project({
      scenes: [
        scene('scene_001'),
        { ...freeScene(), sceneId: 'scene_002', freeLayout: [], transition: { in: TRANSITION_TYPE.fade, durationSec: 1 } },
      ],
    });
    const { doc } = bakeTimelineProject(p, opts());
    expect(doc.clips.map((c) => c.templateId)).toEqual(['tmpl_normal', 'tmpl_free']);
    expect(doc.groups).toHaveLength(1); // 1場面=1グループ（メンバーは見た目パターンのクリップ1つ）
    expect(doc.animations).toHaveLength(1); // 切り替えは場面グループへ付く
    expectSound(doc);
  });

  it('FREE の場面に入る切り替えは場面グループに付く（要素ごとの不透明度を潰さない）', () => {
    const p = freeProject({
      scenes: [scene('scene_001'), { ...freeScene(), sceneId: 'scene_002', transition: { in: TRANSITION_TYPE.fade, durationSec: 1 } }],
    });
    const { doc } = bakeTimelineProject(p, opts());
    expect(doc.groups).toHaveLength(1);
    expect(doc.animations!.map((a) => a.targetId)).toEqual([doc.groups![0].id]);
    expectSound(doc);
  });
});

describe('bakeTimelineProject: FREE の字幕ボックス（ADR-0029 の「対象」はタイムライン形式に無い）', () => {
  const withSubtitleBox = (over: Partial<Scene> = {}): Scene =>
    scene('scene_001', {
      templateId: 'tmpl_free',
      sceneType: FREE_CATEGORY,
      freeLayout: [{ id: 'free_001', kind: FREE_ELEMENT_KIND.subtitle, x: 100, y: 900, w: 1720, h: 120 }],
      ...over,
    });

  it('対象が読み上げ（時間で変わらない）なら、いま出ている文を焼き付ける', () => {
    const p = project({ scenes: [withSubtitleBox({ texts: { subtitle: 'いま出ている字幕' } })] });
    const { doc, notes } = bakeTimelineProject(p, opts());
    const box = doc.clips.find((c) => c.kind === TIMELINE_CLIP_KIND.subtitle)!;
    expect(box.text).toBe('いま出ている字幕');
    expect(notes).toEqual([]); // 落ちていないので記録しない
    expectSound(doc);
  });

  it('場面の字幕が OFF なら何も焼かない（元から出ていない＝落ちていない）', () => {
    const p = project({ scenes: [withSubtitleBox({ texts: { subtitle: 'あ' }, subtitleEnabledDefault: false })] });
    const { doc, notes } = bakeTimelineProject(p, opts());
    expect(doc.clips.find((c) => c.kind === TIMELINE_CLIP_KIND.subtitle)!.text).toBeUndefined();
    expect(notes).toEqual([]);
  });

  it('対象が行に追従する（全部/話者）なら焼けないので記録する', () => {
    const p = project({
      scenes: [
        withSubtitleBox({
          freeLayout: [{ id: 'free_001', kind: FREE_ELEMENT_KIND.subtitle, x: 100, y: 900, w: 1720, h: 120, subtitleSource: { kind: 'allLines' } }],
          lines: [
            { lineId: 'line_001', text: 'いち', status: NARRATION_STATUS.none },
            { lineId: 'line_002', text: 'に', status: NARRATION_STATUS.none },
          ],
        }),
      ],
    });
    const { doc, notes } = bakeTimelineProject(p, opts());
    expect(doc.clips.find((c) => c.kind === TIMELINE_CLIP_KIND.subtitle)!.text).toBeUndefined();
    expect(notes).toEqual([{ code: BAKE_NOTE_CODE.dialogueSubtitle, sceneNumbers: [1] }]);
  });

  it('隠してある字幕ボックスは記録しない（描かれていない＝落ちていない）', () => {
    const p = project({
      scenes: [
        withSubtitleBox({
          freeLayout: [{ id: 'free_001', kind: FREE_ELEMENT_KIND.subtitle, x: 100, y: 900, w: 1720, h: 120, hidden: true, subtitleSource: { kind: 'allLines' } }],
          lines: [{ lineId: 'line_001', text: 'いち', status: NARRATION_STATUS.none }],
        }),
      ],
    });
    expect(bakeTimelineProject(p, opts()).notes).toEqual([]);
  });
});

describe('bakeTimelineProject: 読み上げ（決定7）と同時のセリフ（決定8）', () => {
  it('単独のナレーションは読み上げクリップ1本（場面尺ぶん）', () => {
    const p = project({ scenes: [scene('scene_001', { durationSec: 6, narration: { text: 'よろしく', speed: 1.2, status: NARRATION_STATUS.generated, voicePath: 'v.wav' } })] });
    const { doc } = bakeTimelineProject(p, opts());
    const voice = doc.clips.filter((c) => c.kind === TIMELINE_CLIP_KIND.voice);
    expect(voice).toHaveLength(1);
    expect(voice[0].durationSec).toBe(6);
    expect(voice[0].voice).toEqual({ text: 'よろしく', speed: 1.2, voicePath: 'v.wav', status: NARRATION_STATUS.generated });
    expectSound(doc);
  });

  it('掛け合いは行ごとに1本ずつ、逐次なら同じ列に並ぶ', () => {
    const p = project({
      scenes: [
        scene('scene_001', {
          durationSec: 6,
          subtitleEnabledDefault: false,
          lines: [
            { lineId: 'line_001', text: 'いち', speaker: 1, status: NARRATION_STATUS.none },
            { lineId: 'line_002', text: 'に', speaker: 3, status: NARRATION_STATUS.none },
          ],
        }),
      ],
    });
    const { doc } = bakeTimelineProject(p, opts({ lineDurationsFor: () => ({ line_001: 2, line_002: 3 }) }));
    const voice = doc.clips.filter((c) => c.kind === TIMELINE_CLIP_KIND.voice);
    expect(voice.map((c) => [c.startSec, c.durationSec])).toEqual([[0, 2], [2, 4]]);
    expect(new Set(voice.map((c) => c.trackId)).size).toBe(1);
    expect(voice[1].voice?.speaker).toBe(3);
    expectSound(doc);
  });

  it('同時に流れるセリフ（ADR-0031）は列を分ける＝音声トラックを増やすだけで表せる', () => {
    const p = project({
      scenes: [
        scene('scene_001', {
          durationSec: 6,
          subtitleEnabledDefault: false,
          lines: [
            { lineId: 'line_001', text: 'いち', status: NARRATION_STATUS.none },
            { lineId: 'line_002', text: 'に', startWithPrevious: true, status: NARRATION_STATUS.none },
          ],
        }),
      ],
    });
    const { doc } = bakeTimelineProject(p, opts());
    const voice = doc.clips.filter((c) => c.kind === TIMELINE_CLIP_KIND.voice);
    expect(voice.map((c) => c.startSec)).toEqual([0, 0]); // 同時開始
    expect(new Set(voice.map((c) => c.trackId)).size).toBe(2); // 列は別
    expectSound(doc);
  });
});

describe('bakeTimelineProject: BGM', () => {
  it('鳴っている区間ごとに1クリップ（同梱BGMは bundledBgmId で持つ）', () => {
    const p = project({
      bgmSettings: { enabled: true, bundledBgmId: 'found-new-hope', volume: 0.3, fadeInSec: 1 },
      scenes: [scene('scene_001', { durationSec: 5 }), scene('scene_002', { durationSec: 5, bgmSettings: { enabled: false } })],
    });
    const { doc } = bakeTimelineProject(p, opts());
    const bgm = doc.clips.filter((c) => c.kind === TIMELINE_CLIP_KIND.audio);
    expect(bgm).toHaveLength(1);
    expect(bgm[0]).toMatchObject({ startSec: 0, durationSec: 5, bundledBgmId: 'found-new-hope', volume: 0.3, fadeInSec: 1 });
    expect(bgm[0].assetId).toBeUndefined(); // 音の出どころは1つ（V25）
    expectSound(doc);
  });
});

describe('bakeTimelineProject: 素材はコピーする前提で持っていく（決定13）', () => {
  it('焼く範囲で実際に使っている素材だけを持っていく', () => {
    const p = project({
      assets: [
        { assetId: 'asset_001', assetType: 'image', displayName: '使う', filePath: 'a.png' },
        { assetId: 'asset_002', assetType: 'image', displayName: '使わない', filePath: 'b.png' },
        { assetId: 'asset_003', assetType: 'bgm', displayName: '自分のBGM', filePath: 'c.mp3' },
      ],
      bgmSettings: { enabled: true, assetId: 'asset_003' },
      scenes: [scene('scene_001', { assetRefs: { mainVisual: 'asset_001' } })],
    });
    const { doc } = bakeTimelineProject(p, opts());
    expect(doc.assets.map((a) => a.assetId)).toEqual(['asset_001', 'asset_003']);
  });

  it('差し込み先を失った休眠の割当（ADR-0030）は持っていかない', () => {
    const p = project({
      assets: [{ assetId: 'asset_001', assetType: 'image', displayName: '休眠', filePath: 'a.png' }],
      scenes: [scene('scene_001', { assetRefs: { logo: 'asset_001' } })], // 通常テンプレに logo 層は無い
    });
    expect(bakeTimelineProject(p, opts()).doc.assets).toEqual([]);
  });
});

describe('bakeTimelineProject: 持っていけなかったものを黙って落とさない（§2-5）', () => {
  it('掛け合いの字幕がある場面を記録する', () => {
    const p = project({
      scenes: [
        scene('scene_001'),
        scene('scene_002', {
          lines: [
            { lineId: 'line_001', text: 'いち', status: NARRATION_STATUS.none },
            { lineId: 'line_002', text: 'に', status: NARRATION_STATUS.none },
          ],
        }),
      ],
    });
    const { notes } = bakeTimelineProject(p, opts());
    expect(notes).toEqual([{ code: BAKE_NOTE_CODE.dialogueSubtitle, sceneNumbers: [2] }]);
  });

  it('掛け合いでも全行の字幕が OFF なら記録しない（落ちるものが無い）', () => {
    const p = project({
      scenes: [
        scene('scene_001', {
          subtitleEnabledDefault: false,
          lines: [
            { lineId: 'line_001', text: 'いち', status: NARRATION_STATUS.none },
            { lineId: 'line_002', text: 'に', status: NARRATION_STATUS.none },
          ],
        }),
      ],
    });
    expect(bakeTimelineProject(p, opts()).notes).toEqual([]);
  });

  it('セリフが1行だけでも記録する（テンプレの字幕層は行の字幕へ差し替わるので、焼くと出なくなる）', () => {
    const p = project({
      scenes: [scene('scene_001', { lines: [{ lineId: 'line_001', text: 'ひとこと', status: NARRATION_STATUS.none }] })],
    });
    expect(bakeTimelineProject(p, opts()).notes).toEqual([
      { code: BAKE_NOTE_CODE.dialogueSubtitle, sceneNumbers: [1] },
    ]);
  });

  it('見た目に字幕の枠が無ければ記録しない（元から字幕が出ていない）', () => {
    const noSubtitle: Template = { ...NORMAL_TEMPLATE, layers: NORMAL_TEMPLATE.layers.filter((l) => l.type !== 'subtitle') };
    const p = project({
      scenes: [scene('scene_001', { lines: [{ lineId: 'line_001', text: 'ひとこと', status: NARRATION_STATUS.none }] })],
    });
    expect(bakeTimelineProject(p, opts({ templateOf: () => noSubtitle })).notes).toEqual([]);
  });

  it('動画の再生開始タイミング（ADR-0027）がある場面を記録する', () => {
    const p = project({ scenes: [scene('scene_001', { slotVideoStart: { mainVisual: { mode: 'afterAnim' } } })] });
    expect(bakeTimelineProject(p, opts()).notes).toEqual([
      { code: BAKE_NOTE_CODE.videoStartTiming, sceneNumbers: [1] },
    ]);
  });

  it('単独のナレーションの場面は字幕を記録しない（テンプレの差し込み口で出るため）', () => {
    expect(bakeTimelineProject(project(), opts()).notes).toEqual([]);
  });
});

describe('bakedFilePaths（運ぶファイルの一覧・決定13）', () => {
  it('素材の本体・代表フレーム・作成済みの読み上げ音声を、重複なく決定的な順で返す', () => {
    const p = project({
      assets: [
        { assetId: 'asset_001', assetType: 'video', displayName: '動画', filePath: 'assets/asset_001.mp4', thumbnailPath: 'assets/asset_001.thumb.png' },
        { assetId: 'asset_002', assetType: 'image', displayName: '写真', filePath: 'assets/asset_002.png' },
      ],
      scenes: [
        scene('scene_001', {
          assetRefs: { mainVisual: 'asset_001' },
          narration: { text: 'よろしく', status: NARRATION_STATUS.generated, voicePath: 'voices/scene_001.wav' },
        }),
      ],
    });
    const { doc } = bakeTimelineProject(p, opts());
    expect(bakedFilePaths(doc)).toEqual([
      'assets/asset_001.mp4',
      'assets/asset_001.thumb.png',
      'voices/scene_001.wav',
    ]);
  });

  it('同じファイルを2回運ばない', () => {
    const p = project({
      assets: [{ assetId: 'asset_001', assetType: 'image', displayName: '写真', filePath: 'assets/asset_001.png' }],
      scenes: [
        scene('scene_001', { assetRefs: { mainVisual: 'asset_001' } }),
        scene('scene_002', { assetRefs: { mainVisual: 'asset_001' } }),
      ],
    });
    expect(bakedFilePaths(bakeTimelineProject(p, opts()).doc)).toEqual(['assets/asset_001.png']);
  });
});
