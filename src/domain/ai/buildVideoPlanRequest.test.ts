import { describe, expect, it } from 'vitest';
import { SCENE_MAX_DURATION_SEC, SCENE_MIN_DURATION_SEC } from '../constants';
import type { Asset } from '../project/types';
import type { GenerateVideoPlanInput, TemplateSummary } from './aiProvider';
import {
  VIDEO_PLAN_SYSTEM_PROMPT,
  buildVideoPlanMessages,
  buildVideoPlanUserMessage,
} from './buildVideoPlanRequest';

const templates: TemplateSummary[] = [
  {
    templateId: 'opening_yuko_right_v1',
    category: 'opening',
    useCase: '冒頭のあいさつ',
    requiredSlots: ['slot_main'],
    hasYuko: true,
    maxNarrationLength: 120,
    maxSubtitleLength: 60,
    maxDurationSec: 12,
  },
];

const assets: Asset[] = [
  {
    assetId: 'asset_photo_001',
    assetType: 'image',
    displayName: 'オフィス外観',
    filePath: 'assets/images/office.jpg',
    tags: ['オフィス', '外観'],
    description: '本社ビルの外観',
    aiDescription: '青空の下のガラス張りビル',
  },
];

function fullInput(): GenerateVideoPlanInput {
  return {
    companyInfo: {
      companyName: '株式会社ゆうこ',
      industry: 'IT',
      businessDescription: 'Webサービス開発',
      jobType: 'エンジニア',
      recruitTarget: '新卒',
      strengths: ['リモート可', '若手活躍'],
      desiredPerson: '主体的に動ける人',
      recruitUrl: 'https://example.com/recruit',
    },
    purpose: 'new_graduate',
    targetAudience: '理系学生',
    targetDurationSec: 60,
    tone: '明るく親しみやすい',
    templates,
    assets,
    yukoPoseTags: ['smile', 'guide', 'bow'],
  };
}

