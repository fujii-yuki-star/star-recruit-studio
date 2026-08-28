// ブランドキット（ADR-0036・#351）。
import { describe, expect, it } from 'vitest';
import {
  addBrandColor,
  BRAND_COLORS_MAX,
  emptyBrandKit,
  hasBrandKit,
  isNoopBrandApply,
  paletteWithBrand,
  parseBrandKit,
  planBrandApply,
  removeBrandColor,
  type BrandKit,
} from './brandKit';
import { isKnownFontId } from '../font/fontCatalog';

describe('parseBrandKit（生のまま内部へ流さない・§2-2）', () => {
  it('覚えているものを読む', () => {
    const k = parseBrandKit(JSON.stringify({ fontId: 'gen-interface-jp', colors: ['#112233'], logoLibraryAssetId: 'lib_asset_001' }));
    expect(k).toEqual({ fontId: 'gen-interface-jp', colors: ['#112233'], logoLibraryAssetId: 'lib_asset_001' });
  });

  /** ⚠️ 知らないフォントは覚えない＝新しい動画が開けない字体を既定にしない。 */
  it('知らないフォントは覚えない', () => {
    expect(parseBrandKit(JSON.stringify({ fontId: 'my-font' })).fontId).toBeUndefined();
  });

  /**
   * ⚠️ **受け付ける id はフォントの目録に委ねる**（`isKnownFontId`）＝ここで形を書き写すと、
   * 持ち込みフォント（#261）が入ったときに**片方だけ古い**が起きる。委譲していることを固定する。
   */
  it('受け付ける id はフォントの目録と同じ（形を写さない）', () => {
    for (const id of ['gen-interface-jp', 'kaitou-yokoku-gothic', 'my-font', 'user_font_001', '']) {
      const kept = parseBrandKit(JSON.stringify({ fontId: id })).fontId != null;
      expect({ id, kept }).toEqual({ id, kept: isKnownFontId(id) });
    }
  });

  it('色は #rrggbb だけ受ける（壊れた項目だけ落とす）', () => {
    expect(parseBrandKit(JSON.stringify({ colors: ['#112233', 'red', '#abc', 3] })).colors).toEqual(['#112233']);
  });

  it('色は上限まで（多すぎる候補は読めなくなる）', () => {
    const many = Array.from({ length: 20 }, (_, i) => `#0000${String(i).padStart(2, '0')}`);
    expect(parseBrandKit(JSON.stringify({ colors: many })).colors).toHaveLength(BRAND_COLORS_MAX);
  });

  it('色が1つも読めなければキーごと持たない（空配列を作らない）', () => {
    expect(parseBrandKit(JSON.stringify({ colors: ['red'] })).colors).toBeUndefined();
  });

  /** ⚠️ ロゴは**素材ライブラリの id を指すだけ**（棚を3つ目に増やさない）。 */
  it('ロゴはライブラリの id の形だけ受ける', () => {
    expect(parseBrandKit(JSON.stringify({ logoLibraryAssetId: 'asset_001' })).logoLibraryAssetId).toBeUndefined();
    expect(parseBrandKit(JSON.stringify({ logoLibraryAssetId: 'lib_asset_009' })).logoLibraryAssetId).toBe('lib_asset_009');
  });

  it('読めない本文は空として扱う（例外を投げない）', () => {
    expect(parseBrandKit('こわれています')).toEqual(emptyBrandKit());
    expect(parseBrandKit('[]')).toEqual(emptyBrandKit());
  });
});

describe('hasBrandKit', () => {
  it('何も覚えていなければ false（空のキットで「適用」を押させない）', () => {
    expect(hasBrandKit({})).toBe(false);
    expect(hasBrandKit({ colors: [] })).toBe(false);
  });

  it('1つでも覚えていれば true', () => {
    expect(hasBrandKit({ fontId: 'gen-interface-jp' })).toBe(true);
    expect(hasBrandKit({ colors: ['#112233'] })).toBe(true);
    expect(hasBrandKit({ logoLibraryAssetId: 'lib_asset_001' })).toBe(true);
  });
});

