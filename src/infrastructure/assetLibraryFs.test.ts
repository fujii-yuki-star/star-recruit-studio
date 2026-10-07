// よく使う素材の目録の1行を受け取れる形か（ADR-0035・§2-2）。
//
// ⚠️ **画面経由のテストはこのモジュールごとモックする**ので、この判定はどのテストからも実行されて
// いなかった（α-6 出口監査 🟡）。壊れた行を**1件ずつ落とす**規則は、一度実装漏れがあった箇所。
import { describe, expect, it } from 'vitest';
import { toLibraryAsset } from './assetLibraryFs';
import { ASSET_TYPE } from '../domain/enums';

const good = {
  id: 'lib_asset_001',
  fileName: 'lib_asset_001.png',
  displayName: '会社ロゴ',
  assetType: ASSET_TYPE.logo,
  tags: ['採用'],
};

describe('toLibraryAsset', () => {
  it('そろっている行はそのまま受ける', () => {
    expect(toLibraryAsset(good)).toEqual([good]);
  });

  it('番号の形が違う行は落とす（実体のファイル名と食い違う）', () => {
    expect(toLibraryAsset({ ...good, id: 'lib_asset_1' })).toEqual([]);
    expect(toLibraryAsset({ ...good, id: 'asset_001' })).toEqual([]);
  });

  it('ファイル名が無い・空の行は落とす（開く先が決まらない）', () => {
    expect(toLibraryAsset({ ...good, fileName: '' })).toEqual([]);
    expect(toLibraryAsset({ ...good, fileName: 3 })).toEqual([]);
  });

  it('名前が文字列でない行は落とす', () => {
    expect(toLibraryAsset({ ...good, displayName: null })).toEqual([]);
  });

  it('知らない種類の行は落とす（置く側でも断るようにした＝二重の守り）', () => {
    expect(toLibraryAsset({ ...good, assetType: 'movie' })).toEqual([]);
  });

  it('タグは文字列だけ拾う（壊れた要素で行ごと落とさない）', () => {
    expect(toLibraryAsset({ ...good, tags: ['採用', 3, null] })).toEqual([{ ...good, tags: ['採用'] }]);
  });

  it('タグが配列でなければ空にする（行は残す）', () => {
    expect(toLibraryAsset({ ...good, tags: 'nope' })).toEqual([{ ...good, tags: [] }]);
  });

  it('行そのものが object でなければ落とす', () => {
    expect(toLibraryAsset(null)).toEqual([]);
    expect(toLibraryAsset('lib_asset_001')).toEqual([]);
  });
});
