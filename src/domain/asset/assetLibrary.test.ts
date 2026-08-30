// ユーザー素材ライブラリ（ADR-0035・#260）の純粋な部分。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
import { ASSET_TYPE, ASSET_TYPES, ASSET_TYPE_SAMPLES, isAssetType } from '../enums';

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

  /**
   * ⚠️ **名前とタグの両方で探せる**（α-6 出口監査 🟡28・素材画面と同じ作法＝#858）＝
   * どちらで覚えているか分からないので片方だけにしない。**同じ画面に縦に並ぶ2つの絞り込みで
   * 作法が違うと、片方で見つかるものが片方で見つからない**。
   */
  it('名前に無くてもタグで当たる', () => {
    expect(filterLibraryAssets(items, { text: '採用' }).map((a) => a.id)).toEqual(['lib_asset_003']);
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

// ⚠️ **予約した番号を必ず使う**（差分再監査 6巡目 🔴）＝タイムラインの取り込みは `existingIds` に空配列を
// 渡し、番号は `reserveAssetId` が採る（消した番号を使い回さない規則）。この引数が落ちると
// `createAssetId([])` が黙って `asset_001` を返し、**既存の `asset_001.png` を上書きして前の素材が消える**。
describe('assetFromLibrary の採番', () => {
  it('予約した番号は、既にある番号より優先される', () => {
    const { asset, fileName } = assetFromLibrary(
      { id: 'lib_asset_001', fileName: 'lib_asset_001.png', displayName: 'ロゴ', assetType: ASSET_TYPE.logo, tags: [] },
      ['asset_005'],
      'asset_002',
    );
    expect(asset.assetId).toBe('asset_002');
    expect(fileName).toBe('asset_002.png');
    expect(asset.filePath).toBe('assets/asset_002.png');
  });

  it('予約が無いときは、既にある番号の次を採る', () => {
    const { asset } = assetFromLibrary(
      { id: 'lib_asset_001', fileName: 'lib_asset_001.png', displayName: 'ロゴ', assetType: ASSET_TYPE.logo, tags: [] },
      ['asset_001', 'asset_002'],
    );
    expect(asset.assetId).toBe('asset_003');
  });
});

// ⚠️ **素材の種類の一覧も両側で同じ答えにする**（α-6 出口監査 🟡）＝Rust 側のコメントは
// 「テストで同値性を固定する」と書いているのに、その固定が無かった。ずれると
// `update_library_asset` が**選んだ種類を黙って捨てる**（知らない値は書かない）。
describe('ASSET_TYPE_SAMPLES（Rust と同じ答えになることの入力）', () => {
  it('既知の種類は受ける・それ以外は受けない', () => {
    const expected: Record<string, boolean> = {
      image: true, video: true, bgm: true, voice: true, yuko: true, decor: true, logo: true, qr: true,
      Image: false, audio: false, movie: false, '': false,
    };
    expect(ASSET_TYPE_SAMPLES).toHaveLength(Object.keys(expected).length);
    for (const v of ASSET_TYPE_SAMPLES) {
      // ⚠️ **実際に使う述語で見る**（`/canon-check` ℹ️）＝一覧に含まれるかを直接見ると、
      // `toLibraryAsset` が通す `isAssetType` に別の分岐（別名の受け入れ等）が入ったとき
      // **Rust とのずれを素通しする**。門は「使う判定」で固定する。
      expect([v, isAssetType(v)]).toEqual([v, expected[v]]);
    }
  });

  // ⚠️ **表が2つあるだけでは「同じ答え」を固定できない**（PR #922 レビュー ℹ️）＝両側が自分の表としか
  // 比べないので、**片方に種類が増えても相手は赤くならない**。Rust 側のコメントが謳う同値性が
  // 実際には無かった（[[verify-claims-in-comments]] の型＝主張がコードより強い）。
  // そこで **Rust の本文をそのまま読んで**一覧を突き合わせる＝どちらを増やしても、もう片方を
  // 直すまで赤いままになる。
  it('Rust の `is_known_asset_type` が同じ一覧を見ている', () => {
    const rust = readFileSync(join(process.cwd(), 'src-tauri', 'src', 'lib.rs'), 'utf8');
    const body = /fn is_known_asset_type\(v: &str\) -> bool \{\s*matches!\(([^)]*)\)/.exec(rust);
    // 見つからない＝関数の書き方が変わった。**黙って緑にしない**（検査が空振りする）。
    expect(body).not.toBeNull();
    const arms = (body as RegExpExecArray)[1]
      .split('|')
      .map((a) => a.trim().replace(/^v\s*,\s*/, ''))
      .map((a) => a.replace(/^"|"$/g, '').trim())
      .filter((a) => a !== '');
    expect([...arms].sort()).toEqual([...ASSET_TYPES].sort());
  });
});
