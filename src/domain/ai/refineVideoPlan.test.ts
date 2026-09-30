// 同梱の AI の動画案をソフトで整える（ADR-0052 段階1・12 §8.7）。
import { describe, expect, it, vi } from 'vitest';
import {
  AI_SCENE_MAX_DURATION_SEC,
  AI_SCENE_MIN_DURATION_SEC,
  NARRATION_CHARS_PER_SEC,
  NARRATION_SCENE_PADDING_SEC,
} from '../constants';
import type { TemplateSummary } from './aiProvider';
import {
  COMPANY_NAME_PLACEHOLDER,
  RECRUIT_URL_PLACEHOLDER,
  allocateDurations,
  findOverlongTexts,
  insertProperNouns,
  refineVideoPlan,
  repairTruncatedName,
  reselectTemplates,
  setTextAt,
  speechSec,
} from './refineVideoPlan';
import type { AiScene, AiVideoPlan } from './types';
import { validateAiVideoPlan } from './validateVideoPlan';
import { transformVideoPlan } from './transformPlan';
import { buildTemplateSummaries } from './videoPlanInput';
import { sampleTemplates } from '../../infrastructure/sampleData';

const NAME = '株式会社サンプル物流';
const URL = 'https://example.com/recruit';

function tmpl(id: string, category: string, extra: Partial<TemplateSummary> = {}): TemplateSummary {
  return {
    templateId: id, category, hasYuko: true, requiredSlots: [],
    maxNarrationLength: 120, maxSubtitleLength: 60, maxDurationSec: 15, ...extra,
  };
}

const TEMPLATES: TemplateSummary[] = [
  tmpl('opening_a', 'opening', { maxDurationSec: 12 }),
  tmpl('point_a', 'point_list', { maxNarrationLength: 40 }),
  tmpl('point_b', 'point_list', { maxNarrationLength: 40 }),
  tmpl('photo_a', 'photo_intro', { requiredSlots: ['mainVisual'] }),
  tmpl('photo_b', 'photo_intro', { requiredSlots: ['heroImage'] }),
  tmpl('chapter_a', 'chapter', { hasYuko: false, maxDurationSec: 6, maxNarrationLength: 60, maxSubtitleLength: 40 }),
];

function scene(over: Partial<AiScene> = {}): AiScene {
  return {
    sceneType: 'point_list', templateId: 'point_a', durationSec: 8, texts: {},
    narrationText: 'こんにちは。', yukoPoseTag: 'smile', ...over,
  } as AiScene;
}

function plan(scenes: AiScene[], title = '動画'): AiVideoPlan {
  return {
    schemaVersion: '1.0',
    videoPlan: { title, purpose: 'company_intro', targetDurationSec: 60 },
    parts: [{ partTitle: 'パート', scenes }],
  };
}

const flat = (p: AiVideoPlan): AiScene[] => p.parts.flatMap((x) => x.scenes);

describe('repairTruncatedName（崩れた会社名を直す）', () => {
  it('本体の途中で切れた会社名を入力の会社名に直す（実測の崩れ）', () => {
    expect(repairTruncatedName('株式会社サンプルの魅力を紹介します。', NAME))
      .toEqual({ text: '株式会社サンプル物流の魅力を紹介します。', fixes: 1 });
  });

  it('完全な会社名はそのまま・直した数に数えない', () => {
    expect(repairTruncatedName('株式会社サンプル物流へようこそ。株式会社サンプル物流です。', NAME))
      .toEqual({ text: '株式会社サンプル物流へようこそ。株式会社サンプル物流です。', fixes: 0 });
  });

  it('続きが名前になりうる字なら別の会社かもしれないので直さない', () => {
    expect(repairTruncatedName('株式会社サンプル物産と提携しています。', NAME).fixes).toBe(0);
    expect(repairTruncatedName('株式会社サンプルA社', NAME).fixes).toBe(0);
  });

  it('本体の最初の1字だけの一致は偶然とみなして直さない', () => {
    expect(repairTruncatedName('株式会社サービス', NAME).fixes).toBe(0);
    expect(repairTruncatedName('株式会社サは', NAME).fixes).toBe(0);
  });

  it('本体の先頭2字が合えば崩れとみなす（境目）', () => {
    expect(repairTruncatedName('株式会社サンです', NAME).text).toBe(`${NAME}です`);
  });

  it('種類の語が後ろに付く会社名でも直す', () => {
    expect(repairTruncatedName('サンプル株式会社の強み', 'サンプル物流株式会社'))
      .toEqual({ text: 'サンプル物流株式会社の強み', fixes: 1 });
    expect(repairTruncatedName('新サンプル株式会社', 'サンプル物流株式会社').fixes).toBe(0);
  });

  it('1つの文の中の複数の崩れを全部直す', () => {
    const r = repairTruncatedName('株式会社サンプルは、株式会社サンプル物流で、株式会社サンプル。', NAME);
    expect(r).toEqual({ text: `${NAME}は、${NAME}で、${NAME}。`, fixes: 2 });
  });

  it('種類の語が無い会社名は崩れを判定しない（印だけで守る）', () => {
    expect(repairTruncatedName('ゆうこ商の魅力', 'ゆうこ商店').fixes).toBe(0);
  });
});

