import { describe, expect, it } from 'vitest';
import { TRANSITION_TYPE } from '../enums';
import type { Project, Scene } from './types';
import { planBgmMix, resolveBgmExportRuns } from './bgmExport';
import type { BgmExportRun } from './bgmExport';

function scene(sceneId: string, durationSec: number, bgmSettings?: unknown, transition?: unknown): Scene {
  return {
    sceneId, partId: 'part_001', order: 1, sceneType: 'intro', templateId: 'tpl', durationSec,
    assetRefs: {}, character: { enabled: false, characterId: 'yuko' }, texts: {},
    narration: { text: '', status: 'none' }, warnings: [], bgmSettings, transition,
  } as unknown as Scene;
}
function project(scenes: Scene[], bgm?: unknown): Project {
  return { scenes, bgmSettings: bgm } as unknown as Project;
}

const PROJ_BGM = { enabled: true, bundledBgmId: 'summer-morning', volume: 0.25, fadeInSec: 1.5, fadeOutSec: 2 };

describe('resolveBgmExportRuns（ADR-0018 ③(7) PR-B）', () => {
  it('全場面継承＝1区間 [0,総尺]（volume/fades はプロジェクト設定を持つ）', () => {
    const runs = resolveBgmExportRuns(project([scene('s1', 8), scene('s2', 6)], PROJ_BGM));
    expect(runs).toEqual([
      { bundledBgmId: 'summer-morning', assetId: null, volume: 0.25, fadeInSec: 1.5, fadeOutSec: 2, startSec: 0, endSec: 14 },
    ]);
  });
  it('場面が別曲に上書き＝2区間（各ソース・スパン）', () => {
    const runs = resolveBgmExportRuns(
      project([scene('s1', 8), scene('s2', 6, { enabled: true, bundledBgmId: 'found-new-hope', volume: 0.3 })], PROJ_BGM),
    );
    expect(runs.map((r) => [r.bundledBgmId, r.startSec, r.endSec])).toEqual([
      ['summer-morning', 0, 8],
      ['found-new-hope', 8, 14],
    ]);
  });
  it('無音場面はスキップ／BGMなしは空', () => {
    expect(resolveBgmExportRuns(project([scene('s1', 8, { enabled: false })], PROJ_BGM))).toEqual([]);
    expect(resolveBgmExportRuns(project([scene('s1', 8)]))).toEqual([]);
  });
  it('場面遷移（xfade）の重なりを考慮した区間境界になる（表示＝書き出しの時間軸整合）', () => {
    // s1(8)+s2(6) を fade 2秒で繋ぐと s2 は 6秒開始・実効総尺 12秒（8+6−2）。両場面継承＝1区間 [0,12]。
    const runs = resolveBgmExportRuns(
      project([scene('s1', 8), scene('s2', 6, undefined, { in: TRANSITION_TYPE.fade, durationSec: 2 })], PROJ_BGM),
    );
    expect(runs).toEqual([
      { bundledBgmId: 'summer-morning', assetId: null, volume: 0.25, fadeInSec: 1.5, fadeOutSec: 2, startSec: 0, endSec: 12 },
    ]);
  });
});

describe('planBgmMix（配置＋フェード計画・クロスフェード）', () => {
  const run = (o: Partial<BgmExportRun> & { startSec: number; endSec: number }): BgmExportRun => ({
    bundledBgmId: 'x', assetId: null, volume: 0.25, fadeInSec: 1.5, fadeOutSec: 2, ...o,
  });
  it('単一区間＝配置0・全長・先頭/末尾フェードは設定値', () => {
    expect(planBgmMix([run({ startSec: 0, endSec: 10 })], 1)).toEqual([
      { bundledBgmId: 'x', assetId: null, volume: 0.25, delaySec: 0, playSec: 10, fadeInSec: 1.5, fadeOutSec: 2 },
    ]);
  });
  it('曲が変わる接する境界＝前後を half 重ねてクロスフェード（重なり幅=cross）', () => {
    const clips = planBgmMix([run({ startSec: 0, endSec: 8 }), run({ startSec: 8, endSec: 14 })], 1);
    // 先頭区間：末尾を +0.5 延長・末尾フェード=cross、先頭フェード=設定。
    expect(clips[0]).toMatchObject({ delaySec: 0, playSec: 8.5, fadeInSec: 1.5, fadeOutSec: 1 });
    // 後続区間：先頭を -0.5 前倒し配置・先頭フェード=cross、末尾フェード=設定。
    expect(clips[1]).toMatchObject({ delaySec: 7.5, playSec: 6.5, fadeInSec: 1, fadeOutSec: 2 });
  });
  it('無音を挟む区間（接しない）は重ねない', () => {
    const clips = planBgmMix([run({ startSec: 0, endSec: 8 }), run({ startSec: 14, endSec: 19 })], 1);
    expect(clips[0]).toMatchObject({ delaySec: 0, playSec: 8 });
    expect(clips[1]).toMatchObject({ delaySec: 14, playSec: 5 });
  });
  it('短い区間はフェードを長さの半分にクランプ', () => {
    const clips = planBgmMix([run({ startSec: 0, endSec: 1, fadeInSec: 2, fadeOutSec: 2 })], 1);
    expect(clips[0].fadeInSec).toBe(0.5);
    expect(clips[0].fadeOutSec).toBe(0.5);
  });
});
