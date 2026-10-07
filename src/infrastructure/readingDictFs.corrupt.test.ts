// 壊れた読み方辞書は**断る**（α-6 出口監査 🟡19 のレビュー・目録と同じ流儀）。
//
// ⚠️ **空として返すと丸ごと消える**＝画面が「1つも登録していない」を見せ、次の保存がその空で
// ファイルを上書きするので、登録した読みが全部消える（取り戻せない）。断れば書き込みが走らない。
import { describe, expect, it } from 'vitest';
import { parseReadingDict, parseReadingDictWithDrops } from './readingDictFs';

describe('読み方辞書の読み込み', () => {
  /** ⚠️ **語が1件壊れているだけなら落とすのは1件**＝丸ごと捨てない（数を返して知らせる）。 */
  it('壊れた語だけ落として数を返す', () => {
    const text = JSON.stringify({
      version: 1,
      entries: [
        { surface: '宇都宮', yomi: 'ウツノミヤ', accentType: 4 },
        { surface: '', yomi: 'ダメ', accentType: 0 },
        { surface: '京都', yomi: 'きょうと', accentType: 0 },
      ],
      links: { 宇都宮: 'u1' },
    });
    const r = parseReadingDictWithDrops(text);
    expect(r.file.entries.map((e) => e.surface)).toEqual(['宇都宮']);
    expect(r.dropped).toBe(2);
    expect(r.file.links).toEqual({ 宇都宮: 'u1' });
  });

  /** ⚠️ **JSON ですら無いときは投げる**＝呼ぶ側が「空だった」と扱って上書きしないため。 */
  it('JSON ですら無いときは投げる（空として返さない）', () => {
    expect(() => parseReadingDict('こわれた')).toThrow();
  });

  /**
   * ⚠️ **空のファイルは通す**（差分再監査 2巡目・目録と同じ扱い）＝書き込みが途中で止まると
   * 0 バイトで残る。断ると開き直しても直らないうえ、決定7 と噛み合って**すべての声作成が止まる**。
   */
  it('空のファイルは「まだ何も無い」として通す', () => {
    for (const text of ['', '   ', '\n']) {
      expect(parseReadingDict(text).entries).toEqual([]);
    }
  });
});
