// 編集の途中の AI 補助（ADR-0053）を本物の llama-server で測る。アプリと同じ指示文（`buildAssistMessages`）・
// Rust の `build_request_body` と同じ本文（temperature 0.2・考える段なし）で送り、`parseAssistCandidates` で読む。
//
// 使い方: 先に llama-server を起動しておき（例: -m <GGUF> --host 127.0.0.1 --port 18082 -c 8192）、
//   npx tsx scripts/local-llm/eval-assist.ts http://127.0.0.1:18082 < /dev/null
import { ASSIST_KIND, assistMaxLength, buildAssistMessages, parseAssistCandidates } from '../../src/domain/ai/assist';
import type { AssistKind, AssistLimits } from '../../src/domain/ai/assist';

const base = process.argv[2] ?? 'http://127.0.0.1:18082';
const COMPANY = '株式会社サンプル物流';

/** 架空の場面（採用と社内発表）。 */
const CASES: { label: string; text: string; limits: AssistLimits; kinds: AssistKind[] }[] = [
  {
    label: '採用・会社紹介',
    text: `${COMPANY}は、地域の暮らしを支える配送の会社です。毎日たくさんの荷物を、お客さまのもとへ安全に、そして時間どおりに届けることを大切にしています。`,
    limits: { maxNarrationLength: 120, sceneDurationSec: 8 },
    kinds: [ASSIST_KIND.shorten, ASSIST_KIND.polite, ASSIST_KIND.soft, ASSIST_KIND.fitDuration, ASSIST_KIND.subtitle, ASSIST_KIND.title],
  },
  {
    label: '採用・働き方',
    text: '入社後は先輩と一緒に3か月の研修を受けます。わからないことはいつでも聞ける雰囲気なので、未経験の方も安心してください。',
    limits: { maxNarrationLength: 120, maxSubtitleLength: 40, sceneDurationSec: 6 },
    kinds: [ASSIST_KIND.shorten, ASSIST_KIND.polite, ASSIST_KIND.soft, ASSIST_KIND.fitDuration, ASSIST_KIND.subtitle, ASSIST_KIND.title],
  },
  {
    label: '社内発表',
    text: '今期は問い合わせの対応時間を平均で2割短くできました。来期はこの仕組みをほかの部署にも広げていきます。',
    limits: { maxNarrationLength: 100, sceneDurationSec: 5 },
    kinds: [ASSIST_KIND.shorten, ASSIST_KIND.polite, ASSIST_KIND.soft, ASSIST_KIND.fitDuration, ASSIST_KIND.subtitle, ASSIST_KIND.title],
  },
];

for (const c of CASES) {
  for (const kind of c.kinds) {
    const max = assistMaxLength(kind, c.text, c.limits);
    if (max === null) {
      console.log(JSON.stringify({ case: c.label, kind, skipped: 'not-needed' }));
      continue;
    }
    const m = buildAssistMessages(kind, c.text, max, { companyName: COMPANY, sceneDurationSec: c.limits.sceneDurationSec });
    const body = {
      messages: [{ role: 'system', content: m.system }, { role: 'user', content: m.user }],
      response_format: { type: 'json_schema', json_schema: { name: 'ai_video_plan', schema: m.schema } },
      chat_template_kwargs: { enable_thinking: false },
      temperature: 0.2,
      max_tokens: 3072,
    };
    const t0 = Date.now();
    const r = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = json.choices?.[0]?.message?.content ?? '';
    const out = parseAssistCandidates(raw, c.text, max, COMPANY);
    console.log(JSON.stringify({ case: c.label, kind, max, ms: Date.now() - t0, candidates: out, dropped: raw.length > 0 && out.length === 0 ? raw.slice(0, 200) : undefined }));
  }
}