describe('insertProperNouns（固有名詞は入力の文字列を差し込む）', () => {
  it('差し込みの印を入力の値に置き換える（題名・パート名・画面の文字・語り・掛け合い）', () => {
    const p = plan([scene({
      sceneTitle: `${COMPANY_NAME_PLACEHOLDER}とは`,
      texts: { title: `${COMPANY_NAME_PLACEHOLDER}へようこそ`, url: RECRUIT_URL_PLACEHOLDER },
      narrationText: `${COMPANY_NAME_PLACEHOLDER}を紹介します。`,
      narrationLines: [{ text: `${COMPANY_NAME_PLACEHOLDER}です`, subtitle: `${COMPANY_NAME_PLACEHOLDER}` }],
    })], `${COMPANY_NAME_PLACEHOLDER} 会社紹介`);
    p.parts[0].partTitle = `${COMPANY_NAME_PLACEHOLDER}の仕事`;
    p.parts[0].summary = `${COMPANY_NAME_PLACEHOLDER}`;
    p.reviewNotes = [`${COMPANY_NAME_PLACEHOLDER}の写真を確認`];
    const { plan: out, fixes } = insertProperNouns(p, { companyName: NAME, recruitUrl: URL });
    const s = flat(out)[0];
    expect(out.videoPlan.title).toBe(`${NAME} 会社紹介`);
    expect(out.parts[0].partTitle).toBe(`${NAME}の仕事`);
    expect(out.parts[0].summary).toBe(NAME);
    expect(out.reviewNotes).toEqual([`${NAME}の写真を確認`]);
    expect(s.sceneTitle).toBe(`${NAME}とは`);
    expect(s.texts).toEqual({ title: `${NAME}へようこそ`, url: URL });
    expect(s.narrationText).toBe(`${NAME}を紹介します。`);
    expect(s.narrationLines).toEqual([{ text: `${NAME}です`, subtitle: NAME }]);
    expect(fixes).toBe(10);
  });

  it('全角の括弧・二重の括弧の印も拾う', () => {
    const p = plan([scene({ narrationText: '｛会社名｝と{{会社名}}と{ 会社名 }' })]);
    expect(flat(insertProperNouns(p, { companyName: NAME }).plan)[0].narrationText).toBe(`${NAME}と${NAME}と${NAME}`);
  });

  it('入力に値の無い印は空にする（印のまま画面に出さない）', () => {
    const p = plan([scene({ texts: { url: RECRUIT_URL_PLACEHOLDER }, narrationText: `${COMPANY_NAME_PLACEHOLDER}です` })]);
    const s = flat(insertProperNouns(p, {}).plan)[0];
    expect(s.texts.url).toBe('');
    expect(s.narrationText).toBe('です');
  });

  it('崩れた会社名も直す（印を使わずに書き写された場合）', () => {
    const p = plan([scene({ narrationText: '株式会社サンプルの魅力' })]);
    const r = insertProperNouns(p, { companyName: NAME });
    expect(flat(r.plan)[0].narrationText).toBe(`${NAME}の魅力`);
    expect(r.fixes).toBe(1);
  });

  it('画面の URL は入力の採用ページに揃える（書き写しの1字ずれ）', () => {
    const p = plan([scene({ texts: { url: 'https://example.com/recrut' } }), scene({ texts: { url: URL } })]);
    const r = insertProperNouns(p, { recruitUrl: URL });
    expect(flat(r.plan).map((s) => s.texts.url)).toEqual([URL, URL]);
    expect(r.fixes).toBe(1);
  });

  it('URL の欄が無い場面に URL を足さない', () => {
    const p = plan([scene({ texts: { title: 'x' } })]);
    expect(flat(insertProperNouns(p, { recruitUrl: URL }).plan)[0].texts).toEqual({ title: 'x' });
  });

  it('元の plan を壊さない', () => {
    const p = plan([scene({ narrationText: `${COMPANY_NAME_PLACEHOLDER}` })]);
    insertProperNouns(p, { companyName: NAME });
    expect(flat(p)[0].narrationText).toBe(COMPANY_NAME_PLACEHOLDER);
  });
});

