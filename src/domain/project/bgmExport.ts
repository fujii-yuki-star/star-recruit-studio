// 場面ごとBGMの書き出しミックス計画（ADR-0018 ③(7) PR-B）。純粋関数（§7 テスト対象）。
// 実効BGM（場面 ?? プロジェクト）が同じソースの連続場面を1区間にまとめ（compileTimeline と同じ groupBgmRuns を共有）、
// 曲が変わる境界を短いクロスフェードで繋ぐ「置き場所＋フェード」の計画を出す。実際の FFmpeg フィルタ組み立ては Rust。
import { TRANSITION_TYPE } from '../enums';
import { resolveBgmVolume } from '../voice/audioMix';
import { resolveTransition, transitionTimeline } from './sceneTransitions';
import { groupBgmRuns } from './compileTimeline';
import type { Project } from './types';

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
}

/** project からBGM区間を解決する（場面ごとBGM・null=継承）。書き出しの実効時間軸（xfade 重なり込み）の秒。 */
export function resolveBgmExportRuns(project: Project): BgmExportRun[] {
  const scenes = project.scenes;
  if (scenes.length === 0) return [];
  const durations = scenes.map((s) => s.durationSec);
  const boundaryDs = scenes.map((s, i) => {
    const r = resolveTransition(s.transition);
    return i === 0 || r.type === TRANSITION_TYPE.none ? 0 : r.durationSec;
  });
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
