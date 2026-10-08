// 無音・長い間を見つけて、まとめて詰める（#1385・#1379 候補B）。**純粋関数**。
//
// ⚠️ **選んだ部品（録画・録音）の中だけを探す**（業界の型＝CapCut の「無音を除去」・Premiere の「無音部分を削除」は
//   選んだクリップに対して働く）＝タイムライン全体の音で決めると、BGM を流しっぱなしの動画では**どこも無音にならない**し、
//   逆に「BGM だけの区間」を音として数えない設計も要らなくなる（利用者が録った音だけを見る）。
// ⚠️ **勝手に消さない**＝ここは候補を出すだけ。当てるのは既存の「範囲を消して詰める」（`deleteRange`・#1193）と同じ道で、
//   **まとめて当てても取り消し1回**（`applySilenceCuts`）。
// ⚠️ **読み上げが鳴っている所は候補にしない**＝録音が無音でも、上に重ねた声を消すことになる。
import { firstFrameAtOrAfter, frameTimeAt } from './export';
import { deleteRange } from './deleteRange';
import type { EditBlockedReason } from './edit';
import type { Template } from '../template/types';
import type { TimelineClip, TimelineProject } from './types';
import { ASSET_TYPE, TIMELINE_CLIP_KIND } from '../enums';

/** 無音とみなす大きさ（最大振幅・-34dB 相当）。これ未満は、どんな録音でも無音。 */
export const SILENCE_ABS_PEAK = 0.02;
/**
 * その部品で**いちばん大きい音**に対する割合（-20dB 相当）。これ未満も無音＝大きく録った音に部屋の雑音が乗っていても、
 * 話していない所を拾う。⚠️ **2つの基準の大きい方**を使う（小さい方にすると、雑音まで「音」に数えて無音が見つからない）。
 */
export const SILENCE_REL_PEAK = 0.1;
/** 候補にする無音の長さの下限（秒）。短い息継ぎは詰めない。 */
export const SILENCE_MIN_SEC = 1.0;
/** 詰めるときに両端へ残す長さ（秒）。詰めた所で言葉の頭・尻が切れないように。 */
export const SILENCE_KEEP_SEC = 0.25;
/** 調べる細かさ（素材の秒）。 */
export const SILENCE_BUCKET_SEC = 0.05;

/** 詰める候補1つ（タイムラインの秒・半開区間）。 */
export interface SilenceCandidate {
  startSec: number;
  endSec: number;
}

/** 1回に測る長さ（素材の秒）＝山の数の上限（Rust の `audio_peaks` は 2000 個まで）÷ 細かさ。 */
export const SILENCE_WINDOW_SEC = 2000 * SILENCE_BUCKET_SEC;

/**
 * 無音を探せる部品か（探す素材の場所と、置いた範囲＝素材の秒）。探せなければ `null`。
 * - 動画は**音が入っている**と分かっているものだけ（`metadata.hasAudio`＝#1380 で開くときに補う）
 * - 音の素材（BGM・声の録音）はそのまま。読み上げ・同梱 BGM・写真・文字は対象外（素材を持たない／録った音ではない）
 */
export function silenceSourceOf(
  doc: TimelineProject,
  clip: TimelineClip,
): { relPath: string; fromSec: number; lengthSec: number } | null {
  if (!clip.assetId) return null;
  const asset = doc.assets.find((a) => a.assetId === clip.assetId);
  if (!asset?.filePath) return null;
  const sounding = asset.assetType === ASSET_TYPE.video
    ? asset.metadata?.hasAudio === true
    : asset.assetType === ASSET_TYPE.bgm || asset.assetType === ASSET_TYPE.voice;
  if (!sounding) return null;
  const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
  const fromSec = Math.max(0, clip.sourceStartSec ?? 0);
  // ⚠️ **素材の長さを越えて測らない**（PR #1389 レビュー 🟡）＝越えた所は音が無く、Rust は読めた分を山の数で割るので
  //   山1つが短くなり、候補の時刻が前へ縮む（話している所を切る）。長さが分かるときだけ抑える。
  const sourceLeft = asset.metadata?.durationSec != null ? Math.max(0, asset.metadata.durationSec - fromSec) : Infinity;
  const lengthSec = Math.min(clip.durationSec * speed, sourceLeft);
  if (!(lengthSec > 0)) return null;
  return { relPath: asset.filePath, fromSec, lengthSec };
}

/** 山の並び（素材の秒で `bucketSec` ごと）から、無音の区間（素材の頭からの秒）を出す。 */
export function silentRunsFromPeaks(peaks: readonly number[], bucketSec: number): { fromSec: number; toSec: number }[] {
  const loudest = peaks.reduce((m, v) => Math.max(m, Number.isFinite(v) ? v : 0), 0);
  const threshold = Math.max(SILENCE_ABS_PEAK, loudest * SILENCE_REL_PEAK);
  const out: { fromSec: number; toSec: number }[] = [];
  let start = -1;
  peaks.forEach((v, i) => {
    const quiet = !(v >= threshold);
    if (quiet && start < 0) start = i;
    if (!quiet && start >= 0) {
      out.push({ fromSec: start * bucketSec, toSec: i * bucketSec });
      start = -1;
    }
  });
  if (start >= 0) out.push({ fromSec: start * bucketSec, toSec: peaks.length * bucketSec });
  return out;
}

