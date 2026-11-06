// あなた向け会社説明の組み方（β・ADR-0061 決定4・`12 §11`）。純粋関数（AI の呼び出しは引数で受ける）。
//
// 1. 絞る（コード）＝選んだ興味の場面・有効な動画・使わないでないもの。必ず入れる場面は興味に関係なく入れる。
// 2. 選んで並べる（同梱の AI）＝渡すのは**場面の名前・セリフ・興味の項目・長さだけ**（素材のファイルは渡さない）。出力は候補の記号の並び。
// 3. 確かめる（コード）＝候補の中か・重なりが無いか・必ず入れる場面が入っているか・長さが範囲か。
// 4. ダメなら（AI が無い・失敗した・確かめで落ちた）＝**ルールだけで組む**（AI 無しでも必ず完成する）。
//
// ⚠️ **外の AI は使わない**＝呼び出しを渡す側（画面）は同梱の AI だけを渡す（§2-6・ADR-0061 決定4）。
// ⚠️ **学生の名前・属性は扱わない**（決定6）＝ここに入るのは選んだ興味と長さだけ。
import {
  BRIEFING_AI_CANDIDATE_MAX,
  BRIEFING_AI_SPEECH_MAX_LENGTH,
  BRIEFING_LONG_MAX_SEC,
  BRIEFING_LONG_MIN_SEC,
  BRIEFING_NORMAL_MAX_SEC,
  BRIEFING_NORMAL_MIN_SEC,
  BRIEFING_SHORT_MAX_SEC,
  BRIEFING_SHORT_MIN_SEC,
  BRIEFING_VOICE_CHOICE_MAX,
} from '../constants';
import { sceneSpokenText } from '../ai/assist';
import { BRIEFING_PRIORITIES, type BriefingCatalog, type BriefingPriority } from './catalog';

/** 学生が選ぶ長さ（短め／ふつう／しっかり）。 */
export const BRIEFING_LENGTHS = ['short', 'normal', 'long'] as const;
export type BriefingLength = (typeof BRIEFING_LENGTHS)[number];
export const BRIEFING_LENGTH = { short: 'short', normal: 'normal', long: 'long' } as const satisfies Record<BriefingLength, BriefingLength>;

/** 長さごとの秒の範囲（最後の場面は数えない・`11 §4`）。 */
export const BRIEFING_LENGTH_RANGE_SEC: Record<BriefingLength, { min: number; max: number }> = {
  short: { min: BRIEFING_SHORT_MIN_SEC, max: BRIEFING_SHORT_MAX_SEC },
  normal: { min: BRIEFING_NORMAL_MIN_SEC, max: BRIEFING_NORMAL_MAX_SEC },
  long: { min: BRIEFING_LONG_MIN_SEC, max: BRIEFING_LONG_MAX_SEC },
};

/** 組むのに使う場面（原本の動画から読む分だけ）。 */
export interface BriefingSceneDoc {
  sceneId: string;
  order: number;
  durationSec: number;
  texts?: { title?: string | null } | null;
  narration?: { text?: string } | null;
  lines?: { text?: string }[] | null;
}

/** 読めた場面形式の動画（読めなかった・タイムラインで作った動画は渡さない）。 */
export interface BriefingSourceDoc {
  projectId: string;
  scenes: readonly BriefingSceneDoc[];
}

/** 組む候補の場面。`key` は AI に見せる短い記号（`c1`…＝自然な順）。 */
export interface BriefingCandidate {
  key: string;
  projectId: string;
  sceneId: string;
  /** 場面の名前（見出し・無ければセリフの頭）。 */
  title: string;
  /** 場面のセリフ（掛け合いは行をつないだもの）。 */
  speech: string;
  durationSec: number;
  /** 登録で付いている興味の項目。 */
  interestIds: string[];
  /** そのうち学生が選んだもの。 */
  matched: string[];
  priority: BriefingPriority;
  required: boolean;
}

/** 組んだ結果。`by`＝AI が選んだか、ルールだけで組んだか。 */
export interface BriefingComposition {
  picks: BriefingCandidate[];
  totalSec: number;
  by: 'ai' | 'rules';
  /** AI に頼んだのに使わなかった理由（診断用・頼まなかったときは null）。 */
  aiProblem: BriefingComposeProblem | null;
}

