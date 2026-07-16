import { describe, expect, it } from "vitest";
import {
  hexToHsv, hexToRgb, hsvToHex, hsvToRgb, isValidHex, normalizeHex, rgbToHex, rgbToHsv, type Hsv,
} from "./color";

describe("normalizeHex", () => {
  it("#付き6桁はそのまま小文字化", () => {
    expect(normalizeHex("#AABBCC")).toBe("#aabbcc");
    expect(normalizeHex("#0f0f0f")).toBe("#0f0f0f");
  });
  it("#なし6桁も受ける", () => {
    expect(normalizeHex("aabbcc")).toBe("#aabbcc");
  });
  it("3桁は6桁へ展開", () => {
    expect(normalizeHex("#abc")).toBe("#aabbcc");
    expect(normalizeHex("f00")).toBe("#ff0000");
  });
  it("前後の空白は無視", () => {
    expect(normalizeHex("  #Abc  ")).toBe("#aabbcc");
  });
  it("無効な入力は null", () => {
    expect(normalizeHex("")).toBeNull();
    expect(normalizeHex("#12")).toBeNull();
    expect(normalizeHex("#12345")).toBeNull();
    expect(normalizeHex("#gggggg")).toBeNull();
    expect(normalizeHex("red")).toBeNull();
  });
});

describe("isValidHex", () => {
  it("正しい色コードは true・それ以外 false", () => {
    expect(isValidHex("#abc")).toBe(true);
    expect(isValidHex("aabbcc")).toBe(true);
    expect(isValidHex("#xyz")).toBe(false);
    expect(isValidHex("12")).toBe(false);
  });
});

describe("hexToRgb / rgbToHex", () => {
  it("代表色を相互変換する", () => {
    expect(hexToRgb("#ff0000")).toEqual({ r: 255, g: 0, b: 0 });
    expect(hexToRgb("#00ff00")).toEqual({ r: 0, g: 255, b: 0 });
    expect(hexToRgb("#0000ff")).toEqual({ r: 0, g: 0, b: 255 });
    expect(hexToRgb("#ffffff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 });
  });
  it("無効な色コードは null", () => {
    expect(hexToRgb("#zz")).toBeNull();
  });
  it("rgbToHex は 0〜255 にクランプし2桁ゼロ詰め", () => {
    expect(rgbToHex({ r: 0, g: 0, b: 0 })).toBe("#000000");
    expect(rgbToHex({ r: 255, g: 255, b: 255 })).toBe("#ffffff");
    expect(rgbToHex({ r: 300, g: -10, b: 16 })).toBe("#ff0010"); // クランプ + 小文字
  });
});

describe("rgbToHsv", () => {
  const near = (got: Hsv, exp: Hsv) => {
    expect(got.h).toBeCloseTo(exp.h, 1);
    expect(got.s).toBeCloseTo(exp.s, 3);
    expect(got.v).toBeCloseTo(exp.v, 3);
  };
  it("原色・白・黒・灰", () => {
    near(rgbToHsv({ r: 255, g: 0, b: 0 }), { h: 0, s: 1, v: 1 }); // 赤
    near(rgbToHsv({ r: 0, g: 255, b: 0 }), { h: 120, s: 1, v: 1 }); // 緑
    near(rgbToHsv({ r: 0, g: 0, b: 255 }), { h: 240, s: 1, v: 1 }); // 青
    near(rgbToHsv({ r: 255, g: 255, b: 255 }), { h: 0, s: 0, v: 1 }); // 白（彩度0）
    near(rgbToHsv({ r: 0, g: 0, b: 0 }), { h: 0, s: 0, v: 0 }); // 黒
    near(rgbToHsv({ r: 128, g: 128, b: 128 }), { h: 0, s: 0, v: 128 / 255 }); // 灰（彩度0）
  });
});

describe("hsvToRgb", () => {
  it("代表 HSV を rgb へ", () => {
    expect(hsvToRgb({ h: 0, s: 1, v: 1 })).toEqual({ r: 255, g: 0, b: 0 });
    expect(hsvToRgb({ h: 120, s: 1, v: 1 })).toEqual({ r: 0, g: 255, b: 0 });
    expect(hsvToRgb({ h: 240, s: 1, v: 1 })).toEqual({ r: 0, g: 0, b: 255 });
    expect(hsvToRgb({ h: 0, s: 0, v: 1 })).toEqual({ r: 255, g: 255, b: 255 });
  });
  it("色相は 360 で巻き戻す（-60=300）", () => {
    expect(hsvToRgb({ h: 360, s: 1, v: 1 })).toEqual({ r: 255, g: 0, b: 0 });
    expect(hsvToRgb({ h: -120, s: 1, v: 1 })).toEqual(hsvToRgb({ h: 240, s: 1, v: 1 }));
  });
});

describe("往復（hex↔hsv）", () => {
  it("代表色は hex→hsv→hex で戻る", () => {
    for (const hex of ["#ff0000", "#3b82f6", "#22c55e", "#eab308", "#8b5cf6", "#000000", "#ffffff"]) {
      const hsv = hexToHsv(hex);
      expect(hsv).not.toBeNull();
      expect(hsvToHex(hsv!)).toBe(hex);
    }
  });
  it("hexToHsv は無効入力で null", () => {
    expect(hexToHsv("nope")).toBeNull();
  });
});
