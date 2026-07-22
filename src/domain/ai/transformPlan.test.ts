import { describe, expect, it } from 'vitest';
import type { Asset } from '../project/types';
import type { Template } from '../template/types';
import type { AiScene, AiVideoPlan } from './types';
import type { Orientation } from '../enums';
import { createSequentialIdFactory } from './idFactory';
import { transformVideoPlan } from './transformPlan';
import type { TransformContext } from './transformPlan';
import { MockAiProvider } from '../../infrastructure/aiProviders/mockAiProvider';
import { SAMPLE_VIDEO_PLAN } from '../../infrastructure/aiProviders/sampleVideoPlan';

// fixtures/template-pack と fixtures/project.sample.json の要点を型付きで再現したテスト用コンテキスト。
const templates: Template[] = [
  {
    schemaVersion: '1.0',
    templateId: 'opening_yuko_right_v1',
    name: 'オープニング・ゆうこ右',
    category: 'opening',
    aspectRatio: '16:9',
    canvas: { width: 1920, height: 1080 },
    aiHint: { maxDurationSec: 12, maxNarrationLength: 120, maxSubtitleLength: 60 },
    defaults: { durationSec: 8, transitionIn: 'fade', transitionOut: 'fade' },
    layers: [
      { id: 'background', type: 'background', x: 0, y: 0, w: 1920, h: 1080 },
      { id: 'title', type: 'text', textKey: 'title', required: true, x: 160, y: 360, w: 1100, h: 140 },
      { id: 'subtitle', type: 'subtitle', textKey: 'subtitle', x: 240, y: 920, w: 1440, h: 90 },
      { id: 'logo', type: 'logo', required: false, x: 1640, y: 60, w: 220, h: 120 },
      { id: 'yuko', type: 'character', required: false, x: 1450, y: 600, w: 360, h: 420 },
    ],
  },
  {
    schemaVersion: '1.0',
    templateId: 'photo_left_text_right_yuko_v1',
    name: '写真左・説明右・ゆうこ',
    category: 'photo_intro',
    aspectRatio: '16:9',
    canvas: { width: 1920, height: 1080 },
    aiHint: { maxDurationSec: 15, maxNarrationLength: 120, maxSubtitleLength: 60 },
    defaults: { durationSec: 10, transitionIn: 'fade', transitionOut: 'fade' },
    layers: [
      { id: 'background', type: 'background', x: 0, y: 0, w: 1920, h: 1080 },
      { id: 'mainVisual', type: 'slot', slotType: 'image_or_video', required: true, x: 80, y: 140, w: 1040, h: 800 },
      { id: 'title', type: 'text', textKey: 'title', required: true, x: 1230, y: 250, w: 560, h: 110 },
      { id: 'subtitle', type: 'subtitle', textKey: 'subtitle', x: 240, y: 960, w: 1440, h: 90 },
      { id: 'yuko', type: 'character', required: false, x: 1500, y: 640, w: 340, h: 400 },
    ],
  },
  {
    // 同カテゴリ(opening)の縦型。向き整合（B4）の補正先になる。
    schemaVersion: '1.0',
    templateId: 'opening_yuko_portrait_v1',
    name: 'オープニング・縦',
    category: 'opening',
    aspectRatio: '9:16',
    canvas: { width: 1080, height: 1920 },
    layers: [{ id: 'background', type: 'background', x: 0, y: 0, w: 1080, h: 1920 }],
  },
];

const assets: Asset[] = [
  { assetId: 'asset_entrance_001', assetType: 'image', displayName: '会社入口の写真', filePath: 'assets/images/entrance_001.jpg' },
  { assetId: 'asset_office_001', assetType: 'image', displayName: 'オフィス写真', filePath: 'assets/images/office_001.jpg' },
  { assetId: 'asset_logo_001', assetType: 'logo', displayName: '会社ロゴ', filePath: 'assets/images/logo.png' },
  { assetId: 'yuko_smile_001', assetType: 'yuko', displayName: 'ゆうこ_笑顔', filePath: 'assets/yuko/yuko_smile.png', tags: ['smile', 'opening'], isDefaultYuko: true },
  { assetId: 'yuko_guide_001', assetType: 'yuko', displayName: 'ゆうこ_案内', filePath: 'assets/yuko/yuko_guide.png', tags: ['guide', 'point'] },
  { assetId: 'bgm_bright_001', assetType: 'bgm', displayName: '明るいBGM', filePath: 'assets/bgm/bright_001.mp3' },
];

