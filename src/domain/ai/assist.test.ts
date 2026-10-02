// 編集の途中の AI 補助（ADR-0053）。
import { describe, expect, it } from 'vitest';
import {
  ASSIST_CANDIDATES, ASSIST_SUBTITLE_TARGET_LENGTH, ASSIST_TITLE_MAX_LENGTH, ASSIST_VIDEO_SUMMARY_MAX_LENGTH, ASSIST_VIDEO_TITLE_MAX_LENGTH,
  MAX_NARRATION_LEN_DEFAULT, MAX_SUBTITLE_LEN_DEFAULT, NARRATION_CHARS_PER_SEC, NARRATION_SCENE_PADDING_SEC,
} from '../constants';
import { ASSIST_KIND, assistMaxLength, buildAssistMessages, charsForDuration, parseAssistCandidates, sceneSpokenText, videoTitleSource } from './assist';
import { COMPANY_NAME_PLACEHOLDER } from './refineVideoPlan';

const NAME = '株式会社サンプル物流';

describe('assistMaxLength', () => {
  it('短く＝今の文の7割（語りの上限も越えない）', () => {
    expect(assistMaxLength(ASSIST_KIND.shorten, 'あ'.repeat(100), {})).toBe(70);
    expect(assistMaxLength(ASSIST_KIND.shorten, 'あ'.repeat(300), { maxNarrationLength: 120 })).toBe(120);
  });

  it('丁寧に・やわらかく＝語りの上限（無ければ既定）', () => {
    expect(assistMaxLength(ASSIST_KIND.polite, 'x'.repeat(20), { maxNarrationLength: 90 })).toBe(90);
    expect(assistMaxLength(ASSIST_KIND.soft, 'x'.repeat(20), {})).toBe(MAX_NARRATION_LEN_DEFAULT);
  });

  it('表示時間に収める＝表示時間で読み切れる字数。もう収まっている・時間が無いなら頼まない', () => {
    const fit = charsForDuration(6);
    expect(fit).toBe(Math.floor((6 - NARRATION_SCENE_PADDING_SEC) * NARRATION_CHARS_PER_SEC));
    expect(assistMaxLength(ASSIST_KIND.fitDuration, 'あ'.repeat(fit + 1), { sceneDurationSec: 6 })).toBe(fit);
    expect(assistMaxLength(ASSIST_KIND.fitDuration, 'あ'.repeat(fit), { sceneDurationSec: 6 })).toBeNull();
    expect(assistMaxLength(ASSIST_KIND.fitDuration, 'あ'.repeat(100), {})).toBeNull();
    expect(assistMaxLength(ASSIST_KIND.fitDuration, 'あ'.repeat(200), { sceneDurationSec: 30, maxNarrationLength: 100 })).toBe(100);
  });

  it('表示時間に収める字数は声の速さに合わせる（#1318）', () => {
    expect(charsForDuration(6, 1.2)).toBe(Math.floor((6 - NARRATION_SCENE_PADDING_SEC) * NARRATION_CHARS_PER_SEC * 1.2));
    const text = 'あ'.repeat(40);
    // 速さ 1.0 では 37 字に収める必要がある文でも、速い声ならもう収まっている（頼まない）。
    expect(assistMaxLength(ASSIST_KIND.fitDuration, text, { sceneDurationSec: 6 })).toBe(charsForDuration(6));
    expect(assistMaxLength(ASSIST_KIND.fitDuration, text, { sceneDurationSec: 6, voiceSpeed: 1.2 })).toBeNull();
  });

  it('字幕＝字幕の上限と目安の短い方／見出し＝見出しの上限', () => {
    expect(assistMaxLength(ASSIST_KIND.subtitle, 'x', {})).toBe(Math.min(MAX_SUBTITLE_LEN_DEFAULT, ASSIST_SUBTITLE_TARGET_LENGTH));
    expect(assistMaxLength(ASSIST_KIND.subtitle, 'x', { maxSubtitleLength: 20 })).toBe(20);
    expect(assistMaxLength(ASSIST_KIND.title, 'x', {})).toBe(ASSIST_TITLE_MAX_LENGTH);
  });

  it('上限が短すぎるなら頼まない（境目は8字）', () => {
    expect(assistMaxLength(ASSIST_KIND.shorten, 'あ'.repeat(11), {})).toBeNull(); // 7
    expect(assistMaxLength(ASSIST_KIND.shorten, 'あ'.repeat(12), {})).toBe(8);
    expect(assistMaxLength(ASSIST_KIND.fitDuration, 'あ'.repeat(50), { sceneDurationSec: 2 })).toBeNull();
  });
});