/**
 * 候補をコマに乗せる（書き出しの区間の割り目と同じ数え方＝`firstFrameAtOrAfter`）。
 * ⚠️ **内側へ丸める**＝頭は「その秒から映る最初のコマ」、終わりは「その秒から映る最初のコマ」まで（そのコマは残る）。
 *   終わりを外側へ丸めると、コマの途中から始まる読み上げ（例 4.01 秒）の頭まで消す範囲に入り、
 *   **読み上げと字幕が丸ごと消える**（読み上げは切れない部品＝`deleteRange` が丸ごと外す・PR #1389 レビュー 🔴）。
 */
function snapInside(r: SilenceCandidate, fps: number): SilenceCandidate {
  const start = frameTimeAt(firstFrameAtOrAfter(r.startSec, fps), fps);
  // 終わり：`frameTimeAt(f) <= endSec` を満たす最大の f＝そのコマの時刻はまだ無音の中。
  let f = firstFrameAtOrAfter(r.endSec, fps);
  if (frameTimeAt(f, fps) > r.endSec) f -= 1;
  return { startSec: start, endSec: frameTimeAt(Math.max(0, f), fps) };
}

/** 区間の並びから、別の区間の並びを引く（どちらも半開）。 */
function subtract(a: SilenceCandidate[], b: readonly SilenceCandidate[]): SilenceCandidate[] {
  let rest = a;
  for (const cut of b) {
    rest = rest.flatMap((r) => {
      if (cut.endSec <= r.startSec || cut.startSec >= r.endSec) return [r];
      const parts: SilenceCandidate[] = [];
      if (cut.startSec > r.startSec) parts.push({ startSec: r.startSec, endSec: cut.startSec });
      if (cut.endSec < r.endSec) parts.push({ startSec: cut.endSec, endSec: r.endSec });
      return parts;
    });
  }
  return rest;
}

/**
 * 選んだ部品の山（置いた範囲を素材の秒で `bucketSec` ごとに測ったもの）から、タイムライン上の詰める候補を出す。
 * - 素材の秒 → タイムラインの秒は **速さで割る**（`clip.startSec + 素材の秒 / speed`）
 * - 両端に `SILENCE_KEEP_SEC` 残し、残りが `SILENCE_MIN_SEC` 未満なら候補にしない
 * - 読み上げ（隠していないもの）が鳴っている所は外す
 * - 割り目はコマに乗せる（頭も終わりも「その時刻から映る最初のコマ」）
 */
export function silenceCandidates(
  doc: TimelineProject,
  clip: TimelineClip,
  peaks: readonly number[],
  bucketSec: number,
): SilenceCandidate[] {
  const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
  const fps = doc.videoSettings.fps;
  const clipEnd = clip.startSec + clip.durationSec;
  const raw = silentRunsFromPeaks(peaks, bucketSec)
    .map((r) => ({ startSec: clip.startSec + r.fromSec / speed, endSec: Math.min(clipEnd, clip.startSec + r.toSec / speed) }))
    .map((r) => ({
      // 部品の頭・尻に接する無音は、そこから先（後ろ）に言葉が無いので残さなくてよい側がある。
      // ⚠️ それでも両端とも残す＝前後の部品とのつなぎ目で、別の音の頭が切れないように（狭く始める）。
      startSec: r.startSec + SILENCE_KEEP_SEC,
      endSec: r.endSec - SILENCE_KEEP_SEC,
    }));
  const voices: SilenceCandidate[] = doc.clips
    .filter((c) => c.kind === TIMELINE_CLIP_KIND.voice && !c.hidden && c.id !== clip.id)
    .map((c) => ({ startSec: c.startSec, endSec: c.startSec + c.durationSec }));
  return subtract(raw.filter((r) => r.endSec > r.startSec), voices)
    .map((r) => snapInside(r, fps))
    .filter((r) => r.endSec - r.startSec >= SILENCE_MIN_SEC - 1e-9);
}

/**
 * 選んだ候補を**まとめて**詰める（取り消し1回で戻る＝返すのは文書1つ）。
 * ⚠️ **後ろから当てる**＝前から詰めると、後ろの候補の時刻がずれる。
 * ⚠️ 1つでも当てられなければ**何も変えない**（途中まで詰めた文書を返さない）。
 */
export function applySilenceCuts(
  doc: TimelineProject,
  candidates: readonly SilenceCandidate[],
  volumeAt: Parameters<typeof deleteRange>[2],
  opts: { templateOf?: (templateId: string) => Template | undefined } = {},
): { ok: true; doc: TimelineProject; applied: number; clampedMarkerCount: number } | { ok: false; reason: EditBlockedReason } {
  const sorted = [...candidates].sort((a, b) => b.startSec - a.startSec);
  let next = doc;
  let clampedMarkerCount = 0;
  for (const c of sorted) {
    const r = deleteRange(next, { startSec: c.startSec, endSec: c.endSec, closeGap: true }, volumeAt, opts);
    if (!r.ok) return { ok: false, reason: r.reason };
    next = r.doc;
    // ⚠️ **寄せた目印の数も持ち帰る**（「範囲を消して詰める」と同じく知らせる＝黙って変えない・PR #1389 レビュー 🟡）。
    clampedMarkerCount += r.clampedMarkerCount;
  }
  return { ok: true, doc: next, applied: sorted.length, clampedMarkerCount };
}
