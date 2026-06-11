// enum値の正典は docs/yuko_recruit_docs/11_SCHEMA_REFERENCE.md §3。
// ここは対応するTypeScript定義（文字列リテラル直書きを避けるため、コードはここを参照する）。

export const SCENE_CATEGORIES = [
  'opening', 'closing', 'photo_intro', 'video_intro',
  'point_list', 'message', 'full_visual', 'chapter', 'no_yuko',
] as const;
export type SceneCategory = (typeof SCENE_CATEGORIES)[number];

export const ASSET_TYPES = [
  'image', 'video', 'bgm', 'voice', 'yuko', 'decor', 'logo', 'qr',
] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const PURPOSES = [
  'company_intro', 'new_graduate', 'mid_career',
  'inexperienced_welcome', 'engineer', 'info_session', 'sns_short',
] as const;
export type Purpose = (typeof PURPOSES)[number];

export const LAYER_TYPES = [
  'background', 'slot', 'text', 'subtitle', 'character', 'decor', 'shape', 'logo',
] as const;
export type LayerType = (typeof LAYER_TYPES)[number];

export const SLOT_TYPES = ['image_or_video', 'image', 'video'] as const;
export type SlotType = (typeof SLOT_TYPES)[number];

export const FITS = ['cover', 'contain', 'stretch'] as const;
export type Fit = (typeof FITS)[number];

export const TEXT_KEYS = ['title', 'main', 'subtitle', 'caption', 'url'] as const;
export type TextKey = (typeof TEXT_KEYS)[number];

export const TRANSITION_TYPES = ['none', 'fade', 'slide', 'wipe', 'zoom'] as const;
export type TransitionType = (typeof TRANSITION_TYPES)[number];

export const NARRATION_STATUSES = ['none', 'pending', 'generated', 'failed'] as const;
export type NarrationStatus = (typeof NARRATION_STATUSES)[number];

export const RENDER_STATUSES = ['idle', 'running', 'completed', 'failed'] as const;
export type RenderStatus = (typeof RENDER_STATUSES)[number];

export const FORMALITIES = ['casual', 'standard', 'formal'] as const;
export type Formality = (typeof FORMALITIES)[number];

// schema の Warning.severity に対応
export const WARNING_SEVERITIES = ['info', 'warning', 'error'] as const;
export type WarningSeverity = (typeof WARNING_SEVERITIES)[number];

/** 文字列が有効な sceneCategory か判定する型ガード（AI出力の検証で使う）。 */
export function isSceneCategory(value: string): value is SceneCategory {
  return (SCENE_CATEGORIES as readonly string[]).includes(value);
}
