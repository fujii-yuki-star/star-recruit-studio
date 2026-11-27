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
}

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
}

export interface Asset {
  id: string;
  kind: string;
  name: string;
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
  | { op: "updateLayer"; layerId: string; patch: Record<string, unknown> }
  | { op: "removeLayer"; layerId: string }
  | { op: "moveLayer"; layerId: string; index: number }
  | { op: "splitLayer"; layerId: string; frame: number };
