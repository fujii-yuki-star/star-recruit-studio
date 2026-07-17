import { describe, expect, it } from 'vitest';
import type { Scene } from '../domain/project/types';
import type { Template } from '../domain/template/types';
import type { FillItem, ImageItem, LayoutItem, TextItem } from './layout';
import { DEFAULT_LINE_HEIGHT, SUBTITLE_BAND_PAD_EM, layoutScene, subtitleOverflowsCanvas } from './layout';
import { layoutToSvg } from './sceneSvg';
import { wrapText } from './textWrap';

// 字幕帯の実 [top, bottom]（描画と同じ wrapText の行数＋anchorBottom で算出・共有定数を参照）。段間の重なり検証に使う。
const bandRect = (item: TextItem): { top: number; bottom: number } => {
  const n = wrapText(item.text, item.w, item.fontSize, item.maxLines).length;
  const lh = item.fontSize * DEFAULT_LINE_HEIGHT;
  const top = item.y - (item.anchorBottom ? (n - 1) * lh : 0);
  return { top, bottom: top + lh * n + item.fontSize * SUBTITLE_BAND_PAD_EM };
};
// 上→下に並べ、隣接帯が重ならない（上の下端 ≤ 下の上端）か。
const noOverlap = (subs: TextItem[]): boolean => {
  const rects = subs.map(bandRect).sort((a, b) => a.top - b.top);
  for (let i = 0; i + 1 < rects.length; i += 1) if (rects[i].bottom > rects[i + 1].top + 1e-6) return false;
  return true;
};
// 全帯がキャンバス上端内（top ≥ 0）か（#533 P2・画面外に切れない）。
const allWithinCanvas = (subs: TextItem[]): boolean => subs.every((s) => bandRect(s).top >= 0);

const openingTemplate: Template = {
  schemaVersion: '1.0',
  templateId: 'opening_yuko_right_v1',
  name: 'オープニング・ゆうこ右',
  category: 'opening',
  aspectRatio: '16:9',
  canvas: { width: 1920, height: 1080 },
  defaults: { transitionIn: 'fade', transitionOut: 'fade', backgroundColor: '#ffffff' },
  layers: [
    { id: 'background', type: 'background', x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 },
    { id: 'title', type: 'text', textKey: 'title', x: 160, y: 360, w: 1100, h: 140, zIndex: 30, fontSize: 72, fontWeight: 'bold' },
    { id: 'subtitle', type: 'subtitle', textKey: 'subtitle', x: 240, y: 920, w: 1440, h: 90, zIndex: 50, fontSize: 38, background: { enabled: true, color: '#000000', opacity: 0.55, radius: 16 } },
    { id: 'logo', type: 'logo', x: 1640, y: 60, w: 220, h: 120, zIndex: 60 },
    { id: 'yuko', type: 'character', x: 1450, y: 600, w: 360, h: 420, zIndex: 40 },
  ],
};

const scene: Scene = {
  sceneId: 'scene_001',
  partId: 'part_001',
  order: 1,
  sceneType: 'opening',
  templateId: 'opening_yuko_right_v1',
  durationSec: 8,
  assetRefs: { background: 'asset_entrance_001', logo: 'asset_logo_001' },
  character: { enabled: true, characterId: 'yuko', poseAssetId: 'yuko_smile_001' },
  texts: { title: '株式会社サンプルへようこそ', main: '若手が活躍できる職場です', subtitle: '今日は会社の魅力を紹介します。' },
  narration: { text: 'こんにちは、ゆうこです。', status: 'none' },
  transition: { in: 'fade', out: 'fade', durationSec: 0.5 },
  warnings: [],
};

describe('layoutScene：タイムラインのテロップ（ADR-0018 テロップ実描画・並行テロップ③(8)）', () => {
  const telopItems = (layout: { items: LayoutItem[] }): TextItem[] =>
    layout.items.filter((i) => i.id.startsWith('overlay_telop')) as TextItem[];
  it('opts.telops で段付きの帯テキストが足される（プレビュー経路・書き出し帯PNGと同一 item）', () => {
    const layout = layoutScene(scene, openingTemplate, { telops: [{ text: 'ここがポイント', row: 0 }] });
    const t = telopItems(layout);
    expect(t).toHaveLength(1);
    expect(t[0].id).toBe('overlay_telop_0');
    expect(t[0].text).toBe('ここがポイント');
    expect(t[0].isSubtitle).toBe(false); // 「字幕を入れる」OFF でも消えない（独立要素）
    expect(layout.items[layout.items.length - 1].id).toBe('overlay_telop_0'); // 最前面＝末尾
    expect(t[0].y).toBe(Math.round(1080 * 0.06));
    expect(t[0].fontSize).toBe(Math.round(1080 * 0.045));
  });
  it('並行テロップ：段ごとに y が帯高さ分だけ下へずれる（③(8)）', () => {
    const layout = layoutScene(scene, openingTemplate, { telops: [{ text: 'A', row: 0 }, { text: 'B', row: 1 }] });
    const t = telopItems(layout);
    expect(t.map((i) => i.id)).toEqual(['overlay_telop_0', 'overlay_telop_1']);
    expect(t[0].y).toBe(Math.round(1080 * 0.06));
    expect(t[1].y).toBe(Math.round(1080 * (0.06 + 0.14))); // 段1 は帯高さ(0.14)分下
  });
  it('telopFontId（動画全体フォント）が item.fontId に載る＝場面フォントに左右されない（パリティ）', () => {
    const layout = layoutScene(scene, openingTemplate, { telops: [{ text: 'x', row: 0 }], telopFontId: 'kaitou-yokoku-gothic' });
    expect(telopItems(layout)[0].fontId).toBe('kaitou-yokoku-gothic');
    // 未指定は null（描画側 fontFamily へフォールバック）。
    const l2 = layoutScene(scene, openingTemplate, { telops: [{ text: 'x', row: 0 }] });
    expect(telopItems(l2)[0].fontId).toBeNull();
  });
  it('未指定/空では telop item を足さない（従来どおり）', () => {
    expect(telopItems(layoutScene(scene, openingTemplate))).toHaveLength(0);
    expect(telopItems(layoutScene(scene, openingTemplate, { telops: [] }))).toHaveLength(0);
  });
});

