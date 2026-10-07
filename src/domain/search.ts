// 一覧を**言葉で絞り込む**ときの共通規則（#1031 レビュー）。純粋関数（§7 テスト対象）。
//
// ⚠️ **同じ「探す」を画面ごとに書かない**＝素材は `matchesAssetQuery`（#858）で
// 「前後の空白と大文字小文字を無視」「空白で区切った語は全部含む（AND）」と決めているのに、
// 見た目パターンの一覧は `name.includes(query)` で書き始めていた＝**同じ欄なのに画面で挙動が違う**
// （ローマ字の名前で当たらない・空白を入れると急に0件）。規則はここに1つだけ置く。
/**
 * 探すときの言葉をそろえる（前後の空白と大文字小文字を無視）。
 *
 * ℹ️ **`trim()` は見える振る舞いを変えない**（変異チェックで生き残る）＝探す言葉は
 * 空白で分けてから見るので語の中に空白は残らず、見る先も空白でつないでから探す。
 * 元の規則（`matchesAssetQuery`）と**同じ形を保つ**ために残している。
 */
function normalize(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * 探す言葉が、見る先（名前・タグなど）に**全部**含まれるか。
 *
 * ⚠️ **空の言葉は「絞らない」**（全部返す）＝空欄なのに0件、を作らない。
 * ⚠️ **空白で区切った語は全部含む**（AND）＝絞り込みは足すほど狭くなる、が普通の期待。
 */
export function matchesSearchWords(parts: readonly string[], query: string): boolean {
  const words = normalize(query).split(/\s+/).filter((w) => w !== "");
  if (words.length === 0) return true;
  const haystack = parts.map(normalize).join(" ");
  return words.every((w) => haystack.includes(w));
}
