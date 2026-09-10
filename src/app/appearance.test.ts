// @vitest-environment jsdom
// 画面の見た目（明るい／暗い）の門番（ADR-0039・#1108）。
//
// ⚠️ **いちばん守りたいのは ADR-0001**＝暗くするのはアプリの外枠だけで、
// **利用者が作っている動画の色は1ピクセルも変わってはいけない**。
//
// ⚠️ **片側だけ定義した色は、その色だけ明るいまま残る**＝暗い版に足し忘れると、
// 画面のどこか1か所だけが白く光る。**目で気づくまで誰も分からない**ので機械で見る。
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prefersDark, resolveAppearance } from "./hooks/useAppearance";
import { APPEARANCE_DEFAULT, getAppearance, setAppearance } from "../infrastructure/appSettings";
import { APPEARANCE_CHOICES } from "./screens/SettingsScreen";

const css = readFileSync(join(process.cwd(), "src/styles/theme.css"), "utf8");

/** 規則の中身（`{` から最初の `}` まで）。無ければ `null`（消えたときに空で通さない）。 */
export function ruleBody(source: string, selector: string): string | null {
  const head = `${selector} {`;
  const at = source.indexOf(head);
  if (at < 0) return null;
  const end = source.indexOf("}", at);
  return end < 0 ? null : source.slice(at + head.length, end);
}

/** その規則が**宣言している**変数の名前（`var()` で使っているだけのものは含めない）。 */
export function declaredVars(body: string): string[] {
  return [...body.matchAll(/(?:^|;|\n)\s*(--[\w-]+)\s*:/g)].map((m) => m[1]);
}

/**
 * 見た目で切り替わるべき色の変数か。
 *
 * ⚠️ **形（角丸・余白）は切り替えない**＝明るくても暗くても同じ寸法。
 * 影は**切り替える**（明るい版の薄い青みは暗い面では消える）。
 */
export function switchesWithAppearance(name: string): boolean {
  return name.startsWith("--color-") || name.startsWith("--shadow");
}

describe("暗い見た目のトークン（ADR-0039）", () => {
  const light = ruleBody(css, ":root");
  const dark = ruleBody(css, ':root[data-theme="dark"]');

  it("明るい版・暗い版のどちらの規則もある", () => {
    expect(light).not.toBeNull();
    expect(dark).not.toBeNull();
  });

  it("色と影は**両方に**定義されている（片側だけ残ると、そこだけ光る）", () => {
    const need = declaredVars(light ?? "").filter(switchesWithAppearance).sort();
    const have = declaredVars(dark ?? "").filter(switchesWithAppearance).sort();
    expect(need.length).toBeGreaterThan(20); // 数えている対象が消えたら気づく
    expect(have).toEqual(need);
  });

  it("暗い版は、明るい版に無い名前を作らない（綴り違いを見つける）", () => {
    const lightNames = new Set(declaredVars(light ?? ""));
    const stray = declaredVars(dark ?? "").filter((n) => !lightNames.has(n));
    expect(stray).toEqual([]);
  });

  it("素の部品にも見た目を伝える（`color-scheme`）", () => {
    // ⚠️ これが無いと、スクロールバーや素の `<input>` の内側だけ明るいまま残る。
    expect(light).toContain("color-scheme: light");
    expect(dark).toContain("color-scheme: dark");
  });

  it("本文に純黒・純白を使わない（動機が「目がつらい」）", () => {
    // ⚠️ 最大コントラストは目的に反する（ADR-0039 決定5）。
    const values = (dark ?? "").match(/#[0-9a-fA-F]{6}/g) ?? [];
    expect(values.length).toBeGreaterThan(10);
    expect(values.map((v) => v.toLowerCase())).not.toContain("#000000");
    expect(values.map((v) => v.toLowerCase())).not.toContain("#ffffff");
  });
});

describe("動画の絵は見た目で変わらない（ADR-0001）", () => {
  it("描画の層は、テーマの色を1つも参照しない", () => {
    // ⚠️ **ここが破れるとプレビューと書き出しが食い違う**＝画面の設定で焼かれる画素が変わる。
    // `src/renderer/**`（プレビュー・書き出し）と `src/domain/**`（描画の計算）が対象。
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!/\.tsx?$/.test(e.name) || e.name.includes(".test.")) continue;
        const src = readFileSync(p, "utf8");
        if (src.includes("var(--color")) hits.push(p);
      }
    };
    walk(join(process.cwd(), "src/renderer"));
    walk(join(process.cwd(), "src/domain"));
    expect(hits).toEqual([]);
  });

  it("色を選ぶ見本は、素の色のまま（テーマで動かさない）", () => {
    // ⚠️ 利用者が動画に使う色。テーマに紐づけると、**暗くしただけで動画の色が変わる**。
    const picker = readFileSync(join(process.cwd(), "src/app/components/ColorPicker.tsx"), "utf8");
    const preset = /const PRESET_COLORS = \[([^\]]+)\]/.exec(picker)?.[1] ?? "";
    expect(preset).not.toBe("");
    expect(preset).not.toContain("var(");
  });
});

