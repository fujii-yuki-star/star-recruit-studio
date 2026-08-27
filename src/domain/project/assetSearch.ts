// 素材を**名前・タグで探す**（#858）。純粋関数（§7 テスト対象）。
//
// ⚠️ **タグは付けられるのに探せなかった**（ADR-0035 の調査で判明）＝`Asset.tags` は付与UI も
// AI 利用（poseTag 解決・入力の語彙・送信文）も動いているのに、一覧の絞り込みは**種類だけ**だった。
// 横断ライブラリ（#260）とは独立に成立するので、そちらを待たずに解消する。
import type { Asset } from './types';

/** 探すときの言葉をそろえる（大文字小文字・前後の空白を無視）。 */
function normalize(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * 名前・タグでの絞り込み。
 *
 * ⚠️ **空の言葉は「絞らない」**（全部返す）＝空欄なのに0件、を作らない。
 * ⚠️ **名前とタグの両方を見る**＝利用者はどちらで覚えているか分からない
 *（「ロゴ」と付けたタグと「logo.png」という名前が別々にしか当たらないと、探し直しになる）。
 * ⚠️ **空白で区切った語は全部含む**（AND）＝絞り込みは足すほど狭くなる、が普通の期待。
 */
export function matchesAssetQuery(asset: Asset, query: string): boolean {
  const words = normalize(query).split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) return true;
  const haystack = [asset.displayName, ...(asset.tags ?? [])].map(normalize).join(' ');
  return words.every((w) => haystack.includes(w));
}

/**
 * いま出ているものから**候補のタグ**を集める（押して絞れるように）。
 *
 * ⚠️ **打ち間違いで見つからない、を作らない**ため＝自由入力だけだと「ロゴ」と「ろご」で当たらない。
 * 並びは**よく付いている順**（同数なら五十音）＝毎回同じ並びになる（順序が揺れると探しにくい）。
 */
export function assetTagCounts(assets: readonly Asset[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const a of assets) {
    for (const t of a.tags ?? []) {
      const key = t.trim();
      if (key === '') continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((x, y) => (y.count - x.count) || x.tag.localeCompare(y.tag, 'ja'));
}
