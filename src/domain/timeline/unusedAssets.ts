// タイムライン形式の「使っていない素材」（#1480・ADR-0064 未解決＝Resolve の Remove Unused Clips に当たる）。純粋関数。
//
// ⚠️ **消す判断の根拠**＝間違えると、置いた部品の絵や音が「見つかりません」になる。だから**安全側**へ倒す：
// - 素材の一覧の**外**のどこかに素材の番号が文字として出ていれば「使っている」（部品・差し込み口・動き・まとまり…
//   どの項目に入っていても拾う＝項目を名指しで数えると、あとで足した項目だけ取りこぼす）。
// - **取り消し・やり直しで戻る文書も数える**＝今は使っていなくても、取り消すとその素材を使う部品が戻る
//  （場面形式の `unusedAssetIds` と同じ規則・α-6 出口監査 🔴）。
import type { TimelineProject } from './types';

/**
 * 文書ごとの答えの作り置き（同じ素材の一覧で聞かれたときだけ使う）。
 * ⚠️ **取り消しの履歴の文書は変わらない**（ADR-0020＝編集のたびに新しい文書を積む）＝作り置けば、編集のたびに
 * 文書まるごとの文字列を履歴の数（最大50）だけ作り直さずに済む（負荷試験 2026-10-22＝部品 2216 の動画で1回の編集に約50ms）。
 * ⚠️ 文字列そのものは持たない（文書1つで数百KB×50）＝見つかった番号だけ持つ。
 */
const mentionsCache = new WeakMap<TimelineProject, { key: string; used: Set<string> }>();

/** 素材の一覧の外で、その番号が文字として出てくるか（`"asset_001"` を引用符ごと探す＝`asset_0011` に当たらない）。 */
function mentions(doc: TimelineProject, ids: readonly string[]): Set<string> {
  const key = ids.join("\n");
  const hit = mentionsCache.get(doc);
  if (hit && hit.key === key) return hit.used;
  const { assets: _assets, ...rest } = doc;
  const text = JSON.stringify(rest);
  const used = new Set(ids.filter((id) => text.includes(JSON.stringify(id))));
  mentionsCache.set(doc, { key, used });
  return used;
}

/**
 * どの部品からも（取り消しで戻る文書からも）使われていない素材の番号（`doc.assets` の並び順）。
 */
export function unusedTimelineAssetIds(doc: TimelineProject, historyDocs: readonly TimelineProject[] = []): string[] {
  const ids = doc.assets.map((a) => a.assetId);
  const used = new Set<string>();
  for (const d of [doc, ...historyDocs]) for (const id of mentions(d, ids)) used.add(id);
  return ids.filter((id) => !used.has(id));
}

/** 素材を一覧から外した文書（取り消しの履歴の文書にも同じ形で当てる＝取り消して戻ってこないように）。 */
export function withoutAssets(doc: TimelineProject, ids: ReadonlySet<string>): TimelineProject {
  if (!doc.assets.some((a) => ids.has(a.assetId))) return doc;
  return { ...doc, assets: doc.assets.filter((a) => !ids.has(a.assetId)) };
}
