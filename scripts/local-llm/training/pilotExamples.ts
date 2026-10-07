// 追加学習（ADR-0052 段階4・#1294）の学習材料の試作 5 件。入力は架空の会社・社内の話題、理想の動画案は Claude が書いた。
// ⚠️ 利用者がレビューしてから材料にする（2026-10-01 利用者判断）。会社名は {会社名}・採用ページは {採用ページ}（アプリの指示どおり）。
import type { GenerateVideoPlanInput } from '../../../src/domain/ai/aiProvider';
import type { AiVideoPlan } from '../../../src/domain/ai/types';
import type { Asset } from '../../../src/domain/project/types';

export interface TrainingExample {
  id: string;
  /** 指示文の入力（見た目パターンの一覧は組み立て時に足す）。 */
  input: Omit<GenerateVideoPlanInput, 'templates'>;
  /** 理想の動画案。 */
  plan: AiVideoPlan;
}

const photo = (id: string, aiDescription: string, tags: string[], assetType: 'image' | 'video' = 'image'): Asset =>
  ({ assetId: id, assetType, displayName: `IMG_${id}`, filePath: `assets/${id}.jpg`, aiDescription, tags }) as Asset;
const yuko = [
  { assetId: 'yuko_smile_001', assetType: 'yuko', displayName: 'ゆうこ_笑顔', filePath: 'y1.png', tags: ['smile'] },
  { assetId: 'yuko_guide_001', assetType: 'yuko', displayName: 'ゆうこ_案内', filePath: 'y2.png', tags: ['guide'] },
] as Asset[];
const poses = ['smile', 'guide'];

