// 学習材料を組み立てる（ADR-0052 段階4・#1294）。アプリと同じ指示文（同梱の AI の経路の選択つき）を入力に、
// 理想の動画案を出力にした会話を JSONL にする。理想の案は機械で確かめてから書き出す（形・実在する ID・字数・印）。
// あわせて、利用者がレビューしやすい読み物（Markdown）を出す。
//
// 使い方: npx tsx scripts/local-llm/training/build-dataset.ts <出力フォルダ>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL_VIDEO_PLAN_OPTIONS, buildVideoPlanMessages } from '../../../src/domain/ai/buildVideoPlanRequest';
import { buildTemplateSummaries, templatesForAssets } from '../../../src/domain/ai/videoPlanInput';
import { sampleTemplates } from '../../../src/infrastructure/sampleData';
import { checkExample } from './checkExample';
import { PILOT_EXAMPLES } from './pilotExamples';
import type { TrainingExample } from './pilotExamples';

const outDir = process.argv[2] ?? 'training-out';
mkdirSync(outDir, { recursive: true });
const LABEL: Record<string, string> = { opening: 'オープニング', photo_intro: '写真で紹介', video_intro: '動画で紹介', point_list: '要点', message: 'メッセージ', full_visual: '写真を全面に', chapter: '章の区切り', no_yuko: '写真（ゆうこ無し）', closing: '締め' };

function review(ex: TrainingExample, problems: string[]): string {
  const i = ex.input;
  const facts = i.videoKind === 'general'
    ? [`テーマ: ${i.generalBrief?.title}`, `章立て: ${(i.generalBrief?.agenda ?? []).join(' / ')}`, `要点: ${(i.generalBrief?.keyPoints ?? []).join(' / ')}`, `対象: ${i.targetAudience}`]
    : [`会社: ${i.companyInfo?.companyName}（${i.companyInfo?.industry}）`, `事業: ${i.companyInfo?.businessDescription}`, `募集: ${i.companyInfo?.jobType}／対象: ${i.companyInfo?.recruitTarget}`,
      `強み: ${(i.companyInfo?.strengths ?? []).join(' / ')}`, `求める人物像: ${i.companyInfo?.desiredPerson}`, `採用ページ: ${i.companyInfo?.recruitUrl ?? 'なし'}`];
  const photos = i.assets.filter((a) => a.assetType === 'image' || a.assetType === 'video').map((a) => `${a.assetId}＝${a.aiDescription}`);
  const lines = [
    `## ${ex.id}`, '',
    `**入力**：${i.videoKind === 'general' ? '社内向け' : '採用'}・${i.targetDurationSec}秒・口調「${i.tone}」`, '',
    ...facts.map((f) => `- ${f}`),
    `- 写真・動画: ${photos.length ? photos.join(' ／ ') : 'なし'}`, '',
    `**理想の動画案**：「${ex.plan.videoPlan.title}」`, '',
    '| # | 種類 | 秒 | 見出し | 語り | 写真 |', '|---|---|---|---|---|---|',
  ];
  let n = 0;
  for (const p of ex.plan.parts) for (const s of p.scenes) {
    const ref = Object.values(s.assetRefs ?? {}).filter((v) => typeof v === 'string').join(',');
    lines.push(`| ${++n} | ${LABEL[s.sceneType] ?? s.sceneType} | ${s.durationSec} | ${s.texts.title ?? ''} | ${s.narrationText ?? ''} | ${ref} |`);
  }
  lines.push('', problems.length ? `⚠️ 機械の確認：${problems.join('／')}` : '✅ 機械の確認：問題なし', '',
    '**レビュー欄**：［ ］このまま使う　［ ］直して使う（直す所：　　　　）　［ ］使わない', '');
  return lines.join('\n');
}

const examples = PILOT_EXAMPLES;
const jsonl: string[] = [];
const md = ['# 学習材料の試作（レビュー用）', '', 'Claude が書いた理想の動画案です。入力（架空）と案を見比べ、レビュー欄に印を付けてください。', ''];
let bad = 0;
for (const ex of examples) {
  const problems = checkExample(ex);
  if (problems.length) bad++;
  const templates = templatesForAssets(buildTemplateSummaries(sampleTemplates, '16:9'), ex.input.assets);
  const { system, user } = buildVideoPlanMessages({ ...ex.input, templates }, LOCAL_VIDEO_PLAN_OPTIONS /* アプリと同じ選択（学習と本番で指示文を揃える） */);
  jsonl.push(JSON.stringify({ id: ex.id, messages: [{ role: 'system', content: system }, { role: 'user', content: user }, { role: 'assistant', content: JSON.stringify(ex.plan) }] }));
  md.push(review(ex, problems));
}
writeFileSync(join(outDir, 'dataset.jsonl'), jsonl.join('\n') + '\n');
writeFileSync(join(outDir, 'review.md'), md.join('\n'));
console.log(JSON.stringify({ examples: examples.length, withProblems: bad }));
