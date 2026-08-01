import { describe, expect, it } from 'vitest';

import { PROJECT_FORMAT, TRACK_KIND } from '../enums';
import { validateTimelineProject } from '../validation/generated/validators.js';
import { createEmptyTimelineProject } from './create';
import { timelineDurationSec } from './persistence';
import { TIMELINE_SCHEMA_VERSION } from './types';
import { timelineExportBlockers } from './export';

const input = { projectId: 'proj_20260801_001', projectName: '新しいタイムライン', now: '2026-08-01T00:00:00.000Z' };

describe('createEmptyTimelineProject（完全新規・#635）', () => {
  it('そのまま保存できる形になっている（開けない動画を作らない）', () => {
    const doc = createEmptyTimelineProject(input);
    expect(validateTimelineProject(doc)).toBe(true);
    expect(doc.schemaVersion).toBe(TIMELINE_SCHEMA_VERSION);
    expect(doc.format).toBe(PROJECT_FORMAT.timeline);
  });

  it('最初から映像と音の列を1本ずつ持つ（置く前に「列を足す」から始めさせない）', () => {
    const doc = createEmptyTimelineProject(input);
    expect(doc.tracks.map((t) => t.kind)).toEqual([TRACK_KIND.visual, TRACK_KIND.audio]);
    // 列の id は編集操作と同じ採番規則（新規だけ別の付け方にしない）。
    expect(doc.tracks.map((t) => t.id)).toEqual(['track_001', 'track_002']);
  });

  it('中身は空＝尺は0で、書き出しは理由をつけて止まる（空のまま成功させない）', () => {
    const doc = createEmptyTimelineProject(input);
    expect(doc.clips).toEqual([]);
    expect(timelineDurationSec(doc)).toBe(0);
    expect(timelineExportBlockers(doc).length).toBeGreaterThan(0);
  });

  it('元になった場面形式は無い（sourceProjectId は付けない）', () => {
    expect(createEmptyTimelineProject(input).sourceProjectId).toBeUndefined();
  });

  it('向きは既定（横型）に固定＝完全新規で縦型を選べるように見せない（#664）', () => {
    expect(createEmptyTimelineProject(input).videoSettings.aspectRatio).toBe('16:9');
  });

  it('渡した id・名前・時刻をそのまま使う（この関数は時計を持たない）', () => {
    const doc = createEmptyTimelineProject(input);
    expect(doc.projectId).toBe(input.projectId);
    expect(doc.projectName).toBe(input.projectName);
    expect(doc.createdAt).toBe(input.now);
    expect(doc.updatedAt).toBe(input.now);
  });
});
