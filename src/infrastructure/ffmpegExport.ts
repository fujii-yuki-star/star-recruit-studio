// MP4書き出し（Tauriコマンド境界）。FFmpegの実行・コーデック選択はRust側（ffmpeg.rs）に隔離する（CLAUDE.md §4）。
// フロントは各場面のPNG（data URL）と尺を渡すだけ。SVG→PNGの生成は ADR-0004（WebView Canvas）でフロントが行う。
import { invoke } from '@tauri-apps/api/core';
import type { Fit } from '../domain/enums';
import type { ExportCapability } from '../domain/export/exportCapability';

/** 動画ありシーンの入力（ADR-0006）。下/上PNGは data URL、クリップはプロジェクト相対パス。 */
export interface ExportVideoInput {
  /** 下層PNG（不透明・全面）。belowFramesDir（動画×アニメ・#435 P1）指定時は省略。 */
  belowPngBase64?: string;
  /** 全尺の上PNG（従来の1枚）。aboveSegments 指定時は省略。 */
  abovePngBase64?: string;
  /** 掛け合い×動画：行区間つき上PNG（字幕/クレジット差し替え・表示窓 [startSec, endSec)）。 */
  aboveSegments?: { pngBase64: string; startSec: number; endSec: number }[];
  /** 動画×アニメ（#435）：最上層を per-frame で焼くステージング済みフレームdir名。指定時は abovePngBase64 の代わり。 */
  aboveFramesDir?: string;
  /** 動画×アニメ（#435 P1）：下層を per-frame で焼くフレームdir名。指定時は belowPngBase64 の代わり。 */
  belowFramesDir?: string;
  /** 動画×アニメ（#435 P1）：中間層を per-frame で焼くフレームdir名（枚数＝動画本数−1）。指定時は midLayers の代わり。 */
  midFramesDirs?: string[];
  /** per-frame（below/mid/above）フレームレート（既定 30）。 */
  aboveFramesFps?: number;
  /** 掛け合い×動画：行ごとのナレーション（delaySec 秒に配置・windowSec の窓で切り詰め＝#385）。無ければ場面単位の audioBase64（従来）。 */
  narrationSegments?: { audioBase64: string; delaySec: number; windowSec: number }[];
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
  /** 連続する動画レイヤーの間の静止層PNG（透過・base64・枚数＝動画本数−1・#431）。1動画では空/省略。 */
  midLayers?: string[];
  /** 2本目以降の動画レイヤー（zIndex 昇順・先頭動画の上・#431）。1動画では空/省略。先頭動画は上のフィールド。 */
  videoLayers?: {
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
    speed: number;
  }[];
}

/** 書き出す1場面の入力。静止画は pngBase64、動画ありは video、アニメ場面は framesBase64 を指定。 */
export interface ExportSceneInput {
  /** 静止画シーンのPNG（data URL 可）。動画あり/アニメ場面では空でよい。 */
  pngBase64?: string;
  /** アニメ場面のフレーム列（④・ADR-0019・data URL 可）。指定時は fps とともに image2 で1動画に焼く（pngBase64 は未使用）。 */
  framesBase64?: string[];
  /** ステージング済みフレームの相対ディレクトリ名（stageExportFrame で書き出し済み）。framesBase64 より優先＝巨大IPC回避。 */
  framesDir?: string;
  /** framesBase64 のフレームレート（既定 30）。 */
  fps?: number;
  durationSec: number;
  /** 場面のナレーション音声(WAV)。data URL も可。無い場面は無音トラックになる。 */
  audioBase64?: string;
  /** ナレーション音量（§6で解決済みの値）。音声がある場面のみ意味を持つ。 */
  narrationVolume?: number;
  /** 動画ありシーン（ADR-0006）。指定時は overlay 合成経路へ。 */
  video?: ExportVideoInput;
  /** この場面に「入る」トランジション（ADR-0009 T2）。先頭・none では未設定（ハードカット）。 */
  transition?: { name: string; durationSec: number; offsetSec: number };
  /** 論理的な「場面」の先頭セグメントか（#430）。同一場面の後続セグメント（掛け合いの間/行）は false／未指定。
   *  Rust は同じ場面のセグメントを連結してから場面クリップ単位で xfade する（入場遷移を間の短さで縮めない）。 */
  sceneStart?: boolean;
}

/** 場面ごとBGMの1クリップ入力（ADR-0018 ③(7)）。planBgmMix が配置(delaySec)・使う長さ(playSec)・前後フェードを算出済み。data URL 可・volume は §6 解決済み。 */
export interface BgmRunInput {
  audioBase64: string;
  /** 一時ファイルの拡張子（例: "mp3"）。FFmpeg のフォーマット判定用。 */
  fileExt: string;
  volume: number;
  /** グローバル配置開始（秒）＝adelay。 */
  delaySec: number;
  /** ループ素材から使う長さ（秒）＝atrim。 */
  playSec: number;
  fadeInSec: number;
  fadeOutSec: number;
}

/** タイムラインのテロップ帯（ADR-0018）。透過PNG（出力解像度）を結合後の動画へ enable='between(t,S,E)' で重ねる。 */
export interface TelopOverlayInput {
  pngBase64: string;
  /** 表示区間（グローバル秒＝xfade 重なり込みの実効時間軸・compileTimeline と一致）。 */
  startSec: number;
  endSec: number;
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
 *  bgmRuns 指定時は場面ごとBGM（区間ごとに配置＋クロスフェード・ADR-0018 ③(7)）を重ねる。
 *  動画ありシーン（scene.video）を含む場合は projectId 必須（クリップをプロジェクトフォルダから解決する）。
 *  Tauri 非検出時は呼ばないこと（canExport で判定）。 */
export async function exportVideo(
  scenes: ExportSceneInput[],
  fileName: string,
  bgmRuns?: BgmRunInput[],
  projectId?: string,
  outputPath?: string,
  telops?: TelopOverlayInput[],
): Promise<ExportReport> {
  return invoke<ExportReport>('export_video', {
    scenes,
    fileName,
    bgmRuns: bgmRuns && bgmRuns.length > 0 ? bgmRuns : null,
    projectId: projectId ?? null,
    outputPath: outputPath ?? null,
    telops: telops && telops.length > 0 ? telops : null,
  });
}

/**
 * アニメ場面のフレームを1枚ステージングへ書き出す（巨大な base64 を1回の IPC に載せると JSON.stringify が
 * 文字列上限を超えて失敗するため、フレームは逐次に小さく保存し export_video には framesDir だけ渡す）。
 * dirName は場面ごとの相対名（英数字と _・例 `scene_frames_2`）。Tauri 専用＝canExport() で判定してから呼ぶ。
 */
export async function stageExportFrame(dirName: string, frameIndex: number, dataBase64: string): Promise<void> {
  await invoke('stage_export_frame', { dirName, frameIndex, dataBase64 });
}

/** フレームのステージングを空にする（書き出しの前後で呼ぶ）。非存在は成功扱い（Rust 側）。 */
export async function clearExportFramesStage(): Promise<void> {
  await invoke('clear_export_frames_stage');
}

/** 書き出し前に H.264 エンコード能力を検知する（#120）。Tauri 専用＝呼ぶ前に canExport() で判定すること。 */
export async function detectH264Capability(): Promise<ExportCapability> {
  const r = await invoke<{ capability: ExportCapability }>('detect_h264_capability');
  return r.capability;
}
