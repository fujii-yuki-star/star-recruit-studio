import { describe, expect, it } from 'vitest';
import { TRANSITION_DIRECTION, TRANSITION_TYPE } from '../enums';
import { transitionTimeline, resolveTransition } from './sceneTransitions';
import { activeTelopsAt, assignTelopRows, compileTimeline, resolveSceneBgm, sceneLocalTelops } from './compileTimeline';
import type { Project, Scene } from './types';

// compileTimeline が読むのは sceneId/durationSec/transition/lines/narration/subtitleEnabledDefault のみ。
// 他の必須フィールドは型充足のための最小ダミー。narration/lines/transition は緩い型で受けて unknown 経由でキャストする
// （status 等の enum 値をテストで気にしないため）。
function scene(p: {
  sceneId: string;
  durationSec: number;
  transition?: unknown;
  lines?: unknown;
  narration?: { text: string; status?: string };
  subtitleEnabledDefault?: boolean;
  bgmSettings?: unknown;
}): Scene {
  return {
    partId: 'part_001',
    order: 1,
    sceneType: 'intro',
    templateId: 'tpl',
    assetRefs: {},
    character: { enabled: false, characterId: 'yuko' },
    texts: {},
    warnings: [],
    ...p,
    narration: p.narration ?? { text: 'ナレ', status: 'idle' },
  } as unknown as Scene;
}

function project(scenes: Scene[], bgm?: unknown, overlay?: unknown): Project {
  return { scenes, bgmSettings: bgm, timelineOverlay: overlay } as unknown as Project;
}

describe('compileTimeline：基本', () => {
  it('場面が無ければ空のタイムライン', () => {
    const tl = compileTimeline(project([]));
    expect(tl.totalSec).toBe(0);
    expect(tl.scenes).toEqual([]);
    expect(tl.transitions).toEqual([]);
    expect(tl.tracks).toEqual({ video: [], telop: [], audio: [], bgm: [] });
  });

  it('単一の静止場面：場面スパン＝[0, 尺]、映像/音声/テロップ各1本', () => {
    const tl = compileTimeline(project([scene({ sceneId: 's1', durationSec: 8, narration: { text: 'こんにちは', status: 'idle' } })]));
    expect(tl.totalSec).toBe(8);
    expect(tl.scenes).toEqual([{ sceneId: 's1', startSec: 0, endSec: 8, order: 0 }]);
    expect(tl.tracks.video).toEqual([{ id: 's1', sceneId: 's1', startSec: 0, endSec: 8, label: '場面 1' }]);
    // 単一 narration は1行（line_001）へ解決＝場面尺いっぱいの音声/字幕。
    expect(tl.tracks.audio).toEqual([{ id: 's1/line_001', sceneId: 's1', lineId: 'line_001', startSec: 0, endSec: 8, label: 'こんにちは' }]);
    expect(tl.tracks.telop).toEqual([{ id: 's1/line_001', sceneId: 's1', lineId: 'line_001', startSec: 0, endSec: 8, label: 'こんにちは' }]);
    expect(tl.transitions).toEqual([]);
  });

  it('sceneLabelFor で映像クリップの表示名を上書きできる', () => {
    const tl = compileTimeline(project([scene({ sceneId: 's1', durationSec: 5 })]));
    expect(tl.tracks.video[0].label).toBe('場面 1');
    const tl2 = compileTimeline(project([scene({ sceneId: 's1', durationSec: 5 })]), { sceneLabelFor: (_s, i) => `オープニング${i}` });
    expect(tl2.tracks.video[0].label).toBe('オープニング0');
  });
});