describe('reselectTemplates（同じ種類の中で見た目を選び直す）', () => {
  it('同じ見た目が続くとき、同じ種類の別の見た目にする（実測の point_list 3連続）', () => {
    const p = plan([scene(), scene(), scene()]);
    const r = reselectTemplates(p, TEMPLATES);
    expect(flat(r.plan).map((s) => s.templateId)).toEqual(['point_a', 'point_b', 'point_a']);
    expect(r.changes).toBe(1);
  });

  it('場面の種類は変えない（話の流れは AI の判断）', () => {
    const p = plan([scene(), scene()]);
    expect(flat(reselectTemplates(p, TEMPLATES).plan).map((s) => s.sceneType)).toEqual(['point_list', 'point_list']);
  });

  it('差し込み口の id が違う見た目へ移すとき、当てた素材を移す（写真を落とさない）', () => {
    const photo = scene({ sceneType: 'photo_intro', templateId: 'photo_a', assetRefs: { mainVisual: 'asset_1' } });
    const r = reselectTemplates(plan([photo, { ...photo, assetRefs: { mainVisual: 'asset_2' } }]), TEMPLATES);
    const [a, b] = flat(r.plan);
    expect(a).toMatchObject({ templateId: 'photo_a', assetRefs: { mainVisual: 'asset_1' } });
    expect(b.templateId).toBe('photo_b');
    expect(b.assetRefs).toEqual({ heroImage: 'asset_2' });
  });

  it('当てた素材が入りきらない見た目には移さない', () => {
    const two = [tmpl('p2', 'photo_intro', { requiredSlots: ['a', 'b'] }), tmpl('p1', 'photo_intro', { requiredSlots: ['a'] })];
    const s = scene({ sceneType: 'photo_intro', templateId: 'p2', assetRefs: { a: 'x', b: 'y' } });
    expect(flat(reselectTemplates(plan([s, s]), two).plan).map((x) => x.templateId)).toEqual(['p2', 'p2']);
  });

  it('差し込み口以外の鍵（背景など）は動かさない', () => {
    const s = scene({ sceneType: 'photo_intro', templateId: 'photo_a', assetRefs: { mainVisual: 'a1', background: 'bg' } });
    const b = flat(reselectTemplates(plan([s, s]), TEMPLATES).plan)[1];
    expect(b.assetRefs).toEqual({ background: 'bg', heroImage: 'a1' });
  });

  it('語りが上限を越えない見た目を選ぶ（同じ種類の中で）', () => {
    const list = [tmpl('short', 'message', { maxNarrationLength: 10 }), tmpl('long', 'message', { maxNarrationLength: 100 })];
    const s = scene({ sceneType: 'message', templateId: 'short', narrationText: 'あ'.repeat(30) });
    expect(flat(reselectTemplates(plan([s]), list).plan)[0].templateId).toBe('long');
  });

  it('ゆうこを出す場面はゆうこのいる見た目を選ぶ', () => {
    const list = [tmpl('noyuko', 'message', { hasYuko: false }), tmpl('yuko', 'message')];
    const s = scene({ sceneType: 'message', templateId: 'noyuko', yukoPoseTag: 'smile' });
    expect(flat(reselectTemplates(plan([s]), list).plan)[0].templateId).toBe('yuko');
    const n = scene({ sceneType: 'message', templateId: 'yuko', yukoPoseTag: null });
    expect(flat(reselectTemplates(plan([n]), list).plan)[0].templateId).toBe('noyuko');
  });

  it('点が同じなら AI が選んだ見た目を残す', () => {
    const s = scene({ templateId: 'point_b' });
    const r = reselectTemplates(plan([s]), TEMPLATES);
    expect(flat(r.plan)[0].templateId).toBe('point_b');
    expect(r.changes).toBe(0);
  });

  it('一覧に無い・種類と合わない見た目は選び直さない（変換の補正と警告に任せる＝写真が黙って消えない）', () => {
    const s = scene({ templateId: 'photo_a', assetRefs: { mainVisual: 'a1' } }); // point_list なのに photo の見た目
    const u = scene({ templateId: 'nope' });
    const r = reselectTemplates(plan([s, u]), TEMPLATES);
    expect(flat(r.plan)).toEqual([s, u]);
    expect(r.changes).toBe(0);
  });

  it('選び直さなかった不正な見た目も、次の場面の連続の判定では直前として数える', () => {
    const list = [...TEMPLATES, tmpl('nope', 'message'), tmpl('msg2', 'message')];
    const r = reselectTemplates(plan([scene({ templateId: 'nope' }), scene({ sceneType: 'message', templateId: 'nope' })]), list);
    expect(flat(r.plan)[1].templateId).not.toBe('nope');
  });

  it('表情の指定がある場面は、連続になってもゆうこのいない見た目へ移さない（立ち絵を黙って消さない）', () => {
    const list = [tmpl('yuko', 'message'), tmpl('plain', 'message', { hasYuko: false })];
    const s = scene({ sceneType: 'message', templateId: 'yuko', yukoPoseTag: 'smile' });
    expect(flat(reselectTemplates(plan([s, s]), list).plan).map((x) => x.templateId)).toEqual(['yuko', 'yuko']);
  });

  it('同じ種類の候補が無ければそのまま（変換の補正に任せる）', () => {
    const s = scene({ sceneType: 'closing', templateId: 'nope' });
    expect(flat(reselectTemplates(plan([s]), TEMPLATES).plan)[0].templateId).toBe('nope');
  });

  it('パートをまたいでも連続を見る', () => {
    const p = plan([scene()]);
    p.parts.push({ partTitle: '次', scenes: [scene()] });
    expect(flat(reselectTemplates(p, TEMPLATES).plan).map((s) => s.templateId)).toEqual(['point_a', 'point_b']);
  });
});

