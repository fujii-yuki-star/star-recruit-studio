// 同梱の AI が返した動画案（検証済みの ai-video-plan）を、**ソフトが機械的に決められること**で整える（ADR-0052 段階1・#1291）。
// 正典は 12_AI_PROMPT_AND_MAPPING.md §8.7。AI は中身（流れ・語り・場面の種類）を決め、ここでは次を**必ず**守らせる：
//   1. 固有名詞＝会社名・採用ページは入力の文字列をそのまま差し込む（AI に書き写させない）
//   2. 見た目＝同じ種類（category）の中で選び直す（同じ見た目の連続を避ける・差し込み口の数・文字数の上限）
//   3. 文字数の上限越え＝その文だけ AI に短く言い直させる（言い直しは呼び出し側から注入＝ここは副作用を持たない）
//   4. 尺＝語りの文字数と読み上げの速さから計算し、目標の尺に配分する（11 §4 の範囲の中で）
// ⚠️ **ai-video-plan の形は変えない**＝入出力とも同じ型。呼び出し側は整えた後にもう一度正典の検証を通す（§2-2）。
// ⚠️ **場面を足さない・消さない・種類を変えない**＝話の流れは AI の判断（ADR-0052 決定1）。
import {
  AI_SCENE_MAX_DURATION_SEC,
  AI_SCENE_MIN_DURATION_SEC,
  MAX_NARRATION_LEN_DEFAULT,
  MAX_SUBTITLE_LEN_DEFAULT,
  NARRATION_CHARS_PER_SEC,
  NARRATION_SCENE_PADDING_SEC,
  SEC_STEP,
  quantizeSec,
} from '../constants';
import type { TemplateSummary } from './aiProvider';
import type { AiScene, AiVideoPlan } from './types';

/** 指示文で AI に書かせる**差し込みの印**（12 §8.7）。ソフトが入力の文字列に置き換える。 */
export const COMPANY_NAME_PLACEHOLDER = '{会社名}';
export const RECRUIT_URL_PLACEHOLDER = '{採用ページ}';

/**
 * 会社の種類を表す語（前にも後ろにも付く）。**崩れた会社名**（「株式会社サンプル物流」→「株式会社サンプル」）を
 * 見つける手がかりにする＝この語に続く（または先立つ）名前の途中で切れていれば崩れとみなす。
 * 長いものを先に置く（「一般社団法人」を「社団法人」より先に当てる）。
 */
const LEGAL_ENTITY_FORMS: readonly string[] = [
  '特定非営利活動法人', '一般社団法人', '一般財団法人', '公益社団法人', '公益財団法人',
  '株式会社', '有限会社', '合同会社', '合資会社', '合名会社', 'NPO法人',
];

/** 崩れとみなす最短の一致（名前の本体の先頭から何字が合っていれば崩れとみなすか）。1字だと偶然の一致を拾う。 */
const MIN_TRUNCATED_CORE = 2;

/** 入力にある固有名詞（採用のときだけ。一般は会社情報を使わない＝12 §6b）。 */
export interface ProperNouns {
  companyName?: string;
  recruitUrl?: string;
}

export interface RefineContext {
  /** AI に渡したのと同じ見た目の要約（向き・マイ見た目の除外は済み＝`buildTemplateSummaries`）。 */
  templates: TemplateSummary[];
  /** 利用者が決めた目標の尺（秒）。AI が書き換えた `videoPlan.targetDurationSec` ではなく入力の値を使う。 */
  targetDurationSec: number;
  properNouns: ProperNouns;
}

/**
 * 1文を `maxLength` 字以内に短く言い直す（同梱の AI を呼ぶ・呼び出し側が用意する）。
 * できなければ `null`。⚠️ 返った文の長さはこちらで確かめ直す（縛って出したことを成功の証明にしない）。
 */
export type ShortenText = (text: string, maxLength: number) => Promise<string | null>;

