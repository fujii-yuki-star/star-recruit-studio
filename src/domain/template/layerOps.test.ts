import { describe, expect, it } from 'vitest';
import type { Layer } from './types';
import { LAYER_TYPE, TEXT_KEY } from '../enums';
import { addLayer, createLayerId, duplicateLayer, editableTextKeys, removeLayer, TEMPLATE_ADDABLE_LAYER_TYPES, updateLayer, usedTextKeys, textKeyOfLayer } from './layerOps';

const canvas = { width: 1920, height: 1080 };

describe('TEMPLATE_ADDABLE_LAYER_TYPES', () => {
  it('decor は開放しない（7種・ADR-0017）', () => {
    expect(TEMPLATE_ADDABLE_LAYER_TYPES).not.toContain('decor');
    expect(TEMPLATE_ADDABLE_LAYER_TYPES).toEqual(['background', 'slot', 'text', 'subtitle', 'character', 'shape', 'logo']);
  });
});

describe('createLayerId', () => {
  it('layer_NNN を採番し、空き番号を埋める', () => {
    expect(createLayerId([])).toBe('layer_001');
    const layers: Layer[] = [{ id: 'layer_001', type: 'text', x: 0, y: 0, w: 10, h: 10 }];
    expect(createLayerId(layers)).toBe('layer_002');
    // 記述的 id（bg 等）は無視して layer_NNN だけ見る。
    expect(createLayerId([{ id: 'bg', type: 'background', x: 0, y: 0, w: 10, h: 10 }])).toBe('layer_001');
  });

  it('空き番号を埋める（layer_001 と layer_003 があれば layer_002）', () => {
    const layers: Layer[] = [
      { id: 'layer_001', type: 'text', x: 0, y: 0, w: 10, h: 10 },
      { id: 'layer_003', type: 'shape', x: 0, y: 0, w: 10, h: 10 },
    ];
    expect(createLayerId(layers)).toBe('layer_002');
  });
});

describe('addLayer', () => {
  it('background は全面・最前面（zIndex 最大+1）', () => {
    const layers: Layer[] = [{ id: 'a', type: 'text', x: 0, y: 0, w: 10, h: 10, zIndex: 3 }];
    const next = addLayer(layers, 'background', canvas);
    const added = next[next.length - 1];
    expect(added).toMatchObject({ type: 'background', x: 0, y: 0, w: 1920, h: 1080, zIndex: 4 });
  });

  it('background 以外はキャンバス中央あたりに既定サイズで置く', () => {
    const next = addLayer([], 'text', canvas);
    const added = next[0];
    expect(added.type).toBe('text');
    expect(added.w).toBe(480);
    expect(added.h).toBe(240);
    expect(added.x).toBe(Math.round(1920 / 2 - 480 / 2)); // 720
    expect(added.zIndex).toBe(1);
  });

  it('text/subtitle は textKey 既定（見出し/字幕）を持って追加される（描画で空にならない・他型は未設定）', () => {
    expect(addLayer([], 'text', canvas)[0].textKey).toBe('title');
    expect(addLayer([], 'subtitle', canvas)[0].textKey).toBe('subtitle');
    expect(addLayer([], 'shape', canvas)[0].textKey).toBeUndefined();
  });
});

describe('removeLayer / updateLayer', () => {
  const layers: Layer[] = [
    { id: 'a', type: 'text', x: 0, y: 0, w: 10, h: 10 },
    { id: 'b', type: 'shape', x: 0, y: 0, w: 10, h: 10 },
  ];

  it('removeLayer：指定 id を取り除く', () => {
    expect(removeLayer(layers, 'a').map((l) => l.id)).toEqual(['b']);
  });

  it('updateLayer：指定 id の x/y/w/h 等を部分更新（id/type は不変）', () => {
    const next = updateLayer(layers, 'a', { x: 100, y: 200, w: 300 });
    expect(next.find((l) => l.id === 'a')).toMatchObject({ id: 'a', type: 'text', x: 100, y: 200, w: 300, h: 10 });
    expect(next.find((l) => l.id === 'b')).toBe(layers[1]); // 対象外は同一参照
  });
});

