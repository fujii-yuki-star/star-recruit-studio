// @vitest-environment jsdom
// 声を文字にする（ADR-0058・#1387）＝文字にする→候補→字幕にする／選んだ行を消して詰める→取り消し1回で戻る、を store と画面の部品で通す。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useTimelineStore } from './timelineStore';
import * as fsMod from '../../infrastructure/projectFs';
import * as assetFsMod from '../../infrastructure/assetFs';
import * as trMod from '../../infrastructure/transcribeFs';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../../domain/enums';
import { TIMELINE_SCHEMA_VERSION } from '../../domain/timeline/types';
import { TranscriptPanel } from '../components/TranscriptPanel';
import { transcribeMessage, TRANSCRIPT_CUT_LABEL, TRANSCRIPT_PLACE_LABEL } from '../uiLabels';

vi.mock('./restorePointKeeper', () => ({ keepRestorePoints: vi.fn(async () => {}), restoreToPoint: vi.fn(async () => 0), loadRestorePoints: vi.fn(async () => []) }));

const doc = {
  schemaVersion: TIMELINE_SCHEMA_VERSION, format: PROJECT_FORMAT.timeline, projectId: 'proj_20261008_201', projectName: '録音',
  createdAt: '2026-10-08T00:00:00.000Z', updatedAt: '2026-10-08T00:00:00.000Z',
  videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
  voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
  assets: [
    { assetId: 'asset_001', assetType: 'bgm', displayName: '録音.wav', filePath: 'assets/rec.wav' },
    { assetId: 'asset_002', assetType: 'image', displayName: '写真', filePath: 'assets/p.png', metadata: { width: 10, height: 10 } },
  ],
  tracks: [{ id: 'track_001', kind: TRACK_KIND.audio }, { id: 'track_002', kind: TRACK_KIND.visual }],
  clips: [
    // 素材の 1 秒目から使い、タイムラインの 2 秒目に置いた 10 秒の録音。
    { id: 'clip_001', kind: TIMELINE_CLIP_KIND.audio, trackId: 'track_001', startSec: 2, durationSec: 10, sourceStartSec: 1, assetId: 'asset_001' },
    { id: 'clip_002', kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_002', startSec: 0, durationSec: 12, x: 0, y: 0, w: 100, h: 100, assetId: 'asset_002' },
  ],
};
const segments = [
  { startSec: 0, endSec: 3, text: 'こんにちは。' },
  { startSec: 3, endSec: 6, text: 'えっと、' },
  { startSec: 6, endSec: 9, text: '藤井です。' },
];
const st = () => useTimelineStore.getState();

beforeEach(async () => {
  vi.spyOn(assetFsMod, 'assetDisplayUrl').mockResolvedValue(null);
  vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(doc));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(trMod, 'listenTranscribeProgress').mockResolvedValue(() => {});
  vi.spyOn(trMod, 'transcribeCancel').mockResolvedValue();
  // 前の検査で終わらないまま残した回の印を外す（閉じても消さない作り＝検査どうしで持ち越す）。
  useTimelineStore.setState({ transcribeBusy: false });
  await st().openTimelineProject('proj_20261008_201');
});
afterEach(() => {
  vi.restoreAllMocks();
  st().closeTimelineProject();
});