describe('findOverlongTexts / setTextAt（上限を越えた文）', () => {
  it('語り・字幕が見た目の上限を越えたものを挙げる', () => {
    const s = scene({ narrationText: 'あ'.repeat(41), texts: { subtitle: 'い'.repeat(61) } });
    expect(findOverlongTexts(plan([s]), TEMPLATES)).toEqual([
      { partIndex: 0, sceneIndex: 0, location: { kind: 'narration' }, text: 'あ'.repeat(41), maxLength: 40 },
      { partIndex: 0, sceneIndex: 0, location: { kind: 'subtitle' }, text: 'い'.repeat(61), maxLength: 60 },
    ]);
  });

  it('ちょうど上限は越えていない（境目）', () => {
    expect(findOverlongTexts(plan([scene({ narrationText: 'あ'.repeat(40) })]), TEMPLATES)).toEqual([]);
  });

  it('見た目に上限が無ければ既定の上限（120/60）で見る', () => {
    const s = scene({ templateId: 'unknown', narrationText: 'あ'.repeat(121), texts: { subtitle: 'い'.repeat(60) } });
    expect(findOverlongTexts(plan([s]), TEMPLATES).map((o) => o.maxLength)).toEqual([120]);
  });

  it('掛け合いは各行を見る。字幕を省いた行は語りが字幕に出るので字幕の上限でも見る', () => {
    const s = scene({
      templateId: 'chapter_a', sceneType: 'chapter', narrationText: undefined,
      narrationLines: [{ text: 'あ'.repeat(50) }, { text: 'い'.repeat(61) }, { text: 'う', subtitle: 'え'.repeat(41) }],
    });
    expect(findOverlongTexts(plan([s]), TEMPLATES).map((o) => [o.location, o.maxLength])).toEqual([
      [{ kind: 'lineSubtitle', lineIndex: 0 }, 40],
      [{ kind: 'line', lineIndex: 1 }, 60],
      [{ kind: 'lineSubtitle', lineIndex: 1 }, 40],
      [{ kind: 'lineSubtitle', lineIndex: 2 }, 40],
    ]);
  });

  it('場所を指して1文だけ差し替える（他は変えない・元は壊さない）', () => {
    const p = plan([scene({ narrationLines: [{ text: 'a' }, { text: 'b' }] }), scene()]);
    const at = { partIndex: 0, sceneIndex: 0 };
    expect(flat(setTextAt(p, { ...at, location: { kind: 'narration' } }, 'N'))[0].narrationText).toBe('N');
    expect(flat(setTextAt(p, { ...at, location: { kind: 'subtitle' } }, 'S'))[0].texts.subtitle).toBe('S');
    expect(flat(setTextAt(p, { ...at, location: { kind: 'line', lineIndex: 1 } }, 'L'))[0].narrationLines)
      .toEqual([{ text: 'a' }, { text: 'L' }]);
    expect(flat(setTextAt(p, { ...at, location: { kind: 'lineSubtitle', lineIndex: 0 } }, 'T'))[0].narrationLines)
      .toEqual([{ text: 'a', subtitle: 'T' }, { text: 'b' }]);
    expect(flat(setTextAt(p, { ...at, location: { kind: 'narration' } }, 'N'))[1]).toBe(flat(p)[1]);
    expect(flat(p)[0].narrationText).toBe('こんにちは。');
  });
});

