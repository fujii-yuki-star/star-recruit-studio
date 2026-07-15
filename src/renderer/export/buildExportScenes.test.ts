import { afterEach, describe, expect, it, vi } from 'vitest';

// canvas(ADR-0004) は Node テスト環境に無いため描画系をスタブ化し、音声付与の分岐のみを検証する。
vi.mock('../layout', () => ({ layoutScene: vi.fn(() => ({ items: [] })) }));
vi.mock('../sceneSvg', () => ({ layoutToSvg: vi.fn(() => '<svg/>') }));
vi.mock('./rasterize', () => ({ svgToPngDataUrl: vi.fn(async () => 'data:image/png;base64,PNG') }));
vi.mock('./videoSceneSplit', () => ({
  splitVideoSceneSvgMulti: vi.fn(() => ({
    belowSvg: '<below/>',
    midSvgs: [],
    aboveSvg: '<above/>',
    slots: [{ layerId: 'mainVisual', rect: { x: 80, y: 140, w: 1040, h: 800 } }],
  })),
}));

import type { ElementAnimation, Scene } from '../../domain/project/types';
import type { Template } from '../../domain/template/types';
import { FPS } from '../../domain/constants';
import { layoutScene } from '../layout';
import type { LayoutItem, SceneLayout } from '../layout';
import { layoutToSvg } from '../sceneSvg';
import { NARRATOR_CREDIT } from '../../domain/voice/narratorCredit';
import { svgToPngDataUrl } from './rasterize';
import { splitVideoSceneSvgMulti } from './videoSceneSplit';
import { buildExportScenes, ExportCancelledError } from './buildExportScenes';

// buildExportScenes が参照するのは templateId / durationSec / (narrationFor へ渡す scene) のみ。
// 見た目（テンプレ）未解決の場面は黙って落とさず停止する（Codex 監査 2026-07-13）ため、共有 fixture は解決可能な2場面のみ。
// 未解決の停止は下の専用テスト（「見た目が見つからない場面は停止」）で固定する。
const scenes = [
  { sceneId: 's1', templateId: 'tpl', durationSec: 8 },
  { sceneId: 's2', templateId: 'tpl', durationSec: 5 },
] as unknown as Scene[];

// canvas は svgToPngDataUrl への寸法渡しで参照されるため最小限だけ持たせる。
const templateById = new Map<string, Template>([
  ['tpl', { canvas: { width: 1920, height: 1080 } } as Template],
]);
const noAsset = async () => undefined;

describe('buildExportScenes：ナレーション音声の付与', () => {
  it('音声ありの場面は audioBase64 / narrationVolume を含む', async () => {
    const out = await buildExportScenes(scenes, templateById, noAsset, (s) =>
      s.sceneId === 's1'
        ? { audioBase64: 'data:audio/wav;base64,AAAA', narrationVolume: 0.5 }
        : { narrationVolume: 1.0 },
    );
    expect(out).toHaveLength(2); // 解決可能な2場面
    expect(out[0]).toMatchObject({
      pngBase64: 'data:image/png;base64,PNG',
      durationSec: 8,
      audioBase64: 'data:audio/wav;base64,AAAA',
      narrationVolume: 0.5,
    });
  });

  it('音声なしの場面は audioBase64 が undefined（音量は解決済み値）', async () => {
    const out = await buildExportScenes(scenes, templateById, noAsset, (s) =>
      s.sceneId === 's1'
        ? { audioBase64: 'data:audio/wav;base64,AAAA', narrationVolume: 0.5 }
        : { narrationVolume: 1.0 },
    );
    expect(out[1].audioBase64).toBeUndefined();
    expect(out[1].narrationVolume).toBe(1.0);
  });

  it('コールバックが undefined を返した場面は音声フィールドを付けない', async () => {
    const out = await buildExportScenes(scenes, templateById, noAsset, () => undefined);
    expect(out[0].audioBase64).toBeUndefined();
    expect(out[0].narrationVolume).toBeUndefined();
  });

  it('narrationFor 自体を渡さなければ音声フィールドは付かない', async () => {
    const out = await buildExportScenes(scenes, templateById, noAsset);
    expect(out[0].audioBase64).toBeUndefined();
    expect(out[0].narrationVolume).toBeUndefined();
    expect(out).toHaveLength(2);
  });

  it('見た目（テンプレ）が見つからない場面は黙って落とさず停止（§2-5・Codex 監査 2026-07-13・#434 同流儀）', async () => {
    // templateId 未解決の場面を書き出しから silent skip すると場面が MP4 から消えテロップ/BGM もズレるため停止する。
    // 旧挙動（skip して out から除外）を「停止」に変更＝該当場面つきの利用者向け文言で reject。
    await expect(
      buildExportScenes(
        [
          { sceneId: 's1', templateId: 'tpl', durationSec: 8 },
          { sceneId: 'sX', templateId: 'missing', durationSec: 4 }, // 見た目が見つからない場面
        ] as unknown as Scene[],
        templateById,
        noAsset,
        () => ({ narrationVolume: 1 }),
      ),
    ).rejects.toThrow(/場面2の見た目が見つかりませんでした/);
  });

  it('掛け合い（明示 lines）は行ごとセグメントへ展開し、行ごと音声・区間尺を付与（PR-E）', async () => {
    const multi = {
      sceneId: 's1', templateId: 'tpl', durationSec: 8,
      lines: [
        { lineId: 'line_001', text: 'やあ', startSec: 0, status: 'none' },
        { lineId: 'line_002', text: 'どうも', startSec: 4, status: 'none' },
      ],
    } as unknown as Scene;
    const out = await buildExportScenes([multi], templateById, noAsset, (_s, lineId) => ({
      audioBase64: lineId ? `AUDIO_${lineId}` : undefined,
      narrationVolume: 1,
    }));
    expect(out).toHaveLength(2); // 1場面 → 2セグメント
    expect(out.map((o) => o.durationSec)).toEqual([4, 4]); // [0,4],[4,8]
    expect(out.map((o) => o.audioBase64)).toEqual(['AUDIO_line_001', 'AUDIO_line_002']);
  });

  it('同時開始（startWithPrevious・非動画）は1グループ=1セグメント＝primary は audioBase64・同時行は narrationSegments へ（ADR-0031）', async () => {
    const dual = {
      sceneId: 's1', templateId: 'tpl', durationSec: 8,
      lines: [
        { lineId: 'line_001', text: 'A', status: 'none' },
        { lineId: 'line_002', text: 'B', startWithPrevious: true, status: 'none' }, // line_001 と同時
      ],
    } as unknown as Scene;
    const out = await buildExportScenes([dual], templateById, noAsset, (_s, lineId) => ({
      audioBase64: lineId ? `AUDIO_${lineId}` : undefined,
      narrationVolume: 1,
    }));
    expect(out).toHaveLength(1); // 同時グループは逐次の2つに割らず1セグメント
    expect(out[0].durationSec).toBe(8);
    expect(out[0].audioBase64).toBe('AUDIO_line_001'); // primary（アンカー）
    // 同時行は並行ナレーション＝Rust が amix（delaySec=0＝この区間の頭から・windowSec=区間尺）。
    expect(out[0].narrationSegments).toEqual([{ audioBase64: 'AUDIO_line_002', delaySec: 0, windowSec: 8 }]);
  });

  it('逐次（startWithPrevious なし）は narrationSegments を付けない＝従来どおり行ごとに割る（後方互換）', async () => {
    const seq = {
      sceneId: 's1', templateId: 'tpl', durationSec: 8,
      lines: [
        { lineId: 'line_001', text: 'A', startSec: 0, status: 'none' },
        { lineId: 'line_002', text: 'B', startSec: 4, status: 'none' },
      ],
    } as unknown as Scene;
    const out = await buildExportScenes([seq], templateById, noAsset, (_s, lineId) => ({
      audioBase64: lineId ? `AUDIO_${lineId}` : undefined,
      narrationVolume: 1,
    }));
    expect(out).toHaveLength(2);
    expect(out.every((o) => o.narrationSegments === undefined)).toBe(true); // 並行なし
  });

  it('掛け合い（静止画）で先頭行が途中開始なら先頭に「間」区間（音声なし・場面尺を保つ）が入る（#386・A案）', async () => {
    const gapScene = {
      sceneId: 's1', templateId: 'tpl', durationSec: 10,
      lines: [
        { lineId: 'line_001', text: 'やあ', startSec: 2, status: 'none' },
        { lineId: 'line_002', text: 'どうも', startSec: 6, status: 'none' },
      ],
    } as unknown as Scene;
    const out = await buildExportScenes([gapScene], templateById, noAsset, (_s, lineId) => ({
      audioBase64: lineId ? `AUDIO_${lineId}` : undefined,
      narrationVolume: 1,
    }));
    expect(out).toHaveLength(3); // 間 + 2行
    expect(out.map((o) => o.durationSec)).toEqual([2, 4, 4]); // [0,2)間, [2,6), [6,10]
    expect(out.map((o) => o.audioBase64)).toEqual([undefined, 'AUDIO_line_001', 'AUDIO_line_002']); // 間は音声なし
    expect(out.reduce((s, o) => s + o.durationSec, 0)).toBe(10); // 合計＝場面尺（間を尊重＝短縮しない）
  });

  it('単一 narration の場面は従来どおり1場面=1セグメント（後方互換）', async () => {
    const out = await buildExportScenes(scenes, templateById, noAsset, (s) => ({
      audioBase64: s.sceneId === 's1' ? 'A1' : undefined,
      narrationVolume: 1,
    }));
    expect(out).toHaveLength(2); // s1,s2（ともに解決可能）
    expect(out[0]).toMatchObject({ durationSec: 8, audioBase64: 'A1' });
  });
});

