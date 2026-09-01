import { describe, expect, it } from 'vitest';
import { loadBundledTemplates, parseTemplateFiles, parseTemplatePack, templatesForOrientation } from './templateFs';
import { sampleTemplates } from './sampleData';
import { buildTemplateSummaries } from '../domain/ai/videoPlanInput';
import { pickableTemplatesForScene } from '../domain/template/templateSelection';
import { FREE_CATEGORY, ORIENTATIONS, SCENE_CATEGORIES } from '../domain/enums';

// 検証用の最小・正当なテンプレ（schema 必須項目のみ）。category/aspectRatio を差し替えて異常系を作る。
const validLandscape = {
  schemaVersion: '1.0',
  templateId: 'test_land_v1',
  name: 'テスト横',
  category: 'opening',
  aspectRatio: '16:9',
  canvas: { width: 1920, height: 1080 },
  layers: [{ id: 'bg', type: 'background', x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 }],
};
const validPortrait = {
  schemaVersion: '1.0',
  templateId: 'test_port_v1',
  name: 'テスト縦',
  category: 'message',
  aspectRatio: '9:16',
  canvas: { width: 1080, height: 1920 },
  layers: [{ id: 'bg', type: 'background', x: 0, y: 0, w: 1080, h: 1920, zIndex: 0 }],
};

describe('parseTemplatePack', () => {
  it('正しいテンプレは採用し、不正は rejected に分離する', () => {
    const { templates, rejected } = parseTemplatePack([
      validLandscape,
      { ...validLandscape, templateId: 'no_name', name: '' }, // name 空（minLength 1 違反）
      { ...validLandscape, templateId: 'bad_cat', category: 'foo' }, // category enum 違反
      { ...validLandscape, templateId: 'bad_ratio', aspectRatio: '4:3' }, // aspectRatio enum 違反
    ]);
    expect(templates.map((t) => t.templateId)).toEqual(['test_land_v1']);
    expect(rejected).toHaveLength(3);
    const ids = rejected.map((r) => r.templateId);
    expect(ids).toContain('no_name');
    expect(ids).toContain('bad_cat');
    expect(ids).toContain('bad_ratio');
  });

  it('slot レイヤーの slotType は値が不正なら不採用（#959 で「欠落」は補正に変更）', () => {
    // ⚠️ **このテストは以前「slotType 欠落＝不採用」を固定しており、不具合の側を守っていた**（#959）。
    // 見た目パターン作成エディタは差し込み口を足すとき slotType を書いていなかったので、
    // 利用者が作ったものは保存できるのに読み込みで却下され、一覧から静かに消えていた。
    // 欠落は取り込み時に補正する（`15 §6`）ようにしたので、ここで固定するのは
    // **補正では直せない不正値**＝schema の enum 違反にする（検証そのものは効いたまま）。
    const { templates, rejected } = parseTemplatePack({
      ...validLandscape,
      templateId: 'slot_bad_type',
      layers: [{ id: 'm', type: 'slot', slotType: 'audio', x: 0, y: 0, w: 100, h: 100 }],
    });
    expect(templates).toHaveLength(0);
    expect(rejected.map((r) => r.templateId)).toContain('slot_bad_type');
  });

  it('単体オブジェクトも配列も受け付ける', () => {
    expect(parseTemplatePack(validPortrait).templates).toHaveLength(1);
    expect(parseTemplatePack([validPortrait, validLandscape]).templates).toHaveLength(2);
  });
});

describe('templatesForOrientation', () => {
  it('向きが一致するテンプレだけ返す', () => {
    const all = parseTemplatePack([validLandscape, validPortrait]).templates;
    expect(templatesForOrientation(all, '16:9').map((t) => t.templateId)).toEqual(['test_land_v1']);
    expect(templatesForOrientation(all, '9:16').map((t) => t.templateId)).toEqual(['test_port_v1']);
  });
});

