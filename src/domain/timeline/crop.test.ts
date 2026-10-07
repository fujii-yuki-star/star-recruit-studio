// 切り抜き（#634）。設定の意味（箱の各辺を割合で隠す・中身は動かない）と、描画への効き方を固定する。
import { describe, expect, it } from 'vitest';
import { CROP_MAX } from '../constants';
import { CROP_MODE, FIT, PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import { TIMELINE_SCHEMA_VERSION } from './types';
import type { TimelineClip, TimelineProject } from './types';
import type { Template } from '../template/types';
import { EDIT_BLOCKED, setClipCrop, setClipCropAlign, setClipCropMode } from './edit';
import { validateTimelineDoc } from './validateTimelineDoc';
import { validateTimelineProject } from '../validation/generated/validators.js';
import { layoutTimelineAt } from '../../renderer/timelineLayout';
import { layoutToSvg } from '../../renderer/sceneSvg';

const clip = (over: Partial<TimelineClip> = {}): TimelineClip => ({
  id: 'clip_001',
  kind: TIMELINE_CLIP_KIND.shape,
  trackId: 'track_001',
  startSec: 0,
  durationSec: 5,
  x: 100,
  y: 200,
  w: 400,
  h: 300,
  fillColor: '#ff0000',
  ...over,
});

function doc(over: Partial<TimelineProject> = {}): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20260730_001',
    projectName: 'テスト',
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [],
    tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }],
    clips: [clip()],
    ...over,
  };
}

const draw = (d: TimelineProject, timeSec = 1): string =>
  layoutToSvg(layoutTimelineAt(d, timeSec, { templateOf: () => undefined }), {});

describe('setClipCrop', () => {
  it('辺ごとに割合で隠せる', () => {
    const r = setClipCrop(doc(), 'clip_001', 'bottom', 0.25);
    expect(r.ok && r.doc.clips[0].crop).toEqual({ bottom: 0.25 });
    expect(r.ok && validateTimelineProject(r.doc)).toBe(true);
  });

  it('0 に戻すとキーごと落ちる（既定と同じ値を書かない）', () => {
    const a = setClipCrop(doc(), 'clip_001', 'bottom', 0.25);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const r = setClipCrop(a.doc, 'clip_001', 'bottom', 0);
    expect(r.ok && r.doc.clips[0].crop).toBeUndefined();
  });

  it('上限へ収める（丸ごと消える設定を作らない）', () => {
    const r = setClipCrop(doc(), 'clip_001', 'top', 2);
    expect(r.ok && r.doc.clips[0].crop?.top).toBe(CROP_MAX);
    expect(r.ok && validateTimelineProject(r.doc)).toBe(true);
  });

  it('反対側と合わせて 1 を超えるときは、いま動かした側を残して反対側を詰める（入力を捨てない）', () => {
    const a = setClipCrop(doc(), 'clip_001', 'top', 0.8);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const r = setClipCrop(a.doc, 'clip_001', 'bottom', 0.5);
    expect(r.ok && r.doc.clips[0].crop).toEqual({ top: 0.49, bottom: 0.5 });
    expect(r.ok && validateTimelineProject(r.doc)).toBe(true);
  });

  it('同じ値なら文書は変わらない', () => {
    const d = doc();
    const r = setClipCrop(d, 'clip_001', 'top', 0);
    expect(r.ok && r.doc).toBe(d);
  });

  it('固定した列では変えられない', () => {
    const d = doc({ tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, locked: true }] });
    const r = setClipCrop(d, 'clip_001', 'top', 0.2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(EDIT_BLOCKED.locked);
  });
});

