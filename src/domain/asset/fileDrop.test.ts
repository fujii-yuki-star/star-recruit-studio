// 落とされたファイルのふるい（#1026 ②）。
import { describe, expect, it } from "vitest";
import { cssPointOf, droppableExtensions, isPointInRect, triageDroppedFiles } from "./fileDrop";
import { AUDIO_FILE_EXTENSIONS, IMAGE_FILE_EXTENSIONS, UNNAMED_ASSET_NAME, VIDEO_FILE_EXTENSIONS } from "./assetFile";

describe("落としたものを分ける（#1026 ②）", () => {
  // ⚠️ **「開く」の絞り込みと同じ一覧**＝落とすときだけ通る／通らない形式を作らない（ADR-0026②）。
  it("通す形式は、選ぶときの一覧と同じ", () => {
    expect([...droppableExtensions(false)].sort()).toEqual([...IMAGE_FILE_EXTENSIONS, ...VIDEO_FILE_EXTENSIONS].sort());
    expect([...droppableExtensions(true)].sort()).toEqual(
      [...IMAGE_FILE_EXTENSIONS, ...VIDEO_FILE_EXTENSIONS, ...AUDIO_FILE_EXTENSIONS].sort(),
    );
  });

  it("音は、音を通す入口でだけ通る（場面形式は写真・動画のまま）", () => {
    const paths = ["C:\\pics\\a.png", "C:\\music\\b.mp3"];
    expect(triageDroppedFiles(paths, (p) => p, false).accepted).toEqual(["C:\\pics\\a.png"]);
    expect(triageDroppedFiles(paths, (p) => p, true).accepted).toEqual(paths);
  });

  // ⚠️ **黙って捨てない**（§2-5）＝落とした本人は全部入ったと思う。
  it("通らなかったものは、名前で返す（パスのままにしない）", () => {
    const r = triageDroppedFiles(["C:\\書類\\会社案内.pdf"], (p) => p, false);
    expect(r.accepted).toEqual([]);
    expect(r.rejectedNames, "パスが丸ごと出ている").toEqual(["会社案内.pdf"]);
  });

  // ⚠️ **名前が取れないときも空欄にしない**（PR #1098 レビュー 🟡）＝フォルダを落とすと
  //    区切りで終わるパスが来て、「1件は取り込めない形式でした（）」になる。
  it("フォルダ（区切りで終わるパス）を落としたら、既定の名で言う", () => {
    const r = triageDroppedFiles(["C:\\pics\\"], (p) => p, false);
    expect(r.accepted).toEqual([]);
    expect(r.rejectedNames).toEqual([UNNAMED_ASSET_NAME]);
  });

  it("落とされた順は変えない", () => {
    const paths = ["b.mp4", "a.png", "c.jpg"];
    expect(triageDroppedFiles(paths, (p) => p, false).accepted).toEqual(paths);
  });

  it("拡張子の大小は問わない", () => {
    expect(triageDroppedFiles(["A.PNG"], (p) => p, false).accepted).toEqual(["A.PNG"]);
  });

  // ⚠️ **拡大率で割る**＝割らないと、高解像度の画面では枠の上に落としても「外」になる。
  it("物理の点を CSS の点へ直す", () => {
    expect(cssPointOf({ x: 300, y: 200 }, 2)).toEqual({ x: 150, y: 100 });
    expect(cssPointOf({ x: 300, y: 200 }, 1)).toEqual({ x: 300, y: 200 });
    // 0 や負の拡大率で NaN／符号反転にしない（来たら等倍）。
    expect(cssPointOf({ x: 10, y: 10 }, 0)).toEqual({ x: 10, y: 10 });
  });

  it("枠の中かどうか（端は中に数える＝端に落として取りこぼさない）", () => {
    const r = { left: 10, top: 20, right: 110, bottom: 70 };
    expect(isPointInRect({ x: 50, y: 40 }, r)).toBe(true);
    expect(isPointInRect({ x: 10, y: 20 }, r), "左上の角").toBe(true);
    expect(isPointInRect({ x: 110, y: 70 }, r), "右下の角").toBe(true);
    expect(isPointInRect({ x: 9, y: 40 }, r)).toBe(false);
    expect(isPointInRect({ x: 50, y: 71 }, r)).toBe(false);
  });
});
