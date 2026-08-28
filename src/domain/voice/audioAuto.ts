// 音の自動処理（ADR-0032 追補4・#257 ダッキング／#259 ノーマライズ）。純粋関数（§7 テスト対象）。
//
// ⚠️ **設定はプロジェクト単位**（`videoSettings.audioAuto`）＝`Scene` には足さない。
// ADR-0032 の凍結3（`Scene` への新フィールド）に触れないための置き場所であり、
// **場面ごとのダッキング設定は作らない**（追補4）。`videoSettings` は
// `timeline-project.schema.json` が `$ref` で共有しているので、**両形式に同じ設定が効く**。
//
// ⚠️ **「書き出し時の処理」として両形式に効かせる**＝どちらの形式でも、
// 「声が鳴っている区間だけ BGM を下げる」「全体の音量を整える」は同じ意味になる（ADR-0026②）。
import { VOLUME_MAX, VOLUME_MIN } from '../constants';
import type { VolumePoint } from '../timeline/types';

/** 音の自動処理の設定（`videoSettings.audioAuto`・すべて任意＝未指定は既定）。 */
export interface AudioAutoSettings {
  /** 声が鳴っている区間だけ BGM を下げる（#257）。 */
  duckBgm?: boolean;
  /** 下げ幅（0〜1・1＝聞こえなくなる）。 */
  duckDepth?: number;
  /** 下がりきるまでの秒。 */
  duckAttackSec?: number;
  /** 戻りきるまでの秒。 */
  duckReleaseSec?: number;
  /** 全体の音量を整える（#259）。 */
  normalize?: boolean;
  /** 整えたあとの目安の大きさ（LUFS・負の値）。 */
  targetLufs?: number;
}

/** 解決済みの設定（null=継承を潰した形）。 */
export interface ResolvedAudioAuto {
  duckBgm: boolean;
  duckDepth: number;
  duckAttackSec: number;
  duckReleaseSec: number;
  normalize: boolean;
  targetLufs: number;
}

/**
 * 既定（未指定のときの値）。
 *
 * ⚠️ **既定は「両方する」**（#257/#259 とも「既定でも自然」が受け入れ条件）。ただし
 * **既に作った動画の音が変わる**ので、**読み込んだ古い動画では両方 `false` に倒す**
 *（読込時に `OLD_PROJECT_AUDIO_AUTO` を書き込む＝`persistence.ts` の 1.25→1.26）＝
 * 黙って別の音の動画を出さない（§2-5）。
 */
export const AUDIO_AUTO_DEFAULT: ResolvedAudioAuto = {
  duckBgm: true,
  // 下げ幅 0.6＝BGM が 40% の大きさになる。消さずに「後ろで鳴っている」ところまで。
  duckDepth: 0.6,
  duckAttackSec: 0.25,
  duckReleaseSec: 0.6,
  normalize: true,
  // −16 LUFS＝配信（YouTube 等）でよく使われる目安。上げすぎて歪ませない。
  targetLufs: -16,
};

/**
 * **前の版で作った動画**に書き込む値（読込時＝`persistence.ts` の 1.25→1.26）。
 * ⚠️ **既に作った動画の音を変えない**＝開いて書き出し直しただけで別物にならないように、
 * 明示的に「しない」を書く（未指定のままだと既定＝「する」に化ける）。
 */
export const OLD_PROJECT_AUDIO_AUTO: AudioAutoSettings = { duckBgm: false, normalize: false };