describe('allocateDurations（尺は語りから計算して目標に配分する）', () => {
  const sec = (chars: number) => chars / NARRATION_CHARS_PER_SEC + NARRATION_SCENE_PADDING_SEC;
  const total = (p: AiVideoPlan) => flat(p).reduce((n, s) => n + s.durationSec, 0);

  it('語りの読み上げに要る秒数＝字数÷速さ＋間。掛け合いは行を足す', () => {
    expect(speechSec(scene({ narrationText: 'あ'.repeat(30) }))).toBeCloseTo(sec(30));
    expect(speechSec(scene({ narrationLines: [{ text: 'あ'.repeat(10) }, { text: 'い'.repeat(20) }] }))).toBeCloseTo(sec(30));
    expect(speechSec(scene({ narrationText: null }))).toBeCloseTo(NARRATION_SCENE_PADDING_SEC);
  });

  it('語りが短くても目標の尺まで配る（実測は60秒の目標で106秒）', () => {
    const p = plan([scene({ durationSec: 15 }), scene({ durationSec: 15 }), scene({ durationSec: 15 }), scene({ durationSec: 15 }), scene({ durationSec: 15 })]);
    expect(total(allocateDurations(p, TEMPLATES, 60))).toBeCloseTo(60, 5);
  });

  it('越えていた尺を目標まで縮める（語りを読み切れる長さまで）', () => {
    const p = plan([scene({ durationSec: 15 }), scene({ durationSec: 15 }), scene({ durationSec: 15 })]);
    expect(total(allocateDurations(p, TEMPLATES, 30))).toBeCloseTo(30, 5);
  });

  it('余りは AI が付けた尺の比で配る', () => {
    const p = plan([scene({ durationSec: 4, narrationText: '' }), scene({ durationSec: 12, narrationText: '' })]);
    const [a, b] = flat(allocateDurations(p, TEMPLATES, 14)).map((s) => s.durationSec);
    // 下限 3＋3、余り 8 を 1:3 で配る。
    expect([a, b]).toEqual([5, 9]);
  });

  it('語りを読み切る長さより短くしない（目標を越えても語りは切らない）', () => {
    const long = 'あ'.repeat(100); // 約 14.3 秒
    const p = plan([scene({ templateId: 'unknown', narrationText: long, durationSec: 3 })]);
    const d = flat(allocateDurations(p, TEMPLATES, 5))[0].durationSec;
    expect(d).toBeGreaterThanOrEqual(sec(100));
    expect(d).toBeLessThanOrEqual(AI_SCENE_MAX_DURATION_SEC);
  });

  it('下限は AI 生成の目安の最短（語りが無くても）', () => {
    const p = plan([scene({ narrationText: '', durationSec: 1 })]);
    expect(flat(allocateDurations(p, TEMPLATES, 1))[0].durationSec).toBe(AI_SCENE_MIN_DURATION_SEC);
  });

  it('見た目の上限を越えない（上限は下限より優先＝変換の clamp と同じ）', () => {
    const p = plan([scene({ sceneType: 'chapter', templateId: 'chapter_a', narrationText: 'あ'.repeat(60) })]);
    expect(flat(allocateDurations(p, TEMPLATES, 60))[0].durationSec).toBe(6);
  });

  it('語りが上限より長い場面は上限を下限にして配る（上限が下限より優先＝余りの計算も上限で）', () => {
    const p = plan([
      scene({ sceneType: 'chapter', templateId: 'chapter_a', durationSec: 10, narrationText: 'あ'.repeat(60) }),
      scene({ durationSec: 10, narrationText: '' }),
    ]);
    expect(flat(allocateDurations(p, TEMPLATES, 20)).map((s) => s.durationSec)).toEqual([6, 14]);
  });

  it('見た目の上限が格子に乗らなくても、丸めで上限を越えない', () => {
    const list = [tmpl('odd', 'message', { maxDurationSec: 7.25 })];
    const p = plan([scene({ sceneType: 'message', templateId: 'odd', narrationText: '' })]);
    expect(flat(allocateDurations(p, list, 60))[0].durationSec).toBe(7.25);
  });

  it('上限に達した場面の余りを他の場面へ回す', () => {
    const p = plan([scene({ sceneType: 'chapter', templateId: 'chapter_a', durationSec: 10, narrationText: '' }), scene({ durationSec: 10, narrationText: '' })]);
    const [a, b] = flat(allocateDurations(p, TEMPLATES, 20)).map((s) => s.durationSec);
    expect([a, b]).toEqual([6, 14]);
  });

  it('尺は 0.1 秒の格子に乗る', () => {
    const p = plan([scene({ durationSec: 1 }), scene({ durationSec: 2 }), scene({ durationSec: 4 })]);
    for (const s of flat(allocateDurations(p, TEMPLATES, 37))) {
      expect(String(s.durationSec)).toMatch(/^\d+(\.\d)?$/); // 浮動小数の尾（3.3000000000000003）も残さない
    }
  });

  it('整えた案は正典の検証に通る', () => {
    const p = plan([scene({ durationSec: 0.1 }), scene({ durationSec: 99 })]);
    expect(validateAiVideoPlan(allocateDurations(p, TEMPLATES, 60)).valid).toBe(true);
  });
});

