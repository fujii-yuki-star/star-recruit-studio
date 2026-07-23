import { describe, expect, it } from 'vitest';
import { AI_SCENE_MAX_DURATION_SEC, AI_SCENE_MIN_DURATION_SEC } from '../constants';
import { GENERAL_PURPOSES, VIDEO_KIND } from '../enums';
import type { Asset } from '../project/types';
import type { GenerateVideoPlanInput, TemplateSummary } from './aiProvider';
import {
  VIDEO_PLAN_SYSTEM_PROMPT,
  VIDEO_PLAN_SYSTEM_PROMPT_GENERAL,
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
    additionalNotes: '若手の挑戦を応援する社風を強調したい',
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
    expect(system).toContain(`durationSec は ${AI_SCENE_MIN_DURATION_SEC}〜${AI_SCENE_MAX_DURATION_SEC} 秒`);
  });

  it('ユーザーメッセージに会社情報・方針・素材・テンプレ・表情タグが入る', () => {
    const user = buildVideoPlanUserMessage(fullInput());
    expect(user).toContain('会社名: 株式会社ゆうこ');
    expect(user).toContain('事業内容: Webサービス開発');
    expect(user).toContain('アピールしたいこと（強み・伝えたい点）: リモート可、若手活躍');
    expect(user).toContain('# 補足・その他（利用者からの自由記述。動画づくりで特に重視する）');
    expect(user).toContain('若手の挑戦を応援する社風を強調したい');
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
    expect(user).toContain('アピールしたいこと（強み・伝えたい点）: （未入力）');
    expect(user).toContain('ターゲット: （未入力）');
    // additionalNotes 未設定なら補足セクションは出さない（「特に重視」見出し＋空欄の矛盾を避ける）。
    expect(user).not.toContain('# 補足・その他');
    expect(user).toContain('トーン: （未入力）');
    // テンプレ任意項目（useCase/requiredSlots/maxNarration）も未入力表記。
    expect(user).toContain('useCase=（未入力） / requiredSlots=（未入力）');
    expect(user).toContain('maxNarration=（未入力） / maxSubtitle=（未入力）');
    // 素材任意項目（説明/AI解析/tags）も未入力表記。
    expect(user).toContain('説明=（未入力） / AI解析=（未入力） / tags=（未入力）');
    // 表情タグ空。
    expect(user).toContain('# 利用可能なゆうこ表情タグ\n（未入力）');
  });

  // #547 P2-8：assetBlock は assetSentText 経由になり、name を trim し空白のみタグを落とす。
  // これは意図的＝送信前確認 UI が見せる値（trim 済み）とプロンプトが送る値を一致させるため（shown==sent・§2-6）。
  it('name を trim し、空白のみのタグは落として送る（確認 UI と同じ正規化）', () => {
    const input: GenerateVideoPlanInput = {
      ...fullInput(),
      assets: [
        { assetId: 'a1', assetType: 'image', displayName: '  田中さん.jpg  ', tags: ['  社員  ', '   ', ''], filePath: 'x.jpg' },
      ],
    };
    const user = buildVideoPlanUserMessage(input);
    expect(user).toContain('name=田中さん.jpg'); // 前後空白なし
    expect(user).toContain('tags=社員');          // 空白のみ・空要素は消える
    expect(user).not.toContain('name=  田中さん'); // 生値は送らない
  });

  it('名前が空白のみ・タグが全て空白のみなら「（未入力）」で送る（空文字を送らない）', () => {
    const input: GenerateVideoPlanInput = {
      ...fullInput(),
      assets: [
        { assetId: 'a1', assetType: 'image', displayName: '   ', tags: ['  ', ' '], filePath: 'x.jpg' },
      ],
    };
    const user = buildVideoPlanUserMessage(input);
    expect(user).toContain('name=（未入力）');
    expect(user).toContain('tags=（未入力）');
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
    // few-shot は採用サンプル（§7）。一般サンプルは混入しない。
    expect(user).toContain('株式会社サンプル 会社紹介');
    expect(user).not.toContain('今期のハイライト');
  });

  it('additionalNotes が空文字・空白のみなら補足セクションを出さない', () => {
    const base = fullInput();
    expect(
      buildVideoPlanUserMessage({ ...base, additionalNotes: '' }),
    ).not.toContain('# 補足・その他');
    expect(
      buildVideoPlanUserMessage({ ...base, additionalNotes: '   ' }),
    ).not.toContain('# 補足・その他');
  });

  it('videoKind 省略・recruit は採用システムプロンプト（§5）を使う', () => {
    expect(buildVideoPlanMessages(fullInput()).system).toBe(VIDEO_PLAN_SYSTEM_PROMPT);
    expect(buildVideoPlanMessages({ ...fullInput(), videoKind: VIDEO_KIND.recruit }).system).toBe(VIDEO_PLAN_SYSTEM_PROMPT);
  });

  it('videoKind 省略のユーザーメッセージは採用 few-shot を使う（一般サンプルは混入しない）', () => {
    const user = buildVideoPlanUserMessage(fullInput()); // videoKind 未指定＝recruit 扱い
    expect(user).toContain('株式会社サンプル 会社紹介');
    expect(user).not.toContain('今期のハイライト');
  });
});

