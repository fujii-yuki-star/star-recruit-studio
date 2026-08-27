import { describe, expect, it } from 'vitest';
import { assetTagCounts, matchesAssetQuery } from './assetSearch';
import type { Asset } from './types';

const a = (displayName: string, tags?: string[]): Asset =>
  ({ assetId: 'asset_001', assetType: 'image', displayName, filePath: 'a.png', tags }) as Asset;

describe('matchesAssetQuery（名前・タグで探す・#858）', () => {
  // ⚠️ **空の言葉は絞らない**＝空欄なのに0件、を作らない。
  it('空の言葉なら全部通す', () => {
    expect(matchesAssetQuery(a('オフィス'), '')).toBe(true);
    expect(matchesAssetQuery(a('オフィス'), '   ')).toBe(true);
  });

  it('名前の一部で当たる', () => {
    expect(matchesAssetQuery(a('オフィス外観'), 'オフィス')).toBe(true);
    expect(matchesAssetQuery(a('オフィス外観'), '会議室')).toBe(false);
  });

  // ⚠️ **タグでも当たる**＝**これが無かったのが #858 の主旨**（付けられるのに探せない）。
  it('タグでも当たる', () => {
    expect(matchesAssetQuery(a('IMG_0231.png', ['ロゴ', '会社']), 'ロゴ')).toBe(true);
  });

  // ⚠️ **名前とタグの両方を見る**＝利用者がどちらで覚えているか分からない。
  it('名前とタグのどちらでも当たる（片方だけ見ない）', () => {
    const asset = a('logo.png', ['ロゴ']);
    expect(matchesAssetQuery(asset, 'logo')).toBe(true);
    expect(matchesAssetQuery(asset, 'ロゴ')).toBe(true);
  });

  it('大文字小文字・前後の空白は無視する', () => {
    expect(matchesAssetQuery(a('Logo.PNG'), '  logo ')).toBe(true);
  });

  // ⚠️ **空白で区切った語は全部含む**（AND）＝絞り込みは足すほど狭くなる、が普通の期待。
  it('複数の語は全部含むものだけ（足すほど狭くなる）', () => {
    const asset = a('オフィス外観', ['本社', '外観']);
    expect(matchesAssetQuery(asset, 'オフィス 本社')).toBe(true);
    expect(matchesAssetQuery(asset, 'オフィス 会議室')).toBe(false);
  });

  it('タグが無くても落ちない', () => {
    expect(matchesAssetQuery(a('写真'), '写真')).toBe(true);
    expect(matchesAssetQuery(a('写真'), 'ロゴ')).toBe(false);
  });
});

describe('assetTagCounts（候補のタグ）', () => {
  // ⚠️ **打ち間違いで見つからない、を作らない**＝押して絞れる候補を出す。
  it('よく付いている順（同数なら五十音）', () => {
    const list = [
      a('1', ['ロゴ', '会社']),
      a('2', ['ロゴ']),
      a('3', ['会社']),
      a('4', ['ロゴ']),
    ];
    expect(assetTagCounts(list)).toEqual([
      { tag: 'ロゴ', count: 3 },
      { tag: '会社', count: 2 },
    ]);
  });

  /**
   * ⚠️ **並びが毎回同じ**＝順序が揺れると探しにくい（同数のときの決め方を持つ）。
   *
   * ⚠️ **向きまで固定する**＝「入力順に依らず同じ」だけだと、比較を**逆向き**にしても緑のまま
   * （変異チェックで実際に生き残った）。同数は**五十音の昇順**であることを具体的な並びで押さえる。
   */
  it('同数のときは五十音の昇順（入力順に依らない）', () => {
    expect(assetTagCounts([a('1', ['い']), a('2', ['あ'])]).map((t) => t.tag)).toEqual(['あ', 'い']);
    expect(assetTagCounts([a('1', ['あ']), a('2', ['い'])]).map((t) => t.tag)).toEqual(['あ', 'い']);
  });

  it('空白だけのタグは数えない（押せない候補を作らない）', () => {
    expect(assetTagCounts([a('1', ['  ', 'ロゴ'])])).toEqual([{ tag: 'ロゴ', count: 1 }]);
  });

  it('タグが1つも無ければ空', () => {
    expect(assetTagCounts([a('1'), a('2')])).toEqual([]);
  });
});