describe('buildAssistMessages', () => {
  it('会社名は印にして渡し、印の分だけ短い上限を渡す', () => {
    const m = buildAssistMessages(ASSIST_KIND.shorten, `${NAME}は地域の配送をしています。`, 40, { companyName: NAME });
    expect(m.user).toContain(`${COMPANY_NAME_PLACEHOLDER}は地域の配送`);
    expect(m.user).not.toContain(NAME);
    expect(m.budget).toBe(40 - (NAME.length - COMPANY_NAME_PLACEHOLDER.length));
    // 形の上限は字数の上限より緩い（字数で縛ると途中で切られた文が出る＝実測）。
    expect((m.schema as { properties: { candidates: { items: { maxLength: number }; maxItems: number } } }).properties.candidates).toMatchObject({ maxItems: ASSIST_CANDIDATES, items: { maxLength: m.budget * 2 } });
    expect(m.system).toContain(`${m.budget}字以内`);
  });

  it('種類ごとに作業の言い方が違う・事実を足さないよう伝える', () => {
    const kinds = Object.values(ASSIST_KIND);
    const systems = kinds.map((k) => buildAssistMessages(k, 'x', 30, { sceneDurationSec: 5 }).system);
    expect(new Set(systems).size).toBe(kinds.length);
    for (const s of systems) expect(s).toContain('元の文に無い事実');
    expect(buildAssistMessages(ASSIST_KIND.fitDuration, 'x', 30, { sceneDurationSec: 5 }).system).toContain('約5秒');
    expect(buildAssistMessages(ASSIST_KIND.subtitle, 'x', 30).user.startsWith('# 語り')).toBe(true);
    expect(buildAssistMessages(ASSIST_KIND.polite, 'x', 30).user.startsWith('# 元の文')).toBe(true);
  });
});

describe('parseAssistCandidates', () => {
  const raw = (c: unknown) => JSON.stringify({ candidates: c });

  it('候補を取り出し、印を会社名に戻し、崩れた会社名を直し、括弧の囲みを外す', () => {
    expect(parseAssistCandidates(raw([`${COMPANY_NAME_PLACEHOLDER}です`, '「株式会社サンプルの話」', ' 短い文 ']), '元', 30, NAME))
      .toEqual([`${NAME}です`, `${NAME}の話`, '短い文']);
  });

  it('空・上限越え（戻した後）・元と同じ・重なり・文字でないものを落とす', () => {
    const out = parseAssistCandidates(raw(['', 'あ'.repeat(11), '元の文', 'いい文', 'いい文', 3, `${COMPANY_NAME_PLACEHOLDER}`]), ' 元の文 ', 10, NAME);
    expect(out).toEqual(['いい文', NAME]);
    expect(parseAssistCandidates(raw([`${COMPANY_NAME_PLACEHOLDER}だよ`]), 'x', 10, NAME)).toEqual([]); // 戻すと 12 字
  });

  it('改行を消し、数字と和文の間の空白を詰める', () => {
    expect(parseAssistCandidates(raw(['入社後は\n 3 ヶ月の研修', '平均で 2割']), 'x', 30)).toEqual(['入社後は3ヶ月の研修', '平均で2割']);
  });

  it('見出しは文にしないよう伝える', () => {
    expect(buildAssistMessages(ASSIST_KIND.title, 'x', 20).system).toContain('文にしない');
  });

  it('上限を越えた候補は、上限の内側の最後の文の終わりで切る（語の途中では切らない）', () => {
    expect(parseAssistCandidates(raw(['入社後に研修を受けます。未経験でも安心です。']), 'x', 15)).toEqual(['入社後に研修を受けます。']);
    expect(parseAssistCandidates(raw(['研修があります！安心です']), 'x', 10)).toEqual(['研修があります！']);
    // 文の終わりが無い・切ると短すぎる（8 字未満）なら落とす。
    expect(parseAssistCandidates(raw(['入社後に研修を受けて未経験でも安心']), 'x', 10)).toEqual([]);
    expect(parseAssistCandidates(raw(['研修です。入社後に研修を受けて安心']), 'x', 10)).toEqual([]);
    // 文の終わりがちょうど上限の字にあっても切れる。
    expect(parseAssistCandidates(raw(['あいうえおかきくけ。こ']), 'x', 10)).toEqual(['あいうえおかきくけ。']);
  });

  it('上限ちょうどは通す（境目）', () => {
    expect(parseAssistCandidates(raw(['あ'.repeat(10)]), 'x', 10)).toEqual(['あ'.repeat(10)]);
  });

  it('多すぎる候補は先頭から上限の数まで', () => {
    expect(parseAssistCandidates(raw(['a1', 'a2', 'a3', 'a4', 'a5']), 'x', 10)).toHaveLength(ASSIST_CANDIDATES);
  });

  it('形が違えば候補なし', () => {
    for (const r of ['', 'x', 'null', '{"candidates":"a"}', '{}']) expect(parseAssistCandidates(r, 'x', 10)).toEqual([]);
  });

  it('会社名が無ければ印は空にする', () => {
    expect(parseAssistCandidates(raw([`${COMPANY_NAME_PLACEHOLDER}へようこそ`]), 'x', 10)).toEqual(['へようこそ']);
  });
});

