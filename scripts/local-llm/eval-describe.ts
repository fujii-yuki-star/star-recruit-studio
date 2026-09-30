// 写真の自動説明（ADR-0052 決定4）を本物の llama-server で測る。アプリと同じ指示文（`buildDescribeAssetMessages`）と、
// Rust の `build_image_request_body` と同じ本文（user に text＋image_url の data URL）で送り、`parseAssetDescription` で読む。
//
// 使い方: 先に llama-server を視覚の部品つきで起動しておき
//   （例: -m <GGUF> --mmproj <mmproj GGUF> --image-max-tokens 256 --host 127.0.0.1 --port 18081 -c 8192）、
//   npx tsx scripts/local-llm/eval-describe.ts http://127.0.0.1:18081 <写真1> [写真2 ...]
import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { buildDescribeAssetMessages, parseAssetDescription } from '../../src/domain/ai/describeAssetRequest';

const [base, ...files] = process.argv.slice(2);
const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

for (const file of files) {
  const m = buildDescribeAssetMessages({ displayName: basename(file), assetType: 'image' });
  const dataUrl = `data:${MIME[extname(file).toLowerCase()] ?? 'image/jpeg'};base64,${readFileSync(file).toString('base64')}`;
  const body = {
    messages: [
      { role: 'system', content: m.system },
      { role: 'user', content: [{ type: 'text', text: m.user }, { type: 'image_url', image_url: { url: dataUrl } }] },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'ai_video_plan', schema: m.schema } },
    chat_template_kwargs: { enable_thinking: false },
    temperature: 0.2,
  };
  const t0 = Date.now();
  const r = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await r.json()) as { choices?: { message?: { content?: string } }[]; timings?: Record<string, number> };
  const raw = json.choices?.[0]?.message?.content ?? '';
  console.log(JSON.stringify({ file: basename(file), ms: Date.now() - t0, promptTokens: json.timings?.prompt_n, result: parseAssetDescription(raw), raw: raw.slice(0, 200) }));
}
