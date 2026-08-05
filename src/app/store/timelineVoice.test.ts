// タイムライン側で声を作る（ADR-0032 決定7・#633）。作った声の置き方と、長さの合わせ方を固定する。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimelineStore } from './timelineStore';
import * as fsMod from '../../infrastructure/projectFs';
import * as assetFsMod from '../../infrastructure/assetFs';
import * as voiceFsMod from '../../infrastructure/voiceFs';
import { MockVoiceProvider } from '../../infrastructure/voiceProviders/mockVoiceProvider';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../../domain/enums';
import { TIMELINE_SCHEMA_VERSION } from '../../domain/timeline/types';
import type { TimelineProject } from '../../domain/timeline/types';

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
    clips: [
      { id: 'clip_001', kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_002', startSec: 2, durationSec: 3, voice: { text: 'ひとこと', status: 'none' } },
    ],
    ...over,
  };
}

async function open(d: TimelineProject): Promise<void> {
  vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(d));
  await useTimelineStore.getState().openTimelineProject(d.projectId);
  useTimelineStore.setState({ selectedClipIds: ['clip_001'] });
}

beforeEach(() => {
  vi.restoreAllMocks();
  // 走行中は閉じられない（本番の締め）ので、テスト間は先に走行状態を落としてから閉じる。
  useTimelineStore.setState({
    exportRun: { phase: 'idle', percent: 0, message: null, cancelling: false },
    generatingVoiceClipId: null,
    voiceError: null,
  });
  useTimelineStore.getState().closeTimelineProject();
  vi.spyOn(assetFsMod, 'assetDisplayUrl').mockResolvedValue('asset://a.png');
  vi.spyOn(fsMod, 'saveProjectDoc').mockResolvedValue(undefined as never);
  vi.spyOn(voiceFsMod, 'importVoiceFile').mockResolvedValue('voices/clip_001.wav');
  // 声の合成は Mock（アプリ外と同じ経路）。尺は 5 秒を返す。
  vi.spyOn(MockVoiceProvider.prototype, 'synthesize').mockResolvedValue({
    audioDataUrl: 'data:audio/wav;base64,AAA',
    durationSec: 5,
  });
});

