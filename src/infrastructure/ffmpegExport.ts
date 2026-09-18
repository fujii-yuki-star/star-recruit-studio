// MP4書き出し（Tauriコマンド境界）。FFmpegの実行・コーデック選択はRust側（ffmpeg.rs）に隔離する（CLAUDE.md §4）。
// フロントは各場面のPNG（data URL）と尺を渡すだけ。SVG→PNGの生成は ADR-0004（WebView Canvas）でフロントが行う。
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Fit } from '../domain/enums';
import type { ExportCapability } from '../domain/export/exportCapability';
import type { ExportProgressEvent } from '../domain/export/exportProgress';
import {
  canEstimateDisk,
  diskFloorMessage,
  diskFloorShortfall,
  diskIsShort,
  diskShortMessage,
  diskShortfall,
  remainingBakeBytes,
  shouldCheckDisk,
} from '../domain/export/diskPlan';

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
  /** 窓 Frames セグメント（#442・動画スロット本体アニメ）のクリップ元音声（複数動画スロット対応）。非空のとき Rust が audioBase64 と全本を amix する。 */
  clipAudios?: { clipRelPath: string; clipStartSec: number; durSec: number; speed: number; volume?: number; delaySec?: number }[];
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
  /** 音源の中身（base64）。**`audioPath` を渡すときは空でよい**。 */
  audioBase64: string;
  /**
   * 音源のプロジェクト相対パス（#512 段2＝**動画の元の音**）。指定があれば中身より優先される。
   * ⚠️ 動画を base64 にすると数百MBの文字列を作ることになるので、動画はパスで渡す
   * （場面形式の動画スロットも `clipRelPath` を渡している＝同じ流儀）。
   */
  audioPath?: string;
  /** 一時ファイルの拡張子（例: "mp3"）。FFmpeg のフォーマット判定用。 */
  fileExt: string;
  volume: number;
  /**
   * 音量の変化（#512）を `volume` フィルタの式にしたもの（`t`＝この音の先頭からの秒）。
   * **未指定＝`volume` の一定値**（場面形式は指定しない＝従来の音のまま）。式は domain の
   * `volumeExpr` が点列から組む＝**再生と同じ点列・同じ規則**（ADR-0032 追補＝案A）。
   */
  volumeExpr?: string;
  /** グローバル配置開始（秒）＝adelay。 */
  delaySec: number;
  /** ループ素材から使う長さ（秒）＝atrim。 */
  playSec: number;
  fadeInSec: number;
  fadeOutSec: number;
  /**
   * 素材が置き場所より短いとき繰り返すか。**未指定＝true（従来の BGM の挙動）**。
   * タイムライン形式の読み上げは false を渡す（繰り返すと言葉が二重に鳴る・#631）。
   */
  loopSource?: boolean;
  /** 素材のどこから使うか（秒）。未指定＝頭から（場面形式は指定しない）。 */
  sourceStartSec?: number;
  /** 再生速度（>0・未指定＝等速）。ピッチは維持する。 */
  speed?: number;
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
  /** 全体の音量を整えるときの目安の大きさ（LUFS・#259）。未指定＝整えない（従来どおり＝出力不変）。 */
  normalizeLufs?: number,
): Promise<ExportReport> {
  return invoke<ExportReport>('export_video', {
    scenes,
    fileName,
    bgmRuns: bgmRuns && bgmRuns.length > 0 ? bgmRuns : null,
    projectId: projectId ?? null,
    outputPath: outputPath ?? null,
    normalizeLufs: normalizeLufs ?? null,
  });
}

/** 書き出しの進捗イベント（#376）を購読する。Rust の export_video が段階（映像/結合/BGM）ごとに emit する。
 *  戻り値は購読解除関数。Tauri 非検出時は no-op を返す（ブラウザ開発/テストで安全）。 */
