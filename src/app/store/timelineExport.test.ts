// タイムライン形式の書き出し（ADR-0032 決定22・#631）。作る前に断る／描いて渡す／中止・片づけを固定する。
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ラスタライズ（canvas）は環境依存＝ここでは差し替える（`buildTimelineFrames.test.ts` と同じ扱い）。
// 実物の描画経路を1件だけ通したいテスト（動画のコマの焼き出し）があるので、丸ごとの差し替えでは足りない。
vi.mock('../../renderer/export/rasterize', () => ({ svgToPngDataUrl: vi.fn(async () => 'data:image/png;base64,X') }));
import { useTimelineStore, timelineBgmRunInputs } from './timelineStore';
import { useExportLockStore } from './exportLock';
import * as fsMod from '../../infrastructure/projectFs';
import * as assetFsMod from '../../infrastructure/assetFs';
import * as dialogMod from '../../infrastructure/dialog';
import * as ffmpegMod from '../../infrastructure/ffmpegExport';
import * as framesMod from '../../renderer/export/buildTimelineFrames';
import * as fontsMod from '../../renderer/export/loadExportFonts';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../../domain/enums';
import { TIMELINE_SCHEMA_VERSION } from '../../domain/timeline/types';
import { volumeExpr } from '../../domain/timeline/audio';
import type { TimelineClip, TimelineProject } from '../../domain/timeline/types';

function doc(over: Partial<TimelineProject> = {}): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: 'proj_20260729_001',
    projectName: 'テスト動画',
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
      { id: 'clip_001', kind: TIMELINE_CLIP_KIND.text, trackId: 'track_001', startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 50, text: 'あ' },
    ],
    ...over,
  };
}

const deps = { templates: [], templateAssetSrcById: {} };

async function open(d: TimelineProject): Promise<void> {
  vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(d));
  await useTimelineStore.getState().openTimelineProject(d.projectId);
}

beforeEach(() => {
  // 走っている「声を作る」回は持ち越さない（#755＝文書を閉じても消えない印）。
  useTimelineStore.setState({ _voiceRun: null, generatingVoiceClipId: null });
  vi.restoreAllMocks();
  // 走行中は閉じられない（本番の締め）ので、テスト間は先に走行状態を落としてから閉じる。
  useTimelineStore.setState({ exportRun: { phase: 'idle', percent: 0, message: null, cancelling: false } });
  useExportLockStore.setState({ owner: null });
  useTimelineStore.getState().closeTimelineProject();
  vi.spyOn(assetFsMod, 'assetDisplayUrl').mockResolvedValue('asset://a.png');
  vi.spyOn(ffmpegMod, 'canExport').mockReturnValue(true);
  vi.spyOn(ffmpegMod, 'beginExport').mockResolvedValue(undefined);
  vi.spyOn(ffmpegMod, 'listenExportProgress').mockResolvedValue(() => undefined);
  vi.spyOn(ffmpegMod, 'clearExportFramesStage').mockResolvedValue(undefined);
  vi.spyOn(ffmpegMod, 'exportVideo').mockResolvedValue({ outputPath: '/out/movie.mp4' } as never);
  vi.spyOn(framesMod, 'buildTimelineFrames').mockResolvedValue({ framesDir: 'timeline_frames', fps: 30, durationSec: 5 });
  vi.spyOn(dialogMod, 'showSaveVideoDialog').mockResolvedValue('/out/movie.mp4');
  vi.spyOn(fontsMod, 'loadExportFonts').mockResolvedValue(undefined);
});

