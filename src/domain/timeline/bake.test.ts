// 場面形式 → タイムライン形式の焼き出し（ADR-0032・#628）。純粋関数のテスト（§7 の必須対象＝変換）。
import { describe, expect, it } from 'vitest';
import { EASING, FREE_CATEGORY, FREE_ELEMENT_KIND, NARRATION_STATUS, TIMELINE_CLIP_KIND, TRACK_KIND, TRANSITION_DIRECTION, TRANSITION_TYPE } from '../enums';
import { presetKeyframes } from '../project/animationPresets';
import { transitionTimeline } from '../project/sceneTransitions';
import { setKeyframe } from './keyframeEdit';
import type { Project, Scene } from '../project/types';
import type { Template } from '../template/types';
import { timelineExportBlockers } from './export';
import { validateTimelineProject } from '../validation/generated/validators.js';
import { BAKE_NOTE_CODE, BAKE_RANGE_KIND, bakeTimelineProject, bakedFilePaths, sceneIdsBetween, scenesForBakeRange } from './bake';
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

/** 焼いた文書の共通の健全性＝スキーマ適合（V2）と意味検証の警告ゼロ（V22–V32。V24 の重なり禁止・V32 の id 一意を含む）。 */
function expectSound(doc: ReturnType<typeof bakeTimelineProject>['doc']): void {
  const ok = validateTimelineProject(doc);
  expect(validateTimelineProject.errors ?? []).toEqual([]);
  expect(ok).toBe(true);
  expect(validateTimelineDoc(doc)).toEqual([]);
  // ⚠️ **焼いた動画はそのまま書き出せる**（#787 レビュー）＝適合しているだけでは足りない。
  // 書き出しの関門を広げたときに**焼き出し直後の文書が書き出せなくなる**ことに、ここまで誰も
  // 気づけなかった（適合と `validateTimelineDoc` しか見ていなかった）。焼いた結果は利用者が
  // 何も足さずに書き出す前提のものなので、**押した先で断られない**ことを毎回見る。
  // ⚠️ 中身のある文書だけ＝場面が1つも入らない範囲は「空」で断られるのが正しい（それ自体が守り）。
  if (doc.clips.length > 0) expect(timelineExportBlockers(doc)).toEqual([]);
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
    // 2つ目は「入る側」と「出ていく側」の両方になる＝**1本にまとめる**（#717）。
    // 読む側（描画・キーフレーム編集）は `targetId` で1本しか見ないので、分けると退場が無視される。
    const mid = doc.animations!.filter((a) => a.targetId === doc.clips[1].id);
    expect(mid).toHaveLength(1);
    expect(mid[0].keyframes).toEqual([
      { timeSec: 0, opacity: 0 }, // 入場（1つ目→2つ目）
      { timeSec: 1, opacity: 1 },
      { timeSec: 4, opacity: 1 }, // 退場（2つ目→3つ目・自身の先頭から4秒）
      { timeSec: 5, opacity: 0 },
    ]);
    expectSound(doc);
  });

  it('同じ対象への切り替えは1本にまとまる（読む側は1本しか見ない・#717）', () => {
    // 3場面すべてに切り替えを付けると、中間の場面は入場と退場の両方を持つ。
    const fade = { in: TRANSITION_TYPE.fade, durationSec: 1 } as const;
    const { doc } = bakeTimelineProject(project({
      scenes: [
        scene('scene_001', { durationSec: 5 }),
        scene('scene_002', { durationSec: 5, transition: fade }),
        scene('scene_003', { durationSec: 5, transition: fade }),
      ],
    }), opts());
    // **どの対象にも動きは高々1本**（2本あると片方が黙って無視される）。
    const counts = new Map<string, number>();
    for (const a of doc.animations ?? []) counts.set(a.targetId, (counts.get(a.targetId) ?? 0) + 1);
    expect([...counts.values()].every((n) => n === 1)).toBe(true);
    // 時刻は昇順（`11 §7.4`）。**溜めた順ではなく並べ直した結果**であることを、
    // 退場（遅い時刻）が先に溜まる場面で見る＝下の「奥の列」ケースがそれに当たる。
    for (const a of doc.animations ?? []) {
      const times = a.keyframes.map((k) => k.timeSec);
      expect(times).toEqual([...times].sort((x, y) => x - y));
    }
  });

  it('溜まる順が時刻の順とは限らない（並べ直しは効いている・#717 レビュー）', () => {
    // 短い場面が続くと、退場の開始が入場の終わりより**前**に来る＝溜まる順は昇順にならない。
    // 並べ直しを外すと、キーフレームの時刻が行ったり来たりする文書が焼き上がる（`11 §7.4` 違反）。
    const { doc } = bakeTimelineProject(project({
      scenes: [
        scene('scene_001', { durationSec: 0.5 }),
        scene('scene_002', { durationSec: 0.5, transition: { in: TRANSITION_TYPE.fade, durationSec: 0.5 } }),
        scene('scene_003', { durationSec: 0.5, transition: { in: TRANSITION_TYPE.slide, direction: TRANSITION_DIRECTION.left, durationSec: 0.5 } }),
      ],
    }), opts());
    for (const a of doc.animations ?? []) {
      const times = a.keyframes.map((k) => k.timeSec);
      expect(times).toEqual([...times].sort((x, y) => x - y));
    }
  });

  it('入場と退場が同じ時刻で当たっても、両方の効果が残る（#717 レビュー）', () => {
    // 場面の尺が「入りの切り替え＋出の切り替え」ちょうどで**種別が違う**とき、同じ時刻に2つ来る。
    // 丸ごと後勝ちにすると片方のプロパティ（ここでは `opacity`）が消え、**その場面が一度も映らない**。
    const { doc } = bakeTimelineProject(project({
      scenes: [
        scene('scene_001', { durationSec: 5 }),
        scene('scene_002', { durationSec: 1, transition: { in: TRANSITION_TYPE.fade, durationSec: 0.5 } }),
        scene('scene_003', { durationSec: 5, transition: { in: TRANSITION_TYPE.slide, direction: TRANSITION_DIRECTION.left, durationSec: 0.5 } }),
      ],
    }), opts());
    const mid = (doc.animations ?? []).filter((a) => a.targetId === doc.clips[1].id);
    expect(mid).toHaveLength(1);
    const times = mid[0].keyframes.map((k) => k.timeSec);
    expect(new Set(times).size).toBe(times.length); // 同じ時刻に2つ置かない
    expect(times).toEqual([...times].sort((x, y) => x - y)); // 昇順（11 §7.4）
    // 入場（不透明度）が生き残っている＝この場面はちゃんと映る。
    const opacities = mid[0].keyframes.filter((k) => k.opacity != null).map((k) => k.opacity);
    expect(opacities).toContain(1);
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

  // ⚠️ **グループが2つ以上でも id が重ならない**（#811）＝採番は積んである id から次を決めるので、
  // まとめて作ってから後で積むと**同じ番号を何度も返す**。重なると引き当てが後勝ち／親は先勝ちで
  // 食い違い、**片方の変形がもう片方のメンバーに掛かる**（実測で要素が2倍・画面外へ飛んだ）。
  it('場面内のグループが2つ以上でも、id が重ならない', () => {
    const p = freeProject({
      scenes: [{
        ...freeScene(),
        freeLayout: [
          { id: 'free_001', kind: FREE_ELEMENT_KIND.slot, x: 0, y: 0, w: 960, h: 540, assetId: 'asset_001', fit: 'cover', zIndex: 1 },
          { id: 'free_002', kind: FREE_ELEMENT_KIND.text, x: 10, y: 20, w: 300, h: 80, text: 'A', zIndex: 2 },
          { id: 'free_003', kind: FREE_ELEMENT_KIND.text, x: 10, y: 120, w: 300, h: 80, text: 'B', zIndex: 3 },
        ],
        groups: [
          { id: 'group_001', members: ['free_002'], transform: { x: 5, y: 0, rotation: 0, scale: 1 } },
          { id: 'group_002', members: ['free_003'], transform: { x: 99, y: 0, rotation: 0, scale: 2 } },
        ],
      } as Scene],
    });
    const { doc } = bakeTimelineProject(p, opts());
    const ids = doc.groups!.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length); // 重複なし
    // ⚠️ **変形が取り違えられていない**＝それぞれの入れ子が自分のメンバーだけを持つ。
    const g5 = doc.groups!.find((g) => g.transform.x === 5)!;
    const g99 = doc.groups!.find((g) => g.transform.x === 99)!;
    expect(g5.id).not.toBe(g99.id);
    expect(g5.members).toHaveLength(1);
    expect(g99.members).toHaveLength(1);
    expect(g5.members[0]).not.toBe(g99.members[0]);
    expectSound(doc);
  });

  // ⚠️ **入れ子の親が持つグループ id も張り替える**（要素 id しか見ていないと素通りする）＝
  // 旧 `group_NNN` は**別の場面の焼き上がり**と実在一致しうるので、参照切れの検査もすり抜けて
  // 場面をまたいだ親子ができる（支点が別の場面の箱を含む＝焼く前と絵が変わる）。
  it('入れ子の親が持つグループ id も、新しい id へ張り替わる', () => {
    const p = freeProject({
      scenes: [{
        ...freeScene(),
        // ⚠️ 旧 id は**焼き上がりの採番と重ならない番号**にする＝張り替え漏れを、たまたま同じ番号が
        // 採れただけの状態と見分けられるようにする（`group_001` のままだと見分けが付かない）。
        groups: [
          { id: 'group_010', members: ['free_001'], transform: { x: 0, y: 0, rotation: 0, scale: 1 } },
          { id: 'group_011', members: ['group_010', 'free_002'], transform: { x: 0, y: 0, rotation: 0, scale: 1 } },
        ],
      } as Scene],
    });
    const { doc } = bakeTimelineProject(p, opts());
    const parent = doc.groups!.find((g) => g.members.length === 2)!;
    const child = doc.groups!.find((g) => g.members.length === 1)!;
    expect(parent.members).toContain(child.id);
    expect(child.id).not.toBe('group_010'); // 採り直されている（前提の確認）
    // 旧 id が1つも残っていない（残ると別の場面の焼き上がりを指しうる）。
    expect(doc.groups!.flatMap((g) => g.members)).not.toContain('group_010');
    expectSound(doc);
  });

  // ⚠️ **動きも混ざらない**＝同じ id へ写すと `oldToNewGroupId` が合流し、別々のキーフレームが1本になる。
  it('グループが2つあっても、それぞれの動きが別々に残る', () => {
    const p = freeProject({
      scenes: [{
        ...freeScene(),
        groups: [
          { id: 'group_001', members: ['free_001'], transform: { x: 0, y: 0, rotation: 0, scale: 1 } },
          { id: 'group_002', members: ['free_002'], transform: { x: 0, y: 0, rotation: 0, scale: 1 } },
        ],
      } as Scene],
      timelineOverlay: {
        animations: [
          { id: 'anim_001', sceneId: 'scene_001', targetId: 'group_001', keyframes: [{ timeSec: 0, opacity: 0 }, { timeSec: 1, opacity: 1 }] },
          { id: 'anim_002', sceneId: 'scene_001', targetId: 'group_002', keyframes: [{ timeSec: 0, x: 0 }, { timeSec: 1, x: 50 }] },
        ],
      },
    } as Partial<Project>);
    const { doc } = bakeTimelineProject(p, opts());
    const targets = (doc.animations ?? []).map((a) => a.targetId);
    expect(new Set(targets).size).toBe(targets.length); // 1本へ合流していない
    // 濃さの動きと位置の動きが別々の対象に付いている（混ざると1本に両方が入る）。
    const kinds = (doc.animations ?? []).map((a) => a.keyframes.some((k) => k.opacity != null) ? 'opacity' : 'x');
    expect([...kinds].sort()).toEqual(['opacity', 'x']);
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

  it('元データに同じ対象の動きが2件あっても、焼き上がりは1本（#717 レビュー）', () => {
    // 元（場面形式）の一意性は誰も担保していないので、焼き出し側で必ず1本にする＝
    // 焼いた文書が V31 を満たすことが、元データ任せにならない。
    const p = freeProject({
      timelineOverlay: {
        animations: [
          { id: 'anim_001', sceneId: 'scene_001', targetId: 'free_002', keyframes: [{ timeSec: 0, opacity: 0 }] },
          { id: 'anim_002', sceneId: 'scene_001', targetId: 'free_002', keyframes: [{ timeSec: 1, opacity: 1 }] },
        ],
      },
    });
    const { doc } = bakeTimelineProject(p, opts());
    expect(doc.animations).toHaveLength(1);
    expect(doc.animations![0].keyframes).toEqual([{ timeSec: 0, opacity: 0 }, { timeSec: 1, opacity: 1 }]);
    expect(validateTimelineDoc(doc).map((w) => w.code)).not.toContain('TIMELINE_ANIMATION_DUPLICATE');
  });

  // #266（プリセット→自由キーフレームへの変換）＝**変換は要らない**。場面形式のプリセットは最初から
  // 2つのキーフレームとして保存されており（`animationPresets`）、焼き出しはそれをそのまま持ち込むので、
  // タイムライン側では**ふつうの動き**として編集できる。ここが崩れると #266 の前提が崩れる。
  it('プリセットの動きは、そのままのキーフレームとして持ち込まれ、タイムライン側で直せる', () => {
    const kfs = presetKeyframes('fade', { durationSec: 0.6, easing: EASING.easeInOut, direction: 'left' });
    const p = freeProject({
      timelineOverlay: {
        animations: [{ id: 'anim_001', sceneId: 'scene_001', targetId: 'free_002', keyframes: kfs }],
      },
    });
    const { doc } = bakeTimelineProject(p, opts());
    // 焼いた先の動きは、プリセットが作ったキーフレーム列と**同じもの**（変換も丸めもしない）。
    expect(doc.animations?.[0].keyframes).toEqual(kfs);
    // 以後はふつうのキーフレームとして直せる（プリセットという別の状態は残っていない）。
    const targetId = doc.animations![0].targetId;
    const r = setKeyframe(doc, targetId, kfs[kfs.length - 1].timeSec, { opacity: 0.5 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const edited = r.doc.animations![0].keyframes;
    expect(edited[edited.length - 1].opacity).toBe(0.5);
    // 動き方（イージング）も、そのキーフレームの指定として残っている（#262 で直せる）。
    expect(edited[edited.length - 1].easing).toBe(EASING.easeInOut);
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
    // ⚠️ **文も連動先も無い字幕の箱ができる**（#787）＝ここで書き出しの関門まで見ておかないと、
    // 関門を「何も描かれない字幕」へ広げたときに**焼いた直後の動画が書き出せなくなる**のを誰も検知できない。
    expectSound(doc);
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
    expectSound(doc); // 焼けなかった字幕があっても、焼いた動画はそのまま書き出せる（#787）
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
  it('掛け合いの字幕は**焼けるようになった**ので記録しない（#633＝行ごとの字幕クリップ＋連動）', () => {
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
    expect(notes.filter((n) => n.code === BAKE_NOTE_CODE.dialogueSubtitle)).toEqual([]);
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

  it('セリフが1行だけの場面も焼ける（記録しない・#633）', () => {
    const p = project({
      scenes: [scene('scene_001', { lines: [{ lineId: 'line_001', text: 'ひとこと', status: NARRATION_STATUS.none }] })],
    });
    expect(bakeTimelineProject(p, opts()).notes).toEqual([]);
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

describe('sceneIdsBetween（「ここからここまで」の範囲）', () => {
  const list = [scene('scene_001'), scene('scene_002'), scene('scene_003'), scene('scene_004')];

  it('両端を含む再生順の場面 id を返す', () => {
    expect(sceneIdsBetween(list, 'scene_002', 'scene_003')).toEqual(['scene_002', 'scene_003']);
  });

  it('端を逆から選んでも同じ範囲になる（どちらから選んでもよい）', () => {
    expect(sceneIdsBetween(list, 'scene_003', 'scene_002')).toEqual(['scene_002', 'scene_003']);
  });

  it('同じ場面を両端にすると1件', () => {
    expect(sceneIdsBetween(list, 'scene_002', 'scene_002')).toEqual(['scene_002']);
  });

  it('見つからない端は空（呼び出し側が選び直しを促す）', () => {
    expect(sceneIdsBetween(list, 'scene_002', 'scene_999')).toEqual([]);
  });
});

describe('bakeTimelineProject: 掛け合いの字幕を行ごとの字幕クリップへ焼く（#633）', () => {
  const dialogue = (over: Partial<Scene> = {}) =>
    scene('scene_001', {
      durationSec: 10,
      lines: [
        { lineId: 'line_001', text: 'いちばん', status: NARRATION_STATUS.none },
        { lineId: 'line_002', text: 'にばん', status: NARRATION_STATUS.none },
      ],
      ...over,
    });
  const durations = { line_001: 4, line_002: 3 };

  it('行ごとに字幕クリップを作り、同じ行の読み上げへ連動させる', () => {
    const { doc } = bakeTimelineProject(project({ scenes: [dialogue()] }), opts({ lineDurationsFor: () => durations }));
    const subs = doc.clips.filter((c) => c.kind === 'subtitle');
    const voices = doc.clips.filter((c) => c.kind === 'voice');
    expect(subs).toHaveLength(2);
    expect(voices).toHaveLength(2);
    // 連動先＝同じ行の読み上げ（時間も一致する）。
    subs.forEach((sub) => {
      const v = voices.find((x) => x.id === sub.voiceClipId);
      expect(v).toBeDefined();
      expect({ s: sub.startSec, d: sub.durationSec }).toEqual({ s: v?.startSec, d: v?.durationSec });
    });
  });

  it('文言を焼き付ける（受け側で「対象」から解かなくても出る）', () => {
    const { doc } = bakeTimelineProject(project({ scenes: [dialogue()] }), opts({ lineDurationsFor: () => durations }));
    expect(doc.clips.filter((c) => c.kind === 'subtitle').map((c) => c.text)).toEqual(['いちばん', 'にばん']);
  });

  it('セリフごとの字幕文・字幕OFFを尊重する（描画と同じ解決）', () => {
    const p = project({
      scenes: [
        dialogue({
          lines: [
            { lineId: 'line_001', text: 'よむ', subtitleText: 'みせる', status: NARRATION_STATUS.none },
            { lineId: 'line_002', text: 'これは出ない', subtitleEnabled: false, status: NARRATION_STATUS.none },
          ],
        }),
      ],
    });
    const { doc } = bakeTimelineProject(p, opts({ lineDurationsFor: () => durations }));
    expect(doc.clips.filter((c) => c.kind === 'subtitle').map((c) => c.text)).toEqual(['みせる']);
  });

  it('テンプレクリップからは字幕のキーを落とす（場面いっぱいの静的字幕と二重にしない）', () => {
    const p = project({ scenes: [dialogue({ texts: { title: 'たいとる', subtitle: 'しずかな字幕' } })] });
    const { doc } = bakeTimelineProject(p, opts({ lineDurationsFor: () => durations }));
    const tmpl = doc.clips.find((c) => c.kind === 'template');
    expect(tmpl?.texts?.subtitle).toBeUndefined();
    expect(tmpl?.texts?.title).toBe('たいとる'); // ほかの文字は残る
  });

  it('体裁（場面ごとの上書き）を写す', () => {
    const p = project({ scenes: [dialogue({ textStyles: { subtitle: { fontSize: 80, color: '#00ff00' } } })] });
    const { doc } = bakeTimelineProject(p, opts({ lineDurationsFor: () => durations }));
    expect(doc.clips.find((c) => c.kind === 'subtitle')).toMatchObject({ fontSize: 80, color: '#00ff00' });
  });

  it('同時に流れるセリフの字幕は重ならないよう積む（下＝先頭・描画と同じ規則）', () => {
    const p = project({
      scenes: [
        dialogue({
          lines: [
            { lineId: 'line_001', text: 'いち', status: NARRATION_STATUS.none },
            { lineId: 'line_002', text: 'に', startWithPrevious: true, status: NARRATION_STATUS.none },
          ],
        }),
      ],
    });
    const { doc } = bakeTimelineProject(p, opts({ lineDurationsFor: () => durations }));
    const subs = doc.clips.filter((c) => c.kind === 'subtitle');
    expect(subs).toHaveLength(2);
    expect(subs[0].startSec).toBe(subs[1].startSec); // 同じ窓
    expect(subs[1].y!).toBeLessThan(subs[0].y!); // 2人目は上へ
  });

  it('読み上げ文が空でも字幕が出ている行は焼く（声は作らない）', () => {
    const p = project({
      scenes: [
        dialogue({
          lines: [
            { lineId: 'line_001', text: '', subtitleText: '声なしの字幕', status: NARRATION_STATUS.none },
            { lineId: 'line_002', text: 'こえあり', status: NARRATION_STATUS.none },
          ],
        }),
      ],
    });
    const { doc } = bakeTimelineProject(p, opts({ lineDurationsFor: () => durations }));
    expect(doc.clips.filter((c) => c.kind === 'subtitle').map((c) => c.text)).toEqual(['声なしの字幕', 'こえあり']);
    expect(doc.clips.filter((c) => c.kind === 'voice')).toHaveLength(1); // 声は文があるものだけ
    // 連動先の無い字幕は連動を持たない（壊れた参照を作らない）。
    expect(doc.clips.find((c) => c.text === '声なしの字幕')?.voiceClipId).toBeUndefined();
  });

  it('字幕の枠が無い見た目では焼かない（元から出ていない）', () => {
    const noSubtitle: Template = { ...NORMAL_TEMPLATE, layers: NORMAL_TEMPLATE.layers.filter((l) => l.type !== 'subtitle') };
    const { doc } = bakeTimelineProject(
      project({ scenes: [dialogue()] }),
      opts({ templateOf: () => noSubtitle, lineDurationsFor: () => durations }),
    );
    expect(doc.clips.filter((c) => c.kind === 'subtitle')).toHaveLength(0);
  });

  it('切り替えは場面まるごとに掛ける（字幕だけ不透明に残らない）', () => {
    const p = project({
      scenes: [dialogue(), scene('scene_002', { transition: { in: TRANSITION_TYPE.fade } })],
    });
    const { doc } = bakeTimelineProject(p, opts({ lineDurationsFor: () => durations }));
    // 1場面目は「テンプレ＋字幕」なので場面グループができ、切り替えの付け先はそのグループ。
    const group = doc.groups?.find((g) => g.members.some((m) => doc.clips.find((c) => c.id === m)?.kind === 'subtitle'));
    expect(group).toBeDefined();
    expect(group?.members).toContain(doc.clips.find((c) => c.kind === 'template')?.id);
  });

  it('焼いた文書はスキーマに適合する', () => {
    const { doc } = bakeTimelineProject(project({ scenes: [dialogue()] }), opts({ lineDurationsFor: () => durations }));
    expect(validateTimelineProject(doc)).toBe(true);
  });

  it('置いたクリップは同じ列で重ならない（V24）', () => {
    const { doc } = bakeTimelineProject(project({ scenes: [dialogue(), dialogue()] }), opts({ lineDurationsFor: () => durations }));
    expect(validateTimelineDoc(doc).filter((w) => w.code === 'TIMELINE_CLIP_OVERLAP')).toEqual([]);
  });
});

describe('bakeTimelineProject: 焼いた字幕の細部（#633 レビュー）', () => {
  const durations = { line_001: 4 };
  const withLines = (over: Partial<Scene> = {}) =>
    scene('scene_001', {
      durationSec: 10,
      texts: { subtitle: 'しずかな字幕' },
      lines: [{ lineId: 'line_001', text: 'よむ', status: NARRATION_STATUS.none }],
      ...over,
    });

  it('セリフ列がある場面は、行の字幕が全部 OFF でも静的字幕を復活させない（元から描かれていない）', () => {
    // 場面形式は字幕層を**行の字幕で上書き**するので、OFF なら何も出ない。キーを残すと焼いた側だけ
    // 場面いっぱいの静的字幕が出てしまう。
    const p = project({ scenes: [withLines({ subtitleEnabledDefault: false })] });
    const { doc } = bakeTimelineProject(p, opts({ lineDurationsFor: () => durations }));
    expect(doc.clips.filter((c) => c.kind === 'subtitle')).toHaveLength(0);
    expect(doc.clips.find((c) => c.kind === 'template')?.texts?.subtitle).toBeUndefined();
  });

  it('セリフ列が無くても、字幕 OFF の場面は静的字幕を復活させない', () => {
    const p = project({ scenes: [scene('scene_001', { texts: { subtitle: 'しずかな字幕' }, subtitleEnabledDefault: false })] });
    const { doc } = bakeTimelineProject(p, opts());
    expect(doc.clips.find((c) => c.kind === 'template')?.texts?.subtitle).toBeUndefined();
  });

  it('静的字幕が出ている場面（セリフ列なし・ON）は残す（黙って消さない）', () => {
    const p = project({ scenes: [scene('scene_001', { texts: { subtitle: 'しずかな字幕' } })] });
    const { doc } = bakeTimelineProject(p, opts());
    expect(doc.clips.find((c) => c.kind === 'template')?.texts?.subtitle).toBe('しずかな字幕');
  });

  it('自由配置の場面でも、見た目パターンの字幕層は行ごとに焼く（層は category を問わず描かれる）', () => {
    const freeWithSubtitle: Template = {
      ...FREE_TEMPLATE,
      layers: [...FREE_TEMPLATE.layers, { id: 'subtitle', type: 'subtitle', textKey: 'subtitle', x: 100, y: 900, w: 1720, h: 120 }],
    };
    const p = project({
      scenes: [scene('scene_001', {
        sceneType: FREE_CATEGORY, templateId: FREE_TEMPLATE.templateId, durationSec: 10,
        lines: [{ lineId: 'line_001', text: 'よむ', status: NARRATION_STATUS.none }],
      })],
    });
    const { doc } = bakeTimelineProject(p, opts({ templateOf: () => freeWithSubtitle, lineDurationsFor: () => durations }));
    expect(doc.clips.filter((c) => c.kind === 'subtitle').map((c) => c.text)).toContain('よむ');
  });

  it('場面のフォント・種別ごとのフォントを字幕クリップにも載せる（本文と字体が割れない）', () => {
    const p = project({
      scenes: [withLines({ fontId: 'kaitou-yokoku-gothic' })],
    });
    const { doc } = bakeTimelineProject(p, opts({ lineDurationsFor: () => durations }));
    expect(doc.clips.find((c) => c.kind === 'subtitle')?.fontId).toBe('kaitou-yokoku-gothic');
    const p2 = project({
      scenes: [withLines({ fontId: 'kaitou-yokoku-gothic', textFontIds: { subtitle: 'gen-interface-jp-display' } })],
    });
    const { doc: doc2 } = bakeTimelineProject(p2, opts({ lineDurationsFor: () => durations }));
    expect(doc2.clips.find((c) => c.kind === 'subtitle')?.fontId).toBe('gen-interface-jp-display');
  });

  it('回転は 0〜360 未満へ収める（グループの回転は足し算なので合成値が 360 を超える）', () => {
    const rotated: Template = {
      ...NORMAL_TEMPLATE,
      layers: NORMAL_TEMPLATE.layers.map((l) => (l.type === 'subtitle' ? { ...l, rotation: 350 } : l)),
      groups: [{ id: 'group_001', members: ['subtitle'], transform: { x: 0, y: 0, rotation: 340, scale: 1 } }],
    };
    const { doc } = bakeTimelineProject(
      project({ scenes: [withLines()] }),
      opts({ templateOf: () => rotated, lineDurationsFor: () => durations }),
    );
    const sub = doc.clips.find((c) => c.kind === 'subtitle');
    expect(sub?.rotation).toBeCloseTo(330); // 350+340=690 → 330
    expect(validateTimelineProject(doc)).toBe(true); // schema は 360 以上を拒む
  });

  it('枠高は「その行数が入る高さ」にする（層の高さを残すと上限より多く折り返す）', () => {
    const tall: Template = {
      ...NORMAL_TEMPLATE,
      layers: NORMAL_TEMPLATE.layers.map((l) => (l.type === 'subtitle' ? { ...l, h: 600, maxLines: 1 } : l)),
    };
    const { doc } = bakeTimelineProject(
      project({ scenes: [withLines()] }),
      opts({ templateOf: () => tall, lineDurationsFor: () => durations }),
    );
    expect(doc.clips.find((c) => c.kind === 'subtitle')?.h).toBeLessThan(600);
  });
});
