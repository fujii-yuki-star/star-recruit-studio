// 書き出しを始められない理由（#718）。**どの理由が先に出るか**まで固定する
//（順を入れ替えると、直せない理由〔この端末では書き出せない〕が先に出て、直せる理由が隠れる）。
import { describe, expect, it } from 'vitest';
import { exportStartBlock } from './timelineStore';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../../domain/enums';
import { TIMELINE_SCHEMA_VERSION } from '../../domain/timeline/types';
import type { TimelineProject } from '../../domain/timeline/types';

const doc = (over: Partial<TimelineProject> = {}): TimelineProject => ({
  schemaVersion: TIMELINE_SCHEMA_VERSION,
  format: PROJECT_FORMAT.timeline,
  projectId: 'proj_1',
  projectName: 'テスト',
  createdAt: '2026-08-06T00:00:00.000Z',
  updatedAt: '2026-08-06T00:00:00.000Z',
  videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
  voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
  assets: [],
  tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }],
  clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, text: 'あ' }],
  ...over,
});

const base = {
  doc: doc(),
  isImporting: false,
  generatingVoiceClipId: null,
  knownTemplateIds: new Set<string>(),
  otherExportRunning: false,
  canExportHere: true,
};

describe('exportStartBlock（書き出しを始められるか）', () => {
  it('どれも当てはまらなければ始められる', () => {
    expect(exportStartBlock(base)).toBeNull();
  });

  it('開いていないときは何も言わない（ボタン自体が無い）', () => {
    expect(exportStartBlock({ ...base, doc: null, isImporting: true })).toBeNull();
  });

  it('理由をそれぞれ返す', () => {
    expect(exportStartBlock({ ...base, isImporting: true })?.message).toContain('取り込み中');
    expect(exportStartBlock({ ...base, generatingVoiceClipId: 'clip_009' })?.message).toContain('声を作成中');
    expect(exportStartBlock({ ...base, otherExportRunning: true })?.message).toBeTruthy();
    expect(exportStartBlock({ ...base, canExportHere: false })).toMatchObject({ phase: 'unsupported' });
    // 文書の中身の理由（何も置いていない）。
    expect(exportStartBlock({ ...base, doc: doc({ clips: [] }) })?.phase).toBe('error');
  });

  it('**直せる理由を先に出す**（取り込み中 → 声の作成中 → ほかの書き出し）', () => {
    // 同時に当てはまるとき、先に片づけられるものから出す＝直しても次の理由が出て堂々巡り、を避ける。
    expect(exportStartBlock({ ...base, isImporting: true, generatingVoiceClipId: 'c' })?.message).toContain('取り込み中');
    expect(exportStartBlock({ ...base, generatingVoiceClipId: 'c', otherExportRunning: true })?.message).toContain('声を作成中');
  });

  it('**直せる理由は、直せない理由（この端末では書き出せない）より先**', () => {
    // 逆にすると「この環境では書き出せません」だけが出て、直せば書き出せることに気づけない。
    const r = exportStartBlock({ ...base, doc: doc({ clips: [] }), canExportHere: false });
    expect(r?.phase).toBe('error');
    expect(r?.message).not.toContain('この環境では');
  });
});