describe('buildExportScenes：キーフレームアニメ（④・ADR-0019 per-frame）', () => {
  const anim = (sceneId: string): ElementAnimation =>
    ({ id: 'anim_001', sceneId, targetId: 'el1', keyframes: [{ timeSec: 0, opacity: 0 }, { timeSec: 1, opacity: 1 }] } as unknown as ElementAnimation);
  const animScene = [{ sceneId: 's1', templateId: 'tpl', durationSec: 2 }] as unknown as Scene[];

  it('アニメのある場面（掛け合い/動画スロットなし）はフレーム列＋fpsを持ち、単一PNGは付かない', async () => {
    const out = await buildExportScenes(
      animScene, templateById, noAsset,
      () => ({ narrationVolume: 1 }),
      undefined, undefined, {},
      (s) => [anim(s.sceneId)],
    );
    expect(out).toHaveLength(1);
    expect(out[0].pngBase64).toBeUndefined(); // アニメ場面は単一PNGなし
    expect(out[0].fps).toBe(FPS);
    // #376：アニメは animEnd=1 秒で終わる（keyframes [0,1]）→ [0,1] だけ焼く（ceil+1 で settled 到達）。
    // 場面尺は2秒だが残り [1,2] は Rust の tpad が最終フレームを保持するので焼かない。
    expect(out[0].framesBase64).toHaveLength(Math.ceil(1 * FPS) + 1);
    expect(out[0].framesBase64?.[0]).toBe('data:image/png;base64,PNG');
    expect(out[0].durationSec).toBe(2); // 尺は場面のまま（保持はエンコード側）
    expect(out[0].narrationVolume).toBe(1);
  });

  it('アニメ場面はフレーム進捗（frameFraction）を通知＝進捗バーが凍らない（#391）', async () => {
    const calls: Array<[number, number, number | undefined]> = [];
    await buildExportScenes(
      animScene, templateById, noAsset,
      () => ({ narrationVolume: 1 }),
      undefined,
      (done, total, frameFraction) => calls.push([done, total, frameFraction]),
      {},
      (s) => [anim(s.sceneId)],
    );
    // per-frame 中に「処理中の場面0・フレーム途中（0<frac<=1）」を通知＝アニメ場面でもバーが動く。
    const frameCalls = calls.filter(([d, , f]) => d === 0 && typeof f === 'number');
    expect(frameCalls.length).toBeGreaterThan(0);
    expect(frameCalls.every(([, , f]) => (f as number) > 0 && (f as number) <= 1)).toBe(true);
    // 場面完了の通知（done=1・frameFraction 無し）は従来どおり残る。
    expect(calls.some(([d, t, f]) => d === 1 && t === 1 && f === undefined)).toBe(true);
  });

  it('掛け合い×アニメ（複数セグメント）でも進捗（done+frameFraction）は後退しない＝バーが巻き戻らない（#391 レビュー P1）', async () => {
    // 場面全体にかかるアニメ（keyframes [0,4]）＋2行（startSec 0/2・尺4）＝どちらの区間も複数フレームを焼く。
    // 掛け合いは per-frame ループが「間/行」セグメントごとに回るため、frameFraction を区間内比 (f+1)/frameCount で
    // 出すと区間1の先頭で 1.0→~0 に戻り、(done+frameFraction)/total が 80%→1% に後退していた（#391 レビュー P1）。
    // 修正（segIndex を足して場面全体で単調化）後は後退しないことを、進捗バーの本質的な不変条件＝単調非減少で検証する。
    const spanAnim = (sceneId: string): ElementAnimation =>
      ({ id: 'anim_001', sceneId, targetId: 'el1', keyframes: [{ timeSec: 0, opacity: 0 }, { timeSec: 4, opacity: 1 }] } as unknown as ElementAnimation);
    const dialogueAnimScene = [{
      sceneId: 's1', templateId: 'tpl', durationSec: 4,
      lines: [
        { lineId: 'line_001', text: 'a', startSec: 0, status: 'none' },
        { lineId: 'line_002', text: 'b', startSec: 2, status: 'none' },
      ],
    }] as unknown as Scene[];
    const bars: number[] = [];
    await buildExportScenes(
      dialogueAnimScene, templateById, noAsset,
      (_s, lineId) => ({ audioBase64: lineId ? `A_${lineId}` : undefined, narrationVolume: 1 }),
      undefined,
      // ExportScreen と同じ式でバー値を復元（done は完了場面数・frameFraction は処理中場面内の比）。
      (done, total, frameFraction) => bars.push((done + (frameFraction ?? 0)) / total),
      {},
      (s) => [spanAnim(s.sceneId)],
    );
    // 2区間×複数フレーム＋場面完了で3回以上通知される。
    expect(bars.length).toBeGreaterThan(2);
    // 進捗バーの不変条件は「値域」ではなく「後退しない（単調非減少）」＝区間境界で 1.0→0 に戻らないこと。
    expect(bars.every((b, idx) => idx === 0 || b >= bars[idx - 1] - 1e-9)).toBe(true);
    // 区間内の途中フレームでも動いている（0<b<1 が存在＝バーが凍らない）。
    expect(bars.some((b) => b > 0 && b < 1)).toBe(true);
  });

  it('stageAnimationFrame 指定時はフレームを逐次ステージングし framesDir を返す（framesBase64 は載せない・#書き出しRangeError）', async () => {
    const staged: Array<{ dir: string; index: number; url: string }> = [];
    const out = await buildExportScenes(
      animScene, templateById, noAsset,
      () => ({ narrationVolume: 1 }),
      undefined, undefined, {},
      (s) => [anim(s.sceneId)],
      async (framesDir, frameIndex, dataUrl) => { staged.push({ dir: framesDir, index: frameIndex, url: dataUrl }); },
    );
    expect(out[0].framesBase64).toBeUndefined(); // 巨大な base64 配列を IPC に載せない
    expect(out[0].framesDir).toBe('scene_frames_0_0'); // 場面 index_区間 index 由来の相対名
    expect(out[0].fps).toBe(FPS);
    expect(staged).toHaveLength(Math.ceil(1 * FPS) + 1); // #376：変化区間[0,1]だけ逐次ディスクへ
    expect(staged[0]).toEqual({ dir: 'scene_frames_0_0', index: 0, url: 'data:image/png;base64,PNG' });
  });

  it('掛け合い（lines）併用のアニメは行セグメントごとにフレーム列を焼く（③・書き出し=プレビュー）', async () => {
    const multi = [{
      sceneId: 's1', templateId: 'tpl', durationSec: 8,
      lines: [
        { lineId: 'line_001', text: 'a', startSec: 0, status: 'none' },
        { lineId: 'line_002', text: 'b', startSec: 4, status: 'none' },
      ],
    }] as unknown as Scene[];
    const out = await buildExportScenes(
      multi, templateById, noAsset,
      (_s, lineId) => ({ audioBase64: lineId ? `A_${lineId}` : undefined, narrationVolume: 1 }),
      undefined, undefined, {},
      (s) => [anim(s.sceneId)],
    );
    expect(out).toHaveLength(2); // 行ごとのセグメント
    // 各セグメントがフレーム列（アニメ）＋行ごとの音声を持つ（静止PNGにはならない）。
    expect(out.every((o) => (o.framesBase64?.length ?? 0) > 0)).toBe(true);
    expect(out.every((o) => o.pngBase64 === undefined)).toBe(true);
    expect(out[0].audioBase64).toBe('A_line_001');
    expect(out[1].audioBase64).toBe('A_line_002');
  });

  it('掛け合い×アニメは各行区間の開始秒(startSec)を timeSec 起点にフレームを焼く（2行目がアニメ頭から再生し直さない・③レビュー）', async () => {
    const multi = [{
      sceneId: 's1', templateId: 'tpl', durationSec: 8,
      lines: [
        { lineId: 'line_001', text: 'a', startSec: 0, status: 'none' },
        { lineId: 'line_002', text: 'b', startSec: 4, status: 'none' },
      ],
    }] as unknown as Scene[];
    vi.mocked(layoutScene).mockClear();
    await buildExportScenes(
      multi, templateById, noAsset,
      (_s, lineId) => ({ audioBase64: lineId ? `A_${lineId}` : undefined, narrationVolume: 1 }),
      undefined, undefined, {},
      (s) => [anim(s.sceneId)],
    );
    // フレーム描画呼び出しの timeSec（layoutScene(scene, template, opts) の第3引数）を集める。
    const timeSecs = vi.mocked(layoutScene).mock.calls
      .map((c) => c[2]?.timeSec)
      .filter((t): t is number => typeof t === 'number');
    // 区間0(line_001,[0,4]) は 0 起点、区間1(line_002,[4,8]) は 4 起点でフレームを焼く。
    expect(timeSecs).toContain(0); // 1行目の先頭フレーム
    expect(timeSecs).toContain(4); // 2行目の先頭フレーム＝startSec オフセットが効いている（offset 0 のデグレなら 4 は現れない）
    // #376：アニメは animEnd=1 で終わるため区間1[4,8]は全て静止＝settled 1枚を startSec(=4) で焼くだけ。
    // よって最大 timeSec は 4（区間0の頭[0,1]と区間1の settled=4）。offset 0 のデグレなら 4 が出ず max<4 になる。
    expect(Math.max(...timeSecs)).toBe(4);
  });

  it('アニメが頭だけの長い場面は「変化する区間」だけ焼く＝フレーム数を激減（#376高速化）', async () => {
    // animEnd=1（keyframes [0,1]）・durationSec=10 → 従来 300 枚 → 最適化後 31 枚（[0,1]＋settled）。
    // 残り [1,10] は Rust の tpad=stop_mode=clone が最終フレームを保持するので焼かない。
    const longScene = [{ sceneId: 's1', templateId: 'tpl', durationSec: 10 }] as unknown as Scene[];
    const out = await buildExportScenes(
      longScene, templateById, noAsset,
      () => ({ narrationVolume: 1 }),
      undefined, undefined, {},
      (s) => [anim(s.sceneId)],
    );
    expect(out[0].framesBase64).toHaveLength(Math.ceil(1 * FPS) + 1); // 31 枚（≪ 従来 300 枚）
    expect(out[0].durationSec).toBe(10); // 尺は場面のまま（保持はエンコード側 tpad）
    expect(out[0].fps).toBe(FPS);
  });

  it('animEnd がフレーム格子に乗らなくても最終フレームが settled(animEnd 以上)に到達（#376レビュー・切り上げ）', async () => {
    // animEnd=0.816（0.816*30=24.48）。round だと最終フレーム=24/30=0.8<0.816 で未収束のまま tpad 保持され
    // パリティが崩れる。ceil なら 25/30=0.833>=0.816＝settled 到達（interpolateKeyframes のクランプ条件を満たす）。
    const animOffGrid = (sceneId: string): ElementAnimation =>
      ({ id: 'a', sceneId, targetId: 'el1', keyframes: [{ timeSec: 0, opacity: 0 }, { timeSec: 0.816, opacity: 1 }] } as unknown as ElementAnimation);
    const scene = [{ sceneId: 's1', templateId: 'tpl', durationSec: 5 }] as unknown as Scene[];
    vi.mocked(layoutScene).mockClear();
    const out = await buildExportScenes(
      scene, templateById, noAsset,
      () => ({ narrationVolume: 1 }),
      undefined, undefined, {},
      (s) => [animOffGrid(s.sceneId)],
    );
    const timeSecs = vi.mocked(layoutScene).mock.calls
      .map((c) => c[2]?.timeSec)
      .filter((t): t is number => typeof t === 'number');
    // 最終描画フレームは animEnd(0.816) 以上（settled）＝tpad 保持フレームがプレビュー静止と一致（round なら 0.8<0.816 で落ちる）。
    expect(Math.max(...timeSecs)).toBeGreaterThanOrEqual(0.816);
    // フレーム数は ceil(0.816*30)+1 = 26。
    expect(out[0].framesBase64).toHaveLength(Math.ceil(0.816 * FPS) + 1);
  });

  it('動画スロット併用のアニメ（非掛け合い）は下/中/上の静止層を per-frame ステージングして video 経路で焼く（#435 P1）', async () => {
    const staged: Array<{ dir: string; index: number }> = [];
    const out = await buildExportScenes(
      [{ sceneId: 's1', templateId: 'tpl', durationSec: 8 }] as unknown as Scene[],
      templateById, noAsset,
      () => ({ narrationVolume: 1 }),
      () => [{ slotLayerId: 'mainVisual', clipRelPath: 'assets/v.mp4', fit: 'cover' as const, clipStartSec: 0, useOriginalAudio: false, speed: 1 }],
      undefined, {},
      (s) => [anim(s.sceneId)],
      async (dir, index) => { staged.push({ dir, index }); }, // stageAnimationFrame を渡す
    );
    // 場面自体はフレーム列にしない（video 経路）。下/上層を per-frame でステージング（mock は単一動画＝中間層なし）。
    expect(out[0].framesBase64).toBeUndefined();
    expect(out[0].video?.belowFramesDir).toBe('scene_vbelow_0');
    expect(out[0].video?.aboveFramesDir).toBe('scene_vabove_0');
    expect(out[0].video?.midFramesDirs).toEqual([]); // 単一動画＝中間層なし
    expect(out[0].video?.aboveFramesFps).toBe(FPS);
    expect(out[0].video?.belowPngBase64).toBeUndefined(); // per-frame は静止層PNGを送らない
    expect(out[0].video?.abovePngBase64).toBeUndefined();
    // 各フレームで below+above をステージング（mid 0枚）＝(ceil(1*fps)+1)×2。
    const frames = Math.ceil(1 * FPS) + 1;
    expect(staged.length).toBe(frames * 2);
    expect(staged.filter((s) => s.dir === 'scene_vbelow_0').length).toBe(frames);
    expect(staged.filter((s) => s.dir === 'scene_vabove_0').length).toBe(frames);
  });

  it('動画スロット併用のアニメでもステージング不可なら静止層にフォールバック（#435）', async () => {
    const out = await buildExportScenes(
      [{ sceneId: 's1', templateId: 'tpl', durationSec: 8 }] as unknown as Scene[],
      templateById, noAsset,
      () => ({ narrationVolume: 1 }),
      () => [{ slotLayerId: 'mainVisual', clipRelPath: 'assets/v.mp4', fit: 'cover' as const, clipStartSec: 0, useOriginalAudio: false, speed: 1 }],
      undefined, {},
      (s) => [anim(s.sceneId)],
      // stageAnimationFrame なし
    );
    expect(out[0].video?.belowFramesDir).toBeUndefined();
    expect(out[0].video?.aboveFramesDir).toBeUndefined();
    expect(out[0].video?.belowPngBase64).toBe('data:image/png;base64,PNG'); // 静止 below
    expect(out[0].video?.abovePngBase64).toBe('data:image/png;base64,PNG'); // 静止 above
  });

  it('animationsFor が空配列を返す場面は従来どおり単一PNG（後方互換）', async () => {
    const out = await buildExportScenes(
      animScene, templateById, noAsset,
      undefined, undefined, undefined, {},
      () => [],
    );
    expect(out[0].framesBase64).toBeUndefined();
    expect(out[0].pngBase64).toBe('data:image/png;base64,PNG');
  });

  it('animationsFor 未指定なら従来どおり単一PNG（後方互換）', async () => {
    const out = await buildExportScenes(animScene, templateById, noAsset);
    expect(out[0].framesBase64).toBeUndefined();
    expect(out[0].pngBase64).toBe('data:image/png;base64,PNG');
  });
});

