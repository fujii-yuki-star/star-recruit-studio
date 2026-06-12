// MP4書き出し（Tauriコマンド境界）。FFmpegの実行・コーデック選択はRust側（ffmpeg.rs）に隔離する（CLAUDE.md §4）。
// フロントは各場面のPNG（data URL）と尺を渡すだけ。SVG→PNGの生成は ADR-0004（WebView Canvas）でフロントが行う。
import { invoke } from '@tauri-apps/api/core';

/** 書き出す1場面の入力。pngBase64 は data URL も可（Rust側で本体を取り出す）。 */
export interface ExportSceneInput {
  pngBase64: string;
  durationSec: number;
  /** 場面のナレーション音声(WAV)。data URL も可。無い場面は無音トラックになる。 */
  audioBase64?: string;
  /** ナレーション音量（§6で解決済みの値）。音声がある場面のみ意味を持つ。 */
  narrationVolume?: number;
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

/** 場面PNG群を実MP4へ書き出す（保存先は <appData>/exports/<fileName>.mp4）。Tauri 非検出時は呼ばないこと（canExport で判定）。 */
export async function exportVideo(scenes: ExportSceneInput[], fileName: string): Promise<ExportReport> {
  return invoke<ExportReport>('export_video', { scenes, fileName });
}
