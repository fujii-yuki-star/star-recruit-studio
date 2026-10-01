// 役割を分けた動画案づくりの試作（ADR-0052 の見直し・利用者の提案 2026-10-01）。
// 構成作家（AI・箇条書き）→ 台本係（AI・場面ごとの文・口調のお手本つき・小さい形で縛る）→ 組み立て（ソフト）。
// 組み立てた案は、今のアプリと同じ道（正典の検証 → 整える段 → 変換と割り当て）を通し、同じ物差しで点数にする。
//
// 使い方: llama-server を起動しておき（-c 8192）、
//   npx tsx scripts/local-llm/eval-pipeline.ts http://127.0.0.1:18081 <出力フォルダ> [口調]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import aiVideoPlanSchema from '../../docs/yuko_recruit_docs/schemas/ai-video-plan.schema.json';
import type { GenerateVideoPlanInput, TemplateSummary } from '../../src/domain/ai/aiProvider';
import { COMPANY_NAME_PLACEHOLDER, refineVideoPlan } from '../../src/domain/ai/refineVideoPlan';
import type { ShortenText } from '../../src/domain/ai/refineVideoPlan';
import { sanitizeAiVideoPlan } from '../../src/domain/ai/sanitizeVideoPlan';
import { buildShortenMessages, parseShortenResponse } from '../../src/domain/ai/shortenTextRequest';
import { transformVideoPlan } from '../../src/domain/ai/transformPlan';
import type { AiScene, AiVideoPlan } from '../../src/domain/ai/types';
import { buildTemplateSummaries, templatesForAssets } from '../../src/domain/ai/videoPlanInput';
import { TONE_PRESETS } from '../../src/domain/constants';
import type { SceneCategory } from '../../src/domain/enums';
import type { Asset } from '../../src/domain/project/types';
import { sampleAssets, sampleTemplates } from '../../src/infrastructure/sampleData';
import { scorePlan, scoreScenes } from './planScore';

const base = process.argv[2] ?? 'http://127.0.0.1:18081';
const outDir = process.argv[3] ?? 'eval-pipeline';
const toneArg = process.argv[4];
mkdirSync(outDir, { recursive: true });

// ── 口調のお手本（ここが「最小の教育」の代わり＝言い回しを例で見せる）──────────────────────
const TONE_EXAMPLES: Record<string, string[]> = {
  // ⚠️ **全文のお手本は置かない**＝2B は書き写した（v4 の実測）。特徴と語尾の例だけ。
  '親しみやすい': ['話しかけるような、やわらかい「です・ます」', '語尾の例：「〜ですよ」「〜してみませんか」「〜なんです」', '堅い言葉（〜いたします・当社）は使わない'],
  '丁寧・落ち着いた': ['落ち着いた、ていねいな「です・ます」', '語尾の例：「〜しております」「〜いただけます」「〜です」', '感嘆符（！）は使わない'],
  'フォーマル': ['説明会のような、きちんとした言い方', '語尾の例：「〜いたします」「〜となります」「〜でございます」', '会社は「当社」と言う・くだけた言葉は使わない'],
  '明るい・元気': ['元気で弾むような話し言葉（です・ます を使わなくてよい）', '語尾の例：「〜だよ！」「〜しようね！」「〜なんだ！」', '感嘆符（！）を多めに使う'],
};

/** 場面の種類の呼び名（構成作家には ID ではなく言葉で見せる）。 */
const KIND_LABEL: Record<SceneCategory, string> = {
  opening: 'オープニング（あいさつ・つかみ）',
  photo_intro: '写真で紹介（写真1枚＋説明）',
  video_intro: '動画で紹介（動画1本＋説明）',
  point_list: '要点を並べる（箇条書き）',
  message: 'メッセージ（言葉を大きく見せる）',
  full_visual: '写真を全面に（雰囲気を見せる）',
  chapter: '章の区切り（短い見出し）',
  no_yuko: 'ゆうこ無しで写真を見せる',
  closing: '締め（呼びかけ・案内）',
  free: '自由配置',
};

async function chat(system: string, user: string, schema?: unknown, maxTokens = 3072): Promise<{ content: string; ms: number; tokens?: number }> {
  const t0 = Date.now();
  const body: Record<string, unknown> = {
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    chat_template_kwargs: { enable_thinking: false },
    temperature: 0.3,
    max_tokens: maxTokens,
  };
  if (schema) body.response_format = { type: 'json_schema', json_schema: { name: 'out', schema } };
  const r = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = (await r.json()) as { choices?: { message?: { content?: string } }[]; timings?: { predicted_n?: number } };
  return { content: j.choices?.[0]?.message?.content ?? '', ms: Date.now() - t0, tokens: j.timings?.predicted_n };
}

