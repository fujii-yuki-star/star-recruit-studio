// 録画・下見の道具が終わるときに、アプリの部品まで止める文（2026-10-15・llama-server が取り残された）。
import { describe, expect, it } from "vitest";
import { appTreeStopCommand } from "./appTree.mjs";

const BS = String.fromCharCode(92);

describe("appTreeStopCommand", () => {
  it("アプリのフォルダの下（区切りまで含めた前方一致）から起動したものだけを止める", () => {
    const c = appTreeStopCommand("C:/WS/app/release");
    expect(c).toContain(`StartsWith('C:${BS}WS${BS}app${BS}release${BS}'`);
    expect(c).toContain("OrdinalIgnoreCase");
    expect(c).toContain("Stop-Process -Id $_.ProcessId -Force");
  });

  it("区切りが \\ でも / でも、末尾に区切りがあっても同じ文になる（隣のフォルダ release2 を巻き込まない）", () => {
    const want = appTreeStopCommand("C:/WS/app/release");
    expect(appTreeStopCommand(`C:${BS}WS${BS}app${BS}release`)).toBe(want);
    expect(appTreeStopCommand(`C:${BS}WS${BS}app${BS}release${BS}`)).toBe(want);
  });

  it("フォルダ名の ' は PowerShell の文字列として壊れない", () => {
    expect(appTreeStopCommand("C:/it's")).toContain(`'C:${BS}it''s${BS}'`);
  });
});