describe('usedTextKeys', () => {
  const g = (over: Partial<Layer>): Layer => ({ id: 'x', type: 'text', x: 0, y: 0, w: 10, h: 10, ...over });

  it('text 層は textKey 指定のものだけ・正規順（TEXT_KEYS 順）で返す', () => {
    const layers: Layer[] = [
      g({ id: '1', type: 'text', textKey: 'caption' }),
      g({ id: '2', type: 'text', textKey: 'title' }),
      g({ id: '3', type: 'text' }), // textKey 無し＝束縛しないので含めない
      g({ id: '4', type: 'shape' }), // 非テキスト層は無関係
    ];
    expect(usedTextKeys(layers)).toEqual(['title', 'caption']);
  });

  it('subtitle 層は textKey 未指定なら subtitle として数える（layoutScene の既定束縛に一致）', () => {
    expect(usedTextKeys([g({ id: '1', type: 'subtitle' })])).toEqual(['subtitle']);
    // subtitle 層に別 textKey を持たせればそちら。重複は1つに集約。
    expect(usedTextKeys([g({ id: '1', type: 'subtitle', textKey: 'main' }), g({ id: '2', type: 'text', textKey: 'main' })])).toEqual(['main']);
  });

  it('テキスト層が無ければ空', () => {
    expect(usedTextKeys([g({ id: '1', type: 'slot' }), g({ id: '2', type: 'background' })])).toEqual([]);
  });
});

// 文字の層の textKey は**解き方を1か所から**（#818 レビュー 🟡）＝呼び出し側で既定を書き直すと、
// 欄はあるのに「無い」と判断される（ドリルインが字幕の層で空振りしていた）。
describe('textKeyOfLayer（その層が使う textKey）', () => {
  const layer = (over: Record<string, unknown>): Layer =>
    ({ id: 'l1', x: 0, y: 0, w: 10, h: 10, ...over }) as Layer;

  it('文字の層は持っている textKey', () => {
    expect(textKeyOfLayer(layer({ type: 'text', textKey: 'title' }))).toBe('title');
  });

  it('字幕の層は**未指定なら subtitle**（描画の既定と同じ）', () => {
    expect(textKeyOfLayer(layer({ type: 'subtitle' }))).toBe('subtitle');
    expect(textKeyOfLayer(layer({ type: 'subtitle', textKey: 'body' }))).toBe('body');
  });

  it('文字を持たない層は null', () => {
    expect(textKeyOfLayer(layer({ type: 'slot' }))).toBeNull();
    expect(textKeyOfLayer(layer({ type: 'text' }))).toBeNull(); // 文字の層でも textKey が無ければ欄は無い
  });

  it('欄の一覧（usedTextKeys）と同じ解き方（既定が食い違わない）', () => {
    const layers = [layer({ id: 'l1', type: 'subtitle' })];
    expect(usedTextKeys(layers)).toEqual([textKeyOfLayer(layers[0])]);
  });
});