// #1316：掛け合いの見出しと動画の題名の材料。
describe('sceneSpokenText / videoTitleSource / 動画の題名', () => {
  it('掛け合いは行をつなぐ（空の行は除く・narration の写しは使わない）／単独は narration', () => {
    expect(sceneSpokenText({ narration: { text: '写し' }, lines: [{ text: ' 一つ目 ' }, { text: '' }, { text: '二つ目' }] })).toBe('一つ目\n二つ目');
    expect(sceneSpokenText({ narration: { text: ' 単独 ' }, lines: [] })).toBe('単独');
    expect(sceneSpokenText({ narration: null })).toBe('');
  });

  it('題名の材料＝主題＋各場面の語り（空は除く）を、上限の字数で切る', () => {
    const src = videoTitleSource('株式会社サンプル', [{ narration: { text: 'はじめまして' } }, { narration: { text: '' } }, { lines: [{ text: 'よろしく' }] }]);
    expect(src).toBe('テーマ：株式会社サンプル\nはじめまして\nよろしく');
    expect(videoTitleSource(undefined, [{ narration: { text: 'あ' } }])).toBe('あ');
    const long = videoTitleSource('x', Array.from({ length: 50 }, () => ({ narration: { text: 'い'.repeat(30) } })));
    expect(long.length).toBe(ASSIST_VIDEO_SUMMARY_MAX_LENGTH);
  });

  it('動画の題名は専用の上限・見出しの作業・「動画の内容」として渡す', () => {
    expect(assistMaxLength(ASSIST_KIND.videoTitle, 'x', {})).toBe(ASSIST_VIDEO_TITLE_MAX_LENGTH);
    const m = buildAssistMessages(ASSIST_KIND.videoTitle, '主題：x', ASSIST_VIDEO_TITLE_MAX_LENGTH);
    expect(m.user.startsWith('# 動画の内容')).toBe(true);
    expect(m.system.startsWith('あなたは動画のタイトルを付ける編集者です。')).toBe(true); // 「整える」ではなく「名付ける」役割
    expect(m.system).toContain('本文の文を書き写さない');
    expect(m.system).toContain('文にしない');
    expect(m.system).toContain('例：'); // 例なしだと本文の一文を書き写した（実測）
    // ほかの作業は従来の役割のまま
    expect(buildAssistMessages(ASSIST_KIND.title, 'x', 20).system.startsWith('あなたは動画のセリフ・字幕・見出しを整える編集者です。')).toBe(true);
  });
});

// #1316 レビュー 🟡：要約の作業は、入力に会社名が何度出ても、差し引くのは1回分（出力に入るのはせいぜい1回）。
describe('会社名が何度も出る材料での上限（要約の作業）', () => {
  const NAME11 = '株式会社スターシステム'; // 11字＝印（5字）との差 6字
  const src = videoTitleSource(NAME11, [{ narration: { text: `${NAME11}です。` } }, { narration: { text: `${NAME11}で働く。` } }, { narration: { text: `${NAME11}へ。` } }]);
  it('動画の題名・見出し・字幕は1回分だけ差し引く（言い直しは回数ぶん）', () => {
    const diff = NAME11.length - COMPANY_NAME_PLACEHOLDER.length;
    for (const kind of [ASSIST_KIND.videoTitle, ASSIST_KIND.title, ASSIST_KIND.subtitle]) {
      const m = buildAssistMessages(kind, src, 24, { companyName: NAME11 });
      expect(m.budget, kind).toBe(24 - diff);
    }
    expect(buildAssistMessages(ASSIST_KIND.shorten, src, 60, { companyName: NAME11 }).budget).toBe(60 - 4 * diff);
  });
});
