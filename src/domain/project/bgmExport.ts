// 場面ごとBGMの書き出しミックス計画（ADR-0018 ③(7) PR-B）。純粋関数（§7 テスト対象）。
// 実効BGM（場面 ?? プロジェクト）が同じソースの連続場面を1区間にまとめ（compileTimeline と同じ groupBgmRuns を共有）、
// 曲が変わる境界を短いクロスフェードで繋ぐ「置き場所＋フェード」の計画を出す。実際の FFmpeg フィルタ組み立ては Rust。
import { resolveBgmVolume } from '../voice/audioMix';
import { transitionBoundaryDs, transitionTimeline } from './sceneTransitions';
import { groupBgmRuns } from './compileTimeline';
import { lineSegments } from './lineTimeline';
import { sceneLines } from './narrationLines';
import {
  applyDucking,
  duckingFactorPoints,
  fitSpeechSpans,
  resolveAudioAuto,
  type AudioAutoSettings,
  type SpeechSpan,
} from '../voice/audioAuto';
import { volumeExpr } from '../timeline/audio';
import { VOLUME_POINTS_MAX } from '../constants';
import type { Project, Scene } from './types';

/** 書き出しBGM区間：実効BGMのソースと音量/フェード＋グローバル [startSec, endSec]。 */
export interface BgmExportRun {
  bundledBgmId: string | null;
  assetId: string | null;
  volume: number;
  fadeInSec: number;
  fadeOutSec: number;
  startSec: number;
  endSec: number;
}

/** ミックスでの1クリップの置き場所（adelay=delaySec・素材から playSec を切り出し・前後フェード）。Rust へ渡す計画。 */
export interface BgmMixClip {
  bundledBgmId: string | null;
  assetId: string | null;
  volume: number;
  /** グローバル配置開始（秒）＝adelay。 */
  delaySec: number;
  /** ループ素材から使う長さ（秒）＝atrim。 */
  playSec: number;
  fadeInSec: number;
  fadeOutSec: number;
  /**
   * 音量の変化の式（#257 ダッキング）。**あるときは `volume` より優先**（Rust の `volume_expr`）。
   * 声が鳴っている区間だけ下げる＝タイムライン形式の `volumePoints` と同じ受け口を使う。
   */
  volumeExpr?: string;
}

/** project からBGM区間を解決する（場面ごとBGM・null=継承）。書き出しの実効時間軸（xfade 重なり込み）の秒。 */
export function resolveBgmExportRuns(project: Project): BgmExportRun[] {
  const scenes = project.scenes;
  if (scenes.length === 0) return [];
  const durations = scenes.map((s) => s.durationSec);
  const boundaryDs = transitionBoundaryDs(scenes); // 組み方は共有（写さない・#727 レビュー）
  const { steps } = transitionTimeline(durations, boundaryDs);
  const starts = scenes.map((_s, i) => (i === 0 ? 0 : steps[i - 1].offsetSec));
  const ends = starts.map((start, i) => start + durations[i]);
  return groupBgmRuns(scenes, starts, ends, project.bgmSettings).map((r) => ({
    bundledBgmId: r.bgm.bundledBgmId ?? null,
    assetId: r.bgm.assetId ?? null,
    // プレビュー（PreviewScreen）と同じ resolveBgmVolume 経由で値域 [VOLUME_MIN, VOLUME_MAX] にクランプ（手編集等の範囲外対策）。
    volume: resolveBgmVolume(undefined, r.bgm),
    fadeInSec: Math.max(0, r.bgm.fadeInSec ?? 0),
    fadeOutSec: Math.max(0, r.bgm.fadeOutSec ?? 0),
    startSec: r.startSec,
    endSec: r.endSec,
  }));
}

/**
 * 区間列を「配置＋フェード」の計画へ。曲が変わる境界（前後が接する＝touching）は前後を half ずつ重ね、
 * 重なり部を crossSec のフェードで繋ぐ（クロスフェード）。先頭は fadeInSec、末尾は fadeOutSec、無音との境は crossSec。
 * フェードは区間長の半分を超えないようクランプ（短い区間対策）。
 */