describe('loadBundledTemplates', () => {
  it('同梱の標準見た目パターンは全件が検証を通る', () => {
    // ID 直書きに依存せず「同梱の全件が検証を通る」ことを件数一致で確認。
    expect(loadBundledTemplates()).toHaveLength(sampleTemplates.length);
  });

  it('横型と縦型で同じカテゴリ集合を収録する＝向き別のカテゴリ網羅が対称（#456）', () => {
    const all = loadBundledTemplates();
    const catsFor = (o: '16:9' | '9:16') =>
      [...new Set(templatesForOrientation(all, o).map((t) => t.category))].sort();
    // 縦型が持つ全カテゴリを横型も持つ（横型の在庫不足の解消）。集合として完全対称。
    expect(catsFor('16:9')).toEqual(catsFor('9:16'));
    // 両向きとも全カテゴリ（SCENE_CATEGORIES）を網羅している（手動の見た目選択が向きで偏らない・#415/#456）。
    for (const o of ['16:9', '9:16'] as const) {
      const cats = new Set(templatesForOrientation(all, o).map((t) => t.category));
      for (const c of SCENE_CATEGORIES) expect(cats.has(c)).toBe(true);
    }
  });

  it('AI候補は両向きとも FREE を除く全9カテゴリを網羅する（AI経路・ADR-0008 で FREE は手動専用・#456）', () => {
    // 手動選択（templatesForOrientation）だけでなく、AI 入力（buildTemplateSummaries）の実経路まで固定する（#456 レビュー P3）。
    const all = loadBundledTemplates();
    const nonFree = SCENE_CATEGORIES.filter((c) => c !== FREE_CATEGORY);
    for (const o of ['16:9', '9:16'] as const) {
      const cats = new Set(buildTemplateSummaries(all, o).map((s) => s.category));
      expect(cats.has(FREE_CATEGORY)).toBe(false); // FREE は AI 候補に出さない（手動専用・ADR-0008）
      for (const c of nonFree) expect(cats.has(c)).toBe(true);
    }
  });

  it('見た目ピッカーは FREE 以外の各カテゴリ・各向きで選択肢が2件以上（「常に1択」への逆戻り防止・#415）', () => {
    // 場面編集の見た目ピッカーが呼ぶ正準関数（pickableTemplatesForScene）で、同梱データが「選び直せる＝2択以上」を満たすことを固定する。
    // SCENE_CATEGORIES / ORIENTATIONS 由来で回すため、将来カテゴリ追加時も自動で同じ2択基準を課す（人工データでなく実 sampleTemplates を対象）。
    const nonFree = SCENE_CATEGORIES.filter((c) => c !== FREE_CATEGORY);
    for (const cat of nonFree) {
      for (const o of ORIENTATIONS) {
        const { options } = pickableTemplatesForScene(sampleTemplates, cat, o, undefined);
        expect(options.length, `${cat} / ${o} の見た目が2択未満`).toBeGreaterThanOrEqual(2);
      }
    }
  });
});

describe('parseTemplateFiles', () => {
  it('空リストは空の結果を返す', async () => {
    const { templates, rejected } = await parseTemplateFiles([]);
    expect(templates).toHaveLength(0);
    expect(rejected).toHaveLength(0);
  });

  it('JSON として読めないファイルは rejected に集約する（ファイル名つき）', async () => {
    const bad = new File(['not json'], 'bad.json', { type: 'application/json' });
    const { templates, rejected } = await parseTemplateFiles([bad]);
    expect(templates).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.templateId).toBeNull();
    expect(rejected[0]?.errors.join(' ')).toContain('bad.json');
  });

  it('配列ファイルと単体ファイルを混在しても集約する', async () => {
    const arrFile = new File([JSON.stringify([validLandscape, validPortrait])], 'pack.json');
    const oneFile = new File([JSON.stringify({ ...validLandscape, templateId: 'solo_v1' })], 'one.json');
    const { templates } = await parseTemplateFiles([arrFile, oneFile]);
    expect(templates.map((t) => t.templateId).sort()).toEqual(['solo_v1', 'test_land_v1', 'test_port_v1']);
  });

  it('大きすぎるファイルは取り込まない', async () => {
    const huge = new File(['x'.repeat(1_000_001)], 'huge.json');
    const { templates, rejected } = await parseTemplateFiles([huge]);
    expect(templates).toHaveLength(0);
    expect(rejected).toHaveLength(1);
  });
});