describe('duplicateLayer（中身ごと複製・#772 候補4）', () => {
  const canvas = { width: 1920, height: 1080 };
  const base: Layer[] = [
    { id: 'layer_001', type: LAYER_TYPE.background, x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 },
    { id: 'layer_002', type: LAYER_TYPE.text, x: 100, y: 200, w: 400, h: 120, zIndex: 10, textKey: TEXT_KEY.title },
    { id: 'layer_003', type: LAYER_TYPE.logo, x: 50, y: 50, w: 200, h: 100, zIndex: 20 },
  ];

  // ⚠️ **「複製は中身ごと」**（#770 で FREE 要素に入れた流儀）＝体裁や紐づけまで写す。
  // ここが欠けると「複製したのに空の枠が増える」になる。
  it('中身ごと写す（変えるのは id・位置・重ね順だけ）', () => {
    const out = duplicateLayer(base, 'layer_002', canvas);
    const copy = out.find((l) => l.id !== 'layer_002' && l.type === LAYER_TYPE.text && l.id !== 'layer_001');
    expect(copy?.textKey).toBe(TEXT_KEY.title); // 紐づけを写している
    expect(copy?.w).toBe(400);
    expect(copy?.h).toBe(120);
    expect(copy?.id).not.toBe('layer_002');
  });

  // ⚠️ **真下に重ねない**＝同じ位置に置くと「増えていない」ように見える。
  it('少しずらして置く（枠の外へは出さない）', () => {
    const out = duplicateLayer(base, 'layer_002', canvas);
    const copy = out[out.findIndex((l) => l.id === 'layer_002') + 1];
    expect(copy.x).toBeGreaterThan(100);
    expect(copy.y).toBeGreaterThan(200);
    const edge = duplicateLayer(
      [{ id: 'layer_001', type: LAYER_TYPE.logo, x: 1900, y: 1070, w: 20, h: 10, zIndex: 0 }],
      'layer_001', canvas,
    );
    expect(edge[1].x + edge[1].w).toBeLessThanOrEqual(canvas.width);
    expect(edge[1].y + edge[1].h).toBeLessThanOrEqual(canvas.height);
  });

  // ⚠️ **元のすぐ手前へ**＝最前面へ飛ばすと「どれが増えたのか」を探しに行くことになる。
  it('元のすぐ手前に入る（最前面へ飛ばさない）', () => {
    const out = duplicateLayer(base, 'layer_002', canvas);
    const byZ = [...out].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0)).map((l) => l.id);
    expect(byZ[1]).toBe('layer_002');
    expect(byZ[2]).not.toBe('layer_003'); // コピーが間に入っている
    expect(byZ[3]).toBe('layer_003');
  });

  it('居ない id は何もしない（同一参照＝空の取り消しを作らない）', () => {
    expect(duplicateLayer(base, 'zzz', canvas)).toBe(base);
  });
});

// 直せる種別の一覧（差分再監査 6巡目 🟡・7巡目で直接テストを追加）。
//
// ⚠️ **書き出しの門は休眠のぶんも数えて断る**ので、欄が「いま使う種別」だけだと選び直す先が無い。
// 数える側は狭めず、直す側を広げる＝この関数がその「広げた側」の単一の参照元。
describe('editableTextKeys', () => {
  const textLayer = (textKey: string): Layer =>
    ({ id: `l_${textKey}`, type: 'text', textKey, x: 0, y: 0, w: 10, h: 10 }) as unknown as Layer;

  it('使う種別だけのときは、そのまま返す', () => {
    expect(editableTextKeys([textLayer('title')], undefined)).toEqual(['title']);
  });

  it('値が入っている種別も足す（休眠でも直せる）', () => {
    expect(editableTextKeys([textLayer('title')], { subtitle: 'gen-interface-jp' })).toEqual(['title', 'subtitle']);
  });

  it('両方に出てくる種別は1つにまとめる', () => {
    expect(editableTextKeys([textLayer('title')], { title: 'gen-interface-jp' })).toEqual(['title']);
  });

  it('層が無くても、値が入っていれば返す（見た目パターンが未解決の場面）', () => {
    expect(editableTextKeys([], { main: 'gen-interface-jp' })).toEqual(['main']);
  });

  it('null／未指定は「値が入っている」に数えない（明示の継承を欄に出さない）', () => {
    expect(editableTextKeys([], { title: null, main: undefined } as never)).toEqual([]);
  });

  it('並びは正規順（TEXT_KEYS 順）＝入れた順に依らない', () => {
    expect(editableTextKeys([textLayer('url')], { title: 'a', caption: 'b' } as never))
      .toEqual(['title', 'caption', 'url']);
  });

  it('何も無ければ空', () => {
    expect(editableTextKeys([], undefined)).toEqual([]);
  });
});
