import { describe, expect, it } from 'vitest';
import { deriveTransitionSelectValue, resolveBoundaryTransition, resolveTransition, shortenedTransitionSceneNumbers, transitionTimeline, swallowedByTransitionSceneNumbers } from './sceneTransitions';
import { FPS } from '../constants';
import type { Scene, Transition } from './types';

const EPS = 1 / FPS; // 切り替えが場面から残す最小の尺＝1フレーム（TRANSITION_MIN_TAIL_SEC・#547 P3-4）

// resolveBoundaryTransition は scenes 配列＋対象添字で呼ぶ（書き出しと同じ全場面 transitionTimeline）。最小の Scene を作る。
const sc = (durationSec: number, transition?: Transition): Scene =>
  ({
    sceneId: `scene_${durationSec}`, partId: 'part_001', order: 1, sceneType: 'opening', templateId: 't',
    durationSec, assetRefs: {}, character: { enabled: false, characterId: 'yuko' },
    texts: {}, narration: { text: '', status: 'none' }, warnings: [], ...(transition ? { transition } : {}),
  } as unknown as Scene);

describe('resolveTransition', () => {
  it('未設定は none / 既定方向 left / 既定 0.5 秒', () => {
    expect(resolveTransition(undefined)).toEqual({ type: 'none', direction: 'left', durationSec: 0.5 });
  });

  it('fade はそのまま', () => {
    expect(resolveTransition({ in: 'fade' })).toMatchObject({ type: 'fade' });
  });

  it('slide は direction を反映（未指定は left）', () => {
    expect(resolveTransition({ in: 'slide', direction: 'up' })).toMatchObject({ type: 'slide', direction: 'up' });
    expect(resolveTransition({ in: 'slide' }).direction).toBe('left');
  });

  it('wipe/zoom は MVP 未対応のため fade にフォールバック', () => {
    expect(resolveTransition({ in: 'wipe' }).type).toBe('fade');
    expect(resolveTransition({ in: 'zoom' }).type).toBe('fade');
  });

  it('durationSec は 0 以上に丸める', () => {
    expect(resolveTransition({ in: 'fade', durationSec: -1 }).durationSec).toBe(0);
    expect(resolveTransition({ in: 'fade', durationSec: 1.2 }).durationSec).toBe(1.2);
  });
});

describe('deriveTransitionSelectValue（UI select 値・resolveTransition と一致）', () => {
  it('none/fade/slide:dir を返し、未設定は none', () => {
    expect(deriveTransitionSelectValue(undefined)).toBe('none');
    expect(deriveTransitionSelectValue({ in: 'none' })).toBe('none');
    expect(deriveTransitionSelectValue({ in: 'fade' })).toBe('fade');
    expect(deriveTransitionSelectValue({ in: 'slide', direction: 'up' })).toBe('slide:up');
    expect(deriveTransitionSelectValue({ in: 'slide' })).toBe('slide:left'); // 既定方向
  });

  it('wipe/zoom は fade として表示（書き出し実効値と一致＝UI と乖離させない）', () => {
    expect(deriveTransitionSelectValue({ in: 'wipe' })).toBe('fade');
    expect(deriveTransitionSelectValue({ in: 'zoom' })).toBe('fade');
  });
});

