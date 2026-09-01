// 配布する版が**あちこちでずれない**ようにする門番（#355）。
//
// ⚠️ **2回取りこぼしている**（記録済み）＝0.4.1 のカットで配布文書の MSI 名が 0.4.0 のまま残り、
// 0.4.2 でようやく直した。版を上げる作業は**6か所**に散っていて、どれか1つ忘れても
// **ビルドは通り、テストも緑**になる（＝気づけない）。
// ⚠️ **利用者に届くのは配布文書の名前**＝そこがずれると、渡した MSI と手順書の名前が違い、
// 「そのファイルが無い」と言われる（§2-5 の行き止まり）。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), "utf8");

/** 版の正典＝`package.json`（ここを見て、ほかがそろっているかを見る）。 */
function baseVersion(): string {
  const v = (JSON.parse(read("package.json")) as { version?: string }).version;
  expect(v, "package.json に version が無い").toMatch(/^\d+\.\d+\.\d+$/);
  return v as string;
}

describe("配布する版がそろっている（#355）", () => {
  it("ビルドに関わる4か所がそろっている", () => {
    const v = baseVersion();
    const found: Record<string, string | null> = {
      "src-tauri/tauri.conf.json": (JSON.parse(read("src-tauri/tauri.conf.json")) as { version?: string }).version ?? null,
      "src-tauri/Cargo.toml": /^version\s*=\s*"([^"]+)"/m.exec(read("src-tauri/Cargo.toml"))?.[1] ?? null,
      // ⚠️ **`Cargo.lock` は自動では直らない**（`[[package]]` の自分自身のぶん）＝手で合わせる決まり。
      "src-tauri/Cargo.lock":
        /name = "star-recruit-studio"\nversion = "([^"]+)"/.exec(read("src-tauri/Cargo.lock"))?.[1] ?? null,
    };
    const drifted = Object.entries(found)
      .filter(([, got]) => got !== v)
      .map(([where, got]) => `${where}: ${got ?? "見つからない"}（package.json は ${v}）`);
    expect(drifted).toEqual([]);
  });

  it("配布文書の MSI 名がそろっている（渡した物と手順書の名前が食い違わない）", () => {
    const v = baseVersion();
    const drifted: string[] = [];
    for (const doc of ["テスターガイド.md", "配布手順.md"]) {
      const text = read(doc);
      const names = [...text.matchAll(/stario_(\d+\.\d+\.\d+)_x64_en-US\.msi/g)].map((m) => m[1]);
      // ⚠️ **1つも無いのも異常**＝書き換えではなく**行ごと消してしまった**ときに気づけない。
      if (names.length === 0) drifted.push(`${doc}: MSI の名前が1つも無い`);
      for (const got of names) if (got !== v) drifted.push(`${doc}: ${got}（package.json は ${v}）`);
    }
    expect(drifted).toEqual([]);
  });

  it("About 画面は版を直書きしない（手で直す場所を増やさない）", () => {
    // ⚠️ **#413 でアプリから取る形にした**＝直書きに戻ると、また手で直す場所が1つ増える。
    const about = read("src/app/screens/AboutScreen.tsx");
    expect(about).toMatch(/getAppVersion|getVersion/);
    // ⚠️ **「3つ組の数字」を丸ごと禁じない**（#968 レビュー 🟡）＝クレジットには
    // 依存の版（`OpenSSL 3.0.13` など）を正当に書きたくなることがあり、無関係な理由で落ちる。
    // 見たいのは**この版が直書きされていないか**なので、いまの版そのものを探す。
    expect(about, "About 画面に版が直書きされている").not.toContain(baseVersion());
  });

  it("門番が実際に効いている（走査が壊れたら落ちる）", () => {
    // ⚠️ 上の検査は**何も拾わなくても緑**になりうる＝読めていることを直接見る。
    expect(baseVersion()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(read("配布手順.md")).toContain("_x64_en-US.msi");
    expect(read("src-tauri/Cargo.lock")).toContain('name = "star-recruit-studio"');
  });
});