/** AI の並びを使わなかった理由。 */
export type BriefingComposeProblem =
  | 'failed'
  | 'unreadable'
  | 'empty'
  | 'unknownScene'
  | 'duplicate'
  | 'requiredMissing'
  | 'tooLong'
  | 'tooShort';

/** 同梱の AI に頼む関数（system・user・出力の形 JSON）→ 応答の本文。 */
export type BriefingAskAi = (system: string, user: string, schema: string) => Promise<string>;

function sceneTitle(s: BriefingSceneDoc, speech: string): string {
  const t = (s.texts?.title ?? '').trim();
  return t || speech.slice(0, 30) || '（文字のない場面）';
}

/**
 * 1. 絞る。並びは**自然な順**（登録の動画の順 → 動画の中の場面の順）。
 * - 動画が無効・読めていない（`docs` に無い）なら使わない。登録に載っていない場面・場面が消えたものは使わない。
 * - 使わない（`excluded`）は必ず入れるより強い（両方付いていても入れない）。
 * - 必ず入れる場面は興味に関係なく入れる。それ以外は、選んだ興味が1つでも付いている場面だけ。
 */
export function collectBriefingCandidates(
  catalog: BriefingCatalog,
  docs: readonly BriefingSourceDoc[],
  chosenInterestIds: readonly string[],
): BriefingCandidate[] {
  const known = new Set(catalog.interests.map((i) => i.interestId));
  const chosen = new Set(chosenInterestIds.filter((id) => known.has(id)));
  const out: BriefingCandidate[] = [];
  for (const src of catalog.sources) {
    if (!src.enabled) continue;
    const doc = docs.find((d) => d.projectId === src.projectId);
    if (!doc) continue;
    const scenes = [...doc.scenes].sort((a, b) => a.order - b.order);
    for (const s of scenes) {
      const rule = src.scenes.find((r) => r.sceneId === s.sceneId);
      if (!rule || rule.excluded) continue;
      const matched = rule.interestIds.filter((id) => chosen.has(id));
      if (!rule.required && matched.length === 0) continue;
      const speech = sceneSpokenText(s).replace(/\s*\n\s*/g, ' ');
      out.push({
        key: `c${out.length + 1}`,
        projectId: src.projectId,
        sceneId: s.sceneId,
        title: sceneTitle(s, speech),
        speech,
        durationSec: s.durationSec,
        interestIds: [...rule.interestIds],
        matched,
        priority: rule.priority,
        required: rule.required,
      });
    }
  }
  return out;
}

function sumSec(list: readonly BriefingCandidate[]): number {
  return list.reduce((t, c) => t + c.durationSec, 0);
}

/** 先に採る順＝優先度が高い → 選んだ興味に多く当たる → 自然な順。 */
function rankOrder(cands: readonly BriefingCandidate[]): BriefingCandidate[] {
  const naturalIndex = new Map(cands.map((c, i) => [c.key, i]));
  return [...cands].sort(
    (a, b) =>
      BRIEFING_PRIORITIES.indexOf(a.priority) - BRIEFING_PRIORITIES.indexOf(b.priority) ||
      b.matched.length - a.matched.length ||
      (naturalIndex.get(a.key) ?? 0) - (naturalIndex.get(b.key) ?? 0),
  );
}

/** 必ず入れる場面の合計が上限を越えるときは、上限をそこまで広げる（必ず入れるは管理者の決めたこと＝削らない）。 */
function effectiveMax(cands: readonly BriefingCandidate[], length: BriefingLength): number {
  return Math.max(BRIEFING_LENGTH_RANGE_SEC[length].max, sumSec(cands.filter((c) => c.required)));
}

/**
 * 4. ルールだけで組む（AI 無しでも必ず完成する）。並びは自然な順。
 * - 必ず入れる場面を全部入れる。
 * - 選んだ興味のそれぞれに、まだ1つも場面が無ければ、その興味の場面を先に採る順で1つ入れる（入る長さなら）＝興味の取りこぼしを避ける。
 * - 残りを先に採る順で、上限を越えない限り入れていく（入らない長い場面は飛ばして次を試す）。
 */
