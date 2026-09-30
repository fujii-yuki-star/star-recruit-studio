// 本物の指示文（アプリと同じ `buildVideoPlanMessages`）でローカル LLM を測る（ADR-0051 手順6・#1284 の下ごしらえ）。
// アプリと同じ本文（Rust の `build_request_body` と同じ形）で `llama-server` に送り、正典の検証（ajv）と意味の突き合わせをする。
//
// 使い方: 先に llama-server を起動しておき（例: -m <GGUF> --host 127.0.0.1 --port 18081 -c 8192）、
//   npx tsx scripts/local-llm/eval-real-prompt.ts http://127.0.0.1:18081 [出力フォルダ]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import aiVideoPlanSchema from '../../docs/yuko_recruit_docs/schemas/ai-video-plan.schema.json';
import { buildVideoPlanMessages } from '../../src/domain/ai/buildVideoPlanRequest';
import Ajv2020 from 'ajv/dist/2020';
import { stripCodeFence } from '../../src/domain/ai/validateVideoPlan';
import { sanitizeAiVideoPlan } from '../../src/domain/ai/sanitizeVideoPlan';
import type { AiVideoPlan } from '../../src/domain/ai/types';

// アプリと同じ手順（フェンス除去→JSON→`sanitizeAiVideoPlan`→正典 schema で ajv）。⚠️ 事前コンパイル済みの検証関数
// （`generated/validators.js`）は束ねる前提の形で、Node で直に動かすと読み込めないので、同じ schema をここで組み立てる。
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(aiVideoPlanSchema);
function parseAndValidateVideoPlan(raw: string): { valid: true; plan: AiVideoPlan } | { valid: false; errors: unknown } {
  const text = stripCodeFence(raw);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch (e) { return { valid: false, errors: [`JSON として解釈できません: ${(e as Error).message}`] }; }
  const normalized = sanitizeAiVideoPlan(parsed);
  return validate(normalized) ? { valid: true, plan: normalized as AiVideoPlan } : { valid: false, errors: validate.errors };
}
import { buildTemplateSummaries } from '../../src/domain/ai/videoPlanInput';
import { sampleTemplates, sampleAssets } from '../../src/infrastructure/sampleData';
import type { GenerateVideoPlanInput } from '../../src/domain/ai/aiProvider';

const base = process.argv[2] ?? 'http://127.0.0.1:18081';
const outDir = process.argv[3];
if (outDir) mkdirSync(outDir, { recursive: true });

const templates = buildTemplateSummaries(sampleTemplates, '16:9');
const cases: { name: string; input: GenerateVideoPlanInput }[] = [
  {
    name: '採用・素材あり・60秒',
    input: {
      videoKind: 'recruit',
      companyInfo: {
        companyName: '株式会社サンプル物流', industry: '物流', businessDescription: '地域の配送と倉庫の管理',
        jobType: 'ドライバー・倉庫スタッフ', recruitTarget: '新卒・第二新卒', strengths: ['若手が多い', '研修が手厚い', '地域に根ざす'],
        desiredPerson: '人と話すのが好きな人', recruitUrl: 'https://example.com/recruit',
      },
      purpose: 'company_intro', targetDurationSec: 60, templates, assets: sampleAssets, yukoPoseTags: ['smile', 'point', 'nod'],
    } as GenerateVideoPlanInput,
  },
  {
    name: '採用・素材なし・30秒',
    input: {
      videoKind: 'recruit',
      companyInfo: {
        companyName: '株式会社ゆうこ', industry: 'IT', businessDescription: 'Webサービス開発', jobType: 'エンジニア',
        recruitTarget: '新卒', strengths: ['リモート可'], desiredPerson: '主体的に動ける人', recruitUrl: 'https://example.com/recruit',
      },
      purpose: 'company_intro', targetDurationSec: 30, templates, assets: [], yukoPoseTags: ['smile'],
    } as GenerateVideoPlanInput,
  },
];

const summary: Record<string, unknown>[] = [];
for (const c of cases) {
  const { system, user } = buildVideoPlanMessages(c.input);
  const body = {
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    response_format: { type: 'json_schema', json_schema: { name: 'ai_video_plan', schema: aiVideoPlanSchema } },
    chat_template_kwargs: { enable_thinking: false },
    temperature: 0.2,
  };
  const t0 = Date.now();
  const r = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await r.json()) as { choices?: { message?: { content?: string } }[]; timings?: Record<string, number> };
  const ms = Date.now() - t0;
  const raw = json.choices?.[0]?.message?.content ?? '';
  const result = parseAndValidateVideoPlan(raw);
  const templateIds = new Set(c.input.templates.map((t) => t.templateId));
  const assetIds = new Set(c.input.assets.map((a) => a.assetId));
  let unknownTemplates = 0;
  let unknownAssets = 0;
  let scenes = 0;
  let durationSum = 0;
  let scenesWithAssets = 0;
  if (result.valid) {
    for (const p of result.plan.parts) for (const s of p.scenes) {
      scenes++;
      durationSum += s.durationSec ?? 0;
      if (!templateIds.has(s.templateId)) unknownTemplates++;
      const refs = Object.values(s.assetRefs ?? {}).filter((v): v is string => typeof v === 'string');
      if (refs.length > 0) scenesWithAssets++;
      for (const id of refs) if (!assetIds.has(id)) unknownAssets++;
    }
  }
  const row = {
    case: c.name, ms, valid: result.valid, scenes, durationSum, target: c.input.targetDurationSec, unknownTemplates, unknownAssets, scenesWithAssets, assetsGiven: c.input.assets.length,
    promptTokens: json.timings?.prompt_n, genTokens: json.timings?.predicted_n, genPerSec: json.timings?.predicted_per_second,
    errors: 'errors' in result ? result.errors : undefined,
  };
  summary.push(row);
  console.log(JSON.stringify(row));
  if (outDir) writeFileSync(join(outDir, `${c.name}.json`), raw);
}
if (outDir) writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
