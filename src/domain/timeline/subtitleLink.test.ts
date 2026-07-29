// 字幕と読み上げの連動（ADR-0032 決定24・#633）。
import { describe, expect, it } from 'vitest';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import { TIMELINE_SCHEMA_VERSION } from './types';
import type { TimelineClip, TimelineProject } from './types';
import { boundVoiceClip, danglingSubtitleLinks, subtitleTextOf, subtitlesBoundTo } from './subtitleLink';
import { duplicateClip, EDIT_BLOCKED, moveClip, setSubtitleText, setSubtitleVoiceLink, trimClip } from './edit';
import { validateTimelineDoc } from './validateTimelineDoc';
import { timelineExportBlockers } from './export';

const voice = (id: string, over: Partial<TimelineClip> = {}, text = 'こんにちは'): TimelineClip => ({
  id,
  kind: TIMELINE_CLIP_KIND.voice,
  trackId: 'track_002',
  startSec: 2,
  durationSec: 3,
  voice: { text, status: 'generated', voicePath: `voices/${id}.wav` },
  ...over,
});

const subtitle = (id: string, over: Partial<TimelineClip> = {}): TimelineClip => ({
  id,
  kind: TIMELINE_CLIP_KIND.subtitle,
  trackId: 'track_001',
  startSec: 0,
  durationSec: 1,
  x: 0,
  y: 900,
  w: 1920,
  h: 120,
  ...over,
});

function doc(over: Partial<TimelineProject> = {}): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20260729_001',
    projectName: 'テスト',
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
    assets: [],
    tracks: [
      { id: 'track_001', kind: TRACK_KIND.visual },
      { id: 'track_002', kind: TRACK_KIND.audio },
    ],
    clips: [],
    ...over,
  };
}

describe('連動の解決', () => {
  it('連動先の読み上げ文を字幕として出す', () => {
    const d = doc({ clips: [voice('clip_001'), subtitle('clip_002', { voiceClipId: 'clip_001' })] });
    expect(subtitleTextOf(d, d.clips[1])).toBe('こんにちは');
  });

  it('自分の文が入っていればそちらを出す（言い換えの上書き）', () => {
    const d = doc({ clips: [voice('clip_001'), subtitle('clip_002', { voiceClipId: 'clip_001', text: '言い換え' })] });
    expect(subtitleTextOf(d, d.clips[1])).toBe('言い換え');
  });

  it('連動していない字幕は自分の文を出す', () => {
    const d = doc({ clips: [subtitle('clip_002', { text: 'ふつうの字幕' })] });
    expect(subtitleTextOf(d, d.clips[0])).toBe('ふつうの字幕');
  });

  it('連動先が見つからないときは自分の文へ落ちる（黙って消さない）', () => {
    const d = doc({ clips: [subtitle('clip_002', { voiceClipId: 'clip_999', text: '残る文' })] });
    expect(subtitleTextOf(d, d.clips[0])).toBe('残る文');
    expect(boundVoiceClip(d, d.clips[0])).toBeUndefined();
    expect(danglingSubtitleLinks(d).map((c) => c.id)).toEqual(['clip_002']);
  });

  it('読み上げでない部品を指していても連動しない（見つからない扱い）', () => {
    const d = doc({
      clips: [
        { id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: 1, x: 0, y: 0, w: 10, h: 10, text: 'あ' },
        subtitle('clip_002', { voiceClipId: 'clip_001' }),
      ],
    });
    expect(boundVoiceClip(d, d.clips[1])).toBeUndefined();
  });

  it('連動先が見つからないことを検証が知らせる（V29）', () => {
    const d = doc({ clips: [subtitle('clip_002', { voiceClipId: 'clip_999' })] });
    expect(validateTimelineDoc(d).map((w) => w.code)).toContain('TIMELINE_SUBTITLE_LINK_NOT_FOUND');
  });

  it('字幕でない部品に連動先が付いていることも知らせる', () => {
    const d = doc({
      clips: [voice('clip_001'), { ...voice('clip_003'), voiceClipId: 'clip_001' }],
    });
    expect(validateTimelineDoc(d).map((w) => w.code)).toContain('TIMELINE_SUBTITLE_LINK_ON_NON_SUBTITLE');
  });

  it('その読み上げに連動している字幕を引ける', () => {
    const d = doc({
      clips: [voice('clip_001'), subtitle('clip_002', { voiceClipId: 'clip_001' }), subtitle('clip_003')],
    });
    expect(subtitlesBoundTo(d, 'clip_001').map((c) => c.id)).toEqual(['clip_002']);
  });
});