describe('切り抜きの描画', () => {
  it('切り抜きがなければ余計な要素を出さない（従来の絵と同じ）', () => {
    expect(draw(doc())).not.toContain('clip-path');
    // すべて 0（何も隠さない指定）も同じ＝空の切り抜きを出さない。
    expect(draw(doc({ clips: [clip({ crop: { top: 0, left: 0 } })] }))).not.toContain('clip-path');
  });

  it('箱の各辺を割合で隠す矩形になる（中身は動かない）', () => {
    const d = doc({ clips: [clip({ crop: { top: 0.25, left: 0.5 } })] });
    const svg = draw(d);
    // 箱は x=100,y=200,w=400,h=300 → 左 50%・上 25% を隠す＝x=300,y=275,w=200,h=225。
    expect(svg).toContain('<rect x="300" y="275" width="200" height="225"/>');
    // 中身（図形）自身の位置は変わらない＝隠れるだけ。
    expect(svg).toContain('x="100"');
  });

  it('動かした先で切れる（変形のあとの箱を基準にする）', () => {
    const d = doc({
      clips: [clip({ crop: { left: 0.5 } })],
      animations: [{ id: 'anim_001', targetId: 'clip_001', keyframes: [{ timeSec: 0, x: 200 }] }],
    });
    // x=100 の箱が +200 されて x=300 → 左半分を隠す矩形は x=500 から。
    expect(draw(d)).toContain('<rect x="500"');
  });

  it('薄くしても切り抜きは効く（合成のかたまりを包む）', () => {
    const d = doc({
      clips: [clip({ crop: { top: 0.5 } })],
      animations: [{ id: 'anim_001', targetId: 'clip_001', keyframes: [{ timeSec: 0, opacity: 0.5 }] }],
    });
    const svg = draw(d);
    expect(svg).toContain('clip-path');
    expect(svg).toContain('opacity="0.5"');
  });

  it('まとまりのフェード中でも、切り抜きは持っている部品だけに効く（隣を消さない・落とさない）', () => {
    const other: TimelineClip = {
      id: 'clip_002', kind: TIMELINE_CLIP_KIND.shape, trackId: 'track_002',
      startSec: 0, durationSec: 5, x: 800, y: 100, w: 200, h: 200, fillColor: '#00ff00',
    };
    const d = doc({
      clips: [clip({ crop: { top: 0.5 } }), other],
      tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }, { id: 'track_002', kind: TRACK_KIND.visual }],
      groups: [{ id: 'group_001', members: ['clip_001', 'clip_002'], transform: { x: 0, y: 0, rotation: 0, scale: 1 } }],
      animations: [{ id: 'anim_001', targetId: 'group_001', keyframes: [{ timeSec: 0, opacity: 0.5 }] }],
    });
    const svg = draw(d);
    // 切り抜きは残る（黙って落ちない）。
    expect(svg).toContain('clip-path="url(#crop_clip_001)"');
    // 隣の部品（切り抜きなし）は矩形の外にあるが描かれる＝別のクリップに効いていない。
    expect(svg).toContain('x="800"');
    // 切り抜きの中身は薄めるかたまりの内側（かたまりの外で包むと隣まで切れる）。
    expect(svg.indexOf('opacity="0.5"')).toBeLessThan(svg.indexOf('clip-path'));
  });

  it('回っている箱では矩形も同じだけ回す（箱の辺に沿って切る）', () => {
    const d = doc({ clips: [clip({ rotation: 45, crop: { top: 0.5 } })] });
    const svg = draw(d);
    expect(svg).toMatch(/<rect x="100" y="350" width="400" height="150" transform="rotate\(45 300 425\)"\/>/);
  });

  it('壊れたデータ（合計 1 以上）でも絵は丸ごと消さず、検証が知らせる', () => {
    const d = doc({ clips: [clip({ crop: { top: 0.7, bottom: 0.7 } })] });
    expect(draw(d)).toContain('height="1"'); // 1px 残す（縦）
    const wide = doc({ clips: [clip({ crop: { left: 0.7, right: 0.7 } })] });
    expect(draw(wide)).toContain('width="1"'); // 1px 残す（横）
    expect(validateTimelineDoc(d).map((w) => w.code)).toContain('TIMELINE_CROP_HIDES_ALL');
  });
});

