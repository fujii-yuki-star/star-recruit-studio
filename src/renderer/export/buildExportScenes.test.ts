import { describe, expect, it, vi } from 'vitest';

// canvas(ADR-0004) は Node テスト環境に無いため描画系をスタブ化し、音声付与の分岐のみを検証する。
vi.mock('../layout', () => ({ layoutScene: vi.fn(() => ({ items: [] })) }));
vi.mock('../sceneSvg', () => ({ layoutToSvg: vi.fn(() => '<svg/>') }));
vi.mock('./rasterize', () => ({ svgToPngDataUrl: vi.fn(async () => 'data:image/png;base64,PNG') }));
vi.mock('./videoSceneSplit', () => ({
  splitVideoSceneSvg: vi.fn(() => ({
    belowSvg: '<below/>',
    aboveSvg: '<above/>',
    slot: { x: 80, y: 140, w: 1040, h: 800 },
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
import { splitVideoSceneSvg } from './videoSceneSplit';
import { buildExportScenes } from './buildExportScenes';

// buildExportScenes が参照するのは templateId / durationSec / (narrationFor へ渡す scene) のみ。
const scenes = [
  { sceneId: 's1', templateId: 'tpl', durationSec: 8 },
  { sceneId: 's2', templateId: 'tpl', durationSec: 5 },
  { sceneId: 'sX', templateId: 'missing', durationSec: 4 },
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
    // テンプレ未解決の sX はスキップされる。
    expect(out).toHaveLength(2);
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
    expect(out).toHaveLength(2); // s1,s2（sX はテンプレ未解決でスキップ）
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

  it('動画スロット併用のアニメはフレーム列にせず video 経路（下/上PNG）', async () => {
    const out = await buildExportScenes(
      [{ sceneId: 's1', templateId: 'tpl', durationSec: 8 }] as unknown as Scene[],
      templateById, noAsset,
      () => ({ narrationVolume: 1 }),
      () => ({ slotLayerId: 'mainVisual', clipRelPath: 'assets/v.mp4', fit: 'cover', clipStartSec: 0, useOriginalAudio: false, speed: 1 }),
      undefined, {},
      (s) => [anim(s.sceneId)],
    );
    expect(out[0].framesBase64).toBeUndefined();
    expect(out[0].video).toBeDefined();
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
      () => ({
        slotLayerId: 'mainVisual',
        clipRelPath: 'assets/v.mp4',
        fit: 'cover',
        clipStartSec: 0,
        useOriginalAudio: false,
        speed: 1,
      }),
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

  it('opts.credit を渡すと splitVideoSceneSvg の credit 引数（6番目）に反映（#177・動画シーン）', async () => {
    vi.mocked(splitVideoSceneSvg).mockClear();
    await buildExportScenes(
      [{ sceneId: 's1', templateId: 'tpl', durationSec: 8 }] as unknown as Scene[],
      templateById,
      noAsset,
      undefined,
      () => ({ slotLayerId: 'mainVisual', clipRelPath: 'assets/v.mp4', fit: 'cover', clipStartSec: 0, useOriginalAudio: false, speed: 1 }),
      undefined,
      { credit: 'VOICEVOX:四国めたん' },
    );
    expect(vi.mocked(splitVideoSceneSvg).mock.calls[0]?.[5]).toBe('VOICEVOX:四国めたん');
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
});

describe('buildExportScenes：掛け合い×動画スロット（行区間つき上PNG＋行ナレーション配置）', () => {
  const videoSlot = () => ({
    slotLayerId: 'mainVisual',
    clipRelPath: 'assets/v.mp4',
    fit: 'cover' as const,
    clipStartSec: 0,
    useOriginalAudio: false,
    speed: 1,
  });
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

  it('行ごとにクレジット（splitVideoSceneSvg の第6引数）を渡して上PNGを焼く（#243 の併記を置き換え）', async () => {
    vi.mocked(splitVideoSceneSvg).mockClear();
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
    const calls = vi.mocked(splitVideoSceneSvg).mock.calls;
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
  const videoSlot = () => ({
    slotLayerId: 'mainVisual',
    clipRelPath: 'assets/v.mp4',
    fit: 'cover' as const,
    clipStartSec: 0,
    useOriginalAudio: false,
    speed: 1,
  });

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

  it('掛け合いの短い「間」＋入場遷移：現状は遷移尺が間の長さに clamp される（#386 の副作用・#430 で per-scene 化予定）', async () => {
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
    // s2 は 間[0,0.5)/line0[0.5,4)/line1[4,10) の3セグメント。out[1]=間（場面の先頭）が入場遷移を持つ。
    expect(out.map((o) => o.durationSec)).toEqual([5, 0.5, 3.5, 6]);
    // 現状：希望1s が「間」の尺0.5s に clamp（d=min(1, acc=5, 0.5)=0.5・offset=5−0.5）。
    // #430（per-scene xfade）で間を跨いで先頭行に重ね、設定尺1s を保つ予定（利用者判断 2026-07-06・切り替え尺を優先）。
    expect(out[1].transition).toEqual({ name: 'fade', durationSec: 0.5, offsetSec: 4.5 });
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