/** 入力の事実（会社情報／発表内容）を箇条書きにする（両方の段で同じものを見せる）。 */
function facts(input: GenerateVideoPlanInput): string {
  const c = input.companyInfo;
  const g = input.generalBrief;
  if (input.videoKind === 'general' && g) {
    return [`テーマ: ${g.title}`, `章立て: ${(g.agenda ?? []).join(' / ')}`, `伝えたい要点: ${(g.keyPoints ?? []).join(' / ')}`, `対象: ${g.targetAudience ?? '社員'}`].join('\n');
  }
  return [
    `会社名: ${c?.companyName}`, `業種: ${c?.industry}`, `事業内容: ${c?.businessDescription}`,
    `募集職種: ${c?.jobType}`, `採用対象: ${c?.recruitTarget}`, `強み: ${(c?.strengths ?? []).join(' / ')}`,
    `求める人物像: ${c?.desiredPerson}`,
  ].join('\n');
}

function photoList(assets: readonly Asset[]): string {
  const v = assets.filter((a) => a.assetType === 'image' || a.assetType === 'video');
  if (v.length === 0) return '（写真・動画は無い）';
  return v.map((a) => `- ${a.assetType === 'video' ? '動画' : '写真'}: ${a.aiDescription ?? a.description ?? a.displayName}`).join('\n');
}

// ── 1段目：構成作家 ─────────────────────────────────────────────────────────────
function plannerMessages(input: GenerateVideoPlanInput, kinds: SceneCategory[]): { system: string; user: string } {
  const lo = Math.max(3, Math.round(input.targetDurationSec / 12));
  const hi = Math.max(lo + 1, Math.round(input.targetDurationSec / 7));
  const system = `あなたは${input.videoKind === 'general' ? '社内向け・一般向けの説明動画' : '採用・会社紹介動画'}の構成作家です。入力の事実だけを使って、視聴者の心に残る動画の流れを考えます。文章の仕上げや形式は後の係がやるので、あなたは中身（流れ・切り口・場面ごとに伝えること）だけに集中します。

【厳守事項】
- 入力に無い事実（数字・実績・制度）を作らない。
- 誰に向けて、何を感じてほしい動画かを最初に1行で決める。
- 場面は ${lo}〜${hi} 個（${input.targetDurationSec} 秒の動画）。導入 → 本題 → 締めの流れにする。同じ種類の場面を3つ以上続けない。
- 写真・動画があるときは、合うものを場面で見せる（無理に全部使わなくてよい）。写真・動画が無いときは、写真や動画を見せる場面を作らない。
- 出力は次の形の箇条書きだけ（説明を付けない）。`;
  const user = [
    '# 入力',
    facts(input),
    `動画の長さ: ${input.targetDurationSec} 秒`,
    '',
    '# 使える写真・動画',
    photoList(input.assets),
    '',
    '# 使える場面の種類',
    ...kinds.map((k) => `- ${KIND_LABEL[k]}`),
    '',
    '# 出力の形',
    'ねらい: <誰に・何を感じてほしいか>',
    'タイトル: <動画の題>',
    '## <パート名>',
    '- 種類: <上の場面の種類から1つ> ／ 伝えること: <1文> ／ 見せたいもの: <写真・動画の中身（無ければ「なし」）>',
  ].join('\n');
  return { system, user };
}

// ── 2段目：台本係は場面ごと。全場面を1回で書かせる版（v1/v2）は1場面に潰れたので消した（local-llm-build.md の表）。

/** 構成メモの1行（ソフトが読む）。 */
export interface OutlineScene {
  kind: SceneCategory;
  say: string;
  show: string;
  part: string;
}

/** 呼び名のゆれ（「写真紹介」「写真で紹介」）を吸って種類に戻す。どれでもなければ null。 */
function kindOf(label: string, kinds: SceneCategory[]): SceneCategory | null {
  const has = (k: SceneCategory) => kinds.includes(k);
  const rules: [RegExp, SceneCategory][] = [
    [/オープニング|あいさつ|つかみ/, 'opening'], [/締め|呼びかけ|案内/, 'closing'], [/章|区切り|見出し/, 'chapter'],
    [/全面/, 'full_visual'], [/動画/, 'video_intro'], [/ゆうこ無し/, 'no_yuko'], [/写真/, 'photo_intro'],
    [/要点|箇条/, 'point_list'], [/メッセージ|言葉/, 'message'],
  ];
  for (const [re, k] of rules) if (re.test(label) && has(k)) return k;
  return null;
}

