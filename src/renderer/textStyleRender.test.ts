// 文字の体裁（影・字間・背景帯）の描画（#264）。
//
// ⚠️ **プレビューと書き出しは同じ Blink で描く**（`rasterize.ts`）ので、`feDropShadow` も
// `letter-spacing` もどちらでも同じ絵になる＝**パリティは構造で保たれる**（別々に検査しない）。
import { describe, expect, it } from 'vitest';
import { layoutToSvg } from './sceneSvg';
import type { SceneLayout } from './layout';

const layout = (over: Record<string, unknown> = {}): SceneLayout => ({
  width: 1920, height: 1080, backgroundColor: '#ffffff',
  items: [{
    id: 'free_001', kind: 'text', x: 100, y: 100, w: 800, h: 200,
    text: 'あいう', fontSize: 40, fontWeight: 'normal', color: '#ffffff',
    maxLines: 2, isSubtitle: false, ...over,
  }],
} as unknown as SceneLayout);

describe('字間（#264）', () => {
  /**
   * ⚠️ **未指定・0 のときは属性を出さない**＝**従来の出力は1バイトも変わらない**
   *（既に作った動画を開き直したときに絵が動かない）。
   */
  it('未指定・0 なら属性を出さない', () => {
    expect(layoutToSvg(layout())).not.toContain('letter-spacing');
    expect(layoutToSvg(layout({ letterSpacing: 0 }))).not.toContain('letter-spacing');
  });

  // ⚠️ **em で持つ**＝文字サイズを変えても詰め具合が変わらない。描くときに px へ直す。
  it('em を文字サイズに掛けて px にする', () => {
    expect(layoutToSvg(layout({ letterSpacing: 0.1 }))).toContain('letter-spacing="4"'); // 40px × 0.1
    expect(layoutToSvg(layout({ letterSpacing: 0.1, fontSize: 80 }))).toContain('letter-spacing="8"');
  });

  it('負の値で詰められる', () => {
    expect(layoutToSvg(layout({ letterSpacing: -0.05 }))).toContain('letter-spacing="-2"');
  });
});