describe('exportTimelineVideo', () => {
  it('描いたフレームを書き出しへ渡し、保存できたと知らせる', async () => {
    await open(doc());
    await useTimelineStore.getState().exportTimelineVideo(deps);
    expect(vi.mocked(ffmpegMod.exportVideo)).toHaveBeenCalledWith(
      [{ framesDir: 'timeline_frames', fps: 30, durationSec: 5 }],
      'テスト動画',
      [],
      'proj_20260729_001',
      '/out/movie.mp4',
    );
    const run = useTimelineStore.getState().exportRun;
    expect(run.phase).toBe('done');
    expect(run.message).toContain('保存しました');
  });

  it('何も置いていなければ、保存先を聞く前に断る（重い処理をさせない）', async () => {
    await open(doc({ clips: [] }));
    await useTimelineStore.getState().exportTimelineVideo(deps);
    expect(vi.mocked(dialogMod.showSaveVideoDialog)).not.toHaveBeenCalled();
    expect(vi.mocked(ffmpegMod.exportVideo)).not.toHaveBeenCalled();
    expect(useTimelineStore.getState().exportRun.message).toContain('まだ何も置かれていない');
  });

  // ⚠️ #512 段1＝**直接置いた動画は映る**ようになったので、断るのは**まだ映らない使い方**だけ
  // （見た目パターンの差し込み口に入れた動画＝段3 まで静止のまま）。
  it('見た目パターンの差し込み口に入れた動画は断る（静止画で出さない）', async () => {
    const clip: TimelineClip = {
      id: 'clip_002', kind: TIMELINE_CLIP_KIND.template, trackId: 'track_001',
      startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 50, templateId: 'tmpl_001',
      assetRefs: { background: 'asset_v' },
    } as TimelineClip;
    await open(
      doc({
        assets: [{ assetId: 'asset_v', assetType: 'video', displayName: '動画', filePath: 'assets/a.mp4' }],
        clips: [clip],
      }),
    );
    // 見た目パターンは解決できる状態にする（未解決の断りが先に出ると、動画の話を見られない）。
    const withTemplate = {
      templates: [{
        schemaVersion: '1.0', templateId: 'tmpl_001', name: 'テンプレ', category: 'photo_intro',
        aspectRatio: '16:9', canvas: { width: 1920, height: 1080 },
        layers: [{ id: 'background', type: 'background', x: 0, y: 0, w: 1920, h: 1080 }],
      }],
      templateAssetSrcById: {},
    } as unknown as typeof deps;
    await useTimelineStore.getState().exportTimelineVideo(withTemplate);
    expect(vi.mocked(ffmpegMod.exportVideo)).not.toHaveBeenCalled();
    expect(useTimelineStore.getState().exportRun.message).toContain('差し込み口や立ち絵に入れた動画');
  });

  // ⚠️ **位置引数の並びは型で守れない**（`speed`/`fps`/`width` はどれも number＝取り違えても通る）。
  // 実映像が壊れた速さ・解像度で焼かれるので、**実際に渡る値**を1件だけ固定する（#512 段1 レビュー 🟡）。
  it('動画のコマの焼き出しに、正しい順で値を渡す', async () => {
    vi.mocked(framesMod.buildTimelineFrames).mockRestore();
    const stage = vi.spyOn(ffmpegMod, 'stageClipFrames').mockResolvedValue(30);
    vi.spyOn(ffmpegMod, 'readExportFrame').mockResolvedValue('data:frame');
    await open(
      doc({
        assets: [{ assetId: 'asset_v', assetType: 'video', displayName: '動画', filePath: 'assets/a.mp4', thumbnailPath: 'assets/a_thumb.png' }],
        clips: [{
          id: 'clip_002', kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001',
          // ⚠️ **長さと速さを別の値にする**（同値だと入れ替えても通る＝テストが空振りする）。
          startSec: 0, durationSec: 4, x: 0, y: 0, w: 100, h: 50,
          assetId: 'asset_v', sourceStartSec: 3, speed: 2,
        } as TimelineClip],
      }),
    );
    await useTimelineStore.getState().exportTimelineVideo(deps);
    expect(stage).toHaveBeenCalledWith(
      'proj_20260729_001', // どの動画の
      'assets/a.mp4', // **本体**（代表フレームではない）
      3, // トリム
      4, // 置いた長さ
      2, // 速さ
      30, // fps
      1920, // 横幅（向きから）
      'timeline_frames_v_clip_002', // 部品ごとの置き場
    );
  });

  it('保存先を選ばなければ何もしない（勝手に書き出さない）', async () => {
    vi.mocked(dialogMod.showSaveVideoDialog).mockResolvedValue(null);
    await open(doc());
    await useTimelineStore.getState().exportTimelineVideo(deps);
    expect(vi.mocked(framesMod.buildTimelineFrames)).not.toHaveBeenCalled();
    expect(useTimelineStore.getState().exportRun.phase).toBe('idle');
  });

  // ⚠️ **Rust が整えた文言はそのまま出す**（#512 段1 レビュー 🟡）＝コマの焼き出しが本走行に入り、
  // 「動画が見つかりませんでした。もう一度取り込んでください」等が届くようになった。丸めると
  // **何度やっても成功しない案内**になる。Tauri は**文字列で** reject するので、そこで見分ける。
  it('Rust が整えた案内はそのまま出す（丸めない）', async () => {
    vi.mocked(ffmpegMod.exportVideo).mockRejectedValue('動画が見つかりませんでした。もう一度取り込んでください');
    await open(doc());
    await useTimelineStore.getState().exportTimelineVideo(deps);
    expect(useTimelineStore.getState().exportRun.message).toBe('動画が見つかりませんでした。もう一度取り込んでください');
  });

  it('失敗したら「次にどうするか」を知らせる（生のエラーを見せない）', async () => {
    vi.mocked(ffmpegMod.exportVideo).mockRejectedValue(new Error('ffmpeg exited with code 1'));
    await open(doc());
    await useTimelineStore.getState().exportTimelineVideo(deps);
    const run = useTimelineStore.getState().exportRun;
    expect(run.phase).toBe('error');
    expect(run.message).toBe('動画を書き出せませんでした。しばらくしてから、もう一度お試しください。');
  });

  it('成功しても失敗しても一時ファイルを片づける（次の書き出しに古い絵を混ぜない）', async () => {
    await open(doc());
    await useTimelineStore.getState().exportTimelineVideo(deps);
    expect(vi.mocked(ffmpegMod.clearExportFramesStage).mock.calls.length).toBeGreaterThanOrEqual(2);
    vi.mocked(ffmpegMod.clearExportFramesStage).mockClear();
    vi.mocked(ffmpegMod.exportVideo).mockRejectedValue(new Error('x'));
    await useTimelineStore.getState().exportTimelineVideo(deps);
    expect(vi.mocked(ffmpegMod.clearExportFramesStage)).toHaveBeenCalled();
  });

  it('中止したら書き出さず、中止として知らせる', async () => {
    vi.mocked(framesMod.buildTimelineFrames).mockImplementation(async () => {
      useTimelineStore.getState().cancelTimelineExport();
      return { framesDir: 'timeline_frames', fps: 30, durationSec: 5 };
    });
    await open(doc());
    await useTimelineStore.getState().exportTimelineVideo(deps);
    expect(vi.mocked(ffmpegMod.exportVideo)).not.toHaveBeenCalled();
    expect(useTimelineStore.getState().exportRun.phase).toBe('cancelled');
  });

  it('声を作っている最中は始めない（作った声が捨てられる・#718）', async () => {
    await open(doc());
    // ⚠️ 見るのは**走っている回**（#755）＝印は開き直しで消えるので、それだけだと締めが外れる。
    useTimelineStore.setState({ generatingVoiceClipId: 'clip_009', _voiceRun: 1 });
    await useTimelineStore.getState().exportTimelineVideo(deps);
    expect(vi.mocked(dialogMod.showSaveVideoDialog)).not.toHaveBeenCalled();
    expect(useTimelineStore.getState().exportRun.message).toContain('声を作成中です');
  });

  it('書き出し中は二重に始めない（保存先を選んでいる間も含む）', async () => {
    let release = (): void => undefined;
    // **保存先ダイアログを開いたまま**にする＝「聞いている最中に押し直す」を実際に再現する
    //（すぐ解決するモックだと、押し直しの時点で1本目がどこまで進んでいるかに結果が左右される）。
    let answerDialog: (p: string) => void = () => {};
    vi.mocked(dialogMod.showSaveVideoDialog).mockReturnValue(new Promise<string>((r) => { answerDialog = r; }));
    vi.mocked(framesMod.buildTimelineFrames).mockImplementation(
      () => new Promise((resolve) => { release = () => resolve({ framesDir: 'd', fps: 30, durationSec: 5 }); }),
    );
    await open(doc());
    const first = useTimelineStore.getState().exportTimelineVideo(deps);
    await vi.waitFor(() => expect(vi.mocked(dialogMod.showSaveVideoDialog)).toHaveBeenCalledTimes(1));
    // 保存先を聞いている最中に押し直す＝ここで走行中に数えていないと2本走る。
    await useTimelineStore.getState().exportTimelineVideo(deps);
    expect(vi.mocked(dialogMod.showSaveVideoDialog)).toHaveBeenCalledTimes(1);
    answerDialog('/out/movie.mp4');
    await vi.waitFor(() => expect(vi.mocked(framesMod.buildTimelineFrames)).toHaveBeenCalled());
    release();
    await first;
    expect(vi.mocked(framesMod.buildTimelineFrames)).toHaveBeenCalledTimes(1);
  });

  it('書き出し中は別の動画を開かない（描いている途中の素材や音が入れ替わらない）', async () => {
    let release = (): void => undefined;
    let started = (): void => undefined;
    const drawing = new Promise<void>((resolve) => { started = resolve; });
    vi.mocked(framesMod.buildTimelineFrames).mockImplementation(() => {
      started();
      return new Promise((resolve) => { release = () => resolve({ framesDir: 'd', fps: 30, durationSec: 5 }); });
    });
    await open(doc());
    const first = useTimelineStore.getState().exportTimelineVideo(deps);
    await drawing;
    await open(doc({ projectId: 'proj_20260729_002', projectName: 'べつの動画' }));
    expect(useTimelineStore.getState().doc?.projectName).toBe('テスト動画'); // 開き替わっていない
    expect(useTimelineStore.getState().exportRun.message).toContain('別の動画を開いてください');
    release();
    await first;
  });

  it('書き出し中の編集は受け付けない（入らない編集を「保存しました」に混ぜない）', async () => {
    useTimelineStore.setState({
      doc: doc(),
      exportRun: { phase: 'rendering', percent: 10, message: null, cancelling: false },
      selectedClipIds: ['clip_001'],
    });
    useTimelineStore.getState().addTrack(TRACK_KIND.visual);
    expect(useTimelineStore.getState().doc?.tracks).toHaveLength(2); // 増えていない
    expect(useTimelineStore.getState().editBlocked).toBe('TIMELINE_EDIT_EXPORTING');
  });

  it('書き出し中の取り消しも受け付けない', async () => {
    useTimelineStore.setState({
      doc: doc(),
      exportRun: { phase: 'encoding', percent: 90, message: null, cancelling: false },
    });
    useTimelineStore.getState().undo();
    expect(useTimelineStore.getState().editBlocked).toBe('TIMELINE_EDIT_EXPORTING');
  });

  it('素材は**書き出しで描ける形**（data URL）へ解き直す（表示用のURLを渡さない）', async () => {
    // ⚠️ 書き出しは SVG を Blob → <img> → canvas で焼くので、**表示用の `asset://` は取りに行かずに黙って落ちる**
    //（canvas は汚れず `toDataURL` は成功する＝素材が抜けた動画が「成功」として出る・#716）。
    let seen: string | undefined;
    const read = vi.spyOn(assetFsMod, 'readAssetDataUrl').mockResolvedValue('data:image/png;base64,AAAA');
    vi.mocked(framesMod.buildTimelineFrames).mockImplementation(async (_d, o) => {
      seen = o.assetSrc('asset_001');
      return { framesDir: 'd', fps: 30, durationSec: 5 };
    });
    await open(doc({
      assets: [{ assetId: 'asset_001', assetType: 'image', displayName: '写真', filePath: 'assets/asset_001.png' }],
      clips: [{ id: 'clip_001', kind: 'slot', trackId: 'track_001', startSec: 0, durationSec: 5, assetId: 'asset_001' }],
    }));
    // 表示用の URL が入っていても、そちらは渡さない。
    useTimelineStore.setState({ assetSrcById: { asset_001: 'asset://表示用.png' } });
    await useTimelineStore.getState().exportTimelineVideo(deps);
    expect(seen).toBe('data:image/png;base64,AAAA');
    expect(read).toHaveBeenCalledWith('proj_20260729_001', 'assets/asset_001.png');
  });

  it('素材のファイルを読めなかったら、描く前に断る（枠だけの動画を成功として出さない）', async () => {
    vi.spyOn(assetFsMod, 'readAssetDataUrl').mockResolvedValue(null); // 読めない
    await open(doc({
      assets: [{ assetId: 'asset_001', assetType: 'image', displayName: '写真', filePath: 'assets/asset_001.png' }],
      clips: [{ id: 'clip_001', kind: 'slot', trackId: 'track_001', startSec: 0, durationSec: 5, assetId: 'asset_001' }],
    }));
    await useTimelineStore.getState().exportTimelineVideo(deps);
    expect(vi.mocked(framesMod.buildTimelineFrames)).not.toHaveBeenCalled(); // 描き始めない
    expect(useTimelineStore.getState().exportRun.phase).toBe('error');
    expect(useTimelineStore.getState().exportRun.message).toContain('素材のファイルを読めませんでした');
  });

  it('使っていない素材は読まない（記憶に載せない）', async () => {
    const read = vi.spyOn(assetFsMod, 'readAssetDataUrl').mockResolvedValue('data:image/png;base64,AAAA');
    // 素材はあるが、どの部品も使っていない。
    await open(doc({ assets: [{ assetId: 'asset_001', assetType: 'image', displayName: '写真', filePath: 'assets/asset_001.png' }] }));
    await useTimelineStore.getState().exportTimelineVideo(deps);
    expect(read).not.toHaveBeenCalled();
  });

  it('描くのに使う素材は始めた時点のものを使う（途中で入れ替えても混ざらない）', async () => {
    let seen: string | undefined;
    vi.spyOn(assetFsMod, 'readAssetDataUrl').mockResolvedValue('data:image/png;base64,AAAA');
    vi.mocked(framesMod.buildTimelineFrames).mockImplementation(async (_d, o) => {
      // 走っている最中に文書を入れ替えても、渡すものは始めた時点のまま。
      useTimelineStore.setState({ doc: null });
      seen = o.assetSrc('asset_001');
      return { framesDir: 'd', fps: 30, durationSec: 5 };
    });
    await open(doc({
      assets: [{ assetId: 'asset_001', assetType: 'image', displayName: '写真', filePath: 'assets/asset_001.png' }],
      clips: [{ id: 'clip_001', kind: 'slot', trackId: 'track_001', startSec: 0, durationSec: 5, assetId: 'asset_001' }],
    }));
    await useTimelineStore.getState().exportTimelineVideo(deps);
    expect(seen).toBe('data:image/png;base64,AAAA');
  });

  it('同梱フォントをそろえてから描く（プレビューと違う字で焼かない）', async () => {
    const order: string[] = [];
    vi.spyOn(fontsMod, 'loadExportFonts').mockImplementation(async () => { order.push('fonts'); });
    vi.mocked(framesMod.buildTimelineFrames).mockImplementation(async () => {
      order.push('draw');
      return { framesDir: 'd', fps: 30, durationSec: 5 };
    });
    await open(doc());
    await useTimelineStore.getState().exportTimelineVideo(deps);
    expect(order).toEqual(['fonts', 'draw']);
  });

  it('動画全体のフォントを受け皿として渡す（部品ごとの指定が無いときに継承する）', async () => {
    await open(doc({ videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600, fontId: 'kaitou-yokoku-gothic' } }));
    await useTimelineStore.getState().exportTimelineVideo(deps);
    expect(vi.mocked(framesMod.buildTimelineFrames).mock.calls[0][1].fontFamily).toContain('Kaitou Yokoku Gothic');
  });

  it('ほかの形式が書き出している間は始めない（一時ファイルの置き場を取り合わない）', async () => {
    useExportLockStore.setState({ owner: 'scene' });
    await open(doc());
    await useTimelineStore.getState().exportTimelineVideo(deps);
    expect(vi.mocked(dialogMod.showSaveVideoDialog)).not.toHaveBeenCalled();
    expect(useTimelineStore.getState().exportRun.message).toContain('ほかの動画を書き出しています');
  });

  it('保存先を聞くのに失敗しても、走行中のまま固まらない', async () => {
    vi.mocked(dialogMod.showSaveVideoDialog).mockRejectedValue(new Error('dialog failed'));
    await open(doc());
    await useTimelineStore.getState().exportTimelineVideo(deps);
    expect(useTimelineStore.getState().exportRun.phase).toBe('error');
    expect(useExportLockStore.getState().owner).toBeNull(); // 締めも返す
  });

  it('走行中に出た知らせを閉じても、書き出し中の締めは外れない', async () => {
    useTimelineStore.setState({
      doc: doc(),
      exportRun: { phase: 'rendering', percent: 10, message: 'いま動画を書き出しています。', cancelling: false },
    });
    useTimelineStore.getState().dismissTimelineExport();
    const run = useTimelineStore.getState().exportRun;
    expect(run.message).toBeNull(); // 知らせだけ消える
    expect(run.phase).toBe('rendering'); // 走行中のまま＝一覧へ戻る・二重起動が開かない
  });

  it('書き出し中は閉じない（締めごと初期化されない）', async () => {
    await open(doc());
    useTimelineStore.setState({ exportRun: { phase: 'rendering', percent: 1, message: null, cancelling: false } });
    useTimelineStore.getState().closeTimelineProject();
    expect(useTimelineStore.getState().doc).not.toBeNull();
  });

  it('再生したまま書き出しても、再生は止まる（鳴っている音と重ならない）', async () => {
    await open(doc());
    useTimelineStore.getState().play();
    expect(useTimelineStore.getState().isPlaying).toBe(true);
    await useTimelineStore.getState().exportTimelineVideo(deps);
    expect(useTimelineStore.getState().isPlaying).toBe(false);
  });
});

