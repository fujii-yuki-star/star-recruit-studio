// 動画案づくりの失敗で、ボタンが文の名指しする行き先に従う（UI/UX 監査 2026-10-02・§2-5）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { aiSceneLimitMessage } from '../project/sceneLimit';
import { generateRecovery, INPUT_MARK, isLocalAiUnavailableMessage, SETTINGS_MARK } from './generateRecovery';

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

  // ⚠️ **表の動画案づくりの断りを全部、行き先を決めて固定する**（PR3 レビュー 🟡）＝新しい断りを足したら
  //   ここで赤くなり、行き先を決めることになる（目印を持たない文が黙って「もう一度試す」へ落ちない）。
  const EXPECTED: Record<string, string> = {
    AI_RESPONSE_INVALID: 'retry',
    AI_SCENE_LIMIT_EXCEEDED: 'editInput',
    AI_RESPONSE_UNREADABLE: 'retry',
    AI_GENERATE_FAILED: 'retry',
    AI_BUSY: 'retry',
    AI_OVERUSED: 'retry',
    AI_MODEL_MISSING: 'settings',
    AI_KEY_REJECTED: 'settings',
    AI_REJECTED: 'shortenInput',
    AI_REQUEST_FAILED: 'retry',
    AI_CANCELLED: 'retry',
    LOCAL_AI_MISSING: 'settings',
    LOCAL_AI_BROKEN: 'settings',
    LOCAL_AI_START_FAILED: 'retry',
    LOCAL_AI_TIMEOUT: 'shortenInput',
    LOCAL_AI_TOO_LONG: 'shortenInput',
    AI_GEMINI_KEY_MISSING: 'settings',
    AI_PROVIDER_UNSUPPORTED: 'settings',
  };
  const generationCodes = table.split('\n')
    .map((l) => l.split('\t')[0].match(/^`((?:LOCAL_)?AI_\w+)`$/)?.[1])
    .filter((c): c is string => !!c && !c.startsWith('AI_ASSIST_'));

  it('表の動画案づくりの断りは、どれも行き先が決まっている', () => {
    expect(generationCodes.length).toBe(18);
    expect([...generationCodes].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(Object.entries(EXPECTED))('表の %s の文 → %s', (code, want) => {
    // 場面数の上限は文に数が入る（表は「 N 」で書いている）＝実際に作る関数の文で叩く。
    const message = code === 'AI_SCENE_LIMIT_EXCEEDED' ? aiSceneLimitMessage(81) : row(code);
    expect(generateRecovery(message)).toBe(want);
  });

  it('設定と入力の両方に触れる文は、設定が先（接続できなければ入力を直しても作れない）', () => {
    expect(generateRecovery(`${SETTINGS_MARK}を確かめるか、${INPUT_MARK}を短くしてください。`)).toBe('settings');
  });

  it('手伝いで「入れ直して」と言い切るのは、同梱の AI の部品が無い・壊れているときだけ', () => {
    expect(isLocalAiUnavailableMessage(row('LOCAL_AI_MISSING'))).toBe(true);
    expect(isLocalAiUnavailableMessage(row('LOCAL_AI_BROKEN'))).toBe(true);
    // 設定を名指ししても、入れ直しでは直らない文（接続キー・モデル名・時間切れ・起動できない）では言わない。
    for (const code of ['AI_KEY_REJECTED', 'AI_MODEL_MISSING', 'AI_PROVIDER_UNSUPPORTED', 'LOCAL_AI_TIMEOUT', 'LOCAL_AI_START_FAILED']) {
      expect(isLocalAiUnavailableMessage(row(code)), code).toBe(false);
    }
    expect(isLocalAiUnavailableMessage(null)).toBe(false);
  });

  it('「アプリを入れ直して」と言う文は、どれも「もう一度試す」を主にしない', () => {
    const lines = table.split('\n').filter((l) => l.split('\t')[3]?.includes('入れ直して') && l.includes('動画案'));
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const l of lines) expect(generateRecovery(l.split('\t')[3])).not.toBe('retry');
  });
});
