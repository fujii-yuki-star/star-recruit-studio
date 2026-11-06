// あなた向け会社説明の最後の場面（ADR-0061 判断3・利用者判断 2026-11-05＝専用の見た目）。
import { describe, expect, it } from 'vitest';
import { FREE_CATEGORY } from '../enums';
import { sampleTemplates } from '../../infrastructure/sampleData';
import { BRIEFING_CLOSING_COLORS, BRIEFING_HOW_LABELS_MAX, briefingHowText, buildBriefingClosingScene, closingTemplateFor, withClosingHowText, briefingMoveTarget, type BriefingClosingInput } from './closing';
import { BRIEFING_CLOSING_DURATION_SEC } from '../constants';
import type { FreeElement } from '../project/types';

function input(over: Partial<BriefingClosingInput> = {}): BriefingClosingInput {
  return { sceneId: 'scene_009', partId: 'part_001', order: 9, orientation: '16:9', text: '締めの文', logoAssetId: 'asset_010', templates: sampleTemplates, ...over };
}

const byName = (els: FreeElement[] | undefined, name: string): FreeElement => els!.find((e) => e.name === name)!;

describe('最後の場面', () => {
  it('自由配置の器に、地・ロゴ・差し色の線・文・下の帯を置く（声なし・決まった長さ）', () => {
    const s = buildBriefingClosingScene(input())!;
    expect(s).toMatchObject({ sceneId: 'scene_009', partId: 'part_001', order: 9, sceneType: FREE_CATEGORY, templateId: 'free_canvas_v1', durationSec: BRIEFING_CLOSING_DURATION_SEC });
    expect(s.narration).toEqual({ text: '', status: 'none' });
    expect(s.character.enabled).toBe(false);
    expect(s.freeLayout?.map((e) => e.name).sort()).toEqual(['ロゴ', '下の帯', '地', '差し色', '締めの文'].sort());
    expect(new Set(s.freeLayout?.map((e) => e.id)).size).toBe(5);
    expect(byName(s.freeLayout, 'ロゴ')).toMatchObject({ kind: 'slot', assetId: 'asset_010', fit: 'contain' });
    expect(byName(s.freeLayout, '締めの文')).toMatchObject({ kind: 'text', text: '締めの文', textAlign: 'center' });
    expect(byName(s.freeLayout, '地')).toMatchObject({ x: 0, y: 0, w: 1920, h: 1080, fillColor: BRIEFING_CLOSING_COLORS.ground });
  });

  it('ロゴ → 線 → 文の順に縦に並び、まとまりが画面の縦の真ん中に来る・どれも左右の真ん中', () => {
    for (const orientation of ['16:9', '9:16'] as const) {
      const s = buildBriefingClosingScene(input({ orientation }))!;
      const [W, H] = orientation === '16:9' ? [1920, 1080] : [1080, 1920];
      const logo = byName(s.freeLayout, 'ロゴ');
      const bar = byName(s.freeLayout, '差し色');
      const text = byName(s.freeLayout, '締めの文');
      expect(logo.y + logo.h).toBeLessThan(bar.y);
      expect(bar.y + bar.h).toBeLessThan(text.y);
      const top = logo.y;
      const bottom = text.y + text.h;
      expect(Math.abs(top - (H - bottom))).toBeLessThanOrEqual(1);
      for (const e of [logo, bar, text]) expect(Math.abs(e.x - (W - e.x - e.w))).toBeLessThanOrEqual(1);
      expect(byName(s.freeLayout, '下の帯')).toMatchObject({ x: 0, w: W, y: H - byName(s.freeLayout, '下の帯').h });
    }
  });

  it('ロゴが無ければ置かず、線と文だけで真ん中に寄せる', () => {
    const s = buildBriefingClosingScene(input({ logoAssetId: null }))!;
    expect(s.freeLayout?.some((e) => e.kind === 'slot')).toBe(false);
    const bar = byName(s.freeLayout, '差し色');
    const text = byName(s.freeLayout, '締めの文');
    expect(Math.abs(bar.y - (1080 - (text.y + text.h)))).toBeLessThanOrEqual(1);
  });

  it('差し色は会社の色があればそれ、無ければ既定（線と下の帯の両方）', () => {
    const own = buildBriefingClosingScene(input({ accentColor: '#cc3300' }))!;
    expect([byName(own.freeLayout, '差し色').fillColor, byName(own.freeLayout, '下の帯').fillColor]).toEqual(['#cc3300', '#cc3300']);
    const def = buildBriefingClosingScene(input({ accentColor: null }))!;
    expect(byName(def.freeLayout, '差し色').fillColor).toBe(BRIEFING_CLOSING_COLORS.accent);
  });

  it('器は向きに合う同梱の自由配置だけ（利用者の見た目パターンは使わない）・無ければ作らない', () => {
    const free = sampleTemplates.find((t) => t.templateId === 'free_canvas_v1')!;
    const user = { ...free, templateId: 'user_tmpl_001' };
    expect(closingTemplateFor([user, free], '16:9')?.templateId).toBe('free_canvas_v1');
    expect(closingTemplateFor([user], '16:9')).toBeNull();
    expect(buildBriefingClosingScene(input({ templates: [free], orientation: '9:16' }))).toBeNull();
  });
});

