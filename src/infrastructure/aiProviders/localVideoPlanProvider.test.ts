// このパソコンの中で動画案を作る（ADR-0051 決定2）＝指示文・検証は Gemini と共有し、正典 schema で出力の形を縛る。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerateVideoPlanInput } from '../../domain/ai/aiProvider';
import validPlanFixture from '../../../docs/yuko_recruit_docs/fixtures/ai-video-plan.sample.json';
import aiVideoPlanSchema from '../../../docs/yuko_recruit_docs/schemas/ai-video-plan.schema.json';
import { buildVideoPlanMessages } from '../../domain/ai/buildVideoPlanRequest';

const { localAiGenerateMock } = vi.hoisted(() => ({ localAiGenerateMock: vi.fn() }));
vi.mock('../aiClient', () => ({ localAiGenerate: localAiGenerateMock }));

import { LocalVideoPlanProvider } from './localVideoPlanProvider';
import { AI_PLAN_UNREADABLE_MESSAGE } from './messages';

function input(): GenerateVideoPlanInput {
  return {
    companyInfo: {
      companyName: '株式会社ゆうこ', industry: 'IT', businessDescription: 'Webサービス開発', jobType: 'エンジニア',
      recruitTarget: '新卒', strengths: ['リモート可'], desiredPerson: '主体的に動ける人', recruitUrl: 'https://example.com/recruit',
    },
    purpose: 'company_intro',
    targetDurationSec: 60,
    templates: [{ templateId: 'opening_yuko_right_v1', category: 'opening', hasYuko: true }],
    assets: [],
    yukoPoseTags: ['smile'],
  } as GenerateVideoPlanInput;
}

beforeEach(() => {
  localAiGenerateMock.mockReset();
  // ログ（console.warn）はテスト出力を汚さないよう抑制（Gemini の検査と同じ）。
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('LocalVideoPlanProvider（ADR-0051）', () => {
  it('Gemini と同じ指示文を渡し、出力の形は正典の schema そのもので縛る', async () => {
    localAiGenerateMock.mockResolvedValue(JSON.stringify(validPlanFixture));
    await new LocalVideoPlanProvider().generateVideoPlan(input());
    const [system, user, schema] = localAiGenerateMock.mock.calls[0];
    const expected = buildVideoPlanMessages(input());
    expect(system).toBe(expected.system);
    expect(user).toBe(expected.user);
    expect(JSON.parse(schema)).toEqual(aiVideoPlanSchema);
  });

  it('正典の検証に通った構成案だけを返す', async () => {
    localAiGenerateMock.mockResolvedValue(JSON.stringify(validPlanFixture));
    const plan = await new LocalVideoPlanProvider().generateVideoPlan(input());
    expect(plan.videoPlan.title).toBe(validPlanFixture.videoPlan.title);
  });

  // 縛って出したことを成功の証明にしない＝最後は同じ ajv で見る。
  it('検証に通らなければ、読み取れなかったと言う（構成案が出たように見せない）', async () => {
    localAiGenerateMock.mockResolvedValue(JSON.stringify({ schemaVersion: '1.0' }));
    await expect(new LocalVideoPlanProvider().generateVideoPlan(input())).rejects.toThrow(AI_PLAN_UNREADABLE_MESSAGE);
  });

  it('生成の失敗は、Rust が返した「次の行動」の文をそのまま伝える', async () => {
    localAiGenerateMock.mockRejectedValue(new Error('このパソコンで動画案を作る部品が見つかりませんでした。アプリを入れ直してください。'));
    await expect(new LocalVideoPlanProvider().generateVideoPlan(input())).rejects.toThrow('部品が見つかりませんでした');
  });
});
