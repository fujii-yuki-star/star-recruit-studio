// 一覧に出す小さな絵（#397）の純粋な部分。
import { describe, expect, it } from 'vitest';
import { PROJECT_THUMBNAIL_PATH, PROJECT_THUMBNAIL_WIDTH, thumbnailScene, thumbnailSignature } from './thumbnail';
import type { Project, Scene } from './types';

const scene = (over: Partial<Scene> = {}): Scene =>
  ({ sceneId: 's1', templateId: 'tpl', durationSec: 5, texts: {}, assetRefs: {}, ...over }) as unknown as Scene;

const proj = (over: Partial<Project> = {}): Pick<Project, 'scenes' | 'assets' | 'videoSettings'> =>
  ({
    scenes: [scene()],
    assets: [],
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    ...over,
  }) as unknown as Pick<Project, 'scenes' | 'assets' | 'videoSettings'>;

describe('thumbnailScene', () => {
  it('先頭の場面を使う', () => {
    expect(thumbnailScene([scene({ sceneId: 'a' }), scene({ sceneId: 'b' })])?.sceneId).toBe('a');
  });

  it('場面が無ければ undefined', () => {
    expect(thumbnailScene([])).toBeUndefined();
  });
});

describe('thumbnailSignature（焼き直すべきかの印）', () => {
  it('同じ内容なら同じ印（打つたびに焼かない）', () => {
    expect(thumbnailSignature(proj())).toBe(thumbnailSignature(proj()));
  });

  it('先頭の場面が変われば印も変わる', () => {
    expect(thumbnailSignature(proj())).not.toBe(thumbnailSignature(proj({ scenes: [scene({ texts: { title: 'あ' } })] })));
  });

  /** ⚠️ **絵に効くものだけを混ぜる**＝名前や更新時刻は絵に出ない。 */
  it('動画全体のフォント・向きが変われば印も変わる', () => {
    const base = proj();
    const font = proj({ videoSettings: { ...base.videoSettings, fontId: 'kaitou-yokoku-gothic' } as never });
    const orient = proj({ videoSettings: { ...base.videoSettings, aspectRatio: '9:16' } as never });
    expect(thumbnailSignature(base)).not.toBe(thumbnailSignature(font));
    expect(thumbnailSignature(base)).not.toBe(thumbnailSignature(orient));
  });

  /** ⚠️ **置いた素材の中身が差し替わっても焼き直す**（同じ id で別のファイルになりうる）。 */
  it('置いた素材のファイルが変われば印も変わる', () => {
    const withRef = { scenes: [scene({ assetRefs: { mainVisual: 'asset_001' } })] };
    const a = proj({ ...withRef, assets: [{ assetId: 'asset_001', filePath: 'assets/a.png' }] as never });
    const b = proj({ ...withRef, assets: [{ assetId: 'asset_001', filePath: 'assets/b.png' }] as never });
    expect(thumbnailSignature(a)).not.toBe(thumbnailSignature(b));
  });

  it('2つ目以降の場面が変わっても印は変わらない（絵に出ない）', () => {
    const a = proj({ scenes: [scene(), scene({ sceneId: 's2' })] });
    const b = proj({ scenes: [scene(), scene({ sceneId: 's2', texts: { title: '変えた' } })] });
    expect(thumbnailSignature(a)).toBe(thumbnailSignature(b));
  });

  /** ⚠️ **場面が無いときも印を返す**＝場面を消したのに古い絵が残り続ける、を防ぐ。 */
  it('場面が無いときも印を返し、場面ありとは違う', () => {
    const empty = thumbnailSignature(proj({ scenes: [] }));
    expect(empty).toBe('empty');
    expect(empty).not.toBe(thumbnailSignature(proj()));
  });
});

describe('置き場所と大きさ', () => {
  it('絵はプロジェクトフォルダの直下（素材と混ぜない）', () => {
    expect(PROJECT_THUMBNAIL_PATH).toBe('preview.png');
    expect(PROJECT_THUMBNAIL_PATH.includes('/')).toBe(false);
  });

  it('一覧に並ぶだけなので小さい', () => {
    expect(PROJECT_THUMBNAIL_WIDTH).toBeLessThanOrEqual(480);
  });
});