describe('transcribeClip', () => {
  it('部品が使っている素材の範囲を渡し、結果をタイムラインの秒の行にする', async () => {
    const call = vi.spyOn(trMod, 'transcribeAudio').mockResolvedValue(segments);
    await st().transcribeClip('clip_001');
    expect(call).toHaveBeenCalledWith('proj_20261008_201', 'assets/rec.wav', 1, 10, expect.any(Number));
    expect(st().transcript?.lines).toEqual([
      { startSec: 2, endSec: 5, text: 'こんにちは。' },
      { startSec: 5, endSec: 8, text: 'えっと、' },
      { startSec: 8, endSec: 11, text: '藤井です。' },
    ]);
  });

  it('音の無い部品は始めずに理由を出す', async () => {
    const call = vi.spyOn(trMod, 'transcribeAudio');
    await st().transcribeClip('clip_002');
    expect(call).not.toHaveBeenCalled();
    expect(st().editNotice).toBe(transcribeMessage.TRANSCRIBE_NO_SOUND);
  });

  it('進み具合は、その回の分だけ反映する', async () => {
    let emit: (e: trMod.TranscribeProgressEvent) => void = () => {};
    vi.spyOn(trMod, 'listenTranscribeProgress').mockImplementation(async (cb) => { emit = cb; return () => {}; });
    let finish: (v: trMod.TranscribedSegment[]) => void = () => {};
    vi.spyOn(trMod, 'transcribeAudio').mockImplementation(() => new Promise((r) => { finish = r; }));
    const p = st().transcribeClip('clip_001');
    await Promise.resolve(); await Promise.resolve();
    const runId = st().transcript!.runId;
    emit({ runId, percent: 40 });
    expect(st().transcriptPercent).toBe(40);
    emit({ runId: runId + 99, percent: 90 }); // 別の回
    expect(st().transcriptPercent).toBe(40);
    finish(segments);
    await p;
  });

  it('文字にしている間に部品が動いたら、結果は使わない', async () => {
    let finish: (v: trMod.TranscribedSegment[]) => void = () => {};
    vi.spyOn(trMod, 'transcribeAudio').mockImplementation(() => new Promise((r) => { finish = r; }));
    const p = st().transcribeClip('clip_001');
    await Promise.resolve(); await Promise.resolve();
    st().moveClipById('clip_001', { startSec: 3 });
    finish(segments);
    await p;
    expect(st().transcript).toBeNull();
    expect(st().editNotice).toBe(transcribeMessage.TRANSCRIBE_CLIP_CHANGED);
  });

  it('途中で閉じると止め、遅れて届いた結果も断りも出さない', async () => {
    let fail: (e: unknown) => void = () => {};
    vi.spyOn(trMod, 'transcribeAudio').mockImplementation(() => new Promise((_r, j) => { fail = j; }));
    const p = st().transcribeClip('clip_001');
    await Promise.resolve(); await Promise.resolve();
    const runId = st().transcript!.runId;
    st().closeTranscript();
    expect(trMod.transcribeCancel).toHaveBeenCalledWith(runId);
    fail(new Error('声を文字にするのを止めました。文字にするときは、もう一度「声を文字にする」を押してください。'));
    await p;
    expect(st().transcript).toBeNull();
    expect(st().editNotice).toBeNull();
  });

  it('止めた後も、前の回が本当に終わるまでは次を始めない（すぐ押し直すと断られるので）', async () => {
    let fail: (e: unknown) => void = () => {};
    const call = vi.spyOn(trMod, 'transcribeAudio').mockImplementation(() => new Promise((_r, j) => { fail = j; }));
    const p = st().transcribeClip('clip_001');
    await Promise.resolve(); await Promise.resolve();
    st().closeTranscript();
    expect(st().transcribeBusy).toBe(true);
    await st().transcribeClip('clip_001');
    expect(call).toHaveBeenCalledTimes(1);
    fail(new Error('止めました'));
    await p;
    expect(st().transcribeBusy).toBe(false);
  });

  it('動画を閉じても、走っている回を止める', async () => {
    vi.spyOn(trMod, 'transcribeAudio').mockImplementation(() => new Promise(() => {}));
    void st().transcribeClip('clip_001');
    await Promise.resolve(); await Promise.resolve();
    const runId = st().transcript!.runId;
    st().closeTimelineProject();
    expect(trMod.transcribeCancel).toHaveBeenCalledWith(runId);
  });

  it('画面に出せる断りはそのまま・出せないものは決まり文句・話し声が無ければそう言う', async () => {
    vi.spyOn(trMod, 'transcribeAudio').mockRejectedValueOnce(new Error('声を文字にする部品が見つかりませんでした。アプリを入れ直してください。'));
    await st().transcribeClip('clip_001');
    expect(st().editNotice).toBe('声を文字にする部品が見つかりませんでした。アプリを入れ直してください。');
    vi.spyOn(trMod, 'transcribeAudio').mockRejectedValueOnce(new Error('spawn failed: os error 2'));
    await st().transcribeClip('clip_001');
    expect(st().editNotice).toBe(transcribeMessage.TRANSCRIBE_STOPPED);
    vi.spyOn(trMod, 'transcribeAudio').mockResolvedValueOnce([{ startSec: 0, endSec: 1, text: '  ' }]);
    await st().transcribeClip('clip_001');
    expect(st().transcript).toBeNull();
    expect(st().editNotice).toBe(transcribeMessage.TRANSCRIBE_NOTHING_HEARD);
  });
});

