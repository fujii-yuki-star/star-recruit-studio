// 案内文が指す**押す先の名前**が、実際に画面へ出ているかを機械で守る（#354）。
//
// ⚠️ **「案内どおり探しても見つからない」は繰り返している**（§2-5 の行き止まり）＝
// 素材ライブラリの取り込み（差分再監査 5巡目 🟡）・素材の一覧（α-6 出口監査 🟡29）で同じ形を直した。
// どちらも「その種類ではその欄に出ない」ことに気づかず1文で言い切っていた。
// ⚠️ **既存の走査では捕まらない**＝`uiLabels.test.ts` は禁止語だけ、`errorStateTable.test.ts` は
// 表と実装の一致だけを見ており、**文の中で名指ししている先が実在するか**は誰も見ていなかった。
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** 走査するソース（テストは除く）。 */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name) && !name.includes(".test.")) out.push(p);
    }
  };
  for (const d of ["src/app", "src/domain", "src/infrastructure"]) walk(join(process.cwd(), d));
  return out;
}

/**
 * コメントを落とす。
 *
 * ⚠️ **`{/* … *\/}`（JSX のコメント）も落とす**＝落とさないと、説明のために名前を引用しただけの
 * 文が「案内」として拾われ、**実害ゼロの指摘で埋まる**（実際そうなって6件まで減らすのに手間取った）。
 */
function stripComments(text: string): string {
  const LINE = "//";
  const OPEN = "/" + "*";
  const CLOSE = "*" + "/";
  let out = "";
  let i = 0;
  for (;;) {
    const a = text.indexOf(OPEN, i);
    if (a < 0) {
      out += text.slice(i);
      break;
    }
    const b = text.indexOf(CLOSE, a + 2);
    out += text.slice(i, a);
    if (b < 0) break;
    i = b + 2;
  }
  return out
    .split("\n")
    .map((l) => {
      const i2 = l.indexOf(LINE);
      return i2 >= 0 ? l.slice(0, i2) : l;
    })
    .join("\n");
}

/**
 * **押す先を名指ししていない引用**＝この検査の対象外。
 *
 * ⚠️ **理由を書いて外す**（`errorStateTable.test.ts` と同じ流儀）＝黙って外すと、
 * 次に足す人が「なぜ通っているのか」を確かめずに真似る。
 */
const NOT_A_TARGET: Record<string, string> = {
  グループの中での値: "押す先ではなく、数値の読み方の説明（「〜で、画面の見え方とずれることがあります」）",
};

describe("案内が指す名前は実在する（#354）", () => {
  it("「〇〇」を押す／から／で、と書いた先が画面のどこかに出ている", () => {
    const files = sourceFiles();
    // ⚠️ **AI への指示文は対象外**＝`buildVideoPlanRequest` は AI に渡す文で、画面には出ない。
    const uiFiles = files.filter((p) => !p.includes(join("domain", "ai")));
    const stripped = uiFiles.map((p) => [p, stripComments(readFileSync(p, "utf8"))] as const);

    // 案内文の中で名指ししているもの（「〇〇」を押す／「〇〇」から／「〇〇」で）。
    const refs = new Map<string, Set<string>>();
    for (const [p, t] of stripped) {
      for (const m of t.matchAll(/「([^」\n]{2,20})」(を押|から|で)/g)) {
        const name = m[1];
        // 差し込み（`${…}`）や英字だけの識別子は名前として扱わない。
        if (/[a-zA-Z_.*+?^${}()|[\]「]/.test(name)) continue;
        if (name in NOT_A_TARGET) continue;
        if (!refs.has(name)) refs.set(name, new Set());
        refs.get(name)!.add(p);
      }
    }
    expect(refs.size).toBeGreaterThanOrEqual(30); // 走査が空振りしていないこと

    // 画面に出ているか＝JSX の子要素／属性／文字列リテラル。
    // ⚠️ **前方一致で見る**＝実際のラベルは「枠いっぱいに表示（はみ出しは切り取り）」のように
    // 補足が付くことがあり、案内はその前半だけを引く（利用者はそれで見つけられる）。
    const quotes = ['"', "'", "`"];
    const hasLabel = (name: string): boolean =>
      stripped.some(([, t]) =>
        t.split("\n").some((raw) => {
          const s = raw.trim();
          return s.startsWith(name) || s.includes(">" + name) || quotes.some((q) => s.includes(q + name));
        }),
      );

    const dangling: string[] = [];
    for (const [name, where] of refs) {
      if (!hasLabel(name)) dangling.push(`「${name}」← ${[...where].join(", ")}`);
    }
    // ⚠️ **どちらを直すかは人が決める**（名前を変えたのか、案内が古いのか）ので、両方を出す。
    expect(dangling.join("\n")).toBe("");
  });

  it("対象外にした引用は、いまも本文に在る（理由だけが残らない）", () => {
    const all = sourceFiles()
      .map((p) => readFileSync(p, "utf8"))
      .join("\n");
    expect(Object.keys(NOT_A_TARGET).filter((n) => !all.includes(n))).toEqual([]);
  });
});
