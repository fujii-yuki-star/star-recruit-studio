// 取り込んだ写真を同梱の AI に読ませて、説明とタグを付ける（ADR-0052 決定4・12 §4b）。
// 純粋関数：指示文と出力の形・応答の読み取り・「読むか」「どう当てるか」の判定。呼び出し（llama-server）は infrastructure。
// ⚠️ **このパソコンの中で読む**＝外部送信ではない（§2-6 に当たらない）。付けた説明は `asset.aiDescription`（既存の欄）
//   に入り、Gemini を選んだときは送信前確認に「AI解析」として出る（12 §6・`assetSentText`）。
import { ASSET_AI_TAGS_MAX, ASSET_AI_TAG_MAX_LENGTH, ASSET_DESCRIPTION_MAX_LENGTH } from '../constants';
import { AI_DESCRIPTION_AUTHOR, ASSET_TYPE } from '../enums';
import type { Asset } from '../project/types';

export const DESCRIBE_ASSET_SYSTEM_PROMPT = `あなたは動画づくりのために写真の中身を短く書き留める係です。渡された写真に写っているもの・場所・人の様子・雰囲気を、動画のどの場面で使えるかが分かるように書きます。

【厳守事項】
- 説明は日本語の1文で、${ASSET_DESCRIPTION_MAX_LENGTH}字以内。見えていることだけを書く（推測で会社名・人の名前・地名を書かない）。
- タグは写真を探すときの短い語を${ASSET_AI_TAGS_MAX}個まで（1つ${ASSET_AI_TAG_MAX_LENGTH}字以内。例：オフィス、会議、笑顔、外観、作業）。
- 出力は {"description": "…", "tags": ["…"]} の JSON だけ。説明を付けない。`;

export interface DescribeAssetMessages {
  system: string;
  user: string;
  schema: Record<string, unknown>;
}

/** 写真1枚を読む指示文と出力の形。素材の名前は手がかりとして添える（利用者が付けたもの）。 */
export function buildDescribeAssetMessages(asset: Pick<Asset, 'displayName' | 'assetType'>): DescribeAssetMessages {
  const kind = asset.assetType === ASSET_TYPE.video ? '動画の代表の1コマ' : '写真';
  return {
    system: DESCRIBE_ASSET_SYSTEM_PROMPT,
    user: `この${kind}の説明とタグを書いてください。（ファイル名: ${asset.displayName}）`,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['description', 'tags'],
      properties: {
        description: { type: 'string', minLength: 1, maxLength: ASSET_DESCRIPTION_MAX_LENGTH },
        tags: {
          type: 'array',
          maxItems: ASSET_AI_TAGS_MAX,
          items: { type: 'string', minLength: 1, maxLength: ASSET_AI_TAG_MAX_LENGTH },
        },
      },
    },
  };
}

export interface AssetDescription {
  description: string;
  tags: string[];
}

/**
 * AI の応答（JSON 文字列）を読む。形が違う・説明が空なら null（付けない＝黙って変な説明を入れない）。
 * ⚠️ 長さはこちらでも確かめる（縛って出したことを成功の証明にしない）＝越えた説明は捨て、越えたタグは落とす。
 */
export function parseAssetDescription(raw: string): AssetDescription | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { description, tags } = parsed as { description?: unknown; tags?: unknown };
  if (typeof description !== 'string') return null;
  const d = description.trim();
  if (d.length === 0 || d.length > ASSET_DESCRIPTION_MAX_LENGTH) return null;
  const list = Array.isArray(tags) ? tags : [];
  const seen = new Set<string>();
  for (const t of list) {
    if (typeof t !== 'string') continue;
    const v = t.trim();
    if (v.length === 0 || v.length > ASSET_AI_TAG_MAX_LENGTH || seen.has(v)) continue;
    seen.add(v);
    if (seen.size === ASSET_AI_TAGS_MAX) break;
  }
  return { description: d, tags: [...seen] };
}

/**
 * この素材を読むか、読むならどのファイル（プロジェクトの中の相対パス）か。
 * - 写真：本体／動画：代表の1コマ（サムネイル）。**元の動画ファイルは読まない**（§2-6 の精神と同じ扱い）。
 * - **もう説明がある素材は読まない**＝利用者が直した値を AI が上書きしない（ADR-0052 決定4）。
 * - ゆうこ・ロゴ・BGM は読まない（場面に割り当てる写真・動画ではない）。
 */
export function describeTarget(asset: Asset): string | null {
  // 利用者が直した（空にしたも含む）説明は読まない＝AI が埋め直さない（#1317）。
  if (asset.aiDescriptionAuthor === AI_DESCRIPTION_AUTHOR.user) return null;
  if (asset.aiDescription?.trim()) return null;
  if (asset.assetType === ASSET_TYPE.image) return asset.filePath;
  if (asset.assetType === ASSET_TYPE.video) return asset.thumbnailPath ?? null;
  return null;
}

/**
 * 読んだ結果を素材に当てる（新しい素材を返す・元は壊さない）。
 * ⚠️ **待っている間に利用者が説明を書いたら当てない**（着地の直前にもう一度見る）。タグは**利用者のタグが無いときだけ**付ける
 * （利用者が付けたタグを増やしたり並べ替えたりしない）。当てるものが無ければ null。
 */
export function applyAssetDescription(asset: Asset, result: AssetDescription): Asset | null {
  if (asset.aiDescriptionAuthor === AI_DESCRIPTION_AUTHOR.user) return null;
  if (asset.aiDescription?.trim()) return null;
  const next: Asset = { ...asset, aiDescription: result.description, aiDescriptionAuthor: AI_DESCRIPTION_AUTHOR.ai };
  if ((asset.tags ?? []).length === 0 && result.tags.length > 0) next.tags = result.tags;
  return next;
}

/**
 * 写真を差し替えたときの「AI解析」（#1317）。**AI が付けた説明だけ**を外して読み直させる（前の写真の説明が残らない）。
 * 利用者が直した説明・誰が書いたか分からない説明（前の版）は触らない。タグは残す（誰が付けたか区別しない）。
 */
export function clearAiDescriptionOnReplace(asset: Asset): Asset {
  if (asset.aiDescriptionAuthor !== AI_DESCRIPTION_AUTHOR.ai) return asset;
  const next: Asset = { ...asset };
  delete next.aiDescription;
  delete next.aiDescriptionAuthor;
  return next;
}
