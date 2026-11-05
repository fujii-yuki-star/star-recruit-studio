// あなた向け会社説明の登録（β・ADR-0061 決定2）。正典は `schemas/briefing-catalog.schema.json`（`11 §7.8`）。純粋関数。
//
// ⚠️ **project.json には入れない**＝β を外しても α の動画はそのまま開ける。動画と場面は **id で指すだけ**。
// ⚠️ **興味の項目はコードに決め打ちしない**＝会社が決める。最初に入れておく例（`DEFAULT_BRIEFING_INTERESTS`）は消せる。
import { validateBriefingCatalog } from '../validation/generated/validators.js';

export const BRIEFING_CATALOG_SCHEMA_VERSION = '1.0';

/** 場面の優先度（長さに収めるとき、どれを先に採るか）。schema の enum と同じ並び＝高い順。 */
export const BRIEFING_PRIORITIES = ['high', 'normal', 'low'] as const;
export type BriefingPriority = (typeof BRIEFING_PRIORITIES)[number];
export const BRIEFING_PRIORITY = { high: 'high', normal: 'normal', low: 'low' } as const satisfies Record<BriefingPriority, BriefingPriority>;

/** 興味の項目の上限（schema の `maxItems`）。 */
export const BRIEFING_INTEREST_MAX = 30;
/** 興味の項目の名前の長さの上限（schema の `maxLength`）。 */
export const BRIEFING_INTEREST_LABEL_MAX = 30;
/** 最後の場面の文の長さの上限（schema の `maxLength`）。 */
export const BRIEFING_CLOSING_TEXT_MAX = 120;

export interface BriefingInterest {
  interestId: string;
  label: string;
}

export interface BriefingSceneRule {
  sceneId: string;
  interestIds: string[];
  priority: BriefingPriority;
  required: boolean;
  excluded: boolean;
}

export interface BriefingSource {
  projectId: string;
  enabled: boolean;
  scenes: BriefingSceneRule[];
}

export interface BriefingClosing {
  text: string;
  useBrandLogo: boolean;
}

export interface BriefingCatalog {
  schemaVersion: typeof BRIEFING_CATALOG_SCHEMA_VERSION;
  interests: BriefingInterest[];
  sources: BriefingSource[];
  closing: BriefingClosing;
  exitCode: string | null;
}

/** 最初に入れておく興味の項目（利用者判断 2026-11-05＝例を入れておく・管理者が消せる）。 */
export const DEFAULT_BRIEFING_INTERESTS: readonly string[] = ['仕事内容', '研修', '若手社員', '技術', '福利厚生', '社風'];

/** 最後の場面の既定の文。⚠️ 会社名は入れない（コードに決め打ちしない＝管理者が書き換える）。 */
// 改行は締めの場面で読みやすい切れ目に置く（自動の折り返しだと「作／りました」で切れる＝見本で確かめた）。
export const DEFAULT_BRIEFING_CLOSING_TEXT = 'この動画は、当社が開発した\n動画づくり支援ソフト「すたりお」で作りました。';

/** interest_NNN を発行する（既存と重ならない最小の番号）。 */
export function createInterestId(existingIds: readonly string[]): string {
  const used = new Set(existingIds);
  let n = 1;
  let id = `interest_${String(n).padStart(3, '0')}`;
  while (used.has(id)) {
    n += 1;
    id = `interest_${String(n).padStart(3, '0')}`;
  }
  return id;
}

/** はじめての登録（例の興味の項目・使う動画なし・番号はまだ決めていない）。 */
export function defaultBriefingCatalog(): BriefingCatalog {
  const interests: BriefingInterest[] = [];
  for (const label of DEFAULT_BRIEFING_INTERESTS) {
    interests.push({ interestId: createInterestId(interests.map((i) => i.interestId)), label });
  }
  return {
    schemaVersion: BRIEFING_CATALOG_SCHEMA_VERSION,
    interests,
    sources: [],
    closing: { text: DEFAULT_BRIEFING_CLOSING_TEXT, useBrandLogo: true },
    exitCode: null,
  };
}

/** 正典の形を満たすか（読み込み・保存の前に通す）。 */
export function isBriefingCatalog(data: unknown): data is BriefingCatalog {
  return validateBriefingCatalog(data) === true;
}

/** 4 桁の数字か（抜ける番号）。 */
export function isBriefingExitCode(code: string): boolean {
  return /^[0-9]{4}$/.test(code);
}