describe('縦型（9:16）同梱テンプレの網羅（B3）', () => {
  const portrait = () => loadBundledTemplates().filter((t) => t.aspectRatio === '9:16');

  it('全カテゴリ（free 含む）に 9:16 の同梱テンプレがある', () => {
    const covered = new Set(portrait().map((t) => t.category));
    for (const cat of SCENE_CATEGORIES) {
      expect(covered.has(cat)).toBe(true);
    }
  });

  it('縦型テンプレのキャンバスは 1080×1920', () => {
    for (const t of portrait()) {
      expect(t.canvas).toEqual({ width: 1080, height: 1920 });
    }
  });
});

describe('取り込み時の自動補正（#959）', () => {
  const withSlot = (slot: Record<string, unknown>) => ({
    ...validLandscape,
    templateId: 'test_repair_v1',
    layers: [validLandscape.layers[0], { id: 'layer_001', type: 'slot', x: 0, y: 0, w: 100, h: 100, zIndex: 1, ...slot }],
  });

  it('slotType の無い差し込み口を補って取り込む＝一覧から静かに消えない', () => {
    const { templates, rejected } = parseTemplatePack(withSlot({}));
    expect(rejected).toEqual([]);
    expect(templates[0].layers[1].slotType).toBe('image_or_video');
  });

  it('textKey の無い文字層も同じ規則で補う（種別ごとに片方だけ直さない）', () => {
    const raw = {
      ...validLandscape,
      templateId: 'test_repair_v2',
      layers: [
        validLandscape.layers[0],
        { id: 'layer_001', type: 'text', x: 0, y: 0, w: 100, h: 100, zIndex: 1 },
        { id: 'layer_002', type: 'subtitle', x: 0, y: 0, w: 100, h: 100, zIndex: 2 },
      ],
    };
    const { templates, rejected } = parseTemplatePack(raw);
    expect(rejected).toEqual([]);
    expect(templates[0].layers[1].textKey).toBe('title');
    expect(templates[0].layers[2].textKey).toBe('subtitle');
  });

  it('入っている値は上書きしない＝利用者が選んだ「動画だけ」が写真も可に化けない', () => {
    const { templates } = parseTemplatePack(withSlot({ slotType: 'video' }));
    expect(templates[0].layers[1].slotType).toBe('video');
  });

  it('補正で不正データを通さない＝ほかが壊れていれば従来どおり却下する', () => {
    const { templates, rejected } = parseTemplatePack(withSlot({ w: 0 }));
    expect(templates).toEqual([]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].templateId).toBe('test_repair_v1');
  });

  it('補う所が無ければ元のオブジェクトをそのまま通す（無用な作り直しをしない）', () => {
    const raw = withSlot({ slotType: 'image' });
    const { templates } = parseTemplatePack(raw);
    expect(templates[0]).toBe(raw as unknown as (typeof templates)[number]);
  });

  it('層が配列でない・種別が文字列でない壊れ方でも落ちない（補正が例外を投げない）', () => {
    expect(() => parseTemplatePack({ ...validLandscape, layers: 'こわれ' })).not.toThrow();
    expect(() => parseTemplatePack({ ...validLandscape, layers: [null, 7, { type: 3 }] })).not.toThrow();
    expect(() => parseTemplatePack(null)).not.toThrow();
  });
});
