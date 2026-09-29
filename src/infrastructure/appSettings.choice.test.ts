// @vitest-environment jsdom
// 決まった選択肢のどれかを覚える画面の好み（ADR-0048・#1256 c1＝列の高さ）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getChoiceSetting, setChoiceSetting } from "./appSettings";

const CHOICES = ["compact", "normal", "tall"] as const;

beforeEach(() => localStorage.clear());

describe("getChoiceSetting／setChoiceSetting（#1256 c1）", () => {
  it("覚えが無ければ既定", () => {
    expect(getChoiceSetting("k", CHOICES, "normal")).toBe("normal");
  });

  it("書いたものを読める", () => {
    setChoiceSetting("k", "tall");
    expect(getChoiceSetting("k", CHOICES, "normal")).toBe("tall");
  });

  // ⚠️ **選択肢に無い値は既定へ倒す**＝古い版の値・手で壊した値で、画面が知らない段を描かない。
  it("選択肢に無い値は既定へ倒す", () => {
    localStorage.setItem("k", "huge");
    expect(getChoiceSetting("k", CHOICES, "normal")).toBe("normal");
  });

  it("読めないときも既定へ倒す（起動できない状態を作らない）", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("読めない"); });
    try {
      expect(getChoiceSetting("k", CHOICES, "normal")).toBe("normal");
    } finally {
      spy.mockRestore();
    }
  });

  it("書けなくても投げない（その場では効かせる＝呼ぶ側が正を持つ）", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("書けない"); });
    try {
      expect(() => setChoiceSetting("k", "tall")).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});
