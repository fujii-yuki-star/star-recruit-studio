// 片づけで「使っている」とみなす、画面が持っている内容（ADR-0064 決定2）。
import { afterEach, describe, expect, it } from "vitest";
import { useProjectStore } from "./projectStore";
import { useTimelineStore } from "./timelineStore";
import { cleanupBusy, liveDocumentTexts } from "./liveDocumentTexts";

const initialProject = useProjectStore.getState();
const initialTimeline = useTimelineStore.getState();
afterEach(() => {
  useProjectStore.setState(initialProject, true);
  useTimelineStore.setState(initialTimeline, true);
});

describe("liveDocumentTexts", () => {
  /** ⚠️ 保存前の変更と、取り消し／やり直しの履歴も入れる（やり直しで戻せるファイルを消さない）。 */
  it("場面形式：開いている動画なら、いまの内容と履歴を渡す", () => {
    useProjectStore.setState({
      meta: { ...initialProject.meta, projectId: "proj_a" },
      assets: [{ assetId: "asset_001", assetType: "image", displayName: "a", filePath: "assets/now.png" }] as never,
      past: [{ scenes: [{ narration: { voicePath: "voices/past.wav" } }] }] as never,
      future: [{ scenes: [{ narration: { voicePath: "voices/future.wav" } }] }] as never,
    });
    const [t] = liveDocumentTexts("proj_a");
    expect(t).toContain("assets/now.png");
    expect(t).toContain("voices/past.wav");
    expect(t).toContain("voices/future.wav");
  });

  it("タイムライン形式：開いている動画なら、いまの内容と履歴を渡す", () => {
    useTimelineStore.setState({
      doc: { projectId: "proj_t", assets: [{ filePath: "assets/now.png" }] } as never,
      history: { past: [{ assets: [{ filePath: "assets/frozen.png" }] }], future: [] } as never,
    });
    const [t] = liveDocumentTexts("proj_t");
    expect(t).toContain("assets/now.png");
    expect(t).toContain("assets/frozen.png");
  });

  it("開いていない動画は何も渡さない（ディスクの文書だけで見る）", () => {
    expect(liveDocumentTexts("proj_other")).toEqual([]);
  });
});

describe("cleanupBusy", () => {
  it("開いている動画で取り込み中なら片づけない", () => {
    useTimelineStore.setState({ doc: { projectId: "proj_t" } as never, isImporting: true });
    expect(cleanupBusy("proj_t")).toBe(true);
    expect(cleanupBusy("proj_other")).toBe(false);
  });

  it("場面形式で声づくり中なら片づけない", () => {
    useProjectStore.setState({ meta: { ...initialProject.meta, projectId: "proj_a" }, isGeneratingNarration: true });
    expect(cleanupBusy("proj_a")).toBe(true);
  });

  it("何も走っていなければ片づけてよい", () => {
    useProjectStore.setState({ meta: { ...initialProject.meta, projectId: "proj_a" } });
    expect(cleanupBusy("proj_a")).toBe(false);
  });
});