describe('影（#264）', () => {
  it('未指定なら影を出さない（従来の出力は不変）', () => {
    const svg = layoutToSvg(layout());
    expect(svg).not.toContain('feDropShadow');
    expect(svg).not.toContain('filter=');
  });

  it('影があれば feDropShadow を敷く', () => {
    const svg = layoutToSvg(layout({ shadow: { enabled: true, color: '#112233', opacity: 0.4, blur: 8, dx: 3, dy: 4 } }));
    expect(svg).toContain('<feDropShadow dx="3" dy="4" stdDeviation="4"'); // ぼかしは半分（標準偏差）
    expect(svg).toContain('flood-color="#112233"');
    expect(svg).toContain('flood-opacity="0.4"');
    // id は**影の中身**から作る（要素の id ではない）＝定義と参照が対応していることを見る。
    const id = svg.match(/<filter id="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(svg).toContain(`filter="url(#${id})"`);
  });

  /**
   * ⚠️ **id は「影の中身」から作る**（要素の id ではない・PR #879 レビューで気づいた）＝
   * ① 中身が違えば id も違うので、**同じ id の filter が混ざって全部が最後の影になる**ことが無い。
   * ② **要素の id が変わっても絵が変わらない**＝「バラす」は要素に新しい id を振るので、
   *    要素 id から作ると**中身が同じなのに SVG が変わり**、前後一致の検査が落ちる。
   */
  it('影が複数あっても混ざらない（中身が違えば id が別）', () => {
    const two = {
      width: 1920, height: 1080, backgroundColor: '#fff',
      items: [
        { id: 'free_001', kind: 'text', x: 0, y: 0, w: 100, h: 50, text: 'あ', fontSize: 40, fontWeight: 'normal', color: '#fff', maxLines: 1, isSubtitle: false, shadow: { enabled: true, dx: 1 } },
        { id: 'free_002', kind: 'text', x: 0, y: 60, w: 100, h: 50, text: 'い', fontSize: 40, fontWeight: 'normal', color: '#fff', maxLines: 1, isSubtitle: false, shadow: { enabled: true, dx: 9 } },
      ],
    } as unknown as SceneLayout;
    const svg = layoutToSvg(two);
    const ids = [...svg.matchAll(/<filter id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(2); // 中身が違う＝別の filter
    for (const id of ids) expect(svg).toContain(`filter="url(#${id})"`);
  });

  /**
   * ⚠️ **同じ影は1つに畳む**＝id を中身から作るので、同じ影を使う要素が複数あると同じ定義が並ぶ
   *（同じ id の重複は行儀が悪い）。中身が同じなので**どれを残しても絵は変わらない**。
   */
  it('同じ影を使う要素は filter を1つ共有する', () => {
    const same = { enabled: true, color: '#000000', blur: 4, dx: 2, dy: 2 };
    const two = {
      width: 1920, height: 1080, backgroundColor: '#fff',
      items: [
        { id: 'free_001', kind: 'text', x: 0, y: 0, w: 100, h: 50, text: 'あ', fontSize: 40, fontWeight: 'normal', color: '#fff', maxLines: 1, isSubtitle: false, shadow: same },
        { id: 'free_002', kind: 'text', x: 0, y: 60, w: 100, h: 50, text: 'い', fontSize: 40, fontWeight: 'normal', color: '#fff', maxLines: 1, isSubtitle: false, shadow: same },
      ],
    } as unknown as SceneLayout;
    const svg = layoutToSvg(two);
    expect([...svg.matchAll(/<filter id=/g)]).toHaveLength(1);
  });

  /**
   * ⚠️ **要素の id が変わっても絵が変わらない**＝「バラす」（ADR-0032 決定23）は要素に新しい id を
   * 振るので、要素 id から filter の id を作ると**中身が同じなのに SVG が変わる**。
   */
  it('要素の id が違っても、影が同じなら絵が同じ', () => {
    const shadow = { enabled: true, color: '#112233', blur: 6 };
    const one = (id: string) => layoutToSvg(layout({ id, shadow }));
    expect(one('free_001')).toBe(one('clip_009_titleText'));
  });

  // ⚠️ **id に使えない文字は落とす**（色の `#` など）＝壊れた SVG を作らない。
  it('id に使えない文字が入っていても壊れない', () => {
    const svg = layoutToSvg(layout({ shadow: { enabled: true, color: '#aabbcc', dx: -1.5 } }));
    expect(svg).not.toMatch(/id="shadow-[^"]*[^A-Za-z0-9_"-]/);
  });
});

// ── 体裁が「運ばれる」経路（PR #879 レビュー 🔴）─────────────────────────
//
// ⚠️ **同じ変更で `background` は3経路とも運ばれたのに、`letterSpacing`/`shadow` だけ抜けた**＝
// 「効くべき場所を数え上げてから足す」ができていなかった。**経路ごとにテストを持つ**ことで、
// 次に体裁の項目を足したときも同じ形で気づける。
describe('体裁が運ばれる経路（#264・#879）', () => {
  const el = (over: Record<string, unknown> = {}) => ({
    id: 'free_001', kind: 'text', x: 0, y: 0, w: 800, h: 200, zIndex: 0,
    text: 'あいう', fontSize: 40, letterSpacing: 0.1,
    shadow: { enabled: true, color: '#123456', blur: 4, dx: 2, dy: 3 },
    ...over,
  });

  /**
   * ⚠️ **自由配置の文字にも影・字間が出る**＝以前は手組みで項目を並べていたので、
   * 新しい項目を足したときに FREE 側だけ漏れた。いまは通常テンプレと**同じ関数**
   *（`resolveTextStyle`）を通している。
   */
  it('自由配置の文字に影と字間が出る', async () => {
    const { layoutScene } = await import('./layout');
    const template = {
      schemaVersion: '1.0', templateId: 'free_v1', name: '自由配置', category: 'free',
      aspectRatio: '16:9', canvas: { width: 1920, height: 1080 }, defaults: { backgroundColor: '#fff' },
      layers: [],
    } as never;
    const scene = {
      sceneId: 's1', partId: 'p1', order: 1, sceneType: 'free', templateId: 'free_v1',
      durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: 'yuko' },
      texts: {}, narration: { text: '', status: 'none' }, warnings: [], freeLayout: [el()],
    } as never;
    const item = layoutScene(scene, template).items.find((i) => i.kind === 'text');
    expect(item).toMatchObject({ letterSpacing: 0.1, shadow: { color: '#123456', blur: 4 } });
  });

  // ⚠️ **自由配置の字幕も同じ**（文字だけ直して字幕を忘れる、を作らない）。
  it('自由配置の字幕にも影と字間が出る', async () => {
    const { layoutScene } = await import('./layout');
    const template = {
      schemaVersion: '1.0', templateId: 'free_v1', name: '自由配置', category: 'free',
      aspectRatio: '16:9', canvas: { width: 1920, height: 1080 }, defaults: { backgroundColor: '#fff' },
      layers: [],
    } as never;
    const scene = {
      sceneId: 's1', partId: 'p1', order: 1, sceneType: 'free', templateId: 'free_v1',
      durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: 'yuko' },
      texts: { subtitle: 'じまく' }, narration: { text: '', status: 'none' }, warnings: [],
      freeLayout: [el({ kind: 'subtitle', text: undefined })],
    } as never;
    const item = layoutScene(scene, template).items.find((i) => i.kind === 'text');
    expect(item).toMatchObject({ letterSpacing: 0.1, shadow: { color: '#123456' } });
  });
});
