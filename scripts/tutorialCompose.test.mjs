// チュートリアル映像の仕上げ（#1228）＝段ごとに切り、声が長い段は止めたコマで待つ並べ方。
import { describe, expect, it } from "vitest";
import { planTimeline, wavDurationSec } from "./tutorialCompose.mjs";

describe("planTimeline", () => {
  it("前置き→段ごとの映像→後書きの順に並べ、声は段の頭から話し始める", () => {
    // 段は 2 秒と 5 秒に押す・映像は 8 秒。前置き1行・段0に1行・後書き1行。
    const p = planTimeline([2, 5], 8, ["opening", 0, "ending"], [1, 1, 1]);
    expect(p.items.map((i) => i.kind)).toEqual(["still", "video", "video", "video", "still"]);
    expect(p.voiceAt[0]).toBeCloseTo(0.6);
    const seg0 = p.items[2];
    expect(seg0).toMatchObject({ kind: "video", sourceStartSec: 2, durationSec: 3 });
    expect(p.voiceAt[1]).toBeCloseTo(seg0.startSec + 0.2);
    expect(p.voiceAt[2]).toBeGreaterThan(p.items[3].startSec + p.items[3].durationSec);
  });

  it("段の声が映像より長いときは、段の最後のコマを止めて声が終わるまで待つ", () => {
    const p = planTimeline([1], 3, [0], [5]);
    // 段0の映像（1〜3秒＝2秒）の後に、3秒近く止めたコマが入る
    const hold = p.items.find((i) => i.kind === "still");
    expect(hold.frameSec).toBeCloseTo(2.9);
    expect(hold.startSec + hold.durationSec).toBeCloseTo(p.voiceAt[0] + 5 + 0.3);
    expect(p.totalSec).toBeCloseTo(hold.startSec + hold.durationSec);
  });

  it("同じ段の行は続けて話し、重ならない", () => {
    const p = planTimeline([0.5], 10, [0, 0], [1.5, 2]);
    expect(p.voiceAt[1]).toBeCloseTo(p.voiceAt[0] + 1.5 + 0.25);
  });
});

describe("wavDurationSec", () => {
  it("data の大きさ ÷ 1秒あたりのバイト数", () => {
    const buf = Buffer.alloc(44 + 48000);
    buf.write("RIFF", 0);
    buf.write("WAVE", 8);
    buf.write("fmt ", 12);
    buf.writeUInt32LE(16, 16);
    buf.writeUInt32LE(24000, 28); // byteRate＝24000 B/s
    buf.write("data", 36);
    buf.writeUInt32LE(48000, 40);
    expect(wavDurationSec(buf)).toBeCloseTo(2);
  });
});
