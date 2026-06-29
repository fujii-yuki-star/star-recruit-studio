// 画面用のUIモデルとモックデータ。
// 後から本物のデータ層（src/domain）に差し替えられるよう、UI専用の軽量な型で定義する。
import type { Purpose } from "../../domain/enums";

export type ScreenId =
  | "home"
  | "wizard"
  | "confirm"
  | "generating"
  | "draft"
  | "scene-edit"
  | "preview"
  | "export"
  | "precheck"
  | "looks"
  | "looks-edit"
  | "materials"
  | "settings"
  | "about";

// 読み上げの声（ナレーション）の作成状態
export type VoiceStatus = "none" | "pending" | "generated" | "failed";

export interface RecentProject {
  id: string;
  name: string;
  purpose: string;
  updatedAt: string;
  sceneCount: number;
  durationLabel: string;
}

export interface DraftRow {
  id: string;
  order: number;
  part: string;
  scene: string;
  material: string;
  line: string; // セリフ
  look: string; // 見た目
  materialType: "photo" | "video" | "none";
  voiceStatus: VoiceStatus;
}

export interface MaterialItem {
  id: string;
  name: string;
  type: "photo" | "video" | "audio";
  description?: string;
  tags?: string[];
  checked?: boolean; // 公開チェック済み
}

export interface YukoMaterial {
  id: string;
  name: string;
  tag: string; // 表情タグ（smile / guide / bow など）
}

export interface LookPattern {
  id: string;
  name: string;
  category: string;
  createdAt: string;
  updatedAt: string;
  elements: string[];
  description: string;
}

// 自動補正・確認の通知（たたき台確認で表示）
export interface DraftWarning {
  message: string;
  severity: "info" | "warning";
}

// 目的の選択肢1件分（id は Purpose enum 値・label/desc はUI表示）。
export interface PurposeOption {
  id: Purpose;
  label: string;
  desc: string;
}

// ---- サンプル会社情報 ----
export const sampleCompany = {
  companyName: "株式会社サンプル",
  industry: "IT・業務システム開発",
  jobType: "エンジニア（新卒）",
  strengths: ["相談しやすい環境", "若手が成長しやすい"],
};

// ---- 最近のプロジェクト ----
export const recentProjects: RecentProject[] = [
  {
    id: "p1",
    name: "会社紹介動画_2026春",
    purpose: "会社紹介",
    updatedAt: "2026/06/08",
    sceneCount: 12,
    durationLabel: "1分30秒",
  },
  {
    id: "p2",
    name: "新卒採用_エンジニア",
    purpose: "新卒採用",
    updatedAt: "2026/06/05",
    sceneCount: 9,
    durationLabel: "1分10秒",
  },
  {
    id: "p3",
    name: "社員インタビュー_営業部",
    purpose: "社員紹介",
    updatedAt: "2026/05/28",
    sceneCount: 7,
    durationLabel: "55秒",
  },
  {
    id: "p4",
    name: "企業ブランドムービー",
    purpose: "ブランド紹介",
    updatedAt: "2026/05/20",
    sceneCount: 14,
    durationLabel: "1分45秒",
  },
];

// ---- 動画のたたき台 ----
export const draftRows: DraftRow[] = [
  {
    id: "d1",
    order: 1,
    part: "はじめに",
    scene: "挨拶",
    material: "会社外観",
    line: "こんにちは、ゆうこです。今日は株式会社サンプルの魅力を紹介します。",
    look: "オープニング",
    materialType: "photo",
    voiceStatus: "generated",
  },
  {
    id: "d2",
    order: 2,
    part: "会社紹介",
    scene: "オフィス",
    material: "オフィス写真",
    line: "明るく相談しやすい雰囲気の職場です。",
    look: "写真紹介",
    materialType: "photo",
    voiceStatus: "pending",
  },
  {
    id: "d3",
    order: 3,
    part: "仕事紹介",
    scene: "働く様子",
    material: "仕事中の様子",
    line: "チームで協力しながら、お客様の課題を解決しています。",
    look: "動画紹介",
    materialType: "video",
    voiceStatus: "none",
  },
  {
    id: "d4",
    order: 4,
    part: "さいごに",
    scene: "メッセージ",
    material: "社員の集合写真",
    line: "一緒に、よりよい未来をつくっていきましょう。ご応募お待ちしています。",
    look: "締めのメッセージ",
    materialType: "photo",
    voiceStatus: "failed",
  },
];

// ---- 自動補正・確認の通知（たたき台確認で表示するサンプル） ----
export const sampleWarnings: DraftWarning[] = [
  {
    message: "見た目パターンが見つからない場面があったため、標準の見た目に調整しました。",
    severity: "info",
  },
  {
    message: "表示時間が長い場面を、見やすい長さに調整しました。",
    severity: "info",
  },
  {
    message: "字幕が少し長い場面が1件あります。短くすると読みやすくなります。",
    severity: "warning",
  },
];

// ---- 素材一覧 ----
export const materials: MaterialItem[] = [
  { id: "m1", name: "会社外観", type: "photo", description: "本社ビルの外観", tags: ["外観", "建物"], checked: true },
  { id: "m2", name: "オフィス写真", type: "photo", description: "執務エリアの様子", tags: ["オフィス", "社内"], checked: true },
  { id: "m3", name: "社員の集合写真", type: "photo", description: "チームの集合写真", tags: ["社員", "集合"], checked: false },
  { id: "m4", name: "受付エリア", type: "photo", description: "エントランスの受付", tags: ["受付"], checked: true },
  { id: "m5", name: "仕事中の様子", type: "video", description: "作業風景の動画", tags: ["仕事", "作業"], checked: false },
  { id: "m6", name: "ミーティング風景", type: "video", description: "朝会の様子", tags: ["会議"], checked: false },
  { id: "m7", name: "やさしいBGM", type: "audio", description: "明るく落ち着いたBGM", tags: ["BGM", "明るい"], checked: true },
  { id: "m8", name: "シャッター効果音", type: "audio", description: "場面切り替え用", tags: ["効果音"], checked: true },
];

