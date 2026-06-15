// 新規作成の破棄ガード判定（純粋ロジック・テスト容易／CLAUDE.md §4・§7）。
import type { Asset } from "../../domain/project/types";
import { sampleAssets } from "../../infrastructure/sampleData";

// サンプル素材以外（ユーザーが取り込んだ素材）を「作業中の内容」とみなす。
const SAMPLE_ASSET_IDS = new Set(sampleAssets.map((a) => a.assetId));

/** 新規作成で失うと困る「作業中の内容」があるか＝場面が1つ以上、またはサンプル外の取り込み素材がある。 */
export function hasWorkInProgress(sceneCount: number, assets: Asset[]): boolean {
  return sceneCount > 0 || assets.some((a) => !SAMPLE_ASSET_IDS.has(a.assetId));
}
