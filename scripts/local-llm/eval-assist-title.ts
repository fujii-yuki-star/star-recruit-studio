// 動画の題名の候補（#1316・ADR-0053 追補）を本物の llama-server で測る。アプリと同じ材料（`videoTitleSource`）と指示文。
// 使い方: llama-server を起動しておき、npx tsx scripts/local-llm/eval-assist-title.ts http://127.0.0.1:18082 < /dev/null
import { ASSIST_KIND, assistMaxLength, buildAssistMessages, parseAssistCandidates, videoTitleSource } from '../../src/domain/ai/assist';

const base = process.argv[2] ?? 'http://127.0.0.1:18082';
const CASES: { label: string; topic: string; company?: string; scenes: { narration: { text: string } }[] }[] = [
  {
    label: '採用（物流）', topic: '株式会社サンプル物流', company: '株式会社サンプル物流',
    scenes: [
      { narration: { text: '株式会社サンプル物流は、地域の暮らしを支える配送の会社です。' } },
      { narration: { text: '入社後は先輩と一緒に3か月の研修を受けます。未経験の方も安心してください。' } },
      { narration: { text: 'あなたの力で、明日の荷物を届けませんか。' } },
    ],
  },
  {
    label: '社内発表（業務改善）', topic: '問い合わせ対応の改善報告',
    scenes: [
      { narration: { text: '今期は問い合わせの対応時間を平均で2割短くできました。' } },
      { narration: { text: 'よくある質問をまとめ、担当の振り分けを自動にしたのが効きました。' } },
      { narration: { text: '来期はこの仕組みをほかの部署にも広げていきます。' } },
    ],
  },
];

for (const c of CASES) {
  const src = videoTitleSource(c.topic, c.scenes);
  const max = assistMaxLength(ASSIST_KIND.videoTitle, src, {})!;
  const m = buildAssistMessages(ASSIST_KIND.videoTitle, src, max, { companyName: c.company });
  const t0 = Date.now();
  const r = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'system', content: m.system }, { role: 'user', content: m.user }],
      response_format: { type: 'json_schema', json_schema: { name: 'ai_video_plan', schema: m.schema } },
      chat_template_kwargs: { enable_thinking: false }, temperature: 0.2, max_tokens: 3072,
    }),
  });
  const raw = ((await r.json()) as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? '';
  console.log(JSON.stringify({ case: c.label, ms: Date.now() - t0, candidates: parseAssistCandidates(raw, '', max, c.company) }));
}
