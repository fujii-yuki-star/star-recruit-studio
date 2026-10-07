// 帯に敷く絵（#332）＝音の波形／動画のコマ列を、必要になったときだけ作る。
//
// ⚠️ **作り直せるもの**なので文書には持たない（既存の代表フレームと同じ扱い・Issue の指定）。
// ここで固定するのは「**同じ素材に2回たのまない**」＝帯は再描画のたびに呼ばれるので、
// 素通しにすると FFmpeg が何度も起動する。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pumpAnalysisQueue, resetAnalysisQueue, useTimelineStore } from './timelineStore';
import * as fsMod from '../../infrastructure/projectFs';
import * as assetFsMod from '../../infrastructure/assetFs';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../../domain/enums';
import { EXPORT_RUN_PHASE } from '../../domain/export/exportProgress';
import { TIMELINE_SCHEMA_VERSION } from '../../domain/timeline/types';
import type { TimelineProject } from '../../domain/timeline/types';

const doc = (over: Partial<TimelineProject> = {}): TimelineProject => ({
  schemaVersion: TIMELINE_SCHEMA_VERSION,
  format: PROJECT_FORMAT.timeline,
  projectId: 'proj_20260827_001',
  projectName: 'テスト',
  createdAt: '2026-08-27T00:00:00.000Z',
  updatedAt: '2026-08-27T00:00:00.000Z',
  videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
  voiceSettings: { defaultVoiceId: 'voicevox_zundamon' },
  assets: [
    { assetId: 'asset_001', assetType: 'bgm', displayName: '曲', filePath: 'assets/asset_001.mp3' },
    { assetId: 'asset_002', assetType: 'video', displayName: '動画', filePath: 'assets/asset_002.mp4' },
    { assetId: 'asset_003', assetType: 'image', displayName: '写真', filePath: 'assets/asset_003.png' },
  ],
  tracks: [
    { id: 'track_001', kind: TRACK_KIND.visual },
    { id: 'track_002', kind: TRACK_KIND.audio },
  ],
  clips: [
    // ⚠️ **音は `kind:'audio'`**（`slot` ではない）＝素材の差し込みだけを見ていると
    // 波形が一度も描かれない（レビュー 🔴 で判明・`11 §7.6`）。
    { id: 'clip_001', kind: TIMELINE_CLIP_KIND.audio, trackId: 'track_002', startSec: 0, durationSec: 5, assetId: 'asset_001' },
    { id: 'clip_002', kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001', startSec: 0, durationSec: 5, x: 0, y: 0, w: 10, h: 10, assetId: 'asset_002' },
    { id: 'clip_003', kind: TIMELINE_CLIP_KIND.slot, trackId: 'track_001', startSec: 5, durationSec: 5, x: 0, y: 0, w: 10, h: 10, assetId: 'asset_003' },
  ],
  ...over,
});

describe('ensureClipAnalysis（帯に敷く絵・#332）', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    // 順番待ちは**アプリ起動中ずっと残る**（`resetAssetIdReservations` と同じ）。テストは
    // 1本ずつが別の起動なので毎回捨てる（前のテストの止まった仕事で次が動かなくなる）。
    resetAnalysisQueue();
    useTimelineStore.getState().closeTimelineProject();
    vi.spyOn(assetFsMod, 'assetDisplayUrl').mockResolvedValue('asset://x');
    vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(doc()));
    await useTimelineStore.getState().openTimelineProject('proj_20260827_001');
    useTimelineStore.setState({ analysisByPath: {} });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  const st = () => useTimelineStore.getState();

  /**
   * ⚠️ **「増えないこと」は待ってから見る**＝`vi.waitFor` は**最初の確認で通れば成功**するので、
   * 「増えていないはず」を `waitFor` で見ると、**増える前に通って**しまう（変異チェックで3件とも
   * 生き残った）。落ち着くまで待ってから数える。
   */
  const settle = async (): Promise<void> => { await new Promise((r) => setTimeout(r, 20)); };

  it('音は波形をたのむ', async () => {
    const peaks = vi.spyOn(assetFsMod, 'audioPeaks').mockResolvedValue([0.1, 0.9]);
    st().ensureClipAnalysis('clip_001', 400);
    await vi.waitFor(() => expect(st().analysisByPath['assets/asset_001.mp3#0.000-5.000']?.peaks).toEqual([0.1, 0.9]));
    expect(peaks).toHaveBeenCalledWith('proj_20260827_001', 'assets/asset_001.mp3', expect.any(Number), 0, 5);
  });

  it('動画はコマ列をたのむ', async () => {
    const strip = vi.spyOn(assetFsMod, 'videoFilmstrip').mockResolvedValue('asset://strip.png');
    st().ensureClipAnalysis('clip_002', 400);
    await vi.waitFor(() => expect(st().analysisByPath['assets/asset_002.mp4#0.000-5.000']?.stripUrl).toBe('asset://strip.png'));
    expect(strip).toHaveBeenCalled();
  });

  // ⚠️ **動画は両方にしない**＝コマ列と波形が重なるとどちらも読めない。
  it('動画に波形はたのまない', async () => {
    const peaks = vi.spyOn(assetFsMod, 'audioPeaks').mockResolvedValue([1]);
    vi.spyOn(assetFsMod, 'videoFilmstrip').mockResolvedValue('asset://strip.png');
    st().ensureClipAnalysis('clip_002', 400);
    await vi.waitFor(() => expect(st().analysisByPath['assets/asset_002.mp4#0.000-5.000']).toBeTruthy());
    expect(peaks).not.toHaveBeenCalled();
  });

  it('写真は何もたのまない（帯に敷くものが無い）', () => {
    const peaks = vi.spyOn(assetFsMod, 'audioPeaks');
    const strip = vi.spyOn(assetFsMod, 'videoFilmstrip');
    st().ensureClipAnalysis('clip_003', 400);
    expect(peaks).not.toHaveBeenCalled();
    expect(strip).not.toHaveBeenCalled();
    expect('assets/asset_003.png#0.000-5.000' in st().analysisByPath).toBe(false); // 印も残さない
  });

  /**
   * ⚠️ **同じ素材に2回たのまない**＝帯は再描画のたびに呼ばれるので、素通しにすると
   * FFmpeg が何度も起動する。走り出した時点で印をつけて打ち止めにする。
   */
  it('続けて呼んでも1回しかたのまない', async () => {
    const peaks = vi.spyOn(assetFsMod, 'audioPeaks').mockResolvedValue([0.5]);
    st().ensureClipAnalysis('clip_001', 400);
    st().ensureClipAnalysis('clip_001', 400);
    st().ensureClipAnalysis('clip_001', 800);
    await vi.waitFor(() => expect(st().analysisByPath['assets/asset_001.mp3#0.000-5.000']?.peaks).toEqual([0.5]));
    expect(peaks).toHaveBeenCalledTimes(1);
  });

  /**
   * ⚠️ **作れなかったときも打ち止めにする**＝音の入っていない動画・壊れたファイルで
   * 毎回たのむと、帯が出るたびに FFmpeg が空振りする。
   */
  it('作れなくても、もう一度たのまない', async () => {
    const peaks = vi.spyOn(assetFsMod, 'audioPeaks').mockResolvedValue([]);
    st().ensureClipAnalysis('clip_001', 400);
    await vi.waitFor(() => expect(peaks).toHaveBeenCalledTimes(1));
    expect(st().analysisByPath['assets/asset_001.mp3#0.000-5.000']).toBeNull();
    st().ensureClipAnalysis('clip_001', 400);
    expect(peaks).toHaveBeenCalledTimes(1);
  });

  /**
   * ⚠️ **待っている間に別の動画へ移っていたら書かない**（`runImport` と同じ流儀）＝
   * 別の文書の同じ番号の素材に、前の文書の波形が付く。
   */
  it('待っている間に別の動画へ移ったら書かない', async () => {
    let release: (v: number[]) => void = () => {};
    vi.spyOn(assetFsMod, 'audioPeaks').mockReturnValue(new Promise((r) => { release = r; }));
    st().ensureClipAnalysis('clip_001', 400);
    vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(doc({ projectId: 'proj_20260827_999' })));
    await st().openTimelineProject('proj_20260827_999');
    release([0.9]);
    await Promise.resolve();
    expect(st().analysisByPath['assets/asset_001.mp3#0.000-5.000']?.peaks).toBeUndefined();
  });

  /**
   * ⚠️ **一斉に立てない**（#332）＝帯が20本並んでいると FFmpeg が20本**同時に**立つ
   *（書き出し中でも立つ）。CPU を取り合って、いま焼いている動画まで遅くなる。
   */
  it('同時に走らせる数を絞る（順番に流す）', async () => {
    const release: (() => void)[] = [];
    vi.spyOn(assetFsMod, 'audioPeaks').mockImplementation(
      () => new Promise<number[]>((r) => { release.push(() => r([0.5])); }),
    );
    // 音の部品を5本に増やして、一度にたのむ。
    const many = doc({
      assets: Array.from({ length: 5 }, (_, i) => ({
        assetId: `asset_10${i}`, assetType: 'bgm' as const,
        displayName: `曲${i}`, filePath: `assets/asset_10${i}.mp3`,
      })),
      tracks: [{ id: 'track_002', kind: TRACK_KIND.audio }],
      clips: Array.from({ length: 5 }, (_, i) => ({
        id: `clip_10${i}`, kind: TIMELINE_CLIP_KIND.audio, trackId: 'track_002',
        startSec: i * 5, durationSec: 5, assetId: `asset_10${i}`,
      })),
    } as Partial<TimelineProject>);
    vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(many));
    await st().openTimelineProject(many.projectId);
    useTimelineStore.setState({ analysisByPath: {} });
    for (let i = 0; i < 5; i += 1) st().ensureClipAnalysis(`clip_10${i}`, 400);

    // 走り出しているのは上限まで（残りは順番待ち）。
    await vi.waitFor(() => expect(release.length).toBe(2));
    release[0]();
    await vi.waitFor(() => expect(release.length).toBe(3)); // 1つ終わると1つ進む
  });

  /**
   * ⚠️ **書き出し中は測らない**（レビュー 🟡・ADR-0032 決定22「走行中は入力を固定」）＝
   * `run`/`run_bytes` は `EXPORT_CHILD` に載らないので、**中止でもアプリ終了でも殺せない**
   * FFmpeg が焼いている最中に増える（CPU を取り合う）。
   *
   * ⚠️ **印を付ける前に断る**＝後ろに置くと、書き出しが終わってもその部品だけ
   * 「もう一度たのまない」規則で**永久に空**のままになる。ここではその両方を見る。
   */
  it('書き出し中は測らず、終わったら測れる', async () => {
    const peaks = vi.spyOn(assetFsMod, 'audioPeaks').mockResolvedValue([0.4]);
    useTimelineStore.setState({ exportRun: { phase: EXPORT_RUN_PHASE.rendering, percent: 0, message: null, cancelling: false } });
    st().ensureClipAnalysis('clip_001', 400);
    expect(peaks).not.toHaveBeenCalled();
    // 印も付けない＝終わってからちゃんと測れる（永久に空にしない）。
    expect(Object.keys(st().analysisByPath)).toEqual([]);

    useTimelineStore.setState({ exportRun: { phase: EXPORT_RUN_PHASE.idle, percent: 0, message: null, cancelling: false } });
    st().ensureClipAnalysis('clip_001', 400);
    await vi.waitFor(() => expect(peaks).toHaveBeenCalledTimes(1));
  });

  /**
   * ⚠️ **文書を手放す入口はすべて順番待ちを捨てる**（PR #876 レビュー 🔴）＝以前は
   * `closeTimelineProject` にだけ置いていたが、**一覧から別の動画を開く**（`openTimelineProject`）は
   * そこを通らないので、**実機の主要な遷移で一度も走らなかった**（テストが `close` を明示的に
   * 呼んでいたので穴が見えなかった）。片づけを `emptyState()` の中へ移して構造で防ぐ。
   */
  it('別の動画を開いたら、前の動画の順番待ちは捨てる', async () => {
    const release: (() => void)[] = [];
    vi.spyOn(assetFsMod, 'audioPeaks').mockImplementation(
      () => new Promise<number[]>((r) => { release.push(() => r([0.5])); }),
    );
    const many = doc({
      assets: Array.from({ length: 5 }, (_, i) => ({
        assetId: `asset_10${i}`, assetType: 'bgm' as const,
        displayName: `曲${i}`, filePath: `assets/asset_10${i}.mp3`,
      })),
      tracks: [{ id: 'track_002', kind: TRACK_KIND.audio }],
      clips: Array.from({ length: 5 }, (_, i) => ({
        id: `clip_10${i}`, kind: TIMELINE_CLIP_KIND.audio, trackId: 'track_002',
        startSec: i * 5, durationSec: 5, assetId: `asset_10${i}`,
      })),
    } as Partial<TimelineProject>);
    vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(many));
    await st().openTimelineProject(many.projectId);
    useTimelineStore.setState({ analysisByPath: {} });
    for (let i = 0; i < 5; i += 1) st().ensureClipAnalysis(`clip_10${i}`, 400);
    await vi.waitFor(() => expect(release.length).toBe(2)); // 2本走り、3本が順番待ち

    // ⚠️ **閉じずに、別の動画を開く**（実機の主要な遷移）。
    vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(doc({ projectId: 'proj_20260827_777' })));
    await st().openTimelineProject('proj_20260827_777');

    // 待たせていた3本は捨てる（走り出さない）。
    release.splice(0).forEach((r) => r());
    await settle();
    expect(assetFsMod.audioPeaks).toHaveBeenCalledTimes(2);
  });

  /**
   * ⚠️ **積んだ後に書き出しが始まったぶんも止める**（PR #876 レビュー 🟡）＝関門を積むときだけに
   * 置くと、帯が多い文書を開いた直後に書き出すと**そのまま走る**。⚠️ **捨てずに残し、終わったら流す**
   *（`ensureClipAnalysis` は印を付けているので、次の描画では二度とたのまれない＝永久に空になる）。
   */
  it('積んだ後に書き出しが始まったら止め、終わったら流す', async () => {
    const release: (() => void)[] = [];
    vi.spyOn(assetFsMod, 'audioPeaks').mockImplementation(
      () => new Promise<number[]>((r) => { release.push(() => r([0.5])); }),
    );
    const many = doc({
      assets: Array.from({ length: 3 }, (_, i) => ({
        assetId: `asset_20${i}`, assetType: 'bgm' as const,
        displayName: `曲${i}`, filePath: `assets/asset_20${i}.mp3`,
      })),
      tracks: [{ id: 'track_002', kind: TRACK_KIND.audio }],
      clips: Array.from({ length: 3 }, (_, i) => ({
        id: `clip_20${i}`, kind: TIMELINE_CLIP_KIND.audio, trackId: 'track_002',
        startSec: i * 5, durationSec: 5, assetId: `asset_20${i}`,
      })),
    } as Partial<TimelineProject>);
    vi.spyOn(fsMod, 'loadProjectDoc').mockResolvedValue(JSON.stringify(many));
    await st().openTimelineProject(many.projectId);
    useTimelineStore.setState({ analysisByPath: {} });
    for (let i = 0; i < 3; i += 1) st().ensureClipAnalysis(`clip_20${i}`, 400);
    await vi.waitFor(() => expect(release.length).toBe(2));

    // 書き出しが始まる → 走り終わったぶんの次が動かない
    useTimelineStore.setState({ exportRun: { phase: EXPORT_RUN_PHASE.rendering, percent: 0, message: null, cancelling: false } });
    release.splice(0).forEach((r) => r());
    await settle();
    expect(assetFsMod.audioPeaks).toHaveBeenCalledTimes(2);

    // 書き出しが終わったら流す（永久に空にしない）
    useTimelineStore.setState({ exportRun: { phase: EXPORT_RUN_PHASE.idle, percent: 0, message: null, cancelling: false } });
    pumpAnalysisQueue();
    await vi.waitFor(() => expect(assetFsMod.audioPeaks).toHaveBeenCalledTimes(3));
    release.splice(0).forEach((r) => r());
  });

  /**
   * ⚠️ **「書き出しが終わったら流す」の配線は、挙動のテストでは捕まえられない**
   *（変異チェックで確認＝`finally` の1行を消しても上のテストは緑のまま）。
   * 実際に書き出しを1本通すのは重すぎるので、**呼んでいること自体**を原文で留める
   *（`layerTypeLiteralGuard.test.ts` と同じ流儀＝型では守れないものを門番で留める）。
   *
   * ⚠️ **これが外れると永久に空の帯が残る**＝`ensureClipAnalysis` は印を付けているので、
   * 次の描画では二度とたのまれない。
   */
  it('書き出しの締めで、待たせていた仕事を流している（配線の門番）', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/store/timelineStore.ts'), 'utf8');
    // 書き出しの `finally`（締めを返すところ）の直後に呼んでいること。
    expect(src).toMatch(/release\(EXPORT_OWNER\);[\s\S]{0,400}?pumpAnalysisQueue\(\);/);
  });

  it('無い部品を指しても何もしない', () => {
    const peaks = vi.spyOn(assetFsMod, 'audioPeaks');
    st().ensureClipAnalysis('clip_099', 400);
    expect(peaks).not.toHaveBeenCalled();
  });

  // ⚠️ **帯が広いほど細かく取る**（幅で決める＝見えない細かさまで測らない）。
  it('帯の幅で細かさが変わる', async () => {
    const peaks = vi.spyOn(assetFsMod, 'audioPeaks').mockResolvedValue([1]);
    st().ensureClipAnalysis('clip_001', 40);
    await vi.waitFor(() => expect(peaks).toHaveBeenCalledTimes(1));
    const narrow = peaks.mock.calls[0][2];
    // 同じ部品は打ち止めになるので、印を捨ててからもう一度（幅だけを変える）。
    useTimelineStore.setState({ analysisByPath: {} });
    st().ensureClipAnalysis('clip_001', 800);
    await vi.waitFor(() => expect(peaks).toHaveBeenCalledTimes(2));
    expect(peaks.mock.calls[1][2]).toBeGreaterThan(narrow as number);
  });
});
