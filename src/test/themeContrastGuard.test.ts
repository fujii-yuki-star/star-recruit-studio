// 見た目の色の組み合わせが読める濃さを保つこと（UI/UX 監査 2026-10-02）。
//
// ⚠️ **直す前は、明るい見た目でも暗い見た目でも読めない組み合わせがあった**＝主ボタンの白い文字（3.2:1／暗い見た目 2.3:1）・
// 案内文の薄い文字（2.6:1・約130か所）・お知らせの青い文字（暗い見た目 2.6:1）・音のサムネイル（暗い見た目 1.4:1）。
// どれも **トークンを1つ動かすと全部に効く**ので、トークンの組で見張る（画面ごとに見張ると、直し漏れた1か所を見つけられない）。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src", "styles", "theme.css"), "utf8");

/** `selector {` から対応する `}` までのトークン（`--name: value;`）。 */
function tokensOf(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`${selector} が見つからない`);
  const end = css.indexOf("\n}", start);
  const body = css.slice(start, end);
  const out = new Map<string, string>();
  for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out.set(m[1], m[2].trim());
  return out;
}

const light = tokensOf(":root");
const dark = new Map([...light, ...tokensOf(':root[data-theme="dark"]')]);

/** 色の値（`#rrggbb`）。グラデーションは最も濃い側＝**文字と比べて不利な側**（最後の色）を取る。 */
function colorOf(tokens: Map<string, string>, name: string): string {
  const v = tokens.get(name);
  if (!v) throw new Error(`${name} が無い`);
  const hexes = v.match(/#[0-9a-fA-F]{6}\b/g);
  if (!hexes) throw new Error(`${name} は #rrggbb で書く（${v}）`);
  return hexes[hexes.length - 1];
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** 文字の色・背景の色・下限。下限は WCAG の本文の 4.5:1。 */
const PAIRS: [fg: string, bg: string, min: number][] = [
  ["--color-text", "--color-surface", 4.5],
  ["--color-text-muted", "--color-surface", 4.5],
  ["--color-text-muted", "--color-bg", 4.5],
  // 薄い文字は「本文より一段控えめ」が役目＝4.5 まで上げると補助文字と区別が無くなる。
  // 案内文（12px）にも使われているので、**以前の 2.6:1 には戻さない**下限として 4.0 を置く。
  ["--color-text-faint", "--color-surface", 4.0],
  ["--color-text-faint", "--color-bg", 4.0],
  ["--color-on-primary", "--color-primary-strong", 4.5],
  ["--color-on-primary", "--color-primary-strong-hover", 4.5],
  ["--color-primary-strong", "--color-primary-soft", 4.5],
  ["--color-info", "--color-accent-soft", 4.5],
  ["--color-warn", "--color-yellow", 4.5],
  ["--color-danger-text", "--color-surface", 4.5],
  ["--color-danger-text", "--color-danger-soft", 4.5],
  ["--color-success-text", "--color-success-soft", 4.5],
  ["--thumb-photo-fg", "--thumb-photo-bg", 4.5],
  ["--thumb-video-fg", "--thumb-video-bg", 4.5],
  ["--thumb-audio-fg", "--thumb-audio-bg", 4.5],
];

describe("見た目の色の組み合わせは読める濃さ（UI/UX 監査 2026-10-02）", () => {
  for (const [theme, tokens] of [["明るい見た目", light], ["暗い見た目", dark]] as const) {
    it.each(PAIRS)(`${theme}：%s を %s の上に置いて %s:1 以上`, (fg, bg, min) => {
      expect(contrast(colorOf(tokens, fg), colorOf(tokens, bg))).toBeGreaterThanOrEqual(min);
    });
  }

  it("組み合わせに使うトークンは、暗い見た目でも上書きされている（明るい色のまま暗い画面に出ない）", () => {
    const darkOwn = tokensOf(':root[data-theme="dark"]');
    const names = new Set(PAIRS.flatMap(([fg, bg]) => [fg, bg]));
    const missing = [...names].filter((n) => !darkOwn.has(n));
    expect(missing).toEqual([]);
  });

  it("主ボタン・お知らせ・サムネイルは、このトークンを使っている（直書きに戻さない）", () => {
    const rule = (sel: string): string => {
      const i = css.indexOf(`${sel} {`);
      return css.slice(i, css.indexOf("}", i));
    };
    expect(rule(".btn-primary")).toContain("var(--color-on-primary)");
    expect(rule(".btn-primary")).toContain("var(--color-primary-strong)");
    expect(rule(".notice-info")).toContain("var(--color-info)");
    for (const k of ["photo", "video", "audio"]) {
      expect(rule(`.thumb-${k}`)).toContain(`var(--thumb-${k}-fg)`);
      expect(rule(`.thumb-${k}`)).toContain(`var(--thumb-${k}-bg)`);
    }
  });
});
