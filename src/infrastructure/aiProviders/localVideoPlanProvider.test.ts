// このパソコンの中で動画案を作る（ADR-0051 決定2）＝指示文・検証は Gemini と共有し、正典 schema で出力の形を縛る。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerateVideoPlanInput } from '../../domain/ai/aiProvider';
import validPlanFixture from '../../../docs/yuko_recruit_docs/fixtures/ai-video-plan.sample.json';
import aiVideoPlanSchema from '../../../docs/yuko_recruit_docs/schemas/ai-video-plan.schema.json';
import { LOCAL_VIDEO_PLAN_OPTIONS, buildVideoPlanMessages } from '../../domain/ai/buildVideoPlanRequest';

const { localAiGenerateMock, cancelEpoch } = vi.hoisted(() => ({ localAiGenerateMock: vi.fn(), cancelEpoch: { value: 0 } }));
vi.mock('../aiClient', () => ({ localAiGenerate: localAiGenerateMock, currentAiCancelEpoch: () => cancelEpoch.value }));

import { LocalVideoPlanProvider } from './localVideoPlanProvider';
import { AI_PLAN_UNREADABLE_MESSAGE } from './messages';
import { COMPANY_NAME_PLACEHOLDER } from '../../domain/ai/refineVideoPlan';
import type { AiVideoPlan } from '../../domain/ai/types';

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
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

