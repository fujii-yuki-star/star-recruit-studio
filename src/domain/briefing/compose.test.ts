// あなた向け会社説明の組み方（ADR-0061 決定4・12 §11）。
import { describe, expect, it } from 'vitest';
import { defaultBriefingCatalog, type BriefingCatalog, type BriefingSceneRule } from './catalog';
import {
  BRIEFING_LENGTH,
  BRIEFING_LENGTH_RANGE_SEC,
  briefingAiOffer,
  buildBriefingComposeMessages,
  checkBriefingComposition,
  collectBriefingCandidates,
  composeBriefing,
  composeBriefingByRules,
  type BriefingSceneDoc,
  type BriefingSourceDoc,
} from './compose';
import { BRIEFING_AI_CANDIDATE_MAX, BRIEFING_AI_SPEECH_MAX_LENGTH } from '../constants';

// 例の興味＝interest_001 仕事内容／002 研修／003 若手社員／004 技術／005 福利厚生／006 社風
const WORK = 'interest_001';
const TRAINING = 'interest_002';
const TECH = 'interest_004';
const P1 = 'proj_20261101_001';
const P2 = 'proj_20261101_002';

function rule(sceneId: string, interestIds: string[], extra: Partial<BriefingSceneRule> = {}): BriefingSceneRule {
  return { sceneId, interestIds, priority: 'normal', required: false, excluded: false, ...extra };
}

function scene(sceneId: string, order: number, durationSec: number, extra: Partial<BriefingSceneDoc> = {}): BriefingSceneDoc {
  return { sceneId, order, durationSec, texts: { title: `見出し${sceneId}` }, narration: { text: `セリフ${sceneId}` }, ...extra };
}

function catalogWith(sources: BriefingCatalog['sources']): BriefingCatalog {
  return { ...defaultBriefingCatalog(), sources };
}

const keysOf = (list: { projectId: string; sceneId: string }[]): string[] => list.map((c) => `${c.projectId.slice(-1)}:${c.sceneId}`);

describe('1. 絞る', () => {
  it('選んだ興味の場面と必ず入れる場面だけ・使わないは必ず入れるより強い・無効な動画と読めない動画は使わない・並びは自然な順', () => {
    const catalog = catalogWith([
      {
        projectId: P1,
        enabled: true,
        scenes: [
          rule('scene_003', [TRAINING]),
          rule('scene_001', [], { required: true }),
          rule('scene_002', [TECH]),
          rule('scene_004', [TRAINING], { excluded: true, required: true }),
        ],
      },
      { projectId: P2, enabled: false, scenes: [rule('scene_001', [TRAINING])] },
      { projectId: 'proj_20261101_003', enabled: true, scenes: [rule('scene_001', [TRAINING])] },
    ]);
    const docs: BriefingSourceDoc[] = [
      { projectId: P1, scenes: [scene('scene_004', 4, 5), scene('scene_003', 3, 5), scene('scene_002', 2, 5), scene('scene_001', 1, 5), scene('scene_009', 9, 5)] },
      { projectId: P2, scenes: [scene('scene_001', 1, 5)] },
    ];
    const cands = collectBriefingCandidates(catalog, docs, [TRAINING, 'interest_999']);
    expect(keysOf(cands)).toEqual(['1:scene_001', '1:scene_003']);
    expect(cands.map((c) => c.key)).toEqual(['c1', 'c2']);
    expect(cands[1].matched).toEqual([TRAINING]);
  });

  it('場面の名前は見出し、無ければセリフの頭。掛け合いは行をつなぐ', () => {
    const catalog = catalogWith([{ projectId: P1, enabled: true, scenes: [rule('scene_001', [WORK]), rule('scene_002', [WORK])] }]);
    const docs: BriefingSourceDoc[] = [
      {
        projectId: P1,
        scenes: [
          scene('scene_001', 1, 5, { texts: { title: '  ' }, narration: { text: '' }, lines: [{ text: 'こんにちは' }, { text: 'よろしく' }] }),
          scene('scene_002', 2, 5),
        ],
      },
    ];
    const [a, b] = collectBriefingCandidates(catalog, docs, [WORK]);
    expect(a.speech).toBe('こんにちは よろしく');
    expect(a.title).toBe('こんにちは よろしく');
    expect(b.title).toBe('見出しscene_002');
  });
});