export async function listenExportProgress(cb: (e: ExportProgressEvent) => void): Promise<() => void> {
  if (!canExport()) return () => {};
  try {
    return await listen<ExportProgressEvent>('export_progress', (ev) => cb(ev.payload));
  } catch {
    return () => {};
  }
}

/** 書き出し開始を宣言する（#380）。準備（クリップ抽出）と本体を同一のキャンセルスコープに入れ、前回の中止要求を持ち越さない。
 *  busy 表示（中止ボタン）が出る前に呼ぶこと。失敗は握りつぶす（Tauri 非検出時は何もしない）。 */
export async function beginExport(): Promise<void> {
  if (!canExport()) return;
  try {
    await invoke('begin_export');
  } catch {
    /* 初期化の失敗は無視（実害時は run_export 側の判定で保守的に停止する） */
  }
}

/** 実行中の書き出しを中止する（走行中の ffmpeg を終了・#380）。副作用のみ（表示は呼び出し側が「中止」を把握）。
 *  失敗しても中止操作は続行できるよう握りつぶす（Tauri 非検出時は何もしない）。 */
export async function cancelExport(): Promise<void> {
  if (!canExport()) return;
  try {
    await invoke('cancel_export');
  } catch {
    /* 中止コマンド自体の失敗は無視（次段の中止判定・kill 済み分で実質停止する） */
  }
}

/**
 * アニメ場面のフレームを1枚ステージングへ書き出す（巨大な base64 を1回の IPC に載せると JSON.stringify が
 * 文字列上限を超えて失敗するため、フレームは逐次に小さく保存し export_video には framesDir だけ渡す）。
 * dirName は場面ごとの相対名（英数字と _・例 `scene_frames_2`）。Tauri 専用＝canExport() で判定してから呼ぶ。
 */
export async function stageExportFrame(dirName: string, frameIndex: number, dataBase64: string): Promise<void> {
  await invoke('stage_export_frame', { dirName, frameIndex, dataBase64 });
  await accountStagedFrame(dataBase64);
}

/**
 * 空きが足りなくなったので止めた（#1211）。⚠️ **文はそのまま利用者に出す**（§2-5 を通した文）。
 */
export class ExportDiskShortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportDiskShortError';
  }
}

/** いま見張っている書き出し（`null`＝見張っていない）。 */
let diskWatch: {
  /** 焼く総コマ数（`null`＝先に分からない＝**底で止めるだけ**）。 */
  totalFrames: number | null;
  /** 出来上がりの見込み（バイト・分からなければ 0）。 */
  outBytesGuess: number;
  outPath: string | null;
  bakedFrames: number;
  bakedBytes: number;
} | null = null;

/**
 * 空きの見張りを始める（#1211）。**書き出しを始める直前に呼ぶ**。
 *
 * ⚠️ **`totalFrames` を渡せるなら渡す**＝渡すと「このままでは足りない」を**数十コマで**判じられる。
 * 渡せないときは `null`＝**底（`DISK_FLOOR_BYTES`）を割ったら止める**だけになる
 *（使い切って後片づけもできなくなるのを防ぐ、最後の砦）。
 */
export function beginExportDiskWatch(opts: {
  totalFrames: number | null;
  outBytesGuess?: number;
  outPath?: string | null;
}): void {
  diskWatch = {
    totalFrames: opts.totalFrames,
    outBytesGuess: opts.outBytesGuess ?? 0,
    outPath: opts.outPath ?? null,
    bakedFrames: 0,
    bakedBytes: 0,
  };
}

/** 見張りを終える（⚠️ **どの出口でも呼ぶ**＝残すと次の書き出しが前回の数を引き継ぐ）。 */
export function endExportDiskWatch(): void {
  diskWatch = null;
}

/** 書き出しが使う2か所の空き（#1211）。 */
export async function exportFreeSpace(outPath: string | null): Promise<{
  stageFreeBytes: number;
  outFreeBytes: number | null;
  sameDrive: boolean;
}> {
  return invoke('export_free_space', { outPath });
}