describe('compileTimeline：場面の並びと遷移（xfade 重なり）', () => {
  it('遷移なし（none）は隙間なく連結（totalSec＝尺の和）', () => {
    const tl = compileTimeline(project([
      scene({ sceneId: 's1', durationSec: 8 }),
      scene({ sceneId: 's2', durationSec: 5 }),
    ]));
    expect(tl.totalSec).toBe(13);
    expect(tl.scenes.map((s) => [s.startSec, s.endSec])).toEqual([[0, 8], [8, 13]]);
    expect(tl.transitions).toEqual([]);
  });

  it('fade 遷移：場面2は直前へ D だけ重なり、totalSec は D ぶん縮む', () => {
    const tl = compileTimeline(project([
      scene({ sceneId: 's1', durationSec: 8 }),
      scene({ sceneId: 's2', durationSec: 5, transition: { in: TRANSITION_TYPE.fade, durationSec: 2 } }),
    ]));
    // 8 + 5 - 2 = 11。場面2は 6 から。
    expect(tl.totalSec).toBe(11);
    expect(tl.scenes.map((s) => [s.startSec, s.endSec])).toEqual([[0, 8], [6, 11]]);
    expect(tl.transitions).toEqual([
      { fromSceneId: 's1', toSceneId: 's2', type: TRANSITION_TYPE.fade, direction: TRANSITION_DIRECTION.left, atSec: 6, durationSec: 2 },
    ]);
  });

  it('遷移尺は左右どちらの場面尺も超えないよう clamp される', () => {
    const tl = compileTimeline(project([
      scene({ sceneId: 's1', durationSec: 3 }),
      scene({ sceneId: 's2', durationSec: 10, transition: { in: TRANSITION_TYPE.fade, durationSec: 5 } }),
    ]));
    // 希望 5 だが直前場面尺 3 で clamp → 重なり 3。total = 3 + 10 - 3 = 10。
    expect(tl.transitions[0].durationSec).toBe(3);
    expect(tl.totalSec).toBe(10);
  });
});

describe('compileTimeline：掛け合い（行トラック）', () => {
  it('明示 startSec の2行は音声/テロップが行ごとの区間になる', () => {
    const s = scene({
      sceneId: 's1',
      durationSec: 10,
      lines: [
        { lineId: 'l1', text: 'やあ', startSec: 0, status: 'idle' },
        { lineId: 'l2', text: 'どうも', startSec: 4, status: 'idle' },
      ],
    });
    const tl = compileTimeline(project([s]));
    expect(tl.tracks.audio).toEqual([
      { id: 's1/l1', sceneId: 's1', lineId: 'l1', startSec: 0, endSec: 4, label: 'やあ' },
      { id: 's1/l2', sceneId: 's1', lineId: 'l2', startSec: 4, endSec: 10, label: 'どうも' },
    ]);
    expect(tl.tracks.telop.map((c) => [c.startSec, c.endSec, c.label])).toEqual([
      [0, 4, 'やあ'], [4, 10, 'どうも'],
    ]);
  });

  it('前場面の遷移重なりぶん、後場面の行クリップもグローバルにずれる', () => {
    const tl = compileTimeline(project([
      scene({ sceneId: 's1', durationSec: 8 }),
      scene({ sceneId: 's2', durationSec: 6, transition: { in: TRANSITION_TYPE.fade, durationSec: 2 },
        lines: [{ lineId: 'l1', text: 'A', startSec: 0, status: 'idle' }] }),
    ]));
    // 場面2は 6 から。単一行は場面尺いっぱい → [6, 12]。
    const s2audio = tl.tracks.audio.filter((c) => c.sceneId === 's2');
    expect(s2audio).toEqual([{ id: 's2/l1', sceneId: 's2', lineId: 'l1', startSec: 6, endSec: 12, label: 'A' }]);
  });

  it('掛け合いは動画スロットの有無に依らず行ごとに射影する（#433・旧 collapse 撤去＝#385/#386 の4経路統一）', () => {
    const s = scene({
      sceneId: 's1',
      durationSec: 10,
      lines: [
        { lineId: 'l1', text: 'やあ', startSec: 0, status: 'idle' },
        { lineId: 'l2', text: 'どうも', startSec: 4, status: 'idle' },
      ],
    });
    // isVideoSlotScene オプションは撤去済み。動画スロット掛け合いも通常の掛け合いと同じく行ごと（l1[0,4)/l2[4,10]）。
    const tl = compileTimeline(project([s]));
    expect(tl.tracks.audio).toEqual([
      { id: 's1/l1', sceneId: 's1', lineId: 'l1', startSec: 0, endSec: 4, label: 'やあ' },
      { id: 's1/l2', sceneId: 's1', lineId: 'l2', startSec: 4, endSec: 10, label: 'どうも' },
    ]);
    expect(tl.tracks.telop).toEqual([
      { id: 's1/l1', sceneId: 's1', lineId: 'l1', startSec: 0, endSec: 4, label: 'やあ' },
      { id: 's1/l2', sceneId: 's1', lineId: 'l2', startSec: 4, endSec: 10, label: 'どうも' },
    ]);
  });

  it('startSec も音声長も無い複数行は 0秒区間を出さない（末尾行のみ場面尺で残る）', () => {
    const s = scene({
      sceneId: 's1',
      durationSec: 6,
      lines: [
        { lineId: 'l1', text: 'A', status: 'idle' },
        { lineId: 'l2', text: 'B', status: 'idle' },
      ],
    });
    const tl = compileTimeline(project([s]));
    // l1 は [0,0]（0秒）で除外、l2 が [0,6] で残る（sceneSegmentSpecs と同じ挙動＝ゼロ幅クリップを描かせない）。
    expect(tl.tracks.audio).toEqual([{ id: 's1/l2', sceneId: 's1', lineId: 'l2', startSec: 0, endSec: 6, label: 'B' }]);
    expect(tl.tracks.telop).toEqual([{ id: 's1/l2', sceneId: 's1', lineId: 'l2', startSec: 0, endSec: 6, label: 'B' }]);
  });

  it('字幕 OFF（subtitleEnabledDefault=false）はテロップに出ないが音声は残る', () => {
    const tl = compileTimeline(project([scene({ sceneId: 's1', durationSec: 5, subtitleEnabledDefault: false })]));
    expect(tl.tracks.telop).toEqual([]);
    expect(tl.tracks.audio).toHaveLength(1);
  });
});