describe('placeTranscriptSubtitles / cutTranscriptLines', () => {
  beforeEach(async () => {
    vi.spyOn(trMod, 'transcribeAudio').mockResolvedValue(segments);
    await st().transcribeClip('clip_001');
  });

  it('選んだ行を（直した文で）字幕として並べ、取り消し1回で戻る', () => {
    const lines = st().transcript!.lines!;
    const before = st().doc!.clips.length;
    st().placeTranscriptSubtitles([lines[0], { ...lines[2], text: '藤井です！' }]);
    const subs = st().doc!.clips.filter((c) => c.kind === TIMELINE_CLIP_KIND.subtitle);
    expect(subs.map((c) => [c.startSec, c.text])).toEqual([[2, 'こんにちは。'], [8, '藤井です！']]);
    expect(st().transcript).toBeNull();
    expect(st().editNotice).toContain('2行の字幕');
    st().undo();
    expect(st().doc!.clips).toHaveLength(before);
  });

  it('選んだ行の範囲を消して詰め、取り消し1回で戻る', () => {
    const lines = st().transcript!.lines!;
    st().cutTranscriptLines([lines[1]]); // 5〜8 秒の「えっと、」
    const end = Math.max(...st().doc!.clips.map((c) => c.startSec + c.durationSec));
    expect(end).toBeCloseTo(12 - 3);
    expect(st().transcript).toBeNull(); // 欄を閉じる（消した後の古い時刻の行を残さない）
    expect(st().editNotice).toContain('1か所');
    st().undo();
    expect(Math.max(...st().doc!.clips.map((c) => c.startSec + c.durationSec))).toBeCloseTo(12);
  });

  it('読み上げが鳴っている所は消さずに残し、そう知らせる', async () => {
    st().closeTranscript();
    const withVoice = { ...doc, tracks: [...doc.tracks, { id: 'track_003', kind: TRACK_KIND.audio }],
      clips: [...doc.clips, { id: 'clip_003', kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_003', startSec: 6, durationSec: 2, voice: { text: 'はい', status: 'none' } }] };
    vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(withVoice));
    await st().openTimelineProject('proj_20261008_201');
    await st().transcribeClip('clip_001');
    st().cutTranscriptLines([st().transcript!.lines![1]]); // 5〜8 秒＝6〜8 秒は読み上げ
    expect(st().doc!.clips.some((c) => c.id === 'clip_003')).toBe(true);
    expect(st().editNotice).toContain('読み上げが鳴っている所は消さずに残しました');
  });

  it('結果を出した後に文書が変わっていたら、並べも消しもしない', () => {
    const lines = st().transcript!.lines!;
    st().moveClipById('clip_002', { startSec: 1 });
    const before = st().doc;
    st().placeTranscriptSubtitles(lines);
    expect(st().doc).toBe(before);
    expect(st().editNotice).toBe(transcribeMessage.TRANSCRIBE_CLIP_CHANGED);
  });
});

describe('TranscriptPanel', () => {
  const lines = [
    { startSec: 2, endSec: 5, text: 'こんにちは。' },
    { startSec: 5, endSec: 8, text: 'えっと、' },
  ];
  it('文字にしている間は進み具合と「やめる」', () => {
    const onClose = vi.fn();
    render(<TranscriptPanel lines={null} percent={42} fps={30} onSeek={vi.fn()} onPreview={vi.fn()} onPlace={vi.fn()} onCut={vi.fn()} onClose={onClose} />);
    expect(screen.getByText(/42%/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('直した文と選んだ行だけを渡す・消すときはもう一度確かめる', () => {
    const onPlace = vi.fn();
    const onCut = vi.fn();
    render(<TranscriptPanel lines={lines} percent={100} fps={30} onSeek={vi.fn()} onPreview={vi.fn()} onPlace={onPlace} onCut={onCut} onClose={vi.fn()} />);
    const texts = screen.getAllByRole('textbox');
    fireEvent.change(texts[0], { target: { value: 'こんにちは！' } });
    fireEvent.click(screen.getAllByRole('checkbox')[1]); // 2行目を外す
    fireEvent.click(screen.getByRole('button', { name: `${TRANSCRIPT_PLACE_LABEL}（1行）` }));
    expect(onPlace).toHaveBeenCalledWith([{ startSec: 2, endSec: 5, text: 'こんにちは！' }]);
    fireEvent.click(screen.getByRole('button', { name: `${TRANSCRIPT_CUT_LABEL}（1行）` }));
    expect(onCut).not.toHaveBeenCalled();
    expect(screen.getByText(/選んだ1行（合計 3.0 秒）を消して詰めます/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: `${TRANSCRIPT_CUT_LABEL}（1行）` }));
    expect(onCut).toHaveBeenCalledWith([{ startSec: 2, endSec: 5, text: 'こんにちは！' }]);
  });

  it('直した後に閉じるときは確かめる・文の欄の Escape は欄から手を離すだけ', () => {
    const onClose = vi.fn();
    render(<TranscriptPanel lines={lines} percent={100} fps={30} onSeek={vi.fn()} onPreview={vi.fn()} onPlace={vi.fn()} onCut={vi.fn()} onClose={onClose} />);
    const box = screen.getAllByRole('textbox')[0];
    box.focus();
    fireEvent.change(box, { target: { value: '直した' } });
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(box);
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/直した文は消えます/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('固定した列があれば消すほうを押す前に断る・全部選んだまま消すときは、すべて消すと言う・聞くでその行を鳴らす', () => {
    const onPreview = vi.fn();
    const { unmount } = render(<TranscriptPanel lines={lines} percent={100} fps={30} onSeek={vi.fn()} onPreview={onPreview} onPlace={vi.fn()} onCut={vi.fn()} onClose={vi.fn()} cutDisabledReason="固定" />);
    const cut = screen.getByRole('button', { name: `${TRANSCRIPT_CUT_LABEL}（2行）` });
    expect(cut).toHaveProperty('disabled', true);
    expect(cut.getAttribute('title')).toBe('固定');
    fireEvent.click(screen.getAllByRole('button', { name: '聞く' })[1]);
    expect(onPreview).toHaveBeenCalledWith(lines[1]);
    unmount();
    render(<TranscriptPanel lines={lines} percent={100} fps={30} onSeek={vi.fn()} onPreview={vi.fn()} onPlace={vi.fn()} onCut={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: `${TRANSCRIPT_CUT_LABEL}（2行）` }));
    expect(screen.getByText(/すべての行を選んでいます/)).toBeTruthy();
  });

  it('文が空の行は字幕の数に入れない', () => {
    render(<TranscriptPanel lines={lines} percent={100} fps={30} onSeek={vi.fn()} onPreview={vi.fn()} onPlace={vi.fn()} onCut={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getAllByRole('textbox')[1], { target: { value: '' } });
    expect(screen.getByRole('button', { name: `${TRANSCRIPT_PLACE_LABEL}（1行）` })).toBeTruthy();
  });

  it('何も選んでいなければ、どちらも押せない・時刻を押すとその場所へ', () => {
    const onSeek = vi.fn();
    render(<TranscriptPanel lines={lines} percent={100} fps={30} onSeek={onSeek} onPreview={vi.fn()} onPlace={vi.fn()} onCut={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'すべて外す' }));
    expect(screen.getByRole('button', { name: `${TRANSCRIPT_PLACE_LABEL}（0行）` })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: `${TRANSCRIPT_CUT_LABEL}（0行）` })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getAllByTitle('この時刻へ移動します')[1]);
    expect(onSeek).toHaveBeenCalledWith(5);
  });
});
