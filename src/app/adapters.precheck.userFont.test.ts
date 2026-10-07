// 公開前チェックの「文字の形」3状態（ADR-0038・α-6 出口監査 🟡19 のレビュー）。
//
// ⚠️ **「そろっている」「見つからない」「調べられなかった」を分ける**＝
// 目録が読めないときに「全部見つからない」と言うのは嘘（案内の「取り込み直す」が同じ目録を通るので
// **必ず失敗する行き止まり**）、かといって黙ると**別の字体の動画を成功として出す**（§2-5）。
import { describe, expect, it } from 'vitest';
import { buildPrecheckItems } from './adapters';
import type { Scene } from '../domain/project/types';
import type { Template } from '../domain/template/types';

const scene = {
  sceneId: 'scene_001', partId: 'part_001', order: 1, sceneType: 'photo_intro',
  templateId: 'photo_left_text_right_yuko_v1', durationSec: 8, assetRefs: {},
  character: { enabled: false, characterId: 'yuko' }, texts: {},
  narration: { text: 'こんにちは', status: 'generated' }, warnings: [],
  fontId: 'user_font_001',
} as unknown as Scene;
const templates: Template[] = [];
const items = (fonts: Parameters<typeof buildPrecheckItems>[6]): ReturnType<typeof buildPrecheckItems> =>
  buildPrecheckItems([scene], [], templates, undefined, undefined, undefined, fonts);

const idsOf = (fonts: Parameters<typeof buildPrecheckItems>[6]): string[] => items(fonts).map((i) => i.id);

describe('公開前チェック：文字の形の3状態', () => {
  it('そろっていれば何も出さない', () => {
    expect(idsOf({ availableUserFontIds: ['user_font_001'] })).not.toContain('missingFont');
    expect(idsOf({ availableUserFontIds: ['user_font_001'] })).not.toContain('unknownFont');
  });

  it('見つからなければ止める', () => {
    expect(idsOf({ availableUserFontIds: [] })).toContain('missingFont');
  });

  /** ⚠️ 起動直後（まだ調べていない）は**止めない**＝待てば埋まるので、押せない理由にならない。 */
  it('まだ調べていないうちは止めない', () => {
    expect(idsOf({})).not.toContain('unknownFont');
    expect(idsOf({})).not.toContain('missingFont');
  });

  /** ⚠️ 目録が読めないときは**そう言って**止める（「見つからない」に倒さない＝嘘と行き止まりを作らない）。 */
  it('調べられなかったら、そう言って止める', () => {
    const list = items({ userFontsUnreadable: true });
    const item = list.find((i) => i.id === 'unknownFont');
    expect(item?.blocksExport).toBe(true);
    expect(item?.detail).toMatch(/調べられませんでした/);
    expect(list.map((i) => i.id)).not.toContain('missingFont'); // 嘘の「見つからない」を並べない
  });
});
