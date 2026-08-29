// 場面形式で「どの場面にクレジットを焼くか」（ADR-0025・#359・α-6 出口監査 ℹ️）。
//
// ⚠️ **直接のテストが無かった**＝間接（`buildExportScenes` / プレビュー）は厚いが、この関数自身の
// 境界（先頭・末尾・切り替えのぶん実尺が縮む）を固定していなかった。
import { describe, expect, it } from 'vitest';
import { sceneCreditVisibility } from './sceneCredit';
import { CREDIT_MODE } from '../voice/creditDisplay';
import type { Scene } from './types';

const scene = (durationSec: number, over: Partial<Scene> = {}): Scene =>
  ({ sceneId: `scene_${durationSec}`, durationSec, ...over }) as unknown as Scene;

const scenes = [scene(5), scene(5), scene(5)]; // 合計15秒（切り替えなし）

describe('sceneCreditVisibility', () => {
  it('ずっと出す＝全部の場面に出す', () => {
    expect(sceneCreditVisibility(scenes, { mode: CREDIT_MODE.always })).toEqual([true, true, true]);
  });

  /** ⚠️ **出さないは事業側の判断**（ADR-0025）＝About のクレジットは別で必ず出る。 */
  it('出さない＝どの場面にも出さない', () => {
    expect(sceneCreditVisibility(scenes, { mode: CREDIT_MODE.hidden })).toEqual([false, false, false]);
  });

  it('最初だけ＝先頭の窓に重なる場面だけ', () => {
    expect(sceneCreditVisibility(scenes, { mode: CREDIT_MODE.head, seconds: 3 })).toEqual([true, false, false]);
  });

  it('最後だけ＝末尾の窓に重なる場面だけ', () => {
    expect(sceneCreditVisibility(scenes, { mode: CREDIT_MODE.tail, seconds: 3 })).toEqual([false, false, true]);
  });

  it('最初と最後＝両端の場面', () => {
    expect(sceneCreditVisibility(scenes, { mode: CREDIT_MODE.both, seconds: 3 })).toEqual([true, false, true]);
  });

  /** ⚠️ **未指定は「最初と最後・3秒」**（ADR-0025 の利用者決定＝設定していない動画の見え方が変わらない）。 */
  it('未指定は「最初と最後」の既定になる', () => {
    expect(sceneCreditVisibility(scenes, undefined)).toEqual([true, false, true]);
  });

  /**
   * ⚠️ **窓は場面をまたぐ**＝1つの場面に収まらない秒数なら、重なる場面すべてに出す
   *（場面の途中では切り替えられないので**多め側**へ倒す＝`06 §15`）。
   */
  it('窓が長ければ、重なる場面すべてに出す', () => {
    expect(sceneCreditVisibility(scenes, { mode: CREDIT_MODE.head, seconds: 7 })).toEqual([true, true, false]);
  });

  it('場面が無ければ空を返す（数を合わせる）', () => {
    expect(sceneCreditVisibility([], { mode: CREDIT_MODE.both })).toEqual([]);
  });
});