describe('compileTimeline：BGM トラック', () => {
  it('有効＋標準BGM選択で全体1本のクリップ（全場面継承＝1区間・ラベルは曲名）', () => {
    const tl = compileTimeline(
      project([scene({ sceneId: 's1', durationSec: 8 })], { enabled: true, bundledBgmId: 'summer-morning' }),
    );
    expect(tl.tracks.bgm).toEqual([{ id: 'bgm_0', startSec: 0, endSec: 8, label: '爽やかな朝' }]);
  });

  it('有効でも音源未選択なら BGM クリップは出さない', () => {
    const tl = compileTimeline(
      project([scene({ sceneId: 's1', durationSec: 8 })], { enabled: true, bundledBgmId: null, assetId: null }),
    );
    expect(tl.tracks.bgm).toEqual([]);
  });

  it('無効なら BGM クリップは出さない', () => {
    const tl = compileTimeline(
      project([scene({ sceneId: 's1', durationSec: 8 })], { enabled: false, bundledBgmId: 'summer-morning' }),
    );
    expect(tl.tracks.bgm).toEqual([]);
  });
});

describe('compileTimeline：timelineOverlay の合成（ADR-0018）', () => {
  it('場面アンカーのテロップクリップは場面のグローバル開始＋相対秒に置かれる', () => {
    const scenes = [
      scene({ sceneId: 's1', durationSec: 8 }),
      scene({ sceneId: 's2', durationSec: 6, transition: { in: TRANSITION_TYPE.fade, durationSec: 2 } }),
    ];
    const overlay = { clips: [{ id: 'ovclip_001', track: 'telop', anchorSceneId: 's2', startSec: 1, durationSec: 2, text: '補足' }] };
    const tl = compileTimeline(project(scenes, undefined, overlay));
    // s2 は 6 から。相対1 → グローバル7、[7,9]。
    expect(tl.tracks.telop.find((c) => c.id === 'ovclip_001')).toEqual({
      id: 'ovclip_001', sceneId: 's2', startSec: 7, endSec: 9, label: '補足', origin: 'overlay',
    });
  });

  it('anchorSceneId 無しのクリップは絶対時間で置かれる', () => {
    const overlay = { clips: [{ id: 'ovclip_002', track: 'telop', startSec: 3, durationSec: 2, text: '絶対' }] };
    const tl = compileTimeline(project([scene({ sceneId: 's1', durationSec: 10 })], undefined, overlay));
    expect(tl.tracks.telop.find((c) => c.id === 'ovclip_002')).toEqual({
      id: 'ovclip_002', sceneId: undefined, startSec: 3, endSec: 5, label: '絶対', origin: 'overlay',
    });
  });

  it('存在しない場面アンカーのクリップは無視する（V_overlay）', () => {
    const overlay = { clips: [{ id: 'ovclip_003', track: 'telop', anchorSceneId: 'sX', startSec: 1, durationSec: 2, text: '孤立' }] };
    const tl = compileTimeline(project([scene({ sceneId: 's1', durationSec: 8 })], undefined, overlay));
    expect(tl.tracks.telop.some((c) => c.id === 'ovclip_003')).toBe(false);
  });

  it('overlay 未設定なら合成なし（従来どおり）', () => {
    const tl = compileTimeline(project([scene({ sceneId: 's1', durationSec: 8 })]));
    expect(tl.tracks.telop.every((c) => c.id.startsWith('s1/'))).toBe(true);
  });
});

