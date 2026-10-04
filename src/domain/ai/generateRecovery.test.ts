// 動画案づくりの失敗で、ボタンが文の名指しする行き先に従う（UI/UX 監査 2026-10-02・§2-5）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { aiSceneLimitMessage } from '../project/sceneLimit';
import { generateRecovery } from './generateRecovery';

/** 表（`15 §6` の TSV）の文。⚠️ **実物の文で叩く**＝文を書き写して検査すると、表の文が変わっても緑のまま。 */
const table = readFileSync(join(process.cwd(), 'docs', 'yuko_recruit_docs', 'errors', 'error-state-table.tsv'), 'utf8');
function row(code: string): string {
  const line = table.split('\n').find((l) => l.startsWith(`\`${code}\`\t`));
  if (!line) throw new Error(`${code} が表に無い`);
  return line.split('\t')[3];
}

describe('generateRecovery', () => {
  it.each([
    ['LOCAL_AI_MISSING', 'settings'],
    ['LOCAL_AI_BROKEN', 'settings'],
    ['AI_KEY_REJECTED', 'settings'],
    ['AI_GEMINI_KEY_MISSING', 'settings'],
    ['AI_MODEL_MISSING', 'settings'],
    ['LOCAL_AI_TIMEOUT', 'shortenInput'],
    ['LOCAL_AI_TOO_LONG', 'shortenInput'],
    ['LOCAL_AI_START_FAILED', 'retry'],
  ])('%s の文 → %s', (code, want) => {
    expect(generateRecovery(row(code))).toBe(want);
  });

  it('場面数の上限で断った文は、入力を直すだけ（送り直すとまた超える）', () => {
    expect(generateRecovery(aiSceneLimitMessage(9))).toBe('editInput');
  });

  it('文が無い・知らない文は、もう一度試す', () => {
    expect(generateRecovery(null)).toBe('retry');
    expect(generateRecovery('通信に失敗しました。')).toBe('retry');
  });

  it('「アプリを入れ直して」と言う文は、どれも「もう一度試す」を主にしない', () => {
    const lines = table.split('\n').filter((l) => l.split('\t')[3]?.includes('入れ直して') && l.includes('動画案'));
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const l of lines) expect(generateRecovery(l.split('\t')[3])).not.toBe('retry');
  });
});
