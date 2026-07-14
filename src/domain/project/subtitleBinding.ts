// FREE 字幕要素の「対象（subtitleSource）」解決（ADR-0029）。純粋関数（副作用なし・テスト容易）。
// - 時刻 t は直接受けず、書き出しと同じ sceneSegmentSpecs から作る「その瞬間のセグメント」（SubtitleMoment）を受ける（P1-1）。
//   セグメントは domain/project/lineTimeline.ts の segmentAt(scene, lineDurations, t) で作る＝プレビュー＝書き出しで同一。
// - 話者絞り込みは音声生成（resolveLineVoice）と同じ実効話者（effectiveSpeakerKey）で比較する（P1-2）。
import { FREE_ELEMENT_KIND, SPEAKER_KEY_KIND, SUBTITLE_SOURCE_KIND, TEXT_KEY } from '../enums';
import { characterForSpeaker } from '../voice/voiceCatalog';
import type { SceneSegmentSpec } from './lineTimeline';
import { sceneLines } from './narrationLines';
import type { FreeElement, NarrationLine, Scene, SpeakerKey, SubtitleSource } from './types';

/** 字幕解決の正準状態（プレビュー＝書き出しで共有・ADR-0029）。segment は sceneSegmentSpecs 由来の「その瞬間のセグメント」。 */
export interface SubtitleMoment {
  segment: SceneSegmentSpec;
}

/**
 * 行の実効話者キー（音声生成 resolveLineVoice と同じ判定・ADR-0029 P1-2）。
 * voiceCatalog にある speaker はその番号（catalog）、無ければ既定声（default＝場面の継承 voiceId・番号を持たない）。
 * 既定声は場面ごとに1つゆえ voiceId 値は不要（default は場面内で一意のバケツ・resolveLineVoice の「speaker が null なら base 声」に対応）。
 */
export function effectiveSpeakerKey(line: NarrationLine): SpeakerKey {
  const spk = line.speaker;
  if (spk != null && characterForSpeaker(spk) != null) return { kind: SPEAKER_KEY_KIND.catalog, speaker: spk };
  return { kind: SPEAKER_KEY_KIND.default };
}

/** SpeakerKey の同値判定（catalog は speaker 番号一致・default 同士は一致）。 */
export function speakerKeyEquals(a: SpeakerKey, b: SpeakerKey): boolean {
  if (a.kind === SPEAKER_KEY_KIND.catalog && b.kind === SPEAKER_KEY_KIND.catalog) return a.speaker === b.speaker;
  return a.kind === b.kind;
}

/** subtitleSource 未指定時の既定＝掛け合い(lines あり)は全行、単独は読み上げ（後方互換・ADR-0029）。 */
export function defaultSubtitleSource(scene: Scene): SubtitleSource {
  return scene.lines && scene.lines.length > 0
    ? { kind: SUBTITLE_SOURCE_KIND.allLines }
    : { kind: SUBTITLE_SOURCE_KIND.narration };
}

/**
 * FREE 字幕要素 el が、その瞬間（moment）に表示する字幕文を返す（表示なしは null）。ADR-0029。
 * - narration → texts.subtitle（subtitleEnabledDefault===false は非表示）。static ゆえセグメント非依存。
 * - allLines  → セグメントの字幕（間 isGap・OFF 行は非表示）。
 * - speaker   → セグメント行の実効話者が対象話者と一致するときのみ（不一致は別ボックスが受ける＝二重描画にしない）。
 * subtitle 以外の要素は対象外（null）。
 */
export function resolveSubtitleForElement(el: FreeElement, scene: Scene, moment: SubtitleMoment): string | null {
  if (el.kind !== FREE_ELEMENT_KIND.subtitle) return null;
  const source = el.subtitleSource ?? defaultSubtitleSource(scene);
  if (source.kind === SUBTITLE_SOURCE_KIND.narration) {
    if (scene.subtitleEnabledDefault === false) return null;
    const text = scene.texts[TEXT_KEY.subtitle] ?? '';
    return text.length > 0 ? text : null;
  }
  const seg = moment.segment;
  if (seg.isGap === true) return null;
  const text = seg.subtitleText ?? null;
  if (text == null || text.length === 0) return null;
  if (source.kind === SUBTITLE_SOURCE_KIND.allLines) return text;
  // speaker：セグメント行の実効話者が対象と一致するときのみ表示。
  if (seg.lineId == null) return null;
  const line = sceneLines(scene).find((l) => l.lineId === seg.lineId);
  if (line == null) return null;
  return speakerKeyEquals(effectiveSpeakerKey(line), source.speaker) ? text : null;
}
