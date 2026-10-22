// 部品を id で引く索引（負荷試験 2026-10-22）。`Array.prototype.find` と同じ答えを返すことを留める。
import { describe, expect, it } from 'vitest';
import { TIMELINE_CLIP_KIND } from '../enums';
import { findClipById } from './clipIndex';
import type { TimelineClip } from './types';

const clip = (id: string, startSec = 0): TimelineClip =>
  ({ id, kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec, durationSec: 1, x: 0, y: 0, w: 1, h: 1, text: id }) as TimelineClip;

describe('findClipById', () => {
  it('find と同じ答え（ある・無い・同じ id が2つなら先）', () => {
    const clips = [clip('clip_001'), clip('clip_002'), clip('clip_002', 5), clip('clip_003')];
    for (const id of ['clip_001', 'clip_002', 'clip_003', 'clip_999']) {
      expect(findClipById(clips, id)).toBe(clips.find((c) => c.id === id));
    }
  });

  it('配列をその場で書き換えても、いまの部品を返す（古い作り置きを返さない）', () => {
    const clips = [clip('clip_001'), clip('clip_002')];
    expect(findClipById(clips, 'clip_002')).toBe(clips[1]);
    // 同じ番目を別の部品に差し替える
    const replaced = clip('clip_002', 9);
    clips[1] = replaced;
    expect(findClipById(clips, 'clip_002')).toBe(replaced);
    // 足す（作ったときと数が変わる）
    const added = clip('clip_003');
    clips.push(added);
    expect(findClipById(clips, 'clip_003')).toBe(added);
    // 並べ替える
    clips.reverse();
    expect(findClipById(clips, 'clip_001')).toBe(clips.find((c) => c.id === 'clip_001'));
  });

  it('別の配列は別の索引（文書が変わったら作り直される）', () => {
    const a = [clip('clip_001')];
    const b = [clip('clip_001', 3)];
    expect(findClipById(a, 'clip_001')).toBe(a[0]);
    expect(findClipById(b, 'clip_001')).toBe(b[0]);
  });
});
