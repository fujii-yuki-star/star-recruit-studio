import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Asset } from '../../domain/project/types';
import type { GenerateVideoPlanInput, TemplateSummary } from '../../domain/ai/aiProvider';
import { AI_ASSET_SEND_MAX } from '../../domain/constants';
// 正典 fixture（validate:schemas で適合確認済みの有効な ai-video-plan）。有効応答の素として使う。
import validPlanFixture from '../../../docs/yuko_recruit_docs/fixtures/ai-video-plan.sample.json';

// aiClient（Tauri invoke 境界）はモックする＝実 Gemini を呼ばずに応答を差し込む。
// vi.mock はホイストされるため、参照する mock 関数は vi.hoisted で先に用意する。
const { aiGenerateMock } = vi.hoisted(() => ({ aiGenerateMock: vi.fn() }));
vi.mock('../aiClient', () => ({ GEMINI_PROVIDER: 'gemini', aiGenerate: aiGenerateMock }));
vi.mock('../appSettings', () => ({ DEFAULT_AI_MODEL: 'gemini-2.0-flash' }));

import { GeminiProvider } from './geminiProvider';

// 有効な構成案 JSON（fixture をそのまま文字列化）と、検証で弾かれる JSON（必須 videoPlan/parts 欠落）。
const VALID_RAW = JSON.stringify(validPlanFixture);
const INVALID_RAW = JSON.stringify({ schemaVersion: '1.0' });

const templates: TemplateSummary[] = [
  { templateId: 'opening_yuko_right_v1', category: 'opening', hasYuko: true },
];
const assets: Asset[] = [];

function input(): GenerateVideoPlanInput {
  return {
    companyInfo: {
      companyName: '株式会社ゆうこ',
      industry: 'IT',
      businessDescription: 'Webサービス開発',
      jobType: 'エンジニア',
      recruitTarget: '新卒',
      strengths: ['リモート可'],
      desiredPerson: '主体的に動ける人',
      recruitUrl: 'https://example.com/recruit',
    },
    purpose: 'company_intro',
    targetDurationSec: 60,
    templates,
    assets,
    yukoPoseTags: ['smile'],
  };
}

describe('GeminiProvider.generateVideoPlan：1回だけ呼び自動リトライしない（無料枠配慮・再試行は手動）', () => {
  beforeEach(() => {
    aiGenerateMock.mockReset();
    // ログ（console.warn）はテスト出力を汚さないよう抑制（中身は別途検証しない）。
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('有効な応答は plan を返す（呼び出しは1回）', async () => {
    aiGenerateMock.mockResolvedValueOnce(VALID_RAW);
    const plan = await new GeminiProvider('gemini-2.0-flash').generateVideoPlan(input());
    expect(plan.schemaVersion).toBe('1.0');
    expect(aiGenerateMock).toHaveBeenCalledTimes(1);
  });

  it('無効な応答は「次の行動」つきエラーを投げ、自動リトライしない（1回だけ呼ぶ）', async () => {
    aiGenerateMock.mockResolvedValue(INVALID_RAW);
    await expect(
      new GeminiProvider('gemini-2.0-flash').generateVideoPlan(input()),
    ).rejects.toThrow('AIからの提案を読み取れませんでした。もう一度お試しください。');
    expect(aiGenerateMock).toHaveBeenCalledTimes(1);
  });

  it('APIエラー（接続失敗等）は即伝播する（1回だけ呼ぶ）', async () => {
    aiGenerateMock.mockRejectedValue(
      new Error('AI に接続できませんでした。ネットワークを確認して、もう一度お試しください。'),
    );
    await expect(
      new GeminiProvider('gemini-2.0-flash').generateVideoPlan(input()),
    ).rejects.toThrow('AI に接続できませんでした');
    expect(aiGenerateMock).toHaveBeenCalledTimes(1);
  });
});

// #585 レビュー：12§6 の「超過分は送らない旨を log する（無言の打ち切りをしない）」のうち、
// **provider 側の log** が実際に動くことを固定する（利用者向けの明示は ConfirmScreen 側でテスト済み）。
describe('GeminiProvider：素材が上限を超えたら送らなかった件数を記録する（12§6 の log・#585）', () => {
  const manyAssets = (n: number): Asset[] =>
    Array.from({ length: n }, (_, i) => ({
      assetId: `asset_${String(i + 1).padStart(3, '0')}`, assetType: 'image',
      displayName: `写真${i + 1}.jpg`, filePath: `x${i}.jpg`,
    } as Asset));

  beforeEach(() => {
    aiGenerateMock.mockReset();
    aiGenerateMock.mockResolvedValue(VALID_RAW);
  });

  it('上限超過なら送らなかった件数を info で記録する', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      await new GeminiProvider().generateVideoPlan({ ...input(), assets: manyAssets(AI_ASSET_SEND_MAX + 3) });
      expect(info).toHaveBeenCalledTimes(1);
      const msg = String(info.mock.calls[0]?.[0] ?? '');
      expect(msg).toContain(`上位 ${AI_ASSET_SEND_MAX} 件のみ送信`);
      expect(msg).toContain('3 件'); // 送らなかった件数
    } finally {
      info.mockRestore();
    }
  });

  it('上限以下なら記録しない（打ち切っていないのにログを出さない）', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      await new GeminiProvider().generateVideoPlan({ ...input(), assets: manyAssets(3) });
      expect(info).not.toHaveBeenCalled();
    } finally {
      info.mockRestore();
    }
  });

  it('記録した件数は、実際にプロンプトへ載らなかった件数と一致する（ログと送信内容がズレない）', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const total = AI_ASSET_SEND_MAX + 7;
      await new GeminiProvider().generateVideoPlan({ ...input(), assets: manyAssets(total) });
      // 実際に送った user 本文（aiGenerate の第4引数）に載っている素材数＝上限、差分がログの件数。
      const user = String(aiGenerateMock.mock.calls[0]?.[3] ?? '');
      const sentCount = (user.match(/assetId=asset_\d+/g) ?? []).length;
      expect(sentCount).toBe(AI_ASSET_SEND_MAX);
      expect(String(info.mock.calls[0]?.[0] ?? '')).toContain(`${total - sentCount} 件`);
    } finally {
      info.mockRestore();
    }
  });
});
