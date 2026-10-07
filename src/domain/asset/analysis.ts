// 素材の解析（波形・コマ列）の**決め方だけ**（#332）。純粋な部分（§7 テスト対象）。
//
// ⚠️ **実際に測るのは Rust**（`audio_peaks` / `video_filmstrip`）＝素材のバイトを JS に載せない
//（ADR-0004・§2-1）。ここが持つのは「いくつ要るか」「どう描くか」の規則だけ。
import { ASSET_TYPE, type AssetType } from '../enums';

/** 波形の山を何本取るか・コマを何枚取るかの上限（画面の都合＝細かすぎても見えない）。 */
export const MAX_WAVEFORM_BUCKETS = 200;
export const MAX_FILMSTRIP_FRAMES = 24;

/** 帯1本ぶんの幅（px）あたり、山を1本／コマを1枚。これより細かくしても見えない。 */
const PX_PER_BUCKET = 4;
const PX_PER_FRAME = 40;

/**
 * 帯の幅から、取る山の本数を決める（#332）。
 *
 * ⚠️ **幅で決める**＝尺で決めると、長い曲を縮めて置いたときに**見えない細かさ**まで測る
 *（測る時間だけ延びて絵は変わらない）。⚠️ **1本以上**（0 だと何も描けない）。
 */
export function waveformBuckets(barWidthPx: number): number {
  if (!Number.isFinite(barWidthPx) || barWidthPx <= 0) return 1;
  return Math.min(MAX_WAVEFORM_BUCKETS, Math.max(1, Math.round(barWidthPx / PX_PER_BUCKET)));
}

/** 帯の幅から、取るコマの枚数を決める（同上）。 */
export function filmstripFrames(barWidthPx: number): number {
  if (!Number.isFinite(barWidthPx) || barWidthPx <= 0) return 1;
  return Math.min(MAX_FILMSTRIP_FRAMES, Math.max(1, Math.round(barWidthPx / PX_PER_FRAME)));
}

/**
 * 帯に敷く絵の種類（#332）。
 *
 * ⚠️ **値は1か所**（§2-7）＝`ASSET_USE_KIND` と同じ流儀。**比較側だけ定数にして作る側が
 * 直書きのままでは、綴りが別々に生きる状態が消えない**（PR #827 レビュー 🟡 の再発を避ける）。
 * 永続しない内部の種別なので schema には出ない。
 */
export const ANALYSIS_KIND = { waveform: 'waveform', filmstrip: 'filmstrip' } as const;
export type AnalysisKind = (typeof ANALYSIS_KIND)[keyof typeof ANALYSIS_KIND];

/** 帯に敷く絵の中身（#332）。**文書に持たない**（作り直せる）。 */
export type AssetAnalysis = { peaks?: number[]; stripUrl?: string };

/**
 * その素材に**どちらの絵が要るか**（#332）。
 *
 * ⚠️ **動画は両方ではなくコマ列だけ**＝動画の帯に波形を敷くと、コマ列と重なって**どちらも読めない**。
 * 音の大小は選んだときの欄（音量）で見る。
 */
export function analysisKindFor(assetType: AssetType): AnalysisKind | null {
  if (assetType === ASSET_TYPE.video) return ANALYSIS_KIND.filmstrip;
  if (assetType === ASSET_TYPE.bgm || assetType === ASSET_TYPE.voice) return ANALYSIS_KIND.waveform;
  return null;
}

/**
 * その部品の帯に敷く絵の**出どころ**（#332）。`null`＝敷くものが無い。
 *
 * ⚠️ **音の部品は `kind:'slot'` ではない**（レビュー 🔴）＝素材の差し込み（`slot`）だけを見ていると、
 * **波形が一度も描かれない**（音は `kind:'audio'` が `assetId` で持つ・`11 §7.6`）。
 * 読み上げ（`kind:'voice'`）は素材ではなく**作成済みの音声**（`voice.voicePath`）を指す。
 * ⚠️ **同梱BGM（`bundledBgmId`）は対象外**＝`public/bgm/` にあり、プロジェクト相対では測れない。
 * ⚠️ **鍵はファイルの場所**＝素材の番号ではなく実体で覚える（読み上げは素材を持たない）。
 */
export type AnalysisSource = {
  /** 覚えるときの鍵。**場所と範囲**で作る（同じ素材を別の範囲で置いた2本は別の絵）。 */
  key: string;
  relPath: string;
  kind: AnalysisKind;
  /** 素材のどこから測るか（秒）。 */
  fromSec: number;
  /** 何秒ぶん測るか（`0`＝最後まで）。 */
  lengthSec: number;
};

export function clipAnalysisSource(
  clip: {
    assetId?: string | null;
    voice?: { voicePath?: string | null };
    durationSec?: number;
    sourceStartSec?: number;
    speed?: number;
  },
  /** 素材の実体を引く（見つからなければ `undefined`）。 */
  assetOf: (assetId: string) => { assetType: AssetType; filePath: string } | undefined,
): AnalysisSource | null {
  // ⚠️ **置いた範囲だけを測る**（レビュー 🟡・`11 §7.6.5` の「トリムと速度も渡す」と同じ筋）＝
  // 素材まるごとを測って帯いっぱいに伸ばすと、**60秒の曲の末尾5秒だけを置いた帯に、曲の頭からの
  // 波形**が出る。「どこで何が鳴っているか」を読むための絵が**別の時刻**を指してしまう。
  // 素材の時間で見るので、置いた長さは速さで変わる（`durationSec × speed`）。
  const fromSec = Math.max(0, clip.sourceStartSec ?? 0);
  const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
  const lengthSec = clip.durationSec && clip.durationSec > 0 ? clip.durationSec * speed : 0;
  const range = `${fromSec.toFixed(3)}-${lengthSec.toFixed(3)}`;

  // 読み上げは素材を持たない＝作成済みの音声を直に指す。
  const voicePath = clip.voice?.voicePath;
  if (voicePath) {
    return { key: `${voicePath}#${range}`, relPath: voicePath, kind: ANALYSIS_KIND.waveform, fromSec, lengthSec };
  }
  if (!clip.assetId) return null;
  const asset = assetOf(clip.assetId);
  if (!asset) return null;
  const kind = analysisKindFor(asset.assetType);
  if (!kind) return null;
  return { key: `${asset.filePath}#${range}`, relPath: asset.filePath, kind, fromSec, lengthSec };
}

/**
 * 山の配列を、帯に敷く SVG の `points`（`polyline` 用）にする。
 *
 * ⚠️ **上下対称に描く**＝音の波形は 0 を中心に振れるものとして見慣れているので、
 * 片側だけだと「棒グラフ」に見えて音だと分からない。
 * ⚠️ **座標系は 0..1**（`viewBox="0 0 1 1"` ＋ `preserveAspectRatio="none"`）＝帯の幅が変わっても
 * 描き直さずに伸びる（幅が変わるたびに測り直さない）。
 */
export function waveformPoints(peaks: readonly number[]): string {
  if (peaks.length === 0) return '';
  const x = (i: number): number => (peaks.length === 1 ? 0.5 : i / (peaks.length - 1));
  const clamp = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
  const top = peaks.map((v, i) => `${x(i).toFixed(4)},${(0.5 - clamp(v) / 2).toFixed(4)}`);
  // 折り返して下側を描く（同じ山を上下に）。
  const bottom = [...peaks].reverse().map((v, i) => `${x(peaks.length - 1 - i).toFixed(4)},${(0.5 + clamp(v) / 2).toFixed(4)}`);
  return [...top, ...bottom].join(' ');
}
