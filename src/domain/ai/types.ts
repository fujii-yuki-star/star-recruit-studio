// AI出力（ai-video-plan）の型。正典は docs/yuko_recruit_docs/schemas/ai-video-plan.schema.json と 12_AI_PROMPT_AND_MAPPING.md。
// 内部 Scene とは別物。検証→補正→変換を経て内部データになる。
import type { Purpose, SceneCategory, TextKey } from '../enums';

export interface AiScene {
  sceneTitle?: string;
  sceneType: SceneCategory;
  templateId: string;
  durationSec: number;
  assetRefs?: Record<string, string | null>;
  yukoPoseTag?: string | null;
  texts: Partial<Record<TextKey, string>>;
  narrationText: string;
  notes?: string;
}

export interface AiVideoPlanPart {
  partTitle: string;
  summary?: string;
  targetDurationSec?: number;
  scenes: AiScene[];
}

export interface AiVideoPlanHeader {
  title: string;
  purpose: Purpose;
  targetAudience?: string;
  targetDurationSec: number;
  tone?: string;
}

export interface AiVideoPlan {
  schemaVersion: string;
  videoPlan: AiVideoPlanHeader;
  parts: AiVideoPlanPart[];
  reviewNotes?: string[];
}
