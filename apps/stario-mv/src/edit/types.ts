// 編集に使う動画の形（正典＝`docs/stario_mv_docs/schemas/mv-project.schema.json`）のうち、タイムラインが読む所だけ。
// ⚠️ 形を決めるのは schema＝ここで項目を足さない（読む所の型だけ）。書くのは取引（`mv-operations.json`）で。

/** レイヤーの種類（schema の `Layer.type`）。 */
export type LayerType =
  | "video"
  | "image"
  | "text"
  | "shape"
  | "solid"
  | "adjustment"
  | "null"
  | "camera"
  | "audio"
  | "precomp";

export interface Layer {
  id: string;
  name: string;
  type: LayerType;
  enabled: boolean;
  locked: boolean;
  solo?: boolean;
  /** 見え始めるフレーム（含む）。 */
  inFrame: number;
  /** 見え終わるフレーム（含まない）。 */
  outFrame: number;
  /** 素材の時刻 0 を置くフレーム。 */
  startFrame: number;
  /** 親（同じコンポジションのレイヤー・MV-0010 決定5）。 */
  parentId?: string | null;
  /** 入れ子のレイヤーが指すコンポジション（MV-0011）。 */
  compositionId?: string;
  /** タイムリマップ＝そのフレームで見せる素材の秒（MV-0012）。 */
  timeRemap?: Animatable;
  /** モーションブラーのスイッチ（MV-0013）。 */
  motionBlur?: boolean;
  blendMode?: BlendMode;
  transform?: Partial<Record<TransformKey, Animatable>>;
  text?: { text: string; fontFamily: string; fontSize: number; fill: Color } & Record<string, unknown>;
  solid?: { color: Color; width: number; height: number };
  shape?: { kind: "rectangle" | "ellipse" | "path"; size?: Animatable; cornerRadius?: Animatable; fill?: Color } & Record<
    string,
    unknown
  >;
}

/** 色＝[赤, 緑, 青, 不透明度]、各 0〜1（sRGB）。 */
export type Color = [number, number, number, number];

export type TransformKey = "anchor" | "position" | "scale" | "rotation" | "opacity";

/** 値（数か、数の並び）。 */
export type AnimValue = number | number[];

/** キーフレーム（frame はコンポジションのフレーム）。 */
export interface Keyframe {
  frame: number;
  value: AnimValue;
  interpolation: "hold" | "linear" | "bezier";
  [k: string]: unknown;
}

/** 動かせる値＝固定値・キーフレーム・式のどれか1つ（schema の `Animatable`）。 */
export interface Animatable {
  value?: AnimValue;
  keyframes?: Keyframe[];
  expression?: { language: string; source: string };
  [k: string]: unknown;
}

/** 描画モード（schema の `BlendMode`）。⚠️ 並びは schema と同じ。 */
export const BLEND_MODES = [
  "normal",
  "add",
  "multiply",
  "screen",
  "overlay",
  "softLight",
  "hardLight",
  "colorDodge",
  "colorBurn",
  "darken",
  "lighten",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

export interface Marker {
  id: string;
  frame: number;
}

export interface Composition {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: { num: number; den: number };
  durationFrames: number;
  /** 先頭が最前面。 */
  layers: Layer[];
  markers: Marker[];
  /** モーションブラー（MV-0013）。かかるのは、ここの enabled とレイヤーの motionBlur の両方が true のときだけ。 */
  motionBlur?: { enabled: boolean; shutterAngle?: number; shutterPhase?: number; samples?: number };
}

export interface Asset {
  id: string;
  kind: "video" | "image" | "imageSequence" | "svg" | "audio";
  name: string;
  /** 中身の指紋（差し替わりの検知）。 */
  sha256?: string;
  /** 取り込み時に調べた情報。 */
  meta?: {
    width?: number;
    height?: number;
    durationSec?: number;
    frameCount?: number;
    fps?: { num: number; den: number };
    hasAlpha?: boolean;
    hasAudio?: boolean;
  };
}

export interface ProjectDoc {
  name: string;
  mainCompositionId: string;
  compositions: Composition[];
  assets: Asset[];
}

/** 画面が見ている版つきの動画（Rust の `edit::read`）。 */
export interface EditDoc {
  revision: string;
  project: ProjectDoc;
}

/** 取引の中の1つの編集（`mv-operations.json` の `applyTransaction` の `ops`）。 */
export type Op =
  | { op: "addLayer"; layer: Record<string, unknown>; index?: number; compositionId?: string }
  | { op: "importAsset"; path: string; mode?: "copy" | "reference"; name?: string }
  | { op: "updateLayer"; layerId: string; patch: Record<string, unknown> }
  | { op: "updateComposition"; compositionId: string; patch: Record<string, unknown> }
  | { op: "removeLayer"; layerId: string }
  | { op: "moveLayer"; layerId: string; index: number }
  | { op: "splitLayer"; layerId: string; frame: number }
  | { op: "setParent"; layerId: string; parentId: string | null; frame: number }
  | { op: "precompose"; layerIds: string[]; name?: string }
  | { op: "setSpeed"; layerId: string; percent: number }
  | { op: "enableTimeRemap"; layerId: string; enabled: boolean };

/** レイヤーを直す編集（値の欄の操作は全部これ）。 */
export type UpdateOp = Extract<Op, { op: "updateLayer" }>;