/**
 * 構成メモ（箇条書き）を場面の並びに読む。⚠️ 種類の決まり（ソフト）：最初はオープニング・最後は締め（在れば）・
 * 読めない種類はメッセージへ・伝えることの無い場面は飛ばす。
 */
export function parseOutline(text: string, kinds: SceneCategory[]): { title: string; scenes: OutlineScene[] } {
  let part = '本編';
  let title = '';
  const scenes: OutlineScene[] = [];
  // ⚠️ 1行に1場面のこともあれば、1行に1項目のこともある（v3 の実測）＝項目を貯め、「種類」が来たら新しい場面にする。
  let cur: Record<string, string> | null = null;
  let curPart = part;
  const flush = () => {
    if (!cur) return;
    const say = cur['伝えること'] ?? '';
    if (say) {
      const kind = kindOf(cur['種類'] ?? '', kinds) ?? (kinds.includes('message') ? 'message' : kinds[0]);
      scenes.push({ kind, say, show: cur['見せたいもの'] ?? 'なし', part: curPart });
    }
    cur = null;
  };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const t = /^タイトル[:：]\s*(.+)$/.exec(line);
    if (t) { title = t[1].trim(); continue; }
    const h = /^#+\s*(.+)$/.exec(line);
    if (h) { part = h[1].trim(); continue; }
    if (!/^[-・*]/.test(line)) continue;
    for (const f of line.replace(/^[-・*]\s*/, '').split(/[／/|｜]/)) {
      const m = /^\s*([^:：]+)[:：]\s*(.*)$/.exec(f);
      if (!m) continue;
      const key = m[1].trim();
      if (key === '種類' || !cur) {
        if (key === '種類') flush();
        cur ??= {};
        curPart = part;
      }
      cur[key] = m[2].trim();
    }
  }
  flush();
  if (scenes.length > 0 && kinds.includes('opening')) scenes[0].kind = 'opening';
  if (scenes.length > 1 && kinds.includes('closing')) scenes[scenes.length - 1].kind = 'closing';
  return { title, scenes };
}

function sceneWriterSchema(): Record<string, unknown> {
  return {
    type: 'object', additionalProperties: false, required: ['title', 'narration', 'subtitle'],
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 20 },
      // 縛りで文の途中を切らない（長すぎは整える段の言い直しへ・v5 の実測）。
      narration: { type: 'string', minLength: 10, maxLength: 160 },
      subtitle: { type: 'string', minLength: 1, maxLength: 40 },
    },
  };
}

/** 場面1つぶんの台本係（小さい仕事を1つずつ＝場面の数が潰れない）。 */
function sceneWriterMessages(input: GenerateVideoPlanInput, sc: OutlineScene, idx: number, total: number, prev: string, tone: string): { system: string; user: string } {
  const examples = TONE_EXAMPLES[tone] ?? TONE_EXAMPLES[TONE_PRESETS[0]];
  const system = `あなたは動画の台本係です。動画の1つの場面について、マスコット「ゆうこ」が読み上げる語りと、画面の見出し・字幕を書きます。

【厳守事項】
- この場面で伝えることだけを書く（ほかの場面の内容を先取りしない）。書かれていない事実を足さない。会社名は文字で書き写さず ${COMPANY_NAME_PLACEHOLDER} と書く。
- 語りは読み上げて聞きやすい日本語で 40〜100 字。これまでの場面で伝えたことは繰り返さず、この場面の内容だけを話す。${idx === 0 ? 'これは最初の場面なので、あいさつから始める。' : '「こんにちは」などのあいさつはしない（最初の場面ではない）。'}${idx === total - 1 ? 'これは最後の場面なので、視聴者への呼びかけで締める。' : ''}
- 字幕は語りの要点を 25 字前後で。見出しは 10 字前後。
- 口調は「${tone}」：
${examples.map((e) => `  ・${e}`).join('\n')}`;
  const user = [
    // ⚠️ 事実の一覧は渡さない（v6＝全部を渡すと、どの場面でも強み・要点を全部言い直した＝採点係の一番の指摘）。
    //   この場面の「伝えること」と、呼び名（会社名／テーマ）だけ。
    '# 呼び名', input.videoKind === 'general' ? `テーマ: ${input.generalBrief?.title ?? ''}` : `会社名: ${COMPANY_NAME_PLACEHOLDER}`, '',
    `# この場面（${idx + 1} / ${total}・${KIND_LABEL[sc.kind]}）`, `伝えること: ${sc.say}`, `見せたいもの: ${sc.show}`, '',
    '# これまでの場面で伝えたこと（繰り返さない）', prev || '（なし＝最初の場面）',
  ].join('\n');
  return { system, user };
}