// ── 興味の項目 ─────────────────────────────────────────────

/** 興味の項目を足す（名前は前後の空白を落とす・空・上限超えは足さない）。 */
export function addInterest(c: BriefingCatalog, label: string): BriefingCatalog {
  const name = label.trim().slice(0, BRIEFING_INTEREST_LABEL_MAX);
  if (!name || c.interests.length >= BRIEFING_INTEREST_MAX) return c;
  const interestId = createInterestId(c.interests.map((i) => i.interestId));
  return { ...c, interests: [...c.interests, { interestId, label: name }] };
}

/** 興味の項目の名前を変える（空なら変えない）。 */
export function renameInterest(c: BriefingCatalog, interestId: string, label: string): BriefingCatalog {
  const name = label.trim().slice(0, BRIEFING_INTEREST_LABEL_MAX);
  if (!name) return c;
  return { ...c, interests: c.interests.map((i) => (i.interestId === interestId ? { ...i, label: name } : i)) };
}

/**
 * 興味の項目を消す。⚠️ **場面に付いていたその項目も外す**＝残すと、どの項目にも見えない指し先が残る
 * （学生が選べない項目で場面が拾われる・登録の画面で見えない）。
 */
export function removeInterest(c: BriefingCatalog, interestId: string): BriefingCatalog {
  return {
    ...c,
    interests: c.interests.filter((i) => i.interestId !== interestId),
    sources: c.sources.map((s) => ({
      ...s,
      scenes: s.scenes.map((r) => (r.interestIds.includes(interestId) ? { ...r, interestIds: r.interestIds.filter((x) => x !== interestId) } : r)),
    })),
  };
}

/** 興味の項目を1つ上（-1）・下（+1）へ動かす（端なら動かさない）。 */
export function moveInterest(c: BriefingCatalog, interestId: string, delta: -1 | 1): BriefingCatalog {
  const from = c.interests.findIndex((i) => i.interestId === interestId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= c.interests.length) return c;
  const next = [...c.interests];
  [next[from], next[to]] = [next[to], next[from]];
  return { ...c, interests: next };
}

// ── 使う動画と場面 ────────────────────────────────────────

/** 使う動画を足す（既にあれば足さない）。 */
export function addSource(c: BriefingCatalog, projectId: string): BriefingCatalog {
  if (c.sources.some((s) => s.projectId === projectId)) return c;
  return { ...c, sources: [...c.sources, { projectId, enabled: true, scenes: [] }] };
}

/** 使う動画を外す（その動画の場面の登録も消える）。 */
export function removeSource(c: BriefingCatalog, projectId: string): BriefingCatalog {
  return { ...c, sources: c.sources.filter((s) => s.projectId !== projectId) };
}

/** 使う動画の有効・無効。 */
export function setSourceEnabled(c: BriefingCatalog, projectId: string, enabled: boolean): BriefingCatalog {
  return { ...c, sources: c.sources.map((s) => (s.projectId === projectId ? { ...s, enabled } : s)) };
}

/** まだ登録していない場面の既定（興味なし・ふつう・必須でない・除外でない＝組むときには使われない）。 */
export function emptySceneRule(sceneId: string): BriefingSceneRule {
  return { sceneId, interestIds: [], priority: BRIEFING_PRIORITY.normal, required: false, excluded: false };
}

/** その場面の登録（無ければ既定）。 */
export function sceneRuleOf(c: BriefingCatalog, projectId: string, sceneId: string): BriefingSceneRule {
  return c.sources.find((s) => s.projectId === projectId)?.scenes.find((r) => r.sceneId === sceneId) ?? emptySceneRule(sceneId);
}

/** 登録が既定のまま＝持たなくてよい（保存の形を小さく保つ）。 */
function isEmptyRule(r: BriefingSceneRule): boolean {
  return r.interestIds.length === 0 && r.priority === BRIEFING_PRIORITY.normal && !r.required && !r.excluded;
}

/**
 * 場面の登録を変える（動画が使う動画に無ければ変えない）。
 * ⚠️ **既定に戻った場面は持たない**＝「付けて外した」場面が残り続けない。知らない興味の項目は付けない。
 */
