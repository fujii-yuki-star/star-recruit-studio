// 読み方辞書の保存の形（ADR-0037 決定3b・決定8）。
import { describe, expect, it } from 'vitest';
import {
  emptyReadingDict,
  parseReadingDict,
  readingDictExportJson,
  readingDictImportEntries,
  withLinks,
} from './readingDictFs';

describe('parseReadingDict：生のまま内部へ流さない（§2-2）', () => {
  it('語と控えを読む', () => {
    const r = parseReadingDict(JSON.stringify({ version: 1, entries: [{ surface: 'あ', yomi: 'ア', accentType: 2 }], links: { あ: 'u1' } }));
    expect(r.entries).toEqual([{ surface: 'あ', yomi: 'ア', accentType: 2 }]);
    expect(r.links).toEqual({ あ: 'u1' });
  });

  /** ⚠️ 1語のせいで辞書を全部失わない。 */
  it('壊れた語はその語だけ落とす', () => {
    const r = parseReadingDict(JSON.stringify({ entries: [{ surface: 'あ', yomi: 'ア' }, { surface: '', yomi: 'イ' }, { yomi: 'ウ' }, 3] }));
    expect(r.entries).toEqual([{ surface: 'あ', yomi: 'ア', accentType: 0 }]);
  });

  it('下がる場所が数でない・負なら 0（平板）にする', () => {
    const r = parseReadingDict(JSON.stringify({ entries: [{ surface: 'あ', yomi: 'ア', accentType: -1 }, { surface: 'い', yomi: 'イ', accentType: '2' }] }));
    expect(r.entries.map((e) => e.accentType)).toEqual([0, 0]);
  });

  it('object でない本文は空として扱う', () => {
    expect(parseReadingDict('[]').entries).toEqual([]);
    expect(parseReadingDict('3')).toEqual(emptyReadingDict());
  });

  it('控えの値が文字列でなければ落とす', () => {
    expect(parseReadingDict(JSON.stringify({ links: { あ: 1, い: '', う: 'u3' } })).links).toEqual({ う: 'u3' });
  });
});

/**
 * ⚠️ **決定3b＝書き出しに `word_uuid` を含めない**。含めると移行先で全語が `422` になり、
 * 決定7（反映できなければ声を作らない）と噛み合って**声が作れなくなる**。
 * 語の入れ物に uuid を持たせない形にしてあるので、ここは「控えの入れ物ごと書かない」ことを固定する。
 */
describe('書き出し・読み込み（決定8）', () => {
  it('書き出しは語だけ＝控えを含めない', () => {
    const json = readingDictExportJson([{ surface: 'あ', yomi: 'ア', accentType: 1 }]);
    expect(JSON.parse(json)).toEqual({ version: 1, entries: [{ surface: 'あ', yomi: 'ア', accentType: 1 }] });
    expect(json).not.toContain('links');
  });

  it('読み込みは控えを持ち込まない（渡した先では通用しない）', () => {
    const entries = readingDictImportEntries(JSON.stringify({ entries: [{ surface: 'あ', yomi: 'ア', accentType: 1 }], links: { あ: 'よそのuuid' } }));
    expect(entries).toEqual([{ surface: 'あ', yomi: 'ア', accentType: 1 }]);
  });
});

describe('withLinks', () => {
  it('控えだけ差し替える（語は触らない）', () => {
    const d = { version: 1, entries: [{ surface: 'あ', yomi: 'ア', accentType: 0 }], links: { あ: '古い' } };
    expect(withLinks(d, { あ: '新しい' })).toEqual({ ...d, links: { あ: '新しい' } });
  });
});