describe('LocalVideoPlanProvider（ADR-0051）', () => {
  it('Gemini と同じ指示文（に差し込みの印の指示を足したもの）を渡し、出力の形は正典の schema そのもので縛る', async () => {
    localAiGenerateMock.mockResolvedValue(JSON.stringify(validPlanFixture));
    await new LocalVideoPlanProvider().generateVideoPlan(input());
    const [system, user, schema] = localAiGenerateMock.mock.calls[0];
    const expected = buildVideoPlanMessages(input(), { properNounPlaceholders: true, askVisualWish: true });
    // 学習材料と同じ選択を使っている（ADR-0052 段階4）。
    expect(LOCAL_VIDEO_PLAN_OPTIONS).toEqual({ properNounPlaceholders: true, askVisualWish: true });
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

  // ADR-0052 段階1＝ソフトが機械的に決められることで整え、もう一度正典の検証を通してから返す。
  it('検証に通った案を整えて返す（会社名の差し込み・尺の配分）', async () => {
    const raw = structuredClone(validPlanFixture) as AiVideoPlan;
    raw.parts[0].scenes[0].narrationText = `${COMPANY_NAME_PLACEHOLDER}です。`;
    localAiGenerateMock.mockResolvedValue(JSON.stringify(raw));
    const plan = await new LocalVideoPlanProvider().generateVideoPlan(input());
    expect(plan.parts[0].scenes[0].narrationText).toBe('株式会社ゆうこです。');
    const total = plan.parts.flatMap((p) => p.scenes).reduce((n, s) => n + s.durationSec, 0);
    expect(total).not.toBe(raw.parts.flatMap((p) => p.scenes).reduce((n, s) => n + s.durationSec, 0));
  });

  // #1318：尺の見積もりに動画全体の声の速さを使う（速い声ほど読み切る下限が短い）。
  it('声の速さ（voiceSpeed）を尺の配分に渡す', async () => {
    const raw = structuredClone(validPlanFixture) as AiVideoPlan;
    raw.parts[0].scenes[0].narrationText = 'あ'.repeat(60);
    const sceneSec = async (voiceSpeed?: number) => {
      localAiGenerateMock.mockResolvedValue(JSON.stringify(raw));
      const plan = await new LocalVideoPlanProvider().generateVideoPlan({ ...input(), targetDurationSec: 3, voiceSpeed });
      return plan.parts[0].scenes[0].durationSec;
    };
    expect(await sceneSec(0.7)).toBeGreaterThan(await sceneSec(1.5));
  });

  it('上限を越えた文は言い直しを頼む（上限つきの形で縛る）', async () => {
    const raw = structuredClone(validPlanFixture) as AiVideoPlan;
    raw.parts[0].scenes[0].narrationText = 'あ'.repeat(200);
    localAiGenerateMock
      .mockResolvedValueOnce(JSON.stringify(raw))
      .mockResolvedValue(JSON.stringify({ text: '短くしました。' }));
    const plan = await new LocalVideoPlanProvider().generateVideoPlan(input());
    expect(plan.parts[0].scenes[0].narrationText).toBe('短くしました。');
    const [, user, schema] = localAiGenerateMock.mock.calls[1];
    expect(user).toContain('あ'.repeat(200));
    expect(JSON.parse(schema).properties.text.maxLength).toBeGreaterThan(0);
  });

  it('言い直しが1回失敗したら残りは頼まない（やめた後に新しい生成を走らせない）・元の文は残す', async () => {
    const raw = structuredClone(validPlanFixture) as AiVideoPlan;
    for (const s of raw.parts.flatMap((p) => p.scenes)) s.narrationText = 'あ'.repeat(200);
    localAiGenerateMock
      .mockResolvedValueOnce(JSON.stringify(raw))
      .mockRejectedValue(new Error('やめました'));
    const plan = await new LocalVideoPlanProvider().generateVideoPlan(input());
    expect(localAiGenerateMock).toHaveBeenCalledTimes(2);
    expect(plan.parts[0].scenes[0].narrationText).toBe('あ'.repeat(200));
  });

  it('「やめる」が押されたら、残りの言い直しは頼まない', async () => {
    const raw = structuredClone(validPlanFixture) as AiVideoPlan;
    for (const s of raw.parts.flatMap((p) => p.scenes)) s.narrationText = 'あ'.repeat(200);
    localAiGenerateMock
      .mockResolvedValueOnce(JSON.stringify(raw))
      .mockImplementationOnce(async () => { cancelEpoch.value++; return JSON.stringify({ text: '短い。' }); });
    await new LocalVideoPlanProvider().generateVideoPlan(input());
    expect(localAiGenerateMock).toHaveBeenCalledTimes(2); // 生成＋言い直し1回（押された後は頼まない）
  });

  it('次の動画案づくりが始まったら、古い回の言い直しは頼まない（新しい回を追い越さない）', async () => {
    const raw = structuredClone(validPlanFixture) as AiVideoPlan;
    raw.parts[0].scenes[0].narrationText = 'あ'.repeat(200);
    let releaseOld!: (v: string) => void;
    localAiGenerateMock
      .mockImplementationOnce(() => new Promise<string>((r) => { releaseOld = r; })) // 古い回の生成（待たせる）
      .mockResolvedValueOnce(JSON.stringify(validPlanFixture)); // 新しい回の生成
    const provider = new LocalVideoPlanProvider();
    const old = provider.generateVideoPlan(input());
    await provider.generateVideoPlan(input());
    releaseOld(JSON.stringify(raw));
    const plan = await old;
    expect(localAiGenerateMock).toHaveBeenCalledTimes(2); // 古い回は言い直しを頼まない
    expect(plan.parts[0].scenes[0].narrationText).toBe('あ'.repeat(200));
  });

  it('一般の動画では会社名を差し込まない（会社情報を使わない）', async () => {
    const raw = structuredClone(validPlanFixture) as AiVideoPlan;
    raw.parts[0].scenes[0].narrationText = `${COMPANY_NAME_PLACEHOLDER}です。`;
    localAiGenerateMock.mockResolvedValue(JSON.stringify(raw));
    const plan = await new LocalVideoPlanProvider().generateVideoPlan({ ...input(), videoKind: 'general' });
    expect(plan.parts[0].scenes[0].narrationText).toBe('です。');
  });

  it('写真・動画が無ければ、差し込み口のある見た目を見せない（整える段も同じ一覧）', async () => {
    localAiGenerateMock.mockResolvedValue(JSON.stringify(validPlanFixture));
    const templates = [
      { templateId: 'opening_yuko_right_v1', category: 'opening', hasYuko: true, requiredSlots: [] },
      { templateId: 'photo_left_text_right_yuko_v1', category: 'photo_intro', hasYuko: true, requiredSlots: ['mainVisual'] },
    ];
    await new LocalVideoPlanProvider().generateVideoPlan({ ...input(), templates, assets: [] });
    const [, user] = localAiGenerateMock.mock.calls[0];
    expect(user).toContain('templateId=opening_yuko_right_v1');
    expect(user).not.toContain('templateId=photo_left_text_right_yuko_v1');
  });

  it('生成の失敗は、Rust が返した「次の行動」の文をそのまま伝える', async () => {
    localAiGenerateMock.mockRejectedValue(new Error('このパソコンで動画案を作る部品が見つかりませんでした。アプリを入れ直してください。'));
    await expect(new LocalVideoPlanProvider().generateVideoPlan(input())).rejects.toThrow('部品が見つかりませんでした');
  });
});
