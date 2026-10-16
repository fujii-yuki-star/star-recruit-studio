// 書き出しで焼く SVG に、使う字だけを残した字体を埋め込む（ADR-0062）。
//
// ⚠️ **`<img>` に読ませた SVG は文書の字体を使えない**＝仕上がり確認（文書の中の SVG）は選んだ字体で出るのに、
//   書き出し（SVG を `<img>` で Canvas に焼く・ADR-0004）は Windows に無い字体をすべて既定へ倒していた。
//   字体の中身を SVG の中に `@font-face`（data URL）で書けば、`<img>` の中でも使える。
// ⚠️ **丸ごとは入れない**＝1コマあたり 0.13〜0.43 秒かかる。使う字の形だけを残す（`subsetFontKeepingTables`）。
// ⚠️ **作った字体は覚えておく**＝毎コマ作り直さない。新しい字が出てきたときだけ、それまでの字と合わせて作り直す。
import { BUNDLED_FONT_FILES, isExternalFontId } from '../../domain/font/fontCatalog';
import { subsetFontKeepingTables } from '../../domain/font/fontSubset';

/** SVG の中の、字体（と太さ）ごとの使う字。 */
export interface FontUse {
  /** CSS の家族名（`font-family` の先頭）。 */
  family: string;
  bold: boolean;
  codepoints: Set<number>;
}

function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#([0-9]+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** `font-family` の値の先頭の家族名（引用符を外す）。 */
function firstFamily(value: string): string {
  const first = decodeXml(value).split(',')[0]?.trim() ?? '';
  return first.replace(/^['"]|['"]$/g, '');
}

function isBold(weight: string | undefined): boolean {
  if (!weight) return false;
  if (weight === 'bold' || weight === 'bolder') return true;
  const n = Number(weight);
  return Number.isFinite(n) && n >= 600;
}

/** SVG の `<text>` から、字体と太さごとの使う字を集める（純粋）。 */
export function collectFontUses(svg: string): FontUse[] {
  const uses = new Map<string, FontUse>();
  for (const m of svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const attrs = m[1] ?? '';
    const familyAttr = /\bfont-family="([^"]*)"/.exec(attrs)?.[1];
    if (!familyAttr) continue;
    const family = firstFamily(familyAttr);
    if (!family) continue;
    const bold = isBold(/\bfont-weight="([^"]*)"/.exec(attrs)?.[1]);
    const text = decodeXml((m[2] ?? '').replace(/<[^>]*>/g, ''));
    const key = `${family}\u0000${bold ? 'b' : 'r'}`;
    const use = uses.get(key) ?? { family, bold, codepoints: new Set<number>() };
    for (const ch of text) use.codepoints.add(ch.codePointAt(0)!);
    uses.set(key, use);
  }
  return [...uses.values()];
}

/** 字体の実体の在りか。同梱は `public/fonts/` のファイル、持ち込み・パックは文字の形の id。 */
export type FontSource = { kind: 'bundled'; file: string } | { kind: 'external'; fontId: string };

/** 家族名と太さ → 実体の在りか。知らない家族名（Windows の字体など）は null（埋め込まない）。 */
export function fontSourceFor(family: string, bold: boolean): FontSource | null {
  const bundled = BUNDLED_FONT_FILES[family];
  if (bundled) return { kind: 'bundled', file: bold ? bundled.bold : bundled.regular };
  // 持ち込み・パックは家族名が id そのもの（`userFontCssFamily`）＝太字も同じ実体（`ensureUserFontLoaded` と同じ）。
  if (isExternalFontId(family)) return { kind: 'external', fontId: family };
  return null;
}

function sourceKey(s: FontSource): string {
  return s.kind === 'bundled' ? `bundled:${s.file}` : `external:${s.fontId}`;
}

/** 字体の実体を読む口（書き出しでは `defaultFontBytesLoader`・検査では差し替える）。 */
export type FontBytesLoader = (source: FontSource) => Promise<Uint8Array>;

function toBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

interface Embedded {
  codepoints: Set<number>;
  dataUrl: string;
}

/**
 * 書き出しの間、字体の実体と作った字体を覚えておく入れ物。
 * ⚠️ **書き出し1回ぶんで使い捨てにしない**理由は無いが、字体が入れ替わる（パックを入れ直す）ことはあるので、
 *   呼ぶ側が書き出しの始めに作り直せるよう、入れ物として持つ。
 */
export class FontEmbedder {
  private readonly bytes = new Map<string, Promise<Uint8Array>>();
  private readonly embedded = new Map<string, Embedded>();

  constructor(private readonly load: FontBytesLoader) {}

  private async dataUrlFor(source: FontSource, codepoints: Set<number>): Promise<string> {
    const key = sourceKey(source);
    const prev = this.embedded.get(key);
    if (prev && [...codepoints].every((c) => prev.codepoints.has(c))) return prev.dataUrl;
    const union = new Set<number>([...(prev?.codepoints ?? []), ...codepoints]);
    let p = this.bytes.get(key);
    if (!p) {
      p = this.load(source);
      this.bytes.set(key, p);
    }
    const full = await p;
    // glyf を持たない字体（CFF の OTF など）は丸ごと埋め込む＝遅いが正しい（ADR-0062 決定4）。
    const subset = subsetFontKeepingTables(full, union) ?? full;
    const dataUrl = `data:font/ttf;base64,${toBase64(subset)}`;
    this.embedded.set(key, { codepoints: union, dataUrl });
    return dataUrl;
  }

  /** SVG に `@font-face` を書き込んで返す。埋め込む字体が無ければそのまま。 */
  async embed(svg: string): Promise<string> {
    // 実体ごとにまとめる（1ファイルの字体を普通と太字の両方で使っても、規則は1つ）。
    const groups = new Map<string, { source: FontSource; family: string; weight: string; codepoints: Set<number> }>();
    for (const use of collectFontUses(svg)) {
      const source = fontSourceFor(use.family, use.bold);
      if (!source) continue;
      const files = BUNDLED_FONT_FILES[use.family];
      // 同梱の Gen Interface は太さごとに別の実体＝太さを指定。1ファイルの字体は全部の太さをこれで賄う。
      const separateBold = source.kind === 'bundled' && files != null && files.regular !== files.bold;
      const weight = separateBold ? (use.bold ? '700' : '400') : '100 900';
      const key = sourceKey(source);
      const g = groups.get(key) ?? { source, family: use.family, weight, codepoints: new Set<number>() };
      for (const c of use.codepoints) g.codepoints.add(c);
      groups.set(key, g);
    }
    const rules: string[] = [];
    for (const g of groups.values()) {
      const url = await this.dataUrlFor(g.source, g.codepoints);
      rules.push(`@font-face{font-family:"${g.family}";src:url(${url});font-weight:${g.weight}}`);
    }
    if (rules.length === 0) return svg;
    const open = /<svg\b[^>]*>/.exec(svg);
    if (!open) return svg;
    const at = open.index + open[0].length;
    return `${svg.slice(0, at)}<defs><style>${rules.join('')}</style></defs>${svg.slice(at)}`;
  }
}