/** 下げ幅の範囲（0＝下げない〜1＝聞こえなくなる）。 */
export const DUCK_DEPTH_MIN = 0;
export const DUCK_DEPTH_MAX = 1;
/** 下がる/戻るまでの秒の範囲。 */
export const DUCK_TIME_MIN = 0;
export const DUCK_TIME_MAX = 3;
/** 目安の大きさ（LUFS）の範囲。 */
export const TARGET_LUFS_MIN = -30;
export const TARGET_LUFS_MAX = -8;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** 設定を解く（未指定＝既定・範囲外は収める）。 */
export function resolveAudioAuto(s: AudioAutoSettings | undefined): ResolvedAudioAuto {
  return {
    duckBgm: s?.duckBgm ?? AUDIO_AUTO_DEFAULT.duckBgm,
    duckDepth: clamp(s?.duckDepth ?? AUDIO_AUTO_DEFAULT.duckDepth, DUCK_DEPTH_MIN, DUCK_DEPTH_MAX),
    duckAttackSec: clamp(s?.duckAttackSec ?? AUDIO_AUTO_DEFAULT.duckAttackSec, DUCK_TIME_MIN, DUCK_TIME_MAX),
    duckReleaseSec: clamp(s?.duckReleaseSec ?? AUDIO_AUTO_DEFAULT.duckReleaseSec, DUCK_TIME_MIN, DUCK_TIME_MAX),
    normalize: s?.normalize ?? AUDIO_AUTO_DEFAULT.normalize,
    targetLufs: clamp(s?.targetLufs ?? AUDIO_AUTO_DEFAULT.targetLufs, TARGET_LUFS_MIN, TARGET_LUFS_MAX),
  };
}

/** 声が鳴っている区間（グローバル秒・半開 `[startSec, endSec)`）。 */
export interface SpeechSpan {
  startSec: number;
  endSec: number;
}

/**
 * 近い区間をひとまとめにする。
 *
 * ⚠️ **戻りきる前に次が始まるなら、間で上げない**＝掛け合いの行間（0.1 秒など）で BGM が
 * ひょこひょこ上下すると耳障りで、**下げっぱなしの方が自然**（これが本来の挙動）。
 * ついでに**点の数も減る**＝音量の式には上限があるため（`VOLUME_POINTS_MAX`）効いてくる。
 */
export function mergeSpeechSpans(spans: readonly SpeechSpan[], gapSec: number): SpeechSpan[] {
  const sorted = [...spans]
    .filter((s) => s.endSec > s.startSec)
    .sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
  const out: SpeechSpan[] = [];
  for (const s of sorted) {
    const prev = out[out.length - 1];
    if (prev && s.startSec - prev.endSec <= gapSec) {
      prev.endSec = Math.max(prev.endSec, s.endSec);
      continue;
    }
    out.push({ ...s });
  }
  return out;
}

/**
 * ダッキングの倍率の点列（**この音の先頭からの秒**・値は `1-depth`〜`1`）。
 *
 * 1区間につき最大4点（下がり始め・下がりきり・戻り始め・戻りきり）。区間の外は 1（そのまま）。
 * ⚠️ **点の刻みは「置いた音の中の時間」**＝FFmpeg の `volume` 式の `t` と同じ物差し
 *（`asetpts` で 0 起点に戻したあとの時刻）。再生側の `volumeAt(points, 局所秒)` とも同じ。
 */
export function duckingFactorPoints(
  speech: readonly SpeechSpan[],
  clip: { startSec: number; endSec: number },
  s: ResolvedAudioAuto,
): VolumePoint[] {
  if (!s.duckBgm || s.duckDepth <= 0) return [];
  const len = clip.endSec - clip.startSec;
  if (len <= 0) return [];
  const low = 1 - s.duckDepth;
  // 戻りきる前に次が始まる区間はまとめる（上下に揺れない・点も減る）。
  const spans = mergeSpeechSpans(speech, s.duckAttackSec + s.duckReleaseSec);
  const pts: VolumePoint[] = [];
  const push = (timeSec: number, volume: number): void => {
    const t = clamp(timeSec, 0, len);
    const prev = pts[pts.length - 1];
    // 同じ時刻に2点置かない（入力順に依存させない）。あとから来た値を採る＝端で下がりきる。
    if (prev && Math.abs(prev.timeSec - t) < 1e-6) prev.volume = volume;
    else pts.push({ timeSec: t, volume });
  };
  for (const sp of spans) {
    // グローバル秒 → この音の中の秒。
    const from = sp.startSec - clip.startSec;
    const to = sp.endSec - clip.startSec;
    if (to <= 0 || from >= len) continue; // この音に掛からない区間
    push(from - s.duckAttackSec, 1);
    push(from, low);
    push(to, low);
    push(to + s.duckReleaseSec, 1);
  }
  if (pts.length === 0) return [];
  // 端を伸ばす（式は端の値で外挿するので、先頭が下がった値だと最初から下がってしまう）。
  if (pts[0].timeSec > 0 && pts[0].volume !== 1) pts.unshift({ timeSec: 0, volume: 1 });
  return pts;
}