describe('素材の寄せ（#634・05 §8）', () => {
  const slot = (over: Partial<TimelineClip> = {}): TimelineClip => ({
    id: 'clip_001', kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001',
    startSec: 0, durationSec: 5, x: 0, y: 0, w: 400, h: 300, assetId: 'asset_001', fit: 'cover', ...over,
  });
  const drawSlot = (d: TimelineProject): string =>
    layoutToSvg(layoutTimelineAt(d, 1, { templateOf: () => undefined }), { assetSrc: () => 'asset://a.png' });

  it('未指定は中央（従来どおり＝出力が変わらない）', () => {
    expect(drawSlot(doc({ clips: [slot()] }))).toContain('preserveAspectRatio="xMidYMid slice"');
  });

  it('寄せを指定すると切る側が変わる', () => {
    expect(drawSlot(doc({ clips: [slot({ cropAlign: { x: 'left', y: 'bottom' } })] }))).toContain('preserveAspectRatio="xMinYMax slice"');
  });

  it('全体を表示（contain）では余白の寄せになる', () => {
    expect(drawSlot(doc({ clips: [slot({ fit: 'contain', cropAlign: { y: 'top' } })] }))).toContain('preserveAspectRatio="xMidYMin meet"');
  });

  it('伸縮（stretch）では寄せの意味が無い', () => {
    expect(drawSlot(doc({ clips: [slot({ fit: 'stretch', cropAlign: { x: 'left' } })] }))).toContain('preserveAspectRatio="none"');
  });

  it('中央へ戻すとキーごと落ちる（既定と同じ値を書かない）', () => {
    const a = setClipCropAlign(doc({ clips: [slot()] }), 'clip_001', { x: 'left' });
    expect(a.ok && a.doc.clips[0].cropAlign).toEqual({ x: 'left' });
    if (!a.ok) return;
    const r = setClipCropAlign(a.doc, 'clip_001', { x: 'center' });
    expect(r.ok && r.doc.clips[0].cropAlign).toBeUndefined();
    const r2 = setClipCropAlign(a.doc, 'clip_001', { x: null });
    expect(r2.ok && r2.doc.clips[0].cropAlign).toBeUndefined();
  });

  it('縦横を別々に指定できる／同じ値なら文書は変わらない', () => {
    const a = setClipCropAlign(doc({ clips: [slot()] }), 'clip_001', { y: 'top' });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const b = setClipCropAlign(a.doc, 'clip_001', { x: 'right' });
    expect(b.ok && b.doc.clips[0].cropAlign).toEqual({ y: 'top', x: 'right' });
    if (!b.ok) return;
    const same = setClipCropAlign(b.doc, 'clip_001', { x: 'right' });
    expect(same.ok && same.doc).toBe(b.doc);
    expect(b.ok && validateTimelineProject(b.doc)).toBe(true);
  });

  it('固定した列では変えられない', () => {
    const d = doc({ clips: [slot()], tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, locked: true }] });
    expect(setClipCropAlign(d, 'clip_001', { x: 'left' }).ok).toBe(false);
  });
});

describe('setClipCropMode（切り抜きの効かせ方・#634）', () => {
  it('「枠いっぱいに映す」を選べる（保存できる形）', () => {
    const r = setClipCropMode(doc(), 'clip_001', CROP_MODE.fill);
    expect(r.ok && r.doc.clips[0].cropMode).toBe(CROP_MODE.fill);
    expect(r.ok && validateTimelineProject(r.doc)).toBe(true);
  });

  it('既定（隠したまま）へ戻すとキーごと落ちる＝既定と同じ値を書かない', () => {
    const a = setClipCropMode(doc(), 'clip_001', CROP_MODE.fill);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    for (const back of [CROP_MODE.mask, null] as const) {
      const r = setClipCropMode(a.doc, 'clip_001', back);
      expect(r.ok && r.doc.clips[0].cropMode).toBeUndefined();
    }
  });

  it('同じ値なら文書は変わらない（取り消しに空の操作を積まない）', () => {
    const d = doc();
    const r = setClipCropMode(d, 'clip_001', CROP_MODE.mask);
    expect(r.ok && r.doc).toBe(d);
  });

  it('固定した列の部品は変えられない（理由を返す）', () => {
    const d = doc({ tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, locked: true }] });
    const r = setClipCropMode(d, 'clip_001', CROP_MODE.fill);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe(EDIT_BLOCKED.locked);
  });
});