function generalInput(): GenerateVideoPlanInput {
  return {
    videoKind: VIDEO_KIND.general,
    generalBrief: {
      title: '全社キックオフ2026',
      agenda: ['今期の方針', '重点プロジェクト', 'Q&A'],
      keyPoints: ['売上目標120%', '新製品の投入'],
    },
    purpose: 'report',
    targetAudience: '全社員',
    targetDurationSec: 90,
    tone: '落ち着いた',
    additionalNotes: '専門用語はかみ砕いて伝えたい',
    templates,
    assets,
    yukoPoseTags: ['smile', 'guide'],
  };
}

describe('buildVideoPlanMessages（一般・社内発表 general・§5b/§6b）', () => {
  it('videoKind=general は §5b の一般システムプロンプトを返す', () => {
    const { system } = buildVideoPlanMessages(generalInput());
    expect(system).toBe(VIDEO_PLAN_SYSTEM_PROMPT_GENERAL);
    expect(system).toContain('発表・説明動画の構成案');
    // 共通ルール（templateId 必須・sceneType=category・尺）は採用と同じく堅持。
    expect(system).toContain('各シーンに templateId を必ず設定');
    expect(system).toContain('sceneType は、選んだ templateId の category と同じ値にする');
    expect(system).toContain(`durationSec は ${AI_SCENE_MIN_DURATION_SEC}〜${AI_SCENE_MAX_DURATION_SEC} 秒`);
    // 章立て→parts・要点反映の一般固有指示。
    expect(system).toContain('「構成（章立て）」をパート（parts）に対応');
    expect(system).toContain('「伝えたい要点」を各シーンの texts や narrationText に反映');
    // 一般 purpose の列挙は GENERAL_PURPOSES（定数）から埋め込む（§2-7・ハードコードしない）。
    expect(system).toContain(GENERAL_PURPOSES.join(' / '));
    // 採用専用の語（会社情報）は一般プロンプトに出さない。
    expect(system).not.toContain('会社情報');
  });

  it('ユーザーメッセージはテーマ・章立て・要点・方針（種別/対象視聴者）を含む（§6b）', () => {
    const user = buildVideoPlanUserMessage(generalInput());
    expect(user).toContain('# 動画のテーマ');
    expect(user).toContain('タイトル/テーマ: 全社キックオフ2026');
    expect(user).toContain('# 構成（章立て・アジェンダ）');
    expect(user).toContain('- 今期の方針');
    expect(user).toContain('- 重点プロジェクト');
    expect(user).toContain('# 伝えたい要点');
    expect(user).toContain('- 売上目標120%');
    expect(user).toContain('種別(purpose): report');
    expect(user).toContain('対象視聴者: 全社員');
    // 補足・素材・見た目・表情タグ・出力契約は採用と共通。
    expect(user).toContain('# 補足・その他（利用者からの自由記述。動画づくりで特に重視する）');
    expect(user).toContain('専門用語はかみ砕いて伝えたい');
    expect(user).toContain('# 利用可能な見た目パターン（このIDのみ使用可）');
    expect(user).toContain('# 利用可能なゆうこ表情タグ');
    expect(user).toContain('# 出力フォーマット（厳守）');
    // 出力例の主語は用途で変える（general=テーマ・構成・要点）。
    expect(user).toContain('値だけ今回のテーマ・構成・要点・素材・見た目パターンに合わせて作る');
  });

  it('一般メッセージに採用専用セクション（会社情報・募集職種）を出さない', () => {
    const user = buildVideoPlanUserMessage(generalInput());
    expect(user).not.toContain('# 会社情報');
    expect(user).not.toContain('会社名:');
    expect(user).not.toContain('募集職種');
    expect(user).not.toContain('採用ページ');
  });

  it('章立て・要点が空/未設定なら（未入力）1行にする（空見出し＋空欄の矛盾を避ける）', () => {
    const input: GenerateVideoPlanInput = { ...generalInput(), generalBrief: { title: 'テーマのみ' } };
    const user = buildVideoPlanUserMessage(input);
    expect(user).toContain('タイトル/テーマ: テーマのみ');
    expect(user).toContain('# 構成（章立て・アジェンダ）\n（未入力）');
    expect(user).toContain('# 伝えたい要点\n（未入力）');
  });

  it('videoKind=general かつ generalBrief 未設定でも（未入力）で処理できる（実装③前の誤呼び出し耐性）', () => {
    const input: GenerateVideoPlanInput = {
      videoKind: VIDEO_KIND.general,
      purpose: 'general_other',
      targetDurationSec: 60,
      templates,
      assets,
      yukoPoseTags: [],
    };
    const user = buildVideoPlanUserMessage(input);
    expect(user).toContain('タイトル/テーマ: （未入力）');
    expect(user).toContain('# 構成（章立て・アジェンダ）\n（未入力）');
    expect(user).toContain('# 伝えたい要点\n（未入力）');
  });

  it('few-shot は一般サンプル（§7b）を使う＝採用サンプルは混入しない（ADR-0011 #7）', () => {
    const user = buildVideoPlanUserMessage(generalInput());
    expect(user).toContain('今期のハイライト'); // 一般 few-shot 固有の partTitle
    expect(user).toContain('"purpose": "report"'); // 出力例の一般 purpose（入力の「種別(purpose): report」とは別表記）
    expect(user).not.toContain('株式会社サンプル 会社紹介'); // 採用 few-shot は使わない
  });
});
