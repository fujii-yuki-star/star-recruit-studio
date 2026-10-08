// 声を文字にした結果をタイムラインの言葉にする（ADR-0058 決定4・#1387）。純粋関数。
//
// ⚠️ **区切りの時刻は「切り出した範囲の頭から」の秒**（Rust の `transcribe_audio` は、部品が使っている素材の範囲
//   〔`silenceSourceOf`〕だけを渡されている）＝タイムラインの秒へは、置いた位置と速さで写す（無音を詰めると同じ写し方）。
// ⚠️ **結果は正解扱いしない**（判断軸3）＝ここは時刻を写すだけ。文を直すのは利用者（画面の欄）。
import type { SubtitleCue } from '../subtitle/subtitleFile';
import { snapInside, subtract, type SilenceCandidate } from './silence';
import type { TimelineClip } from './types';

/** 文1行（タイムラインの秒）。 */
export interface TranscriptLine {
  startSec: number;
  endSec: number;
  text: string;
}

/**
 * 区切り（切り出した範囲の頭からの秒）→ 文の行（タイムラインの秒）。
 * 部品の外へ出た所は切り詰め、外に出きった区切り・空の文は落とす。
 */
export function transcriptLinesOf(
  clip: Pick<TimelineClip, 'startSec' | 'durationSec' | 'speed'>,
  segments: readonly { startSec: number; endSec: number; text: string }[],
): TranscriptLine[] {
  const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
  const clipEnd = clip.startSec + clip.durationSec;
  const out: TranscriptLine[] = [];
  for (const s of segments) {
    const text = s.text.trim();
    if (!text) continue;
    const startSec = Math.max(clip.startSec, clip.startSec + s.startSec / speed);
    const endSec = Math.min(clipEnd, clip.startSec + s.endSec / speed);
    if (!(endSec > startSec)) continue;
    out.push({ startSec, endSec, text });
  }
  return out;
}

/** 選んだ行を字幕にする（文は直した後のもの・空にした行は出さない）。時刻順。 */
export function transcriptCues(lines: readonly TranscriptLine[]): SubtitleCue[] {
  return lines
    .map((l) => ({ startSec: l.startSec, endSec: l.endSec, text: l.text.trim() }))
    .filter((c) => c.text !== '' && c.endSec > c.startSec)
    .sort((a, b) => a.startSec - b.startSec);
}

/**
 * 選んだ行の範囲を、消して詰める区間にする（無音を詰めると同じ道＝`applySilenceCuts` へ渡す）。
 * - 重なる・つながる行は1つにまとめる（1コマ未満の隙間もつなぐ＝間に髪の毛ほどの音を残さない）。
 * - **読み上げが鳴っている所（`keep`）は引く**＝読み上げは切れない部品なので、かかると丸ごと消える。
 * - **コマへ内側に丸める**（無音を詰めると同じ＝隣の読み上げの頭を巻き込まない）。丸めて長さが無くなった区間は落とす。
 */
export function transcriptCuts(
  lines: readonly TranscriptLine[],
  fps: number,
  /** 消さずに残す区間（読み上げが鳴っている所＝`voiceSpansOf`）。 */
  keep: readonly SilenceCandidate[] = [],
): { cuts: SilenceCandidate[]; keptVoice: boolean } {
  const frame = 1 / fps;
  const sorted = [...lines].sort((a, b) => a.startSec - b.startSec);
  const merged: SilenceCandidate[] = [];
  for (const l of sorted) {
    const last = merged[merged.length - 1];
    if (last && l.startSec <= last.endSec + frame) last.endSec = Math.max(last.endSec, l.endSec);
    else merged.push({ startSec: l.startSec, endSec: l.endSec });
  }
  // ⚠️ **読み上げのかかる所は残す**（無音を詰めると同じ＝#1387 段2のレビュー 🟡）。残したかは知らせに使う。
  const kept = subtract(merged, keep);
  const sum = (rs: readonly SilenceCandidate[]): number => rs.reduce((a, r) => a + (r.endSec - r.startSec), 0);
  const keptVoice = sum(kept) < sum(merged) - 1e-9;
  return { cuts: kept.map((r) => snapInside(r, fps)).filter((r) => r.endSec > r.startSec), keptVoice };
}
