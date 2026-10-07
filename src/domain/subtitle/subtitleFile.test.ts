// 字幕ファイル（SRT / WebVTT）の読み書き（ADR-0055・#1351）。
import { describe, expect, it } from "vitest";
import {
  decodeSubtitleBytes,
  hasGarbledChar,
  formatSubtitleFile,
  formatSubtitleTime,
  parseSubtitleFile,
  parseSubtitleTime,
  SUBTITLE_FILE_KIND,
  subtitleFileKindOfPath,
} from "./subtitleFile";

const SRT = `1
00:00:01,000 --> 00:00:02,500
こんにちは

2
00:00:03,000 --> 00:00:05,000
<i>二行の</i>
字幕です
`;

const VTT = `WEBVTT

NOTE これは注釈

cue-1
00:01.000 --> 00:02.500 align:start position:10%
{\\an8}こんにちは &amp; ようこそ

00:00:03.000 --> 00:00:05.000
1<2 は残す
`;

describe("parseSubtitleTime", () => {
  it("SRT・VTT・時の無い形・小数の桁が少ない形", () => {
    expect(parseSubtitleTime("00:00:01,000")).toBe(1);
    expect(parseSubtitleTime("01:02.5")).toBeCloseTo(62.5, 9);
    expect(parseSubtitleTime("1:02:03.4")).toBeCloseTo(3723.4, 9);
    expect(parseSubtitleTime("00:61:00,000")).toBeNull();
    expect(parseSubtitleTime("abc")).toBeNull();
  });
});

describe("parseSubtitleFile", () => {
  it("SRT＝番号の行を捨て、体裁の印を落とし、複数行はそのまま", () => {
    const r = parseSubtitleFile(SRT);
    expect(r).toEqual({
      cues: [
        { startSec: 1, endSec: 2.5, text: "こんにちは" },
        { startSec: 3, endSec: 5, text: "二行の\n字幕です" },
      ],
      unreadable: 0,
    });
  });

  it("VTT＝見出し・注釈を数えず、キューの名前と設定を捨て、文字の < は残す", () => {
    const r = parseSubtitleFile(VTT);
    expect(r.unreadable).toBe(0);
    expect(r.cues.map((c) => c.text)).toEqual(["こんにちは & ようこそ", "1<2 は残す"]);
    expect(r.cues[0]).toEqual(expect.objectContaining({ startSec: 1, endSec: 2.5 }));
  });

  it("読めない塊は黙って捨てずに数える（時刻が読めない・終わりが始まり以前・文が空・時刻の行が無い）", () => {
    const r = parseSubtitleFile("1\n00:00:05,000 --> 00:00:04,000\nさかさま\n\n2\nxx --> yy\n文\n\n3\n00:00:01,000 --> 00:00:02,000\n\n\nただの文\n");
    expect(r.cues).toEqual([]);
    expect(r.unreadable).toBe(4); // さかさま・時刻が読めない・文が空の塊・時刻の行が無い「ただの文」
  });

  it("時刻順に並べる・CRLF も読む", () => {
    const r = parseSubtitleFile("1\r\n00:00:05,000 --> 00:00:06,000\r\nあと\r\n\r\n2\r\n00:00:01,000 --> 00:00:02,000\r\nさき\r\n");
    expect(r.cues.map((c) => c.text)).toEqual(["さき", "あと"]);
  });
});

describe("formatSubtitleFile", () => {
  const cues = [{ startSec: 1, endSec: 2.5, text: "こんにちは" }, { startSec: 3723.4, endSec: 3724, text: "二行\n\n目" }];

  it("SRT は BOM 付き・番号とカンマ、VTT は見出しと小数点", () => {
    const srt = formatSubtitleFile(cues, SUBTITLE_FILE_KIND.srt);
    expect(srt.charCodeAt(0)).toBe(0xfeff);
    expect(srt.slice(1).startsWith("1\n00:00:01,000 --> 00:00:02,500\nこんにちは\n\n2\n01:02:03,400 --> 01:02:04,000\n二行\n目\n")).toBe(true);
    const vtt = formatSubtitleFile(cues, SUBTITLE_FILE_KIND.vtt);
    expect(vtt.startsWith("WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nこんにちは")).toBe(true);
    expect(vtt.charCodeAt(0)).not.toBe(0xfeff);
  });

  it("往復しても時刻と文字が変わらない（文の中の空行は詰める＝塊が割れない）", () => {
    for (const kind of [SUBTITLE_FILE_KIND.srt, SUBTITLE_FILE_KIND.vtt]) {
      const back = parseSubtitleFile(formatSubtitleFile(cues, kind).replace(new RegExp(`^${String.fromCharCode(0xfeff)}`), ""));
      expect(back.unreadable).toBe(0);
      expect(back.cues).toEqual([{ startSec: 1, endSec: 2.5, text: "こんにちは" }, { startSec: 3723.4, endSec: 3724, text: "二行\n目" }]);
    }
  });

  it("VTT は文の中の & < > を置き換え、読み直すと元に戻る（「<株>」が消えない）", () => {
    const c = [{ startSec: 1, endSec: 2, text: "<株>A&B --> C" }];
    const vtt = formatSubtitleFile(c, SUBTITLE_FILE_KIND.vtt);
    expect(vtt).toContain("&lt;株&gt;A&amp;B --&gt; C");
    expect(parseSubtitleFile(vtt).cues).toEqual(c);
    // SRT は置き換えない（タグの約束が無い＝再生ソフトはそのまま出す）
    expect(formatSubtitleFile(c, SUBTITLE_FILE_KIND.srt)).toContain("<株>A&B --> C");
  });

  it("長さの無い・文の無い字幕は書かない", () => {
    expect(formatSubtitleFile([{ startSec: 1, endSec: 1, text: "x" }, { startSec: 1, endSec: 2, text: "  " }], SUBTITLE_FILE_KIND.vtt)).toBe("WEBVTT\n\n\n");
  });

  it("時刻はミリ秒で丸める・負は 0", () => {
    expect(formatSubtitleTime(1.0004, SUBTITLE_FILE_KIND.srt)).toBe("00:00:01,000");
    expect(formatSubtitleTime(-3, SUBTITLE_FILE_KIND.vtt)).toBe("00:00:00.000");
  });
});

