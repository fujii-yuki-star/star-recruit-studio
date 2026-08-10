// クリップの箱の解決（#685）。⚠️ 描画・「バラす」・編集の**3人が同じ関数**を見る（別々に書いていた）。
import { describe, expect, it } from 'vitest';
import { canHaveBox, resolveClipBox } from './box';
import { TIMELINE_CLIP_KIND } from '../enums';
import type { TimelineClip } from './types';

const canvas = { width: 1920, height: 1080 };
const clip = (over: Partial<TimelineClip> = {}): TimelineClip => ({
  id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: 2, ...over,
} as TimelineClip);

describe('resolveClipBox', () => {
  it('持っていない項目は**画面いっぱい**（枠そのもの）', () => {
    expect(resolveClipBox(clip(), canvas)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
  });

  it('持っている項目はそのまま', () => {
    expect(resolveClipBox(clip({ x: 100, y: 50, w: 400, h: 300 }), canvas))
      .toEqual({ x: 100, y: 50, w: 400, h: 300 });
  });

  it('一部だけ持っているときは**残りだけ**画面いっぱい', () => {
    // ⚠️ ここが編集の入口で効く＝`x` だけ書き込むと幅は画面いっぱいのままで右へはみ出す。
    expect(resolveClipBox(clip({ x: 100 }), canvas)).toEqual({ x: 100, y: 0, w: 1920, h: 1080 });
  });

  it('向きは**持っているときだけ**返す（0 を書き足さない）', () => {
    expect(resolveClipBox(clip(), canvas).rotation).toBeUndefined();
    expect(resolveClipBox(clip({ rotation: 90 }), canvas).rotation).toBe(90);
  });

  it('縦型でも画面の大きさに従う（向きごとに書き分けない）', () => {
    expect(resolveClipBox(clip(), { width: 1080, height: 1920 })).toEqual({ x: 0, y: 0, w: 1080, h: 1920 });
  });
});

describe('canHaveBox（箱を自分で持てる部品か）', () => {
  it('自由配置の4種は持てる（**字幕も**＝置いて動かせる）', () => {
    for (const k of [TIMELINE_CLIP_KIND.slot, TIMELINE_CLIP_KIND.text, TIMELINE_CLIP_KIND.shape, TIMELINE_CLIP_KIND.subtitle]) {
      expect(canHaveBox(k)).toBe(true);
    }
  });

  it('見た目パターンは持てない（枠そのもの＝幾何は「バラす」で触る）', () => {
    expect(canHaveBox(TIMELINE_CLIP_KIND.template)).toBe(false);
  });

  it('音と読み上げは持てない（画面に出ない）', () => {
    expect(canHaveBox(TIMELINE_CLIP_KIND.audio)).toBe(false);
    expect(canHaveBox(TIMELINE_CLIP_KIND.voice)).toBe(false);
  });
});
