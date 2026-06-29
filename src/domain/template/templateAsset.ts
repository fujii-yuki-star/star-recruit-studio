// テンプレ所有素材（ADR-0021）。テンプレが既定で持つ背景等の画像を、グローバル（user_templates/assets）に
// 保存し layer.assetId から参照する。id 接頭辞 tmpl_asset_ でプロジェクト素材（asset_*）と区別する。
import type { Layer } from './types';

/** テンプレ所有素材の assetId 接頭辞。`tmpl_asset_NNN`（3桁ゼロ詰め・グローバル一意）。 */
export const TEMPLATE_ASSET_PREFIX = 'tmpl_asset';

/** assetId がテンプレ所有素材か（プロジェクト素材 `asset_*` と区別）。 */
export function isTemplateAsset(assetId: string): boolean {
  return assetId.startsWith(`${TEMPLATE_ASSET_PREFIX}_`);
}

/** `tmpl_asset_NNN` の連番部分を数値で返す（テンプレ素材でなければ null）。 */
export function templateAssetSeq(assetId: string): number | null {
  if (!isTemplateAsset(assetId)) return null;
  const rest = assetId.slice(`${TEMPLATE_ASSET_PREFIX}_`.length);
  const n = Number(rest);
  // 末尾が空（`tmpl_asset_`）は Number('')=0 になるため弾く（連番なし＝不正）。非数値も null。
  return rest !== '' && Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * 新しいテンプレ素材 id を採番する（既存の全テンプレ素材 id を渡す・グローバル一意）。**最大連番+1**。
 * テンプレ素材は登録したテンプレ専用（削除はテンプレと一緒）ゆえ、番号の再利用は無害＝seq の永続は持たない
 * （user_tmpl の no-reuse とは別方針＝別プロジェクトから参照されないため）。`999` 超は桁上がり。
 */
export function createTemplateAssetId(existingIds: readonly string[]): string {
  const max = existingIds.reduce((m, id) => Math.max(m, templateAssetSeq(id) ?? 0), 0);
  return `${TEMPLATE_ASSET_PREFIX}_${String(max + 1).padStart(3, '0')}`;
}

/**
 * テンプレのレイヤーが参照するテンプレ所有素材 id の一覧（重複排除・出現順）。
 * テンプレ削除時の素材ファイル掃除や、取込/書き出しの素材収集に使う（マニフェスト不要＝レイヤー参照が源泉）。
 */
export function templateAssetIdsOf(layers: readonly Layer[]): string[] {
  const out: string[] = [];
  for (const l of layers) {
    if (l.assetId && isTemplateAsset(l.assetId) && !out.includes(l.assetId)) out.push(l.assetId);
  }
  return out;
}