describe('generateSelectedVoice', () => {
  it('声を作ると、作成済みになって鳴らせるようになる', async () => {
    await open(doc());
    await useTimelineStore.getState().generateSelectedVoice();
    const clip = useTimelineStore.getState().doc?.clips[0];
    expect(clip?.voice).toMatchObject({ status: 'generated', voicePath: 'voices/clip_001.wav' });
    expect(useTimelineStore.getState().audioSrcByKey['voice:voices/clip_001.wav']).toBe('data:audio/wav;base64,AAA');
  });

  it('長さを声の実尺に合わせる（仮の長さのままにしない）', async () => {
    await open(doc());
    await useTimelineStore.getState().generateSelectedVoice();
    expect(useTimelineStore.getState().doc?.clips[0]).toMatchObject({ startSec: 2, durationSec: 5 });
  });

  it('連動している字幕も同じ区間になる（声を作る→字幕が連動して出る）', async () => {
    await open(
      doc({
        clips: [
          ...doc().clips,
          { id: 'clip_002', kind: TIMELINE_CLIP_KIND.subtitle, trackId: 'track_001', startSec: 2, durationSec: 3, x: 0, y: 900, w: 1920, h: 120, voiceClipId: 'clip_001' },
        ],
      }),
    );
    await useTimelineStore.getState().generateSelectedVoice();
    const sub = useTimelineStore.getState().doc?.clips.find((c) => c.id === 'clip_002');
    expect(sub).toMatchObject({ startSec: 2, durationSec: 5 });
  });

  it('長さを合わせられないときも、作った声は捨てない（理由だけ出す）', async () => {
    await open(
      doc({
        clips: [
          ...doc().clips,
          // 伸ばした先に別の部品がある＝同じ列に置けない
          { id: 'clip_003', kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_002', startSec: 6, durationSec: 2, voice: { text: 'ほか', status: 'none' } },
        ],
      }),
    );
    await useTimelineStore.getState().generateSelectedVoice();
    const clip = useTimelineStore.getState().doc?.clips.find((c) => c.id === 'clip_001');
    expect(clip?.voice?.status).toBe('generated'); // 声は残る
    expect(clip?.durationSec).toBe(3); // 長さは変わらない
    expect(useTimelineStore.getState().editBlocked).toBe('TIMELINE_EDIT_OVERLAP');
  });

  it('作っている間に文を書き換えたら、その声は使わない（古い声を新しい文に貼らない）', async () => {
    await open(doc());
    vi.spyOn(MockVoiceProvider.prototype, 'synthesize').mockImplementation(async () => {
      useTimelineStore.getState().setSelectedVoiceText('書き換えた文');
      return { audioDataUrl: 'data:audio/wav;base64,BBB', durationSec: 5 };
    });
    await useTimelineStore.getState().generateSelectedVoice();
    const clip = useTimelineStore.getState().doc?.clips[0];
    expect(clip?.voice).toMatchObject({ text: '書き換えた文', status: 'none' });
  });

  it('声ができたときの記録は、打っている文字のまとめに混ざらない（一緒に消えない）', async () => {
    await open(doc());
    // 文を打ち始めた状態（まとめを開いたが、まだ何も打っていない）。
    useTimelineStore.getState().beginHistoryGroup();
    const before = useTimelineStore.getState().history.past.length;
    await useTimelineStore.getState().generateSelectedVoice();
    // 声の完了は**自分で1つ積む**（まとめの「最初の1回」を食べない）。
    expect(useTimelineStore.getState().history.past.length).toBe(before + 1);
    // まとめはまだ「未記録」のまま＝このあと打った文字はちゃんと1つ積まれる。
    useTimelineStore.getState().setSelectedVoiceText('あ');
    expect(useTimelineStore.getState().history.past.length).toBe(before + 2);
    useTimelineStore.getState().endHistoryGroup();
  });

  it('作れなかったら「次にどうするか」を出す（生のエラーを見せない）', async () => {
    vi.spyOn(MockVoiceProvider.prototype, 'synthesize').mockRejectedValue(new Error('voicevox: connection refused'));
    await open(doc());
    await useTimelineStore.getState().generateSelectedVoice();
    expect(useTimelineStore.getState().doc?.clips[0].voice?.status).toBe('failed');
    expect(useTimelineStore.getState().voiceError).toBe('声を作れませんでした。しばらくしてから、もう一度お試しください。');
    // 失敗の印は文書に載る＝**未保存**にする（#693）。保存済みのままだと自動保存が次の編集まで走らず、
    // 画面は「保存しました」と言ったままになる。
    expect(useTimelineStore.getState().saveStatus).toBe('idle');
  });

  it('文が空のときは作りに行かない', async () => {
    await open(doc({ clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_002', startSec: 0, durationSec: 3, voice: { text: '  ', status: 'none' } }] }));
    await useTimelineStore.getState().generateSelectedVoice();
    expect(vi.mocked(MockVoiceProvider.prototype.synthesize)).not.toHaveBeenCalled();
  });

  it('作成中は二重に作らない（連打しても1回）', async () => {
    await open(doc());
    const first = useTimelineStore.getState().generateSelectedVoice();
    await useTimelineStore.getState().generateSelectedVoice();
    await first;
    expect(vi.mocked(MockVoiceProvider.prototype.synthesize)).toHaveBeenCalledTimes(1);
  });

  it('作っている間に声（話者）を変えたら、その結果は使わない（鳴る声と表示が食い違わない）', async () => {
    await open(doc());
    vi.spyOn(MockVoiceProvider.prototype, 'synthesize').mockImplementation(async () => {
      useTimelineStore.getState().setSelectedVoiceSpeaker(2);
      return { audioDataUrl: 'data:audio/wav;base64,BBB', durationSec: 5 };
    });
    await useTimelineStore.getState().generateSelectedVoice();
    const clip = useTimelineStore.getState().doc?.clips[0];
    expect(clip?.voice).toMatchObject({ speaker: 2, status: 'none', voicePath: null });
  });

  it('書き出し中は声を作らない（作っても文書へ入れられず捨てることになる）', async () => {
    await open(doc());
    useTimelineStore.setState({ exportRun: { phase: 'rendering', percent: 10, message: null, cancelling: false } });
    await useTimelineStore.getState().generateSelectedVoice();
    expect(vi.mocked(MockVoiceProvider.prototype.synthesize)).not.toHaveBeenCalled();
    expect(useTimelineStore.getState().voiceError).toContain('終わってから声を作ってください');
  });

  it('「作成中」を文書に残さない（取り消し・自動保存で固まらない）', async () => {
    await open(doc());
    await useTimelineStore.getState().generateSelectedVoice();
    expect(useTimelineStore.getState().generatingVoiceClipId).toBeNull();
    useTimelineStore.getState().undo();
    expect(useTimelineStore.getState().doc?.clips[0].voice?.status).not.toBe('pending');
  });

  it('別の動画を開いたあとに失敗が届いても、その動画の部品を壊さない', async () => {
    let fail = (): void => undefined;
    vi.spyOn(MockVoiceProvider.prototype, 'synthesize').mockImplementation(
      () => new Promise((_res, rej) => { fail = () => rej(new Error('x')); }),
    );
    await open(doc());
    const running = useTimelineStore.getState().generateSelectedVoice();
    // 別の動画へ切り替える（同じ id の部品を持つ）。
    useTimelineStore.setState({ generatingVoiceClipId: null });
    await open(doc({ projectId: 'proj_20260729_002' }));
    fail();
    await running;
    expect(useTimelineStore.getState().doc?.clips[0].voice?.status).toBe('none');
    expect(useTimelineStore.getState().voiceError).toBeNull();
  });

  it('尺を測れなかったときは黙って仮の長さにしない（次の行動を出す）', async () => {
    vi.spyOn(MockVoiceProvider.prototype, 'synthesize').mockResolvedValue({ audioDataUrl: 'data:audio/wav;base64,AAA', durationSec: 0 });
    await open(doc());
    await useTimelineStore.getState().generateSelectedVoice();
    expect(useTimelineStore.getState().voiceError).toContain('長さは手で合わせてください');
  });

  it('目録に無い話者は既定の声で作る（場面形式と同じ扱い）', async () => {
    await open(doc({ clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_002', startSec: 0, durationSec: 3, voice: { text: 'あ', status: 'none', speaker: 9999 } }] }));
    await useTimelineStore.getState().generateSelectedVoice();
    expect(vi.mocked(MockVoiceProvider.prototype.synthesize).mock.calls[0][0].speaker).toBeNull();
  });

  it('クリップの話者を合成に渡す（動画全体の声より優先＝行ごとの話者と同じ扱い）', async () => {
    await open(doc({ clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_002', startSec: 0, durationSec: 3, voice: { text: 'あ', status: 'none', speaker: 2 } }] }));
    await useTimelineStore.getState().generateSelectedVoice();
    expect(vi.mocked(MockVoiceProvider.prototype.synthesize).mock.calls[0][0]).toMatchObject({ text: 'あ', speaker: 2 });
  });
});