describe('layoutScene：場面の字幕トグル（subtitleEnabledDefault・#413/#495 レビュー）', () => {
  const subtitleItems = (layout: { items: LayoutItem[] }): TextItem[] =>
    layout.items.filter((i): i is TextItem => i.kind === 'text' && i.isSubtitle);

  it('既定（未設定/true）は静的字幕（texts.subtitle）を出す', () => {
    expect(subtitleItems(layoutScene(scene, openingTemplate))).toHaveLength(1);
    expect(subtitleItems(layoutScene({ ...scene, subtitleEnabledDefault: true }, openingTemplate))).toHaveLength(1);
  });

  it('subtitleEnabledDefault=false は静的字幕（単一ナレーション）を出さない＝トグルが preview/export に効く', () => {
    expect(subtitleItems(layoutScene({ ...scene, subtitleEnabledDefault: false }, openingTemplate))).toHaveLength(0);
  });

  it('掛け合いの行字幕（subtitleText 上書き）は scene 既定 false でも出る＝行が優先（override 経路は不変）', () => {
    const subs = subtitleItems(
      layoutScene({ ...scene, subtitleEnabledDefault: false }, openingTemplate, { subtitleText: '行の字幕' }),
    );
    expect(subs).toHaveLength(1);
    expect(subs[0].text).toBe('行の字幕');
  });

  it('同時開始：2人目の字幕を「上へ」自動配置＝重ならない別ボックス（ADR-0031・#530）', () => {
    const dialogue = { ...scene, lines: [
      { lineId: 'line_001', text: 'A', status: 'none' },
      { lineId: 'line_002', text: 'B', startWithPrevious: true, status: 'none' },
    ] } as Scene;
    // primary（先頭話者）は subtitleText='A'、同時行 line_002 は parallelLineIds から解決。
    const segment = { lineId: 'line_001', parallelLineIds: ['line_002'], subtitleText: 'A', startSec: 0, durationSec: 8, isFirst: true };
    const subs = subtitleItems(layoutScene(dialogue, openingTemplate, { subtitleText: 'A', subtitleSegment: segment }));
    expect(subs).toHaveLength(2); // primary＋2人目
    const primary = subs.find((s) => s.text === 'A')!;
    const second = subs.find((s) => s.text === 'B')!;
    expect(primary.y).toBe(920); // テンプレ位置（画面下）
    expect(primary.id).toBe('subtitle'); // primary は layer.id 据え置き（後方互換）
    expect(second.y).toBeLessThan(920); // 2人目は上へ
    expect(second.id).toBe('subtitle__sub1'); // 別ボックス（一意 id）
    expect(noOverlap(subs)).toBe(true); // 重ならない
  });

  it('長文で各帯が2行に折れても重ならない（実折返し行数で段を詰める・#533 P1）', () => {
    const long = 'あ'.repeat(50); // 幅1440/38≒37字ゆえ2行に折れる
    const dialogue = { ...scene, lines: [
      { lineId: 'line_001', text: long, status: 'none' },
      { lineId: 'line_002', text: long, startWithPrevious: true, status: 'none' },
    ] } as Scene;
    const segment = { lineId: 'line_001', parallelLineIds: ['line_002'], subtitleText: long, startSec: 0, durationSec: 8, isFirst: true };
    const subs = subtitleItems(layoutScene(dialogue, openingTemplate, { subtitleText: long, subtitleSegment: segment }));
    expect(subs).toHaveLength(2);
    expect(bandRect(subs[0]).bottom - bandRect(subs[0]).top).toBeGreaterThan(subs[0].fontSize * 1.9); // 実際に2行（1行帯より高い）
    expect(noOverlap(subs)).toBe(true);
  });

  it('3人同時（長文混在）でも各帯が重ならない（N人）', () => {
    const long = 'い'.repeat(45);
    const dialogue = { ...scene, lines: [
      { lineId: 'line_001', text: '短い', status: 'none' },
      { lineId: 'line_002', text: long, startWithPrevious: true, status: 'none' },
      { lineId: 'line_003', text: 'また短い', startWithPrevious: true, status: 'none' },
    ] } as Scene;
    const segment = { lineId: 'line_001', parallelLineIds: ['line_002', 'line_003'], subtitleText: '短い', startSec: 0, durationSec: 8, isFirst: true };
    const subs = subtitleItems(layoutScene(dialogue, openingTemplate, { subtitleText: '短い', subtitleSegment: segment }));
    expect(subs).toHaveLength(3);
    expect(noOverlap(subs)).toBe(true);
    expect(allWithinCanvas(subs)).toBe(true); // 3人は画面内に収まる
  });

  it('縦型（狭幅）で行数が増えても重ならない', () => {
    const portrait: Template = {
      ...openingTemplate, aspectRatio: '9:16', canvas: { width: 1080, height: 1920 },
      layers: openingTemplate.layers.map((l) => (l.id === 'subtitle' ? { ...l, x: 60, y: 1600, w: 960 } : l)),
    };
    const long = 'う'.repeat(40); // 幅960/38≒25字ゆえ2行に折れる
    const dialogue = { ...scene, lines: [
      { lineId: 'line_001', text: long, status: 'none' },
      { lineId: 'line_002', text: long, startWithPrevious: true, status: 'none' },
    ] } as Scene;
    const segment = { lineId: 'line_001', parallelLineIds: ['line_002'], subtitleText: long, startSec: 0, durationSec: 8, isFirst: true };
    const subs = subtitleItems(layoutScene(dialogue, portrait, { subtitleText: long, subtitleSegment: segment }));
    expect(subs).toHaveLength(2);
    expect(noOverlap(subs)).toBe(true);
    expect(allWithinCanvas(subs)).toBe(true); // 縦型2人も画面内
  });
});

describe('subtitleOverflowsCanvas（同時字幕の画面外はみ出し・#533 P2）', () => {
  const dialogueScene = (lines: unknown[]): Scene => ({ ...scene, lines } as Scene);
  const groupLines = (n: number, text: string): unknown[] =>
    Array.from({ length: n }, (_, i) => ({
      lineId: `line_${String(i + 1).padStart(3, '0')}`, text, status: 'none',
      ...(i > 0 ? { startWithPrevious: true } : {}),
    }));

  it('2〜3人（通常の長さ）は画面内＝はみ出さない（false）', () => {
    expect(subtitleOverflowsCanvas(dialogueScene(groupLines(2, 'こんにちは')), openingTemplate)).toBe(false);
    expect(subtitleOverflowsCanvas(dialogueScene(groupLines(3, 'こんにちは')), openingTemplate)).toBe(false);
  });

  it('8人×長文はスタックが画面上端を超える＝はみ出す（true）＝警告対象', () => {
    expect(subtitleOverflowsCanvas(dialogueScene(groupLines(8, 'あ'.repeat(50))), openingTemplate)).toBe(true);
  });

  it('逐次（同時開始なし）は積まないので対象外（false）', () => {
    const seq = dialogueScene([
      { lineId: 'line_001', text: 'あ'.repeat(50), status: 'none' },
      { lineId: 'line_002', text: 'あ'.repeat(50), status: 'none' }, // startWithPrevious なし＝逐次
    ]);
    expect(subtitleOverflowsCanvas(seq, openingTemplate)).toBe(false);
  });

  it('グループ transform で字幕層が上へ移動していれば、その実位置で判定する（実描画と一致・#533 レビュー）', () => {
    // subtitle 層をグループで y=920→100 へ上げる。2人同時（長文2行）でも上端を超える＝true（生 y=920 なら収まる）。
    const grouped: Template = {
      ...openingTemplate,
      groups: [{ id: 'group_001', members: ['subtitle'], transform: { x: 0, y: -820, rotation: 0, scale: 1 } }],
    };
    const long2 = dialogueScene(groupLines(2, 'あ'.repeat(50)));
    expect(subtitleOverflowsCanvas(long2, grouped)).toBe(true);
    expect(subtitleOverflowsCanvas(long2, openingTemplate)).toBe(false); // グループ無し＝生 y で収まる
  });

  it('字幕層がグループで非表示なら描画されない＝はみ出し判定の対象外（false）', () => {
    const hidden: Template = {
      ...openingTemplate,
      groups: [{ id: 'group_001', members: ['subtitle'], transform: { x: 0, y: 0, rotation: 0, scale: 1 }, hidden: true }],
    };
    const many = dialogueScene(groupLines(8, 'あ'.repeat(50))); // 通常なら true だが非表示なので false
    expect(subtitleOverflowsCanvas(many, hidden)).toBe(false);
  });

  it('2個目の字幕層のはみ出しも検出する（最初の層だけ見ない・#533 レビュー）', () => {
    const twoSub: Template = {
      ...openingTemplate,
      layers: [
        ...openingTemplate.layers,
        { id: 'subtitle2', type: 'subtitle', textKey: 'subtitle', x: 240, y: 30, w: 1440, h: 90, zIndex: 51, fontSize: 38 },
      ],
    };
    // 1個目（y=920）は収まるが、2個目（y=30・上寄り）は2人同時で上へ積むと画面上端を超える。
    const twoPeople = dialogueScene(groupLines(2, 'こんにちは'));
    expect(subtitleOverflowsCanvas(twoPeople, twoSub)).toBe(true);
    expect(subtitleOverflowsCanvas(twoPeople, openingTemplate)).toBe(false); // 1層だけなら収まる
  });

  it('下方向への移動で下端がはみ出すのも検出する（上端だけ見ない）', () => {
    const movedDown: Template = {
      ...openingTemplate,
      groups: [{ id: 'group_001', members: ['subtitle'], transform: { x: 0, y: 100, rotation: 0, scale: 1 } }],
    };
    // subtitle が y=920→1020 へ下がると primary 帯の下端（≒1092）が 1080 を超える。
    expect(subtitleOverflowsCanvas(dialogueScene(groupLines(2, 'こんにちは')), movedDown)).toBe(true);
  });

  it('90度回転で上下左右にはみ出すのも検出する（回転を判定に反映）', () => {
    const rotated: Template = {
      ...openingTemplate,
      groups: [{ id: 'group_001', members: ['subtitle'], transform: { x: 0, y: 0, rotation: 90, scale: 1 } }],
    };
    // 幅1440の帯を90度回すと縦≒1440になり、字幕位置を中心に上下へ大きくはみ出す。
    expect(subtitleOverflowsCanvas(dialogueScene(groupLines(2, 'こんにちは')), rotated)).toBe(true);
  });
});

