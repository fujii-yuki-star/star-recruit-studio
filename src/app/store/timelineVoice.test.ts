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

  it('**着地したら自分から保存する**（画面を離れていても消えない・#751）', async () => {
    // ⚠️ 自動保存は**画面**が持っているので、作っている最中に画面を離れると着地したぶんを
    // **誰も書かない**＝開き直すと作った声と合わせた長さが黙って消える（音声ファイルだけ残る）。
    // 取り込み（`runImport`）は同じ穴を同じ形で塞いでいるのに、声の経路だけ欠けていた。
    await open(doc());
    const save = vi.spyOn(fsMod, 'saveProjectDoc').mockResolvedValue('x/project.json');
    await useTimelineStore.getState().generateSelectedVoice();
    await vi.waitFor(() => expect(save).toHaveBeenCalled());
    // 書いた中身が「作成済み＋実尺」であること（呼んだだけで中身が古い、を通さない）。
    const written = JSON.parse(save.mock.calls[save.mock.calls.length - 1][1] as string) as TimelineProject;
    expect(written.clips[0]).toMatchObject({ durationSec: 5 });
    expect(written.clips[0].voice).toMatchObject({ status: 'generated', voicePath: 'voices/clip_001.wav' });
  });

  it('作れなかった印も自分から保存する（開き直して「作成済み」に見せない）', async () => {
    await open(doc());
    vi.spyOn(voiceFsMod, 'importVoiceFile').mockResolvedValue(null); // 保存に失敗
    const save = vi.spyOn(fsMod, 'saveProjectDoc').mockResolvedValue('x/project.json');
    await useTimelineStore.getState().generateSelectedVoice();
    await vi.waitFor(() => expect(save).toHaveBeenCalled());
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
    const save = vi.spyOn(fsMod, 'saveProjectDoc').mockResolvedValue('x/project.json');
    await useTimelineStore.getState().generateSelectedVoice();
    expect(useTimelineStore.getState().doc?.clips[0].voice?.status).toBe('failed');
    expect(useTimelineStore.getState().voiceError).toBe('声を作れませんでした。しばらくしてから、もう一度お試しください。');
    // 失敗の印は文書に載る（#693）。⚠️ 以前は「**未保存にする**」までを固定していたが、
    // 自動保存は**画面**が持っているので、離れていると誰も書かない（#751）。いまは**すぐ書く**＝
    // 開き直したときに「作成済み」に見えない。
    await vi.waitFor(() => expect(save).toHaveBeenCalled());
    const written = JSON.parse(save.mock.calls[save.mock.calls.length - 1][1] as string) as TimelineProject;
    expect(written.clips[0].voice).toMatchObject({ status: 'failed' });
  });

  // ⚠️ #755-3：印は**文書に残る**が、鳴らす側・書き出す側は `voicePath` しか見ない。前に作った声が
  // 残っている状態で作り直しに失敗したとき `failed` を書くと、**声は鳴るのに「作れませんでした」**が
  // 開き直しても消えない（文や声を変えたときは音声が外れるので、残っている声はいまの文のもの＝使える）。
  it('前に作った声が残っているなら、作り直しに失敗しても「作れなかった」ことにしない（#755-3）', async () => {
    await open(doc({
      clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_002', startSec: 2, durationSec: 3, voice: { text: 'ひとこと', status: 'generated', voicePath: 'voices/old.wav' } }],
    }));
    vi.spyOn(MockVoiceProvider.prototype, 'synthesize').mockRejectedValue(new Error('つながらない'));
    const save = vi.spyOn(fsMod, 'saveProjectDoc').mockResolvedValue('x/project.json');
    await useTimelineStore.getState().generateSelectedVoice();

    const voice = useTimelineStore.getState().doc?.clips[0].voice;
    expect(voice).toMatchObject({ status: 'generated', voicePath: 'voices/old.wav' }); // 鳴る声はそのまま
    expect(useTimelineStore.getState().voiceError).toContain('前に作った声はそのまま使えます');
    await vi.waitFor(() => expect(save).toHaveBeenCalled());
    const written = JSON.parse(save.mock.calls[save.mock.calls.length - 1][1] as string) as TimelineProject;
    expect(written.clips[0].voice).toMatchObject({ status: 'generated' }); // 文書にも嘘を書かない
  });

  // ⚠️ レビュー指摘＝**保存に失敗した経路**（合成は成功・取り込みが `null`）は未検証だった。
  it('保存に失敗しても、前が「作成済み」なら据え置く（#755-3）', async () => {
    await open(doc({
      clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_002', startSec: 2, durationSec: 3, voice: { text: 'ひとこと', status: 'generated', voicePath: 'voices/old.wav' } }],
    }));
    vi.spyOn(voiceFsMod, 'importVoiceFile').mockResolvedValue(null); // 保存に失敗
    const save = vi.spyOn(fsMod, 'saveProjectDoc').mockResolvedValue('x/project.json');
    await useTimelineStore.getState().generateSelectedVoice();

    expect(useTimelineStore.getState().doc?.clips[0].voice).toMatchObject({ status: 'generated', voicePath: 'voices/old.wav' });
    expect(useTimelineStore.getState().voiceError).toContain('前に作った声はそのまま使えます');
    await vi.waitFor(() => expect(save).toHaveBeenCalled());
    const written = JSON.parse(save.mock.calls[save.mock.calls.length - 1][1] as string) as TimelineProject;
    expect(written.clips[0].voice).toMatchObject({ status: 'generated' });
  });

  // ⚠️ #801（🔴）＝**作っている間に入力が変わったら、失敗の後始末で印に触れない**。
  // 触ると「作り始める前の印」を無検査で書き戻すことになる。成功側と場面形式の失敗側は同じ照合を
  // 持っており、ここだけ抜けていた。
  describe('作っている間に入力が変わったときの失敗（#801）', () => {
    /** 合成が走っている最中に割り込む（`synthesize` の中で文書を触る）。 */
    const failAfter = (during: () => void) =>
      vi.spyOn(MockVoiceProvider.prototype, 'synthesize').mockImplementation(async () => {
        during();
        throw new Error('つながらない');
      });

    // 経路A＝**音声の無い「作成済み」が永続化**＝その読み上げが黙って欠けた動画が「成功」として出る。
    it('文を書き換えた後に失敗しても、「作成済み」に戻さない', async () => {
      await open(doc({
        clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_002', startSec: 2, durationSec: 3, voice: { text: 'ひとこと', status: 'generated', voicePath: 'voices/old.wav' } }],
      }));
      // 作っている間に文を変える＝`voicePath` も落ちる（作成済みの声は別の文のものだから）。
      failAfter(() => useTimelineStore.getState().setSelectedVoiceText('別のことば'));
      const save = vi.spyOn(fsMod, 'saveProjectDoc').mockResolvedValue('x/project.json');
      await useTimelineStore.getState().generateSelectedVoice();

      const voice = useTimelineStore.getState().doc?.clips[0].voice;
      expect(voice?.text).toBe('別のことば');
      expect(voice?.status).not.toBe('generated'); // ⚠️ ここが本題＝音声の無い「作成済み」を作らない
      expect(voice?.voicePath ?? null).toBeNull();
      // 文書にも書かない（開き直しても「作成済み」に見えない）。
      const written = save.mock.calls.length > 0
        ? (JSON.parse(save.mock.calls[save.mock.calls.length - 1][1] as string) as TimelineProject)
        : null;
      if (written) expect(written.clips[0].voice?.status).not.toBe('generated');
    });

    // 経路B＝取り消しで作成済みへ戻した後に失敗＝**鳴るのに「作れませんでした」**（#755-3 の再発）。
    it('取り消しで前の状態へ戻した後に失敗しても、「作れなかった」を書かない', async () => {
      await open(doc({
        clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_002', startSec: 2, durationSec: 3, voice: { text: 'ひとこと', status: 'generated', voicePath: 'voices/old.wav' } }],
      }));
      // 文を変えてから作り始め、作っている間に取り消して作成済みの状態へ戻す。
      useTimelineStore.getState().setSelectedVoiceText('別のことば');
      failAfter(() => useTimelineStore.getState().undo());
      await useTimelineStore.getState().generateSelectedVoice();

      const voice = useTimelineStore.getState().doc?.clips[0].voice;
      expect(voice).toMatchObject({ text: 'ひとこと', status: 'generated', voicePath: 'voices/old.wav' });
    });
  });

  // ⚠️ **文を変えた後は据え置かない**（判断材料は作り始める前の印）＝声のファイルで決めると
  // 古い文の声が「作成済み」に戻る。タイムライン形式は文を変えると `voicePath` も落ちるが、
  // **規則としてはどちらの形式でも同じ**（片方だけ別の判断にしない）。
  it('前が「作成済み」でないなら、失敗は「作れなかった」を残す（#755-3）', async () => {
    await open(doc({
      clips: [{ id: 'clip_001', kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_002', startSec: 2, durationSec: 3, voice: { text: 'ひとこと', status: 'none', voicePath: 'voices/old.wav' } }],
    }));
    vi.spyOn(MockVoiceProvider.prototype, 'synthesize').mockRejectedValue(new Error('つながらない'));
    await useTimelineStore.getState().generateSelectedVoice();
    expect(useTimelineStore.getState().doc?.clips[0].voice?.status).toBe('failed');
    // ⚠️ **添え書きも出さない**（PR #791 レビュー 🔴）＝印は「作れなかった」なのに「そのまま使えます」と
    // 言うと、古い文の声を使ってよいと誤解させる。印だけ見て通していたのでここで固定する。
    expect(useTimelineStore.getState().voiceError).not.toContain('前に作った声');
  });

  it('声が無いまま失敗したときは「作れなかった」を残す（次に開いたときも分かる）', async () => {
    await open(doc());
    vi.spyOn(MockVoiceProvider.prototype, 'synthesize').mockRejectedValue(new Error('つながらない'));
    await useTimelineStore.getState().generateSelectedVoice();
    expect(useTimelineStore.getState().doc?.clips[0].voice?.status).toBe('failed');
    expect(useTimelineStore.getState().voiceError).not.toContain('前に作った声');
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

// 「作っている最中」の印を、前の回が横取りしない（#755）。
describe('声を作る回の番号（#755）', () => {
  it('前の回が着地しても、走っている今の回の印を下ろさない', async () => {
    await open(doc());
    // 1本目：着地を止めておく。
    let landFirst = (): void => {};
    vi.spyOn(MockVoiceProvider.prototype, 'synthesize').mockImplementationOnce(
      () => new Promise((resolve) => {
        landFirst = (): void => resolve({ audioDataUrl: 'data:audio/wav;base64,AAA', durationSec: 5 });
      }),
    );
    const first = useTimelineStore.getState().generateSelectedVoice();
    expect(useTimelineStore.getState().generatingVoiceClipId).toBe('clip_001');

    // ⚠️ **本番の開き直し**を通す（`openTimelineProject`＝`emptyState`）。印は消えるが、
    // **走っている回は消えない**（合成はアプリの中で走り続ける）。
    await open(doc());
    expect(useTimelineStore.getState().generatingVoiceClipId).toBeNull(); // 印は消える
    // 走っている回が見えていれば、**2本目は始まらない**（連打・再入の関門）。
    const before = vi.mocked(MockVoiceProvider.prototype.synthesize).mock.calls.length;
    await useTimelineStore.getState().generateSelectedVoice();
    expect(vi.mocked(MockVoiceProvider.prototype.synthesize).mock.calls.length).toBe(before);

    // ここから先は「印を手で戻して2本目を始める」筋書き（印の横取りだけを見る）。
    useTimelineStore.setState({ generatingVoiceClipId: null, _voiceRun: null });
    let landSecond = (): void => {};
    vi.spyOn(MockVoiceProvider.prototype, 'synthesize').mockImplementationOnce(
      () => new Promise((resolve) => {
        landSecond = (): void => resolve({ audioDataUrl: 'data:audio/wav;base64,BBB', durationSec: 4 });
      }),
    );
    const second = useTimelineStore.getState().generateSelectedVoice();
    expect(useTimelineStore.getState().generatingVoiceClipId).toBe('clip_001');

    // ⚠️ 1本目が着地しても、**2本目が走っている印は残る**。下ろすと書き出しの締めが外れ、
    // 2本目の着地は `commit` に断られて**作った声が wav だけ残って消える**。
    landFirst();
    await first;
    expect(useTimelineStore.getState().generatingVoiceClipId).toBe('clip_001');

    landSecond();
    await second;
    expect(useTimelineStore.getState().generatingVoiceClipId).toBeNull(); // 自分の回なので下ろす
  });
});
