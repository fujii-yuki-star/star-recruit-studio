// 「バラす」の前後で**絵が変わらない**ことを固定する（ADR-0032 決定6・#632 の完了条件）。
//
// 変換の書き方（どの層をどの要素へ写すか）ではなく、**描いた結果**を比べる＝実装を書き換えても
// 「見た目が変わらない」だけは守られる（ADR-0001 のパリティと同じ考え方）。
import { describe, expect, it } from 'vitest';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../domain/enums';
import { TIMELINE_SCHEMA_VERSION } from '../domain/timeline/types';
import type { TimelineClip, TimelineProject } from '../domain/timeline/types';
import type { Template } from '../domain/template/types';
import { explodeTemplateClip } from '../domain/timeline/explode';
import { layoutTimelineAt } from './timelineLayout';
import { layoutToSvg } from './sceneSvg';
import { validateTimelineProject } from '../domain/validation/generated/validators.js';

const template: Template = {
  schemaVersion: '1.0',
  templateId: 'tmpl_001',
  name: 'いろいろ入り',
  category: 'opening',
  aspectRatio: '16:9',
  canvas: { width: 1920, height: 1080 },
  defaults: { backgroundColor: '#102030' },
  layers: [
    { id: 'background', type: 'background', x: 0, y: 0, w: 1920, h: 1080 },
    { id: 'deco', type: 'shape', x: 40, y: 40, w: 200, h: 120, fillColor: '#ff0000', shapeType: 'ellipse' },
    { id: 'mainVisual', type: 'slot', x: 100, y: 200, w: 800, h: 600 },
    { id: 'logo', type: 'logo', x: 1600, y: 60, w: 240, h: 120 },
    { id: 'titleText', type: 'text', textKey: 'title', x: 100, y: 860, w: 900, h: 90, fontSize: 60, color: '#ffffff' },
    { id: 'subtitleBand', type: 'subtitle', textKey: 'subtitle', x: 200, y: 950, w: 1520, h: 80, background: { enabled: true, color: '#000000', opacity: 0.5 } },
    { id: 'character', type: 'character', x: 1200, y: 300, w: 500, h: 700 },
  ],
};

function clip(over: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'clip_001',
    kind: TIMELINE_CLIP_KIND.template,
    trackId: 'track_001',
    startSec: 0,
    durationSec: 5,
    templateId: 'tmpl_001',
    assetRefs: { background: 'asset_bg', mainVisual: 'asset_main', logo: 'asset_logo' },
    texts: { title: 'こんにちは', subtitle: 'ごあいさつ' },
    character: { enabled: true, characterId: 'yuko', poseAssetId: 'asset_pose' },
    ...over,
  };
}

function doc(over: Partial<TimelineProject> = {}): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20260729_001',
    projectName: 'テスト',
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [],
    tracks: [
      { id: 'track_001', kind: TRACK_KIND.visual },
      { id: 'track_009', kind: TRACK_KIND.audio },
    ],
    clips: [clip()],
    ...over,
  };
}

const opts = { templateOf: (id: string) => (id === 'tmpl_001' ? template : undefined) };

/**
 * **実際に描かれる絵**（SVG）を比べる。アイテムの持ち物ではなく出力そのものを見る＝
 * 内部の持ち方（役割名やラベルなど、絵に出ないもの）が変わっても、絵が同じなら通る。
 */
function drawn(d: TimelineProject, timeSec = 1): string {
  return layoutToSvg(layoutTimelineAt(d, timeSec, opts), { assetSrc: (id) => (id ? `asset://${id}` : undefined) });
}

function exploded(d: TimelineProject, clipId = 'clip_001'): TimelineProject {
  const r = explodeTemplateClip(d, clipId, template);
  if (!r.ok) throw new Error(`バラせなかった: ${r.reason}`);
  return r.doc;
}