export function composeBriefingByRules(
  cands: readonly BriefingCandidate[],
  chosenInterestIds: readonly string[],
  length: BriefingLength,
): BriefingCandidate[] {
  const max = effectiveMax(cands, length);
  const picked = new Set(cands.filter((c) => c.required).map((c) => c.key));
  let total = sumSec(cands.filter((c) => c.required));
  const ranked = rankOrder(cands.filter((c) => !c.required));
  const take = (c: BriefingCandidate): void => {
    picked.add(c.key);
    total += c.durationSec;
  };
  for (const interestId of chosenInterestIds) {
    if (cands.some((c) => picked.has(c.key) && c.matched.includes(interestId))) continue;
    const first = ranked.find((c) => !picked.has(c.key) && c.matched.includes(interestId) && total + c.durationSec <= max);
    if (first) take(first);
  }
  for (const c of ranked) if (!picked.has(c.key) && total + c.durationSec <= max) take(c);
  return cands.filter((c) => picked.has(c.key));
}

/** AI に見せる候補＝必ず入れる場面＋先に採る順で上から（`BRIEFING_AI_CANDIDATE_MAX` まで）。並びは自然な順。 */
export function briefingAiOffer(cands: readonly BriefingCandidate[]): BriefingCandidate[] {
  const required = cands.filter((c) => c.required);
  const rest = rankOrder(cands.filter((c) => !c.required)).slice(0, Math.max(0, BRIEFING_AI_CANDIDATE_MAX - required.length));
  const keep = new Set([...required, ...rest].map((c) => c.key));
  return cands.filter((c) => keep.has(c.key));
}

export interface BriefingComposeMessages {
  system: string;
  user: string;
  schema: Record<string, unknown>;
}

/**
 * 2. 同梱の AI への指示文と出力の形（`12 §11`）。渡すのは場面の名前・セリフ（`BRIEFING_AI_SPEECH_MAX_LENGTH` 字まで）・興味の項目・秒・必ず入れるかだけ。
 * 出力は `{"order": ["c1", …]}`＝記号は見せた候補の中だけ（形で縛る）。
 */
export function buildBriefingComposeMessages(
  offer: readonly BriefingCandidate[],
  interestLabels: ReadonlyMap<string, string>,
  chosenInterestIds: readonly string[],
  length: BriefingLength,
): BriefingComposeMessages {
  const range = BRIEFING_LENGTH_RANGE_SEC[length];
  const system = `あなたは会社説明の動画を組む編集者です。学生が知りたいことに合わせて、使える場面から選んで並べます。

【厳守事項】
- 「# 学生が知りたいこと」に合う場面を「# 使える場面」から選び、見せる順に並べる。
- 選んだ場面の秒を足した合計を、約${range.min}〜${range.max}秒にする。
- 「必ず入れる」と書いた場面は全部入れる。
- 同じ場面を2回使わない。一覧に無い記号を書かない。
- 知りたいことのそれぞれに、少なくとも1つは場面を入れる。
- 話の流れが自然な順にする（会社の紹介 → 具体的な話 → まとめ）。
- 出力は {"order": ["c1", "c3", …]} の JSON だけ。説明を付けない。`;
  const label = (id: string): string => interestLabels.get(id) ?? '';
  const wants = chosenInterestIds.map(label).filter((l) => l.length > 0).join('、');
  const lines = offer.map((c) => {
    const tags = c.interestIds.map(label).filter((l) => l.length > 0).join('・') || 'なし';
    const head = `${c.key}｜${c.title}｜${Math.round(c.durationSec)}秒｜興味：${tags}${c.required ? '｜必ず入れる' : ''}`;
    const speech = c.speech.slice(0, BRIEFING_AI_SPEECH_MAX_LENGTH);
    return speech ? `${head}\n  セリフ：${speech}` : head;
  });
  const user = ['# 学生が知りたいこと', wants || '（指定なし）', '', '# 使える場面', ...lines].join('\n');
  return {
    system,
    user,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['order'],
      properties: {
        order: { type: 'array', minItems: 1, maxItems: offer.length, items: { enum: offer.map((c) => c.key) } },
      },
    },
  };
}

