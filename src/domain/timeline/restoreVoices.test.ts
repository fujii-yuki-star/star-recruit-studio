// タイムライン形式で戻すときの、文と音の食い違い（#977）。
// ⚠️ **場面形式（`domain/project/restoreVoices.test.ts`）の双子**＝同じ穴を片方だけ塞がない。
import { describe, expect, it } from 'vitest';
import { clearStaleTimelineVoices } from './restoreVoices';
import type { TimelineProject } from './types';

const voiceClip = (id: string, text: string, status: string, extra: Record<string, unknown> = {}) =>
  ({ id, trackId: 'track_001', kind: 'voice', startSec: 0, durationSec: 2,
     voice: { text, status, voicePath: `voices/${id}.wav`, ...extra } }) as unknown as TimelineProject['clips'][number];

const doc = (clips: TimelineProject['clips'], voiceSettings: Record<string, unknown> = {}): TimelineProject =>
  ({ clips, voiceSettings, tracks: [] } as unknown as TimelineProject);

describe('clearStaleTimelineVoices（#977）', () => {
  it('文が変わっている読み上げだけ「作成前」に戻す', () => {
    const restored = doc([voiceClip('clip_001', '古い文', 'generated')]);
    const current = doc([voiceClip('clip_001', '新しい文', 'generated')]);
    const { doc: fixed, count } = clearStaleTimelineVoices(restored, current);
    expect(fixed.clips[0].voice!.status).toBe('none');
    expect(fixed.clips[0].voice!.voicePath).toBeNull();
    expect(count.cleared).toBe(1);
  });

  it('文が同じものは触らない（戻すたびに全部作り直させない）', () => {
    const restored = doc([voiceClip('clip_001', '同じ文', 'generated')]);
    const current = doc([voiceClip('clip_001', '同じ文', 'generated')]);
    const { doc: fixed, count } = clearStaleTimelineVoices(restored, current);
    expect(fixed.clips[0].voice!.status).toBe('generated');
    expect(count.cleared).toBe(0);
  });

  it('いまに無いクリップは、比べようが無いので作成前に戻す', () => {
    // 音のファイルはクリップを消しても残る＝素通りさせると「文は戻った・音はいまの文」が復活する。
    const restored = doc([voiceClip('clip_001', 'むかしの文', 'generated')]);
    const current = doc([]);
    const { count } = clearStaleTimelineVoices(restored, current);
    expect(count.cleared).toBe(1);
  });

  it('まだ作っていない読み上げは数えない（作り直しを促さない）', () => {
    const restored = doc([voiceClip('clip_001', 'まだ', 'none')]);
    const current = doc([]);
    expect(clearStaleTimelineVoices(restored, current).count.cleared).toBe(0);
  });

  it('動画全体の声の設定が違えば、文が同じでも作成前に戻す', () => {
    // ⚠️ **それぞれの文書の設定で解く**＝戻す内容といまの内容で既定が違うことがある。
    const restored = doc([voiceClip('clip_001', '同じ文', 'generated')], { speed: 1.0 });
    const current = doc([voiceClip('clip_001', '同じ文', 'generated')], { speed: 1.4 });
    expect(clearStaleTimelineVoices(restored, current).count.cleared).toBe(1);
  });

  it('読み上げでないクリップは触らない', () => {
    const other = { id: 'clip_002', trackId: 'track_001', kind: 'audio', startSec: 0, durationSec: 3 } as unknown as TimelineProject['clips'][number];
    const { doc: fixed, count } = clearStaleTimelineVoices(doc([other]), doc([]));
    expect(fixed.clips[0]).toBe(other);
    expect(count.cleared).toBe(0);
  });
});