describe('バラす前後で絵が変わらない', () => {
  it('置いた中身（背景・素材・ロゴ・文字・字幕・立ち絵・図形）がそのまま出る', () => {
    const before = doc();
    expect(drawn(exploded(before))).toEqual(drawn(before));
  });

  it('差し込み口が空でも変わらない（未設定の枠もそのまま）', () => {
    const before = doc({ clips: [clip({ assetRefs: {}, character: { enabled: false, characterId: 'yuko' } })] });
    expect(drawn(exploded(before))).toEqual(drawn(before));
  });

  it('背景の層に素材が入っていなくても下地の色が残る（白く抜けない）', () => {
    const before = doc({ clips: [clip({ assetRefs: { mainVisual: 'asset_main' } })] });
    const after = exploded(before);
    expect(drawn(after)).toEqual(drawn(before));
    expect(drawn(after)).toContain('#102030'); // 下地の色が残っている
  });

  it('文字の体裁を場面ごとに変えていても、そのまま出る', () => {
    const before = doc({ clips: [clip({ textStyles: { title: { color: '#00ff00', fontSize: 90 } } })] });
    expect(drawn(exploded(before))).toEqual(drawn(before));
  });

  it('縦型でも変わらない', () => {
    const portrait: Template = { ...template, aspectRatio: '9:16', canvas: { width: 1080, height: 1920 } };
    const before = doc({ videoSettings: { aspectRatio: '9:16', fps: 30, targetDurationSec: 60, maxDurationSec: 600 } });
    const r = explodeTemplateClip(before, 'clip_001', portrait);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const withPortrait = { templateOf: () => portrait };
    const strip = (d: TimelineProject): string =>
      layoutToSvg(layoutTimelineAt(d, 1, withPortrait), { assetSrc: (id) => (id ? `asset://${id}` : undefined) });
    expect(strip(r.doc)).toEqual(strip(before));
  });

  it('動きを付けていても、同じ時刻で同じ絵になる（バラしても動きが止まらない）', () => {
    const before = doc({
      animations: [
        {
          id: 'anim_001',
          targetId: 'clip_001',
          keyframes: [
            { timeSec: 0, x: 0, y: 0, scale: 1, opacity: 1 },
            { timeSec: 4, x: 200, y: 100, scale: 1.5, opacity: 0.5 },
          ],
        },
      ],
    });
    const after = exploded(before);
    for (const t of [0, 1, 2.5, 4]) {
      expect(drawn(after, t)).toEqual(drawn(before, t));
    }
  });

  it('ほかの部品との前後関係が変わらない（手前の文字は手前のまま）', () => {
    const front: TimelineClip = {
      id: 'clip_front', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_002',
      startSec: 0, durationSec: 5, x: 0, y: 0, w: 500, h: 80, text: '手前',
    };
    const before = doc({
      tracks: [
        { id: 'track_001', kind: TRACK_KIND.visual },
        { id: 'track_002', kind: TRACK_KIND.visual },
        { id: 'track_009', kind: TRACK_KIND.audio },
      ],
      clips: [clip(), front],
    });
    expect(drawn(exploded(before))).toEqual(drawn(before));
  });

  it('隠した列の部品をバラしても表に出さない（列の「隠す」も引き継ぐ）', () => {
    const before = doc({
      tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, hidden: true }, { id: 'track_009', kind: TRACK_KIND.audio }],
    });
    const after = exploded(before);
    expect(drawn(after)).toEqual(drawn(before));
    expect(after.tracks.filter((t) => t.kind === TRACK_KIND.visual).every((t) => t.hidden)).toBe(true);
  });

  it('図形の枠線や文字の帯は足さない（通常の見た目では描かれないもの）', () => {
    const decorated: Template = {
      ...template,
      layers: [
        { id: 'deco', type: 'shape', x: 40, y: 40, w: 200, h: 120, fillColor: '#ff0000', strokeColor: '#00ff00', strokeWidth: 8 },
        { id: 'titleText', type: 'text', textKey: 'title', x: 100, y: 860, w: 900, h: 90, background: { enabled: true, color: '#000000', opacity: 0.5 } },
      ],
    };
    const before = doc();
    const r = explodeTemplateClip(before, 'clip_001', decorated);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const withDecorated = { templateOf: () => decorated };
    const strip = (d: TimelineProject): string =>
      layoutToSvg(layoutTimelineAt(d, 1, withDecorated), { assetSrc: (id) => (id ? `asset://${id}` : undefined) });
    expect(strip(r.doc)).toEqual(strip(before));
  });

  it('動きの支点が変わる形（中身が枠からはみ出す＋拡大）はバラさずに断る', () => {
    const bleeding: Template = {
      ...template,
      layers: [{ id: 'deco', type: 'shape', x: -200, y: 0, w: 400, h: 200, fillColor: '#ff0000' }],
    };
    const d = doc({
      animations: [
        { id: 'anim_001', targetId: 'clip_001', keyframes: [{ timeSec: 0, scale: 1 }, { timeSec: 4, scale: 2 }] },
      ],
    });
    const r = explodeTemplateClip(d, 'clip_001', bleeding);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('TIMELINE_EDIT_EXPLODE_ANCHOR');
  });

  it('平行移動だけの動きなら、はみ出していてもバラせる（支点に依らない）', () => {
    const bleeding: Template = {
      ...template,
      layers: [{ id: 'deco', type: 'shape', x: -200, y: 0, w: 400, h: 200, fillColor: '#ff0000' }],
    };
    const d = doc({
      animations: [
        { id: 'anim_001', targetId: 'clip_001', keyframes: [{ timeSec: 0, x: 0 }, { timeSec: 4, x: 300 }] },
      ],
    });
    const r = explodeTemplateClip(d, 'clip_001', bleeding);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const withBleeding = { templateOf: () => bleeding };
    const strip = (dd: TimelineProject, t: number): string =>
      layoutToSvg(layoutTimelineAt(dd, t, withBleeding), { assetSrc: (id) => (id ? `asset://${id}` : undefined) });
    for (const t of [0, 2, 4]) expect(strip(r.doc, t)).toEqual(strip(d, t));
  });

  it('渡した見た目パターンが違う部品のものならバラさない（取り違えたまま進めない）', () => {
    const other: Template = { ...template, templateId: 'tmpl_other' };
    const r = explodeTemplateClip(doc(), 'clip_001', other);
    expect(r.ok).toBe(false);
  });
});