describe('4. ルールだけで組む', () => {
  const range = BRIEFING_LENGTH_RANGE_SEC.short;

  it('必ず入れる → 興味ごとに1つ → 優先度・当たる数の順に、上限まで（入らない長い場面は飛ばす）・並びは自然な順', () => {
    const catalog = catalogWith([
      {
        projectId: P1,
        enabled: true,
        scenes: [
          rule('scene_001', [], { required: true }),
          rule('scene_002', [TRAINING], { priority: 'low' }),
          rule('scene_003', [TECH], { priority: 'high' }),
          rule('scene_004', [TECH], { priority: 'high' }),
          rule('scene_005', [TECH, TRAINING]),
          rule('scene_006', [TECH], { priority: 'high' }),
        ],
      },
    ]);
    const docs: BriefingSourceDoc[] = [
      {
        projectId: P1,
        scenes: [
          scene('scene_001', 1, 10),
          scene('scene_002', 2, 10),
          scene('scene_003', 3, range.max), // 長すぎて入らない
          scene('scene_004', 4, 20),
          scene('scene_005', 5, 20),
          scene('scene_006', 6, 20),
        ],
      },
    ];
    const cands = collectBriefingCandidates(catalog, docs, [TRAINING, TECH]);
    // 必ず(10)・研修＝先に採る順で normal の 005(20) が low の 002 より前・技術はもう 005 で満たす・残りは high の 003(長すぎ)を飛ばして 004→006＝合計 70。002(low・10)は 80 で入る
    const picks = composeBriefingByRules(cands, [TRAINING, TECH], 'short');
    expect(keysOf(picks)).toEqual(['1:scene_001', '1:scene_002', '1:scene_004', '1:scene_005', '1:scene_006']);
    expect(picks.reduce((t, c) => t + c.durationSec, 0)).toBeLessThanOrEqual(range.max);
  });

  it('興味ごとの1つは、優先度が低くても先に入る（取りこぼさない）', () => {
    const catalog = catalogWith([
      {
        projectId: P1,
        enabled: true,
        scenes: [rule('scene_001', [TECH], { priority: 'high' }), rule('scene_002', [TECH], { priority: 'high' }), rule('scene_003', [TRAINING], { priority: 'low' })],
      },
    ]);
    const docs: BriefingSourceDoc[] = [{ projectId: P1, scenes: [scene('scene_001', 1, 40), scene('scene_002', 2, 40), scene('scene_003', 3, 30)] }];
    const cands = collectBriefingCandidates(catalog, docs, [TECH, TRAINING]);
    expect(keysOf(composeBriefingByRules(cands, [TECH, TRAINING], 'short'))).toEqual(['1:scene_001', '1:scene_003']);
  });

  it('同じ優先度なら、選んだ興味に多く当たる場面を先に採る', () => {
    const catalog = catalogWith([{ projectId: P1, enabled: true, scenes: [rule('scene_001', [TECH]), rule('scene_002', [TECH, TRAINING])] }]);
    const docs: BriefingSourceDoc[] = [{ projectId: P1, scenes: [scene('scene_001', 1, 50), scene('scene_002', 2, 50)] }];
    const cands = collectBriefingCandidates(catalog, docs, [TECH, TRAINING]);
    expect(keysOf(composeBriefingByRules(cands, [TECH, TRAINING], 'short'))).toEqual(['1:scene_002']);
  });

  it('登録の興味の項目に無い印（手で書き換えた登録）は当たりにしない', () => {
    const catalog = catalogWith([{ projectId: P1, enabled: true, scenes: [rule('scene_001', ['interest_999']), rule('scene_002', [TECH])] }]);
    const docs: BriefingSourceDoc[] = [{ projectId: P1, scenes: [scene('scene_001', 1, 5), scene('scene_002', 2, 5)] }];
    expect(keysOf(collectBriefingCandidates(catalog, docs, ['interest_999', TECH]))).toEqual(['1:scene_002']);
  });

  it('必ず入れる場面の合計が上限を越えても削らない', () => {
    const catalog = catalogWith([{ projectId: P1, enabled: true, scenes: [rule('scene_001', [], { required: true }), rule('scene_002', [TECH])] }]);
    const docs: BriefingSourceDoc[] = [{ projectId: P1, scenes: [scene('scene_001', 1, range.max + 5), scene('scene_002', 2, 5)] }];
    const cands = collectBriefingCandidates(catalog, docs, [TECH]);
    expect(keysOf(composeBriefingByRules(cands, [TECH], 'short'))).toEqual(['1:scene_001']);
  });
});