describe('transitionTimeline', () => {
  it('空・単一場面は遷移なし', () => {
    expect(transitionTimeline([], [])).toEqual({ effectiveTotalSec: 0, steps: [] });
    expect(transitionTimeline([8], [0])).toEqual({ effectiveTotalSec: 8, steps: [] });
  });

  it('2場面：offset=累積−D、総尺=Σ尺−ΣD', () => {
    const r = transitionTimeline([8, 10], [0, 2]);
    expect(r.steps).toEqual([{ offsetSec: 6, durationSec: 2 }]);
    expect(r.effectiveTotalSec).toBe(16);
  });

  it('3場面：offset は実効累積を基準に進む', () => {
    const r = transitionTimeline([8, 10, 6], [0, 2, 1]);
    expect(r.steps).toEqual([
      { offsetSec: 6, durationSec: 2 }, // acc 8 → 16
      { offsetSec: 15, durationSec: 1 }, // acc 16 → 21
    ]);
    expect(r.effectiveTotalSec).toBe(21);
  });

  it('D=0（none）は単純連結（offset=累積・総尺=Σ尺）', () => {
    const r = transitionTimeline([8, 10], [0, 0]);
    expect(r.steps).toEqual([{ offsetSec: 8, durationSec: 0 }]);
    expect(r.effectiveTotalSec).toBe(18);
  });

  it('極短場面：D は左右どちらの尺も strict `<` で clamp＝場面は最低1フレーム残す（#547 P3-4）', () => {
    // D 希望 5 だが両場面とも 3 → d は 3 未満（3−ε）＝丸ごと飲み込まない（旧実装は d==3 を許していた）。
    const r = transitionTimeline([3, 3], [0, 5]);
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0].durationSec).toBeLessThan(3); // strict `<`
    expect(r.steps[0].durationSec).toBeCloseTo(3 - EPS, 6); // 尺−ε（1フレーム）
    expect(r.steps[0].offsetSec).toBeCloseTo(EPS, 6); // acc−d=ε
    expect(r.effectiveTotalSec).toBeCloseTo(3 + EPS, 6); // 右場面が ε だけ寄与
  });

  it('D は常に右場面尺 **未満**（strict `<`）＝FFmpeg xfade に duration≥入力尺を渡さない（#547 P3-4）', () => {
    // want が尺以上でも d<尺。短尺・複数境界の退化ケースを含めて各 step の d が右場面尺未満であることを固定。
    const durations = [3, 0.3, 2, 8];
    const boundaryDs = [0, 10, 5, 0.5]; // 2つ目/3つ目は want≫尺の退化・4つ目は通常
    const { steps } = transitionTimeline(durations, boundaryDs);
    steps.forEach((s, k) => {
      expect(s.durationSec).toBeLessThan(durations[k + 1]); // 右場面尺未満
      expect(s.durationSec).toBeGreaterThanOrEqual(0);
    });
    expect(steps[2].durationSec).toBeCloseTo(0.5, 6); // 通常（want<尺−ε）は want そのまま
  });

  it('場面尺が1フレーム（ε）以下ならハードカット＝d=0（重ねようがない）', () => {
    const { steps } = transitionTimeline([8, EPS / 2], [0, 5]); // 2つ目が半フレーム
    expect(steps[0].durationSec).toBe(0);
  });
});

