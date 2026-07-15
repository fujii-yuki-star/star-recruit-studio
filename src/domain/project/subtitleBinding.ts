// FREE 字幕要素の「対象（subtitleSource）」解決（ADR-0029）。純粋関数（副作用なし・テスト容易）。
// - 時刻 t は直接受けず、書き出しと同じ sceneSegmentSpecs から作る「その瞬間のセグメント」（SubtitleMoment）を受ける（P1-1）。
//   セグメントは domain/project/lineTimeline.ts の segmentAt(scene, lineDurations, t) で作る＝プレビュー＝書き出しで同一。
// - 話者絞り込みは音声生成（resolveLineVoice）と同じ実効話者（effectiveSpeakerKey）で比較する（P1-2）。
import { FREE_ELEMENT_KIND, SPEAKER_KEY_KIND, SUBTITLE_SOURCE_KIND, TEXT_KEY } from '../enums';
import { characterForSpeaker } from '../voice/voiceCatalog';
import { resolveLineSubtitle, segmentLineIds } from './lineTimeline';
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
  // 間（無言の頭空白＝isGap）はどの対象でも常に非表示（ADR-0029・narration も含む・P1-1）。ソース分岐より先に判定する。
  if (moment.segment.isGap === true) return null;
  const source = el.subtitleSource ?? defaultSubtitleSource(scene);
  if (source.kind === SUBTITLE_SOURCE_KIND.narration) {
    if (scene.subtitleEnabledDefault === false) return null;
    const text = scene.texts[TEXT_KEY.subtitle] ?? '';
    return text.length > 0 ? text : null;
  }
  const seg = moment.segment;
  const text = seg.subtitleText ?? null;
  if (text == null || text.length === 0) return null;
  // allLines＝セグメントの字幕（同時グループは全員分を改行で結合済み＝2行表示・ADR-0031）。
  if (source.kind === SUBTITLE_SOURCE_KIND.allLines) return text;
  // speaker：セグメントの全行（primary＋同時行＝ADR-0031）から対象話者に一致する行を探し、その行**自身**の字幕を出す。
  // seg.subtitleText は同時グループでは全員分の結合ゆえ使わない（話者ボックスは自分の行だけ＝二重描画にしない・P2）。
  const lines = sceneLines(scene);
  for (const id of segmentLineIds(seg)) {
    const line = lines.find((l) => l.lineId === id);
    if (line == null) continue;
    if (speakerKeyEquals(effectiveSpeakerKey(line), source.speaker)) {
      const sub = resolveLineSubtitle(line, scene);
      return sub.enabled && sub.text.length > 0 ? sub.text : null;
    }
  }
  return null;
}

/** SpeakerKey を選択 value 用の安定文字列にする（UI select・重複排除キー）。 */
function speakerKeyToken(key: SpeakerKey): string {
  return key.kind === SPEAKER_KEY_KIND.catalog ? `catalog:${key.speaker}` : 'default';
}

/**
 * 掛け合い場面に実在する「実効話者」の選択肢（字幕の対象＝話者ごとの UI 用・ADR-0029・PR-C）。
 * 重複排除し、ラベルはキャラクター名（catalog）／「既定の声」（default）。行の登場順で安定。
 * 単独ナレーション（lines なし）でも sceneLines は1行を返すが、UI 側は掛け合い時のみこの選択肢を出す。
 */
export function sceneSubtitleSpeakerOptions(scene: Scene): { key: SpeakerKey; label: string }[] {
  const out: { key: SpeakerKey; label: string }[] = [];
  const seen = new Set<string>();
  for (const line of sceneLines(scene)) {
    const key = effectiveSpeakerKey(line);
    const token = speakerKeyToken(key);
    if (seen.has(token)) continue;
    seen.add(token);
    const label = key.kind === SPEAKER_KEY_KIND.catalog ? characterForSpeaker(key.speaker) ?? '話者' : '既定の声';
    out.push({ key, label });
  }
  return out;
}

/** subtitleSource → UI select の value（文字列）。ADR-0029 PR-C。 */
export function subtitleSourceToValue(source: SubtitleSource): string {
  if (source.kind === SUBTITLE_SOURCE_KIND.speaker) return `speaker:${speakerKeyToken(source.speaker)}`;
  return source.kind; // 'narration' | 'allLines'
}

/** UI select の value（文字列）→ subtitleSource。未知値は narration へフォールバック（§2-5・黙って壊さない）。 */
export function subtitleSourceFromValue(value: string): SubtitleSource {
  if (value === SUBTITLE_SOURCE_KIND.allLines) return { kind: SUBTITLE_SOURCE_KIND.allLines };
  if (value === 'speaker:default') return { kind: SUBTITLE_SOURCE_KIND.speaker, speaker: { kind: SPEAKER_KEY_KIND.default } };
  const m = /^speaker:catalog:(\d+)$/.exec(value);
  if (m) return { kind: SUBTITLE_SOURCE_KIND.speaker, speaker: { kind: SPEAKER_KEY_KIND.catalog, speaker: Number(m[1]) } };
  return { kind: SUBTITLE_SOURCE_KIND.narration };
}

/**
 * 場面のセリフ構成が変わったとき、無効になった字幕対象（subtitleSource）を未設定（＝既定）へ戻す（ADR-0026④・黙って消さない）。
 * - 単独ナレーション（lines なし）では allLines/speaker は描画されない → 未設定（＝narration＝texts.subtitle）へ。
 * - 掛け合いで、選択済み話者が場面からいなくなった speaker も未設定（＝allLines）へ。
 * narration・有効な対象・対象を持たない字幕は不変。無効な対象が無ければ同一参照を返す（未保存/履歴にしない）。
 * 掛け合い解除・行の話者変更/削除の各 lineEditOps から呼ぶ（「設定できるのに後で効かなくなる」経路を塞ぐ）。
 */
export function normalizeSubtitleSources(scene: Scene): Scene {
  const layout = scene.freeLayout;
  if (!layout || !layout.some((e) => e.kind === FREE_ELEMENT_KIND.subtitle && e.subtitleSource != null)) return scene;
  const hasLines = (scene.lines?.length ?? 0) > 0;
  const sceneKeys = hasLines ? sceneLines(scene).map(effectiveSpeakerKey) : [];
  let changed = false;
  const next = layout.map((el) => {
    if (el.kind !== FREE_ELEMENT_KIND.subtitle || el.subtitleSource == null) return el;
    const src = el.subtitleSource;
    const valid =
      src.kind === SUBTITLE_SOURCE_KIND.narration
        ? true
        : src.kind === SUBTITLE_SOURCE_KIND.allLines
          ? hasLines
          : hasLines && sceneKeys.some((k) => speakerKeyEquals(k, src.speaker)); // speaker：実在する実効話者のみ有効
    if (valid) return el;
    changed = true;
    const rest = { ...el };
    delete rest.subtitleSource; // 無効＝未設定（既定＝単独→読み上げ・掛け合い→全行）へ戻す
    return rest;
  });
  return changed ? { ...scene, freeLayout: next } : scene;
}
