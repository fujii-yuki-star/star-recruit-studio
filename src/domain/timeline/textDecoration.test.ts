// 文字の体裁は**共有の語彙**＝両形式で触れる（#264・ADR-0032 追補3・差分再監査 3巡目）。
//
// ⚠️ **タイムライン側だけ書き込めなかった**＝描画（`layoutTimelineAt`→`layoutScene` の FREE 分岐）も
// 焼き出しも通っているのに `setVisualClipContent` が受けず、「同じ語彙なのに片方でしか編集できない
// 項目」ができていた（ADR-0026②）。
import { describe, expect, it } from 'vitest';
import { setVisualClipContent } from './edit';
import { TIMELINE_CLIP_KIND, TRACK_KIND, PROJECT_FORMAT } from '../enums';
import { TIMELINE_SCHEMA_VERSION } from './types';
import type { TimelineProject } from './types';

const doc = (): TimelineProject => ({
  schemaVersion: TIMELINE_SCHEMA_VERSION,
  format: PROJECT_FORMAT.timeline,
  projectId: 'proj_1', projectName: 'テスト',
  createdAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T00:00:00.000Z',
  videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
  voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
  assets: [],
  tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }],
  clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: 'あ' }],
} as unknown as TimelineProject);

describe('タイムラインの文字クリップの体裁（#264）', () => {
  it('字間を書き込める', () => {
    const r = setVisualClipContent(doc(), 'clip_001', { letterSpacing: 0.2 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.clips[0].letterSpacing).toBeCloseTo(0.2);
  });

  it('影を書き込める', () => {
    const r = setVisualClipContent(doc(), 'clip_001', { shadow: { enabled: true, blur: 4 } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.clips[0].shadow).toEqual({ enabled: true, blur: 4 });
  });

  /** ⚠️ **その種類が持つ項目だけを受ける**＝図形に文字の体裁を書かない（既存の規則を壊さない）。 */
  it('図形には書けない', () => {
    const d = doc();
    d.clips[0] = { ...d.clips[0], kind: TIMELINE_CLIP_KIND.shape } as never;
    expect(setVisualClipContent(d, 'clip_001', { letterSpacing: 0.2 }).ok).toBe(false);
  });

  /**
   * ⚠️ **何も変わらないなら同じ文書を返す**（`11 §7.6.3`・PR #912 レビュー ℹ️）＝影は
   * オブジェクトなので `===` で比べると**同じ内容でも「変わった」**になり、空振りの取り消しが積まれる。
   */
  it('同じ影を置き直しても、同じ文書を返す', () => {
    const d = doc();
    d.clips[0] = { ...d.clips[0], shadow: { enabled: true, blur: 4 } } as never;
    const r = setVisualClipContent(d, 'clip_001', { shadow: { enabled: true, blur: 4 } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc).toBe(d); // 同一参照＝履歴に積まれない
  });

  /**
   * ⚠️ **#264 の語彙は3つそろえる**（差分再監査 4巡目 🟡・ADR-0032 追補3）＝影・字間だけだと
   * **背景帯だけ片方でしか編集できない**（描画も焼き出しも通っているのに解除できない）。
   */
  it('背景帯と行間も書き込める', () => {
    const r = setVisualClipContent(doc(), 'clip_001', { background: { enabled: true, opacity: 0.5 }, lineHeight: 1.6 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.doc.clips[0].background).toEqual({ enabled: true, opacity: 0.5 });
      expect(r.doc.clips[0].lineHeight).toBeCloseTo(1.6);
    }
  });

  /**
   * ⚠️ **字幕クリップも体裁を持つ**（🟡）＝`addLinkedSubtitleClip` が体裁を書き込み描画も通る＝
   * **効くのに選べない**を作らない。文言は連動先から採るので `text` は持たせない。
   */
  it('字幕クリップにも体裁を書き込める（ただし文は書けない）', () => {
    const d = doc();
    d.clips[0] = { ...d.clips[0], kind: TIMELINE_CLIP_KIND.subtitle } as never;
    expect(setVisualClipContent(d, 'clip_001', { letterSpacing: 0.1 }).ok).toBe(true);
    expect(setVisualClipContent(d, 'clip_001', { text: 'あ' }).ok).toBe(false);
  });

  /**
   * ⚠️ **見た目パターンの部品も文字の形を持つ**（🟡）＝焼き出しが `scene.fontId` をここへ書き、
   * 描画と書き出しの門が見る。直せないと門の案内どおりの操作が**この形式に存在しない**。
   */
  it('見た目パターンの部品は文字の形だけ書ける', () => {
    const d = doc();
    d.clips[0] = { ...d.clips[0], kind: TIMELINE_CLIP_KIND.template, templateId: 't1' } as never;
    expect(setVisualClipContent(d, 'clip_001', { fontId: 'user_font_001' }).ok).toBe(true);
    // 差し込み口と文は別の口（`setClipAssetRef`／`setClipText`）＝ここでは受けない。
    expect(setVisualClipContent(d, 'clip_001', { text: 'あ' }).ok).toBe(false);
  });
});

// ⚠️ **縁取りも共有の語彙**（差分再監査 5巡目 🟡）＝描画は写す（`freeElementFromClip`）し「バラす」は
// 元の要素の縁取りをそのまま持ち込むので、書けないと**外せない縁取り**が残る（場面形式では外せる）。
describe('縁取り（バラした文字から外せる）', () => {
  it('文字クリップに縁取りを書ける', () => {
    const r = setVisualClipContent(doc(), 'clip_001', { strokeWidth: 4, strokeColor: '#ffffff' });
    expect(r.ok).toBe(true);
    if (r.ok) expect([r.doc.clips[0].strokeWidth, r.doc.clips[0].strokeColor]).toEqual([4, '#ffffff']);
  });

  it('字幕クリップにも縁取りを書ける', () => {
    const d = doc();
    d.clips[0] = { ...d.clips[0], kind: TIMELINE_CLIP_KIND.subtitle } as never;
    const r = setVisualClipContent(d, 'clip_001', { strokeWidth: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.clips[0].strokeWidth).toBe(2);
  });

  it('図形には書けない（その種類が持つ項目だけを受ける）', () => {
    const d = doc();
    d.clips[0] = { ...d.clips[0], kind: TIMELINE_CLIP_KIND.shape } as never;
    expect(setVisualClipContent(d, 'clip_001', { strokeWidth: 2 }).ok).toBe(false);
  });

  // ⚠️ **字幕は文言を持たない**（連動先から採る）＝ここだけは文字クリップと顔ぶれが違う。
  it('字幕には文言を書けない（連動先から採る）', () => {
    const d = doc();
    d.clips[0] = { ...d.clips[0], kind: TIMELINE_CLIP_KIND.subtitle } as never;
    expect(setVisualClipContent(d, 'clip_001', { text: 'あ' }).ok).toBe(false);
  });

  it('字幕にも大きさ・色・太さ・揃え・フォントを書ける（入口と同じ顔ぶれ）', () => {
    const d = doc();
    d.clips[0] = { ...d.clips[0], kind: TIMELINE_CLIP_KIND.subtitle } as never;
    const r = setVisualClipContent(d, 'clip_001', { fontSize: 48, color: '#ff0000', fontWeight: 'bold', textAlign: 'center', fontId: 'gen-interface-jp' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.clips[0].fontSize).toBe(48);
  });
});

// 種別ごとの文字の形（差分再監査 5巡目 🟡）。
//
// ⚠️ **書き出しの門が数えるのに直せなかった**＝焼き出しが `scene.textFontIds` を見た目パターンの
// 部品へ書き、`usedTimelineUserFontIds` が数えるので、持ち込みフォントが消えると**案内どおりに
// 選び直す先がこの形式に無く**、書き出しが止まったまま解除できなかった（§2-5 の行き止まり）。
describe('見た目パターンの部品の種別ごとの文字の形', () => {
  const templateClip = (): TimelineProject => {
    const d = doc();
    d.clips[0] = { ...d.clips[0], kind: TIMELINE_CLIP_KIND.template, templateId: 'tmpl_1' } as never;
    return d;
  };

  it('種別ごとに書ける', () => {
    const r = setVisualClipContent(templateClip(), 'clip_001', { textFontIds: { title: 'gen-interface-jp' } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.clips[0].textFontIds).toEqual({ title: 'gen-interface-jp' });
  });

  it('文字クリップには書けない（その種類が持つ項目だけを受ける）', () => {
    expect(setVisualClipContent(doc(), 'clip_001', { textFontIds: { title: 'gen-interface-jp' } }).ok).toBe(false);
  });
});