const baseCtx = (orientation: Orientation = '16:9'): TransformContext => ({
  templates,
  assets,
  orientation,
  idFactory: createSequentialIdFactory(),
});

/** 1パート1シーンの最小プランを作るヘルパー（補正系テスト用）。型安全のため各フィールドを明示マージする。 */
function singleScenePlan(override: Partial<AiScene>): AiVideoPlan {
  const scene: AiScene = {
    sceneType: override.sceneType ?? 'opening',
    templateId: override.templateId ?? 'opening_yuko_right_v1',
    durationSec: override.durationSec ?? 8,
    texts: override.texts ?? { title: 'x' },
    narrationText: override.narrationText ?? 'こんにちは。',
    narrationLines: override.narrationLines,
    assetRefs: override.assetRefs,
    yukoPoseTag: override.yukoPoseTag,
    sceneTitle: override.sceneTitle,
    notes: override.notes,
  };
  return {
    schemaVersion: '1.0',
    videoPlan: { title: 't', purpose: 'company_intro', targetDurationSec: 30 },
    parts: [{ partTitle: 'p', scenes: [scene] }],
  };
}

describe('transformVideoPlan', () => {
  it('narrationText が null/省略でも narration.text を空にして変換できる（無音シーン・一回で通す）', () => {
    const plan: AiVideoPlan = {
      schemaVersion: '1.0',
      videoPlan: { title: 't', purpose: 'company_intro', targetDurationSec: 30 },
      parts: [
        {
          partTitle: 'p',
          scenes: [
            { sceneType: 'opening', templateId: 'opening_yuko_right_v1', durationSec: 8, texts: { title: 'x' }, narrationText: null },
          ],
        },
      ],
    };
    const { scenes } = transformVideoPlan(plan, baseCtx());
    expect(scenes[0].narration.text).toBe('');
  });

  it('narrationLines を scene.lines に変換（voiceCharacter→speaker・subtitle・未知は既定声＋警告・#180）', () => {
    const plan = singleScenePlan({
      narrationLines: [
        { text: 'やあ', voiceCharacter: 'ずんだもん', subtitle: 'やあ字幕' },
        { text: 'どうも', voiceCharacter: '四国めたん', subtitleEnabled: false },
        { text: '誰？', voiceCharacter: '知らない人' },
      ],
    });
    const { scenes, warnings } = transformVideoPlan(plan, baseCtx());
    expect(scenes[0].lines?.map((l) => [l.lineId, l.text, l.speaker])).toEqual([
      ['line_001', 'やあ', 3], // ずんだもん→3
      ['line_002', 'どうも', 2], // 四国めたん→2
      ['line_003', '誰？', null], // 未知→null（既定声）
    ]);
    expect(scenes[0].lines?.[0].subtitleText).toBe('やあ字幕');
    expect(scenes[0].lines?.[1].subtitleEnabled).toBe(false);
    expect(warnings.some((w) => w.code === 'LINE_SPEAKER_UNKNOWN')).toBe(true);
  });

  it('narrationLines が無ければ scene.lines は付かない（単一 narration・後方互換）', () => {
    const { scenes } = transformVideoPlan(singleScenePlan({ narrationText: 'ひとり言' }), baseCtx());
    expect(scenes[0].lines).toBeUndefined();
    expect(scenes[0].narration.text).toBe('ひとり言');
  });

  it('narrationLines のみ（narrationText 省略）でも narration.text を lines[0] に mirror（台本/precheck の後方可読性）', () => {
    const plan = singleScenePlan({ narrationText: '', narrationLines: [{ text: '一行目' }, { text: '二行目' }] });
    const { scenes } = transformVideoPlan(plan, baseCtx());
    expect(scenes[0].lines?.[0].text).toBe('一行目');
    expect(scenes[0].narration.text).toBe('一行目'); // mirror（空にしない）
  });

  it('narrationLines が空配列なら scene.lines は付かない（単一 narration へフォールバック）', () => {
    const { scenes } = transformVideoPlan(singleScenePlan({ narrationLines: [] }), baseCtx());
    expect(scenes[0].lines).toBeUndefined();
  });

  it('Mockのサンプルプランをfixtureのproject.sample相当のScene群へ変換する', async () => {
    const plan = await new MockAiProvider().generateVideoPlan({
      companyInfo: { companyName: '株式会社サンプル' },
      purpose: 'new_graduate',
      targetDurationSec: 60,
      templates: [],
      assets: [],
      yukoPoseTags: ['smile', 'guide'],
    });
    expect(plan).toEqual(SAMPLE_VIDEO_PLAN);

    const { parts, scenes, warnings } = transformVideoPlan(plan, baseCtx());

    expect(parts.map((p) => p.partId)).toEqual(['part_001', 'part_002']);
    expect(parts[0]).toMatchObject({ partId: 'part_001', title: 'オープニング', order: 1, sceneIds: ['scene_001'] });
    expect(parts[1]).toMatchObject({ partId: 'part_002', title: '会社紹介', order: 2, sceneIds: ['scene_002'] });

    const [s1, s2] = scenes;
    expect(s1).toMatchObject({
      sceneId: 'scene_001', partId: 'part_001', order: 1,
      sceneType: 'opening', templateId: 'opening_yuko_right_v1', durationSec: 8,
    });
    expect(s1.assetRefs).toEqual({ background: 'asset_entrance_001', logo: 'asset_logo_001' });
    expect(s1.character).toEqual({ enabled: true, characterId: 'yuko', poseAssetId: 'yuko_smile_001' });
    expect(s1.narration).toMatchObject({ text: 'こんにちは、ゆうこです。今日は株式会社サンプルの魅力を紹介します。', status: 'none', voiceId: null });
    expect(s1.transition).toEqual({ in: 'fade', out: 'fade', durationSec: 0.5 });

    expect(s2).toMatchObject({
      sceneId: 'scene_002', partId: 'part_002', order: 2,
      sceneType: 'photo_intro', templateId: 'photo_left_text_right_yuko_v1', durationSec: 10,
    });
    expect(s2.assetRefs).toEqual({ mainVisual: 'asset_office_001' });
    expect(s2.character.poseAssetId).toBe('yuko_guide_001');

    // クリーンなサンプルなので警告は出ない
    expect(warnings).toEqual([]);
  });

  it('存在しない templateId は同カテゴリの標準へ補正し、警告を残す', () => {
    const plan = singleScenePlan({ sceneType: 'opening', templateId: 'does_not_exist_v1' });
    const { scenes } = transformVideoPlan(plan, baseCtx());
    expect(scenes[0].templateId).toBe('opening_yuko_right_v1');
    expect(scenes[0].warnings.some((w) => w.code === 'TEMPLATE_NOT_FOUND' && w.autoFixed === true)).toBe(true);
  });

  // マイ見た目は AI 入力から除外される（ADR-0017）＝AI が提案できないものへ**補正で**化けさせない（#547）。
  // 当て先の規則は standardTemplateForScene に一本化してあるので、その除外がここでも効くことを固定する。
  it('補正の当て先にマイ見た目を選ばない（候補がマイ見た目だけなら手動選択を促す）', () => {
    const userOnly: Template[] = [
      { ...templates[0], templateId: 'user_tmpl_001', name: 'マイ見た目' }, // 同カテゴリ・同じ向きだが自作
    ];
    const plan = singleScenePlan({ sceneType: 'opening', templateId: 'does_not_exist_v1' });
    const { scenes } = transformVideoPlan(plan, { ...baseCtx(), templates: userOnly });
    expect(scenes[0].templateId).not.toBe('user_tmpl_001'); // 化けない
    // 自動補正できないので「手で選ぶ」案内に倒れる（autoFixed=false・§2-5）。
    expect(scenes[0].warnings.some((w) => w.code === 'TEMPLATE_NOT_FOUND' && w.autoFixed === false)).toBe(true);
  });

  it('長すぎる durationSec をテンプレ上限へ clamp する', () => {
    const plan = singleScenePlan({ durationSec: 100 });
    const { scenes } = transformVideoPlan(plan, baseCtx());
    expect(scenes[0].durationSec).toBe(12); // opening の aiHint.maxDurationSec
    expect(scenes[0].warnings.some((w) => w.code === 'DURATION_CLAMPED')).toBe(true);
  });

  it('一致しない poseTag は既定の yuko 素材へフォールバックする', () => {
    const plan = singleScenePlan({ yukoPoseTag: 'unknown_pose' });
    const { scenes } = transformVideoPlan(plan, baseCtx());
    expect(scenes[0].character).toEqual({ enabled: true, characterId: 'yuko', poseAssetId: 'yuko_smile_001' });
    expect(scenes[0].warnings.some((w) => w.code === 'POSE_FALLBACK')).toBe(true);
  });

  it('存在しない assetId は null にし、警告を残す', () => {
    const plan = singleScenePlan({ assetRefs: { background: 'asset_missing', logo: 'asset_logo_001' } });
    const { scenes } = transformVideoPlan(plan, baseCtx());
    expect(scenes[0].assetRefs).toEqual({ background: null, logo: 'asset_logo_001' });
    expect(scenes[0].warnings.some((w) => w.code === 'ASSET_NOT_FOUND')).toBe(true);
  });

  it('縦型プロジェクトでは横型テンプレ指定を同カテゴリの縦型へ補正する（向き整合・B4）', () => {
    const plan = singleScenePlan({ sceneType: 'opening', templateId: 'opening_yuko_right_v1' });
    const { scenes } = transformVideoPlan(plan, baseCtx('9:16'));
    expect(scenes[0].templateId).toBe('opening_yuko_portrait_v1');
    expect(scenes[0].warnings.some((w) => w.code === 'TEMPLATE_ORIENTATION_MISMATCH' && w.autoFixed === true)).toBe(true);
  });

  it('縦型プロジェクトで未知テンプレIDは縦型の同カテゴリへ補正する', () => {
    const plan = singleScenePlan({ sceneType: 'opening', templateId: 'nope_v1' });
    const { scenes } = transformVideoPlan(plan, baseCtx('9:16'));
    expect(scenes[0].templateId).toBe('opening_yuko_portrait_v1');
    expect(scenes[0].warnings.some((w) => w.code === 'TEMPLATE_NOT_FOUND' && w.autoFixed === true)).toBe(true);
  });

  it('向きが一致していればテンプレ補正の警告は出ない', () => {
    const plan = singleScenePlan({ sceneType: 'opening', templateId: 'opening_yuko_right_v1' });
    const { scenes } = transformVideoPlan(plan, baseCtx('16:9'));
    expect(scenes[0].templateId).toBe('opening_yuko_right_v1');
    expect(
      scenes[0].warnings.some(
        (w) => w.code === 'TEMPLATE_ORIENTATION_MISMATCH' || w.code === 'TEMPLATE_NOT_FOUND',
      ),
    ).toBe(false);
  });

  it('縦型projectで縦型の代替が無いカテゴリは補正できず警告のみ（autoFixed=false）', () => {
    // 写真テンプレは 16:9 のみ（縦型なし）→ 縦型projectでは補正先が無い。
    const plan = singleScenePlan({ sceneType: 'photo_intro', templateId: 'photo_left_text_right_yuko_v1' });
    const { scenes } = transformVideoPlan(plan, baseCtx('9:16'));
    expect(
      scenes[0].warnings.some((w) => w.code === 'TEMPLATE_ORIENTATION_MISMATCH' && w.autoFixed === false),
    ).toBe(true);
  });
});
