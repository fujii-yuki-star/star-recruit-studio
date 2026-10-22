// 書き出しの高速化（2026-10-22）で足した近道が、**前と同じ文字列を返す**ことを留める。
// ⚠️ 近道は「何も変えないときは、なめ直さずにそのまま返す」だけ＝結果が1文字でも変わると、書き出した動画が変わる。
import { describe, expect, it } from 'vitest';
import { dedupeDefs, escapeXml } from './sceneSvg';

/** 近道を足す前の実装（比べる相手）。 */
const escapeBefore = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const dedupeBefore = (svg: string): string => {
  const seen = new Set<string>();
  return svg.split('\n').filter((line) => {
    if (!line.startsWith('<defs>')) return true;
    if (seen.has(line)) return false;
    seen.add(line);
    return true;
  }).join('\n');
};

describe('escapeXml の近道', () => {
  it('置き換える字が無ければ同じ物・あれば前と同じ置き換え', () => {
    for (const s of ['', 'data:image/png;base64,iVBORw0KGgo+/=', 'あ&い', '<b>"x"</b>', "it's", 'a&amp;b', '&<>"\'']) {
      expect(escapeXml(s), s).toBe(escapeBefore(s));
    }
  });
});

describe('dedupeDefs の近道', () => {
  const cases = [
    '<svg>\n<g/>\n</svg>',
    '<defs><filter id="a"/></defs>\n<g/>\n<defs><filter id="a"/></defs>\n</svg>',
    '<defs><filter id="a"/></defs>\n<defs><filter id="b"/></defs>',
    '\n<defs>x</defs>\n<defs>x</defs>',
    '<defs>x</defs>',
    '<defs>x</defs>\n<defs>x</defs>',
    'a\n<defs>x</defs>\nb\n<defs>y</defs>\nc\n<defs>x</defs>',
    ' <defs>x</defs>\n <defs>x</defs>', // 行の頭でない＝落とさない
    '<defs>x</defs>\n\n<defs>x</defs>\n',
  ];
  it('前と同じ文字列を返す（重なりがある・無い・行の頭でない・空の行）', () => {
    for (const c of cases) expect(dedupeDefs(c), JSON.stringify(c)).toBe(dedupeBefore(c));
  });

  it('でたらめな行の並びでも前と同じ（200通り）', () => {
    let seed = 7;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    const pieces = ['<defs>a</defs>', '<defs>b</defs>', '<g/>', '', ' <defs>a</defs>', '<defs>a</defs> ', 'data:x'];
    for (let k = 0; k < 200; k += 1) {
      const svg = Array.from({ length: 1 + rnd(8) }, () => pieces[rnd(pieces.length)]).join('\n');
      expect(dedupeDefs(svg), JSON.stringify(svg)).toBe(dedupeBefore(svg));
    }
  });
});
