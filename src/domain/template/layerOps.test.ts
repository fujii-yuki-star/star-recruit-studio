import { describe, expect, it } from 'vitest';
import type { Layer } from './types';
import { LAYER_TYPE, LAYER_TYPES, TEXT_KEY } from '../enums';
import { addLayer, createLayerId, DEFAULT_SLOT_TYPE, DEFAULT_TEXT_KEY_SUBTITLE, DEFAULT_TEXT_KEY_TEXT, duplicateLayer, editableTextKeys, removeLayer, requiredFieldsForLayerType, TEMPLATE_ADDABLE_LAYER_TYPES, updateLayer, usedTextKeys, textKeyOfLayer, withTextFontId } from './layerOps';

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

// 種別ごとのフォント上書きの置く／外す（差分再監査 9巡目 🟡＝規則は1か所）。
describe('withTextFontId', () => {
  it('置くと、残りの種別は引き継ぐ', () => {
    expect(withTextFontId({ title: 'a', main: 'b' }, 'main', 'c')).toEqual({ title: 'a', main: 'c' });
  });

  it('外すとキーごと落ちる', () => {
    expect(withTextFontId({ title: 'a', main: 'b' }, 'main', null)).toEqual({ title: 'a' });
  });

  it('最後の1つを外すと未設定になる（空の入れ物を残さない）', () => {
    expect(withTextFontId({ title: 'a' }, 'title', null)).toBeUndefined();
  });

  it('未設定へ置くと、その1つだけを持つ', () => {
    expect(withTextFontId(undefined, 'subtitle', 'a')).toEqual({ subtitle: 'a' });
  });

  it('未設定から外しても未設定のまま（空の入れ物を作らない）', () => {
    expect(withTextFontId(undefined, 'subtitle', null)).toBeUndefined();
  });

  it('元の入れ物は書き換えない（純粋）', () => {
    const before = { title: 'a' };
    withTextFontId(before, 'main', 'b');
    expect(before).toEqual({ title: 'a' });
  });
});

describe('requiredFieldsForLayerType（種別ごとの「無いと読み込めない」既定・#959）', () => {
  it('差し込み口には slotType が入る＝入れないと保存できても読み込めない', () => {
    expect(requiredFieldsForLayerType(LAYER_TYPE.slot)).toEqual({ slotType: DEFAULT_SLOT_TYPE });
  });
  it('文字系には textKey が入る（見出し / 字幕）', () => {
    expect(requiredFieldsForLayerType(LAYER_TYPE.text)).toEqual({ textKey: DEFAULT_TEXT_KEY_TEXT });
    expect(requiredFieldsForLayerType(LAYER_TYPE.subtitle)).toEqual({ textKey: DEFAULT_TEXT_KEY_SUBTITLE });
  });
  it('必須の追加項目が無い種別は空（余計な項目を作らない）', () => {
    for (const t of [LAYER_TYPE.background, LAYER_TYPE.character, LAYER_TYPE.shape, LAYER_TYPE.logo, LAYER_TYPE.decor]) {
      expect(requiredFieldsForLayerType(t)).toEqual({});
    }
  });
  it('表と schema が「ちょうど一致」する（どちらへずれても検出する）', async () => {
    // 正典 template.schema.json の allOf（if type → then required）を読み、表と**集合として**突き合わせる。
    // ⚠️ **期待値を手で写さない**＝schema に条件が増えたとき、この表だけ古いまま通るのを防ぐ（#959 の再発防止）。
    // ⚠️ **両方向を見る**（#960 レビュー）＝schema→表（必須が表に有るか）だけだと、
    // **schema が必須にしていない項目を表に足す**のを止められない。それをやると `withRequiredLayerFields` が
    // **いま読み込めている全テンプレ**に効いてしまい、絵が黙って変わる（例：立ち絵に `fit: cover` を足すと、
    // `fit` 未指定の立ち絵が既定の `contain` から変わる）。補正が安全なのは
    // **「必須欠け＝schema 不適合＝一度も読み込めていない文書」にしか当たらない**からで、
    // その前提を保つのが集合一致。
    const schema = (await import('../../../docs/yuko_recruit_docs/schemas/template.schema.json')).default as {
      $defs: { Layer: { allOf: { if: { properties: { type: { const?: string; enum?: string[] } } }; then: { required: string[] } }[] } };
    };
    const requiredOfSchema = (type: string): string[] =>
      schema.$defs.Layer.allOf
        .filter((r) => {
          const t = r.if.properties.type;
          return t.const === type || (t.enum ?? []).includes(type);
        })
        .flatMap((r) => r.then.required);
    for (const type of LAYER_TYPES) {
      expect(Object.keys(requiredFieldsForLayerType(type)).sort(), `${type}`).toEqual(requiredOfSchema(type).sort());
    }
  });
});

describe('addLayer が必須項目を入れる（#959）', () => {
  it('差し込み口を足すと slotType が入っている＝そのまま保存して読み戻せる', () => {
    const [l] = addLayer([], LAYER_TYPE.slot, canvas);
    expect(l.slotType).toBe(DEFAULT_SLOT_TYPE);
  });
  it('文字・字幕も従来どおり textKey が入る', () => {
    expect(addLayer([], LAYER_TYPE.text, canvas)[0].textKey).toBe(DEFAULT_TEXT_KEY_TEXT);
    expect(addLayer([], LAYER_TYPE.subtitle, canvas)[0].textKey).toBe(DEFAULT_TEXT_KEY_SUBTITLE);
  });
  it('足せる種別すべてが、追加した直後に schema の必須を満たす', () => {
    for (const type of TEMPLATE_ADDABLE_LAYER_TYPES) {
      const [l] = addLayer([], type, canvas);
      for (const [k, v] of Object.entries(requiredFieldsForLayerType(type))) {
        expect(l[k as keyof Layer], `${type} の ${k}`).toBe(v);
      }
    }
  });
});
