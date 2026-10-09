// 本物の指示文（アプリと同じ `buildVideoPlanMessages`）でローカル LLM を測る（ADR-0051 手順6・ADR-0052 決定7 の点数化）。
// アプリと同じ本文（Rust の `build_request_body` と同じ形）で `llama-server` に送り、正典の検証（ajv）を通したうえで、
// **ソフトで整える前と後**（`refineVideoPlan`・言い直しも同じ llama-server に頼む）を同じ物差し（`planScore.ts`）で点数にする。
//
// 使い方: 先に llama-server を起動しておき（例: -m <GGUF> --host 127.0.0.1 --port 18081 -c 8192）、
//   npx tsx scripts/local-llm/eval-real-prompt.ts http://127.0.0.1:18081 [出力フォルダ] [baseline|stage1]
// `baseline`＝**段階1の前**（差し込みの印を使わない指示文・整えない・割り当てない）／`stage1`＝段階1まで（見せたいものを
// 書かせない・割り当てない）／省略（`current`）＝今のアプリと同じ（見た目の絞り込み・段階2の割り当てまで）。前後を比べる基準に使う。
// 結果は `docs/yuko_recruit_docs/local-llm-build.md` の「点数」に段階ごとに記録する（前後を比べる）。
// ⚠️ **アプリと同じ依頼か**（#1415）＝0.5.2 以降のアプリ（Rust の `serde_json` に `preserve_order`）とは1文字も違わないことを
//   確かめてある（縛りの形・指示文・入力の文）。環境変数 `SORT_SCHEMA=1` で、**0.5.1 までのアプリと同じく縛りの形の項目を
//   アルファベット順に並べ替えて**送る（並べ替えの影響を測るため）。
import { writeFileSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import aiVideoPlanSchema from '../../docs/yuko_recruit_docs/schemas/ai-video-plan.schema.json';
import { buildVideoPlanMessages } from '../../src/domain/ai/buildVideoPlanRequest';
import Ajv2020 from 'ajv/dist/2020';
import { stripCodeFence } from '../../src/domain/ai/validateVideoPlan';
import { sanitizeAiVideoPlan } from '../../src/domain/ai/sanitizeVideoPlan';
import { refineVideoPlan } from '../../src/domain/ai/refineVideoPlan';
import { generationSchemaFor } from '../../src/domain/ai/planSanity';
import type { ShortenText } from '../../src/domain/ai/refineVideoPlan';
import { buildShortenMessages, parseShortenResponse } from '../../src/domain/ai/shortenTextRequest';
import type { AiVideoPlan } from '../../src/domain/ai/types';
import { buildTemplateSummaries, templatesForAssets } from '../../src/domain/ai/videoPlanInput';
import { sampleTemplates, sampleAssets } from '../../src/infrastructure/sampleData';
import type { GenerateVideoPlanInput } from '../../src/domain/ai/aiProvider';
import { scorePlan, scoreScenes } from './planScore';
import { transformVideoPlan } from '../../src/domain/ai/transformPlan';
import type { Asset } from '../../src/domain/project/types';

// アプリと同じ手順（フェンス除去→JSON→`sanitizeAiVideoPlan`→正典 schema で ajv）。⚠️ 事前コンパイル済みの検証関数
// （`generated/validators.js`）は束ねる前提の形で、Node で直に動かすと読み込めないので、同じ schema をここで組み立てる。
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(aiVideoPlanSchema);
function validatePlan(data: unknown): { valid: true; plan: AiVideoPlan } | { valid: false; errors: unknown } {
  const normalized = sanitizeAiVideoPlan(data);
  return validate(normalized) ? { valid: true, plan: normalized as AiVideoPlan } : { valid: false, errors: validate.errors };
}
function parseAndValidateVideoPlan(raw: string): { valid: true; plan: AiVideoPlan } | { valid: false; errors: unknown } {
  const text = stripCodeFence(raw);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch (e) { return { valid: false, errors: [`JSON として解釈できません: ${(e as Error).message}`] }; }
  return validatePlan(parsed);
}

const base = process.argv[2] ?? 'http://127.0.0.1:18081';
const outDir = process.argv[3];
const mode = process.argv[4] ?? 'current';
const baseline = mode === 'baseline';
const stage2 = mode === 'current';
// 口調（5番目）＝入力の「トーン」を指定して測る（ADR-0052 追補10）。
const toneArg = process.argv[5];
if (outDir) mkdirSync(outDir, { recursive: true });

/** アプリの `local_ai_generate` と同じ本文で1回頼む（Rust の `build_request_body` と同じ形）。 */
function postJson(url: string, body: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const q = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json' } }, (r) => {
      let d = '';
      r.setEncoding('utf8');
      r.on('data', (c: string) => (d += c));
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    q.on('error', reject);
    q.end(JSON.stringify(body));
  });
}