describe('作り方の一言（ADR-0061 追補 2026-11-06）', () => {
  it('事実だけで言う＝AI で組んだときだけ「AI が」・場面の数・興味は上限まで（越えたら「など」）・興味が無ければ「あなたに合わせて」', () => {
    expect(briefingHowText({ interestLabels: ['研修', '技術'], sceneCount: 5, byAi: true })).toBe('あなたが選んだ「研修・技術」に合わせて、AI が5つの場面を選んで並べ、声も自動で作りました。');
    expect(briefingHowText({ interestLabels: ['研修'], sceneCount: 2, byAi: false })).toBe('あなたが選んだ「研修」に合わせて、2つの場面を選んで並べ、声も自動で作りました。');
    const many = ['a', 'b', 'c', 'd', 'e'];
    expect(briefingHowText({ interestLabels: many, sceneCount: 1, byAi: false })).toContain(`「${many.slice(0, BRIEFING_HOW_LABELS_MAX).join('・')}など」`);
    expect(briefingHowText({ interestLabels: [' '], sceneCount: 1, byAi: false })).toBe('あなたに合わせて、1つの場面を選んで並べ、声も自動で作りました。');
  });

  it('一言は締めの文の下に控えめに置き、まとまり全体を縦の真ん中に・差し替えられる', () => {
    const s = buildBriefingClosingScene(input({ howText: '作り方です' }))!;
    const text = byName(s.freeLayout, '締めの文');
    const how = byName(s.freeLayout, '作り方');
    expect(how).toMatchObject({ kind: 'text', text: '作り方です', textAlign: 'center' });
    expect(how.y).toBeGreaterThan(text.y + text.h);
    expect(how.fontSize!).toBeLessThan(text.fontSize!);
    const logo = byName(s.freeLayout, 'ロゴ');
    expect(Math.abs(logo.y - (1080 - (how.y + how.h)))).toBeLessThanOrEqual(1);
    const changed = withClosingHowText(s, '新しい一言');
    expect(byName(changed.freeLayout, '作り方').text).toBe('新しい一言');
    expect(byName(changed.freeLayout, '締めの文').text).toBe('締めの文');
    // 一言なしで作った場面は変えない
    const plain = buildBriefingClosingScene(input())!;
    expect(withClosingHowText(plain, 'x')).toBe(plain);
    expect(plain.freeLayout?.some((e) => e.name === '作り方')).toBe(false);
  });
});

describe('学生がパートを動かす先', () => {
  it('締め（最後）より後ろへは置かない・先頭より前へも行かない', () => {
    // 3 つ（2 つ＋締め）：動かせる先は 0〜1
    expect(briefingMoveTarget(0, 3)).toBe(0);
    expect(briefingMoveTarget(1, 3)).toBe(1);
    expect(briefingMoveTarget(2, 3)).toBe(1);
    expect(briefingMoveTarget(9, 3)).toBe(1);
    expect(briefingMoveTarget(-1, 3)).toBe(0);
  });
});
