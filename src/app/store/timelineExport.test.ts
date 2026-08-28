// タイムライン形式の書き出し（ADR-0032 決定22・#631）。作る前に断る／描いて渡す／中止・片づけを固定する。
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ラスタライズ（canvas）は環境依存＝ここでは差し替える（`buildTimelineFrames.test.ts` と同じ扱い）。
// 実物の描画経路を1件だけ通したいテスト（動画のコマの焼き出し）があるので、丸ごとの差し替えでは足りない。
vi.mock('../../renderer/export/rasterize', () => ({ svgToPngDataUrl: vi.fn(async () => 'data:image/png;base64,X') }));
import { useTimelineStore, timelineBgmRunInputs } from './timelineStore';
import { EXPORT_CLEANUP_PENDING_MESSAGE, useExportLockStore } from './exportLock';
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

  // ⚠️ #512 段1＝直接置いた動画／段3＝差し込み口の動画は**映る**ようになったので、断るのは
  // **まだ映らない使い方**だけ＝**立ち絵に入れた動画**。
  // ⚠️ **立ち絵に入れた動画も書き出せるようになった**（#809）＝#512 の直接置き・差し込み口と
  // 同じく置き場所として数える。断りは**外した**ので、ここで見るのは「止まらないこと」。
  it('立ち絵に入れた動画は止めない（#809 で映るようになった）', async () => {
    const clip: TimelineClip = {
      id: 'clip_002', kind: TIMELINE_CLIP_KIND.template, trackId: 'track_001',
      startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 50, templateId: 'tmpl_001',
      character: { enabled: true, characterId: 'yuko', poseAssetId: 'asset_v' },
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
        // ⚠️ **立ち絵の層を持たせる**＝層が無ければそもそも描かれないので、置き場所にもならない
        // （#809 の変更点は「層があるとき映る」＝層が無い状態では何も確かめられない）。
        layers: [
          { id: 'background', type: 'background', x: 0, y: 0, w: 1920, h: 1080 },
          { id: 'chara', type: 'character', x: 100, y: 100, w: 400, h: 800 },
        ],
      }],
      templateAssetSrcById: {},
    } as unknown as typeof deps;
    await useTimelineStore.getState().exportTimelineVideo(withTemplate);
    expect(useTimelineStore.getState().exportRun.message ?? '').not.toContain('立ち絵として入れた動画');
  });

  // ⚠️ **差し込み口の元の音が、実際に書き出しへ渡るところまで見る**（#512 段3b レビュー 🔴）。
  // domain 側（`timelineAudioRuns`）は見た目パターンを渡して緑になるが、**本番の呼び出しが
  // 渡し続けている保証にはならない**（この配線が外れると、差し込み口の音だけが黙って消える）。
  it('差し込み口の元の音を、書き出しへ渡す', async () => {
    const clip: TimelineClip = {
      id: 'clip_002', kind: TIMELINE_CLIP_KIND.template, trackId: 'track_001',
      startSec: 1, durationSec: 5, x: 0, y: 0, w: 100, h: 50, templateId: 'tmpl_001',
      assetRefs: { main: 'asset_v' },
      slotClips: { main: { useOriginalAudio: true } },
    } as TimelineClip;
    await open(
      doc({
        assets: [{
          assetId: 'asset_v', assetType: 'video', displayName: '動画', filePath: 'assets/a.mp4',
          thumbnailPath: 'assets/a_thumb.png', metadata: { hasAudio: true },
        }],
        clips: [clip],
      }),
    );
    const withTemplate = {
      templates: [{
        schemaVersion: '1.0', templateId: 'tmpl_001', name: 'テンプレ', category: 'photo_intro',
        aspectRatio: '16:9', canvas: { width: 1920, height: 1080 },
        layers: [{ id: 'main', type: 'slot', x: 0, y: 0, w: 1920, h: 1080 }],
      }],
      templateAssetSrcById: {},
    } as unknown as typeof deps;
    await useTimelineStore.getState().exportTimelineVideo(withTemplate);
    const runs = vi.mocked(ffmpegMod.exportVideo).mock.calls[0][2];
    expect(runs).toEqual([
      expect.objectContaining({ audioPath: 'assets/a.mp4', delaySec: 1, playSec: 5, loopSource: false }),
    ]);
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

  // ⚠️ **掃除してから締めを返す**（#834-3）＝一時ファイルの置き場は**アプリで1つ**（ADR-0032 決定22・
  // 場面形式とタイムライン形式が共有）。先に返すと、次の書き出しが**この掃除の最中に**フレームを
  // 書き始め、掃除が**相手のフレームを消す**（締めはまさにそれを防ぐために在る）。
  it('片づけ終わってから走行中の締めを返す（次の書き出しの絵を消さない）', async () => {
    const order: string[] = [];
    vi.mocked(ffmpegMod.clearExportFramesStage).mockImplementation(async () => { order.push('clear'); });
    const release = useExportLockStore.getState().release;
    vi.spyOn(useExportLockStore.getState(), 'release').mockImplementation((owner) => { order.push('release'); release(owner); });
    await open(doc());
    await useTimelineStore.getState().exportTimelineVideo(deps);
    expect(order[order.length - 1]).toBe('release'); // 最後が締め返し＝掃除はその前に終わっている
    expect(order).toContain('clear');
  });

  // ⚠️ **締めがまだ返っていなければ始めない**＝直前の回の後片づけ（一時ファイルの掃除）が走っている間は、
  // 走行中の表示が落ちているのに締めは自分に残っている。ここで止めないと**締めを持たないまま走る回**が
  // でき、その最中に場面形式が締めを取って同時に走れてしまう（共有の一時置き場を互いに消す＝`11 §7.6.5`）。
  // ⚠️ **止めているのは押す前の関門**（`exportStartBlock` の `cleanupPending`・#843）＝以前は
  // `otherExportRunning` が**自分を数えない**ため素通りし、`acquire` の戻り値確認だけが受け止めていた。
  // いまは関門が先に捕まえるので、このテストが通るのは関門の側（`acquire` 分岐は将来の備えとして残置）。
  it('締めがまだ返っていなければ始めない（走行中のまま固まらせない）', async () => {
    await open(doc());
    // 持ち主が「自分（タイムライン形式）」＝前の回の後片づけがまだ走っている瞬間を作る。
    useExportLockStore.getState().acquire('timeline');
    await useTimelineStore.getState().exportTimelineVideo(deps);
    expect(vi.mocked(ffmpegMod.exportVideo)).not.toHaveBeenCalled(); // 走らない
    const run = useTimelineStore.getState().exportRun;
    expect(run.phase).toBe('error');
    // ⚠️ **「ほかの動画」ではない**（#843）＝片づけているのは**自分の直前の回**なので、主語の合う別の文言。
    expect(run.message).toBe(EXPORT_CLEANUP_PENDING_MESSAGE);
    expect(useExportLockStore.getState().owner).toBe('timeline'); // 走っている回の締めを奪わない
  });

  // ⚠️ **掃除が失敗しても締めは返す**＝返し損ねると、以後どの動画も書き出せなくなる（行き止まり）。
  it('片づけに失敗しても締めは返す（以後書き出せなくならない）', async () => {
    vi.mocked(ffmpegMod.clearExportFramesStage).mockRejectedValue(new Error('cleanup failed'));
    await open(doc());
    await useTimelineStore.getState().exportTimelineVideo(deps).catch(() => {});
    expect(useExportLockStore.getState().owner).toBeNull();
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
    expect(useTimelineStore.getState().editBlocked?.reason).toBe('TIMELINE_EDIT_EXPORTING');
  });

  it('書き出し中の取り消しも受け付けない', async () => {
    useTimelineStore.setState({
      doc: doc(),
      exportRun: { phase: 'encoding', percent: 90, message: null, cancelling: false },
    });
    useTimelineStore.getState().undo();
    expect(useTimelineStore.getState().editBlocked?.reason).toBe('TIMELINE_EDIT_EXPORTING');
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

  // 動画の元の音（#512 段2）＝**中身ではなくパスで渡す唯一の変換点**。
  // ⚠️ 中身（`audioSrcByKey`）を要求してしまうと、動画を丸ごと文字列にしない限り鳴らなくなる。
  const videoDoc = () =>
    doc({
      assets: [{ assetId: 'asset_v', assetType: 'video', displayName: '紹介', filePath: 'media/v.mp4', metadata: { hasAudio: true } }],
      clips: [{
        id: 'clip_v', kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001',
        startSec: 1, durationSec: 4, x: 0, y: 0, w: 1920, h: 1080,
        assetId: 'asset_v', useOriginalAudio: true, originalAudioVolume: 0.8,
      } as TimelineClip],
    });

  it('動画の元の音は、音源の中身が無くてもパスで渡す（飛ばさない）', () => {
    const runs = timelineBgmRunInputs(videoDoc(), {}); // ⚠️ 空の音源表＝中身は1つも無い
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      audioPath: 'media/v.mp4',
      audioBase64: '', // 中身は運ばない
      fileExt: 'mp4',
      delaySec: 1,
      playSec: 4,
      volume: 0.8,
      loopSource: false,
    });
  });

  it('音の部品にはパスを付けない（中身で渡す従来の経路のまま）', () => {
    const runs = timelineBgmRunInputs(doc({ clips: [audioClip] }), { 'bgm:found-new-hope': 'data:audio/mp3;base64,AAA' });
    expect(runs[0]).not.toHaveProperty('audioPath');
  });
});
