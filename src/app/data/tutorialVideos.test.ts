// 同梱するチュートリアル映像の目録と、実際に置いてあるファイルが食い違わないこと（#1229・ADR-0046 ①）。
//
// ⚠️ **「目録に書いたのに入っていない」を画面で気づけない**＝再生を押して初めて黙って何も出ない
//（`<video>` は読み込めなくても例外を投げない）。**置き場所を実際に読む**。
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TUTORIAL_VIDEOS, TUTORIAL_VIDEO_DIR, tutorialVideoSrc } from "./tutorialVideos";

const dir = join(process.cwd(), "public", TUTORIAL_VIDEO_DIR);

describe("同梱するチュートリアル映像（#1229）", () => {
  it("置き場所そのものが在る（映像を足すときに作り忘れない）", () => {
    expect(existsSync(dir), `${dir} が無い`).toBe(true);
    expect(statSync(dir).isDirectory()).toBe(true);
  });

  it("目録の映像は、実際に置いてある", () => {
    for (const v of TUTORIAL_VIDEOS) {
      expect(existsSync(join(dir, v.file)), `${v.file} が ${dir} に無い`).toBe(true);
    }
  });

  it("置いてある映像は、すべて目録に載っている（載せ忘れて配らない）", () => {
    // ⚠️ `.gitkeep` は置き場所を git に残すためのもので、映像ではない。
    const files = readdirSync(dir).filter((f) => !f.startsWith("."));
    expect([...files].sort()).toEqual([...TUTORIAL_VIDEOS.map((v) => v.file)].sort());
  });

  it("名札とファイル名は重ならない", () => {
    expect(new Set(TUTORIAL_VIDEOS.map((v) => v.id)).size).toBe(TUTORIAL_VIDEOS.length);
    expect(new Set(TUTORIAL_VIDEOS.map((v) => v.file)).size).toBe(TUTORIAL_VIDEOS.length);
  });

  it("再生する道は置き場所の下を指す", () => {
    const v = { id: "x", title: "題", desc: "説明", file: "a.mp4", durationLabel: "1分" };
    expect(tutorialVideoSrc(v)).toBe(`/${TUTORIAL_VIDEO_DIR}/a.mp4`);
  });
});
