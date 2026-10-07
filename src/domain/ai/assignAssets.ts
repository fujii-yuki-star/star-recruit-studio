// 写真・動画を場面の差し込み口へソフトが割り当てる（ADR-0052 決定2・5・12 §8.8）。純粋関数。
//
// AI は「場面ごとに見せたいもの」を言葉で書く（`notes`・画面の文字・語り）。ここでは、その言葉と素材の言葉
// （名前・説明・AI解析・タグ）の重なりで、**空いている差し込み口**に素材を当てる。
// - **同じ素材を重ねない**・**AI が既に当てた素材は動かさない**（AI の選択を尊重し、空いている口だけ埋める）
// - **なるべく全部使う**（決定5）＝合うものが無くても、空いている口が残っていれば当てる
// - **自信の低い割り当ては印を付ける**（決定5・`15 §6` の `ASSET_AUTO_ASSIGNED`）＝成功のふりをしない
// ⚠️ 差し込み口の無い場面（箇条書きなど）には当てない＝場面の種類を変えるのは AI の判断（決定1）。
//   写真が余っても種類は変えない（余りは点数で見る＝決定8 の見直しの候補）。
import { ASSET_MATCH_MIN_SCORE } from '../constants';
import { LAYER_TYPE } from '../enums';
import type { Asset, AssetRefs } from '../project/types';
import type { Template } from '../template/types';
import { isAssignableToLayer } from '../template/slotAssign';

/** 割り当ての対象の場面（変換の途中の形＝何番目の場面か・見た目・いまの割り当て・見せたいものの言葉）。 */
export interface AssignTarget {
  template: Template | undefined;
  assetRefs: AssetRefs;
  /** 見せたいものを表す言葉（見せたいもの＝`notes`・場面名・画面の文字・語り）。 */
  query: string[];
}

export interface AssetAssignment {
  sceneIndex: number;
  slotId: string;
  assetId: string;
  /** 言葉の重なり（0〜1）。 */
  score: number;
  /** 自信が低い（重なりが `ASSET_MATCH_MIN_SCORE` 未満＝余りを当てたものを含む）。 */
  lowConfidence: boolean;
}

/** 記号・空白・拡張子を落とした2字の並び（日本語は分かち書きしないので2字で見る）。 */
function bigrams(text: string): Set<string> {
  const t = text.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[\s、。，．・！？!?「」『』（）()［］[\]【】…ー\-_/:]/g, '').toLowerCase();
  const out = new Set<string>();
  for (let i = 0; i + 1 < t.length; i++) out.add(t.slice(i, i + 2));
  return out;
}

/** 素材の言葉（名前・説明・AI解析・タグを**別々に**）。 */
function assetWords(a: Asset): string[] {
  return [a.displayName, a.description ?? '', a.aiDescription ?? '', ...(a.tags ?? [])];
}

/**
 * 見せたいものの言葉と素材の言葉の重なり（0〜1）。素材の言葉の**1つずつ**について、その2字の並びのうち見せたいものにも
 * ある割合を出し、いちばん高いものを採る。
 * - 素材側で割る＝素材の説明が短くても、それが場面の言葉に含まれていれば高くなる（場面の語りは長いので）。
 * - **別々に比べる**＝ファイル名（`IMG_1234` など）が説明の重なりを薄めない。
 */
export function matchScore(query: readonly string[], asset: Asset): number {
  const q = bigrams(query.join(' '));
  let best = 0;
  for (const word of assetWords(asset)) {
    const a = bigrams(word);
    if (a.size === 0) continue;
    let hit = 0;
    for (const b of a) if (q.has(b)) hit++;
    best = Math.max(best, hit / a.size);
  }
  return best;
}

/**
 * 空いている差し込み口へ素材を当てる。戻り値は当てたものの一覧（呼び出し側が `assetRefs` に入れ、印を付ける）。
 * 順番：①重なりの大きい組から当てる（同点は場面の順・素材の順）②余った素材を、残った口へ場面の順に当てる（自信が低い）。
 */
export function assignAssets(targets: readonly AssignTarget[], assets: readonly Asset[]): AssetAssignment[] {
  // 「使っている」と数えるのは、**その場面の見た目に在る層の鍵**に入った素材だけ（11 §5＝一致する鍵だけが描かれる）。
  // ⚠️ 向きの補正で見た目が替わった・AI が無い鍵を作った、で**描かれない鍵に残った素材**を使用中と数えると、
  //   画面に映らないのにどの口にも当たらなくなる（なるべく全部使う＝決定5 に反する）。
  const used = new Set<string>();
  for (const t of targets) {
    const ids = new Set((t.template?.layers ?? []).map((l) => l.id));
    for (const [k, v] of Object.entries(t.assetRefs)) if (typeof v === 'string' && ids.has(k)) used.add(v);
  }
  // 写真・動画だけに絞る処理は置かない＝当てるのは `slot` 層だけで、`isAssignableToLayer` が slot には写真・動画しか通さない
  // （ゆうこ・ロゴ・BGM は下の組を作る時点で落ちる）。
  const free = assets.filter((a) => !used.has(a.assetId));
  const slots: { sceneIndex: number; slotId: string; layer: Template['layers'][number]; order: number }[] = [];
  targets.forEach((t, sceneIndex) => {
    for (const layer of t.template?.layers ?? []) {
      if (layer.type !== LAYER_TYPE.slot || typeof t.assetRefs[layer.id] === 'string') continue;
      slots.push({ sceneIndex, slotId: layer.id, layer, order: slots.length });
    }
  });
  const pairs: { slot: (typeof slots)[number]; asset: Asset; assetOrder: number; score: number }[] = [];
  for (const slot of slots) {
    free.forEach((asset, assetOrder) => {
      if (isAssignableToLayer(asset, slot.layer)) {
        pairs.push({ slot, asset, assetOrder, score: matchScore(targets[slot.sceneIndex].query, asset) });
      }
    });
  }
  pairs.sort((x, y) => y.score - x.score || x.slot.order - y.slot.order || x.assetOrder - y.assetOrder);
  const takenSlots = new Set<number>();
  const takenAssets = new Set<string>();
  const out: AssetAssignment[] = [];
  const take = (p: (typeof pairs)[number]) => {
    takenSlots.add(p.slot.order);
    takenAssets.add(p.asset.assetId);
    out.push({
      sceneIndex: p.slot.sceneIndex, slotId: p.slot.slotId, assetId: p.asset.assetId,
      score: p.score, lowConfidence: p.score < ASSET_MATCH_MIN_SCORE,
    });
  };
  // ① 重なりのある組（しきい値以上）を大きい順に。
  for (const p of pairs) {
    if (p.score < ASSET_MATCH_MIN_SCORE) break;
    if (!takenSlots.has(p.slot.order) && !takenAssets.has(p.asset.assetId)) take(p);
  }
  // ② 余った素材を残った口へ（なるべく全部使う）。場面の順・素材の順（並べ替え済みの pairs を場面の順で引き直す）。
  const rest = [...pairs].sort((x, y) => x.slot.order - y.slot.order || y.score - x.score || x.assetOrder - y.assetOrder);
  for (const p of rest) {
    if (!takenSlots.has(p.slot.order) && !takenAssets.has(p.asset.assetId)) take(p);
  }
  return out.sort((x, y) => x.sceneIndex - y.sceneIndex || x.slotId.localeCompare(y.slotId));
}