/** 整えた内容の記録（点数化とログ用）。 */
export interface RefineReport {
  /** 差し込みの印を置き換えた・崩れた会社名を直した・URL を入力に合わせた数。 */
  properNounFixes: number;
  /** 見た目を選び直した場面の数。 */
  templateChanges: number;
  /** 言い直して上限に収めた文の数。 */
  shortened: number;
  /** 言い直しても上限に収まらなかった文の数（越えたまま残る＝変換の長さの助言が出る）。 */
  shortenFailed: number;
}

export interface RefineResult {
  plan: AiVideoPlan;
  report: RefineReport;
}

// ---------------------------------------------------------------------------------------------
// 共通：plan の文字の欄を1つの関数で書き換える
// ---------------------------------------------------------------------------------------------

/** 場面の画面・語りの文字をすべて `fn` で写した新しい場面（元は壊さない）。 */
function mapSceneStrings(scene: AiScene, fn: (s: string) => string): AiScene {
  const texts: AiScene['texts'] = {};
  for (const [k, v] of Object.entries(scene.texts) as [keyof AiScene['texts'], string | undefined][]) {
    if (v !== undefined) texts[k] = fn(v);
  }
  return {
    ...scene,
    ...(scene.sceneTitle !== undefined ? { sceneTitle: fn(scene.sceneTitle) } : {}),
    texts,
    ...(typeof scene.narrationText === 'string' ? { narrationText: fn(scene.narrationText) } : {}),
    ...(scene.narrationLines
      ? {
          narrationLines: scene.narrationLines.map((l) => ({
            ...l,
            text: fn(l.text),
            ...(l.subtitle !== undefined ? { subtitle: fn(l.subtitle) } : {}),
          })),
        }
      : {}),
  };
}

