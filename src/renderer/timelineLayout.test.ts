// タイムライン形式の1フレーム（ADR-0032・#629）。並べ方（トラック順・生きている区間）と、
// 描画の核を場面形式と共有していることを固定する。
import { describe, expect, it } from 'vitest';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../domain/enums';
import type { Template } from '../domain/template/types';
import type { TimelineClip, TimelineProject } from '../domain/timeline/types';
import { TIMELINE_SCHEMA_VERSION } from '../domain/timeline/types';
import { layoutScene } from './layout';
import { clipIsLiveAt, layoutTimelineAt } from './timelineLayout';

const NORMAL_TEMPLATE: Template = {
  schemaVersion: '1.0',
  templateId: 'tmpl_normal',
  name: '通常',
  category: 'photo_intro',
  aspectRatio: '16:9',
  canvas: { width: 1920, height: 1080 },
  layers: [
    { id: 'background', type: 'background', x: 0, y: 0, w: 1920, h: 1080, fillColor: '#112233' },
    { id: 'title', type: 'text', textKey: 'title', x: 100, y: 200, w: 800, h: 140, fontSize: 72 },
  ],
};

const templateOf = (id: string): Template | undefined => (id === 'tmpl_normal' ? NORMAL_TEMPLATE : undefined);
const opts = { templateOf };

function doc(over: Partial<TimelineProject> = {}): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20260728_001',
    projectName: 'テスト',
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [],
    tracks: [
      { id: 'track_001', kind: TRACK_KIND.visual },
      { id: 'track_002', kind: TRACK_KIND.visual },
      { id: 'track_003', kind: TRACK_KIND.audio },
    ],
    clips: [],
    ...over,
  };
}

function clip(over: Partial<TimelineClip> & Pick<TimelineClip, 'id'>): TimelineClip {
  return { kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: 5, ...over };
}

const textClip = (id: string, over: Partial<TimelineClip> = {}): TimelineClip =>
  clip({ id, kind: TIMELINE_CLIP_KIND.text, x: 10, y: 20, w: 300, h: 80, text: `文字${id}`, ...over });

const templateClip = (id: string, over: Partial<TimelineClip> = {}): TimelineClip =>
  clip({ id, kind: TIMELINE_CLIP_KIND.template, templateId: 'tmpl_normal', texts: { title: 'みだし' }, ...over });

describe('clipIsLiveAt（生きている区間は半開＝V24 と同じ）', () => {
  const c = clip({ id: 'clip_001', startSec: 2, durationSec: 3 });
  it.each([
    [1.9, false],
    [2, true],
    [4.9, true],
    [5, false],
  ])('t=%s → %s', (t, live) => {
    expect(clipIsLiveAt(c, t)).toBe(live);
  });
});

describe('layoutTimelineAt: 並べ方', () => {
  it('その時刻に生きているクリップだけを描く', () => {
    const d = doc({ clips: [textClip('clip_001', { startSec: 0, durationSec: 2 }), textClip('clip_002', { startSec: 2, durationSec: 2 })] });
    expect(layoutTimelineAt(d, 1, opts).items.map((i) => i.id)).toEqual(['clip_001/clip_001']);
    expect(layoutTimelineAt(d, 3, opts).items.map((i) => i.id)).toEqual(['clip_002/clip_002']);
  });

  it('重ね順はトラックの並び順だけで決まる（後ろのトラックほど手前）', () => {
    const d = doc({
      clips: [textClip('clip_002', { trackId: 'track_002' }), textClip('clip_001', { trackId: 'track_001' })],
    });
    const items = layoutTimelineAt(d, 0, opts).items;
    // clips 配列の順ではなく tracks の順（track_001 → track_002）に並ぶ
    expect(items.map((i) => i.id)).toEqual(['clip_001/clip_001', 'clip_002/clip_002']);
    expect(items[0].zIndex).toBeLessThan(items[1].zIndex);
  });

  it('隠したトラック・隠したクリップ・音のクリップは描かない', () => {
    const d = doc({
      tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, hidden: true }, { id: 'track_002', kind: TRACK_KIND.visual }, { id: 'track_003', kind: TRACK_KIND.audio }],
      clips: [
        textClip('clip_001', { trackId: 'track_001' }), // 隠したトラック
        textClip('clip_002', { trackId: 'track_002', hidden: true }), // 隠したクリップ
        clip({ id: 'clip_003', kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_003', voice: { text: 'あ', status: 'none' } }),
        textClip('clip_004', { trackId: 'track_002' }),
      ],
    });
    expect(layoutTimelineAt(d, 0, opts).items.map((i) => i.id)).toEqual(['clip_004/clip_004']);
  });

  it('見た目が見つからないクリップは描かない（他のクリップは描く）', () => {
    const d = doc({ clips: [templateClip('clip_001', { templateId: 'tmpl_missing' }), textClip('clip_002', { trackId: 'track_002' })] });
    expect(layoutTimelineAt(d, 0, opts).items.map((i) => i.id)).toEqual(['clip_002/clip_002']);
  });
});

