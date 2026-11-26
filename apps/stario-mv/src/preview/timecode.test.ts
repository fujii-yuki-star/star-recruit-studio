import { describe, expect, it } from "vitest";
import { formatFps, formatTimecode } from "./timecode";

describe("タイムコード", () => {
  it("時:分:秒:コマ で数える", () => {
    expect(formatTimecode(0, { num: 30, den: 1 })).toBe("00:00:00:00");
    expect(formatTimecode(45, { num: 30, den: 1 })).toBe("00:00:01:15");
    expect(formatTimecode(30 * 3661 + 7, { num: 30, den: 1 })).toBe("01:01:01:07");
    expect(formatTimecode(24, { num: 24, den: 1 })).toBe("00:00:01:00");
  });
  it("29.97 は 30 コマで数える（ドロップしない）", () => {
    expect(formatTimecode(30, { num: 30000, den: 1001 })).toBe("00:00:01:00");
    expect(formatFps({ num: 30000, den: 1001 })).toBe("29.97");
    expect(formatFps({ num: 60, den: 1 })).toBe("60");
  });
});