describe('refineVideoPlan（まとめ）', () => {
  const ctx = { templates: TEMPLATES, targetDurationSec: 30, properNouns: { companyName: NAME, recruitUrl: URL } };

  it('会社名は印にして言い直しを頼み、印の分だけ短い上限を渡す。戻ったら会社名を差し込む', async () => {
    const long = `${NAME}は${'あ'.repeat(35)}`; // 46 字 > 40
    const shorten = vi.fn(async () => `${COMPANY_NAME_PLACEHOLDER}はいい会社`);
    const { plan: out, report } = await refineVideoPlan(plan([scene({ narrationText: long })]), ctx, shorten);
    expect(shorten).toHaveBeenCalledWith(`${COMPANY_NAME_PLACEHOLDER}は${'あ'.repeat(35)}`, 40 - (NAME.length - COMPANY_NAME_PLACEHOLDER.length));
    expect(flat(out)[0].narrationText).toBe(`${NAME}はいい会社`);
    expect(report).toMatchObject({ shortened: 1, shortenFailed: 0 });
  });

  it('言い直しても上限を越える・空・失敗なら元の文を残す（黙って切らない）', async () => {
    const long = 'あ'.repeat(41);
    for (const answer of ['い'.repeat(41), '  ', null]) {
      const { plan: out, report } = await refineVideoPlan(plan([scene({ narrationText: long })]), ctx, async () => answer);
      expect(flat(out)[0].narrationText).toBe(long);
      expect(report.shortenFailed).toBe(1);
    }
  });

  it('言い直しで崩れた会社名も直す', async () => {
    const { plan: out } = await refineVideoPlan(
      plan([scene({ narrationText: 'あ'.repeat(41) })]), ctx, async () => '株式会社サンプルです',
    );
    expect(flat(out)[0].narrationText).toBe(`${NAME}です`);
  });

  it('言い直しを渡さなければ越えた数を数えるだけ', async () => {
    const { report } = await refineVideoPlan(plan([scene({ narrationText: 'あ'.repeat(41) })]), ctx);
    expect(report).toMatchObject({ shortened: 0, shortenFailed: 1 });
  });

  it('尺は言い直した後の語りで計算する（順番）', async () => {
    const { plan: out } = await refineVideoPlan(
      plan([scene({ narrationText: 'あ'.repeat(41) })]), { ...ctx, targetDurationSec: 1 }, async () => 'い'.repeat(10),
    );
    expect(flat(out)[0].durationSec).toBe(AI_SCENE_MIN_DURATION_SEC);
  });

  it('見た目を選び直してから、その見た目の上限で言い直しを判定する（順番）', async () => {
    const list = [tmpl('short', 'message', { maxNarrationLength: 10 }), tmpl('long', 'message', { maxNarrationLength: 100 })];
    const shorten = vi.fn(async () => null);
    await refineVideoPlan(plan([scene({ sceneType: 'message', templateId: 'short', narrationText: 'あ'.repeat(30) })]),
      { ...ctx, templates: list }, shorten);
    expect(shorten).not.toHaveBeenCalled();
  });

  it('記録：固有名詞・見た目の数を返す', async () => {
    const { report } = await refineVideoPlan(plan([scene({ narrationText: `${COMPANY_NAME_PLACEHOLDER}` }), scene()]), ctx);
    expect(report).toEqual({ properNounFixes: 1, templateChanges: 1, shortened: 0, shortenFailed: 0 });
  });
});

