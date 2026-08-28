// ユーザー素材ライブラリ（ADR-0035・#260）の純粋な部分。
import { describe, expect, it } from 'vitest';
import {
  assetFromLibrary,
  createLibraryAssetId,
  filterLibraryAssets,
  isLibraryAssetId,
  libraryTags,
  LIBRARY_ASSET_ID_SAMPLES,
  type LibraryAsset,
} from './assetLibrary';
import { ASSET_TYPE } from '../enums';

const lib = (over: Partial<LibraryAsset> = {}): LibraryAsset => ({
  id: 'lib_asset_001',
  fileName: 'lib_asset_001.png',
  displayName: '会社ロゴ',
  assetType: ASSET_TYPE.logo,
  tags: ['会社', 'ロゴ'],
  ...over,
});

describe('id の形と採番', () => {
  it('形だけを見て判定する（ファイルの有無は別の話）', () => {
    expect(isLibraryAssetId('lib_asset_001')).toBe(true);
    expect(isLibraryAssetId('lib_asset_1')).toBe(false); // 3桁ゼロ詰め
    expect(isLibraryAssetId('asset_001')).toBe(false);
    expect(isLibraryAssetId(null)).toBe(false);
  });

  /**
   * ⚠️ **同じ規則が Rust 側（`is_library_asset_id`）にもある**（PR #887 レビュー 🟡）。
   * **片方だけ変えると保存できるのに読めない**ので、**同じ入力で同じ答え**になることを両側で固定する
   *（Rust 側は `library_id_tests::matches_domain_rule`）。ここが変わったら向こうも直す。
   */
  it('Rust 側と同じ答えになる入力の一覧（片方だけ変えたら気づける）', () => {
    const expected: Record<string, boolean> = {
      lib_asset_001: true,
      lib_asset_1000: true,
      lib_asset_1: false,
      lib_asset_00a: false,
      xlib_asset_001: false,
      lib_asset_001x: false,
      lib_asset_: false,
      asset_001: false,
      '': false,
    };
    // 一覧が増減したら気づけるよう、件数も固定する。
    expect(LIBRARY_ASSET_ID_SAMPLES).toHaveLength(Object.keys(expected).length);
    for (const id of LIBRARY_ASSET_ID_SAMPLES) {
      expect({ id, ok: isLibraryAssetId(id) }).toEqual({ id, ok: expected[id] });
    }
  });

  /** ⚠️ **消した番号は使い回さない**＝ファイルが残っていた場合に別の素材を指さない。 */
  it('番号は既存の最大＋1（消した番号を再利用しない）', () => {
    expect(createLibraryAssetId([])).toBe('lib_asset_001');
    expect(createLibraryAssetId(['lib_asset_001', 'lib_asset_003'])).toBe('lib_asset_004');
    expect(createLibraryAssetId(['asset_009'])).toBe('lib_asset_001'); // 別の採番は数えない
  });
});

describe('assetFromLibrary（取り込みは「コピー」＝決定3）', () => {
  /** ⚠️ **`lib_asset_NNN` は `project.json` に現れない**（`project.schema` は不変）。 */
  it('プロジェクト側の番号を採り直す（ライブラリの id は残さない）', () => {
    const { asset, fileName } = assetFromLibrary(lib(), ['asset_001']);
    expect(asset.assetId).toBe('asset_002');
    expect(asset.filePath).toBe('assets/asset_002.png');
    expect(fileName).toBe('asset_002.png');
    expect(JSON.stringify(asset)).not.toContain('lib_asset');
  });

  it('拡張子は元のものを引き継ぐ（形式が変わらない）', () => {
    expect(assetFromLibrary(lib({ fileName: 'lib_asset_001.mp4' }), []).fileName.endsWith('.mp4')).toBe(true);
  });

  it('拡張子が無ければ既定へ落とす（保存先に拡張子が要る）', () => {
    expect(assetFromLibrary(lib({ fileName: 'noext' }), []).fileName).toBe('asset_001.noext');
  });

  /** ⚠️ **タグはコピー時に持ち込む**（書き戻さない）。 */
  it('タグを持ち込む', () => {
    expect(assetFromLibrary(lib(), []).asset.tags).toEqual(['会社', 'ロゴ']);
  });

  it('タグが無ければキーごと足さない（空配列を作らない）', () => {
    expect(assetFromLibrary(lib({ tags: [] }), []).asset.tags).toBeUndefined();
  });

  it('持ち込んだタグは元と繋がっていない（あとで変えても影響しない）', () => {
    const src = lib();
    const { asset } = assetFromLibrary(src, []);
    asset.tags?.push('あとから');
    expect(src.tags).toEqual(['会社', 'ロゴ']);
  });
});

describe('filterLibraryAssets（タグで探せる＝#260 で足りなかったところ）', () => {
  const items = [
    lib({ id: 'lib_asset_001', displayName: '会社ロゴ', tags: ['会社', 'ロゴ'] }),
    lib({ id: 'lib_asset_002', displayName: 'オフィス写真', assetType: ASSET_TYPE.image, tags: ['会社', '写真'] }),
    lib({ id: 'lib_asset_003', displayName: '社員インタビュー', assetType: ASSET_TYPE.video, tags: ['採用'] }),
  ];

  it('条件が空なら全部返す（何も選んでいない＝全部見せる）', () => {
    expect(filterLibraryAssets(items, {})).toHaveLength(3);
  });

  /** ⚠️ タグは「すべて含む」で絞る（AND）＝足すほど狭まる、が直感に合う。 */
  it('タグは「すべて含む」で絞る', () => {
    expect(filterLibraryAssets(items, { tags: ['会社'] }).map((a) => a.id)).toEqual(['lib_asset_001', 'lib_asset_002']);
    expect(filterLibraryAssets(items, { tags: ['会社', '写真'] }).map((a) => a.id)).toEqual(['lib_asset_002']);
    expect(filterLibraryAssets(items, { tags: ['会社', '採用'] })).toEqual([]);
  });

  it('名前は部分一致・大小を区別しない', () => {
    expect(filterLibraryAssets(items, { text: 'オフィス' }).map((a) => a.id)).toEqual(['lib_asset_002']);
    expect(filterLibraryAssets(items, { text: '  写真  ' }).map((a) => a.id)).toEqual(['lib_asset_002']);
  });

  it('種類でも絞れる', () => {
    expect(filterLibraryAssets(items, { assetType: ASSET_TYPE.video }).map((a) => a.id)).toEqual(['lib_asset_003']);
  });

  it('種類が null なら絞らない（「すべて」を選んだとき）', () => {
    expect(filterLibraryAssets(items, { assetType: null })).toHaveLength(3);
  });

  it('条件を重ねると絞り込みも重なる', () => {
    expect(filterLibraryAssets(items, { text: '会社', tags: ['ロゴ'] }).map((a) => a.id)).toEqual(['lib_asset_001']);
  });
});

describe('libraryTags', () => {
  it('重複なく、出てきた順に並べる', () => {
    expect(libraryTags([lib({ tags: ['あ', 'い'] }), lib({ tags: ['い', 'う'] })])).toEqual(['あ', 'い', 'う']);
  });

  it('タグが無ければ空', () => {
    expect(libraryTags([lib({ tags: [] })])).toEqual([]);
  });
});
