// タイムライン形式の読込と尺（ADR-0032・#629）。読めない文書は生のエラーを出さず「次の行動」で断る（§2-5）。
import { describe, expect, it } from 'vitest';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import type { TimelineProject } from './types';
import { TIMELINE_SCHEMA_VERSION } from './types';
import { frameTimeSec, isSupportedTimelineSchemaVersion, parseTimelineProjectDoc, TimelineLoadError, timelineDurationSec, withUpdatedAt } from './persistence';

function doc(over: Partial<TimelineProject> = {}): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20260728_001',
    projectName: 'テスト',
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [],
    tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }],
    clips: [],
    ...over,
  };
}

const clip = (id: string, startSec: number, durationSec: number) => ({
  id, kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec, durationSec,
});

const rejectMessage = (text: string): string => {
  try {
    parseTimelineProjectDoc(text);
  } catch (e) {
    expect(e).toBeInstanceOf(TimelineLoadError);
    return (e as Error).message;
  }
  throw new Error('拒否されなかった');
};

describe('parseTimelineProjectDoc', () => {
  it('正しい文書はそのまま読める', () => {
    expect(parseTimelineProjectDoc(JSON.stringify(doc())).projectId).toBe('proj_20260728_001');
  });

  it('壊れた JSON は「次の行動」を示して断る', () => {
    expect(rejectMessage('{壊れ')).toContain('一覧から別の動画を選んでください');
  });

  it('場面形式のファイルは「形式が違う」と断る（版の話にすり替えない）', () => {
    const msg = rejectMessage(JSON.stringify({ schemaVersion: '1.24', projectId: 'proj_20260701_001', scenes: [] }));
    expect(msg).toContain('タイムラインで編集する形式ではありません');
    expect(msg).not.toContain('アプリを更新');
  });

  it('知らない版は「アプリを更新してください」と断る（形式は合っている）', () => {
    const msg = rejectMessage(JSON.stringify({ ...doc(), schemaVersion: '9.9' }));
    expect(msg).toContain('アプリを更新してください');
  });

  it('スキーマに適合しない中身は断る（壊れた文書を編集画面へ流さない）', () => {
    const broken = { ...doc(), clips: [{ id: 'clip_001', kind: 'text', trackId: 'track_001', startSec: -1, durationSec: 1 }] };
    expect(rejectMessage(JSON.stringify(broken))).toContain('内容が正しくありません');
  });
});

describe('timelineDurationSec', () => {
  it('いちばん後ろまで伸びているクリップの終わり', () => {
    expect(timelineDurationSec(doc({ clips: [clip('clip_001', 0, 5), clip('clip_002', 2, 9)] }))).toBe(11);
  });

  it('置いていない時間（隙間）も尺に含む', () => {
    expect(timelineDurationSec(doc({ clips: [clip('clip_001', 10, 2)] }))).toBe(12);
  });

  it('何も置いていなければ 0', () => {
    expect(timelineDurationSec(doc())).toBe(0);
  });
});

describe('withUpdatedAt', () => {
  it('更新日時だけ差し替える（形式は保つ）', () => {
    const next = withUpdatedAt(doc(), '2026-08-01T00:00:00.000Z');
    expect(next.updatedAt).toBe('2026-08-01T00:00:00.000Z');
    expect(next.format).toBe(PROJECT_FORMAT.timeline);
    expect(next.createdAt).toBe('2026-07-28T00:00:00.000Z');
  });
});

describe('isSupportedTimelineSchemaVersion / frameTimeSec（/canon-check 指摘の修正）', () => {
  it('同じメジャーの後方互換な追加は開ける（1回のバンプで既存が開けなくならない）', () => {
    expect(isSupportedTimelineSchemaVersion('1.0')).toBe(true);
    expect(isSupportedTimelineSchemaVersion(TIMELINE_SCHEMA_VERSION)).toBe(true);
    expect(isSupportedTimelineSchemaVersion('1.9')).toBe(true);
  });

  it('未対応メジャーだけ断る', () => {
    expect(isSupportedTimelineSchemaVersion('2.0')).toBe(false);
  });

  it('古い版の文書は現行版へ引き上げて読める（1回のバンプで既存が開けなくならない）', () => {
    const loaded = parseTimelineProjectDoc(JSON.stringify({ ...doc(), schemaVersion: '1.0' }));
    expect(loaded.schemaVersion).toBe(TIMELINE_SCHEMA_VERSION);
    expect(loaded.projectName).toBe('テスト'); // 中身はそのまま
  });

  it('版の案内は「バージョン」と言う（「形式」は場面/タイムラインの別を指す語）', () => {
    const msg = rejectMessage(JSON.stringify({ ...doc(), schemaVersion: '2.0' }));
    expect(msg).toContain('対応していないバージョン');
    expect(msg).not.toContain('新しい形式');
  });

  it('見せる時刻は必ずフレームの格子に乗る（書き出しに存在しない時刻の絵を描かない）', () => {
    const d = doc({ clips: [clip('clip_001', 0, 5)] });
    const t = frameTimeSec(d, 1.234);
    expect(t * 30).toBeCloseTo(Math.round(t * 30)); // k/30 になっている
    expect(t).toBeLessThanOrEqual(1.234);
  });

  it('尺が格子に乗っていなくても、見せる時刻は格子に乗る', () => {
    const d = doc({ clips: [clip('clip_001', 0, 5.52)] });
    const t = frameTimeSec(d, 99);
    expect(t * 30).toBeCloseTo(Math.round(t * 30));
    expect(t).toBeLessThan(5.52);
  });

  it('末尾ちょうどは1フレーム手前へ寄せる（半開区間で絵が消えない）', () => {
    const d = doc({ clips: [clip('clip_001', 0, 5)] });
    expect(frameTimeSec(d, 5)).toBeCloseTo(5 - 1 / 30);
    expect(frameTimeSec(d, 2)).toBe(2); // 途中はそのまま
    expect(frameTimeSec(d, -1)).toBe(0);
    expect(frameTimeSec(d, Number.NaN)).toBe(0); // 壊れた入力で位置を失わない
  });

  it('何も置いていない動画では 0（負にしない）', () => {
    expect(frameTimeSec(doc(), 0)).toBe(0);
  });
});
