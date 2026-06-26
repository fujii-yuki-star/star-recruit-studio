// AI出力（ai-video-plan）の型。正典は docs/yuko_recruit_docs/schemas/ai-video-plan.schema.json と 12_AI_PROMPT_AND_MAPPING.md。
// 内部 Scene とは別物。検証→補正→変換を経て内部データになる。
import type { Purpose, SceneCategory, TextKey } from '../enums';

/** 掛け合い（複数のセリフ）の1行（AI出力・#180）。voiceCharacter は voiceCatalog のキャラ名（speaker 数値ではなく名前）。 */
export interface AiNarrationLine {
  text: string;
  /** voiceCatalog のキャラ名（例「ずんだもん」）。未指定/未知は既定声。`AiScene.character`(ゆうこポーズ)とは別概念ゆえ別名。 */
  voiceCharacter?: string;
  /** 字幕文。未指定は text を流用。 */
  subtitle?: string;
  /** この行の字幕 ON/OFF。 */
  subtitleEnabled?: boolean;
}

export interface AiScene {
  sceneTitle?: string;
  sceneType: SceneCategory;
  templateId: string;
  durationSec: number;
  assetRefs?: Record<string, string | null>;
  yukoPoseTag?: string | null;
  texts: Partial<Record<TextKey, string>>;
  /** AI が空のとき null/省略しうる（自動リトライせず1回で通すため許容）。変換で空文字に整える＝無音シーン。 */
  narrationText?: string | null;
  /** 掛け合い（複数のセリフ・任意・#180）。あれば scene.lines へ変換、無ければ narrationText を単一 narration に。 */
  narrationLines?: AiNarrationLine[];
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
