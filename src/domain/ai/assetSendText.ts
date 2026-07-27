// 素材からAIへ送られる「文字情報」だけを抜き出す（純粋・§7）。
//
// §2-6（外部送信は事前確認必須）＝送信前確認画面で「実際に何を送るか」を利用者が見て判断できるようにする。
// ここを**単一の参照元**にし、プロンプト組み立て（buildVideoPlanRequest の assetBlock）と送信前確認 UI の
// 両方が同じフィールドを使う＝「画面で見せた内容」と「実際に送る内容」がズレない（ADR-0026②）。
// MVP はテキストのみ送信（画像・動画ファイルそのものは送らない＝12§4）。ここが送信対象テキストの定義。
import { AI_ASSET_SEND_MAX } from '../constants';
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

/**
 * 素材の「説明の充実度」（12§6 の *説明・タグの充実した順* を数値化）。大きいほど AI にとって手がかりが多い。
 *
 * **名前（displayName）は加点しない**：ファイル名は取り込みで必ず付くので全素材がほぼ同点になり、順位づけに効かない。
 * 効くのは**利用者/解析が足した情報**＝説明・AI解析・タグ。長さも見るのは、一文字の説明と詳しい説明を同点にしないため
 * （上限を設けて、長文1件が他を押しのけないようにする）。
 */
export function assetSendRichness(t: AssetSentText): number {
  const lenScore = (s: string): number => Math.min(s.length, RICHNESS_LEN_CAP);
  return (
    (t.description ? RICHNESS_FIELD_BONUS : 0) + lenScore(t.description) +
    (t.aiDescription ? RICHNESS_FIELD_BONUS : 0) + lenScore(t.aiDescription) +
    t.tags.length * RICHNESS_TAG_WEIGHT
  );
}
// 充実度の重み。「有る/無い」の差を長さの差より大きくし（説明が有ること自体を優先）、長文が独占しないよう長さに上限を置く。
// 送信内容の選定にしか使わない実装上の値なので 11§4 定数カタログには載せない（MAX_INLINE_ASSET_BYTES と同じ扱い）。
const RICHNESS_FIELD_BONUS = 50;
const RICHNESS_LEN_CAP = 100;
const RICHNESS_TAG_WEIGHT = 10;

/** 送信する素材の選定結果。`sent` が実際に送られる分、`omitted` が上限超過で送らない分（無言にしない・12§6）。 */
export interface AssetSendSelection {
  sent: Asset[];
  omitted: Asset[];
}

/**
 * AI へ送る素材を **12§6 の「充実した順に上位 N 件（既定 40）」** で選ぶ（純粋・§7）。
 *
 * **プロンプト組み立て（`buildVideoPlanUserMessage`）と送信前確認（`ConfirmScreen`）が必ずこれを共有する**
 * ＝「画面で見せた内容」と「実際に送る内容」がズレない（§2-6・ADR-0026②）。片方だけ絞ると確認画面が嘘になる。
 *
 * 上限以下なら**並べ替えない**（元の並び＝利用者が見慣れた順のまま）。超過したときだけ充実度で降順に選び、
 * 同点は元の並びを保つ（安定ソート）＝同じ入力なら毎回同じ結果（AI 応答の再現性）。
 */
export function selectAssetsForSend(assets: Asset[], max: number = AI_ASSET_SEND_MAX): AssetSendSelection {
  if (assets.length <= max) return { sent: assets, omitted: [] };
  // 元の並びを保った安定ソート（Array#sort は安定だが、比較が 0 のときの順序を明示するため index を持つ）。
  const ranked = assets
    .map((asset, index) => ({ asset, index, score: assetSendRichness(assetSentText(asset)) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  // 選ばれた分・落ちた分とも**元の並び順**に戻して返す（一覧の見え方を並べ替えない）。
  const byIndex = (a: { index: number }, b: { index: number }): number => a.index - b.index;
  return {
    sent: ranked.slice(0, max).sort(byIndex).map((r) => r.asset),
    omitted: ranked.slice(max).sort(byIndex).map((r) => r.asset),
  };
}