describe('resolveBoundaryTransition（#408 Part 2・プレビュー用の境界解決）', () => {
  const fade = (durationSec: number): Transition => ({ in: 'fade', durationSec });

  it('先頭場面（targetIndex=0）＝durationSec 0（プレビューしない）', () => {
    expect(resolveBoundaryTransition([sc(8, fade(0.5))], 0)).toEqual({
      type: 'fade', direction: 'left', durationSec: 0,
    });
  });

  it('type=none＝durationSec 0（プレビューしない）', () => {
    expect(resolveBoundaryTransition([sc(8), sc(8, { in: 'none' })], 1).durationSec).toBe(0);
  });

  it('fade は希望 D をそのまま（両場面尺内なら clamp なし）＝書き出しと同じ実効値', () => {
    expect(resolveBoundaryTransition([sc(8), sc(10, fade(0.5))], 1)).toEqual({
      type: 'fade', direction: 'left', durationSec: 0.5,
    });
  });

  it('slide の方向を保つ・希望 D を返す', () => {
    expect(resolveBoundaryTransition([sc(8), sc(8, { in: 'slide', direction: 'up', durationSec: 0.8 })], 1)).toEqual({
      type: 'slide', direction: 'up', durationSec: 0.8,
    });
  });

  it('現在場面が極短なら D を場面尺 strict `<` で clamp＝1フレーム残す（書き出しと同じ・#547 P3-4）', () => {
    // 希望 5 だが cur=3 → D=3−ε（<3）。旧実装は 3 ちょうどで場面を丸ごと飲み込んでいた。
    const d = resolveBoundaryTransition([sc(8), sc(3, fade(5))], 1).durationSec;
    expect(d).toBeLessThan(3);
    expect(d).toBeCloseTo(3 - EPS, 6);
  });

  it('wipe/zoom は fade に丸める（resolveTransition と一致）', () => {
    expect(resolveBoundaryTransition([sc(8), sc(8, { in: 'zoom', durationSec: 0.5 })], 1).type).toBe('fade');
  });

  // #408 Part 2 レビュー P1：プレビューの実効 D は、書き出し（buildExportScenes）と同じ全場面 transitionTimeline を
  // 正準として解決する。直前場面が実効 D より短い（prev<D）3 場面でも「プレビュー=書き出し」であることを固定する
  // （2 場面近似 min(D,prev,cur) だと prev で過小になっていた）。
  describe('全場面 transitionTimeline を正準に＝プレビュー=書き出し（P1 パリティ）', () => {
    // 書き出しと同じ boundaryDs（none/先頭=0）を組んで期待値を作るヘルパ。
    const exportStepSec = (scenes: Scene[], i: number): number => {
      const durations = scenes.map((s) => s.durationSec);
      const boundaryDs = scenes.map((s, k) => (k === 0 ? 0 : resolveTransition(s.transition).type === 'none' ? 0 : resolveTransition(s.transition).durationSec));
      return transitionTimeline(durations, boundaryDs).steps[i - 1].durationSec;
    };

    it('直前が実効 D より短い場面でも一致（[5,4,6]・3 境界目 D=5＝書き出しは 5・2 場面近似の 4 ではない）', () => {
      const scenes = [sc(5), sc(4), sc(6, fade(5))];
      // 直前(4)<D(5) だが累積 acc=9 ゆえ書き出しは 5 秒。プレビューも 5 秒＝一致。
      expect(resolveBoundaryTransition(scenes, 2).durationSec).toBe(5);
      expect(resolveBoundaryTransition(scenes, 2).durationSec).toBe(exportStepSec(scenes, 2));
    });

    it('中間境界（none 挟み）でも全境界で書き出しと一致', () => {
      const scenes = [sc(5, fade(2)), sc(4, { in: 'none' }), sc(6, fade(3))];
      for (let i = 1; i < scenes.length; i += 1) {
        const r = resolveBoundaryTransition(scenes, i);
        const t = resolveTransition(scenes[i].transition);
        // none 境界は 0（プレビューしない）、それ以外は書き出しの step と同一。
        expect(r.durationSec).toBe(t.type === 'none' ? 0 : exportStepSec(scenes, i));
      }
    });
  });
});

// #553/#554・ADR-0026④：切り替えが場面尺以上だと、その場面は総尺に寄与しない（プレビューには出るのに書き出しでは
// 独立した尺を持たない＝preview≠export）。#553 で場面尺の下限（3秒）を撤廃するまでは構造的に到達不能だった
// （最短3秒 > 切り替え既定0.5秒）が、「0.3秒の場面＋フェード」が作れるようになったため警告で見せる。
describe('swallowedByTransitionSceneNumbers（切り替えに飲み込まれる場面・#553/#554）', () => {
  const sc = (durationSec: number, transition?: Scene['transition']): Scene =>
    ({ sceneId: 's', durationSec, transition } as unknown as Scene);

  it('切り替えが場面尺以上の場面を番号（1始まり）で返す', () => {
    const scenes = [sc(8), sc(0.3, { in: 'fade', out: 'fade', durationSec: 0.5 })];
    expect(swallowedByTransitionSceneNumbers(scenes)).toEqual([2]); // 0.3秒 < 0.5秒＝丸ごと飲まれる
  });

  it('実際に総尺へほぼ寄与しないことと一致する（transitionTimeline と同じ条件・#547 P3-4）', () => {
    const scenes = [sc(8), sc(0.4, { in: 'fade', out: 'fade', durationSec: 0.5 })];
    expect(swallowedByTransitionSceneNumbers(scenes)).toEqual([2]);
    // 実挙動：0.4秒の場面は strict clamp で最低1フレーム（ε）だけ残るが、それは実質不可視＝「飲み込まれた」警告の根拠。
    // 旧実装は total=8（丸ごと消滅）だったが、strict 化で total=8+ε（1フレーム寄与・FFmpeg xfade は壊れない）。
    expect(transitionTimeline([8, 0.4], [0, 0.5]).effectiveTotalSec).toBeCloseTo(8 + EPS, 6);
  });

  it('切り替えより長い場面は対象外（通常のケースはノイズを出さない）', () => {
    expect(swallowedByTransitionSceneNumbers([sc(8), sc(3, { in: 'fade', out: 'fade', durationSec: 0.5 })])).toEqual([]);
  });

  it('切り替えなし・先頭の場面は対象外（先頭に入場の切り替えは無い）', () => {
    expect(swallowedByTransitionSceneNumbers([sc(0.2), sc(5)])).toEqual([]); // 先頭が短くても飲まれない
    expect(swallowedByTransitionSceneNumbers([sc(8), sc(0.2, { in: 'none', out: 'none', durationSec: 0.5 })])).toEqual([]);
  });
});

