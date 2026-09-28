// 素材を置いたときの箱（2026-09-28 の実機レビュー）。
//
// ⚠️ **切り取られていた**＝以前は種類に関わらず**画面いっぱいの箱**にしていたので、
// 正方形・縦長の素材が `fit:'cover'` で切られた（同梱のゆうこの立ち絵 1254×1254 で頭と足が切れた）。
// ⚠️ **当時の理由はもう無い**＝「大きさを直す手段がまだ無い」（#684 レビュー）が前提だったが、
// いまは幅・高さの欄と掴む取っ手で直せる。
import { describe, expect, it } from "vitest";
import { containBox } from "./edit";

const canvas = { width: 1920, height: 1080 };

describe("素材の形のまま収める（containBox）", () => {
  it("正方形は高さいっぱい・横は余る（切れない）", () => {
    expect(containBox({ w: 1254, h: 1254 }, canvas)).toEqual({ w: 1080, h: 1080 });
  });

  it("画面と同じ形なら、画面いっぱいになる（余白も切れも無い）", () => {
    expect(containBox({ w: 1920, h: 1080 }, canvas)).toEqual({ w: 1920, h: 1080 });
    expect(containBox({ w: 3840, h: 2160 }, canvas)).toEqual({ w: 1920, h: 1080 });
  });

  it("縦長は高さで決まる", () => {
    expect(containBox({ w: 1080, h: 1920 }, canvas)).toEqual({ w: 608, h: 1080 });
  });

  it("横長は幅で決まる", () => {
    expect(containBox({ w: 4000, h: 1000 }, canvas)).toEqual({ w: 1920, h: 480 });
  });

  // ⚠️ **拡大はしない**＝画面より小さい素材を引き伸ばすと粗くなる。
  it("画面より小さい素材は、実寸のまま（引き伸ばさない）", () => {
    expect(containBox({ w: 300, h: 200 }, canvas)).toEqual({ w: 300, h: 200 });
  });

  // ⚠️ **壊れた値で落ちない**＝測れなかった素材（0 や負）でも箱は返す。
  it("実寸が壊れていたら画面いっぱいへ倒す（落とさない）", () => {
    expect(containBox({ w: 0, h: 0 }, canvas)).toEqual({ w: 1920, h: 1080 });
    expect(containBox({ w: -5, h: 10 }, canvas)).toEqual({ w: 1920, h: 1080 });
  });

  it("縦型の画面でも同じ理屈で収まる", () => {
    const portrait = { width: 1080, height: 1920 };
    expect(containBox({ w: 1254, h: 1254 }, portrait)).toEqual({ w: 1080, h: 1080 });
  });
});