describe('layoutScene：キーフレームアニメ（④・ADR-0019）', () => {
  const freeTemplate: Template = {
    schemaVersion: '1.0', templateId: 'free_v1', name: 'FREE', category: 'free',
    aspectRatio: '16:9', canvas: { width: 1920, height: 1080 }, layers: [],
  };
  const freeScene = {
    ...scene, sceneType: 'free', templateId: 'free_v1',
    freeLayout: [{ id: 'free_001', kind: 'shape', x: 10, y: 20, w: 100, h: 50, fillColor: '#ff0000', opacity: 1 }],
  } as unknown as Scene;
  const anim = {
    id: 'anim_001', sceneId: freeScene.sceneId, targetId: 'free_001',
    keyframes: [
      { timeSec: 0, x: 0, y: 0, scale: 1, opacity: 0, rotation: 0 },
      { timeSec: 2, x: 200, y: 100, scale: 2, opacity: 1, rotation: 90 },
    ],
  };
  it('timeSec 指定で対象 FREE 要素へ相対 transform を適用（scale 中心維持・x/y/rotation はオフセット）', () => {
    const layout = layoutScene(freeScene, freeTemplate, { timeSec: 1, animations: [anim] });
    const el = layout.items.find((i) => i.id === 'free_001') as FillItem;
    // t=1（中間・線形）：scale 1→2=1.5（w100→150/h50→75・中心維持で x−25/y−12.5）→ x オフセット+100/y+50／rotation 0+45／opacity 0.5。
    // x = 10 −25 +100 = 85・y = 20 −12.5 +50 = 57.5。
    expect(el).toMatchObject({ x: 85, y: 57.5, w: 150, h: 75, rotation: 45, opacity: 0.5 });
  });
  it('相対オフセットは要素の本来位置に追従する（後から動かしても再生が新位置基準・レビュー対応）', () => {
    // スライド相当（x オフセット −400 → 0）。要素の本来 x が違えば終点も本来 x に一致する（旧位置に固定されない）。
    const slide = { id: 'anim_005', sceneId: freeScene.sceneId, targetId: 'free_001', keyframes: [{ timeSec: 0, x: -400 }, { timeSec: 2, x: 0 }] };
    const moved = { ...freeScene, freeLayout: [{ id: 'free_001', kind: 'shape', x: 500, y: 20, w: 100, h: 50, fillColor: '#ff0000', opacity: 1 }] } as unknown as Scene;
    const el = layoutScene(moved, freeTemplate, { timeSec: 2, animations: [slide] }).items.find((i) => i.id === 'free_001') as FillItem;
    expect(el.x).toBe(500); // el.x(500) + オフセット0
  });
  it('timeSec 未指定は静止（後方互換・基準値のまま）', () => {
    const el = layoutScene(freeScene, freeTemplate, { animations: [anim] }).items.find((i) => i.id === 'free_001') as FillItem;
    expect(el).toMatchObject({ x: 10, y: 20, w: 100, h: 50, opacity: 1 });
    expect(el.rotation).toBeUndefined();
  });
  it('別場面のアニメ（sceneId 不一致）は適用しない', () => {
    const other = { ...anim, sceneId: 'scene_999' };
    const el = layoutScene(freeScene, freeTemplate, { timeSec: 1, animations: [other] }).items.find((i) => i.id === 'free_001') as FillItem;
    expect(el).toMatchObject({ x: 10, y: 20, opacity: 1 });
  });
  it('text 要素にも相対 transform（x/rotation オフセット）を適用する（fill 以外の経路）', () => {
    const textScene = { ...freeScene, freeLayout: [{ id: 'free_002', kind: 'text', x: 10, y: 20, w: 200, h: 60, text: 'あ' }] } as unknown as Scene;
    const textAnim = { id: 'anim_002', sceneId: freeScene.sceneId, targetId: 'free_002', keyframes: [{ timeSec: 0, x: 0, rotation: 0 }, { timeSec: 2, x: 100, rotation: 60 }] };
    const el = layoutScene(textScene, freeTemplate, { timeSec: 1, animations: [textAnim] }).items.find((i) => i.id === 'free_002') as TextItem;
    expect(el).toMatchObject({ kind: 'text', x: 60, rotation: 30 }); // x 10+50・rotation 0+30
  });
  it('text 要素に opacity（フェードイン）を適用する（(1c) 要素不透明度）', () => {
    const textScene = { ...freeScene, freeLayout: [{ id: 'free_002', kind: 'text', x: 10, y: 20, w: 200, h: 60, text: 'あ' }] } as unknown as Scene;
    const fade = { id: 'anim_003', sceneId: freeScene.sceneId, targetId: 'free_002', keyframes: [{ timeSec: 0, opacity: 0 }, { timeSec: 2, opacity: 1 }] };
    const el = layoutScene(textScene, freeTemplate, { timeSec: 1, animations: [fade] }).items.find((i) => i.id === 'free_002') as TextItem;
    expect(el.opacity).toBe(0.5); // t=1 の線形 0→1
  });
  it('slot（画像）要素にも opacity を適用する（(1c) 要素不透明度）', () => {
    const slotScene = { ...freeScene, freeLayout: [{ id: 'free_003', kind: 'slot', x: 0, y: 0, w: 100, h: 100, assetId: 'asset_001' }] } as unknown as Scene;
    const fade = { id: 'anim_004', sceneId: freeScene.sceneId, targetId: 'free_003', keyframes: [{ timeSec: 0, opacity: 0 }, { timeSec: 2, opacity: 1 }] };
    const el = layoutScene(slotScene, freeTemplate, { timeSec: 1, animations: [fade] }).items.find((i) => i.id === 'free_003') as ImageItem;
    expect(el.opacity).toBe(0.5);
  });

  // ④(3) グループ対象アニメ：合成前の group.transform に重なり、メンバー全員が動く。
  const groupScene = {
    ...freeScene,
    freeLayout: [
      { id: 'free_001', kind: 'shape', x: 10, y: 20, w: 100, h: 50, fillColor: '#ff0000', opacity: 1 },
      { id: 'free_002', kind: 'shape', x: 200, y: 20, w: 100, h: 50, fillColor: '#00ff00', opacity: 1 },
    ],
    groups: [{ id: 'group_001', members: ['free_001', 'free_002'], transform: { x: 0, y: 0, scale: 1, rotation: 0 } }],
  } as unknown as Scene;
  it('グループ slide はメンバー全員を同じオフセットで動かす（合成前 transform に加算）', () => {
    const gAnim = { id: 'anim_g1', sceneId: freeScene.sceneId, targetId: 'group_001', keyframes: [{ timeSec: 0, x: -100 }, { timeSec: 2, x: 0 }] };
    const items = layoutScene(groupScene, freeTemplate, { timeSec: 0, animations: [gAnim] }).items;
    expect((items.find((i) => i.id === 'free_001') as FillItem).x).toBe(-90); // 10 − 100
    expect((items.find((i) => i.id === 'free_002') as FillItem).x).toBe(100); // 200 − 100
  });
  it('グループ pop はメンバー全員を縮める（transform.scale に乗算）', () => {
    const gAnim = { id: 'anim_g2', sceneId: freeScene.sceneId, targetId: 'group_001', keyframes: [{ timeSec: 0, scale: 0.5 }, { timeSec: 2, scale: 1 }] };
    const items = layoutScene(groupScene, freeTemplate, { timeSec: 0, animations: [gAnim] }).items;
    expect((items.find((i) => i.id === 'free_001') as FillItem).w).toBe(50); // 100 × 0.5
    expect((items.find((i) => i.id === 'free_002') as FillItem).w).toBe(50);
  });
  it('グループ fade はメンバー全員の opacity を乗算で下げる', () => {
    const gAnim = { id: 'anim_g3', sceneId: freeScene.sceneId, targetId: 'group_001', keyframes: [{ timeSec: 0, opacity: 0 }, { timeSec: 2, opacity: 1 }] };
    const items = layoutScene(groupScene, freeTemplate, { timeSec: 1, animations: [gAnim] }).items;
    expect((items.find((i) => i.id === 'free_001') as FillItem).opacity).toBe(0.5); // 1 × 0.5
    expect((items.find((i) => i.id === 'free_002') as FillItem).opacity).toBe(0.5);
  });
});

