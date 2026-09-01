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

  /**
   * いま同梱しているフォントの家族（#355）。
   *
   * ⚠️ **増やしたらここも直す**＝直さないと落ちる。ついでに **About のクレジットも足す**こと
   *（同じ提供元で既存のライセンス文書を使い回すなら、クレジットは増えないこともある）。
   * ⚠️ **数の下限だけでは守れない**（#968 レビュー 🔴）＝最初は
   * `Math.min(families.size, 2)` と書いており、**2で頭打ち**になって
   * 4つ目以降を足しても落ちなかった＝**この検査の目的そのものが効いていなかった**。
   */
  const KNOWN_FONT_FAMILIES = ["GenInterfaceJP", "GenInterfaceJPDisplay", "KaitouYokokuGothic"];

  /**
   * ⚠️ **この検査で守れないこと**（#968 レビュー・**わざと残す限界**）。
   *
   * - **名前だけ既存に似せた差し替え**は見つけられない＝`KaitouYokokuGothic-Bold.ttf` という名前で
   *   **別の提供元のフォント**を入れると、顔ぶれも文書の数も変わらないので通る。
   *   `13 §6`（同梱できるのは OFL 系だけ）を**機械では守れていない**＝そこは人が見る。
   * - **入れ子のフォルダは数えない**（`readdirSync` は直下だけ）＝`public/fonts/xx/` に置くと
   *   どちらの検査にも乗らない。いまは全部直下にあるので実害は無い。
   *
   * ⚠️ **「数が合っている」は「中身が同じ」ではない**＝ここが守るのは**うっかりの足し忘れ**まで。
   * 中身まで見るには、ファイルの中身そのもので突き合わせる必要があり、それはこの門番の役目ではない。
   */
  const FONT_CHECK_LIMITS = "名前だけ似せた差し替えと、入れ子のフォルダは見つけられない";

  it("同梱フォントの顔ぶれが変わったら気づく（足したのに書き忘れ、を防ぐ）", () => {
    const dir = join(process.cwd(), "public", "fonts");
    expect(existsSync(dir), "同梱フォントの置き場が無い").toBe(true);
    const families = [
      ...new Set(
        readdirSync(dir)
          .filter((n) => /\.(woff2?|ttf|otf)$/i.test(n))
          .map((n) => n.replace(/\.(woff2?|ttf|otf)$/i, "").replace(/-(Regular|Bold|Medium)$/i, "")),
      ),
    ].sort();
    expect(
      families,
      `同梱フォントの顔ぶれが変わった。KNOWN_FONT_FAMILIES を直すだけで終わらせず、` +
        `About 画面のクレジット（提供元・ライセンス）も足りているか確かめること。` +
        `なお ${FONT_CHECK_LIMITS}`,
    ).toEqual([...KNOWN_FONT_FAMILIES].sort());
  });

  it("同梱したライセンス文書の数だけ、フォントのクレジットが在る", () => {
    // ⚠️ **ライセンス文書の数で見る**＝フォントを同梱するなら、その文書も同梱することになるので、
    // 「別の提供元を足した」が**必ず**ここに現れる。ファイル名と表示名は別物なので、名前では突き合わせない。
    const dir = join(process.cwd(), "public", "fonts");
    const licenses = readdirSync(dir).filter((n) => /^OFL.*\.txt$/i.test(n)).length;
    const credited = (about().match(/Open Font License/g) ?? []).length;
    expect(credited, `ライセンス文書 ${licenses} 件に対しクレジット ${credited} 件`).toBeGreaterThanOrEqual(
      licenses,
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
