// あなた向け会社説明の最後の場面（β・ADR-0061 決定5・判断3）。純粋関数。
//
// ⚠️ **専用の見た目**（利用者判断 2026-11-05）＝ロゴと一文を中央に置く締め。見た目パターンは**増やさない**＝
//   自由配置の器（`category: free`）に、ここで決めた配置で要素を置く（見た目パターンの一覧・AI の選択肢に出さない）。
// ⚠️ **学生は外せない**＝組んだ動画の最後に必ず足す（`buildBriefingProject`）。文言とロゴは登録（`catalog.closing`）。
// 声は付けない（読み上げると「すたりおで作った」が説明の続きに聞こえる＝画面の文だけで見せる）。
import { BRIEFING_CLOSING_DURATION_SEC, DEFAULT_CHARACTER_ID } from '../constants';
import { FIT, FONT_WEIGHT, FREE_CATEGORY, FREE_ELEMENT_KIND, FREE_SHAPE_TYPE, NARRATION_STATUS, ORIENTATION, TEXT_ALIGN, type Orientation } from '../enums';
import type { FreeElement, Scene } from '../project/types';
import type { Template } from '../template/types';
import { isUserTemplate } from '../template/userTemplate';

/** 締めの見た目の色（会社の色が無いときの差し色・地・文字）。 */
export const BRIEFING_CLOSING_COLORS = {
  ground: '#f5f7fa',
  text: '#1d2430',
  /** 「作り方」の一言（締めの文より控えめ）。 */
  sub: '#4a5563',
  accent: '#2f5d8a',
} as const;

/** 「作り方」の一言に並べる興味の数の上限（越えたら「など」）＝長くしすぎない。 */
export const BRIEFING_HOW_LABELS_MAX = 4;

/**
 * 締めの場面の「作り方」の一言（ADR-0061 追補 2026-11-06）＝この動画がいまどう作られたかを、**事実だけ**で言う。
 * ⚠️ AI がルールに落ちた（`byAi` が偽）なら「AI が」と書かない・場面の数は実際の数（締めの場面は数えない）。
 */
export function briefingHowText(input: { interestLabels: readonly string[]; sceneCount: number; byAi: boolean }): string {
  const labels = input.interestLabels.filter((l) => l.trim().length > 0);
  const shown = labels.slice(0, BRIEFING_HOW_LABELS_MAX).join('・') + (labels.length > BRIEFING_HOW_LABELS_MAX ? 'など' : '');
  const whom = shown ? `あなたが選んだ「${shown}」に合わせて、` : 'あなたに合わせて、';
  return `${whom}${input.byAi ? 'AI が' : ''}${input.sceneCount}つの場面を選んで並べ、声も自動で作りました。`;
}

/**
 * 向きごとの寸法。**ロゴ → 差し色の線 → 文**を1つのまとまりにして、画面の縦の真ん中に置く（ロゴが無ければ線と文だけ）。
 * 下の端に差し色の帯を敷く（締めの場面だと分かる・会社の色が入る）。
 */
const LAYOUT: Record<Orientation, { w: number; h: number; logo: { w: number; h: number }; textW: number; textLines: number; fontSize: number; howFontSize: number; gap: number }> = {
  [ORIENTATION.landscape]: { w: 1920, h: 1080, logo: { w: 640, h: 260 }, textW: 1440, textLines: 2, fontSize: 52, howFontSize: 32, gap: 48 },
  // ⚠️ 縦は文が小さい（横幅が狭い）ので、作り方の一言は締めの文に対する割合で決めると小さすぎた（実機・2026-11-06）＝横と同じ大きさにして 2 行へ折り返す。
  [ORIENTATION.portrait]: { w: 1080, h: 1920, logo: { w: 760, h: 340 }, textW: 980, textLines: 3, fontSize: 40, howFontSize: 32, gap: 56 },
};

/** 文の行間（倍率）。 */
const LINE_HEIGHT = 1.5;
/** 差し色の線と、下の端の帯の太さ。 */
const BAR = { w: 120, h: 8 };
const FOOT_H = 14;
/** 「作り方」の一言の行数（折り返しの余白）。文字の大きさは向きごと（`LAYOUT.howFontSize`）。 */
const HOW_LINES = 2;
/** 締めの場面の「作り方」の一言の部品の名前（`buildBriefingClosingScene` が付け、`withClosingHowText` が探す）。 */
const HOW_ELEMENT_NAME = '作り方';

export interface BriefingClosingInput {
  sceneId: string;
  partId: string;
  order: number;
  orientation: Orientation;
  /** 登録の文（`catalog.closing.text`）。 */
  text: string;
  /** 「作り方」の一言（`briefingHowText`）。無ければ出さない。 */
  howText?: string | null;
  /** 置くロゴの素材の番号（一時の動画の中の番号）。無ければ置かない。 */
  logoAssetId: string | null;
  /** 差し色（会社の色の1つ目）。無ければ既定。 */
  accentColor?: string | null;
  /** 使える見た目パターン（向きに合う自由配置の器を探す）。 */
  templates: readonly Template[];
}

