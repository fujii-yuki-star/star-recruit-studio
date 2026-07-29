// 字幕と読み上げの連動（ADR-0032 決定24・#633）。純粋関数（副作用なし・§7 テスト対象）。
//
// 場面形式の FREE 字幕は「対象（`subtitleSource`）」＝**場面の中のセリフ**から文言を解く（ADR-0029）。
// タイムライン形式に「場面の中の行」は無いので、**タイムライン上の読み上げクリップ**へ向け直す＝
// 字幕クリップが読み上げクリップを1つ指す（`voiceClipId`）。
//
// 連動が担うのは**文言と時間の2つ**：
// - 文言＝指した読み上げの文を出す。字幕クリップ自身に文が入っていれば**そちらが優先**（言い換え用の
//   上書き層＝ADR-0029 の (2b) と同じ流儀）。
// - 時間＝指した読み上げを動かす・伸ばすと字幕も付いてくる（`edit.ts`）。声を作り直して長さが変わっても同じ。
//
// **壊れた参照は黙って消さない**（§2-5）＝連動先が見つからない字幕は、自分の文へ落ちて描かれ続け、
// 検証（`11 §8` V29）が「連動先が見つからない」と知らせる。
import { TIMELINE_CLIP_KIND } from '../enums';
import type { TimelineClip, TimelineProject } from './types';

/** 字幕クリップが指している読み上げクリップ（指していない・見つからない＝`undefined`）。 */
export function boundVoiceClip(doc: TimelineProject, clip: TimelineClip): TimelineClip | undefined {
  if (clip.kind !== TIMELINE_CLIP_KIND.subtitle || !clip.voiceClipId) return undefined;
  const found = doc.clips.find((c) => c.id === clip.voiceClipId);
  return found?.kind === TIMELINE_CLIP_KIND.voice ? found : undefined;
}

/**
 * その字幕クリップが出す文言。**自分の文が優先**、無ければ連動先の読み上げ文。
 * どちらも無ければ `undefined`（描くものが無い）。
 */
export function subtitleTextOf(doc: TimelineProject, clip: TimelineClip): string | undefined {
  if (clip.kind !== TIMELINE_CLIP_KIND.subtitle) return clip.text;
  if (clip.text) return clip.text;
  return boundVoiceClip(doc, clip)?.voice?.text || undefined;
}

/** 連動先を指しているのに見つからない字幕クリップ（黙って消さないための材料）。 */
export function danglingSubtitleLinks(doc: TimelineProject): TimelineClip[] {
  return doc.clips.filter(
    (c) => c.kind === TIMELINE_CLIP_KIND.subtitle && !!c.voiceClipId && !boundVoiceClip(doc, c),
  );
}

/** その読み上げクリップに連動している字幕クリップ（動かすとき一緒に動かす対象）。 */
export function subtitlesBoundTo(doc: TimelineProject, voiceClipId: string): TimelineClip[] {
  return doc.clips.filter((c) => c.kind === TIMELINE_CLIP_KIND.subtitle && c.voiceClipId === voiceClipId);
}