describe("decodeSubtitleBytes", () => {
  it("UTF-8（BOM あり・なし）・UTF-16（BOM あり）・Shift_JIS を読む", () => {
    const utf8 = new TextEncoder().encode("こんにちは");
    expect(decodeSubtitleBytes(utf8)).toBe("こんにちは");
    expect(decodeSubtitleBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8]))).toBe("こんにちは");
    const u16 = new Uint8Array([0xff, 0xfe, 0x53, 0x30, 0x93, 0x30]); // 「こん」
    expect(decodeSubtitleBytes(u16)).toBe("こん");
    const sjis = new Uint8Array([0x82, 0xb1, 0x82, 0xf1]); // 「こん」（Shift_JIS）
    expect(decodeSubtitleBytes(sjis)).toBe("こん");
  });
});

// PR #1355 レビュー：空行で塊に割るやり方の取りこぼし・誤読と、文字コードの化けを成功にしない。
describe("行ごとに読む（PR #1355 レビュー）", () => {
  it("WEBVTT の直後に空行が無くても1件目を落とさない", () => {
    const r = parseSubtitleFile("WEBVTT\n00:00:01.000 --> 00:00:02.000\n一件目\n\n00:00:03.000 --> 00:00:04.000\n二件目\n");
    expect(r.cues.map((c) => c.text)).toEqual(["一件目", "二件目"]);
    expect(r.unreadable).toBe(0);
  });

  it("空行の抜けた SRT＝次の番号と時刻を文として並べない", () => {
    const r = parseSubtitleFile("1\n00:00:01,000 --> 00:00:02,000\n文1\n2\n00:00:03,000 --> 00:00:04,000\n文2\n");
    expect(r.cues).toEqual([{ startSec: 1, endSec: 2, text: "文1" }, { startSec: 3, endSec: 4, text: "文2" }]);
  });

  it("NOTE の直後に空行が無くても、続く字幕を読む", () => {
    const r = parseSubtitleFile("WEBVTT\n\nNOTE 注釈\n00:00:01.000 --> 00:00:02.000\n読める\n");
    expect(r.cues.map((c) => c.text)).toEqual(["読める"]);
  });

  it("全角の数字・記号の時刻も読む", () => {
    const r = parseSubtitleFile("１\n００：００：０１，０００　－－＞　００：００：０２，５００\n全角\n");
    expect(r.cues).toEqual([{ startSec: 1, endSec: 2.5, text: "全角" }]);
  });
});

describe("文字コードの化けを成功にしない（PR #1355 レビュー）", () => {
  it("BOM の無い UTF-16（NUL を含む）は読めない扱い", () => {
    const u16 = new Uint8Array([0x31, 0x00, 0x0a, 0x00]); // 「1\n」の UTF-16LE（BOM なし）
    expect(decodeSubtitleBytes(u16)).toBeNull();
  });

  it("Shift_JIS で読んでも化けた（制御文字が出た）なら読めない扱い", () => {
    expect(decodeSubtitleBytes(new Uint8Array([0x80, 0x41]))).toBeNull();
  });

  // Node の Shift_JIS は 0x80 で例外を投げるが、WebView2 は U+0080 として通す＝印の判定を直接見る。
  it("化けの印＝NUL・C1 制御文字・置き換え文字（日本語や半角カナは化けではない）", () => {
    expect(hasGarbledChar("こんにちは ｱｲｳ")).toBe(false);
    for (const c of [0, 0x80, 0x9f, 0xfffd]) expect(hasGarbledChar("あ" + String.fromCharCode(c)), String(c)).toBe(true);
    expect(hasGarbledChar("あ" + String.fromCharCode(0xa0))).toBe(false);
  });
});

describe("subtitleFileKindOfPath", () => {
  it("拡張子で形式を決める（大文字も）・それ以外は null", () => {
    expect(subtitleFileKindOfPath("C:/a/字幕.srt")).toBe(SUBTITLE_FILE_KIND.srt);
    expect(subtitleFileKindOfPath("D:/b.c/字幕.VTT")).toBe(SUBTITLE_FILE_KIND.vtt);
    expect(subtitleFileKindOfPath("C:/a/字幕.txt")).toBeNull();
    expect(subtitleFileKindOfPath("C:/a.srt/字幕")).toBeNull();
  });
});
