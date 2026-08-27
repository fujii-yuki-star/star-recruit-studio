import { describe, expect, it } from 'vitest';
import { blurryAssets, BLURRY_SCALE_THRESHOLD, MAX_CHARS_PER_SEC, tooFastScenes, truncatedTexts } from './precheckExtras';
import type { Asset, Scene } from './types';

const textItem = (over: Record<string, unknown> = {}) =>
  ({ kind: 'text', text: 'あ', w: 400, fontSize: 40, maxLines: 2, ...over });

describe('truncatedTexts（切れている文字・#346）', () => {
  /**
   * ⚠️ **「はみ出す」とは別の壊れ方**＝画面の中で完結するので、見ただけでは
   * 「そう書いたのか」「切れたのか」が分からない。だから書き出す前に知らせる。
   */
  it('枠に入りきらない文字を返す', () => {
    const long = 'あ'.repeat(200);
    expect(truncatedTexts([textItem({ text: long })])).toEqual([long]);
  });

  it('収まっていれば返さない', () => {
    expect(truncatedTexts([textItem({ text: '短い文' })])).toEqual([]);
  });

  // ⚠️ **文字以外は見ない**（写真の枠に「…」は無い）。
  it('文字以外のアイテムは見ない', () => {
    expect(truncatedTexts([{ kind: 'image', text: 'あ'.repeat(200), w: 10, fontSize: 40, maxLines: 1 }])).toEqual([]);
  });

  // ⚠️ **測れない値は見ない**＝0 や未指定で `wrapText` に渡すと、そもそも折返せず誤検知する。
  it('幅・字の大きさ・行数が無いものは見ない', () => {
    const long = 'あ'.repeat(200);
    expect(truncatedTexts([textItem({ text: long, w: undefined })])).toEqual([]);
    expect(truncatedTexts([textItem({ text: long, fontSize: undefined })])).toEqual([]);
    expect(truncatedTexts([textItem({ text: long, maxLines: undefined })])).toEqual([]);
    expect(truncatedTexts([textItem({ text: '' })])).toEqual([]);
  });

  it('複数あればすべて返す', () => {
    const a = 'あ'.repeat(200);
    const b = 'い'.repeat(200);
    expect(truncatedTexts([textItem({ text: a }), textItem({ text: '短い' }), textItem({ text: b })])).toEqual([a, b]);
  });
});

describe('blurryAssets（ぼやける素材・#346）', () => {
  const asset = (id: string, w?: number, h?: number): Asset =>
    ({ assetId: id, assetType: 'image', displayName: id, filePath: `${id}.png`,
       metadata: w != null ? { width: w, height: h } : undefined }) as Asset;
  const img = (over: Record<string, unknown> = {}) => ({ kind: 'image', assetId: 'asset_001', w: 1920, h: 1080, ...over });

  /**
   * ⚠️ **「小さい」だけでは判断しない**＝ロゴのように小さく置く素材は元が小さくても問題ない。
   * **描かれる枠の大きさと比べる**。
   */
  it('枠より元が小さいものを返す', () => {
    expect(blurryAssets([img()], [asset('asset_001', 640, 360)])).toEqual(['asset_001']);
  });

  it('小さく置いてあれば返さない（ロゴなど）', () => {
    expect(blurryAssets([img({ w: 200, h: 120 })], [asset('asset_001', 640, 360)])).toEqual([]);
  });

  // ⚠️ **少しの不足では出さない**＝等倍付近で警告すると、ほぼ全部の場面に注意が付いて読まれなくなる。
  it('しきい値ぴったりから出す（少しの不足では出さない）', () => {
    const src = 1000;
    const just = src * BLURRY_SCALE_THRESHOLD;
    expect(blurryAssets([img({ w: just, h: just })], [asset('asset_001', src, src)])).toEqual(['asset_001']);
    expect(blurryAssets([img({ w: just - 1, h: just - 1 })], [asset('asset_001', src, src)])).toEqual([]);
  });

  // ⚠️ **測れていない素材は出さない**＝直しようが無い注意を出さない（§2-5）。
  it('大きさが分からない素材は出さない', () => {
    expect(blurryAssets([img()], [asset('asset_001')])).toEqual([]);
    expect(blurryAssets([img()], [])).toEqual([]);
  });

  it('同じ素材を何度置いても1回だけ返す', () => {
    expect(blurryAssets([img(), img()], [asset('asset_001', 100, 100)])).toEqual(['asset_001']);
  });

  it('縦横のきつい側で見る', () => {
    // 横は足りるが縦が足りない
    expect(blurryAssets([img({ w: 100, h: 1080 })], [asset('asset_001', 1000, 100)])).toEqual(['asset_001']);
  });
});

describe('tooFastScenes（早口になる場面・#346）', () => {
  const scene = (durationSec: number): Scene => ({ durationSec } as Scene);

  /**
   * ⚠️ **「セリフの長さ」とは別**＝あちらは文字数そのもの、こちらは**尺に対して**多いか。
   * 短い場面に長いセリフを入れると、声は最後まで鳴るのに**場面が先に切り替わる**。
   */
  it('尺に対してセリフが多ければ true', () => {
    expect(tooFastScenes(scene(2), ['あ'.repeat(MAX_CHARS_PER_SEC * 2 + 1)])).toBe(true);
  });

  it('ちょうどなら false（境界で出さない）', () => {
    expect(tooFastScenes(scene(2), ['あ'.repeat(MAX_CHARS_PER_SEC * 2)])).toBe(false);
  });

  it('掛け合いは全部の行を足して見る', () => {
    const half = 'あ'.repeat(MAX_CHARS_PER_SEC);
    expect(tooFastScenes(scene(1), [half, half])).toBe(true); // 1行ずつなら収まるが、合わせると溢れる
  });

  // ⚠️ **セリフが無い場面・尺が無い場面は見ない**（0除算にしない・無音の場面に注意を出さない）。
  it('セリフが無い・尺が0なら false', () => {
    expect(tooFastScenes(scene(5), [])).toBe(false);
    expect(tooFastScenes(scene(5), [''])).toBe(false);
    expect(tooFastScenes(scene(0), ['あ'.repeat(100)])).toBe(false);
  });
});
