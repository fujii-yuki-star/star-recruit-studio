// 差し込み口に**入れられる素材**の規則（#512 段3）。純粋・副作用なし。
//
// ⚠️ **場面形式とタイムライン形式で同じ規則**（ADR-0026②）＝同じ枠なのに画面によって選べるものが
// 違う、を作らない。以前はタイムライン側だけ「動画は出さない」で絞っていたが、差し込み口の動画も
// 映るようになった（段3）ので理由が消えた＝規則を1つに寄せる。
import { ASSET_TYPE, LAYER_TYPE, SLOT_TYPE } from '../enums';
import type { Asset } from '../project/types';
import type { Layer } from './types';

/**
 * **主役の差し込み口**の id（#1030・PR #1041 レビュー 🔴）。
 *
 * ⚠️ **主役の決め方を2か所に書かない**＝台本表（`adapters.ts` の `mainAsset`）が既に
 * `mainVisual` → `background` の順で見ている。押したときの入れ先も**同じ順**にする
 * （層の並び順をそのまま使うと `background` が先頭になり、**主役の口が空のまま**になる）。
 */
export const MAIN_VISUAL_LAYER_ID = 'mainVisual';
/** 主役として見る順（前が優先）。台本表と押したときの入れ先で共有する。 */
export const MAIN_ASSET_LAYER_KEYS = [MAIN_VISUAL_LAYER_ID, 'background'] as const;

/**
 * その層の差し込み口に入れられる素材か。
 * - ロゴの層＝ロゴか写真
 * - 写真だけの差し込み口＝写真／動画だけの差し込み口＝動画
 * - それ以外（背景・種別を決めていない差し込み口）＝写真か動画
 */
export function isAssignableToLayer(asset: Asset, layer: Layer): boolean {
  if (layer.type === LAYER_TYPE.logo) return asset.assetType === ASSET_TYPE.logo || asset.assetType === ASSET_TYPE.image;
  if (layer.slotType === SLOT_TYPE.image) return asset.assetType === ASSET_TYPE.image;
  if (layer.slotType === SLOT_TYPE.video) return asset.assetType === ASSET_TYPE.video;
  return asset.assetType === ASSET_TYPE.image || asset.assetType === ASSET_TYPE.video;
}

/** その層の差し込み口に入れられる素材の一覧（並びは渡された順＝呼び出し側の一覧と同じ）。 */
export function assignableAssetsFor(assets: readonly Asset[], layer: Layer): Asset[] {
  return assets.filter((a) => isAssignableToLayer(a, layer));
}

/**
 * 押した素材を**どの差し込み口へ入れるか**（#1030）。純粋・副作用なし。
 *
 * ⚠️ **押しても何も起きない一覧を作らない**＝場面編集の左欄の素材タイルは**表示専用**で、
 * 実際の差し替えは右欄の畳まれた節の中の**名前の `<select>`** だけだった（画面1面ぶんが
 * 「押せそうに見えて何も起きない」で埋まっていた・`06 §2` 規約・ADR-0034 決定5）。
 *
 * 選び方（有名ツールの素材パネルと同じ型）：
 * 1. **入れられる差し込み口のうち、空いているものの先頭**（並びは見た目パターンの層の順）
 * 2. 空きが無ければ**先頭の差し込み口**（＝主役）を置き換える。呼ぶ側が**確認を出す**
 *    （`replacing` に、いま入っている素材の id が入る）
 * 3. 入れられる差し込み口がひとつも無ければ `null`（呼ぶ側が理由を出す）
 *
 * ⚠️ **入れられるかの規則は `isAssignableToLayer` を共有**＝`<select>` の候補と同じ
 * （片方でだけ入る素材、を作らない）。
 */
export function slotForAsset(
  asset: Asset,
  layers: readonly Layer[],
  assetRefs: Readonly<Record<string, string | null | undefined>>,
): { layerId: string; replacing: string | null } | null {
  const usable = orderedForAssign(layers.filter((l) => isAssignableToLayer(asset, l)));
  if (usable.length === 0) return null;
  const empty = usable.find((l) => !assetRefs[l.id]);
  if (empty) return { layerId: empty.id, replacing: null };
  const head = usable[0]!;
  return { layerId: head.id, replacing: assetRefs[head.id] ?? null };
}

/**
 * 入れ先を見る**順番**（#1030・PR #1041 レビュー 🔴）。
 *
 * ⚠️ **層の並び順をそのまま使うと `background` が先頭になる**＝実際の見た目パターンは
 * 例外なく `background` を配列の先頭（`zIndex:0`＝いちばん奥）に置いており、
 * `isAssignableToLayer` は種別を決めていない `background` を写真にも動画にも「入れられる」と見る。
 * その結果、**空の場面で写真を押すと背景に入り、`mainVisual` は空のまま**になる。
 * 空の `slot` は**不透明な灰色のプレースホルダ**（`zIndex:10`）として背景の**手前**に描かれるので、
 * 置いた写真が覆い隠されて見えない＝この Issue が直そうとしている症状そのものになる。
 *
 * ⚠️ **主役の決め方は既にある**（台本表の `mainAsset`＝`mainVisual` → `background` の順）ので、
 * **同じ順番**にする：`mainVisual` → その他の `slot`／`logo`（層の並び順）→ `background`。
 * 背景は「他に入れる所が無いときの受け皿」であって、押したときの第一候補ではない。
 */
function orderedForAssign(layers: readonly Layer[]): Layer[] {
  const rank = (l: Layer): number => {
    if (l.id === MAIN_VISUAL_LAYER_ID) return 0;
    return l.type === LAYER_TYPE.background ? 2 : 1;
  };
  return [...layers].sort((a, b) => rank(a) - rank(b));
}

/**
 * **空いていて、そのまま動画に出てしまう差し込み口**（#1030 ④）。純粋・副作用なし。
 *
 * ⚠️ **「差し込み口」ぜんぶではない**＝描く側（`layoutScene`）を読むと、空のときの扱いは層の種類で違う：
 * - `background`＝**塗り**になる（`layer.fillColor ?? defaults.backgroundColor`）＝**問題ではない**
 * - `logo`＝**何も置かない**＝問題ではない
 * - `slot`＝`assetId: null` の絵として**灰色の枠が焼き込まれる**＝**これだけが問題**
 *
 * ⚠️ **テンプレ既定素材（ADR-0021）も見る**＝`scene.assetRefs[l.id] ?? layer.assetId` の順は
 * 描画と同じ（`layoutScene`）。見ないと、既定素材で埋まっている口を「空」と数える。
 */
export function emptySlotLayerIds(
  layers: readonly Layer[],
  assetRefs: Readonly<Record<string, string | null | undefined>>,
): string[] {
  return layers
    .filter((l) => l.type === LAYER_TYPE.slot && !(assetRefs[l.id] ?? l.assetId))
    .map((l) => l.id);
}
