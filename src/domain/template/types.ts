// 見た目パターン（テンプレート）の型。正典は docs/yuko_recruit_docs/schemas/template.schema.json と 04_TEMPLATE_SPEC.md。
import type { Fit, LayerShapeType, LayerType, Orientation, SceneCategory, SlotType, TextKey, TransitionType } from '../enums';
import type { Group } from '../group/types';

export interface LayerBackground {
  enabled?: boolean;
  color?: string;
  opacity?: number;
  radius?: number;
}

export interface Layer {
  id: string;
  type: LayerType;
  x: number;
  y: number;
  w: number;
  h: number;
  zIndex?: number;
  required?: boolean;
  slotType?: SlotType;
  fit?: Fit;
  textKey?: TextKey;
  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
  color?: string;
  maxLines?: number;
  autoResize?: boolean;
  defaultPoseTag?: string;
  allowHidden?: boolean;
  assetId?: string;
  shapeType?: LayerShapeType;
  fillColor?: string;
  opacity?: number;
  radius?: number;
  background?: LayerBackground;
  /** 文字/字幕の縁取り（#275・任意）。strokeWidth>0 のとき描画（FREE の #209 と同じ仕組みを流用）。 */
  strokeColor?: string;
  strokeWidth?: number;
}

export interface TemplateAiHint {
  useCase?: string;
  recommendedSceneTypes?: SceneCategory[];
  maxDurationSec?: number;
  maxNarrationLength?: number;
  maxSubtitleLength?: number;
}

export interface TemplateDefaults {
  durationSec?: number;
  transitionIn?: TransitionType;
  transitionOut?: TransitionType;
  backgroundColor?: string;
}

export interface Template {
  schemaVersion: string;
  templateId: string;
  name: string;
  description?: string;
  category: SceneCategory;
  /** 向き（16:9=横型／9:16=縦型・ADR-0012）。project の aspectRatio と一致するテンプレのみ選ぶ（B4 で検証）。 */
  aspectRatio: Orientation;
  canvas: { width: number; height: number };
  aiHint?: TemplateAiHint;
  defaults?: TemplateDefaults;
  layers: Layer[];
  /** 要素のグループ化（ADR-0022）。メンバー＝layer id（ネストで group id も可）。未設定＝グループ無し。 */
  groups?: Group[];
}
