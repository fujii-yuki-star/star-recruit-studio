import { describe, expect, it } from "vitest";
import type { Scene } from "../../domain/project/types";
import { sceneFirstLine } from "./sceneCardPreview";

// #413：場面カードに「セリフ先頭」を出して全カード同一アイコンでも中身で見分けられるようにする。
// 空行はスキップ／非空が無ければ空文字（単一 narration も sceneLines 経由で1行に解決＝後方互換）。
const base = (over: Partial<Scene>): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "photo_intro",
    templateId: "tpl", durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" },
    texts: {}, narration: { text: "", status: "none" }, warnings: [],
    ...over,
  }) as unknown as Scene;

describe("sceneFirstLine（場面カードのセリフ先頭・#413）", () => {
  it("単一 narration は本文を返す", () => {
    expect(sceneFirstLine(base({ narration: { text: "こんにちは", status: "none" } } as Partial<Scene>))).toBe("こんにちは");
  });

  it("掛け合いは最初の非空セリフ行を返す（空行はスキップ）", () => {
    const scene = base({
      lines: [
        { lineId: "line_001", text: "   ", startSec: 0 },
        { lineId: "line_002", text: "  実際のセリフ  ", startSec: 1 },
      ],
    } as unknown as Partial<Scene>);
    expect(sceneFirstLine(scene)).toBe("実際のセリフ"); // trim 済み
  });

  it("セリフが無ければ空文字（カードに何も出さない）", () => {
    expect(sceneFirstLine(base({ narration: { text: "   ", status: "none" } } as Partial<Scene>))).toBe("");
  });
});
