// @vitest-environment jsdom
// 節の見出しと中身を合わせる／この欄がどこまで効くかを示す（#1032）。
//
// ⚠️ 「見た目・フォント」の中に **BGM**（見た目でもフォントでもない）と **動画全体のフォント**
//    （触ると全場面が変わる）が入っており、見出しからは探せなかった。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import type { Scene } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";
import { SceneEditScreen } from "./SceneEditScreen";

const openingTemplate = {
  schemaVersion: "1.0", templateId: "opening_yuko_right_v1", name: "オープニング", category: "opening", aspectRatio: "16:9",
  canvas: { width: 1920, height: 1080 }, defaults: { backgroundColor: "#ffffff" },
  layers: [
    { id: "background", type: "background", x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 },
    { id: "title", type: "text", textKey: "title", x: 160, y: 360, w: 1100, h: 140, zIndex: 30, fontSize: 72 },
  ],
} as unknown as Template;

const scene = (over: Partial<Scene> = {}): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "opening", templateId: "opening_yuko_right_v1",
    durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: { title: "見出し" },
    narration: { text: "", status: "none" }, warnings: [], ...over,
  }) as unknown as Scene;

const setup = (s: Scene = scene()) => {
  useProjectStore.setState({
    templates: [openingTemplate],
    parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
    scenes: [s], assets: [], editingSceneId: "scene_001",
    past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
  });
  return render(<SceneEditScreen onNavigate={vi.fn()} />);
};

/** 見出しでたどれる節（`<details>`）。 */
const section = (title: string): HTMLDetailsElement =>
  screen.getByText(title).closest("details") as HTMLDetailsElement;

describe("場面編集：節の見出しと中身を合わせる（#1032）", () => {
  beforeEach(() => {
    localStorage.clear();
    useProjectStore.setState({ past: [], future: [], _historyGroupDepth: 0 });
  });

  it("BGM は「見た目・フォント」の中ではなく、自分の節にある", () => {
    setup();
    const look = section("見た目・フォント");
    expect(look.textContent, "BGM が「見た目・フォント」の中に残っている").not.toContain("鳴らす曲");
    const bgm = section("この場面のBGM");
    expect(bgm, "BGM の節が無い").not.toBe(look);
    expect(bgm.textContent).toContain("鳴らす曲");
  });

  it("この場面だけ別の曲にしてあるときは、BGM の節を開いて出す（入れた設定を見失わない）", () => {
    setup(scene({ bgmSettings: { enabled: false } } as Partial<Scene>));
    expect(section("この場面のBGM").open).toBe(true);
  });

  it("継承のまま（動画全体に合わせる）なら畳んで出す", () => {
    setup();
    expect(section("この場面のBGM").open).toBe(false);
  });

  it("鳴らす曲の見出しは欄と結ばれている（読み上げで何の欄か分かる）", () => {
    setup();
    const label = screen.getByText("鳴らす曲") as HTMLLabelElement;
    expect(label.htmlFor, "見出しが欄と結ばれていない").toBe("scene-bgm");
    expect(document.getElementById(label.htmlFor)?.tagName).toBe("SELECT");
  });

  it("全場面に効くフォントには「動画全体」の印が付く（この場面の欄と見分けがつく）", () => {
    setup();
    const look = section("見た目・フォント");
    const badges = [...look.querySelectorAll(".badge")].map((b) => b.textContent);
    expect(badges, "「動画全体」の印が無い").toContain("動画全体");
  });
});
