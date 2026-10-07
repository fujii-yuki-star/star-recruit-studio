// 上限を越えた1文を短く言い直させる指示文（ADR-0052 段階1・12 §8.7）。
import { describe, expect, it } from 'vitest';
import { COMPANY_NAME_PLACEHOLDER } from './refineVideoPlan';
import { SHORTEN_SYSTEM_PROMPT, buildShortenMessages, parseShortenResponse } from './shortenTextRequest';

describe('buildShortenMessages', () => {
  it('字数の上限と元の文を渡し、出力は上限つきの1文に縛る', () => {
    const m = buildShortenMessages('長い文です。', 12);
    expect(m.system).toBe(SHORTEN_SYSTEM_PROMPT);
    expect(m.user).toContain('12字以内');
    expect(m.user).toContain('長い文です。');
    expect(m.schema).toEqual({
      type: 'object', additionalProperties: false, required: ['text'],
      properties: { text: { type: 'string', minLength: 1, maxLength: 12 } },
    });
  });

  it('会社名の印を残すよう伝える（言い直しで会社名を崩させない）', () => {
    expect(SHORTEN_SYSTEM_PROMPT).toContain(`${COMPANY_NAME_PLACEHOLDER} はそのまま残す`);
  });
});

describe('parseShortenResponse', () => {
  it('text を取り出す', () => {
    expect(parseShortenResponse(' {"text":"短い文"} ')).toBe('短い文');
  });

  it.each(['', 'not json', '{"txt":"x"}', '{"text":1}', 'null', '"x"'])('形が違えば null（%s）', (raw) => {
    expect(parseShortenResponse(raw)).toBeNull();
  });
});