interface Draft {
  title: string;
  parts: { partTitle: string; scenes: { kind: string; title: string; narration: string; subtitle: string; show: string; pose: string }[] }[];
}

/** 3段目：ソフトの組み立て（下書き → ai-video-plan）。見た目・尺・写真は後の整える段と変換が決める。 */
function assemble(d: Draft, input: GenerateVideoPlanInput, templates: TemplateSummary[], poses: string[]): AiVideoPlan {
  return {
    schemaVersion: '1.0',
    videoPlan: { title: d.title, purpose: input.purpose, targetDurationSec: input.targetDurationSec },
    parts: d.parts.map((p) => ({
      partTitle: p.partTitle,
      scenes: p.scenes.map((s): AiScene => {
        const kind = (Object.keys(KIND_LABEL) as SceneCategory[]).find((k) => KIND_LABEL[k] === s.kind);
        const t = templates.find((x) => x.category === kind) ?? templates[0];
        const pose = poses.includes(s.pose) && t.hasYuko ? s.pose : null;
        return {
          sceneType: t.category as SceneCategory, templateId: t.templateId, durationSec: 8,
          texts: { title: s.title, subtitle: s.subtitle }, narrationText: s.narration, yukoPoseTag: pose,
          ...(s.show && s.show !== 'なし' ? { notes: s.show } : {}),
        };
      }),
    })),
  };
}

// ── お題（eval-real-prompt.ts と同じ）─────────────────────────────────────────────
const photo = (id: string, aiDescription: string, tags: string[]): Asset =>
  ({ assetId: id, assetType: 'image', displayName: `IMG_${id}`, filePath: `assets/${id}.jpg`, aiDescription, tags }) as Asset;
const others = sampleAssets.filter((a) => a.assetType !== 'image' && a.assetType !== 'video');
const recruit = {
  companyName: '株式会社サンプル物流', industry: '物流', businessDescription: '地域の配送と倉庫の管理',
  jobType: 'ドライバー・倉庫スタッフ', recruitTarget: '新卒・第二新卒', strengths: ['若手が多い', '研修が手厚い', '地域に根ざす'],
  desiredPerson: '人と話すのが好きな人', recruitUrl: 'https://example.com/recruit',
};
const general = { title: '新しい経費精算の流れ', agenda: ['変わる理由', '新しい手順', '問い合わせ先'], keyPoints: ['申請は月末までに', '領収書は写真で出せる', '承認は上長ひとり'], targetAudience: '全社員' };
const recruitAssets = [
  photo('p01', '倉庫で段ボールを運ぶ若い社員', ['倉庫', '作業', '社員']), photo('p02', 'トラックの前で笑顔を見せる運転手', ['トラック', 'ドライバー', '笑顔']),
  photo('p03', '明るい事務所で話し合う社員たち', ['事務所', '会議', '社員']), photo('p04', '研修で先輩が後輩に教えている様子', ['研修', '教育']),
  photo('p05', '会社の建物の外観', ['外観', '建物']), ...others,
];
const generalAssets = [
  photo('g01', 'スマートフォンで領収書を撮影する手元', ['領収書', 'スマホ']), photo('g02', '会議室で説明を聞く社員たち', ['会議', '説明']),
  photo('g03', 'パソコンの画面に表示された申請の一覧', ['画面', '申請']), photo('g04', 'カレンダーの月末に丸が付いている', ['カレンダー', '月末']), ...others,
];
const all = buildTemplateSummaries(sampleTemplates, '16:9');
const common = { templates: all, yukoPoseTags: ['smile', 'guide'] };
const cases = [
  { name: '採用・素材あり・60秒', input: { ...common, videoKind: 'recruit', companyInfo: recruit, purpose: 'company_intro', targetDurationSec: 60, assets: recruitAssets } },
  { name: '採用・素材なし・30秒', input: { ...common, videoKind: 'recruit', companyInfo: recruit, purpose: 'company_intro', targetDurationSec: 30, assets: [] } },
  { name: '一般・素材あり・60秒', input: { ...common, videoKind: 'general', generalBrief: general, purpose: 'general_announcement', targetDurationSec: 60, targetAudience: general.targetAudience, assets: generalAssets } },
  { name: '一般・素材なし・30秒', input: { ...common, videoKind: 'general', generalBrief: general, purpose: 'general_announcement', targetDurationSec: 30, targetAudience: general.targetAudience, assets: [] } },
] as { name: string; input: GenerateVideoPlanInput }[];