describe('layoutScene', () => {
  it('テンプレ＋シーンを配置解決し zIndex 昇順で返す', () => {
    const layout = layoutScene(scene, openingTemplate);
    expect(layout.width).toBe(1920);
    expect(layout.height).toBe(1080);

    // zIndex 昇順
    const zs = layout.items.map((i) => i.zIndex);
    expect([...zs]).toEqual([...zs].sort((a, b) => a - b));

    const images = layout.items.filter((i): i is ImageItem => i.kind === 'image');
    // 背景は assetRefs.background があるので画像アイテム
    expect(images.find((i) => i.role === 'background')?.assetId).toBe('asset_entrance_001');
    // ゆうこは poseAssetId で配置
    expect(images.find((i) => i.role === 'character')?.assetId).toBe('yuko_smile_001');
    // ロゴ
    expect(images.find((i) => i.role === 'logo')?.assetId).toBe('asset_logo_001');

    // タイトル文の text アイテム
    const title = layout.items.find((i) => i.kind === 'text' && i.text.includes('ようこそ'));
    expect(title).toBeDefined();
  });

  it('background/slot/logo は scene.assetRefs 優先・無ければ layer.assetId（テンプレ既定素材）にフォールバック（ADR-0021）', () => {
    // 背景/ロゴに既定素材を持たせ、slot レイヤーも足して既定素材を持たせる（openingTemplate に slot は無いため）。
    const tmpl: Template = {
      ...openingTemplate,
      layers: [
        ...openingTemplate.layers.map((l) =>
          l.id === 'background' ? { ...l, assetId: 'tmpl_bg' } : l.id === 'logo' ? { ...l, assetId: 'tmpl_logo' } : l,
        ),
        { id: 'main', type: 'slot', x: 100, y: 100, w: 800, h: 600, zIndex: 15, assetId: 'tmpl_slot' },
      ],
    };
    const img = (items: LayoutItem[], role: string) =>
      items.find((i): i is ImageItem => i.kind === 'image' && i.role === role)?.assetId;
    // 場面が素材を持たない（{}）→ background/slot/logo の3つともテンプレ既定（layer.assetId）にフォールバック。
    const noRefs = layoutScene({ ...scene, assetRefs: {} }, tmpl).items;
    expect(img(noRefs, 'background')).toBe('tmpl_bg');
    expect(img(noRefs, 'slot')).toBe('tmpl_slot');
    expect(img(noRefs, 'logo')).toBe('tmpl_logo');
    // 場面が素材を持つ → 3つとも場面が優先（テンプレ既定を上書き）。
    const withRefs = layoutScene({ ...scene, assetRefs: { background: 'asset_entrance_001', main: 'asset_x', logo: 'asset_logo_001' } }, tmpl).items;
    expect(img(withRefs, 'background')).toBe('asset_entrance_001');
    expect(img(withRefs, 'slot')).toBe('asset_x');
    expect(img(withRefs, 'logo')).toBe('asset_logo_001');
    // 明示的 null も テンプレ既定へ委譲（?? は null/未指定の両方をフォールバック・ADR-0021。11 §5 の「null=非表示」を更新）。
    const nullRef = layoutScene({ ...scene, assetRefs: { background: null } }, tmpl).items;
    expect(img(nullRef, 'background')).toBe('tmpl_bg');
  });

  it('scene.slotFits は background/slot/logo すべてでテンプレ層の fit を上書きする（④）', () => {
    // openingTemplate に slot を足す（背景/slot の既定=cover、logo の既定=contain を各々上書き）。
    const tmpl: Template = {
      ...openingTemplate,
      layers: [...openingTemplate.layers, { id: 'main', type: 'slot', x: 0, y: 0, w: 100, h: 100, zIndex: 15 }],
    };
    const withMain: Scene = { ...scene, assetRefs: { ...scene.assetRefs, main: 'asset_x' } };
    const fitOf = (role: string, sc: Scene) =>
      layoutScene(sc, tmpl).items.find((i): i is ImageItem => i.kind === 'image' && i.role === role)?.fit;
    for (const [role, key] of [['background', 'background'], ['slot', 'main'], ['logo', 'logo']] as const) {
      expect(fitOf(role, { ...withMain, slotFits: { [key]: 'stretch' } })).toBe('stretch'); // 上書き
      expect(fitOf(role, withMain)).not.toBe('stretch'); // 既定（上書きが効いている証拠）
    }
  });

  it('subtitle レイヤー由来の text は isSubtitle=true、通常の text は false（字幕ON/OFF用）', () => {
    const texts = layoutScene(scene, openingTemplate).items.filter(
      (i): i is TextItem => i.kind === 'text',
    );
    expect(texts.find((i) => i.text.includes('ようこそ'))?.isSubtitle).toBe(false); // title
    expect(texts.find((i) => i.text.includes('紹介します'))?.isSubtitle).toBe(true); // subtitle
  });

  it('opts.subtitleText で字幕レイヤーの文言を上書きする（掛け合い・追加A/B）', () => {
    const texts = layoutScene(scene, openingTemplate, { subtitleText: '行の字幕' }).items.filter(
      (i): i is TextItem => i.kind === 'text',
    );
    expect(texts.find((i) => i.isSubtitle)?.text).toBe('行の字幕'); // 字幕は上書き
    expect(texts.find((i) => i.text.includes('ようこそ'))).toBeTruthy(); // 通常テキスト（title）は不変
  });

  it('opts.subtitleText=null で字幕を出さない（行で OFF）', () => {
    const subs = layoutScene(scene, openingTemplate, { subtitleText: null }).items.filter(
      (i) => i.kind === 'text' && i.isSubtitle,
    );
    expect(subs).toHaveLength(0);
  });

  it('scene.textFontIds[textKey] が該当 text アイテムの fontId に反映される（#178）', () => {
    const withFonts: Scene = { ...scene, textFontIds: { title: 'kaitou-yokoku-gothic' } };
    const texts = layoutScene(withFonts, openingTemplate).items.filter((i): i is TextItem => i.kind === 'text');
    expect(texts.find((i) => i.text.includes('ようこそ'))?.fontId).toBe('kaitou-yokoku-gothic'); // title
    expect(texts.find((i) => i.text.includes('紹介します'))?.fontId).toBeUndefined(); // subtitle 未設定＝継承
  });

  it('template の text/subtitle の strokeColor/strokeWidth が TextItem と SVG に反映される（#275）', () => {
    const strokeTemplate: Template = {
      ...openingTemplate,
      layers: openingTemplate.layers.map((l) => (l.id === 'title' ? { ...l, strokeColor: '#ff0000', strokeWidth: 3 } : l)),
    };
    const item = layoutScene(scene, strokeTemplate).items.find((i): i is TextItem => i.kind === 'text' && i.text.includes('ようこそ'));
    expect(item).toMatchObject({ strokeColor: '#ff0000', strokeWidth: 3 });
    const svg = layoutToSvg(layoutScene(scene, strokeTemplate));
    expect(svg).toContain('stroke="#ff0000"');
    expect(svg).toContain('stroke-width="3"');
    expect(svg).toContain('paint-order="stroke"'); // 塗りの下に縁取り（可読性）
  });

  it('template の縁取り：strokeWidth>0 で色未指定なら白を既定にする（外部テンプレ対策・#275）', () => {
    const widthOnly: Template = {
      ...openingTemplate,
      layers: openingTemplate.layers.map((l) => (l.id === 'title' ? { ...l, strokeWidth: 2 } : l)),
    };
    const item = layoutScene(scene, widthOnly).items.find((i): i is TextItem => i.kind === 'text' && i.text.includes('ようこそ'));
    expect(item?.strokeColor).toBe('#ffffff'); // 色未指定→白で縁取りが消えない
    expect(item?.strokeWidth).toBe(2);
  });

  it('layoutToSvg が 1920x1080 のSVGを生成し日本語テキストを含む', () => {
    const svg = layoutToSvg(layoutScene(scene, openingTemplate));
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox="0 0 1920 1080"');
    expect(svg).toContain('株式会社サンプルへようこそ');
    expect(svg).toContain('ゆうこ');
  });

  it('決定論的：同じ入力なら同じSVG（プレビュー/出力の一致の根拠）', () => {
    const a = layoutToSvg(layoutScene(scene, openingTemplate));
    const b = layoutToSvg(layoutScene(scene, openingTemplate));
    expect(a).toBe(b);
  });
});

