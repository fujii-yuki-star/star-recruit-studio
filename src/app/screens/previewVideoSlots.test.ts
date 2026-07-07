import { describe, expect, it } from 'vitest';
import { buildVideoPlaybackSlots } from './previewVideoSlots';
import type { VideoSlotInfo } from '../../renderer/export/findVideoSlot';

const slot = (over: Partial<VideoSlotInfo> = {}): VideoSlotInfo => ({
  slotLayerId: 'mainVisual',
  clipRelPath: 'assets/a.mp4',
  fit: 'cover',
  clipStartSec: 0,
  useOriginalAudio: false,
  speed: 1,
  ...over,
});

describe('buildVideoPlaybackSlots（#432 P2・場面送り直後の旧URL誤用を防ぐ）', () => {
  it('解決済みURLの relPath が現在スロットの clipRelPath と一致すれば採用', () => {
    const out = buildVideoPlaybackSlots(
      [slot({ clipRelPath: 'assets/a.mp4' })],
      { mainVisual: { url: 'blob:a', relPath: 'assets/a.mp4' } },
    );
    expect(out).toHaveLength(1);
    expect(out[0].clipUrl).toBe('blob:a');
  });

  it('同じ slotLayerId でも relPath が違えば旧URLを使わない（場面送り直後・新解決までサムネのまま）', () => {
    // 前場面の解決結果（a.mp4）が残ったまま、新場面が同じ mainVisual で別クリップ（b.mp4）に変わったケース。
    const out = buildVideoPlaybackSlots(
      [slot({ clipRelPath: 'assets/b.mp4' })],
      { mainVisual: { url: 'blob:a', relPath: 'assets/a.mp4' } },
    );
    expect(out).toHaveLength(0); // 旧URL(blob:a) を渡さない
  });

  it('未解決（map に無い）スロットは含めない', () => {
    const out = buildVideoPlaybackSlots([slot()], {});
    expect(out).toHaveLength(0);
  });

  it('クリップ設定（開始/終了/速度/元音声/fit）をそのまま運ぶ', () => {
    const out = buildVideoPlaybackSlots(
      [slot({ clipRelPath: 'assets/a.mp4', clipStartSec: 2, clipEndSec: 5, speed: 1.5, useOriginalAudio: true, originalVolume: 1.2, fit: 'contain' })],
      { mainVisual: { url: 'blob:a', relPath: 'assets/a.mp4' } },
    );
    expect(out[0]).toMatchObject({
      clipUrl: 'blob:a', clipStartSec: 2, clipEndSec: 5, speed: 1.5, useOriginalAudio: true, originalVolume: 1.2, fit: 'contain',
    });
  });

  it('複数スロットは一致したものだけ採用（片方だけ新解決済み）', () => {
    const out = buildVideoPlaybackSlots(
      [slot({ slotLayerId: 'slotA', clipRelPath: 'assets/a.mp4' }), slot({ slotLayerId: 'slotB', clipRelPath: 'assets/b.mp4' })],
      { slotA: { url: 'blob:a', relPath: 'assets/a.mp4' }, slotB: { url: 'blob:old', relPath: 'assets/old.mp4' } },
    );
    expect(out.map((s) => s.slotLayerId)).toEqual(['slotA']); // slotB は relPath 不一致で除外
  });
});