describe('layoutTimelineAt: 1クリップの中身は場面形式と同じ核で描く（ADR-0001）', () => {
  it('テンプレのクリップは、同じ内容の場面を描いたのと同じアイテムになる', () => {
    const d = doc({ clips: [templateClip('clip_001')] });
    // 先頭はクリップ自身の下地（場面形式では SceneLayout.backgroundColor がフレームを塗る分）。
    const [bg, ...fromTimeline] = layoutTimelineAt(d, 0, opts).items;
    expect(bg).toMatchObject({ kind: 'fill', x: 0, y: 0, w: 1920, h: 1080 });
    // 同じ差し込み口を持つ場面を layoutScene で描いた結果（id と重ね順だけが並べ方で変わる）
    const fromScene = layoutScene(
      {
        sceneId: 'clip_001', partId: '', order: 0, sceneType: 'photo_intro', templateId: 'tmpl_normal',
        durationSec: 5, assetRefs: {}, character: { enabled: false, characterId: 'yuko' },
        texts: { title: 'みだし' }, narration: { text: '', status: 'none' }, warnings: [],
      },
      NORMAL_TEMPLATE,
    ).items;
    expect(fromTimeline).toHaveLength(fromScene.length);
    fromTimeline.forEach((item, i) => {
      expect({ ...item, id: '', zIndex: 0 }).toEqual({ ...fromScene[i], id: '', zIndex: 0 });
    });
  });

  it('自由配置のクリップは空間の語彙をそのまま持ち込む', () => {
    const d = doc({ clips: [textClip('clip_001', { fontSize: 48, color: '#ff0000' })] });
    expect(layoutTimelineAt(d, 0, opts).items[0]).toMatchObject({
      x: 10, y: 20, w: 300, h: 80, text: '文字clip_001', fontSize: 48, color: '#ff0000',
    });
  });
});

describe('layoutTimelineAt: キーフレーム（切り替えはこれで表す＝ADR-0032 決定19）', () => {
  it('クリップ対象は「クリップの先頭からの秒」で補間する', () => {
    const d = doc({
      clips: [textClip('clip_001', { startSec: 4, durationSec: 5 })],
      animations: [{ id: 'anim_001', targetId: 'clip_001', keyframes: [{ timeSec: 0, opacity: 0 }, { timeSec: 1, opacity: 1 }] }],
    });
    expect(layoutTimelineAt(d, 4, opts).items[0].opacity).toBe(0); // クリップの先頭
    expect(layoutTimelineAt(d, 4.5, opts).items[0].opacity).toBeCloseTo(0.5);
    expect(layoutTimelineAt(d, 5, opts).items[0].opacity).toBe(1);
  });

  it('位置は本来位置からの相対（後から動かしても追従する）', () => {
    const d = doc({
      clips: [textClip('clip_001', { x: 10 })],
      animations: [{ id: 'anim_001', targetId: 'clip_001', keyframes: [{ timeSec: 0, x: 100 }, { timeSec: 1, x: 0 }] }],
    });
    expect(layoutTimelineAt(d, 0, opts).items[0].x).toBe(110); // 10 + 100
    expect(layoutTimelineAt(d, 1, opts).items[0].x).toBe(10);
  });

  it('グループ対象は「所属クリップのうち最も早い開始秒」を起点にする', () => {
    const d = doc({
      clips: [textClip('clip_001', { startSec: 4 }), textClip('clip_002', { startSec: 4, trackId: 'track_002' })],
      groups: [{ id: 'group_001', members: ['clip_001', 'clip_002'], transform: { x: 0, y: 0, rotation: 0, scale: 1 } }],
      animations: [{ id: 'anim_001', targetId: 'group_001', keyframes: [{ timeSec: 0, opacity: 0 }, { timeSec: 1, opacity: 1 }] }],
    });
    expect(layoutTimelineAt(d, 4, opts).items.map((i) => i.opacity)).toEqual([0, 0]);
    expect(layoutTimelineAt(d, 5, opts).items.map((i) => i.opacity)).toEqual([1, 1]);
  });

  it('グループの不透明度は要素自身の不透明度へ乗算で効く（潰さない）', () => {
    const d = doc({
      clips: [textClip('clip_001', { kind: TIMELINE_CLIP_KIND.shape, shapeType: 'rect', opacity: 0.5 })],
      groups: [{ id: 'group_001', members: ['clip_001'], transform: { x: 0, y: 0, rotation: 0, scale: 1 } }],
      animations: [{ id: 'anim_001', targetId: 'group_001', keyframes: [{ timeSec: 0, opacity: 0 }, { timeSec: 1, opacity: 1 }] }],
    });
    expect(layoutTimelineAt(d, 1, opts).items[0].opacity).toBeCloseTo(0.5); // 0.5 × 1
    expect(layoutTimelineAt(d, 0.5, opts).items[0].opacity).toBeCloseTo(0.25); // 0.5 × 0.5
  });

  it('グループの変形はメンバーの位置へ効く（通常描画と同じ合成）', () => {
    const d = doc({
      clips: [textClip('clip_001', { x: 10, y: 20 })],
      groups: [{ id: 'group_001', members: ['clip_001'], transform: { x: 30, y: 40, rotation: 0, scale: 1 } }],
    });
    expect(layoutTimelineAt(d, 0, opts).items[0]).toMatchObject({ x: 40, y: 60 });
  });

  it('隠したグループのメンバーは描かない', () => {
    const d = doc({
      clips: [textClip('clip_001')],
      groups: [{ id: 'group_001', members: ['clip_001'], transform: { x: 0, y: 0, rotation: 0, scale: 1 }, hidden: true }],
    });
    expect(layoutTimelineAt(d, 0, opts).items).toEqual([]);
  });
});

