import { describe, expect, it } from 'vitest';
import type { Scene } from '../domain/project/types';
import type { Template } from '../domain/template/types';
import type { FillItem, ImageItem, TextItem } from './layout';
import { layoutScene } from './layout';
import { layoutToSvg } from './sceneSvg';

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
});