function fixture(): { catalog: BriefingCatalog; docs: BriefingSourceDoc[] } {
  const catalog = catalogWith([
    {
      projectId: P1,
      enabled: true,
      scenes: [rule('scene_001', [], { required: true }), rule('scene_002', [TECH]), rule('scene_003', [TRAINING]), rule('scene_004', [TECH], { priority: 'low' })],
    },
  ]);
  const docs: BriefingSourceDoc[] = [{ projectId: P1, scenes: [scene('scene_001', 1, 20), scene('scene_002', 2, 20), scene('scene_003', 3, 20), scene('scene_004', 4, 20)] }];
  return { catalog, docs };
}

describe('2. 同梱の AI への指示と 3. 確かめる', () => {
  it('指示には名前・秒・興味・必ず入れる・セリフ（上限まで）だけ。出力の形は見せた記号だけ', () => {
    const { catalog } = fixture();
    const long = 'あ'.repeat(BRIEFING_AI_SPEECH_MAX_LENGTH + 10);
    const docs: BriefingSourceDoc[] = [{ projectId: P1, scenes: [scene('scene_001', 1, 12.4), scene('scene_002', 2, 20, { narration: { text: long } })] }];
    const offer = collectBriefingCandidates(catalog, docs, [TECH]);
    const labels = new Map(catalog.interests.map((i) => [i.interestId, i.label]));
    const m = buildBriefingComposeMessages(offer, labels, [TECH], 'normal');
    expect(m.user).toContain('# 学生が知りたいこと\n技術');
    expect(m.user).toContain('c1｜見出しscene_001｜12秒｜興味：なし｜必ず入れる');
    expect(m.user).toContain(`c2｜見出しscene_002｜20秒｜興味：技術\n  セリフ：${'あ'.repeat(BRIEFING_AI_SPEECH_MAX_LENGTH)}\n`.trimEnd());
    expect(m.user).not.toContain('あ'.repeat(BRIEFING_AI_SPEECH_MAX_LENGTH + 1));
    expect(m.user).not.toContain(P1);
    expect(m.system).toContain(`約${BRIEFING_LENGTH_RANGE_SEC.normal.min}〜${BRIEFING_LENGTH_RANGE_SEC.normal.max}秒`);
    const order = (m.schema.properties as { order: { items: { enum: string[] }; maxItems: number } }).order;
    expect(order.items.enum).toEqual(['c1', 'c2']);
    expect(order.maxItems).toBe(2);
  });

  it('見せる候補は、必ず入れる場面＋先に採る順で上限まで（並びは自然な順）', () => {
    const n = BRIEFING_AI_CANDIDATE_MAX + 5;
    const rules = Array.from({ length: n }, (_, i) => rule(`scene_${String(i + 1).padStart(3, '0')}`, [TECH], { priority: i === n - 1 ? 'high' : 'normal', required: i === n - 2 }));
    const catalog = catalogWith([{ projectId: P1, enabled: true, scenes: rules }]);
    const docs: BriefingSourceDoc[] = [{ projectId: P1, scenes: rules.map((r, i) => scene(r.sceneId, i + 1, 5)) }];
    const offer = briefingAiOffer(collectBriefingCandidates(catalog, docs, [TECH]));
    expect(offer).toHaveLength(BRIEFING_AI_CANDIDATE_MAX);
    expect(offer.at(-1)?.sceneId).toBe(`scene_${String(n).padStart(3, '0')}`);
    expect(offer.at(-2)?.sceneId).toBe(`scene_${String(n - 1).padStart(3, '0')}`);
    expect(offer[0].sceneId).toBe('scene_001');
  });

  it.each([
    ['読めない', 'xx', 'unreadable'],
    ['形が違う', '{"list":[]}', 'unreadable'],
    ['空', '{"order":[]}', 'empty'],
    ['一覧に無い記号', '{"order":["c1","c9"]}', 'unknownScene'],
    ['重なり', '{"order":["c1","c2","c2"]}', 'duplicate'],
    ['必ず入れるの抜け', '{"order":["c2","c3","c4"]}', 'requiredMissing'],
  ] as const)('%s は使わない', (_, raw, problem) => {
    const { catalog, docs } = fixture();
    const offer = collectBriefingCandidates(catalog, docs, [TECH, TRAINING]);
    expect(checkBriefingComposition(raw, offer, 'short')).toEqual({ ok: false, problem });
  });

  it('長さ＝上限越えは使わない・下限割れは使わない（全部足しても届かないときは、その合計まで下げる）・通れば AI の順のまま', () => {
    const { catalog, docs } = fixture();
    const offer = collectBriefingCandidates(catalog, docs, [TECH, TRAINING]);
    // short＝40〜80 秒・各 20 秒
    expect(checkBriefingComposition('{"order":["c1","c2","c3","c4","c1"]}', offer, 'short')).toEqual({ ok: false, problem: 'duplicate' });
    expect(checkBriefingComposition('{"order":["c1"]}', offer, 'short')).toEqual({ ok: false, problem: 'tooShort' });
    const ok = checkBriefingComposition('{"order":["c3","c1"]}', offer, 'short');
    expect(ok.ok && keysOf(ok.picks)).toEqual(['1:scene_003', '1:scene_001']);
    expect(checkBriefingComposition('{"order":["c1","c2","c3","c4"]}', offer, 'short').ok).toBe(true);
    // normal＝90〜150 だが全部で 80 秒＝80 まで下げる
    expect(checkBriefingComposition('{"order":["c1","c2","c3"]}', offer, 'normal')).toEqual({ ok: false, problem: 'tooShort' });
    expect(checkBriefingComposition('{"order":["c1","c2","c3","c4"]}', offer, 'normal').ok).toBe(true);
    // 上限越え
    const big = collectBriefingCandidates(catalog, [{ projectId: P1, scenes: docs[0].scenes.map((s) => ({ ...s, durationSec: 30 })) }], [TECH, TRAINING]);
    expect(checkBriefingComposition('{"order":["c1","c2","c3"]}', big, 'short')).toEqual({ ok: false, problem: 'tooLong' });
    expect(checkBriefingComposition('{"order":["c1","c2"]}', big, 'short').ok).toBe(true);
    // 必ず入れる場面だけで上限を越えるときは、その合計まで上限を広げる（削らない）
    const heavy = collectBriefingCandidates(catalog, [{ projectId: P1, scenes: [scene('scene_001', 1, BRIEFING_LENGTH_RANGE_SEC.short.max + 10)] }], [TECH]);
    expect(checkBriefingComposition('{"order":["c1"]}', heavy, 'short').ok).toBe(true);
  });
});

