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
