// schema の**条件付き必須**（`if`/`then`/`else`）が増えたことに気づくための検査（#961）。
//
// `layerOps.test.ts` は `template.schema.json` の `allOf`（種別ごとの条件付き必須）を**読んで**、
// コード側の表と集合として突き合わせている。同じ守りが `project` / `timeline-project` には無かった。
//
// ⚠️ **project / timeline は「作る側」が1つに定まらない**（画面・domain の各所で組み立てる）ので、
// テンプレのように「表と突き合わせる」形は取れない。代わりに2つやる：
//
// 1. **規則の一覧を固定する**＝増えた・消えた・条件が変わったら赤くする。
//    増えたときに**人が作る側を追う**（この検査は追ってくれない＝そこは正直に書く）。
// 2. **規則を破った文書を、それを落とす関数へ通して落ちることを確かめる**。
//    ⚠️ **「門に置いてあること」はここでは見ない**（ここが呼ぶのは検証の関数そのもので、保存の経路は通らない）。
//    置き場所の検査は `projectStore.test.ts` の「保存の門（#959）」と
//    `timelineStore.test.ts` の「スキーマに適合しない内容は書かない」が持っている＝控えの `gate` に書いてある。
import { describe, expect, it } from 'vitest';
import projectSchema from '../../docs/yuko_recruit_docs/schemas/project.schema.json';
import templateSchema from '../../docs/yuko_recruit_docs/schemas/template.schema.json';
import timelineSchema from '../../docs/yuko_recruit_docs/schemas/timeline-project.schema.json';
import aiPlanSchema from '../../docs/yuko_recruit_docs/schemas/ai-video-plan.schema.json';
import { assembleProject, defaultVideoSettings, defaultVoiceSettings, parseProjectDoc, ProjectLoadError, validateProjectDoc } from '../domain/project/persistence';
import { createEmptyTimelineProject } from '../domain/timeline/create';
import { TRACK_KIND } from '../domain/enums';
import { validateTimelineProject } from '../domain/validation/generated/validators.js';
import { parseTemplatePack } from '../infrastructure/templateFs';

/** 見つけた条件付きの規則1つ。`where` は schema の中の位置（規則を探すときの道しるべ）。 */
interface ConditionalRule {
  schema: string;
  where: string;
  /** `if` の条件を「項目=値」の形で並べたもの。`else` 側は否定（`!=`）。 */
  when: string;
  /** 必須になる項目。 */
  required: string[];
  /** **禁止**になる項目（`not.required`＝排他）。 */
  forbidden: string[];
  /** 値域が絞られる項目（`properties.<k>.enum`）。 */
  narrowed: string[];
}

/**
 * schema を丸ごと歩いて条件つきの規則を集める（**書き写さない**＝正典が増えたら必ず出てくる）。
 *
 * ⚠️ **`then` だけでなく `else` も拾う**（#961 レビュー）＝`project.schema.json` の `videoKind` は
 * `then`（general→`generalBrief` 必須）と `else`（general 以外→`companyInfo` 必須）が**対で1つの規則**。
 * `then` だけ見ていると `else` 側を消しても緑のまま通る。
 * ⚠️ **`not.required`（排他）と `properties.<k>.enum`（値域の絞り込み）も拾う**＝
 * これらが変わることも「条件が変わった」なので、拾わないと一覧の主張が嘘になる。
 */