export const PILOT_EXAMPLES: TrainingExample[] = [
  {
    id: 'pilot-01-care-new-graduate',
    input: {
      videoKind: 'recruit', purpose: 'new_graduate', targetDurationSec: 60, tone: '丁寧・落ち着いた', yukoPoseTags: poses,
      targetAudience: '福祉系・未経験の新卒',
      companyInfo: {
        companyName: '株式会社ひだまりケア', industry: '介護', businessDescription: 'デイサービスと訪問介護を市内3か所で運営',
        jobType: '介護スタッフ', recruitTarget: '新卒（福祉系・未経験可）', strengths: ['資格取得の費用を会社が負担', '月の残業は平均5時間', '利用者さんと話す時間を大切にしている'],
        desiredPerson: '人の話をじっくり聞ける人', recruitUrl: 'https://example.jp/hidamari/recruit',
      },
      assets: [
        photo('c01', 'デイサービスで高齢の女性と笑顔で話す若い女性スタッフ', ['会話', '笑顔', 'スタッフ']),
        photo('c02', '明るい広間でレクリエーションをする利用者とスタッフ', ['レクリエーション', '広間']),
        photo('c03', '研修室で先輩が新人に車いすの扱いを教えている', ['研修', '新人']),
        photo('c04', '白い建物の入口と看板', ['外観', '建物']),
        ...yuko,
      ],
    },
    plan: {
      schemaVersion: '1.0',
      videoPlan: { title: '話を聞くことから始まる仕事', purpose: 'new_graduate', targetAudience: '福祉系・未経験の新卒', targetDurationSec: 60, tone: '丁寧・落ち着いた' },
      parts: [
        { partTitle: 'はじめに', scenes: [
          { sceneType: 'opening', templateId: 'opening_yuko_right_v1', durationSec: 7, yukoPoseTag: 'smile',
            texts: { title: '話を聞くことから始まる仕事', subtitle: '{会社名}の介護スタッフのお仕事' },
            narrationText: 'こんにちは、ゆうこです。本日は、{会社名}の介護スタッフのお仕事をご紹介します。' },
          { sceneType: 'full_visual', templateId: 'full_visual_v1', durationSec: 8, yukoPoseTag: 'guide', assetRefs: { mainVisual: 'c04' },
            texts: { title: '通所でも、ご自宅でも', subtitle: '市内3か所でデイサービスと訪問介護' },
            narrationText: '私たちは市内3か所で、デイサービスと訪問介護を運営しています。',
            notes: '事業所の建物の外観' },
        ] },
        { partTitle: '大切にしていること', scenes: [
          { sceneType: 'photo_intro', templateId: 'photo_left_text_right_yuko_v1', durationSec: 11, yukoPoseTag: 'guide', assetRefs: { mainVisual: 'c01' },
            texts: { title: '利用者さんとの時間', subtitle: 'お話しする時間を大切にしています' },
            narrationText: '何より大切にしているのは、利用者さんとお話しする時間です。一人ひとりの声に、じっくり耳を傾けています。',
            notes: '利用者さんと笑顔で話すスタッフの写真' },
          { sceneType: 'full_visual', templateId: 'full_visual_yuko_left_v1', durationSec: 7, yukoPoseTag: 'smile', assetRefs: { mainVisual: 'c02' },
            texts: { title: 'みなさんと一緒に', subtitle: 'レクリエーションもスタッフと一緒に' },
            narrationText: '広間でのレクリエーションも、スタッフが利用者さんと一緒に楽しんでいます。',
            notes: 'レクリエーションの様子' },
        ] },
        { partTitle: '安心して始められる理由', scenes: [
          { sceneType: 'photo_intro', templateId: 'photo_right_text_left_yuko_v1', durationSec: 11, yukoPoseTag: 'guide', assetRefs: { mainVisual: 'c03' },
            texts: { title: '未経験でも歓迎', subtitle: '資格取得の費用は会社が負担します' },
            narrationText: '福祉を学んできた新卒の方も、未経験の方も歓迎しております。研修では先輩が直接教え、資格取得の費用は会社が負担いたします。',
            notes: '先輩が新人に教えている研修の写真' },
          { sceneType: 'point_list', templateId: 'point_list_yuko_v1', durationSec: 8, yukoPoseTag: 'guide',
            texts: { title: '働きやすさ', main: '月の残業は平均5時間', subtitle: '月の残業は平均5時間です' },
            narrationText: '月の残業は、平均5時間です。' },
        ] },
        { partTitle: 'おわりに', scenes: [
          { sceneType: 'closing', templateId: 'closing_yuko_v1', durationSec: 8, yukoPoseTag: 'smile',
            texts: { title: 'お待ちしております', subtitle: '人の話をじっくり聞ける方へ', url: '{採用ページ}' },
            narrationText: '人の話をじっくり聞ける方を、心よりお待ちしております。詳しくは採用ページをご覧ください。' },
        ] },
      ],
    },
  },
  {
    id: 'pilot-02-it-engineer-no-photos',
    input: {
      videoKind: 'recruit', purpose: 'engineer', targetDurationSec: 60, tone: '親しみやすい', yukoPoseTags: poses,
      targetAudience: '中途のエンジニア',
      companyInfo: {
        companyName: '株式会社クラウドリンク', industry: 'IT', businessDescription: '飲食店向けの予約管理サービスを開発・運営',
        jobType: 'Webエンジニア', recruitTarget: '中途（実務経験2年以上）', strengths: ['週3日まで在宅勤務できる', '利用者の声が開発チームに直接届く', '技術書の購入を会社が支援'],
        desiredPerson: '使う人の困りごとから考えられる人', recruitUrl: 'https://example.jp/cloudlink/careers',
      },
      assets: [...yuko],
    },
    plan: {
      schemaVersion: '1.0',
      videoPlan: { title: '使う人の声から作る開発', purpose: 'engineer', targetAudience: '中途のエンジニア', targetDurationSec: 60, tone: '親しみやすい' },
      parts: [
        { partTitle: 'はじめに', scenes: [
          { sceneType: 'opening', templateId: 'opening_yuko_left_v1', durationSec: 8, yukoPoseTag: 'smile',
            texts: { title: '使う人の声から作る開発', subtitle: '{会社名}のWebエンジニア募集' },
            narrationText: 'こんにちは、ゆうこです。今日は、{会社名}のWebエンジニアのお仕事を紹介しますね。' },
          { sceneType: 'message', templateId: 'message_yuko_v1', durationSec: 11, yukoPoseTag: 'guide',
            texts: { title: 'どんなサービス？', main: '飲食店の予約管理を支えるサービス', subtitle: '飲食店向けの予約管理サービスです' },
            narrationText: '{会社名}が作っているのは、飲食店向けの予約管理サービスです。このサービスを、自分たちの手で開発し、運営しています。' },
        ] },
        { partTitle: '開発のおもしろさ', scenes: [
          { sceneType: 'message', templateId: 'message_yuko_left_v1', durationSec: 13, yukoPoseTag: 'guide',
            texts: { title: '声が直接届く', main: 'お店の人の声が、そのまま開発チームへ', subtitle: '利用者の声が開発チームに直接届きます' },
            narrationText: '開発チームには、サービスを使うお店の人の声が直接届くんです。誰が何に困っているのかを知ったうえで、開発に向き合えますよ。' },
          { sceneType: 'point_list', templateId: 'point_list_yuko_v1', durationSec: 16, yukoPoseTag: 'guide',
            texts: { title: '働きやすさ', main: '在宅勤務は週3日まで／技術書の購入を支援', subtitle: '在宅勤務と学びの支援があります' },
            narrationText: '在宅勤務は週3日までできます。新しい技術を学びたいときは、技術書の購入を会社が支援してくれるので、気になる本も手に取りやすいですよ。' },
        ] },
        { partTitle: 'こんな方を', scenes: [
          { sceneType: 'closing', templateId: 'closing_yuko_left_v1', durationSec: 10, yukoPoseTag: 'smile',
            texts: { title: '一緒に作りませんか', subtitle: '使う人の困りごとから考えられる方へ', url: '{採用ページ}' },
            narrationText: '使う人の困りごとから考えられる方、実務経験が2年以上ある方を待っていますね。詳しくは採用ページへどうぞ。' },
        ] },
      ],
    },
  },
  {
    id: 'pilot-03-factory-bright-30s',
    input: {
      videoKind: 'recruit', purpose: 'inexperienced_welcome', targetDurationSec: 30, tone: '明るい・元気', yukoPoseTags: poses,
      targetAudience: '未経験の若手',
      companyInfo: {
        companyName: '株式会社みなと精工', industry: '製造', businessDescription: '自動車部品の金属加工',
        jobType: '製造スタッフ', recruitTarget: '未経験歓迎', strengths: ['入社後3か月は先輩がマンツーマンで指導', '20代の社員が半数'],
        desiredPerson: 'ものづくりに興味がある人', recruitUrl: 'https://example.jp/minato/recruit',
      },
      assets: [
        photo('m01', '工場で金属部品を測定する若い男性社員', ['工場', '測定', '若手']),
        photo('m02', '機械の前で先輩が後輩に操作を教えている動画', ['指導', '機械'], 'video'),
        photo('m03', '完成した金属部品が並んでいる', ['部品', '製品']),
        ...yuko,
      ],
    },
    plan: {
      schemaVersion: '1.0',
      videoPlan: { title: 'ものづくり、はじめよう！', purpose: 'inexperienced_welcome', targetAudience: '未経験の若手', targetDurationSec: 30, tone: '明るい・元気' },
      parts: [
        { partTitle: 'みなとのものづくり', scenes: [
          { sceneType: 'opening', templateId: 'opening_yuko_right_v1', durationSec: 5, yukoPoseTag: 'smile',
            texts: { title: 'ものづくり、はじめよう！', subtitle: '{会社名}で製造スタッフ募集！' },
            narrationText: 'こんにちは、ゆうこだよ！{会社名}を紹介するね！' },
          { sceneType: 'full_visual', templateId: 'full_visual_v1', durationSec: 6, yukoPoseTag: 'guide', assetRefs: { mainVisual: 'm03' },
            texts: { title: '自動車の部品をつくる', subtitle: '金属から部品を作っています' },
            narrationText: 'ここでは、自動車の部品を金属から作っているんだ。',
            notes: '完成した金属部品' },
          { sceneType: 'video_intro', templateId: 'video_intro_yuko_v1', durationSec: 8, yukoPoseTag: 'guide', assetRefs: { mainVisual: 'm02' },
            texts: { title: '未経験でも大丈夫', subtitle: '3か月は先輩がマンツーマンで指導' },
            narrationText: '未経験でも大丈夫。入社して3か月は、先輩がマンツーマンで教えてくれるよ！',
            notes: '先輩が機械の操作を教えている動画' },
          { sceneType: 'photo_intro', templateId: 'photo_left_text_right_yuko_v1', durationSec: 6, yukoPoseTag: 'smile', assetRefs: { mainVisual: 'm01' },
            texts: { title: '20代が半数！', subtitle: '若い仲間がたくさん' },
            narrationText: '社員の半分は20代！若い仲間がたくさんいるよ！',
            notes: '部品を測定している若い社員の写真' },
          { sceneType: 'closing', templateId: 'closing_yuko_v1', durationSec: 5, yukoPoseTag: 'smile',
            texts: { title: '待ってるよ！', subtitle: 'ものづくりに興味がある人へ', url: '{採用ページ}' },
            narrationText: 'ものづくりに興味がある人、待ってるよ！' },
        ] },
      ],
    },
  },
  {
    id: 'pilot-04-general-security-formal',
    input: {
      videoKind: 'general', purpose: 'general_announcement', targetDurationSec: 60, tone: 'フォーマル', yukoPoseTags: poses,
      targetAudience: '全社員',
      generalBrief: {
        title: '情報セキュリティ研修の受講のお願い', agenda: ['研修の目的', '受講の方法', '期限とお問い合わせ'],
        keyPoints: ['全社員が対象', '社内ポータルから受講（約30分）', '10月31日までに受講', '問い合わせは情報システム部'], targetAudience: '全社員',
      },
      assets: [
        photo('s01', 'ノートパソコンで社内ポータルを開いている手元', ['パソコン', 'ポータル']),
        photo('s02', '会議室で講師が説明している様子', ['研修', '説明']),
        ...yuko,
      ],
    },
    plan: {
      schemaVersion: '1.0',
      videoPlan: { title: '情報セキュリティ研修の受講のお願い', purpose: 'general_announcement', targetAudience: '全社員', targetDurationSec: 60, tone: 'フォーマル' },
      parts: [
        { partTitle: 'はじめに', scenes: [
          { sceneType: 'opening', templateId: 'opening_yuko_right_v1', durationSec: 9, yukoPoseTag: 'guide',
            texts: { title: '情報セキュリティ研修', subtitle: '受講についてのご案内です' },
            narrationText: '全社員の皆さまへ、情報セキュリティ研修の受講についてご案内いたします。' },
        ] },
        { partTitle: '研修の目的', scenes: [
          { sceneType: 'photo_intro', templateId: 'photo_left_text_right_yuko_v1', durationSec: 12, yukoPoseTag: 'guide', assetRefs: { mainVisual: 's02' },
            texts: { title: '研修の目的・対象', subtitle: '全社員の皆さまに受講をお願いしております' },
            narrationText: '本研修は、全社員の皆さまに受講をお願いしております。',
            notes: '研修で説明している様子の写真' },
        ] },
        { partTitle: '受講の方法', scenes: [
          { sceneType: 'photo_intro', templateId: 'photo_right_text_left_yuko_v1', durationSec: 14, yukoPoseTag: 'guide', assetRefs: { mainVisual: 's01' },
            texts: { title: '社内ポータルから受講', subtitle: '所要時間は約30分です' },
            narrationText: '研修は、社内ポータルから受講いただけます。所要時間は約30分です。',
            notes: 'パソコンで社内ポータルを開いている写真' },
        ] },
        { partTitle: '期限とお問い合わせ', scenes: [
          { sceneType: 'point_list', templateId: 'point_list_yuko_v1', durationSec: 15, yukoPoseTag: 'guide',
            texts: { title: '期限とお問い合わせ', main: '受講期限：10月31日／お問い合わせ：情報システム部', subtitle: '期限は10月31日です' },
            narrationText: '受講の期限は10月31日です。ご不明な点は、情報システム部までお問い合わせください。' },
          { sceneType: 'closing', templateId: 'closing_yuko_v1', durationSec: 10, yukoPoseTag: 'smile',
            texts: { title: 'ご協力のお願い', subtitle: '10月31日までの受講をお願いいたします' },
            narrationText: 'お忙しいところ恐れ入りますが、10月31日までの受講をお願いいたします。' },
        ] },
      ],
    },
  },
  {
    id: 'pilot-05-general-report-30s',
    input: {
      videoKind: 'general', purpose: 'report', targetDurationSec: 30, tone: '親しみやすい', yukoPoseTags: poses,
      targetAudience: '営業部のメンバー',
      generalBrief: {
        title: '上半期のふりかえり', agenda: ['よかったこと', 'これからの課題'],
        keyPoints: ['新規のお客さまが前年より15件増えた', '提案資料のひな形を共通化した', '下半期は既存のお客さまへの訪問を増やす'], targetAudience: '営業部のメンバー',
      },
      assets: [...yuko],
    },
    plan: {
      schemaVersion: '1.0',
      videoPlan: { title: '上半期のふりかえり', purpose: 'report', targetAudience: '営業部のメンバー', targetDurationSec: 30, tone: '親しみやすい' },
      parts: [
        { partTitle: 'よかったこと', scenes: [
          { sceneType: 'opening', templateId: 'opening_yuko_left_v1', durationSec: 6, yukoPoseTag: 'smile',
            texts: { title: '上半期のふりかえり', subtitle: '営業部のみなさん、おつかれさまです' },
            narrationText: '営業部のみなさん、おつかれさまです。上半期をふりかえってみましょう。' },
          { sceneType: 'point_list', templateId: 'point_list_yuko_v1', durationSec: 7, yukoPoseTag: 'guide',
            texts: { title: 'よかったこと', main: '新規のお客さま 前年より15件増', subtitle: '新規のお客さまが15件増えました' },
            narrationText: '新規のお客さまは、前年より15件も増えたんです。' },
          { sceneType: 'point_list', templateId: 'point_list_left_yuko_v1', durationSec: 6, yukoPoseTag: 'smile',
            texts: { title: 'ひな形を共通化', main: '提案資料のひな形を共通化', subtitle: '提案資料のひな形を共通化しました' },
            narrationText: '提案資料のひな形も、共通化できましたね。' },
        ] },
        { partTitle: 'これからの課題', scenes: [
          { sceneType: 'message', templateId: 'message_yuko_v1', durationSec: 6, yukoPoseTag: 'guide',
            texts: { title: 'これからの課題', main: '既存のお客さまへの訪問を増やす', subtitle: '下半期は訪問を増やします' },
            narrationText: '下半期は、いまのお客さまへの訪問を増やしていきます。' },
          { sceneType: 'closing', templateId: 'closing_yuko_left_v1', durationSec: 5, yukoPoseTag: 'smile',
            texts: { title: 'この勢いで', subtitle: 'いまのお客さまにも会いに行きましょう' },
            narrationText: '新規が15件増えたこの勢いで、いまのお客さまにも会いに行きましょうね。' },
        ] },
      ],
    },
  },
];
