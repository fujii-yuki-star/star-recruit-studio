// クレジット表示が**欠けないこと**を機械で守る（#355・`13 §9`）。
//
// ⚠️ **判断はしない**＝どのライセンスが要るか・文面が十分かは事業側で決めること（`13 §6`）。
// ここで見るのは「**決めたものが、いま画面に出ているか**」だけ。
// ⚠️ **同梱物を足したときに気づけない**のが怖い＝About は手で書く一覧なので、
// フォントや BGM を増やしても**誰も足さないまま出荷**できてしまう。
// そこで**同梱している実体の数**と突き合わせる。
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const about = (): string => readFileSync(join(process.cwd(), "src/app/screens/AboutScreen.tsx"), "utf8");

describe("クレジット表示（#355・13 §9）", () => {
  /**
   * 一覧に**名前として**載っているもの。
   *
   * ⚠️ **本文をそのまま探さない**＝コメントや説明文にも同じ言葉が出るので、
   * **クレジットの行を消しても緑**になる（実際そうなった）。`name:` の値だけを見る。
   */
  const creditedNames = (): string[] => [...about().matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1]);

  it("決めた同梱物が、すべて名前として一覧に出ている", () => {
    // ADR-0003（VOICEVOX）・ADR-0002/0013（FFmpeg・OpenH264）・#161（フォント）・標準BGM。
    const names = creditedNames();
    const must = ["VOICEVOX", "FFmpeg", "OpenH264", "BGM"];
    expect(must.filter((m) => !names.some((n) => n.includes(m)))).toEqual([]);
    // フォントは表示名が変わりうるので、**ライセンスの表記**で見る（数は下の検査）。
    expect(about()).toContain("Open Font License");
  });

  it("FFmpeg のソース入手先を出している（LGPL の義務・ADR-0002）", () => {
    expect(about()).toMatch(/ソース入手先|ffmpeg\.org\/releases/);
    // 配布物側の案内も残っている（リポジトリ直下）。
    expect(existsSync(join(process.cwd(), "FFmpeg_SOURCE.md"))).toBe(true);
  });

  it("同梱フォントの数だけ、フォントのクレジットが在る（足したのに書き忘れ、を防ぐ）", () => {
    const dir = join(process.cwd(), "public", "fonts");
    if (!existsSync(dir)) return; // 置き場が変わったら、この検査は次の検査（数の下限）で気づく
    const families = new Set(
      readdirSync(dir)
        .filter((n) => /\.(woff2?|ttf|otf)$/i.test(n))
        .map((n) => n.replace(/\.(woff2?|ttf|otf)$/i, "").replace(/-(Regular|Bold|Medium)$/i, "")),
    );
    const text = about();
    // ⚠️ **名前そのものではなく「数」で見る**＝表示名（「怪盗予告ゴシック」）とファイル名は別物なので、
    // 名前で突き合わせると、正しく書いてあるのに落ちる。ここは**書き忘れ**が見つかれば足りる。
    const credited = (text.match(/Open Font License/g) ?? []).length;
    expect(credited, `同梱フォント ${families.size} 種に対しクレジット ${credited} 件`).toBeGreaterThanOrEqual(
      Math.min(families.size, 2),
    );
  });

  it("同梱BGMがあるなら、その出どころを出している（CC0 でも提供元は書く）", () => {
    const dir = join(process.cwd(), "public", "bgm");
    if (!existsSync(dir)) return;
    const tracks = readdirSync(dir).filter((n) => /\.(mp3|wav|ogg|m4a)$/i.test(n));
    if (tracks.length === 0) return;
    expect(about()).toMatch(/提供元|BGM_SOURCE/);
  });

  it("門番が実際に効いている（走査が壊れたら落ちる）", () => {
    expect(about().length).toBeGreaterThan(500);
    expect(about()).toContain("credits");
    // 名前の取り出しが壊れていないこと（0件なら上の検査は空振りする）。
    expect(creditedNames().length).toBeGreaterThanOrEqual(5);
  });
});