// ---- ゆうこ素材 ----
export const yukoMaterials: YukoMaterial[] = [
  { id: "y1", name: "ゆうこ_笑顔", tag: "smile" },
  { id: "y2", name: "ゆうこ_案内", tag: "guide" },
  { id: "y3", name: "ゆうこ_お辞儀", tag: "bow" },
];

// ---- 見た目パターン ----
export const lookPatterns: LookPattern[] = [
  {
    id: "l1",
    name: "オープニング",
    category: "はじまりの場面",
    createdAt: "2026/04/01",
    updatedAt: "2026/05/10",
    elements: ["背景", "タイトル文字", "ゆうこの立ち絵", "会社ロゴ"],
    description: "動画の最初に使う、明るく印象的なはじまりの見た目です。",
  },
  {
    id: "l2",
    name: "写真紹介",
    category: "写真を見せる場面",
    createdAt: "2026/04/01",
    updatedAt: "2026/05/12",
    elements: ["写真の表示場所", "説明文字", "ゆうこの立ち絵"],
    description: "写真を大きく見せながら、ゆうこが説明する見た目です。",
  },
  {
    id: "l3",
    name: "動画紹介",
    category: "動画を見せる場面",
    createdAt: "2026/04/02",
    updatedAt: "2026/05/15",
    elements: ["動画の表示場所", "字幕", "読み上げの声"],
    description: "短い動画を流しながら、字幕と読み上げの声で紹介する見た目です。",
  },
  {
    id: "l4",
    name: "ポイント紹介",
    category: "強みを伝える場面",
    createdAt: "2026/04/03",
    updatedAt: "2026/05/16",
    elements: ["見出し", "箇条書き文字", "ゆうこの立ち絵"],
    description: "会社の強みやポイントを箇条書きで分かりやすく見せる見た目です。",
  },
  {
    id: "l5",
    name: "締めのメッセージ",
    category: "おわりの場面",
    createdAt: "2026/04/03",
    updatedAt: "2026/05/18",
    elements: ["背景", "メッセージ文字", "ゆうこの立ち絵", "応募の案内"],
    description: "動画の最後に、応募を呼びかける締めくくりの見た目です。",
  },
];

// ---- 公開前チェックの結果（サンプル） ----
export interface PrecheckItem {
  id: string;
  label: string;
  detail: string;
  severity: "ok" | "warning" | "action";
  action?: string;
}

export const precheckItems: PrecheckItem[] = [
  { id: "c1", label: "誤字脱字", detail: "明らかな誤字は見つかりませんでした。", severity: "ok" },
  { id: "c2", label: "会社名・採用対象", detail: "入力された内容と一致しています。", severity: "ok" },
  { id: "c3", label: "誇大表現", detail: "気になる表現は見つかりませんでした。", severity: "ok" },
  { id: "c4", label: "字幕の長さ", detail: "字幕が少し長い場面が2つあります。読みやすく短くできます。", severity: "action", action: "短くする" },
  { id: "c5", label: "読み上げの声", detail: "2つの場面で声がまだ作成されていません。書き出し前に作成してください。", severity: "action", action: "声を作成" },
  { id: "c6", label: "個人情報の写り込み", detail: "人物が写っている素材があります。公開前にご確認ください。", severity: "warning" },
  { id: "c7", label: "使っていない素材", detail: "使われていない素材が3つあります。", severity: "warning" },
  { id: "c8", label: "BGMの音量", detail: "声が聞き取りやすい音量です。", severity: "ok" },
];

// 目的の選択肢（採用 recruit・videoKind=recruit のとき表示）。id は採用 Purpose 値。
export const purposeOptions: PurposeOption[] = [
  { id: "company_intro", label: "会社紹介", desc: "会社の雰囲気や事業を広く伝える" },
  { id: "new_graduate", label: "新卒採用", desc: "新卒の学生に向けて魅力を伝える" },
  { id: "mid_career", label: "中途採用", desc: "経験者の方に向けて職場を紹介する" },
  { id: "inexperienced_welcome", label: "未経験歓迎", desc: "未経験の方も歓迎していることを伝える" },
  { id: "engineer", label: "職種紹介（エンジニアなど）", desc: "特定の職種の仕事内容を伝える" },
  { id: "info_session", label: "説明会で流す", desc: "会社説明会やイベントで上映する" },
  { id: "sns_short", label: "SNS用ショート", desc: "短い時間でテンポよく見せる" },
];

// 目的の選択肢（一般・社内発表 general・videoKind=general のとき表示）。表示名は正典 11§3.1 に対応。
export const generalPurposeOptions: PurposeOption[] = [
  { id: "general_announcement", label: "社内発表・全社共有", desc: "社内の発表や全社への共有を伝える" },
  { id: "report", label: "業績・活動報告", desc: "業績や活動の状況を報告する" },
  { id: "product_intro", label: "製品・サービス紹介", desc: "製品やサービスの魅力を紹介する" },
  { id: "general_other", label: "汎用・その他", desc: "その他、自由な内容の動画を作る" },
];
