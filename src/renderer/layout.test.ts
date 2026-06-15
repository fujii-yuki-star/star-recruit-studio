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
});