// ---- レビュー（tests-reviewer）で足した境目 ----

describe('変換の長さの助言と同じ判定（言い直した後は「長すぎる」と言われない）', () => {
  const orientation = '16:9' as const;
  const summaries = buildTemplateSummaries(sampleTemplates, orientation);
  const overflow = (p: AiVideoPlan) =>
    transformVideoPlan(p, { templates: sampleTemplates, assets: [], orientation }).warnings.filter((w) => w.code === 'TEXT_OVERFLOW').length;

  it('単独の語り・字幕・掛け合いの行と行字幕で、前は助言が出て、言い直した後は 0', async () => {
    const p = plan([
      scene({ templateId: 'point_list_yuko_v1', narrationText: 'あ'.repeat(141), texts: { subtitle: 'い'.repeat(61) } }),
      scene({ templateId: 'point_list_left_yuko_v1', narrationText: undefined, narrationLines: [{ text: 'う'.repeat(141) }, { text: 'え'.repeat(61) }], texts: { subtitle: 'お'.repeat(61) } }),
    ]);
    expect(overflow(p)).toBe(4); // 種類ごとに1つ×2場面
    expect(findOverlongTexts(p, summaries)).toHaveLength(6); // 語り・字幕／行0・行0の字幕・行1の字幕・字幕
    const { plan: out } = await refineVideoPlan(p, { templates: summaries, targetDurationSec: 30, properNouns: {} },
      async (_t, max) => 'か'.repeat(max));
    expect(findOverlongTexts(out, summaries)).toEqual([]);
    expect(overflow(out)).toBe(0);
  });
});

describe('境目（尺）', () => {
  it('場面が無ければそのまま', () => {
    const p: AiVideoPlan = { ...plan([scene()]), parts: [] };
    expect(allocateDurations(p, TEMPLATES, 60).parts).toEqual([]);
  });

  it('全場面が上限に達したら目標に届かなくても止まる', () => {
    const p = plan([scene({ sceneType: 'chapter', templateId: 'chapter_a' }), scene({ sceneType: 'chapter', templateId: 'chapter_a' })]);
    expect(flat(allocateDurations(p, TEMPLATES, 60)).map((s) => s.durationSec)).toEqual([6, 6]);
  });

  it('複数の場面で下限の合計が目標を越えるなら、どれも下限のまま', () => {
    const long = 'あ'.repeat(60); // 60/7.5+1 = 9 秒
    const p = plan([scene({ templateId: 'unknown', narrationText: long }), scene({ templateId: 'unknown', narrationText: long })]);
    expect(flat(allocateDurations(p, TEMPLATES, 10)).map((s) => s.durationSec)).toEqual([9, 9]);
  });
  // ⚠️ AI の尺の和が 0 以下（weight<=0）の分岐は schema（durationSec は exclusiveMinimum 0）を通った案では起きない＝検査しない。
});

