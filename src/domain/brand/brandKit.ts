// ブランドキット（ADR-0036・#351）。会社の既定フォント・色・ロゴ。純粋関数（§7 テスト対象）。
//
// ⚠️ **α-6 は最小形**（利用者決定）＝既定フォント・ブランドカラー数色・ロゴ1つだけ。
// 字幕やテロップのスタイル、BGM の傾向、複数キットは β のフル版へ。
//
// ⚠️ **新規プロジェクトへはコピー**（決定2）＝`videoSettings.fontId` へ既定フォントを入れ、
// ロゴは**ライブラリからの取り込みと同じ経路**で `asset_NNN` を採番し直す。
// ⇒ **`project.schema` は不変**（`lib_asset_NNN` はプロジェクトに現れない）。
//
// ⚠️ **既存プロジェクトへは自動で遡及しない**（決定3・§2-5）＝**明示操作のときだけ**適用し直す。
// 遡及すると、**過去に書き出した動画と再書き出しが違う絵**になる（黙って別の見た目に差し替えない）。
import { isLibraryAssetId } from '../asset/assetLibrary';
import { isKnownFontId } from '../font/fontCatalog';

/** ブランドキット（`appData/brandkit.json`）。すべて任意＝設定していないものは効かない。 */
export interface BrandKit {
  /** 新しい動画の既定フォント（同梱・持ち込みどちらも）。 */
  fontId?: string;
  /** ブランドカラー（色を選ぶところの候補の先頭に出す）。 */
  colors?: string[];
  /** 新しい動画に最初から入れておくロゴ（素材ライブラリの id を**指すだけ**）。 */
  logoLibraryAssetId?: string;
}

/** 覚えておける色の数（多すぎると候補が読めなくなる）。 */
export const BRAND_COLORS_MAX = 6;

/** 色として受け付ける形（`#rrggbb`）。`ColorPicker` の候補に混ぜるので同じ形にそろえる。 */
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** 空のキット（初回起動・読めなかったとき）。 */
export function emptyBrandKit(): BrandKit {
  return {};
}

/**
 * 保存されている形かを見る（§2-2＝生のまま内部へ流さない）。
 * ⚠️ **壊れた項目はその項目だけ落とす**（1つのせいでキット全部を失わない）。
 */
export function parseBrandKit(text: string): BrandKit {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return emptyBrandKit();
  }
  if (typeof raw !== 'object' || raw === null) return emptyBrandKit();
  const o = raw as Record<string, unknown>;
  const kit: BrandKit = {};
  // ⚠️ **知らないフォントは覚えない**＝新しい動画が開けない字体を既定にしない。
  if (isKnownFontId(o.fontId)) kit.fontId = o.fontId as string;
  if (Array.isArray(o.colors)) {
    const colors = o.colors.filter((c): c is string => typeof c === 'string' && HEX_RE.test(c));
    if (colors.length > 0) kit.colors = colors.slice(0, BRAND_COLORS_MAX);
  }
  // ⚠️ **ロゴは1つだけ覚える**（決定6）＝「会社の既定として何枚おぼえておくか」の話。
  // 白抜き版などが要る動画は、素材ライブラリから取り込めばよい。
  if (isLibraryAssetId(o.logoLibraryAssetId)) kit.logoLibraryAssetId = o.logoLibraryAssetId;
  return kit;
}

/** 何か覚えているか（空のキットで「適用」を押させない）。 */
export function hasBrandKit(kit: BrandKit): boolean {
  return kit.fontId != null || (kit.colors?.length ?? 0) > 0 || kit.logoLibraryAssetId != null;
}

/** 色を足す（重複と上限をここで処理する＝画面が数え直さない）。 */
export function addBrandColor(kit: BrandKit, color: string): BrandKit {
  if (!HEX_RE.test(color)) return kit;
  const lower = color.toLowerCase();
  const cur = (kit.colors ?? []).map((c) => c.toLowerCase());
  if (cur.includes(lower)) return kit; // 同じ色は増やさない
  if (cur.length >= BRAND_COLORS_MAX) return kit; // 上限を超えたら足さない（黙って古いのを捨てない）
  return { ...kit, colors: [...(kit.colors ?? []), lower] };
}

/** 色を外す。 */
export function removeBrandColor(kit: BrandKit, color: string): BrandKit {
  const rest = (kit.colors ?? []).filter((c) => c.toLowerCase() !== color.toLowerCase());
  if (rest.length === (kit.colors?.length ?? 0)) return kit; // 何も変わらないなら同じものを返す
  return rest.length > 0 ? { ...kit, colors: rest } : { ...kit, colors: undefined };
}

/**
 * 色を選ぶところに出す候補（決定4）。**ブランドカラーを先頭に、既定の色はそのまま残す**。
 * ⚠️ **重複は出さない**（同じ色が2回並ぶと、どちらを押しても同じで戸惑う）。
 */
export function paletteWithBrand(brand: readonly string[] | undefined, defaults: readonly string[]): string[] {
  const head = (brand ?? []).map((c) => c.toLowerCase());
  const rest = defaults.filter((c) => !head.includes(c.toLowerCase()));
  return [...head, ...rest];
}

/** 「適用し直す」で何がいくつ変わるか（決定3＝**先に見せる**・#547 の「まとめて標準にする」と同型）。 */
export interface BrandApplyPlan {
  /** 動画全体のフォントが変わるか。 */
  fontChanges: boolean;
  /** 変える前のフォント（画面で「◯◯→△△」と見せる）。 */
  fromFontId?: string;
  /** ロゴを足すか（**既にあるロゴは置き換えない**＝作り込みを消さない）。 */
  addsLogo: boolean;
  /**
   * **自分で文字の形を選んでいる場面の数**（α-6 出口監査 🟡31）。
   *
   * ⚠️ **変わらないものも数える**＝場面ごとの指定は動画全体より優先されるので、その場面は
   * 反映しても**見た目が変わらない**。数えずに「動画全体の文字の形が変わります」とだけ言うと、
   * 押したあとに「変わっていない場面がある」ことに自分で気づくしかない（§2-5＝先に見せる）。
   */
  keptScenes: number;
}

/**
 * 既存の動画へ適用し直したら何が変わるかを数える（**押す前に見せる**）。
 *
 * ⚠️ **ロゴは「足す」だけで置き換えない**（§2-5＝黙って別の見た目に差し替えない）＝
 * 既にロゴを置いている動画では、利用者が選んだ絵が正しい。足すのは**持っていないとき**だけ。
 */
export function planBrandApply(
  kit: BrandKit,
  project: { fontId?: string; hasLogoAsset: boolean; sceneFontIds?: readonly (string | null | undefined)[] },
): BrandApplyPlan {
  const fontChanges = kit.fontId != null && kit.fontId !== project.fontId;
  return {
    fontChanges,
    ...(fontChanges && project.fontId != null ? { fromFontId: project.fontId } : {}),
    addsLogo: kit.logoLibraryAssetId != null && !project.hasLogoAsset,
    // ⚠️ **場面ごとの指定は動画全体より優先される**（`11 §7.1.1`）＝その場面は変わらない。
    // 変えるとき（`fontChanges`）だけ数える＝変えないのに「そのままです」と言わない。
    keptScenes: fontChanges ? (project.sceneFontIds ?? []).filter((f) => typeof f === 'string').length : 0,
  };
}

/** 何も変わらない計画か（変わらないのに確認を出さない）。 */
export function isNoopBrandApply(plan: BrandApplyPlan): boolean {
  return !plan.fontChanges && !plan.addsLogo;
}
