// 素材の「AI解析」の書き手（#1317）＝コードの値の並びと schema の enum が同じか（片方だけ増やしても赤くなる）。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AI_DESCRIPTION_AUTHOR, AI_DESCRIPTION_AUTHORS } from '../domain/enums';

const schema = JSON.parse(readFileSync(join(__dirname, '..', '..', 'docs', 'yuko_recruit_docs', 'schemas', 'project.schema.json'), 'utf8'));

describe('aiDescriptionAuthor の値（コード＝schema）', () => {
  it('schema の enum とコードの並びが同じ', () => {
    expect([...AI_DESCRIPTION_AUTHORS].sort()).toEqual([...schema.$defs.Asset.properties.aiDescriptionAuthor.enum].sort());
  });
  it('参照用の定数がすべての値を持つ', () => {
    expect(Object.values(AI_DESCRIPTION_AUTHOR).sort()).toEqual([...AI_DESCRIPTION_AUTHORS].sort());
  });
});