describe('境目（言い直し）', () => {
  const ctx = { templates: TEMPLATES, targetDurationSec: 30, properNouns: { companyName: NAME } };

  it('会社名を戻すだけで上限を越えるなら AI に頼まない', async () => {
    const shorten = vi.fn(async () => 'x');
    const long = NAME.repeat(8); // 印8つ＝印の分だけ縮めると上限 40−8×5＝0
    const { report } = await refineVideoPlan(plan([scene({ narrationText: long })]), ctx, shorten);
    expect(shorten).not.toHaveBeenCalled();
    expect(report.shortenFailed).toBe(1);
  });

  it('会社名が複数あれば、その数だけ上限を縮めて渡す', async () => {
    const shorten = vi.fn(async () => null);
    await refineVideoPlan(plan([scene({ narrationText: `${NAME}と${NAME}の${'あ'.repeat(20)}` })]), ctx, shorten);
    expect(shorten).toHaveBeenCalledWith(expect.any(String), 40 - 2 * (NAME.length - COMPANY_NAME_PLACEHOLDER.length));
  });

  it('崩れた会社名を直したら上限を越えるなら、言い直しは採らない', async () => {
    const { plan: out, report } = await refineVideoPlan(
      plan([scene({ narrationText: 'あ'.repeat(41) })]), ctx, async () => `株式会社サンプル${'い'.repeat(31)}`, // 39 字→直すと 41 字＞40
    );
    expect(flat(out)[0].narrationText).toBe('あ'.repeat(41));
    expect(report.shortenFailed).toBe(1);
  });

  it('字幕を省いた行は字幕だけが付き、語りは変わらない', async () => {
    const s = scene({ sceneType: 'chapter', templateId: 'chapter_a', narrationText: undefined, narrationLines: [{ text: 'あ'.repeat(50) }] });
    const { plan: out } = await refineVideoPlan(plan([s]), ctx, async () => '短い字幕');
    expect(flat(out)[0].narrationLines).toEqual([{ text: 'あ'.repeat(50), subtitle: '短い字幕' }]);
  });
});

describe('境目（見た目）', () => {
  it('差し込み口の定義が無い見た目は口 0 として扱う', () => {
    const list = [{ templateId: 'bare', category: 'message', hasYuko: true }, tmpl('other', 'message')];
    const s = scene({ sceneType: 'message', templateId: 'bare' });
    expect(flat(reselectTemplates(plan([s, s]), list).plan).map((x) => x.templateId)).toEqual(['bare', 'other']);
  });

  it('場面が無ければそのまま', () => {
    expect(reselectTemplates({ ...plan([scene()]), parts: [] }, TEMPLATES)).toMatchObject({ changes: 0, plan: { parts: [] } });
  });

  it('素材を当てていない場面は、移しても assetRefs を作らない', () => {
    const s = scene({ sceneType: 'photo_intro', templateId: 'photo_a' });
    const b = flat(reselectTemplates(plan([s, s]), TEMPLATES).plan)[1];
    expect(b.templateId).toBe('photo_b');
    expect('assetRefs' in b).toBe(false);
  });

  it('移り先の口が素材より多ければ、残りの口は空のまま', () => {
    const list = [tmpl('one', 'photo_intro', { requiredSlots: ['a'] }), tmpl('two', 'photo_intro', { requiredSlots: ['b', 'c'] })];
    const s = scene({ sceneType: 'photo_intro', templateId: 'one', assetRefs: { a: 'x' } });
    expect(flat(reselectTemplates(plan([s, s]), list).plan)[1].assetRefs).toEqual({ b: 'x' });
  });
});