describe("画面に出す言い方（§2-3）", () => {
  it("3択の言い方と並びを留める（技術用語を出さない）", () => {
    // ⚠️ **「OS」と書かない**（レビュー 🟡）＝利用者は人事・非エンジニア。技術寄りの略語を画面に出さない。
    // ⚠️ **並びも留める**＝既定を先頭に置く（いま何が効いているのかが並びの先頭で分かる）。
    expect(APPEARANCE_CHOICES).toEqual([
      ["system", "パソコンの設定に合わせる"],
      ["light", "明るい"],
      ["dark", "暗い"],
    ]);
    // 先頭が既定であること（並びと既定がばらばらにならない）。
    expect(APPEARANCE_CHOICES[0][0]).toBe(APPEARANCE_DEFAULT);
  });

  it("`テーマ` `ダークモード` `ライト/ダーク` を画面に出さない", () => {
    const shown = APPEARANCE_CHOICES.map(([, l]) => l).join(" ");
    for (const banned of ["テーマ", "ダークモード", "ライト", "ダーク", "OS"]) {
      expect(shown).not.toContain(banned);
    }
  });
});

describe("好みの解き方（純粋関数）", () => {
  it("選んだ見た目はそのまま当たる（OS に関わらず）", () => {
    expect(resolveAppearance("light", true)).toBe("light");
    expect(resolveAppearance("dark", false)).toBe("dark");
  });

  it("「パソコンの設定に合わせる」だけがパソコン側を見る", () => {
    expect(resolveAppearance("system", true)).toBe("dark");
    expect(resolveAppearance("system", false)).toBe("light");
  });
});

describe("見た目の覚え", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("覚えが無ければ既定（いまは「パソコンの設定に合わせる」）", () => {
    expect(getAppearance()).toBe(APPEARANCE_DEFAULT);
    expect(APPEARANCE_DEFAULT).toBe("system");
  });

  it("選んだ見た目を覚える", () => {
    setAppearance("dark");
    expect(getAppearance()).toBe("dark");
  });

  it("知らない中身は既定へ倒す（起動できない状態を作らない）", () => {
    localStorage.setItem("app.appearance", "ダーク");
    expect(getAppearance()).toBe(APPEARANCE_DEFAULT);
  });

  it("読めないときも既定（プライベートモード等で落ちない）", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("読めない"); });
    expect(getAppearance()).toBe(APPEARANCE_DEFAULT);
  });

  it("OS に聞く口が無い場でも落ちない（明るい側へ倒す）", () => {
    // ⚠️ **古い WebView では `matchMedia` が無いことがある**＝聞けないなら明るい側へ倒す。
    // 口そのものを外して確かめる（jsdom は持っているので、消さないとこの経路を通らない）。
    const original = Object.getOwnPropertyDescriptor(window, "matchMedia");
    delete (window as { matchMedia?: unknown }).matchMedia;
    try {
      expect(prefersDark()).toBe(false);
    } finally {
      if (original) Object.defineProperty(window, "matchMedia", original);
    }
  });

  it("OS に聞いて例外が出ても落ちない（明るい側へ倒す）", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => { throw new Error("聞けない"); },
    });
    try {
      expect(prefersDark()).toBe(false);
    } finally {
      delete (window as { matchMedia?: unknown }).matchMedia;
    }
  });

  it("OS が暗いと言えば、暗いと解く", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (q: string) => ({ matches: q.includes("dark"), media: q }),
    });
    try {
      expect(prefersDark()).toBe(true);
      expect(resolveAppearance("system", prefersDark())).toBe("dark");
    } finally {
      delete (window as { matchMedia?: unknown }).matchMedia;
    }
  });
});

describe("門番自身の検査（わざと壊した入力）", () => {
  it("規則が無ければ null", () => {
    expect(ruleBody(".other { a: 1px; }", ":root")).toBeNull();
  });

  it("宣言だけを拾う（`var()` で使っているだけは数えない）", () => {
    expect(declaredVars("\n  --a: 1px;\n  b: var(--c);\n")).toEqual(["--a"]);
  });

  it("切り替える色と、切り替えない寸法を見分ける", () => {
    expect(switchesWithAppearance("--color-bg")).toBe(true);
    expect(switchesWithAppearance("--shadow-sm")).toBe(true);
    expect(switchesWithAppearance("--radius")).toBe(false);
    expect(switchesWithAppearance("--gap-lg")).toBe(false);
  });
});