describe('layoutScene character ゲート（#171・テンプレ依存・enabled 不参照）', () => {
  // ゆうこの表示有無はテンプレ（character レイヤーの有無）と poseAssetId で決まる。
  // 旧・場面ごとの表示トグル（character.enabled）は描画では参照しない（互換のため値は残す・01§7.3）。
  it('character.enabled が false でも poseAssetId があれば ゆうこを描画する', () => {
    const sceneEnabledFalse: Scene = {
      ...scene,
      character: { enabled: false, characterId: 'yuko', poseAssetId: 'yuko_smile_001' },
    };
    const character = layoutScene(sceneEnabledFalse, openingTemplate).items.find(
      (i): i is ImageItem => i.kind === 'image' && i.role === 'character',
    );
    expect(character?.assetId).toBe('yuko_smile_001');
  });

  it('poseAssetId が無ければ character.enabled が true でも描画しない', () => {
    const sceneNoPose: Scene = {
      ...scene,
      character: { enabled: true, characterId: 'yuko' }, // poseAssetId 無し
    };
    const character = layoutScene(sceneNoPose, openingTemplate).items.find(
      (i): i is ImageItem => i.kind === 'image' && i.role === 'character',
    );
    expect(character).toBeUndefined();
  });
});

describe('layoutScene freeLayout (FREE テンプレ・ADR-0008)', () => {
  const freeTemplate: Template = {
    schemaVersion: '1.0',
    templateId: 'free_canvas_v1',
    name: '自由配置',
    category: 'free',
    aspectRatio: '16:9',
    canvas: { width: 1920, height: 1080 },
    defaults: { backgroundColor: '#ffffff' },
    layers: [{ id: 'background', type: 'background', x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 }],
  };
  const freeScene: Scene = {
    sceneId: 'scene_001', partId: 'part_001', order: 1, sceneType: 'free',
    templateId: 'free_canvas_v1', durationSec: 8, assetRefs: {},
    character: { enabled: false, characterId: 'yuko' }, texts: {},
    narration: { text: '', status: 'none' }, warnings: [],
    freeLayout: [
      { id: 'free_001', kind: 'shape', x: 100, y: 100, w: 400, h: 200, zIndex: 5, shapeType: 'ellipse', fillColor: '#ff0000', opacity: 0.5 },
      { id: 'free_002', kind: 'slot', x: 200, y: 200, w: 600, h: 400, zIndex: 10, assetId: 'asset_x', fit: 'cover' },
      { id: 'free_003', kind: 'text', x: 900, y: 150, w: 700, h: 120, zIndex: 20, text: 'タイトル<&>', fontSize: 60, color: '#222222', fontWeight: 'bold' },
    ],
  };

  it('freeLayout 要素を背景の上に zIndex 順で重ねる', () => {
    const layout = layoutScene(freeScene, freeTemplate);
    expect(layout.items.map((i) => i.zIndex)).toEqual([0, 5, 10, 20]); // bg / shape / slot / text
    const slot = layout.items.find((i): i is ImageItem => i.kind === 'image' && i.id === 'free_002');
    expect(slot?.assetId).toBe('asset_x');
    const shape = layout.items.find((i): i is FillItem => i.kind === 'fill' && i.id === 'free_001');
    expect(shape?.shapeType).toBe('ellipse');
  });

  it('shape ellipse は <ellipse>、text はエスケープして描画', () => {
    const svg = layoutToSvg(layoutScene(freeScene, freeTemplate), {
      assetSrc: () => 'data:image/png;base64,AA==',
    });
    expect(svg).toContain('<ellipse');
    expect(svg).toContain('タイトル&lt;&amp;&gt;'); // < & > がエスケープ済み
    expect(svg).toContain('data:image/png;base64,AA=='); // slot 画像
  });

  it('新図形（star）＋枠線が layoutScene→SVG に反映される（#173・stroke 配線確認）', () => {
    const starScene: Scene = {
      ...freeScene,
      freeLayout: [
        { id: 'free_001', kind: 'shape', x: 100, y: 100, w: 200, h: 200, zIndex: 5, shapeType: 'star', fillColor: '#00ff00', opacity: 1, strokeColor: '#112233', strokeWidth: 4 },
      ],
    };
    const svg = layoutToSvg(layoutScene(starScene, freeTemplate));
    expect(svg).toContain('<polygon points="'); // star は polygon で描画
    expect(svg).toContain('stroke="#112233"'); // el.strokeColor が FillItem 経由で反映
    expect(svg).toContain('stroke-width="4"');
  });

  it('FREE text の el.fontId が TextItem.fontId に反映される（#178）', () => {
    const fontScene: Scene = {
      ...freeScene,
      freeLayout: [{ id: 'free_001', kind: 'text', x: 0, y: 0, w: 400, h: 100, zIndex: 5, text: 'あ', fontSize: 40, fontId: 'gen-interface-jp-display' }],
    };
    const item = layoutScene(fontScene, freeTemplate).items.find((i): i is TextItem => i.kind === 'text');
    expect(item?.fontId).toBe('gen-interface-jp-display');
  });

  it('FREE text/subtitle の背景帯（el.background.enabled）が TextItem.background に反映される（#529・可読性の下地）', () => {
    const bgScene: Scene = {
      ...freeScene,
      texts: { subtitle: 'ナレ字幕' }, // subtitle(narration) の解決元＝scene.texts.subtitle
      freeLayout: [
        { id: 'free_001', kind: 'text', x: 0, y: 0, w: 400, h: 100, zIndex: 5, text: 'あ', fontSize: 40, background: { enabled: true, color: '#112233', opacity: 0.4, radius: 8 } },
        { id: 'free_002', kind: 'subtitle', x: 0, y: 200, w: 400, h: 100, zIndex: 6, subtitleSource: { kind: 'narration' }, background: { enabled: true } }, // 既定値で埋まる
        { id: 'free_003', kind: 'text', x: 0, y: 400, w: 400, h: 100, zIndex: 7, text: 'い', background: { enabled: false } }, // OFF → 帯なし
        { id: 'free_004', kind: 'text', x: 0, y: 600, w: 400, h: 100, zIndex: 8, text: 'う' }, // 未指定 → 帯なし
      ],
    } as unknown as Scene;
    const items = layoutScene(bgScene, freeTemplate).items;
    const byId = (id: string) => items.find((i): i is TextItem => i.kind === 'text' && i.id === id)!;
    expect(byId('free_001').background).toEqual({ color: '#112233', opacity: 0.4, radius: 8 });
    expect(byId('free_002').background).toEqual({ color: '#000000', opacity: 0.55, radius: 16 }); // enabled のみ＝既定で補完
    expect(byId('free_003').background).toBeUndefined(); // enabled:false は帯を付けない
    expect(byId('free_004').background).toBeUndefined(); // 未指定も帯なし（後方互換）
  });

  it('通常テンプレ（category!==free）の場面に freeLayout が付いていても描画しない（category ガード）', () => {
    // 防御: 通常テンプレ（opening）に誤って freeLayout が混入しても無視する。
    const sceneWithStrayFree: Scene = {
      ...scene,
      freeLayout: [{ id: 'free_001', kind: 'shape', x: 0, y: 0, w: 100, h: 100, shapeType: 'rect', fillColor: '#000000' }],
    };
    const layout = layoutScene(sceneWithStrayFree, openingTemplate); // category === 'opening'
    expect(layout.items.find((i) => i.id === 'free_001')).toBeUndefined();
  });

  it('FREE 要素の rotation が LayoutItem と SVG の rotate（中心軸）に反映される（#208）', () => {
    const rotScene: Scene = {
      ...freeScene,
      freeLayout: [{ id: 'free_001', kind: 'shape', x: 100, y: 100, w: 200, h: 100, zIndex: 5, shapeType: 'rect', fillColor: '#00ff00', rotation: 30 }],
    };
    const layout = layoutScene(rotScene, freeTemplate);
    expect(layout.items.find((i) => i.id === 'free_001')?.rotation).toBe(30);
    // 中心 (100+100, 100+50)=(200,150) を軸に rotate。
    expect(layoutToSvg(layout)).toContain('transform="rotate(30 200 150)"');
  });

  it('scene.groups の平行移動が FREE 要素の LayoutItem に前合成される（ADR-0022・パリティ）', () => {
    const groupedScene: Scene = {
      ...freeScene,
      freeLayout: [{ id: 'free_001', kind: 'shape', x: 100, y: 100, w: 40, h: 20, zIndex: 5, shapeType: 'rect', fillColor: '#00ff00' }],
      groups: [{ id: 'group_001', members: ['free_001'], transform: { x: 50, y: -20, rotation: 0, scale: 1 } }],
    };
    const item = layoutScene(groupedScene, freeTemplate).items.find((i) => i.id === 'free_001');
    expect(item?.x).toBeCloseTo(150); // 100 + 50
    expect(item?.y).toBeCloseTo(80); // 100 - 20
  });

  it('グループ回転が要素の rotation＋中心へ合成され SVG rotate に出る（ADR-0022・パリティ）', () => {
    const rotGroupScene: Scene = {
      ...freeScene,
      freeLayout: [{ id: 'free_001', kind: 'shape', x: 100, y: 100, w: 40, h: 20, zIndex: 5, shapeType: 'rect', fillColor: '#00ff00' }],
      groups: [{ id: 'group_001', members: ['free_001'], transform: { x: 0, y: 0, rotation: 90, scale: 1 } }],
    };
    const layout = layoutScene(rotGroupScene, freeTemplate);
    expect(layout.items.find((i) => i.id === 'free_001')?.rotation).toBeCloseTo(90); // 単一メンバー＝中心(120,110)固定で rotation のみ +90
    expect(layoutToSvg(layout)).toContain('transform="rotate(90 120 110)"');
  });

  it('hidden グループのメンバーは描画されない（ADR-0022）', () => {
    const hiddenScene: Scene = {
      ...freeScene,
      freeLayout: [{ id: 'free_001', kind: 'shape', x: 0, y: 0, w: 10, h: 10, shapeType: 'rect', fillColor: '#000000' }],
      groups: [{ id: 'group_001', members: ['free_001'], transform: { x: 0, y: 0, rotation: 0, scale: 1 }, hidden: true }],
    };
    const layout = layoutScene(hiddenScene, freeTemplate);
    expect(layout.items.find((i) => i.id === 'free_001')).toBeUndefined();
  });

  it('template.groups の平行移動がテンプレ層の LayoutItem に前合成される（ADR-0022・パリティ）', () => {
    const grouped: Template = {
      ...openingTemplate,
      groups: [{ id: 'group_001', members: ['background'], transform: { x: 50, y: -20, rotation: 0, scale: 1 } }],
    };
    const item = layoutScene(scene, grouped).items.find((i) => i.id === 'background');
    expect(item?.x).toBeCloseTo(50); // 0 + 50
    expect(item?.y).toBeCloseTo(-20); // 0 - 20
  });

  it('hidden グループのテンプレ層は描画されない（ADR-0022）', () => {
    const grouped: Template = {
      ...openingTemplate,
      groups: [{ id: 'group_001', members: ['background'], transform: { x: 0, y: 0, rotation: 0, scale: 1 }, hidden: true }],
    };
    expect(layoutScene(scene, grouped).items.find((i) => i.id === 'background')).toBeUndefined();
  });

  it('rotation 未指定/0 は rotate でくるまない（出力 SVG の差分を最小化）', () => {
    const svg = layoutToSvg(layoutScene(freeScene, freeTemplate)); // freeScene は rotation なし
    expect(svg).not.toContain('rotate(');
  });

  it('FREE text の体裁（行間/揃え/縁取り）が LayoutItem と SVG に反映される（#209）', () => {
    const styledScene: Scene = {
      ...freeScene,
      freeLayout: [{ id: 'free_001', kind: 'text', x: 100, y: 100, w: 400, h: 200, zIndex: 5, text: 'あ', fontSize: 40, textAlign: 'center', strokeColor: '#112233', strokeWidth: 3, lineHeight: 2 }],
    };
    const item = layoutScene(styledScene, freeTemplate).items.find((i): i is TextItem => i.kind === 'text');
    expect(item).toMatchObject({ textAlign: 'center', strokeColor: '#112233', strokeWidth: 3, lineHeight: 2 });
    expect(item?.maxLines).toBe(2); // h200 /(fontSize40 * lineHeight2) = 2（行間が行数計算に効く）
    const svg = layoutToSvg(layoutScene(styledScene, freeTemplate));
    expect(svg).toContain('text-anchor="middle"'); // 中央揃え
    expect(svg).toContain('x="300"'); // 中央 x = 100 + 400/2
    expect(svg).toContain('stroke="#112233"'); // 縁取り
    expect(svg).toContain('stroke-width="3"');
    expect(svg).toContain('paint-order="stroke"'); // 塗りの下に縁取り（可読性）
  });

  it('FREE text の体裁が未指定なら左揃え・縁取りなし（既定）', () => {
    const plain: Scene = { ...freeScene, freeLayout: [{ id: 'free_001', kind: 'text', x: 0, y: 0, w: 200, h: 80, zIndex: 5, text: 'あ', fontSize: 40 }] };
    const svg = layoutToSvg(layoutScene(plain, freeTemplate));
    expect(svg).toContain('text-anchor="start"'); // 左揃え
    expect(svg).not.toContain('paint-order'); // 縁取りなし
  });

  it('FREE text の揃えで text-anchor と x が変わる（左=左端 / 右=右端）', () => {
    const svgFor = (textAlign: 'left' | 'right') =>
      layoutToSvg(layoutScene({ ...freeScene, freeLayout: [{ id: 'free_001', kind: 'text', x: 100, y: 100, w: 400, h: 80, zIndex: 5, text: 'あ', fontSize: 40, textAlign }] }, freeTemplate));
    expect(svgFor('left')).toContain('text-anchor="start"');
    expect(svgFor('left')).toContain('x="100"'); // 左端＝item.x
    expect(svgFor('right')).toContain('text-anchor="end"');
    expect(svgFor('right')).toContain('x="500"'); // 右端＝item.x + item.w = 100+400
  });

  it('hidden の FREE 要素は描画しない（レイヤー一覧で隠す・#210）', () => {
    const withHidden: Scene = {
      ...freeScene,
      freeLayout: [
        { id: 'free_001', kind: 'shape', x: 0, y: 0, w: 100, h: 100, zIndex: 5, shapeType: 'rect', fillColor: '#000000', hidden: true },
        { id: 'free_002', kind: 'shape', x: 0, y: 0, w: 100, h: 100, zIndex: 6, shapeType: 'rect', fillColor: '#111111' },
      ],
    };
    const items = layoutScene(withHidden, freeTemplate).items;
    expect(items.find((i) => i.id === 'free_001')).toBeUndefined(); // 非表示は除外
    expect(items.find((i) => i.id === 'free_002')).toBeDefined();
  });
});