/** 項目をアルファベット順に並べ替える（0.5.1 までのアプリ＝`serde_json` の既定と同じ）。 */
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]));
  return v;
}
const SORT_SCHEMA = process.env.SORT_SCHEMA === '1';

async function chat(system: string, user: string, schemaIn: unknown): Promise<{ content: string; timings?: Record<string, number> }> {
  const schema = SORT_SCHEMA ? sortKeys(schemaIn) : schemaIn;
  const body = {
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    response_format: { type: 'json_schema', json_schema: { name: 'ai_video_plan', schema } },
    chat_template_kwargs: { enable_thinking: false },
    temperature: 0.2,
    // アプリ（Rust の `MAX_OUTPUT_TOKENS`）と同じ上限＝止まらない回で5分待って落ちない（ADR-0052 追補6）。
    max_tokens: 3072,
  };
  // ⚠️ `fetch` は応答の頭を 5 分で打ち切る＝止まらない回（最大 3072 トークン）で道具のほうが落ちる。素の http で待つ。
  const json = (await postJson(`${base}/v1/chat/completions`, body)) as { choices?: { message?: { content?: string } }[]; timings?: Record<string, number> };
  return { content: json.choices?.[0]?.message?.content ?? '', timings: json.timings };
}

const shorten: ShortenText = async (text, maxLength) => {
  const m = buildShortenMessages(text, maxLength);
  return parseShortenResponse((await chat(m.system, m.user, m.schema)).content);
};

const recruit = {
  companyName: '株式会社サンプル物流', industry: '物流', businessDescription: '地域の配送と倉庫の管理',
  jobType: 'ドライバー・倉庫スタッフ', recruitTarget: '新卒・第二新卒', strengths: ['若手が多い', '研修が手厚い', '地域に根ざす'],
  desiredPerson: '人と話すのが好きな人', recruitUrl: 'https://example.com/recruit',
};
const general = {
  title: '新しい経費精算の流れ', agenda: ['変わる理由', '新しい手順', '問い合わせ先'],
  keyPoints: ['申請は月末までに', '領収書は写真で出せる', '承認は上長ひとり'], targetAudience: '全社員',
};

/**
 * 説明の付いた写真（段階2＝取り込み時に同梱の AI が付けた形）。見本の素材（`sampleAssets`）は説明が無いので、
 * 採用・一般それぞれに**説明つきの写真**を足す（立ち絵・ロゴ・BGM は見本のまま）。
 */
const photo = (id: string, aiDescription: string, tags: string[]): Asset =>
  ({ assetId: id, assetType: 'image', displayName: `IMG_${id}`, filePath: `assets/${id}.jpg`, aiDescription, tags }) as Asset;
const others = sampleAssets.filter((a) => a.assetType !== 'image' && a.assetType !== 'video');
const recruitAssets: Asset[] = [
  photo('p01', '倉庫で段ボールを運ぶ若い社員', ['倉庫', '作業', '社員']),
  photo('p02', 'トラックの前で笑顔を見せる運転手', ['トラック', 'ドライバー', '笑顔']),
  photo('p03', '明るい事務所で話し合う社員たち', ['事務所', '会議', '社員']),
  photo('p04', '研修で先輩が後輩に教えている様子', ['研修', '教育']),
  photo('p05', '会社の建物の外観', ['外観', '建物']),
  ...others,
];
const generalAssets: Asset[] = [
  photo('g01', 'スマートフォンで領収書を撮影する手元', ['領収書', 'スマホ']),
  photo('g02', '会議室で説明を聞く社員たち', ['会議', '説明']),
  photo('g03', 'パソコンの画面に表示された申請の一覧', ['画面', '申請']),
  photo('g04', 'カレンダーの月末に丸が付いている', ['カレンダー', '月末']),
  ...others,
];