describe('explodeTemplateClip（文書の形）', () => {
  it('元の部品は無くなり、中身ぶんの部品になる', () => {
    const after = exploded(doc());
    expect(after.clips.some((c) => c.id === 'clip_001')).toBe(false);
    expect(after.clips).toHaveLength(8); // 下地＋層7つ
    expect(after.clips.every((c) => c.startSec === 0 && c.durationSec === 5)).toBe(true);
  });

  it('バラした文書はスキーマに適合する（保存できない文書を作らない）', () => {
    // 描いた結果が同じでも、置けない持ち物が混ざっていると保存が黙って失敗する（自動保存は書かない）。
    expect(validateTimelineProject(exploded(doc()))).toBe(true);
  });

  it('隠してある部品をバラしても表に出さない', () => {
    const before = doc({ clips: [clip({ hidden: true })] });
    const after = exploded(before);
    expect(after.clips.every((c) => c.hidden)).toBe(true);
    expect(drawn(after)).toEqual(drawn(before));
  });

  it('まとめて動かせるように1つのグループにする', () => {
    const after = exploded(doc());
    const group = after.groups?.[after.groups.length - 1];
    expect(group?.members).toEqual(after.clips.map((c) => c.id));
  });

  it('元の列のすぐ手前に列を足す（ほかの列との前後関係を変えない）', () => {
    const before = doc();
    const after = exploded(before);
    expect(after.tracks[0].id).toBe('track_001'); // 元の列はその場所のまま
    expect(after.tracks[after.tracks.length - 1].kind).toBe(TRACK_KIND.audio); // 音の列は最後のまま
    // 足すのは**部品の数より1つ少ない**＝元の列を使い切る（空の列を残さない）。
    expect(after.tracks.length - before.tracks.length).toBe(after.clips.length - 1);
    expect(after.tracks.every((t) => after.clips.some((c) => c.trackId === t.id) || t.kind === TRACK_KIND.audio)).toBe(true);
  });

  it('元の部品が入っていたグループの席を引き継ぐ', () => {
    const before = doc({
      groups: [{ id: 'group_001', members: ['clip_001'], transform: { x: 0, y: 0, rotation: 0, scale: 1 } }],
    });
    const after = exploded(before);
    const parent = after.groups?.find((g) => g.id === 'group_001');
    expect(parent?.members).toHaveLength(1);
    expect(parent?.members[0]).not.toBe('clip_001');
    expect(after.groups?.some((g) => g.id === parent?.members[0])).toBe(true);
  });

  it('見た目パターン以外の部品はバラせない', () => {
    const d = doc({
      clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: 'あ' }],
    });
    const r = explodeTemplateClip(d, 'clip_001', template);
    expect(r.ok).toBe(false);
  });

  it('固定した列の部品はバラせない', () => {
    const d = doc({ tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, locked: true }, { id: 'track_009', kind: TRACK_KIND.audio }] });
    const r = explodeTemplateClip(d, 'clip_001', template);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('TIMELINE_EDIT_LOCKED');
  });
});
