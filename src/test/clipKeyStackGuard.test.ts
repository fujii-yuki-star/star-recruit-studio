// 帯のキーフレームの印は、端の取っ手より奥（#1186 ②・PR #1504 レビュー 🟡）＝帯の先頭・末尾のキーの印が取っ手に重なっても、
// 端を縮める操作が勝つ（Premiere・CapCut の型）。印と取っ手は同じ帯の中の兄弟なので、z-index の大小がそのまま重なり順になる。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src", "app", "components", "timeline.css"), "utf8");
const zOf = (sel: string): number => {
  const rule = new RegExp(`${sel.replace(/[.-]/g, (c) => `\\${c}`)}\\s*\\{([^}]*)\\}`).exec(css)?.[1];
  expect(rule, `${sel} の規則が見つからない（検査が空振りする）`).toBeTruthy();
  const z = /z-index:\s*(-?\d+)/.exec(rule!);
  expect(z, `${sel} に z-index が無い`).not.toBeNull();
  return Number(z![1]);
};

describe("帯の印と端の取っ手の重なり", () => {
  it("印は取っ手より奥", () => {
    expect(zOf(".timeline-clip-key")).toBeLessThan(zOf(".timeline-clip-handle"));
  });
});