/** お題の表（ADR-0052 決定7＝採用・一般 × 素材あり・なし × 尺）。 */
function cases(orientation: '16:9' | '9:16'): { name: string; input: GenerateVideoPlanInput }[] {
  const templates = buildTemplateSummaries(sampleTemplates, orientation);
  const common = { templates, yukoPoseTags: ['smile', 'guide'] };
  return [
    { name: '採用・素材あり・60秒', input: { ...common, videoKind: 'recruit', companyInfo: recruit, purpose: 'company_intro', targetDurationSec: 60, assets: recruitAssets } },
    { name: '採用・素材なし・30秒', input: { ...common, videoKind: 'recruit', companyInfo: recruit, purpose: 'company_intro', targetDurationSec: 30, assets: [] } },
    { name: '一般・素材あり・60秒', input: { ...common, videoKind: 'general', generalBrief: general, purpose: 'general_announcement', targetDurationSec: 60, targetAudience: general.targetAudience, assets: generalAssets } },
    { name: '一般・素材なし・30秒', input: { ...common, videoKind: 'general', generalBrief: general, purpose: 'general_announcement', targetDurationSec: 30, targetAudience: general.targetAudience, assets: [] } },
  ] as { name: string; input: GenerateVideoPlanInput }[];
}

const summary: Record<string, unknown>[] = [];
for (const c of cases('16:9')) {
  // 今のアプリと同じく、写真・動画が無ければ差し込み口のある見た目を見せない（12 §8.9）。
  if (stage2) c.input = { ...c.input, templates: templatesForAssets(c.input.templates, c.input.assets) };
  if (toneArg) c.input = { ...c.input, tone: toneArg };
  const { system, user } = buildVideoPlanMessages(c.input, { properNounPlaceholders: !baseline, askVisualWish: stage2 });
  const t0 = Date.now();
  // アプリと同じく、書かせるときだけパートと場面の数に上限を付ける（#1415）。`NO_CAP=1` で上限なし（0.5.1 までと同じ）。
  const res = await chat(system, user, process.env.NO_CAP === '1' ? aiVideoPlanSchema : generationSchemaFor(aiVideoPlanSchema, c.input.targetDurationSec));
  const genMs = Date.now() - t0;
  const result = parseAndValidateVideoPlan(res.content);
  const scoreCtx = {
    templates: c.input.templates, assets: c.input.assets, targetDurationSec: c.input.targetDurationSec,
    companyName: c.input.companyInfo?.companyName,
  };
  const row: Record<string, unknown> = {
    case: c.name, genMs, valid: result.valid,
    promptTokens: res.timings?.prompt_n, genTokens: res.timings?.predicted_n, genPerSec: res.timings?.predicted_per_second,
  };
  const transformed = (plan: AiVideoPlan, autoAssignAssets: boolean) => scoreScenes(
    transformVideoPlan(plan, { templates: sampleTemplates, assets: c.input.assets, orientation: '16:9', autoAssignAssets }),
    c.input.assets,
  );
  if (result.valid) {
    row.before = scorePlan(result.plan, scoreCtx);
    row.beforeScenes = transformed(result.plan, false);
  }
  if (result.valid && !baseline) {
    const t1 = Date.now();
    const refined = await refineVideoPlan(result.plan, {
      templates: c.input.templates, targetDurationSec: c.input.targetDurationSec,
      properNouns: c.input.videoKind === 'general' ? {} : { companyName: recruit.companyName, recruitUrl: recruit.recruitUrl },
    }, shorten);
    row.refineMs = Date.now() - t1;
    row.report = refined.report;
    row.validAfter = validatePlan(refined.plan).valid;
    row.after = scorePlan(refined.plan, scoreCtx);
    row.afterScenes = transformed(refined.plan, stage2);
    if (outDir) writeFileSync(join(outDir, `${c.name}.after.json`), JSON.stringify(refined.plan, null, 2));
  }
  if ('errors' in result) row.errors = result.errors;
  summary.push(row);
  console.log(JSON.stringify(row));
  if (outDir) writeFileSync(join(outDir, `${c.name}.json`), res.content);
}
if (outDir) writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