/**
 * 3. AI の並びを確かめる。通れば候補の並び（AI の順のまま）。
 * - 読めない・空・一覧に無い記号・重なり・必ず入れる場面の抜け → 使わない。
 * - 長さ＝上限（必ず入れる場面で広げた分は許す）を越えたら使わない。下限は「見せた候補を全部足しても届かない」なら、その合計まで下げる。
 */
export function checkBriefingComposition(
  raw: string,
  offer: readonly BriefingCandidate[],
  length: BriefingLength,
): { ok: true; picks: BriefingCandidate[] } | { ok: false; problem: BriefingComposeProblem } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return { ok: false, problem: 'unreadable' };
  }
  const order = (parsed as { order?: unknown } | null)?.order;
  if (!Array.isArray(order)) return { ok: false, problem: 'unreadable' };
  if (order.length === 0) return { ok: false, problem: 'empty' };
  const byKey = new Map(offer.map((c) => [c.key, c]));
  const picks: BriefingCandidate[] = [];
  for (const k of order) {
    const c = typeof k === 'string' ? byKey.get(k) : undefined;
    if (!c) return { ok: false, problem: 'unknownScene' };
    if (picks.includes(c)) return { ok: false, problem: 'duplicate' };
    picks.push(c);
  }
  if (offer.some((c) => c.required && !picks.includes(c))) return { ok: false, problem: 'requiredMissing' };
  const total = sumSec(picks);
  if (total > effectiveMax(offer, length)) return { ok: false, problem: 'tooLong' };
  if (total < Math.min(BRIEFING_LENGTH_RANGE_SEC[length].min, sumSec(offer))) return { ok: false, problem: 'tooShort' };
  return { ok: true, picks };
}

/**
 * 1〜4 を通して組む。`askAi` が無い（同梱の AI が無い環境）・候補が1つ以下（選ぶものが無い）なら AI に頼まない。
 * AI が投げた・確かめで落ちたら、ルールだけで組む（`aiProblem` に理由）。候補が0なら `picks` は空（画面が知らせる）。
 */
export async function composeBriefing(
  input: {
    catalog: BriefingCatalog;
    docs: readonly BriefingSourceDoc[];
    chosenInterestIds: readonly string[];
    length: BriefingLength;
  },
  askAi?: BriefingAskAi,
): Promise<BriefingComposition> {
  const { catalog, chosenInterestIds, length } = input;
  const cands = collectBriefingCandidates(catalog, input.docs, chosenInterestIds);
  const byRules = (aiProblem: BriefingComposeProblem | null): BriefingComposition => {
    const picks = composeBriefingByRules(cands, chosenInterestIds, length);
    return { picks, totalSec: sumSec(picks), by: 'rules', aiProblem };
  };
  if (!askAi || cands.length <= 1) return byRules(null);
  const offer = briefingAiOffer(cands);
  const labels = new Map(catalog.interests.map((i) => [i.interestId, i.label]));
  const m = buildBriefingComposeMessages(offer, labels, chosenInterestIds, length);
  let raw: string;
  try {
    raw = await askAi(m.system, m.user, JSON.stringify(m.schema));
  } catch {
    return byRules('failed');
  }
  const checked = checkBriefingComposition(raw, offer, length);
  if (!checked.ok) return byRules(checked.problem);
  return { picks: checked.picks, totalSec: sumSec(checked.picks), by: 'ai', aiProblem: null };
}

/**
 * 学生が選べる声（ADR-0061 決定3・ADR-0073）＝会社の動画で使えるキャラの「ノーマル」の声を `BRIEFING_VOICE_CHOICE_MAX` まで。
 * ⚠️ 並びは声のカタログの順（カタログが会社で使えるキャラだけを持つ）。「元の声のまま」は画面が先頭に足す。
 */
export function briefingVoiceChoices(catalog: readonly { character: string; styles: readonly { speaker: number }[] }[], isAllowed: (character: string) => boolean): { speaker: number; character: string }[] {
  return catalog
    .filter((c) => isAllowed(c.character) && c.styles.length > 0)
    .slice(0, BRIEFING_VOICE_CHOICE_MAX)
    .map((c) => ({ speaker: c.styles[0].speaker, character: c.character }));
}
