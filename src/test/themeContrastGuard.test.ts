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

/** 色の値（`#rrggbb`）。グラデーションは**含まれる色すべて**を返す＝比べるときは全部の組の最小を取る
 *  （色の並べ順で「不利な側」が変わっても見落とさない・PR #1327 レビュー 🟡）。 */
function colorsOf(tokens: Map<string, string>, name: string): string[] {
  const v = tokens.get(name);
  if (!v) throw new Error(`${name} が無い`);
  const hexes = v.match(/#[0-9a-fA-F]{6}\b/g);
  if (!hexes) throw new Error(`${name} は #rrggbb で書く（${v}）`);
  return hexes;
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

/** 文字と背景のすべての色の組のうち、いちばん低いコントラスト比。 */
function worstContrast(tokens: Map<string, string>, fg: string, bg: string): number {
  return Math.min(...colorsOf(tokens, fg).flatMap((a) => colorsOf(tokens, bg).map((b) => contrast(a, b))));
}

/** 文字の色・背景の色・下限。下限は WCAG の本文の 4.5:1。 */
const PAIRS: [fg: string, bg: string, min: number][] = [
  ["--color-text", "--color-surface", 4.5],
  ["--color-text-muted", "--color-surface", 4.5],
  ["--color-text-muted", "--color-bg", 4.5],
  ["--color-text-muted", "--color-surface-alt", 4.5],
  // 薄い文字の下限は 4.0（案内文＝12px にも使う＝**以前の 2.6:1 には戻さない**）。⚠️ 明るい見た目では補助文字
  // （muted）とほぼ同じ濃さになった（約 1.1:1）＝区別は濃さではなく大きさ・置き場所で付く（ADR-0039 追補）。
  // 置かれる背景は面・地・淡い面・選択の淡い色（.badge・選択行）＝実際に載る背景をすべて見る（PR #1327 レビュー 🟡）。
  ["--color-text-faint", "--color-surface", 4.0],
  ["--color-text-faint", "--color-bg", 4.0],
  ["--color-text-faint", "--color-surface-alt", 4.0],
  ["--color-text-faint", "--color-primary-soft", 4.0],
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
      expect(worstContrast(tokens, fg, bg)).toBeGreaterThanOrEqual(min);
    });
  }

  it("グラデーションは途中の色まで見て、いちばん読めない組で判定する（並べ順に頼らない）", () => {
    // 今のトークンは端の色がたまたま不利な側なので、実物だけでは「端しか見ない」退行を捕まえられない＝作った値で叩く。
    const t = new Map([["--fg", "#000000"], ["--bg", "linear-gradient(135deg, #ffffff, #101010, #fefefe)"]]);
    expect(worstContrast(t, "--fg", "--bg")).toBeLessThan(1.5);
  });

  it("トークンを読めている（規則の途中で切れて空振りしない）", () => {
    // ⚠️ 規則の切り出しは「改行＋}」で終わる＝入れ子を足すと途中で切れて数が減る。変わったら赤にする（実数で留める＝増やしたときは数を直し、走査が欠けていないか見る）。
    expect(light.size).toBe(48);
    expect(tokensOf(':root[data-theme="dark"]').size).toBe(37);
  });

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
    // 右クリックのメニューの危険な項目（削除など）の小さい文字も直したので戻さない（PR #1327 レビュー 🟡）。
    const menu = readFileSync(join(process.cwd(), "src", "app", "components", "ContextMenu.tsx"), "utf8");
    expect(menu).toContain('"var(--color-danger-text)"');
    expect(menu).not.toContain('"var(--color-danger)"');
    for (const k of ["photo", "video", "audio"]) {
      expect(rule(`.thumb-${k}`)).toContain(`var(--thumb-${k}-fg)`);
      expect(rule(`.thumb-${k}`)).toContain(`var(--thumb-${k}-bg)`);
    }
  });
});
