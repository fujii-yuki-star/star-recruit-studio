// 素材からAIへ送られる「文字情報」だけを抜き出す（純粋・§7）。
//
// §2-6（外部送信は事前確認必須）＝送信前確認画面で「実際に何を送るか」を利用者が見て判断できるようにする。
// ここを**単一の参照元**にし、プロンプト組み立て（buildVideoPlanRequest の assetBlock）と送信前確認 UI の
// 両方が同じフィールドを使う＝「画面で見せた内容」と「実際に送る内容」がズレない（ADR-0026②）。
// MVP はテキストのみ送信（画像・動画ファイルそのものは送らない＝12§4）。ここが送信対象テキストの定義。
import type { AssetType } from '../enums';
import type { Asset } from '../project/types';

/** 1素材ぶんの「送信されるテキスト」。値は前後空白を除いた実値（空なら空文字＝未入力）。 */
export interface AssetSentText {
  assetId: string;
  assetType: AssetType;
  /** 表示名（多くはファイル名由来＝人名などが入りうるので送信対象として見せる）。 */
  name: string;
  /** 利用者がつけた説明。 */
  description: string;
  /** 取り込み時などの自動解析メモ（送るので見せる）。 */
  aiDescription: string;
  /** 利用者がつけたタグ。 */
  tags: string[];
}

const clean = (v: string | undefined | null): string => v?.trim() ?? '';

/** この素材から送られるテキストだけを取り出す（送信前確認とプロンプトの共有元）。 */
export function assetSentText(asset: Asset): AssetSentText {
  return {
    assetId: asset.assetId,
    assetType: asset.assetType,
    name: clean(asset.displayName),
    description: clean(asset.description),
    aiDescription: clean(asset.aiDescription),
    tags: (asset.tags ?? []).map((t) => t.trim()).filter((t) => t !== ''),
  };
}
