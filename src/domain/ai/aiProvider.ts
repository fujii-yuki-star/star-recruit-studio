// AIプロバイダの抽象。初期は MockProvider で全フローを通す（CLAUDE.md §4 / 12 §2）。
import type { Purpose } from '../enums';
import type { Asset, CompanyInfo } from '../project/types';
import type { AiVideoPlan } from './types';

/** AIへ渡すテンプレ要約（template.json 全体ではなく選定に必要な分だけ。12 §4）。 */
export interface TemplateSummary {
  templateId: string;
  category: string;
  useCase?: string;
  requiredSlots?: string[];
  hasYuko: boolean;
  maxNarrationLength?: number;
  maxSubtitleLength?: number;
  maxDurationSec?: number;
}

export interface GenerateVideoPlanInput {
  companyInfo: CompanyInfo;
  purpose: Purpose;
  targetAudience?: string;
  targetDurationSec: number;
  tone?: string;
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
