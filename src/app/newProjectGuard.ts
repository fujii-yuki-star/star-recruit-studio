// 新規作成の破棄ガード判定＋未保存検知（純粋ロジック・テスト容易／CLAUDE.md §4・§7）。
//
// ⚠️ **`hooks/` ではなく `app/` 直下**（#924）＝React のフックではないので、`hooks/` に置くと
// 中身と置き場所が食い違う。`adapters.ts`／`navigation.ts`／`timelinePanels.ts`／`uiLabels.ts` と同じ並び。
// ⚠️ **`domain/` へは移さない**＝この判定は `infrastructure/sampleData`（見本の素材）を見るので、
// `domain` へ置くと**本番コードで初めての「domain → infrastructure」**を作る（§4 違反）。
// 直したい「純粋関数が hooks/ にある」より重い問題を新しく作らない、という判断（#924 に記録）。
import type { Asset, CompanyInfo, GeneralBrief } from "../domain/project/types";
import type { SaveStatus } from "./saveStatus";
import { sampleAssets } from "../infrastructure/sampleData";

// サンプル素材以外（ユーザーが取り込んだ素材）を「作業中の内容」とみなす。
const SAMPLE_ASSET_IDS = new Set(sampleAssets.map((a) => a.assetId));

/** ウィザードで入力された「動画の元ネタ」があるか（#401）＝会社名 or 発表テーマが入っている。
 *  ウィザード入力は scenes/assets にはまだ現れないため、これを「作業中の内容」に含めて破棄ガード/未保存表示/自動保存で守る。 */
export function hasWizardBrief(meta: { companyInfo?: CompanyInfo; generalBrief?: GeneralBrief }): boolean {
  return !!(meta.companyInfo?.companyName?.trim() || meta.generalBrief?.title?.trim());
}

/** 新規作成で失うと困る「作業中の内容」があるか＝場面が1つ以上／サンプル外の取り込み素材／ウィザード入力（#401）。 */
export function hasWorkInProgress(
  sceneCount: number,
  assets: Asset[],
  meta?: { companyInfo?: CompanyInfo; generalBrief?: GeneralBrief },
): boolean {
  return (
    sceneCount > 0 ||
    assets.some((a) => !SAMPLE_ASSET_IDS.has(a.assetId)) ||
    (meta ? hasWizardBrief(meta) : false)
  );
}

/**
 * 未保存の変更があるか（#256）＝保存待ち状態（idle＝編集後 / error＝保存失敗）で、失うと困る内容がある。
 * saved/saving は未保存でない。読み込み直後は saved（loadProject）＝未保存にならない。破棄ガード・未保存表示・自動保存判定で共有。
 */
export function hasUnsavedChanges(
  saveStatus: SaveStatus,
  sceneCount: number,
  assets: Asset[],
  meta?: { companyInfo?: CompanyInfo; generalBrief?: GeneralBrief },
): boolean {
  return (saveStatus === "idle" || saveStatus === "error") && hasWorkInProgress(sceneCount, assets, meta);
}