export function planBgmMix(runs: readonly BgmExportRun[], crossSec: number): BgmMixClip[] {
  const eps = 1e-6;
  const half = crossSec / 2;
  const last = runs.length - 1;
  return runs.map((run, i) => {
    const touchesPrev = i > 0 && Math.abs(runs[i - 1].endSec - run.startSec) < eps;
    const touchesNext = i < last && Math.abs(runs[i + 1].startSec - run.endSec) < eps;
    const delaySec = Math.max(0, run.startSec - (touchesPrev ? half : 0));
    const endPlaced = run.endSec + (touchesNext ? half : 0);
    const playSec = endPlaced - delaySec;
    const fadeIn = touchesPrev ? crossSec : i === 0 ? run.fadeInSec : crossSec;
    const fadeOut = touchesNext ? crossSec : i === last ? run.fadeOutSec : crossSec;
    const maxFade = playSec / 2;
    return {
      bundledBgmId: run.bundledBgmId,
      assetId: run.assetId,
      volume: run.volume,
      delaySec,
      playSec,
      fadeInSec: Math.min(fadeIn, maxFade),
      fadeOutSec: Math.min(fadeOut, maxFade),
    };
  });
}

/**
 * ミックス計画に**ダッキング**（#257）を載せる。声が鳴っている区間だけ BGM を下げる。
 *
 * ⚠️ **`planBgmMix` の後に掛ける**＝式の `t` は「置いた音の中の秒」（`adelay` の前・`asetpts` で
 * 0 起点に戻したあと）なので、`delaySec`/`playSec` が決まってからでないと秒を合わせられない。
 * ⚠️ **点が多すぎるときはまとめる**（`fitSpeechSpans`）＝黙って捨てると**その区間だけ下がらない**。
 * まとめたかどうかを返す＝呼ぶ側が知らせられる（§2-5）。
 */
export function applyDuckingToMix(
  clips: readonly BgmMixClip[],
  speech: readonly SpeechSpan[],
  settings: AudioAutoSettings | undefined,
): { clips: BgmMixClip[]; merged: boolean } {
  const s = resolveAudioAuto(settings);
  if (!s.duckBgm || s.duckDepth <= 0 || speech.length === 0) return { clips: [...clips], merged: false };
  const fitted = fitSpeechSpans(speech, s, VOLUME_POINTS_MAX);
  const out = clips.map((c) => {
    const factor = duckingFactorPoints(fitted.spans, { startSec: c.delaySec, endSec: c.delaySec + c.playSec }, s);
    const expr = volumeExpr(applyDucking(undefined, c.volume, factor));
    return expr ? { ...c, volumeExpr: expr } : c;
  });
  return { clips: out, merged: fitted.merged };
}

/**
 * 声が鳴っている区間（グローバル秒）＝BGM を下げる区間（#257）。
 *
 * ⚠️ **時間軸は BGM 区間と同じ**（`transitionTimeline`）＝切り替えで詰まったぶんも同じように見る。
 * ⚠️ **「表示の窓」ではなく「実際に鳴っている長さ」で採る**＝掛け合いの行の窓は
 *「次の行が始まるまで」なので、そのまま使うと**声が終わったあとも下げっぱなし**になる。
 * 音声の長さが分からない行（まだ作っていない）は**下げない**＝鳴らない声のために下げない。
 */
export function resolveSpeechSpans(
  project: Project,
  /** その行（掛け合い）／その場面（単独）の**作成済み音声の長さ**（秒）。無ければ 0。 */
  audioDurationFor: (scene: Scene, lineId?: string) => number,
): SpeechSpan[] {
  const scenes = project.scenes;
  if (scenes.length === 0) return [];
  const durations = scenes.map((s) => s.durationSec);
  const { steps } = transitionTimeline(durations, transitionBoundaryDs(scenes));
  const starts = scenes.map((_s, i) => (i === 0 ? 0 : steps[i - 1].offsetSec));
  const out: SpeechSpan[] = [];
  scenes.forEach((scene, i) => {
    const base = starts[i];
    const sceneEnd = base + scene.durationSec;
    const lines = sceneLines(scene);
    if (lines.length === 0) {
      const d = audioDurationFor(scene);
      if (d > 0) out.push({ startSec: base, endSec: Math.min(base + d, sceneEnd) });
      return;
    }
    const segs = lineSegments(scene, {});
    lines.forEach((line, j) => {
      const d = audioDurationFor(scene, line.lineId);
      if (d <= 0) return; // まだ作っていない声のために下げない
      const from = base + (segs[j]?.startSec ?? 0);
      out.push({ startSec: from, endSec: Math.min(from + d, sceneEnd) });
    });
  });
  return out;
}