function conditionalRulesOf(schema: string, root: unknown): ConditionalRule[] {
  const out: ConditionalRule[] = [];
  const walk = (node: unknown, where: string): void => {
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${where}/${i}`));
      return;
    }
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    const cond = n.if as { properties?: Record<string, { const?: unknown; enum?: unknown[] }> } | undefined;
    if (cond) {
      const clause = (branch: 'then' | 'else', negate: boolean): void => {
        const b = n[branch] as
          | { required?: string[]; not?: { required?: string[] }; properties?: Record<string, { enum?: unknown[] }> }
          | undefined;
        if (!b) return;
        const required = [...(b.required ?? [])].sort();
        const forbidden = [...(b.not?.required ?? [])].sort();
        const narrowed = Object.entries(b.properties ?? {})
          .filter(([, v]) => Array.isArray(v.enum))
          .map(([k, v]) => `${k}=${(v.enum ?? []).join('|')}`)
          .sort();
        if (required.length === 0 && forbidden.length === 0 && narrowed.length === 0) return;
        const when = Object.entries(cond.properties ?? {})
          .map(([k, v]) => `${k}${negate ? '!=' : '='}${v.const !== undefined ? String(v.const) : (v.enum ?? []).join('|')}`)
          .sort()
          .join(',');
        out.push({ schema, where, when, required, forbidden, narrowed });
      };
      clause('then', false);
      clause('else', true);
    }
    for (const [k, v] of Object.entries(n)) walk(v, `${where}/${k}`);
  };
  walk(root, '');
  return out;
}

/** 見つけた規則を1行の鍵にする（並べ替えても同じ文字列になるように整える）。 */
function keyOf(r: ConditionalRule): string {
  const parts = [
    r.required.length ? `必須:${r.required.join('+')}` : '',
    r.forbidden.length ? `禁止:${r.forbidden.join('+')}` : '',
    r.narrowed.length ? `値域:${r.narrowed.join(';')}` : '',
  ].filter(Boolean);
  return `${r.schema} ${r.where} [${r.when}] -> ${parts.join(' ')}`;
}

// ⚠️ **ここは「気づくための控え」**＝規則が増えたら赤くなる。
// 増えたときは **作る側を人が追って**、必要なら守りを足してからこの表へ足す。
// 各行に「作る側」と「門」を書いておく＝追う先が分かる。
//
// ⚠️ **`gate` は事実だけを書く**（#961 レビュー 🔴）＝**project の保存には門が無い**。
// `projectStore` は `validateProjectDoc` の結果を**警告に出すだけで保存を続ける**（#416 の段階的強制の残り）。
// 実際に落ちるのは**次に開いたとき**（`parseProjectDoc` が `required` を structural として拒否）＝
// つまり project は **#959 と同じ形（保存はできるが次に開けない）が残っている**。
// ここを「門」と書くと、正典に「守られているつもり」を固定してしまう。
const KNOWN: Record<string, { builtBy: string; gate: string }> = {
  'project  [videoKind=general] -> 必須:generalBrief 禁止:companyInfo 値域:purpose=general_announcement|report|product_intro|general_other': {
    builtBy: 'WizardScreen（用途の選択・general↔recruit を排他で必ず入れる）',
    gate: '⚠️ 保存に門は無い（#416＝警告のみ）。落ちるのは読込＝parseProjectDoc の structural 判定',
  },
  'project  [videoKind!=general] -> 必須:companyInfo 禁止:generalBrief 値域:purpose=company_intro|new_graduate|mid_career|inexperienced_welcome|engineer|info_session|sns_short': {
    builtBy: 'WizardScreen（用途の選択・general↔recruit を排他で必ず入れる）',
    gate: '⚠️ 保存に門は無い（#416＝警告のみ）。落ちるのは読込＝parseProjectDoc の structural 判定',
  },
  'project /$defs/Scene/properties/slotVideoStart/additionalProperties [mode=delay] -> 必須:delaySec': {
    builtBy: 'SceneEditScreen の再生開始タイミングの選択（delay に必ず delaySec を付ける）',
    gate: '⚠️ 保存に門は無い（#416＝警告のみ）。落ちるのは読込＝parseProjectDoc の structural 判定',
  },
  'timeline /$defs/TimelineClip [kind=voice] -> 必須:voice': {
    builtBy: 'domain/timeline/edit.ts の addVoiceClip / bake.ts',
    gate: 'timelineStore が保存を止める（門の検査＝timelineStore.test.ts「スキーマに適合しない内容は書かない」）',
  },
  'template /$defs/Layer/allOf/0 [type=slot] -> 必須:slotType': {
    builtBy: 'domain/template/layerOps.ts の requiredFieldsForLayerType',
    gate: 'parseTemplatePack が保存を止める（門の検査＝projectStore.test.ts「保存の門（#959）」）。欠けは withRequiredLayerFields が補う＝11 §9',
  },
  'template /$defs/Layer/allOf/1 [type=text|subtitle] -> 必須:textKey': {
    builtBy: 'domain/template/layerOps.ts の requiredFieldsForLayerType',
    gate: 'parseTemplatePack が保存を止める（門の検査＝projectStore.test.ts「保存の門（#959）」）。欠けは withRequiredLayerFields が補う＝11 §9',
  },
};

describe('schema の条件付き必須（#961）', () => {
  const found = [
    ...conditionalRulesOf('project', projectSchema),
    ...conditionalRulesOf('timeline', timelineSchema),
    ...conditionalRulesOf('template', templateSchema),
    ...conditionalRulesOf('ai-video-plan', aiPlanSchema),
  ];

  it('規則の一覧が控えとちょうど一致する（増えたら作る側を追う）', () => {
    // ⚠️ **両方向を見る**＝増えたときだけでなく、**消えたとき・条件が変わったとき**も赤くする
    //（控えだけ残ると「守られているつもり」になる）。
    expect(found.map(keyOf).sort()).toEqual(Object.keys(KNOWN).sort());
  });

  it('控えの各行に「作る側」と「門」が書いてある', () => {
    // ⚠️ **空文字で埋めて通すのを防ぐだけ**（値が事実かまでは見ない＝そこは人が読む）。
    for (const [k, v] of Object.entries(KNOWN)) {
      expect(v.builtBy.length, k).toBeGreaterThan(0);
      expect(v.gate.length, k).toBeGreaterThan(0);
    }
  });

  it('共有している定義には条件つきの規則を入れていない（入れたら一覧の集め方を足す）', () => {
    // ⚠️ **`$ref` の先は追っていない**（#961 レビューの提案）＝`timeline-project.schema.json` は
    // project の `$defs` を `$ref` で共有しているので、**共有している定義**に `if` が入ると、
    // 一覧には `project …` の1行としてしか出ず **timeline 側の作る側を追う手がかりが出ない**。
    // 追う実装は入れない（歩く関数の単純さを保つ）代わりに、**入った瞬間に赤くする**。
    // ⚠️ **参照しているのは節そのもの**（`$defs/Scene/properties/slotClips` のように途中まで）＝
    // 名前だけで見ると、共有していない兄弟（`Scene.slotVideoStart` の規則）まで拾ってしまう。
    const refs = new Set(
      [...JSON.stringify(timelineSchema).matchAll(/project\.schema\.json#\/\$defs\/([A-Za-z0-9_/]+)/g)].map((m) => m[1]!),
    );
    expect(refs.size, '共有している定義が1つも見つからない＝当て先が変わった').toBeGreaterThan(0);
    for (const pointer of refs) {
      let node: unknown = (projectSchema as { $defs: Record<string, unknown> }).$defs;
      for (const seg of pointer.split('/')) node = (node as Record<string, unknown> | undefined)?.[seg];
      expect(node, `${pointer} が project 側に無い`).toBeDefined();
      expect(JSON.stringify(node ?? null), `共有している ${pointer} に条件つきの規則が入った`).not.toContain('"if"');
    }
  });

  it('`dependentRequired` は使っていない（使い始めたら一覧の集め方を足す）', () => {
    // 同じ効果を持つ別の書き方（draft 2020-12）。使い始めたときに **黙って一覧から漏れる** のを防ぐ。
    const all = [['project', projectSchema], ['timeline', timelineSchema], ['template', templateSchema], ['ai-video-plan', aiPlanSchema]] as const;
    for (const [name, s] of all) {
      expect(JSON.stringify(s), name).not.toContain('dependentRequired');
      expect(JSON.stringify(s), name).not.toContain('dependentSchemas');
    }
  });
});

// ⚠️ ここからは「規則が本当に効いているか」を、**破った文書で叩いて**確かめる。
// ⚠️ **叩くのは検証の関数**（保存の経路ではない）＝置き場所の検査は控えの `gate` が指す先が持っている。
describe('条件付き必須を破った文書は、検証が通さない（#961）', () => {
  const baseHeader = {
    projectId: 'proj_20260902_001',
    projectName: '検査用',
    purpose: 'new_graduate' as const,
    createdAt: '2026-09-02T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
    videoSettings: defaultVideoSettings(),
    companyInfo: { companyName: '株式会社サンプル' },
    voiceSettings: defaultVoiceSettings(),
  };
  const scene = (overrides: Record<string, unknown> = {}) => ({
    sceneId: 'scene_001', partId: 'part_001', order: 1, sceneType: 'opening', templateId: 'tpl_x',
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: 'yuko' }, texts: {},
    narration: { text: '', voiceId: null, status: 'none' }, warnings: [],
    ...overrides,
  });
  const general = () => {
    const doc = { ...assembleProject(baseHeader, [], [], []), videoKind: 'general', purpose: 'general_announcement' } as Record<string, unknown>;
    delete doc.companyInfo;
    return doc;
  };

  it('[videoKind=general] なのに generalBrief が無いと落ちる', () => {
    expect(validateProjectDoc(general()).valid).toBe(false);
    // 足せば通る＝落ちた理由が **generalBrief の欠け** であることを示す（別の理由で落ちていない）。
    expect(validateProjectDoc({ ...general(), generalBrief: { title: '社内発表' } }).valid).toBe(true);
  });

  it('[videoKind=general] なのに companyInfo があると落ちる（排他）', () => {
    const ok = { ...general(), generalBrief: { title: '社内発表' } };
    expect(validateProjectDoc({ ...ok, companyInfo: { companyName: '株式会社サンプル' } }).valid).toBe(false);
  });

  it('[videoKind!=general] なのに companyInfo が無いと落ちる（else 側も規則）', () => {
    const doc = assembleProject(baseHeader, [], [], []) as unknown as Record<string, unknown>;
    delete doc.companyInfo;
    expect(validateProjectDoc(doc).valid).toBe(false);
  });

  it('用途は種類ごとに絞られる（値域）', () => {
    // 採用の用途を「一般」の文書に入れると落ちる＝条件つきの値域が効いている。
    expect(validateProjectDoc({ ...general(), generalBrief: { title: 'x' }, purpose: 'new_graduate' }).valid).toBe(false);
  });

  it('[mode=delay] なのに delaySec が無いと落ちる', () => {
    const withStart = (start: Record<string, unknown>) => ({
      ...assembleProject(baseHeader, [], [], []),
      scenes: [scene({ slotVideoStart: { layer_001: start } })],
    });
    expect(validateProjectDoc(withStart({ mode: 'delay' })).valid).toBe(false);
    expect(validateProjectDoc(withStart({ mode: 'delay', delaySec: 1.5 })).valid).toBe(true);
    // ⚠️ 他のモードは delaySec を要らない＝条件が **delay のときだけ** 効いていることを示す。
    expect(validateProjectDoc(withStart({ mode: 'withAnim' })).valid).toBe(true);
  });

  it('条件付き必須を破った場面形式は、次に開くとき拒否される（#959 と同じ形が残っている）', () => {
    // ⚠️ **これが project の実態**＝保存は通り（#416 で警告のみ）、**開くときに初めて落ちる**。
    // 読込が structural（型・必須の欠け）として拒否するので、利用者から見ると
    // 「保存できたのに次に開けない」。門を足すのは #416 の続きで、この検査の担当ではない。
    expect(() => parseProjectDoc(JSON.stringify(general()))).toThrow(ProjectLoadError);
  });

  it('[kind=voice] なのに voice が無いと落ちる', () => {
    const doc = createEmptyTimelineProject({ projectId: 'proj_20260902_002', projectName: '検査用', now: baseHeader.createdAt });
    const track = doc.tracks.find((t) => t.kind === TRACK_KIND.audio);
    expect(track, '音の列が要る').toBeDefined();
    const clip = { id: 'clip_001', trackId: track!.id, kind: 'voice', startSec: 0, durationSec: 2 };
    const withClip = (c: Record<string, unknown>) => ({ ...doc, clips: [...doc.clips, c] });
    expect(validateTimelineProject(withClip(clip))).toBe(false);
    expect(validateTimelineProject(withClip({ ...clip, voice: { text: 'こんにちは', status: 'none' } }))).toBe(true);
  });

  it('層の種別に合わない値は、テンプレの保存の手前で落ちる', () => {
    // ⚠️ **必須の「欠け」では落ちない**＝`withRequiredLayerFields` が補って通すのが正しい挙動（`11 §9`・#959）。
    // ここで見ているのは**補えない値**（種別ごとの enum から外れた値）＝条件付き必須そのものではなく、
    // 「その項目に何を書けるか」の側。
    const tmpl = (layer: Record<string, unknown>) => ({
      schemaVersion: templateSchema.properties.schemaVersion.const as string,
      templateId: 'user_tmpl_001', name: '検査用', category: 'free' as const,
      aspectRatio: '16:9' as const, canvas: { width: 1920, height: 1080 },
      layers: [{ id: 'layer_001', x: 0, y: 0, w: 100, h: 100, ...layer }],
    });
    expect(parseTemplatePack([tmpl({ type: 'slot', slotType: 'bogus' })]).templates).toHaveLength(0);
    expect(parseTemplatePack([tmpl({ type: 'text', textKey: 'bogus' })]).templates).toHaveLength(0);
    // 正しい値なら通る＝落ちた理由が **その項目** であることを示す。
    expect(parseTemplatePack([tmpl({ type: 'slot', slotType: 'image_or_video' })]).templates).toHaveLength(1);
    // 欠けは補われて通る（落とさない）＝上のコメントが事実であることを示す。
    expect(parseTemplatePack([tmpl({ type: 'slot' })]).templates).toHaveLength(1);
  });
});