describe('timelineBgmRunInputs', () => {
  const audioClip: TimelineClip = {
    id: 'clip_bgm', kind: TIMELINE_CLIP_KIND.audio, trackId: 'track_002',
    startSec: 2, durationSec: 4, bundledBgmId: 'found-new-hope',
  };

  it('再生に使っている音源をそのまま渡す（聞いた音と書き出した音が一致する）', () => {
    const d = doc({ clips: [audioClip] });
    const runs = timelineBgmRunInputs(d, { 'bgm:found-new-hope': 'data:audio/mp3;base64,AAA' });
    expect(runs).toEqual([
      {
        audioBase64: 'data:audio/mp3;base64,AAA',
        fileExt: 'mp3',
        volume: 0.25,
        delaySec: 2,
        playSec: 4,
        fadeInSec: 0,
        fadeOutSec: 0,
        loopSource: true,
        sourceStartSec: 0,
        speed: 1,
      },
    ]);
  });

  it('読み上げは繰り返さない（言葉が二重に鳴らない）', () => {
    const voice: TimelineClip = {
      id: 'clip_v', kind: TIMELINE_CLIP_KIND.voice, trackId: 'track_002', startSec: 0, durationSec: 3,
      voice: { text: 'あ', status: 'generated', voicePath: 'voices/clip_v.wav' },
    };
    const runs = timelineBgmRunInputs(doc({ clips: [voice, audioClip] }), {
      'voice:voices/clip_v.wav': 'data:audio/wav;base64,AAA',
      'bgm:found-new-hope': 'data:audio/mp3;base64,BBB',
    });
    expect(runs.map((r) => r.loopSource)).toEqual([false, true]);
  });

  it('読めなかった音源は置かない（無い音を混ぜようとして書き出しごと失敗させない）', () => {
    expect(timelineBgmRunInputs(doc({ clips: [audioClip] }), {})).toEqual([]);
  });

  it('音量の変化はそのまま式で渡す（#512・混ぜる側で組み直さない）', () => {
    const withPoints: TimelineClip = { ...audioClip, volumePoints: [{ timeSec: 0, volume: 0.1 }, { timeSec: 4, volume: 1 }] };
    const runs = timelineBgmRunInputs(doc({ clips: [withPoints] }), { 'bgm:found-new-hope': 'data:audio/mp3;base64,AAA' });
    expect(runs[0].volumeExpr).toBe(volumeExpr(withPoints.volumePoints));
  });

  it('点が無ければ式は付けない（従来どおり一定値の音量で出る＝場面形式と同じ引数）', () => {
    const runs = timelineBgmRunInputs(doc({ clips: [audioClip] }), { 'bgm:found-new-hope': 'data:audio/mp3;base64,AAA' });
    expect(runs[0]).not.toHaveProperty('volumeExpr');
  });
});
