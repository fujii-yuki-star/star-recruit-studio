// エンジンの辞書の読み取り（ADR-0037・#350）。同期そのものの規則は domain（`readingDict.test.ts`）。
import { describe, expect, it } from 'vitest';
import { parseEngineDict } from './userDict';

describe('parseEngineDict：GET /user_dict の本文', () => {
  /** ⚠️ 同梱 ENGINE v0.25.2 で実測した形（uuid → 語 の object・`pronunciation`/`accent_type`）。 */
  it('uuid をキーにした object を読む', () => {
    const text = JSON.stringify({
      'u-1': { surface: '宇都宮', pronunciation: 'ウツノミヤ', accent_type: 4, priority: 5 },
    });
    expect(parseEngineDict(text)).toEqual([{ uuid: 'u-1', surface: '宇都宮', yomi: 'ウツノミヤ', accentType: 4 }]);
  });

  /**
   * ⚠️ **他アプリが入れた語も数える**＝数えないと「同じ言葉が既にある」を見落として
   * 二重登録になる（実測＝同じ言葉の `POST` は重複を作る）。
   */
  it('アプリが入れていない語も返す（二重登録を避けるため）', () => {
    const text = JSON.stringify({ よそ: { surface: 'ずんだ', pronunciation: 'ズンダ', accent_type: 1 } });
    expect(parseEngineDict(text)).toHaveLength(1);
  });

  it('形が違う語は落とす（生のまま内部へ流さない）', () => {
    const text = JSON.stringify({ a: { surface: 'あ' }, b: { pronunciation: 'イ' }, c: 3, d: null });
    expect(parseEngineDict(text)).toEqual([]);
  });

  it('下がる場所が無い・数でないときは 0（平板）', () => {
    const text = JSON.stringify({ a: { surface: 'あ', pronunciation: 'ア' }, b: { surface: 'い', pronunciation: 'イ', accent_type: '2' } });
    expect(parseEngineDict(text).map((w) => w.accentType)).toEqual([0, 0]);
  });

  it('object でない本文は空', () => {
    expect(parseEngineDict('[]')).toEqual([]);
    expect(parseEngineDict('null')).toEqual([]);
  });
});
