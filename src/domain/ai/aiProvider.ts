// AIプロバイダの抽象。初期は MockProvider で全フローを通す（CLAUDE.md §4 / 12 §2）。
import type { Purpose, VideoKind } from '../enums';
import type { Asset, CompanyInfo, GeneralBrief } from '../project/types';
import type { AiVideoPlan } from './types';

/** AIへ渡すテンプレ要約（template.json 全体ではなく選定に必要な分だけ。12 §4）。 */
export interface TemplateSummary {
  templateId: string;
  category: string;
  useCase?: string;
  /** テンプレの slot 層 id（required=true のみでなく**利用可能な slot 全体**を AI に知らせ、assetRefs を正しく生成させる）。 */
  requiredSlots?: string[];
  hasYuko: boolean;
  maxNarrationLength?: number;
  maxSubtitleLength?: number;
  maxDurationSec?: number;
}

export interface GenerateVideoPlanInput {
  /** 動画の種類（ADR-0011）。省略時は recruit。 */
  videoKind?: VideoKind;
  /** recruit のとき。general では未指定（§6b は会社情報を使わない）。 */
  companyInfo?: CompanyInfo;
  /** general のとき（テーマ・章立て・要点）。 */
  generalBrief?: GeneralBrief;
  purpose: Purpose;
  targetAudience?: string;
  targetDurationSec: number;
  tone?: string;
  /** 利用者の自由記述（両用途共通・そのまま送る）。 */
  additionalNotes?: string;
  templates: TemplateSummary[];
  assets: Asset[];
  yukoPoseTags: string[];
}

/**
 * AIプロバイダ。MVPでは generateVideoPlan のみ実装し、
 * rewriteNarration / reviewScript / classifyAssets は後続フェーズで追加する（12 §2）。
 */
export interface AiProvider {
  generateVideoPlan(input: GenerateVideoPlanInput): Promise<AiVideoPlan>;
}
