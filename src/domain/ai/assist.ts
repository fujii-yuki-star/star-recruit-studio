// 編集の途中の AI 補助（ADR-0053）＝同梱の AI に小さな作業を1つ頼み、候補を出して利用者が選ぶ。純粋関数。
// 呼び出し（llama-server）は infrastructure（`aiClient.localAiAssist`）、画面は `AiSuggest`。
// ⚠️ 候補は**検証してから**見せる（§2-2）：空・字数の上限越え・元と同じ・重なりは落とす。会社名は印で渡して崩させない。
import {
  MAX_NARRATION_LEN_DEFAULT,
  MAX_SUBTITLE_LEN_DEFAULT,
  NARRATION_CHARS_PER_SEC,
  NARRATION_SCENE_PADDING_SEC,
} from '../constants';
import { COMPANY_NAME_PLACEHOLDER, repairTruncatedName } from './refineVideoPlan';

/** 頼める作業の種類（画面のボタン1つ＝1種類）。 */
export const ASSIST_KIND = {
  /** セリフを短く。 */
  shorten: 'shorten',
  /** セリフを丁寧に。 */
  polite: 'polite',
  /** セリフをやわらかく。 */
  soft: 'soft',
  /** セリフを場面の表示時間に収まる長さに。 */
  fitDuration: 'fitDuration',
  /** 語りから字幕を作る。 */
  subtitle: 'subtitle',
  /** 語りから見出しの候補を出す。 */
  title: 'title',
} as const;
export type AssistKind = (typeof ASSIST_KIND)[keyof typeof ASSIST_KIND];

/** 候補の数（多すぎると選ぶのが手間・2B は数を増やすほど似た候補が増える）。 */
export const ASSIST_CANDIDATES = 3;
/** 見出しの字数の上限（画面の短い見出し）。 */
export const ASSIST_TITLE_MAX_LENGTH = 20;
/** 字幕の目安の上限（見た目の上限より短く＝字幕は語りの要約）。 */
export const ASSIST_SUBTITLE_TARGET_LENGTH = 30;
/** これより短い上限は頼まない（言い直しても意味が残らない）。 */
const MIN_ASSIST_LENGTH = 8;

export interface AssistLimits {
  /** 見た目パターンの語りの上限（無ければ既定）。 */
  maxNarrationLength?: number;
  /** 見た目パターンの字幕の上限（無ければ既定）。 */
  maxSubtitleLength?: number;
  /** 場面の表示時間（秒）。「尺に合わせる」で使う。 */
  sceneDurationSec?: number;
}

/** 読み上げで `sec` 秒に収まる字数（前後の間を引く）。 */
export function charsForDuration(sec: number): number {
  return Math.max(0, Math.floor((sec - NARRATION_SCENE_PADDING_SEC) * NARRATION_CHARS_PER_SEC));
}

/**
 * その作業の字数の上限。頼めない（上限が短すぎる）ときは null。
 * - 短く＝今の文の 7 割（語りの上限も越えない）／丁寧に・やわらかく＝語りの上限
 * - 尺に合わせる＝表示時間で読み切れる字数（語りの上限も越えない）。今の文がもう収まっていれば null（頼む意味が無い）
 * - 字幕＝字幕の上限と目安の短い方／見出し＝`ASSIST_TITLE_MAX_LENGTH`
 */
export function assistMaxLength(kind: AssistKind, text: string, limits: AssistLimits): number | null {
  const narration = limits.maxNarrationLength ?? MAX_NARRATION_LEN_DEFAULT;
  let max: number;
  switch (kind) {
    case ASSIST_KIND.shorten: max = Math.min(narration, Math.floor(text.length * 0.7)); break;
    case ASSIST_KIND.polite:
    case ASSIST_KIND.soft: max = narration; break;
    case ASSIST_KIND.fitDuration: {
      // 時間が無い・0 以下なら頼まない。⚠️ 外しても結果は同じ（NaN／0 字は下の最短の境目で null になる）＝変異チェックで等価。
      // 明示しておくのは、NaN が素通りする式に頼らないため。
      if (!(limits.sceneDurationSec && limits.sceneDurationSec > 0)) return null;
      max = Math.min(narration, charsForDuration(limits.sceneDurationSec));
      if (text.length <= max) return null;
      break;
    }
    case ASSIST_KIND.subtitle: max = Math.min(limits.maxSubtitleLength ?? MAX_SUBTITLE_LEN_DEFAULT, ASSIST_SUBTITLE_TARGET_LENGTH); break;
    case ASSIST_KIND.title: max = ASSIST_TITLE_MAX_LENGTH; break;
  }
  return max >= MIN_ASSIST_LENGTH ? max : null;
}