describe('layoutTimelineAt: キャンバス', () => {
  it('向きから寸法を導く（縦型）', () => {
    const d = doc({ videoSettings: { aspectRatio: '9:16', fps: 30, targetDurationSec: 60, maxDurationSec: 600 } });
    expect(layoutTimelineAt(d, 0, opts)).toMatchObject({ width: 1080, height: 1920 });
  });

  it('何も置いていない時刻でも下地を返す（画面が消えない）', () => {
    expect(layoutTimelineAt(doc(), 0, opts)).toMatchObject({ backgroundColor: '#ffffff', items: [] });
  });
});

describe('layoutTimelineAt: クリップは中身の座標系（#642 レビュー 🔴）', () => {
  // NORMAL_TEMPLATE の title 層は x:100 y:200 w:800 h:140（中心 500,270）。テンプレのクリップは画面いっぱい
  // （0,0,1920,1080・中心 960,540）なので、グループ中心＝クリップの箱の中心になる。
  const grouped = (transform: { x: number; y: number; rotation: number; scale: number }) =>
    doc({
      clips: [templateClip('clip_001')],
      groups: [{ id: 'group_001', members: ['clip_001'], transform }],
    });

  it('グループの拡大は「グループ中心まわり」に効く（アイテム自身の中心まわりではない）', () => {
    const items = layoutTimelineAt(grouped({ x: 0, y: 0, rotation: 0, scale: 2 }), 0, opts).items;
    const title = items.find((i) => i.id.endsWith('/title'))!;
    // 中心 500,270 → 960+(500-960)*2 = 40 ／ 540+(270-540)*2 = 0。大きさは2倍。
    expect(title).toMatchObject({ x: -760, y: -140, w: 1600, h: 280 });
    // 箱そのものである background 層は箱の動きと一致する。
    expect(items.find((i) => i.id.endsWith('/background'))!).toMatchObject({ x: -960, y: -540, w: 3840, h: 2160 });
  });

  it('グループの回転もグループ中心まわりに効く（層ごとに自転しない）', () => {
    const items = layoutTimelineAt(grouped({ x: 0, y: 0, rotation: 90, scale: 1 }), 0, opts).items;
    const title = items.find((i) => i.id.endsWith('/title'))!;
    // 中心 500,270 を 960,540 まわりに 90° 回すと (960+270, 540-460) = (1230, 80)。
    expect(title.x + title.w / 2).toBeCloseTo(1230);
    expect(title.y + title.h / 2).toBeCloseTo(80);
    expect(title.rotation).toBe(90); // 角度は各層にも足される
  });

  it('クリップ自身の拡大もクリップの中心まわりに効く（層がばらばらに拡大しない）', () => {
    const d = doc({
      clips: [templateClip('clip_001')],
      animations: [{ id: 'anim_001', targetId: 'clip_001', keyframes: [{ timeSec: 0, scale: 2 }] }],
    });
    const title = layoutTimelineAt(d, 0, opts).items.find((i) => i.id.endsWith('/title'))!;
    expect(title).toMatchObject({ x: -760, y: -140, w: 1600, h: 280 });
  });

  it('グループとクリップ自身の変形は重なる（グループ→自身の順）', () => {
    const d = doc({
      clips: [templateClip('clip_001')],
      groups: [{ id: 'group_001', members: ['clip_001'], transform: { x: 0, y: 0, rotation: 0, scale: 2 } }],
      animations: [{ id: 'anim_001', targetId: 'clip_001', keyframes: [{ timeSec: 0, x: 100 }] }],
    });
    const title = layoutTimelineAt(d, 0, opts).items.find((i) => i.id.endsWith('/title'))!;
    expect(title).toMatchObject({ x: -660, y: -140, w: 1600, h: 280 }); // 拡大後に +100 だけ動く
  });
});