describe('buildExportScenes：動画シーン（ADR-0006）', () => {
  it('動画スロットがある場面は video（下/上PNG＋クリップ情報）を持ち、単一PNGは付かない', async () => {
    const out = await buildExportScenes(
      [{ sceneId: 's1', templateId: 'tpl', durationSec: 8 }] as unknown as Scene[],
      templateById,
      noAsset,
      () => ({ narrationVolume: 1.0 }),
      () => [{
        slotLayerId: 'mainVisual',
        clipRelPath: 'assets/v.mp4',
        fit: 'cover' as const,
        clipStartSec: 0,
        useOriginalAudio: false,
        speed: 1,
      }],
    );
    expect(out).toHaveLength(1);
    expect(out[0].pngBase64).toBeUndefined(); // 動画シーンは単一PNGなし
    expect(out[0].narrationVolume).toBe(1.0);
    expect(out[0].video).toMatchObject({
      belowPngBase64: 'data:image/png;base64,PNG',
      abovePngBase64: 'data:image/png;base64,PNG',
      clipRelPath: 'assets/v.mp4',
      slotX: 80,
      slotY: 140,
      slotW: 1040,
      slotH: 800,
      fit: 'cover',
      clipStartSec: 0,
      useOriginalAudio: false,
    });
  });

  it('opts.credit を渡すと splitVideoSceneSvgMulti の credit 引数（6番目）に反映（#177・動画シーン）', async () => {
    vi.mocked(splitVideoSceneSvgMulti).mockClear();
    await buildExportScenes(
      [{ sceneId: 's1', templateId: 'tpl', durationSec: 8 }] as unknown as Scene[],
      templateById,
      noAsset,
      undefined,
      () => [{ slotLayerId: 'mainVisual', clipRelPath: 'assets/v.mp4', fit: 'cover' as const, clipStartSec: 0, useOriginalAudio: false, speed: 1 }],
      undefined,
      { credit: 'VOICEVOX:四国めたん' },
    );
    expect(vi.mocked(splitVideoSceneSvgMulti).mock.calls[0]?.[5]).toBe('VOICEVOX:四国めたん');
  });

  it('動画スロットがあるのに分割できない場面は静かに静止画化せず停止（§2-5 エラー・#434）', async () => {
    // 分割失敗（穴を切り出せない＝内部不整合やスロット/グループ非表示）を模す。黙って静止画化せず場面つきで停止。
    vi.mocked(splitVideoSceneSvgMulti).mockReturnValueOnce(null);
    await expect(
      buildExportScenes(
        [{ sceneId: 's1', templateId: 'tpl', durationSec: 8 }] as unknown as Scene[],
        templateById,
        noAsset,
        () => ({ narrationVolume: 1 }),
        () => [{ slotLayerId: 'mainVisual', clipRelPath: 'assets/v.mp4', fit: 'cover' as const, clipStartSec: 0, useOriginalAudio: false, speed: 1 }],
      ),
    ).rejects.toThrow(/場面1の動画を配置できませんでした/);
  });

  it('videoSlotFor 未指定なら従来どおり単一PNG（video なし）', async () => {
    const out = await buildExportScenes(
      [{ sceneId: 's1', templateId: 'tpl', durationSec: 8 }] as unknown as Scene[],
      templateById,
      noAsset,
    );
    expect(out[0].pngBase64).toBe('data:image/png;base64,PNG');
    expect(out[0].video).toBeUndefined();
  });

  it('複数動画スロットは先頭を従来フィールド、2本目以降を videoLayers、間を midLayers に持つ（#431）', async () => {
    // 分割は 2 スロット（slotA=最下, slotB）＋中間静止層1枚を返すよう上書き。
    vi.mocked(splitVideoSceneSvgMulti).mockReturnValueOnce({
      belowSvg: '<below/>',
      midSvgs: ['<mid/>'],
      aboveSvg: '<above/>',
      slots: [
        { layerId: 'slotA', rect: { x: 0, y: 0, w: 100, h: 100 } },
        { layerId: 'slotB', rect: { x: 200, y: 100, w: 400, h: 300 } },
      ],
    });
    const out = await buildExportScenes(
      [{ sceneId: 's1', templateId: 'tpl', durationSec: 8 }] as unknown as Scene[],
      templateById,
      noAsset,
      () => ({ narrationVolume: 1 }),
      () => [
        { slotLayerId: 'slotA', clipRelPath: 'assets/a.mp4', fit: 'cover' as const, clipStartSec: 0, useOriginalAudio: false, speed: 1 },
        { slotLayerId: 'slotB', clipRelPath: 'assets/b.mp4', fit: 'contain' as const, clipStartSec: 0, useOriginalAudio: true, originalVolume: 0.3, speed: 1 },
      ],
    );
    const v = out[0].video!;
    // 先頭（zIndex 最下）= slotA が従来フィールド。
    expect(v.clipRelPath).toBe('assets/a.mp4');
    expect(v).toMatchObject({ slotX: 0, slotY: 0, slotW: 100, slotH: 100, fit: 'cover' });
    // 中間静止層1枚（PNG化）。
    expect(v.midLayers).toEqual(['data:image/png;base64,PNG']);
    // 2本目 = slotB は videoLayers[0]（矩形＋クリップ設定）。
    expect(v.videoLayers).toHaveLength(1);
    expect(v.videoLayers?.[0]).toMatchObject({
      clipRelPath: 'assets/b.mp4',
      slotX: 200, slotY: 100, slotW: 400, slotH: 300,
      fit: 'contain', useOriginalAudio: true, originalVolume: 0.3,
    });
  });
});