describe('時間の追従', () => {
  const linked = () =>
    doc({ clips: [voice('clip_001'), subtitle('clip_002', { voiceClipId: 'clip_001', startSec: 2, durationSec: 3 })] });

  it('読み上げを動かすと字幕も同じ区間になる', () => {
    const r = moveClip(linked(), 'clip_001', { startSec: 5 });
    expect(r.ok && r.doc.clips[1]).toMatchObject({ startSec: 5, durationSec: 3 });
  });

  it('読み上げの端を動かすと字幕も同じ区間になる（声を作り直して長さが変わったときも同じ）', () => {
    const r = trimClip(linked(), 'clip_001', 'end', 7);
    expect(r.ok && r.doc.clips[1]).toMatchObject({ startSec: 2, durationSec: 5 });
  });

  it('連動していない字幕は動かない', () => {
    const d = doc({ clips: [voice('clip_001'), subtitle('clip_002', { startSec: 2, durationSec: 3 })] });
    const r = moveClip(d, 'clip_001', { startSec: 5 });
    expect(r.ok && r.doc.clips[1].startSec).toBe(2);
  });

  it('字幕を置けない場所へは動かさない（片方だけ動いた結果を作らない）', () => {
    const d = doc({
      clips: [
        voice('clip_001'),
        subtitle('clip_002', { voiceClipId: 'clip_001', startSec: 2, durationSec: 3 }),
        subtitle('clip_003', { startSec: 6, durationSec: 3 }), // 動かした先で重なる
      ],
    });
    const r = moveClip(d, 'clip_001', { startSec: 7 });
    expect(r.ok).toBe(false);
    // 理由は**連動のせいで置けない**と分かるもの（触っていない列の話にしない）。
    if (!r.ok) expect(r.reason).toBe(EDIT_BLOCKED.linkedSubtitle);
  });

  it('連動している字幕の時間は自分では変えられない（読み上げが決める）', () => {
    const move = moveClip(linked(), 'clip_002', { startSec: 9 });
    expect(move.ok).toBe(false);
    if (!move.ok) expect(move.reason).toBe(EDIT_BLOCKED.linkedSubtitleTime);
    const trim = trimClip(linked(), 'clip_002', 'end', 9);
    expect(trim.ok).toBe(false);
    if (!trim.ok) expect(trim.reason).toBe(EDIT_BLOCKED.linkedSubtitleTime);
  });

  it('連動している字幕でも、置く列は変えられる（重なったときの逃げ道）', () => {
    const d = doc({
      clips: [voice('clip_001'), subtitle('clip_002', { voiceClipId: 'clip_001', startSec: 2, durationSec: 3 })],
      tracks: [
        { id: 'track_001', kind: TRACK_KIND.visual },
        { id: 'track_003', kind: TRACK_KIND.visual },
        { id: 'track_002', kind: TRACK_KIND.audio },
      ],
    });
    const r = moveClip(d, 'clip_002', { trackId: 'track_003' });
    expect(r.ok && r.doc.clips[1]).toMatchObject({ trackId: 'track_003', startSec: 2, durationSec: 3 });
  });

  it('複製した字幕は連動を引き継がない（複製した瞬間に必ず重なるため）', () => {
    const r = duplicateClip(linked(), 'clip_002');
    expect(r.ok && r.doc.clips[2].voiceClipId).toBeUndefined();
  });
});