export function updateSceneRule(
  c: BriefingCatalog,
  projectId: string,
  sceneId: string,
  patch: Partial<Omit<BriefingSceneRule, 'sceneId'>>,
): BriefingCatalog {
  const src = c.sources.find((s) => s.projectId === projectId);
  if (!src) return c;
  const known = new Set(c.interests.map((i) => i.interestId));
  const cur = sceneRuleOf(c, projectId, sceneId);
  const next: BriefingSceneRule = {
    ...cur,
    ...patch,
    sceneId,
    interestIds: [...new Set(patch.interestIds ?? cur.interestIds)].filter((x) => known.has(x)),
  };
  const others = src.scenes.filter((r) => r.sceneId !== sceneId);
  const idx = src.scenes.findIndex((r) => r.sceneId === sceneId);
  let scenes: BriefingSceneRule[];
  if (isEmptyRule(next)) scenes = others;
  else if (idx < 0) scenes = [...src.scenes, next];
  else scenes = src.scenes.map((r) => (r.sceneId === sceneId ? next : r));
  return { ...c, sources: c.sources.map((s) => (s.projectId === projectId ? { ...s, scenes } : s)) };
}

/** その場面にその興味の項目を付ける・外す。 */
export function toggleSceneInterest(c: BriefingCatalog, projectId: string, sceneId: string, interestId: string): BriefingCatalog {
  const cur = sceneRuleOf(c, projectId, sceneId);
  const has = cur.interestIds.includes(interestId);
  return updateSceneRule(c, projectId, sceneId, {
    interestIds: has ? cur.interestIds.filter((x) => x !== interestId) : [...cur.interestIds, interestId],
  });
}

// ── 最後の場面・番号 ──────────────────────────────────────

/** 最後の場面の文（空なら変えない）。 */
export function setClosingText(c: BriefingCatalog, text: string): BriefingCatalog {
  const t = text.trim().slice(0, BRIEFING_CLOSING_TEXT_MAX);
  if (!t) return c;
  return { ...c, closing: { ...c.closing, text: t } };
}

export function setClosingUseBrandLogo(c: BriefingCatalog, useBrandLogo: boolean): BriefingCatalog {
  return { ...c, closing: { ...c.closing, useBrandLogo } };
}

/** 抜ける番号（4 桁の数字でなければ変えない）。 */
export function setExitCode(c: BriefingCatalog, code: string): BriefingCatalog {
  return isBriefingExitCode(code) ? { ...c, exitCode: code } : c;
}

// ── 指す先の確かめ ────────────────────────────────────────

/** 登録の画面で知らせる食い違い（ADR-0061 決定2＝黙って飛ばさない）。 */
export type BriefingCatalogProblem =
  | { kind: 'projectMissing'; projectId: string }
  | { kind: 'projectNotScene'; projectId: string }
  | { kind: 'sceneMissing'; projectId: string; sceneId: string };

/** 指している動画の今の様子（一覧から作る）。`sceneIds` が null＝まだ読んでいない（場面は確かめない）。 */
export interface BriefingProjectState {
  projectId: string;
  isSceneFormat: boolean;
  sceneIds: readonly string[] | null;
}

/** 登録が指している動画・場面が今もあるか。 */
export function briefingCatalogProblems(c: BriefingCatalog, projects: readonly BriefingProjectState[]): BriefingCatalogProblem[] {
  const out: BriefingCatalogProblem[] = [];
  for (const s of c.sources) {
    const p = projects.find((x) => x.projectId === s.projectId);
    if (!p) {
      out.push({ kind: 'projectMissing', projectId: s.projectId });
      continue;
    }
    if (!p.isSceneFormat) {
      out.push({ kind: 'projectNotScene', projectId: s.projectId });
      continue;
    }
    if (!p.sceneIds) continue;
    const have = new Set(p.sceneIds);
    for (const r of s.scenes) if (!have.has(r.sceneId)) out.push({ kind: 'sceneMissing', projectId: s.projectId, sceneId: r.sceneId });
  }
  return out;
}

/**
 * 動画から消えた場面の登録を外す（登録の画面の「消えた場面の登録を外す」）。
 * ⚠️ **今ある場面の一覧を渡されたときだけ**＝読めていない動画の登録を消さない（読めなかった≠場面が無い）。
 */
export function pruneMissingScenes(c: BriefingCatalog, projectId: string, sceneIds: readonly string[]): BriefingCatalog {
  const have = new Set(sceneIds);
  return {
    ...c,
    sources: c.sources.map((s) => (s.projectId === projectId ? { ...s, scenes: s.scenes.filter((r) => have.has(r.sceneId)) } : s)),
  };
}