describe('layoutScene：FREE 字幕要素の描画（ADR-0029）', () => {
  const freeTemplate: Template = {
    schemaVersion: '1.0', templateId: 'free_v1', name: 'FREE', category: 'free',
    aspectRatio: '16:9', canvas: { width: 1920, height: 1080 }, layers: [],
  } as Template;
  const subEl = (subtitleSource?: unknown) => ({
    id: 'free_sub', kind: 'subtitle', x: 240, y: 900, w: 1440, h: 120,
    fontSize: 52, color: '#ffffff', strokeColor: '#000000', strokeWidth: 6,
    ...(subtitleSource ? { subtitleSource } : {}),
  });
  const subItem = (layout: { items: LayoutItem[] }): TextItem | undefined =>
    layout.items.find((i): i is TextItem => i.kind === 'text' && i.isSubtitle);

  it('単独ナレーション：subtitleSource 未指定は texts.subtitle を字幕として描く（isSubtitle=true・el 体裁）', () => {
    const s = { ...scene, sceneType: 'free', templateId: 'free_v1', texts: { subtitle: '読み上げの字幕' }, freeLayout: [subEl()] } as unknown as Scene;
    const item = subItem(layoutScene(s, freeTemplate));
    expect(item?.text).toBe('読み上げの字幕');
    expect(item?.isSubtitle).toBe(true);
    expect(item?.color).toBe('#ffffff');
    expect(item?.strokeWidth).toBe(6);
  });

  it('subtitleEnabledDefault=false は単独字幕を描かない', () => {
    const s = { ...scene, sceneType: 'free', templateId: 'free_v1', texts: { subtitle: 'S' }, subtitleEnabledDefault: false, freeLayout: [subEl()] } as unknown as Scene;
    expect(subItem(layoutScene(s, freeTemplate))).toBeUndefined();
  });

  it('掛け合い allLines：opts.subtitleSegment の字幕を描く（正準セグメント＝プレビュー=書き出し）', () => {
    const lines = [{ lineId: 'line_001', text: 'A', speaker: 3, status: 'none' }, { lineId: 'line_002', text: 'B', speaker: 2, status: 'none' }];
    const s = { ...scene, sceneType: 'free', templateId: 'free_v1', lines, freeLayout: [subEl({ kind: 'allLines' })] } as unknown as Scene;
    const item = subItem(layoutScene(s, freeTemplate, { subtitleSegment: { lineId: 'line_001', subtitleText: 'A', startSec: 0, durationSec: 4, isFirst: true } }));
    expect(item?.text).toBe('A');
    expect(item?.isSubtitle).toBe(true);
  });

  it('掛け合い allLines：間（isGap）セグメントでは描かない', () => {
    const lines = [{ lineId: 'line_001', text: 'A', status: 'none' }];
    const s = { ...scene, sceneType: 'free', templateId: 'free_v1', lines, freeLayout: [subEl({ kind: 'allLines' })] } as unknown as Scene;
    expect(subItem(layoutScene(s, freeTemplate, { subtitleSegment: { isGap: true, subtitleText: null, startSec: 0, durationSec: 2, isFirst: true } }))).toBeUndefined();
  });

  it('掛け合い speaker：対象話者(catalog 3)の行だけ描く（他話者のセグメントは非表示＝二重描画にしない）', () => {
    const lines = [{ lineId: 'line_001', text: 'A', speaker: 3, status: 'none' }, { lineId: 'line_002', text: 'B', speaker: 2, status: 'none' }];
    const s = { ...scene, sceneType: 'free', templateId: 'free_v1', lines, freeLayout: [subEl({ kind: 'speaker', speaker: { kind: 'catalog', speaker: 3 } })] } as unknown as Scene;
    const hit = subItem(layoutScene(s, freeTemplate, { subtitleSegment: { lineId: 'line_001', subtitleText: 'A', startSec: 0, durationSec: 4, isFirst: true } }));
    expect(hit?.text).toBe('A');
    const miss = subItem(layoutScene(s, freeTemplate, { subtitleSegment: { lineId: 'line_002', subtitleText: 'B', startSec: 4, durationSec: 4, isFirst: false } }));
    expect(miss).toBeUndefined();
  });

  it('通常テンプレ（非 FREE）は freeLayout の字幕要素を描かない（category ガード）', () => {
    const s = { ...scene, freeLayout: [subEl()] } as unknown as Scene;
    expect(layoutScene(s, openingTemplate).items.some((i) => i.id === 'free_sub')).toBe(false);
  });
});

