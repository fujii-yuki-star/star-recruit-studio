import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Fps } from "./timecode";
import type { Bounds } from "../edit/overlay";

/** 開いた動画の要約（Rust の `summary`）。 */
export interface ProjectSummary {
  dir: string;
  name: string;
  mainCompositionId: string;
  compositions: {
    id: string;
    name: string;
    width: number;
    height: number;
    fps: Fps;
    durationFrames: number;
  }[];
  issues: { path: string; message: string }[];
}

/** プレビューの今の状態（Rust の `preview::Status`）。 */
export interface PreviewStatus {
  compositionId: string;
  frame: number;
  playing: boolean;
  fps: number;
  dropped: number;
  /** 音を鳴らして、その時計で進めているか。 */
  audio: boolean;
}

/** 欄の矩形（物理の画素＝窓の左上から）。 */
export interface PanelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * プレビューの糸への命令（MV-0007 決定2）。⚠️ 画面は命令を送るだけ＝描くのは Rust の描画の核。
 * 1か所に集める＝検査で差し替えられるようにする。
 */
export const previewApi = {
  pickProjectFolder: (): Promise<string | null> => invoke("pick_project_folder"),
  initialProject: (): Promise<string | null> => invoke("initial_project"),
  openProject: (dir: string): Promise<ProjectSummary> => invoke("open_project", { dir }),
  setRect: (r: PanelRect): Promise<void> => invoke("preview_set_rect", { ...r }),
  play: (): Promise<void> => invoke("preview_play"),
  pause: (): Promise<void> => invoke("preview_pause"),
  seek: (frame: number): Promise<void> => invoke("preview_seek", { frame }),
  step: (delta: number): Promise<void> => invoke("preview_step", { delta }),
  setComposition: (id: string): Promise<void> => invoke("preview_set_composition", { id }),
  setMuted: (muted: boolean): Promise<void> => invoke("preview_set_muted", { muted }),
  /** 今のコマの、見えているレイヤーの枠（描画の核が求める・窓の画素＝MV-0008 決定6）。 */
  bounds: (): Promise<Bounds> => invoke("preview_bounds"),
  onStatus: (f: (s: PreviewStatus) => void): Promise<UnlistenFn> =>
    listen<PreviewStatus>("preview-status", (e) => f(e.payload)),
  onError: (f: (m: string | null) => void): Promise<UnlistenFn> =>
    listen<string | null>("preview-error", (e) => f(e.payload)),
  onNotice: (f: (m: string | null) => void): Promise<UnlistenFn> =>
    listen<string | null>("preview-notice", (e) => f(e.payload)),
  onProjectChanged: (f: (s: ProjectSummary) => void): Promise<UnlistenFn> =>
    listen<ProjectSummary>("project-changed", (e) => f(e.payload)),
};
