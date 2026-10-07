// タイムライン形式にも「見つからない文字の形」の門を置く（α-6 差分再監査）。
//
// ⚠️ **形式で挙動を割らない**（ADR-0026②）＝場面形式には公開前チェックの `missingFont` があるのに
// こちらに無いと、同じ設定・同じ字体で**片方だけ黙って既定の字体の動画**が出る（ADR-0038・§2-5）。
// 🔴1 を直してタイムラインの文字クリップでも持ち込みフォントを選べるようになったので、門も要る。
import { describe, expect, it } from 'vitest';
import { timelineExportBlockers, TIMELINE_EXPORT_BLOCK } from './export';
import { usedTimelineUserFontIds } from '../font/usedFonts';
import type { TimelineProject } from './types';

const doc = (over: Partial<TimelineProject> = {}): TimelineProject =>
  ({
    schemaVersion: '1.10', format: 'timeline', projectId: 'proj_20260829_0001',
    projectName: 'テスト', createdAt: '', updatedAt: '',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 180 },
    voiceSettings: {}, assets: [],
    tracks: [{ id: 'track_001', kind: 'video', name: '映像1' }],
    clips: [{ id: 'clip_001', kind: 'text', trackId: 'track_001', startSec: 0, durationSec: 3, text: 'あ', fontId: 'user_font_001' }],
    ...over,
  }) as unknown as TimelineProject;

describe('usedTimelineUserFontIds', () => {
  it('動画全体・部品・種別ごとを集めて重複を除く', () => {
    const d = doc({
      videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 180, fontId: 'user_font_002' } as never,
      clips: [
        { id: 'c1', kind: 'text', trackId: 't', startSec: 0, durationSec: 1, fontId: 'user_font_001' },
        { id: 'c2', kind: 'template', trackId: 't', startSec: 1, durationSec: 1, textFontIds: { title: 'user_font_001', body: 'user_font_003' } },
        { id: 'c3', kind: 'text', trackId: 't', startSec: 2, durationSec: 1, fontId: 'gen-interface-jp' }, // 同梱は数えない
      ] as never,
    });
    expect(usedTimelineUserFontIds(d).sort()).toEqual(['user_font_001', 'user_font_002', 'user_font_003']);
  });
});

describe('タイムライン書き出しの門（持ち込みフォント）', () => {
  it('手元に無ければ書き出しを止める', () => {
    const codes = timelineExportBlockers(doc(), { availableUserFontIds: new Set() }).map((b) => b.code);
    expect(codes).toContain(TIMELINE_EXPORT_BLOCK.userFontMissing);
  });

  it('手元にあれば止めない', () => {
    const codes = timelineExportBlockers(doc(), { availableUserFontIds: new Set(['user_font_001']) }).map((b) => b.code);
    expect(codes).not.toContain(TIMELINE_EXPORT_BLOCK.userFontMissing);
  });

  /** ⚠️ **調べていないときは見ない**＝判定材料が無いのに「見つからない」と断らない（#347 と同じ流儀）。 */
  it('調べていないうちは止めない', () => {
    const codes = timelineExportBlockers(doc(), {}).map((b) => b.code);
    expect(codes).not.toContain(TIMELINE_EXPORT_BLOCK.userFontMissing);
  });
});
