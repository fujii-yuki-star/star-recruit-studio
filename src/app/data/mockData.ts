// 画面用のUIモデルとモックデータ。
// 後から本物のデータ層（src/domain）に差し替えられるよう、UI専用の軽量な型で定義する。

export type ScreenId =
  | "home"
  | "wizard"
  | "confirm"
  | "draft"
  | "scene-edit"
  | "preview"
  | "export"
  | "looks"
  | "settings";

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
  line: string; // ゆうこのセリフ
  look: string; // 見た目
  materialType: "photo" | "video" | "none";
}

export interface MaterialItem {
  id: string;
  name: string;
  type: "photo" | "video" | "audio";
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
  },
  {
    id: "d3",
    order: 3,
    part: "仕事紹介",
    scene: "働く様子",
    material: "仕事中の様子",
    line: "チームで協力しながら、お客様の課題を解決しています。",
    look: "映像＋字幕",
    materialType: "video",
  },
  {
    id: "d4",
    order: 4,
    part: "さいごに",
    scene: "メッセージ",
    material: "社員の集合写真",
    line: "一緒に、よりよい未来をつくっていきましょう。ご応募お待ちしています。",
    look: "エンディング",
    materialType: "photo",
  },
];

// ---- 素材一覧 ----
export const materials: MaterialItem[] = [
  { id: "m1", name: "会社外観", type: "photo" },
  { id: "m2", name: "オフィス写真", type: "photo" },
  { id: "m3", name: "社員の集合写真", type: "photo" },
  { id: "m4", name: "受付エリア", type: "photo" },
  { id: "m5", name: "仕事中の様子", type: "video" },
  { id: "m6", name: "ミーティング風景", type: "video" },
  { id: "m7", name: "やさしいBGM", type: "audio" },
  { id: "m8", name: "シャッター効果音", type: "audio" },
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
    elements: ["動画の表示場所", "字幕", "ゆうこの声"],
    description: "短い動画を流しながら、字幕とゆうこの声で紹介する見た目です。",
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

// 目的の選択肢
export const purposeOptions = [
  { id: "company_intro", label: "会社紹介", desc: "会社の雰囲気や事業を広く伝える" },
  { id: "new_graduate", label: "新卒採用", desc: "新卒の学生に向けて魅力を伝える" },
  { id: "mid_career", label: "中途採用", desc: "経験者の方に向けて職場を紹介する" },
  { id: "engineer", label: "職種紹介（エンジニアなど）", desc: "特定の職種の仕事内容を伝える" },
  { id: "info_session", label: "説明会で流す", desc: "会社説明会やイベントで上映する" },
  { id: "sns_short", label: "SNS用ショート", desc: "短い時間でテンポよく見せる" },
];