/** plan の文字の欄（題名・パート名・要約・場面の文字・語り・確認の一文）をすべて `fn` で写す。 */
function mapPlanStrings(plan: AiVideoPlan, fn: (s: string) => string): AiVideoPlan {
  return {
    ...plan,
    videoPlan: { ...plan.videoPlan, title: fn(plan.videoPlan.title) },
    parts: plan.parts.map((p) => ({
      ...p,
      partTitle: fn(p.partTitle),
      ...(p.summary !== undefined ? { summary: fn(p.summary) } : {}),
      scenes: p.scenes.map((s) => mapSceneStrings(s, fn)),
    })),
    ...(plan.reviewNotes ? { reviewNotes: plan.reviewNotes.map(fn) } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// 1. 固有名詞
// ---------------------------------------------------------------------------------------------

/** 名前の続きになりうる字（漢字・カタカナ・英数字・長音）。これに続く一致は**別の名前**かもしれないので直さない。 */
function isNameChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{Script=Han}\p{Script=Katakana}A-Za-z0-9ー]/u.test(ch);
}

/** 会社名を「種類の語」と「本体」に分ける。種類の語が無い・本体が短すぎるなら null（崩れを判定しない）。 */
function splitLegalForm(name: string): { form: string; core: string; prefixed: boolean } | null {
  for (const form of LEGAL_ENTITY_FORMS) {
    if (name.startsWith(form) && name.length - form.length >= MIN_TRUNCATED_CORE) {
      return { form, core: name.slice(form.length), prefixed: true };
    }
    if (name.endsWith(form) && name.length - form.length >= MIN_TRUNCATED_CORE) {
      return { form, core: name.slice(0, name.length - form.length), prefixed: false };
    }
  }
  return null;
}

/** 完全な会社名を含まない区間の中の崩れた会社名を直す。直した数も返す。 */
function repairSegment(seg: string, name: string, parts: { form: string; core: string; prefixed: boolean }): [string, number] {
  const { form, core, prefixed } = parts;
  let out = '';
  let fixes = 0;
  let i = 0;
  while (i < seg.length) {
    const at = seg.indexOf(form, i);
    if (at < 0) break;
    if (prefixed) {
      // 「株式会社」＋本体の先頭 k 字で切れている（k は本体の長さ未満＝完全な名前は区間に無い）。
      const rest = seg.slice(at + form.length);
      let k = 0;
      while (k < core.length && rest[k] === core[k]) k++;
      if (k >= MIN_TRUNCATED_CORE && !isNameChar(rest[k])) {
        out += seg.slice(i, at) + name;
        i = at + form.length + k;
        fixes++;
        continue;
      }
    } else {
      // 本体の先頭 k 字＋「株式会社」（後ろに付く形）。長い一致から探す。
      for (let k = core.length - 1; k >= MIN_TRUNCATED_CORE; k--) {
        const start = at - k;
        if (start < i) continue;
        if (seg.slice(start, at) === core.slice(0, k) && !isNameChar(seg[start - 1])) {
          out += seg.slice(i, start) + name;
          i = at + form.length;
          fixes++;
          break;
        }
      }
      if (i > at) continue;
    }
    out += seg.slice(i, at + form.length);
    i = at + form.length;
  }
  return [out + seg.slice(i), fixes];
}

/**
 * 崩れた会社名（本体の途中で切れたもの）を入力の会社名に直す。完全な会社名はそのまま。
 * 例：会社名「株式会社サンプル物流」で「株式会社サンプルの魅力」→「株式会社サンプル物流の魅力」。
 * ⚠️ 続きが名前になりうる字（「株式会社サンプル物産」の「産」）なら**別の会社**かもしれないので直さない。
 * ⚠️ 種類の語（株式会社など）が無い会社名は崩れを判定できない＝差し込みの印だけで守る。
 */
export function repairTruncatedName(text: string, name: string): { text: string; fixes: number } {
  const parts = splitLegalForm(name);
  if (!parts) return { text, fixes: 0 };
  let fixes = 0;
  const repaired = text
    .split(name)
    .map((seg) => {
      const [out, n] = repairSegment(seg, name, parts);
      fixes += n;
      return out;
    })
    .join(name);
  return { text: repaired, fixes };
}

/** 全角の括弧・二重括弧・内側の空白の揺れも拾う差し込みの印の正規表現。 */
function placeholderPattern(placeholder: string): RegExp {
  const label = placeholder.replace(/^\{|\}$/g, '');
  return new RegExp(`[{｛]+\\s*${label}\\s*[}｝]+`, 'g');
}

/**
 * 固有名詞を入力の文字列に揃える（ADR-0052 決定2）：
 * ①差し込みの印（{会社名}・{採用ページ}）を入力の値へ ②崩れた会社名を直す ③画面の URL（`texts.url`）を採用ページへ。
 * 入力に値が無い印は空にする（印のまま画面に出さない）。
 */
export function insertProperNouns(plan: AiVideoPlan, nouns: ProperNouns): { plan: AiVideoPlan; fixes: number } {
  const name = nouns.companyName?.trim() ?? '';
  const url = nouns.recruitUrl?.trim() ?? '';
  const namePattern = placeholderPattern(COMPANY_NAME_PLACEHOLDER);
  const urlPattern = placeholderPattern(RECRUIT_URL_PLACEHOLDER);
  let fixes = 0;
  const replaced = mapPlanStrings(plan, (s) => {
    let out = s.replace(namePattern, () => { fixes++; return name; });
    out = out.replace(urlPattern, () => { fixes++; return url; });
    if (name) {
      const r = repairTruncatedName(out, name);
      fixes += r.fixes;
      out = r.text;
    }
    return out;
  });
  if (!url) return { plan: replaced, fixes };
  // 画面の URL は入力の採用ページだけが正しい（AI が書き写すと1字ずれても気づけない）。
  const parts = replaced.parts.map((p) => ({
    ...p,
    scenes: p.scenes.map((s) => {
      if (!s.texts.url || s.texts.url === url) return s;
      fixes++;
      return { ...s, texts: { ...s.texts, url } };
    }),
  }));
  return { plan: { ...replaced, parts }, fixes };
}

// ---------------------------------------------------------------------------------------------
// 2. 見た目の選び直し
// ---------------------------------------------------------------------------------------------

/** 場面が差し込み口（slot）へ当てた素材の数。背景・ロゴなど slot 以外の鍵は数えない（選び直しで動かさない）。 */
function assignedSlotRefs(scene: AiScene, current: TemplateSummary): [string, string][] {
  const slots = new Set(current.requiredSlots ?? []);
  return Object.entries(scene.assetRefs ?? {}).filter(
    (e): e is [string, string] => typeof e[1] === 'string' && slots.has(e[0]),
  );
}

/** 場面の語りの本体（掛け合いなら各行・そうでなければ単一）。 */
function narrationTexts(scene: AiScene): string[] {
  if (scene.narrationLines && scene.narrationLines.length > 0) return scene.narrationLines.map((l) => l.text);
  return [scene.narrationText ?? ''];
}

/**
 * 見た目の候補の点（小さいほど良い・12 §8.7）。**中身を消す方向がいちばん重い**＝見た目の変化より中身を守る。
 * ⚠️ 字幕の上限は見ない＝同じ種類の中で字幕の上限はほぼ同じで、越えた字幕は言い直しで収める（語りは声まで変わるので見た目で避ける）。
 */
const LOOK_COST = {
  /** 表情の指定があるのにゆうこのいない見た目（立ち絵が黙って消える＝変換の `resolveCharacter` は警告しない）。 */
  dropsYuko: 1000,
  /** 直前の場面と同じ見た目（連続を避ける＝ADR-0052 決定2）。 */
  repeat: 100,
  /** 語りが上限を越える（言い直しが要る）。 */
  narrationOver: 10,
  /** 表情の指定が無いのにゆうこのいる見た目（立ち絵は出ないので中身は失わない）。 */
  unusedYuko: 3,
  /**
   * AI が選んだものと違う（他の条件が同じなら AI の選択を残す）。ほかの点はどれも 3 以上で1つずつしか付かない
   * ＝この 1 点で AI の選択と同点になる組は無い（同点になるのは AI の選択でない候補どうし＝並び順で先のもの）。
   */
  notOriginal: 1,
} as const;

function templateCost(
  c: TemplateSummary, scene: AiScene, prevTemplateId: string | undefined, original: string,
): number {
  let cost = 0;
  if (c.templateId === prevTemplateId) cost += LOOK_COST.repeat;
  const max = c.maxNarrationLength ?? MAX_NARRATION_LEN_DEFAULT;
  if (narrationTexts(scene).some((t) => t.length > max)) cost += LOOK_COST.narrationOver;
  const wantsYuko = scene.yukoPoseTag != null;
  if (wantsYuko && !c.hasYuko) cost += LOOK_COST.dropsYuko;
  if (!wantsYuko && c.hasYuko) cost += LOOK_COST.unusedYuko;
  if (c.templateId !== original) cost += LOOK_COST.notOriginal;
  return cost;
}

/** 選び直した見た目の差し込み口へ、元の割り当てを順に移す（同じ id の口はそのまま）。 */
function remapAssetRefs(
  scene: AiScene, assigned: [string, string][], next: TemplateSummary,
): AiScene['assetRefs'] {
  const nextSlots = next.requiredSlots ?? [];
  const refs: Record<string, string | null> = {};
  // slot 以外の鍵（背景・ロゴ・null）はそのまま残す。
  const assignedKeys = new Set(assigned.map(([k]) => k));
  for (const [k, v] of Object.entries(scene.assetRefs ?? {})) if (!assignedKeys.has(k)) refs[k] = v;
  const pending: string[] = [];
  for (const [k, v] of assigned) {
    if (nextSlots.includes(k)) refs[k] = v;
    else pending.push(v);
  }
  for (const slot of nextSlots) {
    if (pending.length === 0) break;
    if (typeof refs[slot] !== 'string') refs[slot] = pending.shift() as string;
  }
  return Object.keys(refs).length > 0 ? refs : undefined;
}

/**
 * 同じ種類（category）の中で見た目を選び直す（ADR-0052 決定2）。場面の種類は変えない（AI の判断）。
 * 候補は**当てた素材が全部入る**（差し込み口の数が足りる）ものだけ＝選び直しで写真を落とさない。
 * ⚠️ **AI の templateId が一覧に無い・種類と合わない場面は選び直さない**（変換の補正と警告に任せる＝§8.2）。
 * どの鍵が差し込み口か分からないので、ここで移すと写真が新しい見た目に無い鍵に残ったまま**警告も出ない**
 * （変換の「見た目が見つからない」が消える＝ADR-0026④）。連続の判定では直前の見た目として数える。
 */
export function reselectTemplates(plan: AiVideoPlan, templates: TemplateSummary[]): { plan: AiVideoPlan; changes: number } {
  const byId = new Map(templates.map((t) => [t.templateId, t] as const));
  let prev: string | undefined;
  let changes = 0;
  const parts = plan.parts.map((p) => ({
    ...p,
    scenes: p.scenes.map((scene) => {
      const found = byId.get(scene.templateId);
      if (!found || found.category !== scene.sceneType) {
        prev = scene.templateId;
        return scene;
      }
      const assigned = assignedSlotRefs(scene, found);
      const candidates = templates.filter(
        (t) => t.category === scene.sceneType && (t.requiredSlots ?? []).length >= assigned.length,
      );
      if (candidates.length === 0) {
        prev = scene.templateId;
        return scene;
      }
      const cost = (t: TemplateSummary) => templateCost(t, scene, prev, scene.templateId);
      const best = candidates.reduce((a, b) => (cost(b) < cost(a) ? b : a));
      prev = best.templateId;
      if (best.templateId === scene.templateId) return scene;
      changes++;
      const next: AiScene = { ...scene, templateId: best.templateId };
      const assetRefs = remapAssetRefs(scene, assigned, best);
      if (assetRefs) next.assetRefs = assetRefs;
      else delete next.assetRefs;
      return next;
    }),
  }));
  return { plan: { ...plan, parts }, changes };
}

// ---------------------------------------------------------------------------------------------
// 3. 文字数の上限越え
// ---------------------------------------------------------------------------------------------

/** 上限を越えた文の場所。`lineSubtitle` は字幕を省いた行（字幕に語りがそのまま出る）に字幕を付ける。 */
export type TextLocation =
  | { kind: 'narration' }
  | { kind: 'subtitle' }
  | { kind: 'line'; lineIndex: number }
  | { kind: 'lineSubtitle'; lineIndex: number };

export interface OverlongText {
  partIndex: number;
  sceneIndex: number;
  location: TextLocation;
  /** 短くする元の文。 */
  text: string;
  maxLength: number;
}

/**
 * 見た目の上限を越えた文を洗い出す。見る対象と上限の継承は変換の長さの助言（`transformPlan.checkLengths`）と同じ
 * ＝ここで収めたものは変換で「長すぎる」と言われない。
 */
export function findOverlongTexts(plan: AiVideoPlan, templates: TemplateSummary[]): OverlongText[] {
  const byId = new Map(templates.map((t) => [t.templateId, t] as const));
  const out: OverlongText[] = [];
  plan.parts.forEach((p, partIndex) => p.scenes.forEach((s, sceneIndex) => {
    const t = byId.get(s.templateId);
    const maxNarration = t?.maxNarrationLength ?? MAX_NARRATION_LEN_DEFAULT;
    const maxSubtitle = t?.maxSubtitleLength ?? MAX_SUBTITLE_LEN_DEFAULT;
    const push = (location: TextLocation, text: string, maxLength: number) => {
      if (text.length > maxLength) out.push({ partIndex, sceneIndex, location, text, maxLength });
    };
    const lines = s.narrationLines ?? [];
    if (lines.length > 0) {
      lines.forEach((l, lineIndex) => {
        push({ kind: 'line', lineIndex }, l.text, maxNarration);
        // 字幕を省いた行は語りがそのまま字幕に出る（`transformPlan.checkLengths` と同じ `subtitle ?? text`）
        // ＝語りは上限内でも字幕の上限を越えうる。語りを縮めると声まで変わるので、**字幕だけ**を付ける。
        push({ kind: 'lineSubtitle', lineIndex }, l.subtitle ?? l.text, maxSubtitle);
      });
    } else {
      push({ kind: 'narration' }, s.narrationText ?? '', maxNarration);
    }
    if (s.texts.subtitle !== undefined) push({ kind: 'subtitle' }, s.texts.subtitle, maxSubtitle);
  }));
  return out;
}

/** 1つの文を差し替えた新しい plan（元は壊さない）。 */
export function setTextAt(plan: AiVideoPlan, at: Omit<OverlongText, 'text' | 'maxLength'>, text: string): AiVideoPlan {
  const parts = plan.parts.map((p, pi) => pi !== at.partIndex ? p : {
    ...p,
    scenes: p.scenes.map((s, si) => {
      if (si !== at.sceneIndex) return s;
      const loc = at.location;
      switch (loc.kind) {
        case 'narration': return { ...s, narrationText: text };
        case 'subtitle': return { ...s, texts: { ...s.texts, subtitle: text } };
        case 'line':
        case 'lineSubtitle':
          return {
            ...s,
            narrationLines: (s.narrationLines ?? []).map((l, li) => li !== loc.lineIndex ? l
              : loc.kind === 'line' ? { ...l, text } : { ...l, subtitle: text }),
          };
      }
    }),
  });
  return { ...plan, parts };
}

/**
 * 1文を言い直して上限に収める。会社名は印に置き換えてから渡し（言い直しで崩させない）、戻ってから差し込む。
 * 収まらなければ null（元の文を残す＝変換の長さの助言が出る）。
 */
async function shortenOne(item: OverlongText, name: string, shorten: ShortenText): Promise<string | null> {
  const count = name ? item.text.split(name).length - 1 : 0;
  const guarded = count > 0 ? item.text.split(name).join(COMPANY_NAME_PLACEHOLDER) : item.text;
  // 印を名前へ戻すと伸びる分だけ、AI には短めの上限を渡す。
  const budget = item.maxLength - count * (name.length - COMPANY_NAME_PLACEHOLDER.length);
  if (budget < 1) return null;
  const raw = await shorten(guarded, budget);
  if (raw == null) return null;
  let out = raw.trim().replace(placeholderPattern(COMPANY_NAME_PLACEHOLDER), name);
  if (name) out = repairTruncatedName(out, name).text;
  return out.length > 0 && out.length <= item.maxLength ? out : null;
}

// ---------------------------------------------------------------------------------------------
// 4. 尺の配分
// ---------------------------------------------------------------------------------------------

/** 語りを読み上げるのに要る秒数（前後の間を含む）。掛け合いの行は順に読む（ai-video-plan に同時開始は無い）。 */
export function speechSec(scene: AiScene): number {
  const chars = narrationTexts(scene).reduce((n, t) => n + t.length, 0);
  return chars / NARRATION_CHARS_PER_SEC + NARRATION_SCENE_PADDING_SEC;
}

/**
 * 秒を格子（`SEC_STEP`）へ切り上げる（語りを読み切る長さを削らない側へ）。浮動小数の尾（2.9999…）で1目盛り
 * 余計に上がらないよう先に丸める。
 */
function ceilToStep(sec: number): number {
  return Math.ceil(Math.round(sec / SEC_STEP * 1e6) / 1e6) * SEC_STEP;
}

/**
 * 場面の尺を語りから計算して目標の尺に配分する（ADR-0052 決定2）。
 * - 各場面の下限＝語りを読み切る長さ（`AI_SCENE_MIN_DURATION_SEC` 以上）。上限＝見た目の `maxDurationSec`（無ければ
 *   `AI_SCENE_MAX_DURATION_SEC`）。**上限が下限より優先**（`transformPlan.clampDuration` と同じ・#607）。
 * - 下限の合計が目標に足りなければ、余りを **AI が付けた尺の比**で上限まで配る（映像を長く見せたい場面の意図を残す）。
 * - 下限の合計が目標を越えるなら下限のまま（語りを切らない＝尺を越える。点数で見る）。
 */
export function allocateDurations(plan: AiVideoPlan, templates: TemplateSummary[], targetSec: number): AiVideoPlan {
  const byId = new Map(templates.map((t) => [t.templateId, t] as const));
  const flat = plan.parts.flatMap((p) => p.scenes);
  const hi = flat.map((s) => byId.get(s.templateId)?.maxDurationSec ?? AI_SCENE_MAX_DURATION_SEC);
  const lo = flat.map((s, i) => Math.min(hi[i], Math.max(AI_SCENE_MIN_DURATION_SEC, ceilToStep(speechSec(s)))));
  const d = [...lo];
  let extra = targetSec - lo.reduce((a, b) => a + b, 0);
  // 水を注ぐように配る：上限に達した場面を外しながら、残りを比で分ける（場面数ぶん回せば必ず終わる）。
  for (let round = 0; round < flat.length && extra > 1e-9; round++) {
    const open = flat.map((_, i) => i).filter((i) => d[i] < hi[i]);
    const weight = open.reduce((n, i) => n + flat[i].durationSec, 0);
    if (open.length === 0 || weight <= 0) break;
    let used = 0;
    for (const i of open) {
      const add = Math.min(hi[i] - d[i], extra * flat[i].durationSec / weight);
      d[i] += add;
      used += add;
    }
    extra -= used;
  }
  let k = 0;
  const parts = plan.parts.map((p) => ({
    ...p,
    scenes: p.scenes.map((s) => {
      const i = k++;
      // 格子へ丸める（`quantizeSec`＝浮動小数の尾も消える）。下限は切り上げ済み＝格子に乗るので、d ≥ 下限なら
      // 丸めても下限を下回らない（下限で押さえる必要が無い）。⚠️ 上限は格子に乗るとは限らない（7.25 秒など）
      // ＝丸めた後に上限で押さえる（丸めで 7.3 にして上限を破らない）。
      return { ...s, durationSec: Math.min(hi[i], quantizeSec(d[i])) };
    }),
  }));
  return { ...plan, parts };
}

// ---------------------------------------------------------------------------------------------
// まとめ
// ---------------------------------------------------------------------------------------------

/**
 * 同梱の AI の動画案を整える（ADR-0052 段階1）。順番に意味がある：
 * 固有名詞（長さが変わる）→ 見た目（上限が決まる）→ 言い直し（語りが決まる）→ 尺（語りから計算）。
 * `shorten` を渡さないと言い直しはせず、越えた文は数えるだけ。
 */
export async function refineVideoPlan(
  plan: AiVideoPlan, ctx: RefineContext, shorten?: ShortenText,
): Promise<RefineResult> {
  const report: RefineReport = { properNounFixes: 0, templateChanges: 0, shortened: 0, shortenFailed: 0 };
  const nouns = insertProperNouns(plan, ctx.properNouns);
  report.properNounFixes = nouns.fixes;
  const looks = reselectTemplates(nouns.plan, ctx.templates);
  report.templateChanges = looks.changes;
  let current = looks.plan;
  const name = ctx.properNouns.companyName?.trim() ?? '';
  for (const item of findOverlongTexts(current, ctx.templates)) {
    const shortened = shorten ? await shortenOne(item, name, shorten) : null;
    if (shortened == null) {
      report.shortenFailed++;
      continue;
    }
    current = setTextAt(current, item, shortened);
    report.shortened++;
  }
  return { plan: allocateDurations(current, ctx.templates, ctx.targetDurationSec), report };
}