describe('buildExportScenes：動画スロット本体アニメ（#442・窓Frames＋settled Video の2段）', () => {
  // スロット層（mock の 'mainVisual'）を対象にするアニメ＝slotIsAnimated=true。
  const slotAnim = (sceneId: string, endSec = 1): ElementAnimation =>
    ({ id: 'a', sceneId, targetId: 'mainVisual', keyframes: [{ timeSec: 0, x: -200 }, { timeSec: endSec, x: 0 }] } as unknown as ElementAnimation);
  const videoSlot = () => [{
    slotLayerId: 'mainVisual', clipRelPath: 'assets/v.mp4', fit: 'cover' as const,
    clipStartSec: 0, useOriginalAudio: false, speed: 1,
  }];
  // 1秒 mono PCM16 の合成 WAV（ナレーション分割の配線確認用）。
  const makeWav = (sampleRate: number, frames: number): string => {
    const dataSize = frames * 2;
    const bytes = new Uint8Array(44 + dataSize);
    const view = new DataView(bytes.buffer);
    const tag = (off: number, s: string) => { for (let i = 0; i < 4; i += 1) bytes[off + i] = s.charCodeAt(i); };
    tag(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); tag(8, 'WAVE');
    tag(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    tag(36, 'data'); view.setUint32(40, dataSize, true);
    for (let i = 0; i < frames; i += 1) view.setUint16(44 + i * 2, i & 0xffff, true);
    let bin = ''; for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
    return `data:audio/wav;base64,${btoa(bin)}`;
  };

  it('スロット本体がアニメ対象なら窓(Frames)＋settled(Video) の2セグメントに分ける', async () => {
    const staged: Array<{ dir: string; index: number }> = [];
    const out = await buildExportScenes(
      [{ sceneId: 's1', templateId: 'tpl', durationSec: 8 }] as unknown as Scene[],
      templateById, noAsset,
      () => ({ narrationVolume: 1 }),
      videoSlot, undefined, {},
      (s) => [slotAnim(s.sceneId, 1)], // animEnd=1 < 尺8 → 窓[0,1]＋settled[1,8]
      async (dir, index) => { staged.push({ dir, index }); },
    );
    expect(out).toHaveLength(2);
    // (1) 窓：スロットもサムネで焼く Frames セグメント（video 無し・framesDir・尺=W=1・場面先頭）。
    expect(out[0].video).toBeUndefined();
    expect(out[0].framesDir).toBe('scene_vbody_0');
    expect(out[0].fps).toBe(FPS);
    expect(out[0].durationSec).toBe(1);
    expect(out[0].sceneStart).toBe(true);
    // (2) settled：実動画を最終位置で流す Video セグメント（尺=7・場面の後続）。
    expect(out[1].framesDir).toBeUndefined();
    expect(out[1].video).toMatchObject({
      belowPngBase64: 'data:image/png;base64,PNG',
      abovePngBase64: 'data:image/png;base64,PNG',
      clipRelPath: 'assets/v.mp4',
      slotX: 80, slotY: 140, slotW: 1040, slotH: 800,
    });
    expect(out[1].durationSec).toBe(7);
    expect(out[1].sceneStart).toBe(false);
    // 窓フレーム＝ceil(1*fps)+1、すべて scene_vbody_0 に。
    expect(staged.filter((s) => s.dir === 'scene_vbody_0').length).toBe(Math.ceil(1 * FPS) + 1);
  });

  it('アニメが全尺（animEnd>=尺）なら窓のみ＝settled（実動画）は出さない', async () => {
    const out = await buildExportScenes(
      [{ sceneId: 's1', templateId: 'tpl', durationSec: 2 }] as unknown as Scene[],
      templateById, noAsset,
      () => ({ narrationVolume: 1 }),
      videoSlot, undefined, {},
      (s) => [slotAnim(s.sceneId, 3)], // animEnd=3 >= 尺2 → 窓=全尺
      async () => {},
    );
    expect(out).toHaveLength(1);
    expect(out[0].framesDir).toBe('scene_vbody_0');
    expect(out[0].durationSec).toBe(2);
    expect(out[0].video).toBeUndefined();
  });

  it('グループ経由でスロットがアニメ対象でも2段に分ける', async () => {
    const scene = [{
      sceneId: 's1', templateId: 'tpl', durationSec: 6,
      groups: [{ id: 'group_1', members: ['mainVisual', 'text_1'] }],
    }] as unknown as Scene[];
    const groupAnim = ({ id: 'a', sceneId: 's1', targetId: 'group_1', keyframes: [{ timeSec: 0, y: -100 }, { timeSec: 0.5, y: 0 }] } as unknown as ElementAnimation);
    const out = await buildExportScenes(
      scene, templateById, noAsset,
      () => ({ narrationVolume: 1 }),
      videoSlot, undefined, {},
      () => [groupAnim],
      async () => {},
    );
    expect(out).toHaveLength(2);
    expect(out[0].framesDir).toBe('scene_vbody_0');
    expect(out[1].video).toBeDefined();
  });

  it('スロット以外だけを動かすアニメは2段にしない（#435 の per-frame 静止層経路のまま）', async () => {
    const out = await buildExportScenes(
      [{ sceneId: 's1', templateId: 'tpl', durationSec: 8 }] as unknown as Scene[],
      templateById, noAsset,
      () => ({ narrationVolume: 1 }),
      videoSlot, undefined, {},
      (s) => [({ id: 'a', sceneId: s.sceneId, targetId: 'text_1', keyframes: [{ timeSec: 0, x: -50 }, { timeSec: 1, x: 0 }] } as unknown as ElementAnimation)],
      async () => {},
    );
    // 動画は固定＝#435 の per-frame 静止層（belowFramesDir）で1セグメントのまま。
    expect(out).toHaveLength(1);
    expect(out[0].video?.belowFramesDir).toBe('scene_vbelow_0');
    expect(out[0].framesDir).toBeUndefined();
  });

  it('ナレーションは窓[0,W]と settled[W,尺]にサンプル分割されて両区間に載る', async () => {
    const wav = makeWav(8000, 8000); // 1.0 秒
    const out = await buildExportScenes(
      [{ sceneId: 's1', templateId: 'tpl', durationSec: 8 }] as unknown as Scene[],
      templateById, noAsset,
      () => ({ audioBase64: wav, narrationVolume: 1 }),
      videoSlot, undefined, {},
      (s) => [slotAnim(s.sceneId, 0.5)], // 窓[0,0.5]＋settled[0.5,8]
      async () => {},
    );
    expect(out).toHaveLength(2);
    // 両区間とも音声を持ち、互いに異なる（＝別区間に切られている）＝連続再生。
    expect(out[0].audioBase64).toBeDefined();
    expect(out[1].audioBase64).toBeDefined();
    expect(out[0].audioBase64).not.toBe(out[1].audioBase64);
    expect(out[0].audioBase64).not.toBe(wav); // 窓は [0,0.5] に切られている
  });

  // 実フレーム経路は base layout にスロット item が要る（assetId→抽出フレーム対応）。テスト後は既定 mock へ戻す。
  const slotLayout = { items: [{ id: 'mainVisual', kind: 'image', role: 'slot', assetId: 'asset_v1', x: 0, y: 0, w: 100, h: 100, zIndex: 1 }] } as unknown as SceneLayout;
  afterEach(() => {
    vi.mocked(layoutScene).mockReturnValue({ items: [] } as unknown as SceneLayout);
    vi.mocked(splitVideoSceneSvgMulti).mockReturnValue({
      belowSvg: '<below/>', midSvgs: [], aboveSvg: '<above/>',
      slots: [{ layerId: 'mainVisual', rect: { x: 80, y: 140, w: 1040, h: 800 } }],
    });
  });

  it('実フレーム合成：各スロットのクリップフレームを抽出→毎フレーム読み、settled は窓の続き（+W*speed）から', async () => {
    vi.mocked(layoutScene).mockReturnValue(slotLayout);
    const clipCalls: Array<Record<string, unknown>> = [];
    let reads = 0;
    const out = await buildExportScenes(
      [{ sceneId: 's1', templateId: 'tpl', durationSec: 8 }] as unknown as Scene[],
      templateById, noAsset,
      () => ({ narrationVolume: 1 }),
      () => [{ slotLayerId: 'mainVisual', clipRelPath: 'assets/v.mp4', fit: 'cover' as const, clipStartSec: 2, useOriginalAudio: true, originalVolume: 0.4, speed: 1 }],
      undefined, {},
      (s) => [slotAnim(s.sceneId, 1)], // W=1
      async () => {},
      async (dir, clipRelPath, clipStartSec, durSec, speed) => { clipCalls.push({ dir, clipRelPath, clipStartSec, durSec, speed }); return 31; },
      async () => { reads += 1; return 'data:image/png;base64,VF'; },
    );
    // 抽出はスロットごとに1回（dir=clip_vbody_0_0・W=1・clipStart=2・speed=1）。
    expect(clipCalls).toHaveLength(1);
    expect(clipCalls[0]).toMatchObject({ dir: 'clip_vbody_0_0', clipRelPath: 'assets/v.mp4', clipStartSec: 2, durSec: 1, speed: 1 });
    // 各出力フレームで実フレームを読む（frameCount=ceil(1*fps)+1）。
    expect(reads).toBe(Math.ceil(1 * FPS) + 1);
    // 窓 Frames は元音声 amix 用の clipAudios（useOriginalAudio・durSec=W）。
    expect(out[0].clipAudios).toHaveLength(1);
    expect(out[0].clipAudios?.[0]).toMatchObject({ clipRelPath: 'assets/v.mp4', clipStartSec: 2, durSec: 1, speed: 1, volume: 0.4 });
    // settled は窓の続き＝clipStart(2)+W(1)*speed(1)=3 から（連続再生）。
    expect(out[1].video?.clipStartSec).toBe(3);
  });

  it('元音声OFFなら窓の clipAudios は付かず、settled は clipStart のまま（実フレームでも音声は流さない）', async () => {
    vi.mocked(layoutScene).mockReturnValue(slotLayout);
    const out = await buildExportScenes(
      [{ sceneId: 's1', templateId: 'tpl', durationSec: 8 }] as unknown as Scene[],
      templateById, noAsset,
      () => ({ narrationVolume: 1 }),
      () => [{ slotLayerId: 'mainVisual', clipRelPath: 'assets/v.mp4', fit: 'cover' as const, clipStartSec: 2, useOriginalAudio: false, speed: 1 }],
      undefined, {},
      (s) => [slotAnim(s.sceneId, 1)],
      async () => {},
      async () => 31,
      async () => 'data:image/png;base64,VF',
    );
    expect(out[0].clipAudios).toBeUndefined();
    // 元音声OFFでも映像は実フレームで動きながら再生＝settled は窓の続き（+W*speed）から。
    expect(out[1].video?.clipStartSec).toBe(3);
  });

  it('複数動画スロットの元音声はアニメ区間も全本 amix（先頭のみにしない・#442 P2）', async () => {
    // 2スロットともレイアウト item を持たせる（実フレーム抽出＝assetId 解決が要る）。
    vi.mocked(layoutScene).mockReturnValue({
      items: [
        { id: 'slotA', kind: 'image', role: 'slot', assetId: 'asset_a', x: 0, y: 0, w: 100, h: 100, zIndex: 1 },
        { id: 'slotB', kind: 'image', role: 'slot', assetId: 'asset_b', x: 0, y: 0, w: 100, h: 100, zIndex: 2 },
      ],
    } as unknown as SceneLayout);
    vi.mocked(splitVideoSceneSvgMulti).mockReturnValue({
      belowSvg: '<below/>', midSvgs: ['<mid/>'], aboveSvg: '<above/>',
      slots: [{ layerId: 'slotA', rect: { x: 0, y: 0, w: 100, h: 100 } }, { layerId: 'slotB', rect: { x: 0, y: 0, w: 100, h: 100 } }],
    });
    const out = await buildExportScenes(
      [{ sceneId: 's1', templateId: 'tpl', durationSec: 8 }] as unknown as Scene[],
      templateById, noAsset,
      () => ({ narrationVolume: 1 }),
      () => [
        { slotLayerId: 'slotA', clipRelPath: 'assets/a.mp4', fit: 'cover' as const, clipStartSec: 0, useOriginalAudio: true, originalVolume: 0.5, speed: 1 },
        { slotLayerId: 'slotB', clipRelPath: 'assets/b.mp4', fit: 'cover' as const, clipStartSec: 0, useOriginalAudio: true, originalVolume: 0.3, speed: 1 },
      ],
      undefined, {},
      // アニメ対象は実在するスロット（slotA）＝slotIsAnimated=true。
      (s) => [({ id: 'a', sceneId: s.sceneId, targetId: 'slotA', keyframes: [{ timeSec: 0, x: -100 }, { timeSec: 1, x: 0 }] } as unknown as ElementAnimation)],
      async () => {},
      async () => 31,
      async () => 'data:image/png;base64,VF',
    );
    // 窓の元音声は元音声ON全スロット＝2本（先頭だけにしない）。
    expect(out[0].clipAudios).toHaveLength(2);
    expect(out[0].clipAudios?.map((c) => c.clipRelPath)).toEqual(['assets/a.mp4', 'assets/b.mp4']);
  });

  it('非アニメスロットの afterAnim は無視（d=0＝先頭から）で書き出しは止めない＝precheck と同一門番（#444 レビュー P2）', async () => {
    // slotA=アニメ対象・slotB=非アニメ。settled 無し（animEnd=3>=尺2）＋slotVideoStart={slotB: afterAnim}。
    // 旧実装は「afterAnim を持つスロットがあれば throw」で slotB でも停止＝precheck（slotIsAnimated ゲート）と不一致だった。
    vi.mocked(layoutScene).mockReturnValue({
      items: [
        { id: 'slotA', kind: 'image', role: 'slot', assetId: 'asset_a', x: 0, y: 0, w: 100, h: 100, zIndex: 1 },
        { id: 'slotB', kind: 'image', role: 'slot', assetId: 'asset_b', x: 0, y: 0, w: 100, h: 100, zIndex: 2 },
      ],
    } as unknown as SceneLayout);
    vi.mocked(splitVideoSceneSvgMulti).mockReturnValue({
      belowSvg: '<below/>', midSvgs: ['<mid/>'], aboveSvg: '<above/>',
      slots: [{ layerId: 'slotA', rect: { x: 0, y: 0, w: 100, h: 100 } }, { layerId: 'slotB', rect: { x: 0, y: 0, w: 100, h: 100 } }],
    });
    const out = await buildExportScenes(
      [{ sceneId: 's1', templateId: 'tpl', durationSec: 2, slotVideoStart: { slotB: { mode: 'afterAnim' } } }] as unknown as Scene[],
      templateById, noAsset,
      () => ({ narrationVolume: 1 }),
      () => [
        { slotLayerId: 'slotA', clipRelPath: 'assets/a.mp4', fit: 'cover' as const, clipStartSec: 0, useOriginalAudio: true, originalVolume: 0.5, speed: 1 },
        { slotLayerId: 'slotB', clipRelPath: 'assets/b.mp4', fit: 'cover' as const, clipStartSec: 0, useOriginalAudio: true, originalVolume: 0.3, speed: 1 },
      ],
      undefined, {},
      (s) => [({ id: 'a', sceneId: s.sceneId, targetId: 'slotA', keyframes: [{ timeSec: 0, x: -100 }, { timeSec: 3, x: 0 }] } as unknown as ElementAnimation)],
      async () => {},
      async () => 31,
      async () => 'data:image/png;base64,VF',
    );
    // throw せず出力。slotB は非アニメ＝afterAnim を無視して d=0（先頭から・delaySec 0）＝黙って静止しない。
    const bAudio = out[0].clipAudios?.find((c) => c.clipRelPath === 'assets/b.mp4');
    expect(bAudio?.delaySec).toBe(0);
  });

  it('トリミング（clipEndSec）を尊重：窓の抽出/音声は残り再生秒に抑え、settled は終点手前でクランプ（切った後ろを読まない・#442 P1）', async () => {
    vi.mocked(layoutScene).mockReturnValue(slotLayout);
    const clipCalls: Array<Record<string, unknown>> = [];
    // clipStart=1・clipEnd=1.4（残り再生秒=0.4/speed1=0.4）・W=1（アニメ長）。窓は1秒だが動画は0.4秒で終点。
    const out = await buildExportScenes(
      [{ sceneId: 's1', templateId: 'tpl', durationSec: 8 }] as unknown as Scene[],
      templateById, noAsset,
      () => ({ narrationVolume: 1 }),
      () => [{ slotLayerId: 'mainVisual', clipRelPath: 'assets/v.mp4', fit: 'cover' as const, clipStartSec: 1, clipEndSec: 1.4, useOriginalAudio: true, originalVolume: 0.5, speed: 1 }],
      undefined, {},
      (s) => [slotAnim(s.sceneId, 1)],
      async () => {},
      async (_dir, _clipRelPath, clipStartSec, durSec, speed) => { clipCalls.push({ durSec, speed, clipStartSec }); return 13; },
      async () => 'data:image/png;base64,VF',
    );
    // 抽出尺＝min(W=1, 残り0.4)=0.4（終点を超えて切った後ろを抽出しない）。
    expect(clipCalls[0].durSec).toBeCloseTo(0.4, 6);
    // 窓の元音声も min(W, 残り)=0.4 に抑える。
    expect(out[0].clipAudios?.[0]?.durSec).toBeCloseTo(0.4, 6);
    // settled 開始は「終点(1.4)の1フレーム手前」にクランプ＝clipStart+W*speed(=2) へ進めない（最終フレーム保持）。
    expect(out[1].video?.clipStartSec).toBeCloseTo(1.4 - 1 / FPS, 6);
    // clipEndSec は settled にも渡る（Rust 側で終点まで＝eof_action=repeat 保持）。
    expect(out[1].video?.clipEndSec).toBe(1.4);
  });

  it('開始遅延（delay）：窓は[0,d]を代表フレームで静止し[d,W]を再生・元音声はdから・settledは窓の続き(W−d)から（#444・ADR-0027）', async () => {
    vi.mocked(layoutScene).mockReturnValue(slotLayout);
    const clipCalls: Array<Record<string, unknown>> = [];
    const readIdx: number[] = [];
    const scene = [{
      sceneId: 's1', templateId: 'tpl', durationSec: 8,
      slotVideoStart: { mainVisual: { mode: 'delay', delaySec: 0.5 } }, // d=0.5・W=1
    }] as unknown as Scene[];
    const out = await buildExportScenes(
      scene, templateById, noAsset,
      () => ({ narrationVolume: 1 }),
      () => [{ slotLayerId: 'mainVisual', clipRelPath: 'assets/v.mp4', fit: 'cover' as const, clipStartSec: 2, useOriginalAudio: true, originalVolume: 0.5, speed: 1 }],
      undefined, {},
      (s) => [slotAnim(s.sceneId, 1)], // W=1
      async () => {},
      async (_dir, _clip, _cs, durSec) => { clipCalls.push({ durSec }); return Math.max(1, Math.ceil(durSec * FPS) + 1); },
      async (_dir, index) => { readIdx.push(index); return 'data:image/png;base64,VF'; },
    );
    const delayFrames = Math.round(0.5 * FPS); // 15
    // 抽出は再生ぶん（W−d=0.5）だけ（[0,d]の静止は抽出しない）。
    expect(clipCalls[0].durSec).toBeCloseTo(0.5, 6);
    // 窓フレームは [0,d) が index0（clipStart 静止）→ 以降 f−delayFrames で再生。
    expect(readIdx.slice(0, delayFrames).every((x) => x === 0)).toBe(true);
    expect(Math.max(...readIdx)).toBeGreaterThan(0); // 再生区間で進む
    // 窓の元音声は d から鳴らし（delaySec=0.5）尺は残り 0.5（Rust adelay）。
    expect(out[0].clipAudios?.[0]).toMatchObject({ clipStartSec: 2, durSec: 0.5, delaySec: 0.5, volume: 0.5 });
    // settled は窓の続き＝clipStart(2)+(W−d)(0.5)*speed(1)=2.5 から（連続再生）。
    expect(out[1].video?.clipStartSec).toBeCloseTo(2.5, 6);
  });

  it('開始遅延（afterAnim）：窓は全区間 static（動画は待つ）・元音声は鳴らさず・settled は clipStart から（#444）', async () => {
    vi.mocked(layoutScene).mockReturnValue(slotLayout);
    const readIdx: number[] = [];
    const scene = [{
      sceneId: 's1', templateId: 'tpl', durationSec: 8,
      slotVideoStart: { mainVisual: { mode: 'afterAnim' } }, // d=W=1
    }] as unknown as Scene[];
    const out = await buildExportScenes(
      scene, templateById, noAsset,
      () => ({ narrationVolume: 1 }),
      () => [{ slotLayerId: 'mainVisual', clipRelPath: 'assets/v.mp4', fit: 'cover' as const, clipStartSec: 2, useOriginalAudio: true, originalVolume: 0.5, speed: 1 }],
      undefined, {},
      (s) => [slotAnim(s.sceneId, 1)], // W=1・settled あり（尺8）
      async () => {},
      async (_dir, _clip, _cs, durSec) => Math.max(1, Math.ceil(durSec * FPS) + 1),
      async (_dir, index) => { readIdx.push(index); return 'data:image/png;base64,VF'; },
    );
    // afterAnim（d=W）＝窓は全フレーム代表フレーム（index 0）で静止（動画は待つ）。
    expect(readIdx.every((x) => x === 0)).toBe(true);
    // 鳴る区間が無い（W−d=0）ので窓の元音声は付かない。
    expect(out[0].clipAudios).toBeUndefined();
    // settled は clipStart から（窓で 0 秒しか進めていない）。
    expect(out[1].video?.clipStartSec).toBe(2);
  });

  it('afterAnim × settled 無し（アニメが場面尺いっぱい）は §2-5 エラーで停止＝黙って静止画にしない（#444/ADR-0027 D3）', async () => {
    await expect(
      buildExportScenes(
        [{ sceneId: 's1', templateId: 'tpl', durationSec: 2, slotVideoStart: { mainVisual: { mode: 'afterAnim' } } }] as unknown as Scene[],
        templateById, noAsset,
        () => ({ narrationVolume: 1 }),
        videoSlot, undefined, {},
        (s) => [slotAnim(s.sceneId, 3)], // animEnd=3 >= 尺2 → settled 無し＝afterAnim だと動画が一度も再生されない
        async () => {},
      ),
    ).rejects.toThrow(/再生されません/);
  });
});

describe('buildExportScenes：掛け合い×動画スロット（行区間つき上PNG＋行ナレーション配置）', () => {
  const videoSlot = () => [{
    slotLayerId: 'mainVisual',
    clipRelPath: 'assets/v.mp4',
    fit: 'cover' as const,
    clipStartSec: 0,
    useOriginalAudio: false,
    speed: 1,
  }];
  const dialogueScene = (lines: unknown[]) =>
    [{ sceneId: 's1', templateId: 'tpl', durationSec: 8, lines }] as unknown as Scene[];

  it('1場面のまま aboveSegments（行区間窓）と narrationSegments（開始秒配置）を持つ（abovePngBase64 は使わない）', async () => {
    const out = await buildExportScenes(
      dialogueScene([
        { lineId: 'line_001', text: 'a', startSec: 0, status: 'none' },
        { lineId: 'line_002', text: 'b', startSec: 4, status: 'none' },
      ]),
      templateById, noAsset,
      (_s, lineId) => ({ audioBase64: lineId ? `A_${lineId}` : undefined, narrationVolume: 0.9 }),
      videoSlot,
    );
    expect(out).toHaveLength(1); // 動画は分割しない（クリップ連続・1エンコード）
    expect(out[0].video?.abovePngBase64).toBeUndefined();
    expect(out[0].video?.aboveSegments).toEqual([
      { pngBase64: 'data:image/png;base64,PNG', startSec: 0, endSec: 4 },
      { pngBase64: 'data:image/png;base64,PNG', startSec: 4, endSec: 8 },
    ]);
    // 行ナレーションは各行の開始秒（adelay）に配置＋窓（次行開始まで＝#385）で切り詰め。場面単位の audioBase64 は使わない。
    expect(out[0].video?.narrationSegments).toEqual([
      { audioBase64: 'A_line_001', delaySec: 0, windowSec: 4 }, // [0,4)
      { audioBase64: 'A_line_002', delaySec: 4, windowSec: 4 }, // [4,8)
    ]);
    expect(out[0].audioBase64).toBeUndefined();
    expect(out[0].narrationVolume).toBe(0.9);
    expect(out[0].durationSec).toBe(8); // 尺は場面のまま
  });

  it('先頭行が途中開始なら先頭に「間」の表示窓（字幕なし）が入り、先頭行は startSec から表示（#386・A案＝間を尊重）', async () => {
    const out = await buildExportScenes(
      dialogueScene([
        { lineId: 'line_001', text: 'a', startSec: 2, status: 'none' },
        { lineId: 'line_002', text: 'b', startSec: 5, status: 'none' },
      ]),
      templateById, noAsset,
      (_s, lineId) => ({ audioBase64: lineId ? `A_${lineId}` : undefined, narrationVolume: 1 }),
      videoSlot,
    );
    const segs = out[0].video?.aboveSegments;
    // 頭空白 [0,2) は字幕なしの「間」区間。先頭行は 2 秒から（旧：先頭を 0 に伸ばして先頭字幕を頭出し、を廃止）。
    expect(segs).toHaveLength(3);
    expect(segs?.[0]).toMatchObject({ startSec: 0, endSec: 2 }); // 間（字幕なし）
    expect(segs?.[1]).toMatchObject({ startSec: 2, endSec: 5 }); // 先頭行
    expect(segs?.[2]).toMatchObject({ startSec: 5, endSec: 8 }); // 2行目
    // 音声は行開始秒（2/5）に配置＋窓で切り詰め（#385）。間には音声を載せない（先頭は line_001 の delaySec=2）。
    expect(out[0].video?.narrationSegments).toEqual([
      { audioBase64: 'A_line_001', delaySec: 2, windowSec: 3 }, // [2,5)
      { audioBase64: 'A_line_002', delaySec: 5, windowSec: 3 }, // [5,8)
    ]);
  });

  it('行ごとにクレジット（splitVideoSceneSvgMulti の第6引数）を渡して上PNGを焼く（#243 の併記を置き換え）', async () => {
    vi.mocked(splitVideoSceneSvgMulti).mockClear();
    await buildExportScenes(
      dialogueScene([
        { lineId: 'line_001', text: 'a', startSec: 0, status: 'none' },
        { lineId: 'line_002', text: 'b', startSec: 4, status: 'none' },
      ]),
      templateById, noAsset,
      (_s, lineId) => ({ audioBase64: lineId ? `A_${lineId}` : undefined, narrationVolume: 1 }),
      videoSlot,
      undefined,
      { credit: 'VOICEVOX:ずんだもん' },
    );
    // 基準1回＋行セグメント2回。話者未指定の行は既定クレジット（話者連動は creditForLine の責務）。
    const calls = vi.mocked(splitVideoSceneSvgMulti).mock.calls;
    expect(calls).toHaveLength(3);
    expect(calls[1]?.[5]).toBe('VOICEVOX:ずんだもん');
    expect(calls[2]?.[5]).toBe('VOICEVOX:ずんだもん');
  });

  it('音声未生成の行は narrationSegments に載せない（無音行・表示窓のみ）', async () => {
    const out = await buildExportScenes(
      dialogueScene([
        { lineId: 'line_001', text: 'a', startSec: 0, status: 'none' },
        { lineId: 'line_002', text: 'b', startSec: 4, status: 'none' },
      ]),
      templateById, noAsset,
      (_s, lineId) => ({
        audioBase64: lineId === 'line_001' ? 'A_line_001' : undefined,
        narrationVolume: 1,
      }),
      videoSlot,
    );
    expect(out[0].video?.aboveSegments).toHaveLength(2); // 表示窓は両行ぶん
    expect(out[0].video?.narrationSegments).toEqual([{ audioBase64: 'A_line_001', delaySec: 0, windowSec: 4 }]);
  });
});

describe('buildExportScenes：字幕トグル（withSubtitle）', () => {
  const oneScene = [{ sceneId: 's1', templateId: 'tpl', durationSec: 8 }] as unknown as Scene[];

  it('withSubtitle:false で layoutToSvg に「字幕除外」フィルタを渡す', async () => {
    vi.mocked(layoutToSvg).mockClear();
    await buildExportScenes(oneScene, templateById, noAsset, undefined, undefined, undefined, {
      withSubtitle: false,
    });
    const filter = vi.mocked(layoutToSvg).mock.calls[0]?.[1]?.itemFilter;
    expect(filter).toBeTypeOf('function');
    expect(filter!({ kind: 'text', isSubtitle: true } as unknown as LayoutItem)).toBe(false);
    expect(filter!({ kind: 'text', isSubtitle: false } as unknown as LayoutItem)).toBe(true);
    expect(filter!({ kind: 'image' } as unknown as LayoutItem)).toBe(true);
  });

  it('withSubtitle 未指定なら itemFilter なし（従来動作を維持）', async () => {
    vi.mocked(layoutToSvg).mockClear();
    await buildExportScenes(oneScene, templateById, noAsset);
    expect(vi.mocked(layoutToSvg).mock.calls[0]?.[1]?.itemFilter).toBeUndefined();
  });

  it('静止画は layoutToSvg に常時クレジット（NARRATOR_CREDIT）を渡す（ADR-0003）', async () => {
    vi.mocked(layoutToSvg).mockClear();
    await buildExportScenes(oneScene, templateById, noAsset);
    expect(vi.mocked(layoutToSvg).mock.calls[0]?.[1]?.credit).toBe(NARRATOR_CREDIT);
  });

  it('opts.credit を渡すと layoutToSvg のクレジットに反映（#177・動的クレジット）', async () => {
    vi.mocked(layoutToSvg).mockClear();
    await buildExportScenes(oneScene, templateById, noAsset, undefined, undefined, undefined, { credit: 'VOICEVOX:四国めたん' });
    expect(vi.mocked(layoutToSvg).mock.calls[0]?.[1]?.credit).toBe('VOICEVOX:四国めたん');
  });
});

describe('buildExportScenes：出力解像度（HDサイズ）', () => {
  const videoSlot = () => [{
    slotLayerId: 'mainVisual',
    clipRelPath: 'assets/v.mp4',
    fit: 'cover' as const,
    clipStartSec: 0,
    useOriginalAudio: false,
    speed: 1,
  }];

  it('outputWidth/Height でPNGを縮小し、動画スロット座標もスケールする', async () => {
    vi.mocked(svgToPngDataUrl).mockClear();
    const out = await buildExportScenes(
      [{ sceneId: 's1', templateId: 'tpl', durationSec: 8 }] as unknown as Scene[],
      templateById,
      noAsset,
      () => ({ narrationVolume: 1.0 }),
      videoSlot,
      undefined,
      { outputSize: { width: 960, height: 540 } }, // 1920x1080 の半分
    );
    expect(vi.mocked(svgToPngDataUrl)).toHaveBeenCalledWith(expect.anything(), 960, 540);
    // スロット(80,140,1040,800) が半分にスケールされる
    expect(out[0].video).toMatchObject({ slotX: 40, slotY: 70, slotW: 520, slotH: 400 });
  });

  it('静止画シーンも outputSize でPNGを縮小する', async () => {
    vi.mocked(svgToPngDataUrl).mockClear();
    await buildExportScenes(
      [{ sceneId: 's1', templateId: 'tpl', durationSec: 8 }] as unknown as Scene[],
      templateById,
      noAsset,
      undefined,
      undefined, // videoSlotFor なし → 静止画シーン
      undefined,
      { outputSize: { width: 1280, height: 720 } },
    );
    expect(vi.mocked(svgToPngDataUrl)).toHaveBeenCalledWith(expect.anything(), 1280, 720);
  });

  it('outputSize 未指定ならキャンバス寸法（フルHD）で焼く', async () => {
    vi.mocked(svgToPngDataUrl).mockClear();
    await buildExportScenes(
      [{ sceneId: 's1', templateId: 'tpl', durationSec: 8 }] as unknown as Scene[],
      templateById,
      noAsset,
    );
    expect(vi.mocked(svgToPngDataUrl)).toHaveBeenCalledWith(expect.anything(), 1920, 1080);
  });
});

describe('buildExportScenes：場面間トランジション（ADR-0009 T2）', () => {
  it('先頭は transition なし、以降は xfade 名＋offset（実効累積−D）を付与', async () => {
    const scenes = [
      { sceneId: 's1', templateId: 'tpl', durationSec: 8 },
      { sceneId: 's2', templateId: 'tpl', durationSec: 10, transition: { in: 'fade', durationSec: 0.5 } },
      { sceneId: 's3', templateId: 'tpl', durationSec: 6, transition: { in: 'slide', direction: 'up', durationSec: 0.5 } },
    ] as unknown as Scene[];
    const out = await buildExportScenes(scenes, templateById, noAsset);
    expect(out[0].transition).toBeUndefined();
    expect(out[1].transition).toEqual({ name: 'fade', durationSec: 0.5, offsetSec: 7.5 }); // 8−0.5
    // 実効累積: 8 → 8+10−0.5=17.5。境界2 offset = 17.5−0.5 = 17。
    expect(out[2].transition).toEqual({ name: 'slideup', durationSec: 0.5, offsetSec: 17 });
  });

  it('none/未設定はハードカット（transition を付けない）', async () => {
    const scenes = [
      { sceneId: 's1', templateId: 'tpl', durationSec: 8 },
      { sceneId: 's2', templateId: 'tpl', durationSec: 5, transition: { in: 'none' } },
    ] as unknown as Scene[];
    const out = await buildExportScenes(scenes, templateById, noAsset);
    expect(out[1].transition).toBeUndefined();
  });

  it('wipe/zoom は fade として書き出す（resolveTransition と一致）', async () => {
    const scenes = [
      { sceneId: 's1', templateId: 'tpl', durationSec: 8 },
      { sceneId: 's2', templateId: 'tpl', durationSec: 6, transition: { in: 'wipe', durationSec: 0.5 } },
    ] as unknown as Scene[];
    const out = await buildExportScenes(scenes, templateById, noAsset);
    expect(out[1].transition?.name).toBe('fade');
  });

  it('掛け合いの短い「間」＋入場遷移：遷移尺は間で縮めず場面尺で clamp（#430・per-scene＝切り替え尺優先）', async () => {
    const scenes = [
      { sceneId: 's1', templateId: 'tpl', durationSec: 5 },
      {
        sceneId: 's2', templateId: 'tpl', durationSec: 10,
        transition: { in: 'fade', durationSec: 1 }, // 希望1s
        lines: [
          { lineId: 'line_001', text: 'a', startSec: 0.5, status: 'none' }, // 間0.5s
          { lineId: 'line_002', text: 'b', startSec: 4, status: 'none' },
        ],
      },
    ] as unknown as Scene[];
    const out = await buildExportScenes(scenes, templateById, noAsset);
    // s2 は 間[0,0.5)/line0[0.5,4)/line1[4,10) の3セグメント。sceneStart は各場面の先頭だけ true。
    expect(out.map((o) => o.durationSec)).toEqual([5, 0.5, 3.5, 6]);
    expect(out.map((o) => o.sceneStart)).toEqual([true, true, false, false]); // s1 先頭／s2 先頭(間)＋行×2
    // #430：per-scene で解決＝希望1s は「間」で縮めず場面尺(10s)で clamp（d=min(1, acc=5, 10)=1・offset=5−1=4）。
    // 入場遷移は out[1]（場面の先頭＝間）に載り、Rust が場面内を連結してから間を跨いで先頭行に重ねる。
    expect(out[1].transition).toEqual({ name: 'fade', durationSec: 1, offsetSec: 4 });
    // 場面内の後続セグメント（行）には遷移を付けない（ハードカット）。
    expect(out[2].transition).toBeUndefined();
    expect(out[3].transition).toBeUndefined();
  });
});

describe('buildExportScenes：場面で使う画像IDの収集（#143）', () => {
  it('場面の画像 assetId ぶんだけ resolveAssetSrc を呼ぶ（場面内の重複・null・非画像は除外）', async () => {
    vi.mocked(layoutScene).mockReturnValueOnce({
      items: [
        { kind: 'image', assetId: 'img1' },
        { kind: 'image', assetId: 'img2' },
        { kind: 'image', assetId: 'img1' }, // 同一場面での重複 → 1回に集約
        { kind: 'text', isSubtitle: false }, // 画像以外は対象外
        { kind: 'image', assetId: null }, // 未割当（null）は対象外
      ],
    } as unknown as SceneLayout);
    const resolve = vi.fn(async () => 'data:image/png;base64,X');
    await buildExportScenes(
      [{ sceneId: 's1', templateId: 'tpl', durationSec: 8 }] as unknown as Scene[],
      templateById,
      resolve,
    );
    expect(resolve).toHaveBeenCalledWith('img1');
    expect(resolve).toHaveBeenCalledWith('img2');
    expect(resolve).toHaveBeenCalledTimes(2); // 重複排除＋null/非画像除外で2回のみ
  });

  it('テンプレ既定素材（tmpl_asset_*）も画像として収集し resolveAssetSrc に渡す（プロジェクト素材と混在可・ADR-0021 書き出し）', async () => {
    // 描画フォールバック（PR A）で layer.assetId（tmpl_asset_*）が layout 画像に乗る。書き出しでも解決対象に含める。
    vi.mocked(layoutScene).mockReturnValueOnce({
      items: [
        { kind: 'image', assetId: 'asset_001' }, // プロジェクト素材
        { kind: 'image', assetId: 'tmpl_asset_001' }, // テンプレ既定素材
      ],
    } as unknown as SceneLayout);
    const resolve = vi.fn(async () => 'data:image/png;base64,X');
    await buildExportScenes(
      [{ sceneId: 's1', templateId: 'tpl', durationSec: 8 }] as unknown as Scene[],
      templateById,
      resolve,
    );
    expect(resolve).toHaveBeenCalledWith('asset_001');
    expect(resolve).toHaveBeenCalledWith('tmpl_asset_001'); // テンプレ素材も書き出しの解決対象に渡る
  });
});

describe('buildExportScenes：中止（#380）', () => {
  it('shouldCancel が true なら ExportCancelledError で中断し、以降の場面を描かない', async () => {
    vi.mocked(svgToPngDataUrl).mockClear();
    await expect(
      buildExportScenes(scenes, templateById, noAsset, undefined, undefined, undefined, {
        shouldCancel: () => true,
      }),
    ).rejects.toBeInstanceOf(ExportCancelledError);
    // 先頭場面の描画前（場面境界の bail）で抜けるため、ラスタライズは1回も走らない。
    expect(svgToPngDataUrl).not.toHaveBeenCalled();
  });

  it('shouldCancel が false のままなら通常どおり全場面を処理する（中止判定は非破壊）', async () => {
    const out = await buildExportScenes(scenes, templateById, noAsset, undefined, undefined, undefined, {
      shouldCancel: () => false,
    });
    expect(out).toHaveLength(2); // s1/s2
  });

  it('shouldCancel を渡さなければ従来どおり（中止判定なし）', async () => {
    const out = await buildExportScenes(scenes, templateById, noAsset);
    expect(out).toHaveLength(2);
  });
});

// #434（ADR-0026④）の「黙って代替しない」を派生経路にも広げる（Codex 監査 P1）。基準 layout は precheck 済みだが、
// 掛け合いの行区間・アニメの settled 区間・毎フレームの派生レイアウトで分割に失敗すると、以前は行を飛ばす/基準 layout で
// 代替して「字幕・音声・動画位置の欠けた MP4」を成功扱いにしていた。各派生経路が同じ §2-5 エラーで停止することを固定する。
describe('buildExportScenes：派生レイアウトの分割失敗も停止（#434 拡張・掛け合い/settled/毎フレーム）', () => {
  const validSplit = () => ({
    belowSvg: '<below/>', midSvgs: [], aboveSvg: '<above/>',
    slots: [{ layerId: 'mainVisual', rect: { x: 80, y: 140, w: 1040, h: 800 } }],
  });
  const videoSlot = () => [{
    slotLayerId: 'mainVisual', clipRelPath: 'assets/v.mp4', fit: 'cover' as const,
    clipStartSec: 0, useOriginalAudio: false, speed: 1,
  }];
  const slotAnim = (sceneId: string, endSec: number): ElementAnimation =>
    ({ id: 'a', sceneId, targetId: 'mainVisual', keyframes: [{ timeSec: 0, x: -200 }, { timeSec: endSec, x: 0 }] } as unknown as ElementAnimation);
  // 以降の describe が無いよう、テスト後に既定 mock（有効な分割を返す）へ戻す。
  afterEach(() => {
    vi.mocked(splitVideoSceneSvgMulti).mockReset();
    vi.mocked(splitVideoSceneSvgMulti).mockReturnValue(validSplit());
  });

  it('掛け合い×動画：行区間の派生 layout の分割に失敗したら、行を黙って飛ばさず停止（§2-5）', async () => {
    // base(splitM) は成功、先頭行セグメントの分割だけ null＝以前は continue で字幕/音声を落としていた。
    vi.mocked(splitVideoSceneSvgMulti).mockReturnValueOnce(validSplit()).mockReturnValueOnce(null);
    await expect(
      buildExportScenes(
        [{ sceneId: 's1', templateId: 'tpl', durationSec: 8, lines: [{ lineId: 'line_001', text: 'a', startSec: 0, status: 'none' }] }] as unknown as Scene[],
        templateById, noAsset,
        (_s, lineId) => ({ audioBase64: lineId ? `A_${lineId}` : undefined, narrationVolume: 1 }),
        videoSlot,
      ),
    ).rejects.toThrow(/場面1の動画を配置できませんでした/);
  });

  it('動画スロット本体アニメ：settled（アニメ収束）区間の分割に失敗したら、基準 layout で代替せず停止（§2-5）', async () => {
    // base 成功 → settled 分割 null＝以前は `?? splitM` で位置/字幕が基準のまま焼かれていた。
    vi.mocked(splitVideoSceneSvgMulti).mockReturnValueOnce(validSplit()).mockReturnValueOnce(null);
    await expect(
      buildExportScenes(
        [{ sceneId: 's1', templateId: 'tpl', durationSec: 8 }] as unknown as Scene[],
        templateById, noAsset,
        () => ({ narrationVolume: 1 }),
        videoSlot, undefined, {},
        (s) => [slotAnim(s.sceneId, 1)], // animEnd=1<尺8 → settled 区間あり
        async () => {},
      ),
    ).rejects.toThrow(/場面1の動画を配置できませんでした/);
  });

  it('動画×アニメ（スロット以外）：毎フレームの派生 layout の分割に失敗したら、静止層で代替せず停止（§2-5）', async () => {
    // base 成功 → フレーム0の分割 null＝以前は console.warn＋`?? splitM` でそのフレームだけ動きが飛んでいた。
    vi.mocked(splitVideoSceneSvgMulti).mockReturnValueOnce(validSplit()).mockReturnValueOnce(null);
    await expect(
      buildExportScenes(
        [{ sceneId: 's1', templateId: 'tpl', durationSec: 8 }] as unknown as Scene[],
        templateById, noAsset,
        () => ({ narrationVolume: 1 }),
        videoSlot, undefined, {},
        (s) => [({ id: 'a', sceneId: s.sceneId, targetId: 'text_1', keyframes: [{ timeSec: 0, x: -50 }, { timeSec: 1, x: 0 }] } as unknown as ElementAnimation)],
        async () => {},
      ),
    ).rejects.toThrow(/場面1の動画を配置できませんでした/);
  });
});