/** data URL / 生 base64 のどちらでも、**中身のバイト数**を見積もる。 */
function base64Bytes(dataBase64: string): number {
  const comma = dataBase64.indexOf(',');
  const body = comma >= 0 ? dataBase64.slice(comma + 1) : dataBase64;
  const pad = body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((body.length * 3) / 4) - pad);
}

/**
 * 焼いた1枚を数え、区切りの回に空きを見る。**足りなければ投げる**（#1211）。
 *
 * ⚠️ **投げて止める**＝止めないと、**12分以上待たされてから容量が尽き、数十GBが残る**
 *（#1205 の調査で実際に踏んだ形）。
 * ⚠️ **空きを調べられなかったら止めない**＝調べられないこと自体を理由に**書き出しを断らない**
 *（Windows 以外・権限など。断ると「直しようのない断り」になる＝§2-5）。
 */
async function accountStagedFrame(dataBase64: string): Promise<void> {
  const w = diskWatch;
  if (!w) return;
  w.bakedFrames += 1;
  w.bakedBytes += base64Bytes(dataBase64);
  if (!shouldCheckDisk(w.bakedFrames)) return;
  let free: { stageFreeBytes: number; outFreeBytes: number | null; sameDrive: boolean };
  try {
    free = await exportFreeSpace(w.outPath);
  } catch {
    return;
  }
  if (w.totalFrames != null && canEstimateDisk(w.bakedFrames)) {
    const short = diskShortfall({
      needStageBytes: remainingBakeBytes({
        bakedFrames: w.bakedFrames,
        bakedBytes: w.bakedBytes,
        totalFrames: w.totalFrames,
      }),
      needOutBytes: w.outBytesGuess,
      stageFreeBytes: free.stageFreeBytes,
      outFreeBytes: free.outFreeBytes,
      sameDrive: free.sameDrive,
    });
    if (diskIsShort(short)) throw new ExportDiskShortError(diskShortMessage(short));
    return;
  }
  // 見積もれないときは**底で止める**だけ。
  const floor = diskFloorShortfall(free.stageFreeBytes);
  if (diskIsShort(floor)) throw new ExportDiskShortError(diskFloorMessage(free.stageFreeBytes));
}

/** フレームのステージングを空にする（書き出しの前後で呼ぶ）。非存在は成功扱い（Rust 側）。 */
export async function clearExportFramesStage(): Promise<void> {
  await invoke('clear_export_frames_stage');
}

/**
 * 動画スロット本体アニメ（#442）：クリップの区間 [clipStartSec, +durSec] を出力fpsでフレーム抽出しステージング、書き出せた枚数を返す。
 * 出力 f＝clip-time clipStartSec+(f/fps)*speed（動画がアニメ区間から動きながら再生される素材）。Tauri 専用＝canExport() で判定してから呼ぶ。
 */
export async function stageClipFrames(
  projectId: string,
  clipRelPath: string,
  clipStartSec: number,
  durSec: number,
  speed: number,
  fps: number,
  width: number,
  dirName: string,
): Promise<number> {
  return invoke<number>('stage_clip_frames', {
    projectId,
    clipRelPath,
    clipStartSec,
    durSec,
    speed,
    fps,
    width,
    dirName,
  });
}

/** ステージ済みフレーム（stageClipFrames が書き出したクリップフレーム）を data URL で読む（#442）。Tauri 専用。 */
export async function readExportFrame(dirName: string, frameIndex: number): Promise<string> {
  return invoke<string>('read_export_frame', { dirName, frameIndex });
}

/** 書き出し前に H.264 エンコード能力を検知する（#120）。Tauri 専用＝呼ぶ前に canExport() で判定すること。 */
export async function detectH264Capability(): Promise<ExportCapability> {
  const r = await invoke<{ capability: ExportCapability }>('detect_h264_capability');
  return r.capability;
}