describe('layoutTimelineAt: レビュー指摘の修正（PR #642 /canon-check）', () => {
  it('焼き付けた字幕の文言を描く（#628 の「黙って消さない」が受け側で効く）', () => {
    const d = doc({
      clips: [clip({ id: 'clip_001', kind: TIMELINE_CLIP_KIND.subtitle, x: 0, y: 900, w: 1920, h: 120, text: '焼き付けた字幕' })],
    });
    const items = layoutTimelineAt(d, 0, opts).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'text', text: '焼き付けた字幕', isSubtitle: true });
  });

  it('文言の無い字幕クリップは何も描かない（空の帯を出さない）', () => {
    const d = doc({ clips: [clip({ id: 'clip_001', kind: TIMELINE_CLIP_KIND.subtitle, x: 0, y: 900, w: 1920, h: 120 })] });
    expect(layoutTimelineAt(d, 0, opts).items).toEqual([]);
  });

  it('クリップの不透明度は乗算＝層自身の濃さを潰さない（区間外でも化けない）', () => {
    const withOpacity: Template = {
      ...NORMAL_TEMPLATE,
      layers: [{ id: 'background', type: 'background', x: 0, y: 0, w: 1920, h: 1080, fillColor: '#112233', opacity: 0.4 }],
    };
    const d = doc({
      clips: [templateClip('clip_001', { durationSec: 5 })],
      animations: [{ id: 'anim_001', targetId: 'clip_001', keyframes: [{ timeSec: 0, opacity: 0 }, { timeSec: 1, opacity: 1 }] }],
    });
    const at = (t: number) =>
      layoutTimelineAt(d, t, { templateOf: () => withOpacity }).items.find((i) => i.id.endsWith('/background'))!;
    expect(at(1).opacity).toBeCloseTo(0.4); // フェード後も層の 0.4 のまま（1 に化けない）
    expect(at(0.5).opacity).toBeCloseTo(0.2); // 途中は 0.4 × 0.5
    expect(at(3).opacity).toBeCloseTo(0.4); // 区間外クランプでも化けない
  });

  it('クリップ全体のフォント指定が文字へ届く（テンプレのクリップだけ既定へ戻らない）', () => {
    const d = doc({ clips: [templateClip('clip_001', { fontId: 'kaitou-yokoku-gothic' })] });
    const title = layoutTimelineAt(d, 0, opts).items.find((i) => i.id.endsWith('/title'))!;
    expect(title.kind === 'text' && title.fontId).toBe('kaitou-yokoku-gothic');
  });

  it('種別ごとの指定があればそちらが勝つ（クリップ全体は受け皿）', () => {
    const d = doc({ clips: [templateClip('clip_001', { fontId: 'kaitou-yokoku-gothic', textFontIds: { title: 'gen-interface-jp-display' } })] });
    const title = layoutTimelineAt(d, 0, opts).items.find((i) => i.id.endsWith('/title'))!;
    expect(title.kind === 'text' && title.fontId).toBe('gen-interface-jp-display');
  });

  it('背景の層を持たない見た目でも、その見た目の下地色を敷く（黙って白にしない）', () => {
    const noBackground: Template = {
      ...NORMAL_TEMPLATE,
      defaults: { backgroundColor: '#123456' },
      layers: [{ id: 'title', type: 'text', textKey: 'title', x: 100, y: 200, w: 800, h: 140, fontSize: 72 }],
    };
    const d = doc({ clips: [templateClip('clip_001')] });
    const items = layoutTimelineAt(d, 0, { templateOf: () => noBackground }).items;
    expect(items[0]).toMatchObject({ kind: 'fill', color: '#123456', x: 0, y: 0, w: 1920, h: 1080 });
  });
});