/** 向きに合う自由配置の器（同梱のもの）。無ければ null（呼ぶ側が知らせる）。 */
export function closingTemplateFor(templates: readonly Template[], orientation: Orientation): Template | null {
  return templates.find((t) => t.category === FREE_CATEGORY && t.aspectRatio === orientation && !isUserTemplate(t.templateId)) ?? null;
}

/** 最後の場面を組む。向きに合う自由配置の器が無ければ null。 */
export function buildBriefingClosingScene(input: BriefingClosingInput): Scene | null {
  const template = closingTemplateFor(input.templates, input.orientation);
  if (!template) return null;
  const L = LAYOUT[input.orientation];
  const accent = input.accentColor || BRIEFING_CLOSING_COLORS.accent;
  const textH = Math.ceil(L.fontSize * LINE_HEIGHT * L.textLines);
  const logoBlock = input.logoAssetId ? L.logo.h + L.gap : 0;
  const how = input.howText?.trim() ?? '';
  const howFont = L.howFontSize;
  const howH = Math.ceil(howFont * LINE_HEIGHT * HOW_LINES);
  const howBlock = how ? Math.round(L.gap / 2) + howH : 0;
  const top = Math.round((L.h - (logoBlock + BAR.h + L.gap + textH + howBlock)) / 2);
  const barY = top + logoBlock;
  const elements: FreeElement[] = [
    { id: 'free_001', kind: FREE_ELEMENT_KIND.shape, shapeType: FREE_SHAPE_TYPE.rect, x: 0, y: 0, w: L.w, h: L.h, zIndex: 0, fillColor: BRIEFING_CLOSING_COLORS.ground, name: '地' },
    {
      id: 'free_002',
      kind: FREE_ELEMENT_KIND.text,
      x: Math.round((L.w - L.textW) / 2),
      y: barY + BAR.h + L.gap,
      w: L.textW,
      h: textH,
      zIndex: 2,
      text: input.text,
      fontSize: L.fontSize,
      color: BRIEFING_CLOSING_COLORS.text,
      fontWeight: FONT_WEIGHT.bold,
      textAlign: TEXT_ALIGN.center,
      lineHeight: LINE_HEIGHT,
      name: '締めの文',
    },
    {
      id: 'free_003',
      kind: FREE_ELEMENT_KIND.shape,
      shapeType: FREE_SHAPE_TYPE.rounded_rect,
      x: Math.round((L.w - BAR.w) / 2),
      y: barY,
      w: BAR.w,
      h: BAR.h,
      radius: BAR.h / 2,
      zIndex: 3,
      fillColor: accent,
      name: '差し色',
    },
    { id: 'free_005', kind: FREE_ELEMENT_KIND.shape, shapeType: FREE_SHAPE_TYPE.rect, x: 0, y: L.h - FOOT_H, w: L.w, h: FOOT_H, zIndex: 3, fillColor: accent, name: '下の帯' },
  ];
  if (how) {
    elements.push({
      id: 'free_006',
      kind: FREE_ELEMENT_KIND.text,
      x: Math.round((L.w - L.textW) / 2),
      y: barY + BAR.h + L.gap + textH + Math.round(L.gap / 2),
      w: L.textW,
      h: howH,
      zIndex: 2,
      text: how,
      fontSize: howFont,
      color: BRIEFING_CLOSING_COLORS.sub,
      fontWeight: FONT_WEIGHT.normal,
      textAlign: TEXT_ALIGN.center,
      lineHeight: LINE_HEIGHT,
      name: HOW_ELEMENT_NAME,
    });
  }
  if (input.logoAssetId) {
    elements.push({ id: 'free_004', kind: FREE_ELEMENT_KIND.slot, assetId: input.logoAssetId, fit: FIT.contain, x: Math.round((L.w - L.logo.w) / 2), y: top, w: L.logo.w, h: L.logo.h, zIndex: 1, name: 'ロゴ' });
  }
  return {
    sceneId: input.sceneId,
    partId: input.partId,
    order: input.order,
    sceneType: FREE_CATEGORY,
    templateId: template.templateId,
    durationSec: BRIEFING_CLOSING_DURATION_SEC,
    assetRefs: {},
    character: { enabled: false, characterId: DEFAULT_CHARACTER_ID, poseAssetId: null },
    texts: {},
    narration: { text: '', status: NARRATION_STATUS.none },
    warnings: [],
    freeLayout: elements,
  };
}


/**
 * 締めの場面の「作り方」の一言を差し替える（学生が場面を外した後に、場面の数を合わせる・ADR-0061 追補）。
 * 一言の部品が無ければそのまま返す（締めの場面でない・一言なしで作った）。
 */
export function withClosingHowText(scene: Scene, howText: string): Scene {
  const els = scene.freeLayout ?? [];
  if (!els.some((e) => e.name === HOW_ELEMENT_NAME)) return scene;
  return { ...scene, freeLayout: els.map((e) => (e.name === HOW_ELEMENT_NAME ? { ...e, text: howText } : e)) };
}

/**
 * 学生の簡易場面編集で、パートを動かす先（ADR-0061 追補）＝**締めの場面（いつも最後）より後ろへは置かない**。
 * `count` は締めを含む場面の数。掴んで運ぶ・矢印のどちらもここを通す。
 */
export function briefingMoveTarget(toIndex: number, count: number): number {
  return Math.max(0, Math.min(toIndex, count - 2));
}
