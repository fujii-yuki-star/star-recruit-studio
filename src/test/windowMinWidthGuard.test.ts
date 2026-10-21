// 窓の最小の大きさと、画面の最小の幅（#1481・ADR-0033 未解決3）。
//
// ⚠️ **画面の最小の幅は、窓の最小（外寸）より小さくなければならない**＝窓の中の幅は枠のぶん狭い（実測 1024 → 1010px）。
//   同じ 1024 にしていたため、最小の窓で**画面ぜんぶが横に流れ、右の欄が切れていた**（黙って欄を隠す）。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** 窓の枠・縦のスクロール棒に食われる幅の見込み（実測 14px に余裕を持たせる）。 */
const FRAME_ALLOWANCE_PX = 40;

describe("窓の最小と画面の最小の幅（#1481）", () => {
  it("`.app` の最小の幅は、窓の最小の外寸より枠のぶん以上小さい", () => {
    const conf = JSON.parse(readFileSync(join(process.cwd(), "src-tauri", "tauri.conf.json"), "utf8")) as {
      app: { windows: { minWidth?: number }[] };
    };
    const winMin = conf.app.windows[0]?.minWidth;
    const css = readFileSync(join(process.cwd(), "src", "styles", "theme.css"), "utf8");
    const m = /\.app\s*\{[^}]*?min-width:\s*(\d+)px/.exec(css);
    expect(winMin, "窓の最小が見つからない（検査が空振りする）").toBeTypeOf("number");
    expect(m, "`.app` の最小の幅が見つからない（検査が空振りする）").not.toBeNull();
    expect(Number(m![1])).toBeLessThanOrEqual((winMin as number) - FRAME_ALLOWANCE_PX);
  });
});