describe('場面ごとBGM（ADR-0018 ③(7)）', () => {
  const proj = { enabled: true, bundledBgmId: 'summer-morning', volume: 0.25 };
  it('resolveSceneBgm：場面ごと ?? プロジェクト（null=継承）', () => {
    expect(resolveSceneBgm(scene({ sceneId: 's1', durationSec: 8 }), proj as never)).toBe(proj);
    const own = { enabled: true, bundledBgmId: 'found-new-hope' };
    expect(resolveSceneBgm(scene({ sceneId: 's1', durationSec: 8, bgmSettings: own }), proj as never)).toBe(own);
  });
  it('全場面が継承＝1区間 [0, 総尺]（後方互換）・ラベルは同梱曲名', () => {
    const tl = compileTimeline(project([scene({ sceneId: 's1', durationSec: 8 }), scene({ sceneId: 's2', durationSec: 6 })], proj));
    expect(tl.tracks.bgm).toEqual([{ id: 'bgm_0', startSec: 0, endSec: 14, label: '爽やかな朝' }]);
  });
  it('場面が別の曲に上書き＝区間が分かれる（連続する同じ曲はまとまる）', () => {
    const tl = compileTimeline(
      project(
        [
          scene({ sceneId: 's1', durationSec: 8 }),
          scene({ sceneId: 's2', durationSec: 6, bgmSettings: { enabled: true, bundledBgmId: 'found-new-hope', volume: 0.25 } }),
          scene({ sceneId: 's3', durationSec: 5 }),
        ],
        proj,
      ),
    );
    expect(tl.tracks.bgm).toEqual([
      { id: 'bgm_0', startSec: 0, endSec: 8, label: '爽やかな朝' },
      { id: 'bgm_1', startSec: 8, endSec: 14, label: '前向きなポップ' },
      { id: 'bgm_2', startSec: 14, endSec: 19, label: '爽やかな朝' },
    ]);
  });
  it('enabled:false の場面は無音＝区間を割ってスキップ', () => {
    const tl = compileTimeline(
      project(
        [
          scene({ sceneId: 's1', durationSec: 8 }),
          scene({ sceneId: 's2', durationSec: 6, bgmSettings: { enabled: false } }),
          scene({ sceneId: 's3', durationSec: 5 }),
        ],
        proj,
      ),
    );
    expect(tl.tracks.bgm).toEqual([
      { id: 'bgm_0', startSec: 0, endSec: 8, label: '爽やかな朝' },
      { id: 'bgm_1', startSec: 14, endSec: 19, label: '爽やかな朝' },
    ]);
  });
  it('BGM なし（プロジェクト・場面とも）＝空トラック', () => {
    expect(compileTimeline(project([scene({ sceneId: 's1', durationSec: 8 })])).tracks.bgm).toEqual([]);
    // プロジェクトは有効だが場面が全部無音＝空。
    const allOff = compileTimeline(project([scene({ sceneId: 's1', durationSec: 8, bgmSettings: { enabled: false } })], proj));
    expect(allOff.tracks.bgm).toEqual([]);
  });
});

