// 見た目パターン（テンプレート）の型。正典は docs/yuko_recruit_docs/schemas/template.schema.json と 04_TEMPLATE_SPEC.md。
import type { Fit, LayerShapeType, LayerType, Orientation, SceneCategory, SlotType, TextKey, TransitionType } from '../enums';
import type { Group } from '../group/types';

/**
 * 文字の影（#264）。`enabled` のときだけ描く。未指定/`false`＝影なし＝**従来の出力は不変**。
 *
 * ⚠️ **両形式で使う語彙**（ADR-0032 追補3）＝タイムラインの文字クリップは「FREE 要素＋時間」で
 * 描画核（`layoutScene` の FREE 分岐）を共有するので、ここへ足せば二重投資にならない。
 * 「タイムラインだけ」と線を引くと**同じ語彙に「片方でしか編集できない項目」**ができて分岐が増える。
 */
export interface TextShadow {
  enabled?: boolean;
  /** 影の色（`#RRGGBB`）。未指定＝黒。 */
  color?: string;
  /** 濃さ（0〜1）。未指定＝0.5。 */
  opacity?: number;
  /** ぼかし（canvas px・0＝くっきり）。 */
  blur?: number;
  /** 右へのずらし（canvas px・負で左）。 */
  dx?: number;
  /** 下へのずらし（canvas px・負で上）。 */
  dy?: number;
}

/**
 * 色の調整（ADR-0044 ①）。**未指定＝調整なし**（従来の出力は不変）。
 *
 * ⚠️ **両形式で同じ語彙**＝schema も共有の `$defs`（`ColorAdjust`）を指している（写しを作らない）。
 * ⚠️ **掛ける順は 明るさ→コントラスト→彩度→色温度**＝入れ替えると同じ数字でも別の絵になるので、
 * 画面の並びとこの順番を揃える（`renderer/colorFilter.ts`）。
 */
export interface ColorAdjust {
  /** 明るさ（1＝そのまま・0＝黒）。 */
  brightness?: number;
  /** コントラスト（1＝そのまま）。 */
  contrast?: number;
  /** 彩度（1＝そのまま・0＝白黒）。 */
  saturation?: number;
  /** 色温度（0＝そのまま・+1＝暖色寄り・−1＝寒色寄り）。 */
  temperature?: number;
}

/**
 * 描画モード（ADR-0044 ②）。**未指定＝`normal`**（従来の出力は不変）。
 *
 * ⚠️ **混ぜるのは合成の単位（ADR-0032 決定19）より前**＝畳んだ後だと**フェード中だけ混ざり方が変わる**。
 * ⚠️ **持てるのはタイムライン形式のクリップだけ**（ADR-0044 追補1）＝場面形式は凍結（ADR-0032）なので
 * `FreeElement` には足していない。足すと**プレビューにだけ出て書き出しに出ない**（層に割って FFmpeg が重ねるため）。
 */
export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'plus-lighter';

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
  /** 回転角（度・0以上360未満・中心軸・時計回り。未指定=回転なし。FreeElement と同仕様）。 */
  rotation?: number;
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
  /**
   * 字間（em・#264）。**文字サイズに対する割合**＝サイズを変えても詰め具合が変わらない。
   * 未指定＝0（従来の出力は不変）。負で詰める。制約は `FreeElement` の同名と同一（§2-7）。
   */
  letterSpacing?: number;
  /** 文字の影（#264）。未指定/`enabled:false`＝影なし（従来の出力は不変）。 */
  shadow?: TextShadow;
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

/**
 * テンプレ（見た目パターン）の schema 版（11 §1）。値の正典は `schemas/template.schema.json` の
 * `properties.schemaVersion.const` で、ここはその写し。場面形式（`PROJECT_SCHEMA_VERSION`）・
 * タイムライン形式（`TIMELINE_SCHEMA_VERSION`）と**独立に進む**（別の文書なので釣られて上げない）。
 */
export const TEMPLATE_SCHEMA_VERSION = '1.0';

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
