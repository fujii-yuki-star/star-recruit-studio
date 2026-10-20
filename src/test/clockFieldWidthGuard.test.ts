// 時刻の欄（ClockField）が字を切らない幅を持つ（2026-10-20 実機＝「0:00:00」の最後の字が切れていた）。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("時刻の欄の幅", () => {
  it("幅は中身だけで決め（詰め物に左右されない）、分が2桁でも入る 8 字以上", () => {
    const css = readFileSync(join(process.cwd(), "src", "app", "components", "timeline.css"), "utf8");
    const rule = /\.clock-field\s*\{([^}]*)\}/.exec(css)?.[1];
    expect(rule, "規則が見つからない（検査が空振りする）").toBeTruthy();
    expect(rule).toMatch(/box-sizing:\s*content-box/);
    const w = /width:\s*([\d.]+)ch/.exec(rule!);
    expect(w, "幅が ch で書かれていない").not.toBeNull();
    expect(Number(w![1])).toBeGreaterThanOrEqual("10:00:00".length);
  });
});