describe('setSubtitleVoiceLink', () => {
  it('連動を始めると、その場で時間も合わせる', () => {
    const d = doc({ clips: [voice('clip_001'), subtitle('clip_002')] });
    const r = setSubtitleVoiceLink(d, 'clip_002', 'clip_001');
    expect(r.ok && r.doc.clips[1]).toMatchObject({ voiceClipId: 'clip_001', startSec: 2, durationSec: 3 });
  });

  it('連動をやめると、その場に残る（消さない）', () => {
    const d = doc({ clips: [voice('clip_001'), subtitle('clip_002', { voiceClipId: 'clip_001', startSec: 2, durationSec: 3 })] });
    const r = setSubtitleVoiceLink(d, 'clip_002', null);
    expect(r.ok && r.doc.clips[1].voiceClipId).toBeUndefined();
    expect(r.ok && r.doc.clips[1]).toMatchObject({ startSec: 2, durationSec: 3 });
  });

  it('付け替えられる', () => {
    const d = doc({
      clips: [voice('clip_001'), voice('clip_003', { startSec: 10, durationSec: 2 }), subtitle('clip_002', { voiceClipId: 'clip_001' })],
    });
    const r = setSubtitleVoiceLink(d, 'clip_002', 'clip_003');
    expect(r.ok && r.doc.clips[2]).toMatchObject({ voiceClipId: 'clip_003', startSec: 10, durationSec: 2 });
  });

  it('読み上げでないものへは連動できない', () => {
    const d = doc({ clips: [voice('clip_001'), subtitle('clip_002'), subtitle('clip_004')] });
    const r = setSubtitleVoiceLink(d, 'clip_002', 'clip_004');
    expect(r.ok).toBe(false);
  });

  it('連動先の場所に置けないときは断る（黙って別の場所に置かない）', () => {
    const d = doc({
      clips: [
        voice('clip_001'),
        subtitle('clip_002'),
        subtitle('clip_003', { startSec: 2, durationSec: 3 }), // 連動先の区間を先に使っている
      ],
    });
    const r = setSubtitleVoiceLink(d, 'clip_002', 'clip_001');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(EDIT_BLOCKED.overlap);
  });

  it('固定した列の字幕は連動を変えられない', () => {
    const d = doc({
      clips: [voice('clip_001'), subtitle('clip_002')],
      tracks: [{ id: 'track_001', kind: TRACK_KIND.visual, locked: true }, { id: 'track_002', kind: TRACK_KIND.audio }],
    });
    const r = setSubtitleVoiceLink(d, 'clip_002', 'clip_001');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(EDIT_BLOCKED.locked);
  });
});

describe('setSubtitleText', () => {
  it('自分の文を入れると、そちらが出る（言い換え）', () => {
    const d = doc({ clips: [voice('clip_001'), subtitle('clip_002', { voiceClipId: 'clip_001' })] });
    const r = setSubtitleText(d, 'clip_002', '言い換え');
    expect(r.ok && subtitleTextOf(r.doc, r.doc.clips[1])).toBe('言い換え');
  });

  it('空にすると連動先の読み上げ文に戻る（キーごと落とす）', () => {
    const d = doc({ clips: [voice('clip_001'), subtitle('clip_002', { voiceClipId: 'clip_001', text: '言い換え' })] });
    const r = setSubtitleText(d, 'clip_002', '');
    expect(r.ok && r.doc.clips[1].text).toBeUndefined();
    expect(r.ok && subtitleTextOf(r.doc, r.doc.clips[1])).toBe('こんにちは');
  });

  it('同じ文なら文書は変わらない', () => {
    const d = doc({ clips: [subtitle('clip_002', { text: 'あ' })] });
    const r = setSubtitleText(d, 'clip_002', 'あ');
    expect(r.ok && r.doc).toBe(d);
  });
});

describe('書き出しの手前で断る', () => {
  it('連動先が見つからず、自分の文も無い字幕は書き出さない（何も出ないため）', () => {
    const d = doc({ clips: [subtitle('clip_002', { voiceClipId: 'clip_999' })] });
    expect(timelineExportBlockers(d).map((b) => b.code)).toContain('TIMELINE_EXPORT_SUBTITLE_LINK_BROKEN');
  });

  it('自分の文があれば止めない（その文で描かれる）', () => {
    const d = doc({ clips: [subtitle('clip_002', { voiceClipId: 'clip_999', text: '残る文' })] });
    expect(timelineExportBlockers(d).map((b) => b.code)).not.toContain('TIMELINE_EXPORT_SUBTITLE_LINK_BROKEN');
  });
});