describe('色の出し入れ', () => {
  it('足す（小文字にそろえる）', () => {
    expect(addBrandColor({}, '#AABBCC').colors).toEqual(['#aabbcc']);
  });

  it('同じ色は増やさない（大小を区別しない）', () => {
    const k: BrandKit = { colors: ['#aabbcc'] };
    expect(addBrandColor(k, '#AABBCC')).toBe(k); // 何も変わらないなら同じものを返す
  });

  /** ⚠️ **上限を超えたら足さない**＝黙って古い色を捨てない（覚えたものが消えたと思わせない）。 */
  it('上限を超えたら足さない（古い色を黙って捨てない）', () => {
    const full: BrandKit = { colors: Array.from({ length: BRAND_COLORS_MAX }, (_, i) => `#0000${String(i).padStart(2, '0')}`) };
    expect(addBrandColor(full, '#ffffff')).toBe(full);
  });

  it('形が違う色は足さない', () => {
    const k: BrandKit = {};
    expect(addBrandColor(k, 'red')).toBe(k);
  });

  it('外す（最後の1つを外したらキーごと落とす）', () => {
    expect(removeBrandColor({ colors: ['#aabbcc'] }, '#AABBCC').colors).toBeUndefined();
    expect(removeBrandColor({ colors: ['#aabbcc', '#ddeeff'] }, '#aabbcc').colors).toEqual(['#ddeeff']);
  });

  it('無い色を外しても何も変わらない（同じものを返す）', () => {
    const k: BrandKit = { colors: ['#aabbcc'] };
    expect(removeBrandColor(k, '#ffffff')).toBe(k);
  });
});

describe('paletteWithBrand（決定4＝候補の先頭に足す・既定は残す）', () => {
  it('ブランドカラーを先頭に、既定はそのまま残す', () => {
    expect(paletteWithBrand(['#111111'], ['#222222', '#333333'])).toEqual(['#111111', '#222222', '#333333']);
  });

  /** ⚠️ 同じ色が2回並ぶと、どちらを押しても同じで戸惑う。 */
  it('既定と重なる色は二重に出さない（大小を区別しない）', () => {
    expect(paletteWithBrand(['#AAAAAA'], ['#aaaaaa', '#bbbbbb'])).toEqual(['#aaaaaa', '#bbbbbb']);
  });

  it('ブランドカラーが無ければ既定のまま', () => {
    expect(paletteWithBrand(undefined, ['#111111'])).toEqual(['#111111']);
  });
});

describe('planBrandApply（決定3＝何がいくつ変わるかを先に見せる）', () => {
  const kit: BrandKit = { fontId: 'user_font_001', logoLibraryAssetId: 'lib_asset_001' };

  it('フォントが違えば変わると数える', () => {
    const p = planBrandApply(kit, { fontId: 'gen-interface-jp', hasLogoAsset: true });
    expect(p.fontChanges).toBe(true);
    expect(p.fromFontId).toBe('gen-interface-jp');
  });

  it('同じフォントなら変わらない', () => {
    expect(planBrandApply(kit, { fontId: 'user_font_001', hasLogoAsset: true }).fontChanges).toBe(false);
  });

  /** ⚠️ **ロゴは「足す」だけで置き換えない**＝既に置いた絵は利用者が選んだもの（§2-5）。 */
  it('ロゴを持っていなければ足す／持っていれば置き換えない', () => {
    expect(planBrandApply(kit, { hasLogoAsset: false }).addsLogo).toBe(true);
    expect(planBrandApply(kit, { hasLogoAsset: true }).addsLogo).toBe(false);
  });

  it('覚えていないものは変えない', () => {
    const p = planBrandApply({}, { fontId: 'gen-interface-jp', hasLogoAsset: false });
    expect(isNoopBrandApply(p)).toBe(true);
  });

  it('何も変わらない計画を見分けられる（確認を出さないため）', () => {
    expect(isNoopBrandApply(planBrandApply(kit, { fontId: 'user_font_001', hasLogoAsset: true }))).toBe(true);
    expect(isNoopBrandApply(planBrandApply(kit, { fontId: 'gen-interface-jp', hasLogoAsset: true }))).toBe(false);
  });
});
