import { describe, expect, it, vi } from 'vitest';
import type { Template } from '../../domain/template/types';

// #547 P3-5：見本の既定尺は正典定数（SCENE_DEFAULT_DURATION_SEC）を参照する。
// 値が同じ（8）なので「8 と等しい」だけのテストは**リテラル直書きに戻しても通る恒真テスト**になる。
// そこで定数をセンチネル値にモックし、既定尺が**定数に追従する**ことで参照を証明する。
vi.mock('../../domain/constants', async (orig) => ({
  ...(await orig<typeof import('../../domain/constants')>()),
  SCENE_DEFAULT_DURATION_SEC: 42,
}));

import { buildSampleScene } from './looksShared';

const tmpl = (defaults?: Template['defaults']): Template => ({
  schemaVersion: '1.0', templateId: 't1', name: 'T', category: 'opening', aspectRatio: '16:9',
  canvas: { width: 1920, height: 1080 }, layers: [], ...(defaults ? { defaults } : {}),
});

describe('buildSampleScene の既定尺（#547 P3-5）', () => {
  it('テンプレに既定尺が無ければ正典定数を使う（リテラル 8 の直書きでない）', () => {
    expect(buildSampleScene(tmpl(), []).durationSec).toBe(42); // モックした定数に追従
  });

  it('テンプレの既定尺があればそちらを優先する（従来どおり）', () => {
    expect(buildSampleScene(tmpl({ durationSec: 12 }), []).durationSec).toBe(12);
  });
});