const validate = new Ajv2020({ allErrors: true, strict: false }).compile(aiVideoPlanSchema);
const shorten: ShortenText = async (text, maxLength) => {
  const m = buildShortenMessages(text, maxLength);
  return parseShortenResponse((await chat(m.system, m.user, m.schema)).content);
};

const summary: Record<string, unknown>[] = [];
const only = process.argv[5];
for (const c of cases.filter((x) => !only || x.name === only)) {
  const tone = toneArg ?? TONE_PRESETS[0];
  const templates = templatesForAssets(c.input.templates, c.input.assets);
  const kinds = [...new Set(templates.map((t) => t.category as SceneCategory))];
  const poses = c.input.yukoPoseTags;
  const row: Record<string, unknown> = { case: c.name, tone };
  const p = plannerMessages({ ...c.input, templates }, kinds);
  const outline = await chat(p.system, p.user, undefined, 900);
  writeFileSync(join(outDir, `${c.name}.outline.txt`), outline.content);
  row.plannerMs = outline.ms;
  const parsed = parseOutline(outline.content, kinds);
  let draft: Draft | null = null;
  if (parsed.scenes.length === 0) {
    row.error = '構成メモを読めない';
  } else {
    // 場面ごとに台本係へ頼む（前の場面の語りを渡して流れをつなぐ）。
    const t0 = Date.now();
    const written: Draft['parts'][number]['scenes'] = [];
    let prev = '';
    for (const [i, sc] of parsed.scenes.entries()) {
      const m = sceneWriterMessages(c.input, sc, i, parsed.scenes.length, prev, tone);
      const res = await chat(m.system, m.user, sceneWriterSchema(), 400);
      let out: { title: string; narration: string; subtitle: string } | null = null;
      try { out = JSON.parse(res.content); } catch { /* 読めない場面は伝えることをそのまま語りにする */ }
      // あいさつは最初の場面だけ（ソフトの決まり）＝2B は指示しても毎回「こんにちは、ゆうこです」で始めた（v4 の実測）。
      const raw = out?.narration ?? sc.say;
      // あいさつ → 名乗り（「株式会社〜のゆうこです」）の順に外す。
      const narration = i === 0 ? raw : raw
        .replace(/^(こんにちは|こんばんは|やっほー|はじめまして)[、,！!。\s]*/, '')
        .replace(/^(株式会社\S{1,20}の|\{会社名\}の)?ゆうこ(です|だよ)[！!。、\s]*/, '')
        .trim() || raw;
      written.push({ kind: KIND_LABEL[sc.kind], title: out?.title ?? sc.say.slice(0, 12), narration, subtitle: out?.subtitle ?? sc.say.slice(0, 25), show: sc.show, pose: i === 0 ? poses[0] ?? 'なし' : poses[1] ?? poses[0] ?? 'なし' });
      // 語りそのものではなく構成メモの要点を渡す（語りを渡すと書き写した＝v3 の実測）。
      prev = parsed.scenes.slice(0, i + 1).map((x) => `- ${x.say}`).join('\n');
    }
    row.writerMs = Date.now() - t0;
    // パートは構成メモの見出しで束ねる（順は保つ）。
    const parts: Draft['parts'] = [];
    parsed.scenes.forEach((sc, i) => {
      const last = parts[parts.length - 1];
      if (last && last.partTitle === sc.part) last.scenes.push(written[i]);
      else parts.push({ partTitle: sc.part, scenes: [written[i]] });
    });
    draft = { title: parsed.title || parsed.scenes[0].say.slice(0, 20), parts };
  }
  if (draft) {
    const plan = sanitizeAiVideoPlan(assemble(draft, c.input, templates, poses)) as AiVideoPlan;
    row.valid = validate(plan);
    const t1 = Date.now();
    const refined = await refineVideoPlan(plan, {
      templates, targetDurationSec: c.input.targetDurationSec,
      properNouns: c.input.videoKind === 'general' ? {} : { companyName: recruit.companyName, recruitUrl: recruit.recruitUrl },
    }, shorten);
    row.refineMs = Date.now() - t1;
    row.totalMs = (row.plannerMs as number) + (row.writerMs as number) + (row.refineMs as number);
    row.after = scorePlan(refined.plan, { templates, assets: c.input.assets, targetDurationSec: c.input.targetDurationSec, companyName: c.input.companyInfo?.companyName });
    row.afterScenes = scoreScenes(transformVideoPlan(refined.plan, { templates: sampleTemplates, assets: c.input.assets, orientation: '16:9', autoAssignAssets: true }), c.input.assets);
    writeFileSync(join(outDir, `${c.name}.after.json`), JSON.stringify(refined.plan, null, 2));
  }
  summary.push(row);
  console.log(JSON.stringify(row));
}
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