describe('枠いっぱいに映す（描画・#634）', () => {
  // 素材 200×100 を、400×300 の箱へ差し込むクリップ。
  const slot = (over: Partial<TimelineClip> = {}) =>
    doc({
      assets: [{ assetId: 'asset_001', assetType: 'image', displayName: '写真', filePath: 'assets/a.png' }],
      clips: [clip({ kind: TIMELINE_CLIP_KIND.slot, assetId: 'asset_001', fit: FIT.cover, ...over })],
    });
  const drawWithSize = (d: TimelineProject, size?: { w: number; h: number }): string =>
    layoutToSvg(
      layoutTimelineAt(d, 1, { templateOf: () => undefined, assetSizeOf: () => size }),
      { assetSrc: () => 'a.png' },
    );

  it('素材の実寸が分かるとき、切り抜いた残りが枠いっぱいに映る（絵が大きくなる）', () => {
    const masked = drawWithSize(slot({ crop: { left: 0.5 } }));
    const filled = drawWithSize(slot({ crop: { left: 0.5 }, cropMode: CROP_MODE.fill }), { w: 200, h: 100 });
    expect(masked).not.toBe(filled);
    // 当てはめは自前で計算するので、SVG 側の当てはめは切る（二重に効かせない）。
    expect(filled).toContain('preserveAspectRatio="none"');
    // 素材は箱（400 幅）より大きく置かれる＝残り半分が枠を満たす。
    const w = Number(/<image[^>]*\swidth="([\d.]+)"/.exec(filled)?.[1]);
    expect(w).toBeGreaterThan(400);
  });

  it('箱が回っていても、切り抜き矩形と同じ中心で回る（素材の中心で回らない）', () => {
    // 素材の矩形は箱より大きく中心もずれるので、自分の中心で回すと切り抜きとピボットが割れる。
    // 「箱の中心まわりに回してから置く」ので、回転の前後で**素材の中心と箱の中心の距離**が変わらない。
    const size = { w: 200, h: 100 };
    const rect = (svg: string) => {
      const m = /<image[^>]*\sx="(-?[\d.]+)"[^>]*\sy="(-?[\d.]+)"[^>]*\swidth="([\d.]+)"[^>]*\sheight="([\d.]+)"/.exec(svg);
      if (!m) throw new Error('絵が見つからない');
      return { x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) };
    };
    const at = (rotation?: number) =>
      rect(drawWithSize(slot({ crop: { left: 0.5 }, cropMode: CROP_MODE.fill, rotation }), size));
    // 箱の中心（clip は x:100,y:200,w:400,h:300）。
    const cx = 100 + 400 / 2;
    const cy = 200 + 300 / 2;
    const dist = (r: { x: number; y: number; w: number; h: number }) =>
      Math.hypot(r.x + r.w / 2 - cx, r.y + r.h / 2 - cy);
    const flat = at();
    const turned = at(90);
    expect(turned).not.toEqual(flat);
    expect(dist(turned)).toBeCloseTo(dist(flat), 6);
    // 90度なら、箱の中心から見たずれが直交する（回した先＝(-dy, dx)）。
    expect(turned.x + turned.w / 2 - cx).toBeCloseTo(-(flat.y + flat.h / 2 - cy), 6);
    expect(turned.y + turned.h / 2 - cy).toBeCloseTo(flat.x + flat.w / 2 - cx, 6);
  });

  it('実寸が分からない素材は「隠したまま」で描く（黙って別の絵にしない）', () => {
    const unknown = drawWithSize(slot({ crop: { left: 0.5 }, cropMode: CROP_MODE.fill }));
    expect(unknown).toBe(drawWithSize(slot({ crop: { left: 0.5 } })));
  });

  it('切り抜きが無ければ効かない（枠いっぱいは切り抜きの続き）', () => {
    const none = drawWithSize(slot({ cropMode: CROP_MODE.fill }), { w: 200, h: 100 });
    expect(none).toBe(drawWithSize(slot()));
  });

  it('見た目パターンの部品には効かない（絵が複数入るので、1つの素材の話にできない）', () => {
    // 差し込み口が2つある見た目＝「残りを枠いっぱい」は、どちらの素材の話か決まらない。
    const tmpl: Template = {
      schemaVersion: '1.0',
      templateId: 'tmpl_001',
      name: '写真2枚',
      category: 'photo_intro',
      aspectRatio: '16:9',
      canvas: { width: 1920, height: 1080 },
      layers: [
        { id: 'photo1', type: 'slot', slotType: 'image', x: 0, y: 0, w: 960, h: 1080 },
        { id: 'photo2', type: 'slot', slotType: 'image', x: 960, y: 0, w: 960, h: 1080 },
      ],
    };
    const tmplDoc = (over: Partial<TimelineClip>) =>
      doc({
        assets: [{ assetId: 'asset_001', assetType: 'image', displayName: '写真', filePath: 'assets/a.png' }],
        clips: [
          clip({
            kind: TIMELINE_CLIP_KIND.template,
            templateId: 'tmpl_001',
            assetId: 'asset_001',
            assetRefs: { photo1: 'asset_001', photo2: 'asset_001' },
            crop: { left: 0.5 },
            ...over,
          }),
        ],
      });
    const drawTmpl = (d: TimelineProject) =>
      layoutToSvg(layoutTimelineAt(d, 1, { templateOf: () => tmpl, assetSizeOf: () => ({ w: 200, h: 100 }) }), {
        assetSrc: () => 'a.png',
      });
    // 「枠いっぱい」を指定しても、辺を隠すだけ＝2枚が別々に拡大されない。
    expect(drawTmpl(tmplDoc({ cropMode: CROP_MODE.fill }))).toBe(drawTmpl(tmplDoc({})));
  });

  it('素材の差し込み口以外（図形など）には効かない', () => {
    const shape = doc({ clips: [clip({ crop: { left: 0.5 }, cropMode: CROP_MODE.fill })] });
    expect(drawWithSize(shape, { w: 200, h: 100 })).toBe(draw(doc({ clips: [clip({ crop: { left: 0.5 } })] })));
  });
});
