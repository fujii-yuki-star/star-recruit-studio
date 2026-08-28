import { describe, expect, it } from 'vitest';
import { TRANSITION_TYPE } from '../enums';
import type { Project, Scene } from './types';
import { applyDuckingToMix, planBgmMix, resolveBgmExportRuns, resolveSpeechSpans } from './bgmExport';
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

/**
 * 声が鳴っている区間（#257）。⚠️ **「表示の窓」ではなく「実際に鳴っている長さ」で採る**＝
 * 掛け合いの行の窓は「次の行が始まるまで」なので、そのまま使うと声が終わったあとも下げっぱなしになる。
 */
describe('resolveSpeechSpans（#257）', () => {
  function lineScene(sceneId: string, durationSec: number, lines: unknown[]): Scene {
    return { ...scene(sceneId, durationSec), lines } as unknown as Scene;
  }

  it('単独の読み上げは場面の先頭から音声の長さぶん', () => {
    const p = project([scene('s1', 10)]);
    expect(resolveSpeechSpans(p, () => 3)).toEqual([{ startSec: 0, endSec: 3 }]);
  });

  it('場面の尺を超えない（音声が長くても場面の外まで下げない）', () => {
    expect(resolveSpeechSpans(project([scene('s1', 4)]), () => 30)).toEqual([{ startSec: 0, endSec: 4 }]);
  });

  it('まだ作っていない声は下げない（鳴らない声のために下げない）', () => {
    expect(resolveSpeechSpans(project([scene('s1', 10)]), () => 0)).toEqual([]);
  });

  it('掛け合いは行ごと＝「次の行まで」ではなく音声の長さで終わる', () => {
    const p = project([
      lineScene('s1', 20, [
        { lineId: 'line_001', text: 'あ', status: 'none' },
        { lineId: 'line_002', text: 'い', startSec: 10, status: 'none' },
      ]),
    ]);
    expect(resolveSpeechSpans(p, () => 2)).toEqual([
      { startSec: 0, endSec: 2 },
      { startSec: 10, endSec: 12 },
    ]);
  });

  /**
   * ⚠️ **開始秒を書いていない行**（＝自動逐次＝既定）でも、2行目が1行目の**後ろ**から始まる
   *（PR #896 レビュー 🔴）。以前は行の長さを渡さずに窓を採っていたため**全部 0 秒に潰れ**、
   * 本当は鳴っていない所で BGM が下がり、鳴っている所で下がらなかった。
   * ⚠️ 上の「掛け合いは行ごと」のテストは **2行目に `startSec: 10` を明示**していたので、
   * この経路（`?? cursor`）を踏んでおらず、穴を見つけられなかった。
   */
  it('開始秒を書いていない掛け合いは、前の行の音声の長さぶん後ろから始まる', () => {
    const p = project([
      lineScene('s1', 20, [
        { lineId: 'line_001', text: 'あ', status: 'none' },
        { lineId: 'line_002', text: 'い', status: 'none' },
        { lineId: 'line_003', text: 'う', status: 'none' },
      ]),
    ]);
    expect(resolveSpeechSpans(p, () => 3)).toEqual([
      { startSec: 0, endSec: 3 },
      { startSec: 3, endSec: 6 },
      { startSec: 6, endSec: 9 },
    ]);
  });

  /**
   * ⚠️ **単独読み上げも「行」として引く**（PR #896 レビュー ℹ️）＝`sceneLines` は必ず1行返すので
   * 「行が無い」分岐は一度も通らない。**渡す `lineId` は `line_001`**（`lineFromNarration` の固定値）で、
   * 音声キーの解決は呼ぶ側の `narrationAudioKey` が「明示の行が無ければ場面 id」に倒す。
   */
  it('単独読み上げでも行として引く（渡る lineId は line_001）', () => {
    const seen: (string | undefined)[] = [];
    resolveSpeechSpans(project([scene('s1', 10)]), (_s, lineId) => {
      seen.push(lineId);
      return 3;
    });
    expect(seen).toEqual(['line_001']);
  });

  /** ⚠️ 時間軸は BGM 区間と同じ（`transitionTimeline`）＝切り替えで詰まったぶんも同じように見る。 */
  it('切り替えで詰まったぶんを見る（BGM 区間と同じ時間軸）', () => {
    const p = project([
      scene('s1', 8),
      scene('s2', 8, undefined, { in: TRANSITION_TYPE.fade, durationSec: 2 }),
    ]);
    // 2つ目の場面は 8 ではなく 6 から始まる（2秒重なる）。
    expect(resolveSpeechSpans(p, () => 1)).toEqual([
      { startSec: 0, endSec: 1 },
      { startSec: 6, endSec: 7 },
    ]);
  });
});

describe('applyDuckingToMix（#257）', () => {
  const clips = () => planBgmMix([{ bundledBgmId: 'summer-morning', assetId: null, volume: 0.5, fadeInSec: 0, fadeOutSec: 0, startSec: 0, endSec: 20 }] as BgmExportRun[], 1);

  it('しない設定なら式を付けない（従来どおりの一定音量＝出力不変）', () => {
    const r = applyDuckingToMix(clips(), [{ startSec: 2, endSec: 4 }], { duckBgm: false });
    expect(r.clips[0].volumeExpr).toBeUndefined();
  });

  it('声が無ければ式を付けない', () => {
    expect(applyDuckingToMix(clips(), [], {}).clips[0].volumeExpr).toBeUndefined();
  });

  it('声がある区間で下がる式を付ける（元の音量に倍率を掛けた絶対値）', () => {
    const r = applyDuckingToMix(clips(), [{ startSec: 2, endSec: 4 }], { duckDepth: 0.5 });
    // 元 0.5 × 倍率 0.5 ＝ 0.25 が式に現れる。
    expect(r.clips[0].volumeExpr).toContain('0.25');
    expect(r.merged).toBe(false);
  });

  /** ⚠️ **黙って点を捨てない**＝捨てるとその区間だけ下がらない。まとめたことを返して知らせる。 */
  it('セリフが多すぎるときはまとめ、まとめたことを返す', () => {
    // 間を空ける（狭いと最初の一回でまとまってしまい、まとめ直しが走らない）。
    const many = Array.from({ length: 40 }, (_, i) => ({ startSec: i * 3, endSec: i * 3 + 1 }));
    expect(applyDuckingToMix(clips(), many, {}).merged).toBe(true);
  });
});