describe('sceneLocalTelops / activeTelopsAt / assignTelopRows（テロップ実描画・並行テロップ・ADR-0018 ③(8)）', () => {
  const scenes = [
    scene({ sceneId: 's1', durationSec: 8 }),
    scene({ sceneId: 's2', durationSec: 6 }),
  ];
  it('場面と重なる overlay テロップを場面ローカル秒＋段へ切り出す（場面またぎは自分の部分だけ・単独は段0）', () => {
    const overlay = { clips: [
      { id: 'ovclip_001', track: 'telop', startSec: 6, durationSec: 4, text: 'またぎ' }, // グローバル 6〜10（s1:6-8 / s2:8-10）
    ] };
    const tl = compileTimeline(project(scenes, undefined, overlay));
    expect(sceneLocalTelops(tl, 's1')).toEqual([{ startSec: 6, endSec: 8, text: 'またぎ', row: 0 }]);
    expect(sceneLocalTelops(tl, 's2')).toEqual([{ startSec: 0, endSec: 2, text: 'またぎ', row: 0 }]);
  });
  it('時間が重なる複数テロップは段違いで返す（並行テロップ・③(8)）', () => {
    const overlay = { clips: [
      { id: 'ovclip_001', track: 'telop', startSec: 0, durationSec: 5, text: 'A' },
      { id: 'ovclip_002', track: 'telop', startSec: 2, durationSec: 3, text: 'B' }, // A(0-5) と重なる → 段1
    ] };
    const tl = compileTimeline(project(scenes, undefined, overlay));
    expect(sceneLocalTelops(tl, 's1')).toEqual([
      { startSec: 0, endSec: 5, text: 'A', row: 0 },
      { startSec: 2, endSec: 5, text: 'B', row: 1 },
    ]);
  });
  it('場面射影クリップ（行の字幕）や空文言・非重なりは対象外', () => {
    const overlay = { clips: [{ id: 'ovclip_001', track: 'telop', startSec: 0, durationSec: 2, text: '' }] };
    const tl = compileTimeline(project(scenes, undefined, overlay));
    // 行射影（origin なし）はテロップレーンにあっても対象外＝overlay 由来のみ。
    expect(sceneLocalTelops(tl, 's1')).toEqual([]);
    expect(sceneLocalTelops(tl, 'sX')).toEqual([]); // 不明場面は空
  });
  it('assignTelopRows: 重なるクリップは異なる段・重ならなければ段を再利用', () => {
    const rows = assignTelopRows([
      { id: 'c1', startSec: 0, endSec: 5 },
      { id: 'c2', startSec: 2, endSec: 4 }, // c1 と重なる → 段1
      { id: 'c3', startSec: 5, endSec: 8 }, // c1 と接する（重ならない）→ 段0 再利用
    ]);
    expect(rows.get('c1')).toBe(0);
    expect(rows.get('c2')).toBe(1);
    expect(rows.get('c3')).toBe(0);
  });
  it('activeTelopsAt は [start, end) で有効な全テロップ（段付き）を並行表示', () => {
    const ivs = [
      { startSec: 0, endSec: 5, text: 'A', row: 0 },
      { startSec: 2, endSec: 4, text: 'B', row: 1 },
    ];
    expect(activeTelopsAt(ivs, 0)).toEqual([{ text: 'A', row: 0 }]);
    expect(activeTelopsAt(ivs, 2)).toEqual([{ text: 'A', row: 0 }, { text: 'B', row: 1 }]); // 並行
    expect(activeTelopsAt(ivs, 4)).toEqual([{ text: 'A', row: 0 }]); // B 終了で A のみ
    expect(activeTelopsAt(ivs, 5)).toEqual([]); // end は含まない
  });
});

describe('compileTimeline：射影の忠実性と includeScene', () => {
  it('totalSec は transitionTimeline の effectiveTotalSec と一致する（書き出しと同じ境界計算）', () => {
    const scenes = [
      scene({ sceneId: 's1', durationSec: 8 }),
      scene({ sceneId: 's2', durationSec: 5, transition: { in: TRANSITION_TYPE.fade, durationSec: 2 } }),
      scene({ sceneId: 's3', durationSec: 6, transition: { in: TRANSITION_TYPE.slide, durationSec: 1, direction: TRANSITION_DIRECTION.right } }),
    ];
    const tl = compileTimeline(project(scenes));
    const durations = scenes.map((s) => s.durationSec);
    const resolved = scenes.map((s) => resolveTransition(s.transition));
    const boundaryDs = resolved.map((r, i) => (i === 0 || r.type === TRANSITION_TYPE.none ? 0 : r.durationSec));
    expect(tl.totalSec).toBe(transitionTimeline(durations, boundaryDs).effectiveTotalSec);
    // 場面末＝totalSec（連続性）。
    expect(tl.scenes[tl.scenes.length - 1].endSec).toBe(tl.totalSec);
  });

  it('includeScene で除外した場面は射影に出ず、順序も詰められる', () => {
    const tl = compileTimeline(
      project([
        scene({ sceneId: 's1', durationSec: 4 }),
        scene({ sceneId: 'sX', durationSec: 9 }),
        scene({ sceneId: 's2', durationSec: 5 }),
      ]),
      { includeScene: (s) => s.sceneId !== 'sX' },
    );
    expect(tl.scenes.map((s) => s.sceneId)).toEqual(['s1', 's2']);
    expect(tl.scenes.map((s) => [s.startSec, s.endSec])).toEqual([[0, 4], [4, 9]]);
    expect(tl.totalSec).toBe(9);
  });
});
