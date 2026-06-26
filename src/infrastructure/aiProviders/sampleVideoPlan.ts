// docs/yuko_recruit_docs/fixtures/ai-video-plan.sample.json をミラーした型付きサンプル。
// MockAiProvider が返す。スキーマ正典は schemas/ai-video-plan.schema.json。
import type { AiVideoPlan } from '../../domain/ai/types';

export const SAMPLE_VIDEO_PLAN: AiVideoPlan = {
  schemaVersion: '1.0',
  videoPlan: {
    title: '株式会社サンプル 会社紹介',
    purpose: 'new_graduate',
    targetAudience: '新卒採用',
    targetDurationSec: 60,
    tone: '親しみやすい',
  },
  parts: [
    {
      partTitle: 'オープニング',
      summary: '会社名と雰囲気を伝える導入',
      targetDurationSec: 16,
      scenes: [
        {
          sceneTitle: 'はじめの挨拶',
          sceneType: 'opening',
          templateId: 'opening_yuko_right_v1',
          durationSec: 8,
          assetRefs: { background: 'asset_entrance_001', logo: 'asset_logo_001' },
          yukoPoseTag: 'smile',
          texts: {
            title: '株式会社サンプルへようこそ',
            main: '若手が活躍できる職場です',
            subtitle: '今日は会社の魅力を紹介します。',
          },
          narrationText: 'こんにちは、ゆうこです。今日は株式会社サンプルの魅力を紹介します。',
          notes: '冒頭なので明るい印象にする',
        },
      ],
    },
    {
      partTitle: '会社紹介',
      summary: 'オフィスと働く環境',
      targetDurationSec: 44,
      scenes: [
        {
          sceneTitle: 'オフィス紹介',
          sceneType: 'photo_intro',
          templateId: 'photo_left_text_right_yuko_v1',
          durationSec: 10,
          assetRefs: { mainVisual: 'asset_office_001' },
          yukoPoseTag: 'guide',
          texts: {
            title: '明るいオフィス',
            main: '相談しやすい雰囲気',
            subtitle: '風通しの良い職場で働けます。',
          },
          narrationText: '私たちのオフィスは、明るく相談しやすい雰囲気です。',
        },
      ],
    },
  ],
  reviewNotes: ['素材に人物が含まれるため公開前に映り込みを確認してください。'],
};

// 一般・社内発表（videoKind=general）用の固定サンプル（ADR-0011 #8 の Mock 側）。
// 採用サンプルと同じサンプル素材ID／テンプレを使い（変換が破綻しない）、内容を発表・説明調にしたもの。
// 尺は全シーン合計＝videoPlan.targetDurationSec（12+12+12=36）に整合させる（few-shot と同方針）。
export const GENERAL_SAMPLE_VIDEO_PLAN: AiVideoPlan = {
  schemaVersion: '1.0',
  videoPlan: {
    title: '全社共有：今期のご報告',
    purpose: 'report',
    targetAudience: '全社員',
    targetDurationSec: 36,
    tone: '丁寧・落ち着いた',
  },
  parts: [
    {
      partTitle: 'オープニング',
      summary: '発表のテーマと進め方を伝える導入',
      targetDurationSec: 12,
      scenes: [
        {
          sceneTitle: 'はじめに',
          sceneType: 'opening',
          templateId: 'opening_yuko_right_v1',
          durationSec: 12,
          assetRefs: { background: 'asset_entrance_001', logo: 'asset_logo_001' },
          yukoPoseTag: 'smile',
          texts: {
            title: '全社共有：今期のご報告',
            main: '成果と来期の方針',
            subtitle: '本日の内容を順にご説明します。',
          },
          narrationText: 'みなさん、こんにちは。今期の成果と来期の方針について、順番にご説明します。',
          notes: '発表の導入。落ち着いた印象にする',
        },
      ],
    },
    {
      partTitle: '今期の報告',
      summary: '主要な成果と来期の方針',
      targetDurationSec: 24,
      scenes: [
        {
          sceneTitle: '今期の成果',
          sceneType: 'photo_intro',
          templateId: 'photo_left_text_right_yuko_v1',
          durationSec: 12,
          assetRefs: { mainVisual: 'asset_office_001' },
          yukoPoseTag: 'guide',
          texts: {
            title: '今期の成果',
            main: '目標を達成しました',
            subtitle: '日々のご協力に感謝します。',
          },
          narrationText: '今期は目標を達成することができました。日々のご協力に感謝いたします。',
        },
        {
          sceneTitle: '来期に向けて',
          sceneType: 'photo_intro',
          templateId: 'photo_left_text_right_yuko_v1',
          durationSec: 12,
          assetRefs: { mainVisual: 'asset_office_001' },
          yukoPoseTag: 'guide',
          texts: {
            title: '来期に向けて',
            main: '挑戦を続けます',
            subtitle: '引き続きよろしくお願いします。',
          },
          narrationText: '来期も、挑戦を続ける一年にしたいと思います。引き続き、ご協力をお願いします。',
        },
      ],
    },
  ],
  reviewNotes: ['社外秘の情報が含まれていないか、公開前にご確認ください。'],
};