describe('buildVideoPlanMessages', () => {
  it('システムプロンプトは 12§5 の確定版を返す', () => {
    const { system } = buildVideoPlanMessages(fullInput());
    expect(system).toBe(VIDEO_PLAN_SYSTEM_PROMPT);
    // 厳守事項の要点が含まれる（出力契約・ID/asset 制約・null 化）。
    expect(system).toContain('構成案');
    // templateId は必須＋一覧内のみ・sceneType は category 一致（障害の根本原因を §5 で防ぐ）。
    expect(system).toContain('各シーンに templateId を必ず設定');
    expect(system).toContain('「利用可能な見た目パターン一覧」に存在するIDのみ');
    expect(system).toContain('sceneType は、選んだ templateId の category と同じ値にする');
    expect(system).toContain('該当が無ければ null');
    // 尺の目安は 11§4 の定数を埋め込む（検証側 clamp と黙って矛盾しない＝§2-7）。
    expect(system).toContain(`durationSec は ${SCENE_MIN_DURATION_SEC}〜${SCENE_MAX_DURATION_SEC} 秒`);
  });

  it('ユーザーメッセージに会社情報・方針・素材・テンプレ・表情タグが入る', () => {
    const user = buildVideoPlanUserMessage(fullInput());
    expect(user).toContain('会社名: 株式会社ゆうこ');
    expect(user).toContain('事業内容: Webサービス開発');
    expect(user).toContain('強み: リモート可、若手活躍');
    expect(user).toContain('目的(purpose): new_graduate');
    expect(user).toContain('希望尺(秒): 60');
    expect(user).toContain('templateId=opening_yuko_right_v1 / category=opening / hasYuko=true');
    expect(user).toContain('requiredSlots=slot_main');
    expect(user).toContain('maxNarration=120 / maxSubtitle=60 / maxDuration=12');
    expect(user).toContain('assetId=asset_photo_001 / type=image / name=オフィス外観');
    expect(user).toContain('説明=本社ビルの外観 / AI解析=青空の下のガラス張りビル / tags=オフィス, 外観');
    expect(user).toContain('# 利用可能なゆうこ表情タグ');
    expect(user).toContain('smile, guide, bow');
  });

  it('MVP はテキストのみ＝サムネイル添付の文言を含めない（12§4 更新・P3 へ）', () => {
    const user = buildVideoPlanUserMessage(fullInput());
    expect(user).not.toContain('サムネイル');
    expect(user).not.toContain('添付');
  });

  it('任意項目が空のときは（未入力）で埋める', () => {
    const input: GenerateVideoPlanInput = {
      companyInfo: { companyName: '最小会社' },
      purpose: 'company_intro',
      targetDurationSec: 30,
      templates: [
        { templateId: 't1', category: 'message', hasYuko: false },
      ],
      assets: [
        { assetId: 'a1', assetType: 'image', displayName: '無題', filePath: 'x.jpg' },
      ],
      yukoPoseTags: [],
    };
    const user = buildVideoPlanUserMessage(input);
    expect(user).toContain('会社名: 最小会社');
    expect(user).toContain('業種: （未入力）');
    expect(user).toContain('強み: （未入力）');
    expect(user).toContain('ターゲット: （未入力）');
    expect(user).toContain('トーン: （未入力）');
    // テンプレ任意項目（useCase/requiredSlots/maxNarration）も未入力表記。
    expect(user).toContain('useCase=（未入力） / requiredSlots=（未入力）');
    expect(user).toContain('maxNarration=（未入力） / maxSubtitle=（未入力）');
    // 素材任意項目（説明/AI解析/tags）も未入力表記。
    expect(user).toContain('説明=（未入力） / AI解析=（未入力） / tags=（未入力）');
    // 表情タグ空。
    expect(user).toContain('# 利用可能なゆうこ表情タグ\n（未入力）');
  });

  it('複数素材・複数テンプレを各行に展開する', () => {
    const input = fullInput();
    input.assets = [
      ...assets,
      { assetId: 'asset_video_001', assetType: 'video', displayName: '社員インタビュー', filePath: 'v.mp4' },
    ];
    const user = buildVideoPlanUserMessage(input);
    expect(user).toContain('assetId=asset_photo_001');
    expect(user).toContain('assetId=asset_video_001 / type=video / name=社員インタビュー');
  });

  it('requiredSlots が空配列なら「なし」＝未提供（未入力）と区別する', () => {
    const input = fullInput();
    input.templates = [
      { templateId: 't_no_slot', category: 'message', hasYuko: false, requiredSlots: [] },
    ];
    const user = buildVideoPlanUserMessage(input);
    expect(user).toContain('requiredSlots=なし');
    expect(user).not.toContain('requiredSlots=（未入力）');
  });

  it('テンプレ・素材が空配列でも例外なくセクション見出しは保たれる（上流バリデーションで非空を担保する前提）', () => {
    const input = fullInput();
    input.templates = [];
    input.assets = [];
    const user = buildVideoPlanUserMessage(input);
    expect(user).toContain('# 利用可能な見た目パターン（このIDのみ使用可）');
    expect(user).toContain('# 利用可能な素材（このassetIdのみ使用可）');
    expect(user).toContain('# 利用可能なゆうこ表情タグ');
  });

  it('出力フォーマット（12§7 例・厳守指示）をユーザーメッセージに含める', () => {
    const user = buildVideoPlanUserMessage(fullInput());
    expect(user).toContain('# 出力フォーマット（厳守）');
    expect(user).toContain('schemaVersion・videoPlan・parts（必須）と reviewNotes（任意）');
    // 各シーンは利用可能テンプレに縛る（templateId 必須・sceneType は category 一致）。
    expect(user).toContain('各シーンに templateId を必ず設定する');
    expect(user).toContain('sceneType は、選んだ templateId の category と同じ値にする');
    // 型を例に揃える（文字列項目を配列/オブジェクトにしない＝targetAudience 等の型ズレ防止）。
    expect(user).toContain('各フィールドの型は出力例と同じにする');
    // 正典 fixture（ai-video-plan.sample）の構造が出力例として入っている。
    expect(user).toContain('"schemaVersion": "1.0"');
    expect(user).toContain('"videoPlan"');
    expect(user).toContain('"parts"');
  });
});
