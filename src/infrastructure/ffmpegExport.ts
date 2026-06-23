// MP4書き出し（Tauriコマンド境界）。FFmpegの実行・コーデック選択はRust側（ffmpeg.rs）に隔離する（CLAUDE.md §4）。
// フロントは各場面のPNG（data URL）と尺を渡すだけ。SVG→PNGの生成は ADR-0004（WebView Canvas）でフロントが行う。
import { invoke } from '@tauri-apps/api/core';
import type { Fit } from '../domain/enums';
import type { ExportCapability } from '../domain/export/exportCapability';

/** 動画ありシーンの入力（ADR-0006）。下/上PNGは data URL、クリップはプロジェクト相対パス。 */
export interface ExportVideoInput {
  belowPngBase64: string;
  abovePngBase64: string;
  /** プロジェクト相対のクリップパス（例: "assets/asset_v.mp4"）。Rust がファイルとして読む。 */
  clipRelPath: string;
  slotX: number;
  slotY: number;
  slotW: number;
  slotH: number;
  fit: Fit;
  clipStartSec: number;
  clipEndSec?: number;
  useOriginalAudio: boolean;
  originalVolume?: number;
  /** 再生速度（0.5–2.0・1.0=等速）。Rust 側で setpts/atempo に反映。 */
  speed: number;
}

/** 書き出す1場面の入力。静止画は pngBase64、動画ありは video を指定（pngBase64 は未使用）。 */
export interface ExportSceneInput {
  /** 静止画シーンのPNG（data URL 可）。動画ありシーンでは空でよい。 */
  pngBase64?: string;
  durationSec: number;
  /** 場面のナレーション音声(WAV)。data URL も可。無い場面は無音トラックになる。 */
  audioBase64?: string;
  /** ナレーション音量（§6で解決済みの値）。音声がある場面のみ意味を持つ。 */
  narrationVolume?: number;
  /** 動画ありシーン（ADR-0006）。指定時は overlay 合成経路へ。 */
  video?: ExportVideoInput;
  /** この場面に「入る」トランジション（ADR-0009 T2）。先頭・none では未設定（ハードカット）。 */
  transition?: { name: string; durationSec: number; offsetSec: number };
}

/** BGM 入力（動画全体に重ねる）。audioBase64 は data URL も可。volume は §6 で解決済み。 */
export interface BgmInput {
  audioBase64: string;
  volume: number;
  fadeInSec?: number;
  fadeOutSec?: number;
  /** 一時ファイルの拡張子（例: "mp3"）。FFmpeg のフォーマット判定用。 */
  fileExt: string;
}

/** 書き出し結果の要約。codec は使用エンコーダ（例: libx264 / libopenh264）。 */
export interface ExportReport {
  outputPath: string;
  codec: string;
  sceneCount: number;
}

/** Tauri が利用可能か（ブラウザ開発時は書き出し不可）。 */
export function canExport(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** 場面群を実MP4へ書き出す。outputPath を渡すとそこへ保存し、無ければ既定 <appData>/exports/<fileName>.mp4。
 *  bgm 指定時は全体に重ねる。
 *  動画ありシーン（scene.video）を含む場合は projectId 必須（クリップをプロジェクトフォルダから解決する）。
 *  Tauri 非検出時は呼ばないこと（canExport で判定）。 */
export async function exportVideo(
  scenes: ExportSceneInput[],
  fileName: string,
  bgm?: BgmInput,
  projectId?: string,
  outputPath?: string,
): Promise<ExportReport> {
  return invoke<ExportReport>('export_video', {
    scenes,
    fileName,
    bgm: bgm ?? null,
    projectId: projectId ?? null,
    outputPath: outputPath ?? null,
  });
}

/** 書き出し前に H.264 エンコード能力を検知する（#120）。Tauri 専用＝呼ぶ前に canExport() で判定すること。 */
export async function detectH264Capability(): Promise<ExportCapability> {
  const r = await invoke<{ capability: ExportCapability }>('detect_h264_capability');
  return r.capability;
}