describe('layoutScene：文字の体裁の場面別上書き（scene.textStyles・#555）', () => {
  const byId = (s: Scene, id: string): TextItem =>
    layoutScene(s, openingTemplate).items.find((i) => i.id === id) as TextItem;
  const subtitleItems = (layout: { items: LayoutItem[] }): TextItem[] =>
    layout.items.filter((i): i is TextItem => i.kind === 'text' && i.isSubtitle);

  it('未指定は従来どおりテンプレ層を継承する（後方互換）', () => {
    const t = byId(scene, 'title');
    expect(t.fontSize).toBe(72); // openingTemplate の title 層
    expect(t.fontWeight).toBe('bold');
  });

  it('色/サイズ/太さ/縁取りを場面別に上書きできる（text 層）', () => {
    const s = { ...scene, textStyles: { title: { color: '#ff0000', fontSize: 96, fontWeight: 'normal', strokeColor: '#123456', strokeWidth: 4 } } } as Scene;
    const t = byId(s, 'title');
    expect(t.color).toBe('#ff0000');
    expect(t.fontSize).toBe(96);
    expect(t.fontWeight).toBe('normal'); // テンプレの bold を上書きできる（継承と区別がつく向き）
    expect(t.strokeColor).toBe('#123456');
    expect(t.strokeWidth).toBe(4);
  });

  it('指定したプロパティだけが固有値＝残りはテンプレ層を継承する', () => {
    const s = { ...scene, textStyles: { title: { color: '#00ff00' } } } as Scene;
    const t = byId(s, 'title');
    expect(t.color).toBe('#00ff00');
    expect(t.fontSize).toBe(72); // テンプレのまま
    expect(t.fontWeight).toBe('bold'); // テンプレのまま
  });

  it('他の種別（textKey）には影響しない', () => {
    const s = { ...scene, textStyles: { title: { fontSize: 96 } } } as Scene;
    expect(byId(s, 'title').fontSize).toBe(96);
    expect(byId(s, 'subtitle').fontSize).toBe(38); // subtitle 層は据え置き
  });

  it('字幕層（subtitle）にも効く', () => {
    const s = { ...scene, textStyles: { subtitle: { color: '#ffff00', fontSize: 50 } } } as Scene;
    const sub = byId(s, 'subtitle');
    expect(sub.color).toBe('#ffff00');
    expect(sub.fontSize).toBe(50);
  });

  // 縁取りは「太さ>0 なのに色が無いと silent に消える」を防ぐ既定（#275/PR#289）が入っている。
  // 場面側で太さだけ足したときも、その既定が働く（＝解決後の値で判定している）こと。
  it('場面で縁取りの太さだけ足すと白が既定になる（縁取りが黙って消えない）', () => {
    const s = { ...scene, textStyles: { title: { strokeWidth: 3 } } } as Scene;
    const t = byId(s, 'title');
    expect(t.strokeWidth).toBe(3);
    expect(t.strokeColor).toBe('#ffffff');
  });

  it('場面で縁取りの太さを 0 にすると色は既定化しない（縁取りなし）', () => {
    const s = { ...scene, textStyles: { title: { strokeWidth: 0 } } } as Scene;
    expect(byId(s, 'title').strokeWidth).toBe(0);
    expect(byId(s, 'title').strokeColor).toBeUndefined();
  });

  // 上書きした fontSize は同時字幕の段組み（stackedSubtitleBands）にも渡す必要がある。
  // テンプレ層の値のまま段を積むと、場面で字幕を大きくしたときに帯どうしが重なる（#533 P1 の再来）。
  it('字幕を大きくしても同時字幕の帯が重ならない（段組みが上書き後のサイズを使う）', () => {
    const dialogue = { ...scene, textStyles: { subtitle: { fontSize: 76 } }, lines: [
      { lineId: 'line_001', text: 'あ'.repeat(30), status: 'none' },
      { lineId: 'line_002', text: 'い'.repeat(30), startWithPrevious: true, status: 'none' },
    ] } as Scene;
    const segment = { lineId: 'line_001', parallelLineIds: ['line_002'], subtitleText: 'あ'.repeat(30), startSec: 0, durationSec: 8, isFirst: true };
    const subs = subtitleItems(layoutScene(dialogue, openingTemplate, { subtitleText: 'あ'.repeat(30), subtitleSegment: segment }));
    expect(subs).toHaveLength(2);
    expect(subs.every((s) => s.fontSize === 76)).toBe(true); // 段組みも上書き後のサイズで計算されている
    expect(noOverlap(subs)).toBe(true);
  });
});
