import { describe, expect, it } from 'vitest';
import type { Asset } from '../project/types';
import type { Template } from '../template/types';
import type { AiScene, AiVideoPlan } from './types';
import type { Orientation } from '../enums';
import { AI_SCENE_MIN_DURATION_SEC, MAX_NARRATION_LEN_DEFAULT, MAX_SUBTITLE_LEN_DEFAULT } from '../constants';
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

  // #607：テンプレ上限が生成の下限（3秒）より小さいとき、素直に「下限→上限」の順で clamp すると
  // **評価順で上限を破る**（短い値が3秒に引き上げられ、テンプレが宣言した1秒を超える）。
  // どちらも #553 の「生成の目安」だが、上限は**そのテンプレについて作者が明示した値**なので優先する。
  // 到達経路は手編集テンプレ/テンプレートパック取り込み（`aiHint` は作成エディタ非開放）。
  describe('テンプレ上限が生成の下限より小さいとき（#607）', () => {
    const tightCtx = () => {
      const ctx = baseCtx();
      return {
        ...ctx,
        templates: ctx.templates.map((t) =>
          t.templateId === 'opening_yuko_right_v1' ? { ...t, aiHint: { ...t.aiHint, maxDurationSec: 1 } } : t,
        ),
      };
    };

    it('短すぎる値でも上限を超えない（下限へ引き上げない）', () => {
      const { scenes } = transformVideoPlan(singleScenePlan({ durationSec: 0.5 }), tightCtx());
      expect(scenes[0].durationSec).toBe(1); // 3 に引き上げると「最長1秒」の宣言を破る
      expect(scenes[0].durationSec).toBeGreaterThan(0); // schema: durationSec > 0（11 §7）
      expect(scenes[0].warnings.some((w) => w.code === 'DURATION_CLAMPED')).toBe(true);
    });

    it('長すぎる値も上限へ寄る（範囲が1点に潰れても壊れない）', () => {
      const { scenes } = transformVideoPlan(singleScenePlan({ durationSec: 10 }), tightCtx());
      expect(scenes[0].durationSec).toBe(1);
    });

    it('上限が下限以上のときは従来どおり下限が効く（この是正で通常経路を変えない）', () => {
      const { scenes } = transformVideoPlan(singleScenePlan({ durationSec: 0.5 }), baseCtx());
      expect(scenes[0].durationSec).toBe(AI_SCENE_MIN_DURATION_SEC);
    });
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

// #569：生成側の長さ助言（TEXT_OVERFLOW）が掛け合いの各行を見ていなかった＝precheck（sceneLines で各行を見る）と非対称。
// 「同じ長すぎが掛け合いの有無で生成時だけ静か」を解消する（ADR-0026②）。閾値の継承順は precheck と既に一致（#568）。
describe('長さの助言が掛け合いの各行も見る（#569・ADR-0026②）', () => {
  const overNarration = 'あ'.repeat(MAX_NARRATION_LEN_DEFAULT + 1);
  const overSubtitle = 'い'.repeat(MAX_SUBTITLE_LEN_DEFAULT + 1);
  const codes = (plan: AiVideoPlan): string[] =>
    transformVideoPlan(plan, baseCtx()).scenes.flatMap((s) => s.warnings.map((w) => w.code));

  it('単一ナレーションが長ければ従来どおり警告する（回帰なし）', () => {
    expect(codes(singleScenePlan({ narrationText: overNarration }))).toContain('TEXT_OVERFLOW');
  });

  it('掛け合いの行が長ければ警告する（旧実装は narrationText が空で素通りしていた）', () => {
    // 掛け合いでは narrationText が空になりうる（AI が省略）＝旧実装は '' を検査して実質ノーチェックだった。
    const plan = singleScenePlan({ narrationText: '', narrationLines: [{ text: '短い' }, { text: overNarration }] });
    expect(codes(plan)).toContain('TEXT_OVERFLOW');
  });

  it('掛け合いの行が全て短ければ警告しない（誤警告を出さない）', () => {
    const plan = singleScenePlan({ narrationText: '', narrationLines: [{ text: '短い' }, { text: 'これも短い' }] });
    expect(codes(plan)).not.toContain('TEXT_OVERFLOW');
  });

  it('掛け合いがあるとき、単一 narrationText の長さでは判定しない（本体は各行＝precheck と同じ対象）', () => {
    // narrationText（mirror 用の残骸）が長くても、実体である行が短ければ助言しない。
    const plan = singleScenePlan({ narrationText: overNarration, narrationLines: [{ text: '短い' }] });
    expect(codes(plan)).not.toContain('TEXT_OVERFLOW');
  });

  it('行の字幕が長ければ警告する（テンプレ字幕 texts.subtitle と同じ扱い）', () => {
    const plan = singleScenePlan({
      narrationText: '', texts: { title: 'x' },
      narrationLines: [{ text: '短い', subtitle: overSubtitle }],
    });
    expect(codes(plan)).toContain('TEXT_OVERFLOW');
  });

  it('行の字幕が未指定なら text を流用したものを検査する（null=継承・#569 レビュー）', () => {
    // AI が subtitle を省略するのが通常パターン。字幕上限(60)超・セリフ上限(120)以下の長さにすると、
    // 「実際に表示される字幕（=text）」を見ていなければ**どちらの警告も出ない**＝取りこぼしになる。
    const between = 'う'.repeat(MAX_SUBTITLE_LEN_DEFAULT + 10);
    expect(between.length).toBeGreaterThan(MAX_SUBTITLE_LEN_DEFAULT);
    expect(between.length).toBeLessThanOrEqual(MAX_NARRATION_LEN_DEFAULT); // セリフ側では引っかからない長さ
    const plan = singleScenePlan({
      narrationText: '', texts: { title: 'x' },
      narrationLines: [{ text: between }], // subtitle 未指定＝text が字幕として表示される
    });
    expect(codes(plan)).toContain('TEXT_OVERFLOW');
  });

  it('長い行が複数あっても種類ごとに警告は1つ（1場面で警告が並ばない＝precheck と同じ流儀）', () => {
    // 集約性だけを見るため、字幕は明示的に短くしてセリフ側だけを長くする（字幕未指定だと text 流用で字幕側も鳴る）。
    const line = { text: overNarration, subtitle: '短い字幕' };
    const plan = singleScenePlan({ narrationText: '', narrationLines: [line, line, line] });
    expect(codes(plan).filter((c) => c === 'TEXT_OVERFLOW')).toHaveLength(1);
  });

  it('セリフと字幕の両方が長ければ2件出る（別々の問題＝直し方が違うので畳まない）', () => {
    // 字幕未指定で text が両上限を超える＝「行を短くする」と「短い字幕を明示する」の2つの助言が要る。
    const plan = singleScenePlan({ narrationText: '', narrationLines: [{ text: overNarration }] });
    expect(codes(plan).filter((c) => c === 'TEXT_OVERFLOW')).toHaveLength(2);
  });
});