// 入場と退場が時間で重ならない（#727）。片方ずつの上限しか見ていなかったので、
// `d_in + d_out ≤ 場面の尺` が保証されず、**既定の 0.5 秒のままでも尺 1.0 秒未満の場面すべて**で重なっていた。
describe('切り替えは場面の長さに収まる（#727）', () => {
  const EPS = 1 / FPS;
  const fadeT = (durationSec: number): Transition => ({ in: 'fade', durationSec });
  /**
   * 場面 i への入場の**希望**（先頭は 0）。⚠️ `resolveBoundaryTransition` は**クランプ後**を返すので
   * ここでは使えない（希望として渡し直すと、縮んだ値を希望とみなしてしまう）。
   */
  const wants = (scenes: Scene[]): number[] =>
    scenes.map((s, i) => {
      if (i === 0) return 0;
      const r = resolveTransition(s.transition);
      // ⚠️ 切り替え無しは **0 に落とす**（`resolveTransition` は種別が none でも既定の秒数を返す）。
      // 本番（`resolveBoundaryTransition`／`buildExportScenes`）と同じ組み方にしないと、
      // 切り替えの無い場面まで「両側にある」と数えてしまう。
      return r.type === 'none' ? 0 : r.durationSec;
    });

  it('両側に切り替えがある場面は、入場＋退場が尺に収まる', () => {
    const scenes = [sc(5), sc(0.8, fadeT(0.5)), sc(5, fadeT(0.5))];
    const { steps } = transitionTimeline(scenes.map((s) => s.durationSec), wants(scenes));
    const [inStep, outStep] = steps;
    // 以前は 0.5 + 0.5 = 1.0 秒で、0.8 秒の場面に入らず重なっていた（その場面は一度も完全に出ない）。
    expect(inStep.durationSec + outStep.durationSec).toBeLessThanOrEqual(0.8 - EPS + 1e-9);
    // **両側が同じ長さ**＝焼き出しても相手側とずれない（窓を共有しているため）。
    expect(inStep.durationSec).toBeCloseTo(outStep.durationSec, 10);
  });

  it('退場は入場の終わりより後から始まる（時間で重ならない）', () => {
    const scenes = [sc(5), sc(0.8, fadeT(0.5)), sc(5, fadeT(0.5))];
    const { steps } = transitionTimeline(scenes.map((s) => s.durationSec), wants(scenes));
    const inEnd = steps[0].offsetSec + steps[0].durationSec;
    expect(steps[1].offsetSec).toBeGreaterThanOrEqual(inEnd - 1e-9);
  });

  it('普通の長さの場面は今までどおり（希望どおりの切り替え）', () => {
    const scenes = [sc(5), sc(5, fadeT(0.5)), sc(5, fadeT(0.5))];
    const { steps } = transitionTimeline(scenes.map((s) => s.durationSec), wants(scenes));
    expect(steps.map((s) => s.durationSec)).toEqual([0.5, 0.5]);
  });

  it('片側だけの場面は縛らない（結合結果が長ければ1場面より長い切り替えも許す＝既存の意図）', () => {
    // `[5,4,6]` の3境界目に 5 秒＝場面2（尺4）は入場が無いので、その尺では縛らない。
    const scenes = [sc(5), sc(4), sc(6, fadeT(5))];
    const { steps } = transitionTimeline(scenes.map((s) => s.durationSec), wants(scenes));
    expect(steps[1].durationSec).toBe(5);
  });

  it('**プレビューと書き出しが同じ値**（対象場面の後ろにも切り替えがあるとき・#727 レビュー）', () => {
    // ⚠️ 既存のパリティのテストは**対象場面が常に末尾**だったので、この破れを構造的に素通りしていた。
    // 切り替えの上限が「その場面に退場があるか」にも依るので、後ろを切り落として回すと
    // プレビューだけ上限が効かない（実測＝書き出し 0.383 秒・プレビュー 0.5 秒）。
    const scenes = [sc(5), sc(0.8, fadeT(0.5)), sc(5, fadeT(0.5))];
    const { steps } = transitionTimeline(scenes.map((s) => s.durationSec), wants(scenes));
    scenes.forEach((_, i) => {
      if (i === 0) return;
      expect(resolveBoundaryTransition(scenes, i).durationSec).toBeCloseTo(steps[i - 1].durationSec, 10);
    });
  });

  it('短くなった場面を知らせる（挙げるのは**伸ばせば効く場面**だけ）', () => {
    const scenes = [sc(5), sc(0.8, fadeT(0.5)), sc(5, fadeT(0.5))];
    // 上限を握っているのは 0.8 秒の場面だけ＝そこを伸ばせば直る。両隣を機械的に出すと、
    // **伸ばしても効かない場面**（切り替えの欄すら無い先頭場面）まで案内の対象にしてしまう。
    expect(shortenedTransitionSceneNumbers(scenes)).toEqual([2]);
  });

  it('上限を握っていない側は挙げない（言われたとおりにしても直らない案内を出さない）', () => {
    // 場面1を 5→10 秒にしても、握っているのは場面2（0.8秒）の予算なので値は変わらない。
    expect(shortenedTransitionSceneNumbers([sc(10), sc(0.8, fadeT(0.5)), sc(5, fadeT(0.5))])).toEqual([2]);
  });

  it('**動画の頭が短くて切られたとき**も知らせる（上限は予算だけではない・#727 レビュー）', () => {
    // `[0.4, 0.8, 5]`＝1つ目の境界は「それまでの結合結果（0.4秒）」で頭打ちになり、
    // 予算（`(0.8−ε)/2`）とは一致しない＝予算だけを見ていると**この短縮を誰も知らせない**。
    const scenes = [sc(0.4), sc(0.8, fadeT(0.5)), sc(5, fadeT(0.5))];
    const { steps } = transitionTimeline(scenes.map((s) => s.durationSec), wants(scenes));
    expect(steps[0].durationSec).toBeCloseTo(0.4 - EPS, 10); // 結合結果で頭打ち
    expect(shortenedTransitionSceneNumbers(scenes)).toContain(1); // 伸ばす先＝それまでの場面
  });

  it('飲み込まれるだけの場面はここでは挙げない（そちらの警告の担当）', () => {
    // `[5, 0.3(fade 0.5)]`＝切り替えが尺以上。予算は握っていない（片側だけなので `Infinity`）。
    expect(shortenedTransitionSceneNumbers([sc(5), sc(0.3, fadeT(0.5))])).toEqual([]);
  });

  it('収まっているときは知らせない（余計な警告を出さない）', () => {
    expect(shortenedTransitionSceneNumbers([sc(5), sc(5, fadeT(0.5)), sc(5, fadeT(0.5))])).toEqual([]);
  });

  it('切り替えが無ければ何も言わない', () => {
    expect(shortenedTransitionSceneNumbers([sc(0.3), sc(0.3), sc(0.3)])).toEqual([]);
  });
});