const TASK: Record<AssistKind, (max: number, sec?: number) => string> = {
  shorten: (max) => `元の文を、意味と要点を保ったまま、${max}字以内に短く言い直す。`,
  polite: (max) => `元の文を、丁寧で落ち着いた「です・ます」の言い方に言い直す（${max}字以内）。`,
  soft: (max) => `元の文を、話しかけるような、やわらかく親しみやすい言い方に言い直す（${max}字以内）。`,
  fitDuration: (max, sec) => `元の文を、読み上げで約${sec}秒に収まるよう、要点を残して${max}字以内に言い直す。`,
  subtitle: (max) => `この語りの要点を、画面の字幕として${max}字以内にまとめる（語りの言葉を使い、内容を足さない）。`,
  title: (max) => `この語りの場面に付ける、画面の短い見出しを${max}字以内で考える（体言止めでよい）。`,
};

export interface AssistMessages {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  /** AI に渡した上限（会社名を印にした分だけ短い）。 */
  budget: number;
}

/** 会社名を印にする（言い直しで崩させない）。印に置き換えた数も返す。 */
function guard(text: string, companyName: string): { text: string; count: number } {
  if (!companyName) return { text, count: 0 };
  const count = text.split(companyName).length - 1;
  return { text: count > 0 ? text.split(companyName).join(COMPANY_NAME_PLACEHOLDER) : text, count };
}

/**
 * 指示文と出力の形。`text` は作業の元（言い直し＝今のセリフ／字幕・見出し＝今の語り）。
 * 会社名は印にして渡し、印の分だけ短い上限を渡す（戻して伸びても上限を越えないように）。
 */
export function buildAssistMessages(kind: AssistKind, text: string, max: number, opts: { companyName?: string; sceneDurationSec?: number } = {}): AssistMessages {
  const name = opts.companyName?.trim() ?? '';
  const g = guard(text, name);
  const budget = Math.max(1, max - g.count * Math.max(0, name.length - COMPANY_NAME_PLACEHOLDER.length));
  const system = `あなたは動画のセリフ・字幕・見出しを整える編集者です。

【厳守事項】
- ${TASK[kind](budget, opts.sceneDurationSec)}
- 元の文に無い事実（数字・制度・評価）を足さない。
- ${COMPANY_NAME_PLACEHOLDER} はそのまま残す（言い換えない・消さない）。
- 候補を${ASSIST_CANDIDATES}個、互いに違う言い方で書く。説明を付けない。
- 出力は {"candidates": ["…", "…", "…"]} の JSON だけ。`;
  const user = [kind === ASSIST_KIND.subtitle || kind === ASSIST_KIND.title ? '# 語り' : '# 元の文', g.text].join('\n');
  return {
    system,
    user,
    budget,
    schema: {
      type: 'object', additionalProperties: false, required: ['candidates'],
      properties: {
        candidates: {
          type: 'array', minItems: 1, maxItems: ASSIST_CANDIDATES,
          items: { type: 'string', minLength: 1, maxLength: budget },
        },
      },
    },
  };
}

/**
 * AI の応答から候補を取り出す（検証つき）。印を会社名に戻し、崩れた会社名を直し、括弧（「」）の囲みを外す。
 * 落とすもの＝文字でない・空・上限越え（戻した後で見る）・元と同じ・重なり。最大 `ASSIST_CANDIDATES` 個。
 */
export function parseAssistCandidates(raw: string, original: string, max: number, companyName?: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return [];
  }
  const list = (parsed as { candidates?: unknown } | null)?.candidates;
  if (!Array.isArray(list)) return [];
  const name = companyName?.trim() ?? '';
  const out: string[] = [];
  for (const c of list) {
    if (typeof c !== 'string') continue;
    let v = c.trim().replace(/^「(.*)」$/s, '$1').trim();
    v = v.split(COMPANY_NAME_PLACEHOLDER).join(name);
    if (name) v = repairTruncatedName(v, name).text;
    if (v.length === 0 || v.length > max || v === original.trim() || out.includes(v)) continue;
    out.push(v);
    if (out.length === ASSIST_CANDIDATES) break;
  }
  return out;
}