/**
 * 元の音量（一定値または点列）にダッキングの倍率を掛けて、**絶対値の点列**にする。
 *
 * ⚠️ **両方の折れ点を残す**＝どちらかの点だけで刻むと、もう一方の折れが丸まる。
 * 折れ点で正確に一致し、間は直線で結ぶ（積は本来2次だが、折れ点を全部持つので聞き分けられない差）。
 */
export function applyDucking(
  base: readonly VolumePoint[] | undefined,
  baseVolume: number,
  factor: readonly VolumePoint[],
): VolumePoint[] {
  if (factor.length === 0) return base ? [...base] : [];
  const times = new Set<number>();
  for (const p of factor) times.add(p.timeSec);
  for (const p of base ?? []) times.add(p.timeSec);
  return [...times]
    .sort((a, b) => a - b)
    .map((timeSec) => ({
      timeSec,
      volume: clamp(valueAt(base, baseVolume, timeSec) * valueAt(factor, 1, timeSec), VOLUME_MIN, VOLUME_MAX),
    }));
}

/** 点列の時刻 t の値（端は伸ばす＝`volumeAt`／`volumeExpr` と同じ規則）。点が無ければ既定値。 */
function valueAt(points: readonly VolumePoint[] | undefined, fallback: number, t: number): number {
  const pts = points ?? [];
  if (pts.length === 0) return fallback;
  if (t <= pts[0].timeSec) return pts[0].volume;
  const last = pts[pts.length - 1];
  if (t >= last.timeSec) return last.volume;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1];
    const b = pts[i];
    if (t < b.timeSec) {
      const span = b.timeSec - a.timeSec;
      return span <= 0 ? b.volume : a.volume + ((b.volume - a.volume) * (t - a.timeSec)) / span;
    }
  }
  return last.volume;
}

/**
 * 点が多すぎるとき、**間の狭いところからまとめて**収める（#512 の上限＝`VOLUME_POINTS_MAX`）。
 *
 * ⚠️ **黙って点を捨てない**＝捨てるとその区間だけ下がらなくなる（下げ忘れ）。
 * まとめるのは「間で上げない」＝**下げっぱなしにする**方向なので、下げ忘れは起きない。
 * まとめたかどうかを返す＝呼ぶ側が知らせられる（§2-5）。
 */
export function fitSpeechSpans(
  spans: readonly SpeechSpan[],
  s: ResolvedAudioAuto,
  maxPoints: number,
): { spans: SpeechSpan[]; merged: boolean } {
  let gap = s.duckAttackSec + s.duckReleaseSec;
  let out = mergeSpeechSpans(spans, gap);
  let merged = false;
  // 1区間＝最大4点。端の1点ぶんを見て、上限に収まるまで「まとめる間隔」を広げる。
  // ⚠️ **回数の上限を持つ**＝止まる保証を `mergeSpeechSpans` が必ず減らすことに預けない。
  // 1回ごとに最低1つ減る前提なので区間数ぶん回れば必ず1つになるが、そこが崩れても回り続けない。
  for (let guard = spans.length; out.length * 4 + 1 > maxPoints && out.length > 1 && guard > 0; guard -= 1) {
    gap = nextGap(out, gap);
    out = mergeSpeechSpans(out, gap);
    merged = true;
  }
  return { spans: out, merged };
}

/** 次にまとめる間隔＝いまある区間の隙間のうち、いまの間隔より広い最小のもの。 */
function nextGap(spans: readonly SpeechSpan[], gap: number): number {
  let next = Infinity;
  for (let i = 1; i < spans.length; i += 1) {
    const g = spans[i].startSec - spans[i - 1].endSec;
    if (g > gap && g < next) next = g;
  }
  return Number.isFinite(next) ? next : gap * 2 + 1;
}
