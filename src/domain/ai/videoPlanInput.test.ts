import { describe, expect, it } from 'vitest';
import type { Asset } from '../project/types';
import type { Template } from '../template/types';
import { buildTemplateSummaries, buildYukoPoseTags, resolveTargetAudience } from './videoPlanInput';

function template(over: Partial<Template> = {}): Template {
  return {
    schemaVersion: '1.0',
    templateId: 'opening_yuko_right_v1',
    name: 'オープニング',
    category: 'opening',
    aspectRatio: '16:9',
    canvas: { width: 1920, height: 1080 },
    aiHint: { useCase: '冒頭のあいさつ', maxDurationSec: 12, maxNarrationLength: 120, maxSubtitleLength: 60 },
    layers: [
      { id: 'bg', type: 'background', x: 0, y: 0, w: 1920, h: 1080 },
      { id: 'slot_main', type: 'slot', x: 100, y: 100, w: 800, h: 600 },
      { id: 'yuko', type: 'character', x: 1300, y: 200, w: 500, h: 800 },
    ],
    ...over,
  };
}

describe('buildTemplateSummaries', () => {
  it('aiHint と層構成から要約を作る', () => {
    const [s] = buildTemplateSummaries([template()], '16:9');
    expect(s.templateId).toBe('opening_yuko_right_v1');
    expect(s.category).toBe('opening');
    expect(s.useCase).toBe('冒頭のあいさつ');
    expect(s.requiredSlots).toEqual(['slot_main']);
    expect(s.hasYuko).toBe(true);
    expect(s.maxNarrationLength).toBe(120);
    expect(s.maxSubtitleLength).toBe(60);
    expect(s.maxDurationSec).toBe(12);
  });

  it('character 層が無ければ hasYuko=false・slot 複数も拾う', () => {
    const [s] = buildTemplateSummaries([
      template({
        layers: [
          { id: 'slot_a', type: 'slot', x: 0, y: 0, w: 10, h: 10 },
          { id: 'slot_b', type: 'slot', x: 0, y: 0, w: 10, h: 10 },
          { id: 'title', type: 'text', x: 0, y: 0, w: 10, h: 10 },
        ],
      }),
    ], '16:9');
    expect(s.hasYuko).toBe(false);
    expect(s.requiredSlots).toEqual(['slot_a', 'slot_b']);
  });

  it('aiHint 無しは上限類が undefined', () => {
    const [s] = buildTemplateSummaries([template({ aiHint: undefined })], '16:9');
    expect(s.useCase).toBeUndefined();
    expect(s.maxDurationSec).toBeUndefined();
  });

  it('ユーザーテンプレ（user_tmpl_）は AI 入力から除外する（ADR-0017 不変条件）', () => {
    const summaries = buildTemplateSummaries([
      template({ templateId: 'opening_yuko_right_v1' }),
      template({ templateId: 'user_tmpl_001' }),
    ], '16:9');
    expect(summaries.map((s) => s.templateId)).toEqual(['opening_yuko_right_v1']); // user_tmpl_ は出ない
  });

  it('プロジェクトの向きに一致するテンプレだけ渡す（ADR-0012・#415）', () => {
    const summaries = buildTemplateSummaries([
      template({ templateId: 'opening_yuko_right_v1', aspectRatio: '16:9' }),
      template({ templateId: 'opening_yuko_portrait_v1', aspectRatio: '9:16' }),
    ], '9:16');
    expect(summaries.map((s) => s.templateId)).toEqual(['opening_yuko_portrait_v1']); // 横型は渡さない
  });
});

describe('buildYukoPoseTags', () => {
  function asset(over: Partial<Asset> & Pick<Asset, 'assetId' | 'assetType'>): Asset {
    return { displayName: 'x', filePath: 'x', ...over };
  }

  it('yuko 素材の tags を重複なく集約する', () => {
    const assets: Asset[] = [
      asset({ assetId: 'y1', assetType: 'yuko', tags: ['smile', 'guide'] }),
      asset({ assetId: 'y2', assetType: 'yuko', tags: ['guide', 'bow'] }),
      asset({ assetId: 'img', assetType: 'image', tags: ['オフィス'] }),
    ];
    expect(buildYukoPoseTags(assets)).toEqual(['smile', 'guide', 'bow']);
  });

  it('yuko 素材が無ければ空配列', () => {
    expect(buildYukoPoseTags([asset({ assetId: 'img', assetType: 'image', tags: ['x'] })])).toEqual([]);
  });
});

describe('resolveTargetAudience（ADR-0011 #12）', () => {
  it('general は generalBrief.targetAudience を使う', () => {
    expect(resolveTargetAudience({ generalBrief: { title: 'x', targetAudience: '全社員' } })).toBe('全社員');
  });
  it('recruit は companyInfo.recruitTarget を使う', () => {
    expect(resolveTargetAudience({ companyInfo: { companyName: 'x', recruitTarget: '新卒' } })).toBe('新卒');
  });
  it('general の targetAudience を優先する（recruitTarget があっても）', () => {
    expect(
      resolveTargetAudience({
        generalBrief: { title: 'x', targetAudience: '全社員' },
        companyInfo: { companyName: 'x', recruitTarget: '新卒' },
      }),
    ).toBe('全社員');
  });
  it('どちらも未設定・空なら空文字', () => {
    expect(resolveTargetAudience({})).toBe('');
    expect(resolveTargetAudience({ generalBrief: { title: 'x' }, companyInfo: { companyName: 'x' } })).toBe('');
  });
});