describe('1〜4 を通して組む', () => {
  it('AI の並びが通れば AI の順で使う（渡すのは指示文と出力の形だけ）', async () => {
    const { catalog, docs } = fixture();
    const calls: string[][] = [];
    const r = await composeBriefing({ catalog, docs, chosenInterestIds: [TECH, TRAINING], length: BRIEFING_LENGTH.short }, async (s, u, schema) => {
      calls.push([s, u, schema]);
      return '{"order":["c3","c1","c2"]}';
    });
    expect(r.by).toBe('ai');
    expect(r.aiProblem).toBeNull();
    expect(keysOf(r.picks)).toEqual(['1:scene_003', '1:scene_001', '1:scene_002']);
    expect(r.totalSec).toBe(60);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0][2]).properties.order.items.enum).toEqual(['c1', 'c2', 'c3', 'c4']);
  });

  it('AI が投げた・確かめで落ちたら、ルールだけで組む（理由を残す）', async () => {
    const { catalog, docs } = fixture();
    const input = { catalog, docs, chosenInterestIds: [TECH, TRAINING], length: BRIEFING_LENGTH.short };
    const rules = keysOf(composeBriefingByRules(collectBriefingCandidates(catalog, docs, [TECH, TRAINING]), [TECH, TRAINING], 'short'));
    const failed = await composeBriefing(input, async () => {
      throw new Error('x');
    });
    expect([failed.by, failed.aiProblem, keysOf(failed.picks)]).toEqual(['rules', 'failed', rules]);
    const bad = await composeBriefing(input, async () => '{"order":["c2"]}');
    expect([bad.by, bad.aiProblem, keysOf(bad.picks)]).toEqual(['rules', 'requiredMissing', rules]);
    expect(bad.totalSec).toBe(bad.picks.reduce((t, c) => t + c.durationSec, 0));
  });

  it('AI が無い・選ぶものが1つ以下なら頼まない。候補が0なら空', async () => {
    const { catalog, docs } = fixture();
    let asked = 0;
    const ask = async (): Promise<string> => {
      asked += 1;
      return '{"order":["c1"]}';
    };
    const none = await composeBriefing({ catalog, docs, chosenInterestIds: [TECH], length: 'short' });
    expect([none.by, none.aiProblem]).toEqual(['rules', null]);
    const one = await composeBriefing({ catalog: catalogWith([{ projectId: P1, enabled: true, scenes: [rule('scene_002', [TECH])] }]), docs, chosenInterestIds: [TECH], length: 'short' }, ask);
    expect(keysOf(one.picks)).toEqual(['1:scene_002']);
    const empty = await composeBriefing({ catalog: catalogWith([]), docs, chosenInterestIds: [TECH], length: 'short' }, ask);
    expect(empty.picks).toEqual([]);
    expect(asked).toBe(0);
  });
});
